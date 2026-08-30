/**
 * Los límites del mandato y el motor que los evalúa.
 *
 * Este archivo es el gemelo de `agent/src/agent/policy.ts`, pero para el otro
 * lado del mostrador. `policy.ts` decide qué puede comprar el agente; esto
 * decide si una compra ya hecha cae dentro de lo que el humano firmó, y lo
 * corre el merchant, que no tiene ninguna razón para confiar en nosotros.
 *
 * Que existan los dos no es duplicación: es que la misma pregunta la contestan
 * dos partes con intereses distintos. Si sólo existiera el nuestro, el
 * merchant estaría creyéndole al agente sobre si el agente cumplió las reglas.
 *
 * LA REGLA, textual de la spec de AP2:
 *
 *   "Any unknown Constraints MUST be treated as failing evaluation."
 *
 * Un límite que el verificador no entiende no se puede ignorar. Si se pudiera,
 * agregar un constraint inventado al mandato sería una forma de hacer
 * desaparecer los que sí se entienden. Por eso el registro es cerrado y el
 * default es rechazar.
 *
 * Corolario práctico: agregar un tipo de constraint nuevo rompe a los
 * verificadores viejos, a propósito. Eso es lo correcto — un verificador viejo
 * que acepta un mandato que no entiende es peor que uno que lo rechaza.
 */

import type {
  Constraint,
  MerchantRef,
  PaymentInstrumentRef,
  PurchaseContext,
} from "../../../shared/ap2.js";
import { hashObject } from "./sdjwt.js";

// ---------------------------------------------------------------------------
// Plata: una sola conversión, en un solo lugar
// ---------------------------------------------------------------------------

/**
 * Pesos a centavos.
 *
 * Existe porque el mismo importe tiene que dar EXACTAMENTE igual en tres
 * lugares: el constraint del mandato, el carrito firmado por el merchant y el
 * `uint128` del contrato. Un `Math.floor` de un lado y un `Math.round` del otro
 * producen una diferencia de un centavo que hace fallar la verificación sin que
 * nadie entienda por qué. Se redondea acá y no se vuelve a tocar.
 */
export function toMinorUnits(ars: number): number {
  return Math.round(ars * 100);
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

/**
 * Un importe para que lo lea una persona.
 *
 * Los detalles de cada chequeo los lee un humano —en la demo, en un log, en una
 * disputa— y "3700000" contra "$37.000" es la diferencia entre poder auditar
 * esto y tener que hacer la cuenta a mano cada vez.
 */
function money(minor: number, currency = "ARS"): string {
  return `${currency} ${fromMinorUnits(minor).toLocaleString("en-US")}`;
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

export interface ConstraintEvaluation {
  type: string;
  passed: boolean;
  detail: string;
}

const ok = (type: string, detail: string): ConstraintEvaluation => ({ type, passed: true, detail });
const fail = (type: string, detail: string): ConstraintEvaluation => ({ type, passed: false, detail });

type Evaluator = (constraint: Constraint, purchase: PurchaseContext) => ConstraintEvaluation;

/**
 * El registro. Cerrado a propósito.
 *
 * Sobre las listas vacías: una lista vacía NO significa "cualquiera", significa
 * "ninguno". Si un mandato no quiere limitar los proveedores, el constraint
 * directamente no está — la ausencia es el permiso amplio, la lista vacía es la
 * prohibición total. Es al revés de lo intuitivo y es deliberado: el bug
 * clásico de este tipo de sistemas es que una lista que quedó vacía por error
 * termine autorizando todo.
 */
const EVALUATORS: Record<Constraint["type"], Evaluator> = {
  "checkout.allowed_merchants": (constraint, { checkout }) => {
    if (constraint.type !== "checkout.allowed_merchants") return fail(constraint.type, "Evaluador mal ruteado.");
    const permitidos = new Set(constraint.allowed.map((m) => m.id));

    if (!permitidos.has(checkout.merchant.id)) {
      return fail(
        constraint.type,
        `Merchant "${checkout.merchant.id}" is not on the mandate list (${[...permitidos].join(", ") || "empty"}).`,
      );
    }

    // El mandato limita proveedores por ítem, no sólo el vendedor del carrito:
    // un marketplace podría cerrar la venta él y surtirla desde cualquier lado.
    const ajenos = [...new Set(checkout.items.map((i) => i.supplierId))].filter((s) => !permitidos.has(s));
    if (ajenos.length > 0) {
      return fail(constraint.type, `Items supplied by suppliers outside the mandate: ${ajenos.join(", ")}.`);
    }

    return ok(constraint.type, `Merchant and suppliers are on the list (${checkout.merchant.id}).`);
  },

  "checkout.allowed_categories": (constraint, { checkout }) => {
    if (constraint.type !== "checkout.allowed_categories") return fail(constraint.type, "Evaluador mal ruteado.");
    const permitidas = new Set(constraint.allowed);
    const fuera = [...new Set(checkout.items.map((i) => i.category))].filter((c) => !permitidas.has(c));

    if (fuera.length > 0) {
      return fail(
        constraint.type,
        `Categories outside the mandate: ${fuera.join(", ")} (allowed: ${[...permitidas].join(", ") || "none"}).`,
      );
    }

    return ok(constraint.type, `Every category is allowed (${[...permitidas].join(", ")}).`);
  },

  "checkout.max_amount": (constraint, { checkout }) => {
    if (constraint.type !== "checkout.max_amount") return fail(constraint.type, "Evaluador mal ruteado.");

    if (checkout.currency !== constraint.currency) {
      return fail(
        constraint.type,
        `The cart is in ${checkout.currency} and the mandate authorizes ${constraint.currency}.`,
      );
    }

    // Se re-suman las líneas en vez de creerle al total del carrito. Es el
    // chequeo más barato del archivo y atrapa al agente que presenta un total
    // bajo con ítems caros adentro.
    const suma = checkout.items.reduce((acc, i) => acc + i.lineAmount, 0);
    if (suma !== checkout.amount) {
      return fail(
        constraint.type,
        `The declared total (${money(checkout.amount, checkout.currency)}) does not match the sum of the lines (${money(suma, checkout.currency)}).`,
      );
    }

    if (checkout.amount > constraint.maxPerOperation) {
      return fail(
        constraint.type,
        `The cart totals ${money(checkout.amount, checkout.currency)} and the per-operation cap is ${money(constraint.maxPerOperation, constraint.currency)}.`,
      );
    }

    // `maxTotal` es acumulado entre compras: no se puede verificar mirando un
    // carrito solo. Lo hace cumplir el contrato, que es el único que sabe
    // cuánto se gastó antes. Acá queda declarado para que el merchant vea el
    // límite completo, no para evaluarlo.
    return ok(
      constraint.type,
      `Cart of ${money(checkout.amount, checkout.currency)} is within the per-operation cap (${money(constraint.maxPerOperation, constraint.currency)}).`,
    );
  },

  "checkout.max_delivery_days": (constraint, { checkout }) => {
    if (constraint.type !== "checkout.max_delivery_days") return fail(constraint.type, "Evaluador mal ruteado.");

    if (checkout.deliveryDays > constraint.days) {
      return fail(
        constraint.type,
        `Delivery in ${checkout.deliveryDays} day(s) and the mandate accepts up to ${constraint.days}.`,
      );
    }

    return ok(constraint.type, `Delivery in ${checkout.deliveryDays} day(s), within the mandate's ${constraint.days}.`);
  },

  /**
   * Con qué se paga.
   *
   * Se compara SÓLO por `ref`, que es el token del proveedor. `brand` y `last4`
   * están para que un humano reconozca la tarjeta, no para autorizar con ellos:
   * dos tarjetas distintas pueden terminar en 4242, y aceptar por los últimos
   * cuatro dígitos sería aceptar por una coincidencia.
   */
  "checkout.allowed_payment_instruments": (constraint, { paymentInstrument }) => {
    if (constraint.type !== "checkout.allowed_payment_instruments") {
      return fail(constraint.type, "Evaluador mal ruteado.");
    }

    const autorizado = constraint.allowed.find((i) => i.ref === paymentInstrument.ref);
    if (autorizado === undefined) {
      const lista = constraint.allowed.map((i) => `${i.brand} ····${i.last4}`).join(", ");
      return fail(
        constraint.type,
        `Paying with ${paymentInstrument.brand} ····${paymentInstrument.last4}, which the mandate does not authorize (allowed: ${lista || "none"}).`,
      );
    }

    return ok(constraint.type, `Paying with ${autorizado.brand} ····${autorizado.last4}, authorized in the mandate.`);
  },
};

export interface ConstraintsVerdict {
  passed: boolean;
  /** `true` si alguna falla fue por un tipo que no sabemos evaluar. */
  unknownType: boolean;
  evaluations: ConstraintEvaluation[];
}

/**
 * Evalúa TODOS los constraints y devuelve todos los resultados.
 *
 * No corta en la primera falla, por el mismo motivo que `checkBudget` en
 * `policy.ts`: quien audita esto después quiere saber cuántos límites se
 * violaron y por cuánto, no cuál saltó primero.
 */
export function evaluateConstraints(
  constraints: readonly Constraint[],
  purchase: PurchaseContext,
): ConstraintsVerdict {
  const evaluations: ConstraintEvaluation[] = [];
  let unknownType = false;

  for (const constraint of constraints) {
    const evaluator = EVALUATORS[constraint.type as Constraint["type"]];

    if (evaluator === undefined) {
      unknownType = true;
      evaluations.push(
        fail(
          String((constraint as { type?: unknown }).type ?? "(sin tipo)"),
          "Tipo de constraint desconocido. La spec obliga a tratarlo como fallado: un límite que no se entiende no se ignora.",
        ),
      );
      continue;
    }

    evaluations.push(evaluator(constraint, purchase));
  }

  return { passed: evaluations.every((e) => e.passed), unknownType, evaluations };
}

// ---------------------------------------------------------------------------
// policyHash: la junta entre la credencial y el contrato
// ---------------------------------------------------------------------------

/**
 * El compromiso con los límites, en un solo valor.
 *
 * Este mismo hash va en dos lugares: dentro del mandato firmado por el humano y
 * en `Terms.policyHash` del contrato. Eso es lo que le permite al merchant
 * cerrar el círculo — comprueba que los límites que le mostraron son
 * exactamente los que el humano firmó on-chain, sin tener que confiar en el
 * agente que se los mostró.
 *
 * Los constraints se ordenan por tipo antes de hashear: el orden en que el
 * redactor los puso no debería cambiar el hash de la misma política.
 */
export function policyHash(constraints: readonly Constraint[]): string {
  const ordenados = [...constraints].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return hashObject(ordenados);
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

export interface ConstraintsInput {
  allowedCategories: string[];
  /** `null` = sin límite de proveedor. Se omite el constraint, no se manda vacío. */
  allowedSuppliers: MerchantRef[] | null;
  currency: string;
  maxPerOperationArs: number;
  maxTotalArs: number;
  maxDeliveryDays: number | null;
  /**
   * Con qué se puede pagar.
   *
   * A diferencia de los proveedores, acá NO hay opción de "cualquiera": un
   * mandato sin medio de pago no puede comprar nada, así que el constraint
   * siempre está. Un mandato que autorizara pagar con cualquier tarjeta del
   * humano sería, justamente, entregarle la billetera al agente.
   */
  paymentInstruments: PaymentInstrumentRef[];
}

/**
 * Arma los constraints del mandato desde lo que decidió el humano.
 *
 * Los límites que no se pusieron se OMITEN en vez de mandarse como lista vacía
 * o como infinito. Un mandato con menos constraints es un mandato más amplio, y
 * eso queda visible en el objeto en vez de escondido en un valor centinela.
 */
export function buildConstraints(input: ConstraintsInput): Constraint[] {
  const constraints: Constraint[] = [
    { type: "checkout.allowed_categories", allowed: [...input.allowedCategories].sort() },
    {
      type: "checkout.max_amount",
      currency: input.currency,
      maxPerOperation: toMinorUnits(input.maxPerOperationArs),
      maxTotal: toMinorUnits(input.maxTotalArs),
    },
    {
      type: "checkout.allowed_payment_instruments",
      allowed: [...input.paymentInstruments].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
    },
  ];

  if (input.allowedSuppliers !== null) {
    constraints.push({
      type: "checkout.allowed_merchants",
      allowed: [...input.allowedSuppliers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });
  }

  if (input.maxDeliveryDays !== null) {
    constraints.push({ type: "checkout.max_delivery_days", days: input.maxDeliveryDays });
  }

  return constraints;
}
