/**
 * El policy engine: propuesta validada → autorización de gasto real.
 *
 * Es el único camino de escritura del sistema y el más corto. No recibe texto
 * libre, no llama a ningún modelo y no acepta cualquier cosa: su entrada es un
 * `CartDraft` que ya salió de `decide()` con estado `proposal`, o sea, que ya
 * pasó por todos los chequeos determinísticos.
 *
 * Igual vuelve a evaluar los constraints antes de reservar, y esa repetición es
 * deliberada. `decide()` evalúa contra el `MandateState` —una vista— y acá se
 * evalúa contra el `OpenCheckoutMandate` firmado, que es la fuente. Si las dos
 * evaluaciones no coinciden, algo se desincronizó entre la vista y el documento
 * firmado, y eso es exactamente el momento de no gastar plata.
 *
 * El agente no puede llegar acá por su cuenta: nada en `DecideDeps` ni en
 * `DiscoveryDeps` incluye el `AuthorizationPort`. En el contrato la misma
 * separación existe de verdad — `reserveAuthorization` es `onlyCoordinator`, y
 * el coordinador sólo le contesta al policy engine.
 */

import {
  ACTION_PURCHASE,
  type AuthorizationPort,
  type CartDraft,
  type Clock,
} from "@/contracts/index.js";
import type {
  CheckoutItem,
  CheckoutObject,
  CheckoutPort,
  CheckoutRequest,
  Disclosure,
  MerchantPresentation,
  OpenCheckoutMandate,
  SignedCredential,
} from "../../../shared/ap2.js";
import { evaluateConstraints, toMinorUnits, type ConstraintEvaluation } from "@/mandate/constraints.js";
import { closeCheckout, intentHashFor } from "@/mandate/closed.js";
import { disclosuresFor, withheldFor, type DisclosurePurpose } from "@/mandate/present.js";
import { nowSeconds, verifyJwt, type KeyPair } from "@/mandate/sdjwt.js";
import type { AgentContext } from "./context.js";
import type { KeyObject } from "node:crypto";

/**
 * Cuánto dura la reserva.
 *
 * Corto por diseño. Una reserva inmoviliza presupuesto que el comprador no
 * puede usar para otra cosa, así que si el cobro no llega, tiene que liberarse
 * sola. El contrato tiene `releaseExpiredAuthorization` sin permisos justamente
 * para que una reserva olvidada nunca pueda dejar plata trabada.
 */
const VIGENCIA_RESERVA_MINUTOS = 10;

export interface AuthorizeDeps {
  authorizations: AuthorizationPort;
  checkout: CheckoutPort;
  /** La clave del agente. Firma compras, nunca mandatos. */
  agentKey: KeyPair;
  /** La pública del merchant, ya conocida. Sirve para no aceptar un carrito ajeno. */
  merchantPublicKey: KeyObject;
  clock: Clock;
}

export interface AuthorizeInput {
  cart: CartDraft;
  open: SignedCredential<OpenCheckoutMandate>;
  /** Todas las del comprador. Acá se filtra cuáles viajan. */
  disclosures: Disclosure[];
  merchantId: string;
  purpose?: DisclosurePurpose;
}

export type AuthorizeResult =
  | {
      status: "authorized";
      presentation: MerchantPresentation;
      checkout: CheckoutObject;
      evaluations: ConstraintEvaluation[];
    }
  | {
      status: "refused";
      reason: "checkout_tampered" | "constraint_violated" | "reservation_rejected";
      detail: string;
      evaluations: ConstraintEvaluation[];
    };

// ---------------------------------------------------------------------------
// Carrito interno → formato de cable
// ---------------------------------------------------------------------------

/**
 * Traduce el carrito del agente al pedido que entiende el merchant.
 *
 * Acá es donde los pesos se vuelven centavos, una sola vez. El agente trabaja
 * con flotantes porque los precios del catálogo vienen así; de esta línea para
 * adelante todo es entero, porque de esta línea para adelante todo se hashea y
 * se compara byte a byte.
 */
export function toCheckoutRequest(
  cart: CartDraft,
  merchantId: string,
  currency: string,
): CheckoutRequest {
  const items: CheckoutItem[] = cart.lines.map((line) => {
    const { offer } = line.candidate;
    return {
      sku: offer.product.sku,
      title: offer.product.title,
      category: offer.product.category,
      supplierId: offer.supplier.id,
      quantity: line.candidate.qtyPacks,
      unitAmount: toMinorUnits(offer.product.priceArs),
      lineAmount: toMinorUnits(line.candidate.lineTotalArs),
    };
  });

  return { merchantId, currency, items, deliveryDays: cart.deliveryDays };
}

/** La moneda que el mandato autoriza. Si no hay techo de monto, no hay moneda que valga. */
function currencyOf(open: OpenCheckoutMandate): string | null {
  const monto = open.constraints.find((c) => c.type === "checkout.max_amount");
  return monto?.type === "checkout.max_amount" ? monto.currency : null;
}

/**
 * Compara lo que pedimos con lo que el merchant devolvió firmado.
 *
 * Hace falta porque el merchant es el que firma el carrito, y nada le impide
 * firmar uno distinto del que le pedimos: otro precio, una línea de más, otro
 * plazo. El comprador no tiene por qué confiar en el vendedor más de lo que el
 * vendedor confía en él. Si no coincide, no se reserva un peso.
 */
function checkoutMatchesRequest(
  request: CheckoutRequest,
  checkout: CheckoutObject,
): { ok: true } | { ok: false; detail: string } {
  if (checkout.merchant.id !== request.merchantId) {
    return { ok: false, detail: `El carrito volvió a nombre de "${checkout.merchant.id}".` };
  }
  if (checkout.currency !== request.currency) {
    return { ok: false, detail: `El carrito volvió en ${checkout.currency} y se pidió en ${request.currency}.` };
  }
  if (checkout.deliveryDays > request.deliveryDays) {
    return {
      ok: false,
      detail: `El carrito promete entrega en ${checkout.deliveryDays} días y se pidió en ${request.deliveryDays}.`,
    };
  }
  if (checkout.items.length !== request.items.length) {
    return {
      ok: false,
      detail: `El carrito volvió con ${checkout.items.length} líneas y se pidieron ${request.items.length}.`,
    };
  }

  const pedidas = new Map(request.items.map((i) => [i.sku, i]));
  for (const item of checkout.items) {
    const pedida = pedidas.get(item.sku);
    if (pedida === undefined) {
      return { ok: false, detail: `El carrito trae "${item.sku}", que no se pidió.` };
    }
    if (item.quantity !== pedida.quantity || item.lineAmount !== pedida.lineAmount) {
      return {
        ok: false,
        detail: `"${item.sku}": se pidieron ${pedida.quantity} por ${pedida.lineAmount} y volvió ${item.quantity} por ${item.lineAmount}.`,
      };
    }
  }

  const suma = checkout.items.reduce((acc, i) => acc + i.lineAmount, 0);
  if (suma !== checkout.amount) {
    return { ok: false, detail: `El total firmado (${checkout.amount}) no es la suma de las líneas (${suma}).` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// El camino
// ---------------------------------------------------------------------------

export async function authorize(
  input: AuthorizeInput,
  deps: AuthorizeDeps,
  ctx: AgentContext,
): Promise<AuthorizeResult> {
  const open = input.open.payload;
  const currency = currencyOf(open);

  if (currency === null) {
    return {
      status: "refused",
      reason: "constraint_violated",
      detail: "El mandato no declara techo de monto. Sin ese constraint no hay nada que autorice gastar.",
      evaluations: [],
    };
  }

  // 1. El merchant cierra y firma el carrito.
  const request = toCheckoutRequest(input.cart, input.merchantId, currency);
  const issued = await deps.checkout.close(request);

  // 2. ¿Lo firmó de verdad el merchant que decimos, y firmó lo que pedimos?
  const checkout = verifyJwt<CheckoutObject>(issued.checkout.jwt, deps.merchantPublicKey);
  if (checkout === null) {
    return {
      status: "refused",
      reason: "checkout_tampered",
      detail: "El carrito no está firmado por la clave del vendedor que dice ser.",
      evaluations: [],
    };
  }

  const coincide = checkoutMatchesRequest(request, checkout);
  if (!coincide.ok) {
    return { status: "refused", reason: "checkout_tampered", detail: coincide.detail, evaluations: [] };
  }

  ctx.audit.emit({
    type: "checkout_closed",
    checkoutId: checkout.checkoutId,
    merchantId: checkout.merchant.id,
    amount: checkout.amount,
    checkoutHash: intentHashFor(issued.checkout),
  });

  // 3. Los límites del mandato firmado, re-evaluados contra el carrito real.
  const verdict = evaluateConstraints(open.constraints, checkout);
  for (const e of verdict.evaluations) {
    ctx.audit.emit({ type: "policy_check", check: e.type, passed: e.passed, detail: e.detail });
  }

  if (!verdict.passed) {
    const primera = verdict.evaluations.find((e) => !e.passed);
    return {
      status: "refused",
      reason: "constraint_violated",
      detail: primera?.detail ?? "Un límite del mandato no se cumple.",
      evaluations: verdict.evaluations,
    };
  }

  // 4. Recién ahora se compromete plata.
  const intentHash = intentHashFor(issued.checkout);
  const expiresAt = nowSeconds(deps.clock) + VIGENCIA_RESERVA_MINUTOS * 60;

  let authorizationId: string;
  try {
    const reserva = await deps.authorizations.reserve({
      mandateId: open.mandateId,
      // El agente y el delegado salen del mandato firmado, no de la
      // configuración local: el contrato los compara contra `terms`, y el único
      // lugar donde esos valores están comprometidos con la firma del humano es
      // acá. Leerlos de un archivo sería leerlos de algo que el agente edita.
      agent: open.agent,
      paymentDelegate: open.paymentDelegate,
      amount: checkout.amount,
      action: ACTION_PURCHASE,
      intentHash,
      expiresAt,
    });
    authorizationId = reserva.authorizationId;

    ctx.audit.emit({
      type: "authorization_reserved",
      authorizationId: reserva.authorizationId,
      mandateId: reserva.mandateId,
      amount: reserva.amount,
      expiresAt: reserva.expiresAt,
    });
  } catch (error) {
    // El contrato es la última palabra y puede decir que no por cosas que la
    // credencial no sabe: el mandato se revocó hace un segundo, o el
    // presupuesto acumulado ya no alcanza aunque este carrito entre en el techo
    // por compra. Que rechace acá es el sistema funcionando.
    const detail = error instanceof Error ? error.message : String(error);
    ctx.audit.emit({ type: "policy_check", check: "chain_reservation", passed: false, detail });
    return { status: "refused", reason: "reservation_rejected", detail, evaluations: verdict.evaluations };
  }

  // 5. La compra, firmada por el agente y atada al carrito y al mandato.
  const closed = closeCheckout(
    { open: input.open, checkout: issued.checkout, audience: input.merchantId, nonce: issued.nonce },
    deps.agentKey,
    deps.clock,
  );

  // 6. Sólo los datos del comprador que esta compra justifica.
  const purpose = input.purpose ?? "fulfillment";
  const disclosures = disclosuresFor(purpose, input.disclosures);

  ctx.audit.emit({
    type: "presentation_built",
    audience: input.merchantId,
    disclosed: disclosures.map((d) => d.claim),
    withheld: withheldFor(purpose, input.disclosures),
  });

  return {
    status: "authorized",
    checkout,
    evaluations: verdict.evaluations,
    presentation: {
      open: input.open,
      closed: closed.credential,
      kbJwt: closed.kbJwt,
      disclosures,
      authorizationId,
    },
  };
}
