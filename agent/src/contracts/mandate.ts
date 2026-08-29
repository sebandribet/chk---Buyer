/**
 * Nuestra vista del mandato. SOLO LECTURA.
 *
 * El mandato vive en un smart contract en Solidity que mantiene otro equipo.
 * Este puerto es la única superficie por la que el agente lo toca, y no expone
 * ninguna operación de escritura a propósito: el agente no puede crear, ampliar
 * ni renovar su propia autorización. Si pudiera, el mandato no serviría de nada.
 *
 * Implementaciones: `FakeMandatePort` (local, para tests y demo offline) y la
 * que lea la chain cuando el contrato esté desplegado.
 */

import type { Category } from "./catalog.js";
import type { CanonicalMandate } from "../../../shared/mandate.js";
import type { Constraint } from "../../../shared/ap2.js";

export interface MandateState {
  mandateId: string;
  active: boolean;
  /** ISO. Presente si fue revocado. */
  revokedAt: string | null;
  /** ISO. */
  expiresAt: string | null;

  budgetTotalArs: number;
  budgetSpentArs: number;
  /** Techo por compra individual, además del presupuesto acumulado. null = sin techo por compra. */
  maxPerPurchaseArs: number | null;

  allowedCategories: Category[];
  /** Allowlist de proveedores. null = cualquiera. */
  allowedSuppliers: string[] | null;

  /**
   * Cuándo leímos este estado (ISO). Con la chain de por medio la lectura
   * siempre es de un momento pasado, y la diferencia importa: por eso el
   * agente vuelve a leer antes de proponer, en vez de guardarse esto.
   */
  readAt: string;
  /** Bloque del que se leyó, cuando la fuente es on-chain. */
  blockNumber: number | null;
  source: "chain" | "fake";
}

export interface MandatePort {
  read(mandateId: string): Promise<MandateState>;
}

/**
 * Borrador de mandato: lo que el agente le propone firmar al humano.
 *
 * Es la salida del modo sugerencia y es el contenido de un **Open Checkout
 * Mandate** de AP2 antes de que exista la firma que lo convierte en uno.
 *
 * (Nota para quien venga de la bibliografía: NO es un `IntentMandate`. Ese
 * nombre pertenece al modelo viejo de tres mandatos —Intent, Cart, Payment—
 * que la spec actual ya no usa. Hoy son dos mandatos, Checkout y Payment, cada
 * uno con etapa `open` —los límites que el humano acepta— y etapa `closed` —una
 * transacción concreta dentro de esos límites—. Casi todo lo escrito sobre AP2
 * describe el modelo viejo.)
 *
 * Que sea un borrador no es un detalle de implementación: el agente puede
 * redactarlo pero NO puede firmarlo ni activarlo. La firma es un acto del
 * humano con su clave, y es lo único que convierte esto en autoridad de gasto.
 */
export interface MandateDraft {
  /** El pedido original del humano, textual. AP2 lo exige. */
  naturalLanguageDescription: string;
  allowedCategories: Category[];
  /** Sugerido a partir de lo que costaría el carrito, no inventado. */
  suggestedBudgetArs: number;
  /**
   * Techo por compra individual, además del acumulado.
   *
   * Los dos límites hacen falta y no son el mismo: el acumulado evita que el
   * agente gaste de más a lo largo del mes, el techo por compra evita que se lo
   * gaste todo de una. Un mandato con sólo el primero autoriza, técnicamente,
   * una única compra por el presupuesto entero.
   */
  suggestedMaxPerPurchaseArs: number;
  allowedSuppliers: string[] | null;
  /** Plazo de entrega máximo que el pedido tolera. `null` = sin límite. */
  maxDeliveryDays: number | null;
  expiresAt: string | null;
  /** Siempre true en un borrador: nadie firma a ciegas. */
  userCartConfirmationRequired: boolean;
}

// ---------------------------------------------------------------------------
// El lado de escritura
// ---------------------------------------------------------------------------

/**
 * Los términos del mandato tal como los guarda el contrato.
 *
 * Es un espejo exacto de `MandateTypes.Terms` en Solidity, y conviene que siga
 * siéndolo: cuando el adapter on-chain reemplace al fake, la única diferencia
 * debería ser de dónde vienen los datos, no qué datos son.
 *
 * Montos en unidad mínima de la moneda (centavos), enteros. Tiempos en segundos
 * unix, que es lo que ve `block.timestamp`.
 */
export interface MandateTerms {
  agent: string;
  paymentDelegate: string;
  validAfter: number;
  expiresAt: number;
  maxPerOperation: number;
  maxTotal: number;
  /** Bitmask: la acción n está permitida si `allowedActions & (1 << n)`. */
  allowedActions: number;
  policyHash: string;
}

/** La única acción que existe hoy. El bitmask deja lugar para 31 más. */
export const ACTION_PURCHASE = 0;

export interface Authorization {
  authorizationId: string;
  mandateId: string;
  /** Unidad mínima de la moneda. */
  amount: number;
  /** Segundos unix. */
  expiresAt: number;
  mandateRevision: number;
  active: boolean;
}

/**
 * Crear y revocar mandatos. **Esto es la superficie del HUMANO, no la del agente.**
 *
 * Está en un puerto aparte de `MandatePort` por la misma razón por la que
 * `MandatePort` no tiene `write`: si el agente pudiera alcanzar esto, podría
 * ampliarse su propio permiso, y el mandato dejaría de significar nada. Ningún
 * tipo de `DecideDeps` ni de `DiscoveryDeps` incluye este puerto, así que la
 * imposibilidad la garantiza el compilador y no la disciplina de nadie.
 */
export interface MandateRegistryPort {
  /**
   * La política va JUNTO con los términos, aunque el contrato sólo guarde su hash.
   *
   * Podrían ir por separado —el hash es lo único que la chain necesita— pero
   * separarlos crea la posibilidad de registrar un mandato cuya política nadie
   * tiene, y un `policyHash` sin la política que lo produjo es un compromiso
   * con algo que no se puede exhibir: inverificable para siempre. Yendo juntos,
   * la implementación puede comprobar que una cosa hashea a la otra, y ese
   * chequeo queda en un solo lugar en vez de en cada quien llame.
   */
  createMandate(owner: string, terms: MandateTerms, policy: Constraint[]): Promise<string>;
  amendMandate(mandateId: string, owner: string, terms: MandateTerms, policy: Constraint[]): Promise<void>;
  revokeMandate(mandateId: string, owner: string): Promise<void>;
}

export interface ReserveRequest {
  mandateId: string;
  agent: string;
  paymentDelegate: string;
  /** Unidad mínima de la moneda. */
  amount: number;
  action: number;
  /** Ata la reserva a una compra concreta: la misma compra no se reserva dos veces. */
  intentHash: string;
  expiresAt: number;
}

/**
 * Reservar presupuesto para una compra ya validada.
 *
 * La reserva es de un solo uso, acotada en monto y con vencimiento propio —es la
 * misma figura que el token delegado de ACP (`max_amount`, `expires_at`,
 * `reason: "one_time"`), con el contrato haciendo de registro.
 *
 * Quién puede llamarlo: sólo el policy engine (`agent/src/agent/authorize.ts`),
 * y sólo con una propuesta que ya pasó por los chequeos determinísticos. En el
 * contrato la misma restricción existe de verdad: `reserveAuthorization` es
 * `onlyCoordinator`, y el coordinador sólo acepta al policy engine.
 */
export interface AuthorizationPort {
  reserve(request: ReserveRequest): Promise<Authorization>;
  cancel(authorizationId: string): Promise<void>;
}

/**
 * Consumir la reserva: descontar del presupuesto lo que efectivamente se gastó.
 *
 * Puerto aparte del que reserva porque lo usa OTRO actor. Reservar es del policy
 * engine; consumir es del delegado de pago, que es quien mueve la plata. En el
 * contrato la separación es real: `consumeAuthorization` exige
 * `msg.sender == paymentDelegate`, así que ni el agente ni el policy engine
 * pueden llamarlo aunque quieran.
 *
 * Se llama DESPUÉS de cobrar, nunca antes. El contrato es el registro de lo que
 * se gastó de verdad; adelantarlo lo convertiría en un registro de intenciones.
 */
export interface SettlementPort {
  consume(authorizationId: string, paymentDelegate: string): Promise<void>;
}

/**
 * Lo que el merchant necesita leer de la chain para verificar.
 *
 * Es de sólo lectura y deliberadamente chico: el merchant comprueba que el
 * mandato sigue vivo y que la reserva es real, y nada más. No lee el
 * presupuesto total ni el gasto acumulado del comprador.
 */
export interface ChainReader {
  readMandate(mandateId: string): Promise<MandateState>;
  readAuthorization(authorizationId: string): Promise<Authorization | null>;
}

export function budgetRemainingArs(m: MandateState): number {
  return Math.max(0, m.budgetTotalArs - m.budgetSpentArs);
}

/** Un mandato sirve solo si está activo, no revocado y no vencido, evaluado contra un reloj explícito. */
export function isUsable(m: MandateState, now: Date): { usable: boolean; reason?: string } {
  if (!m.active) return { usable: false, reason: "mandate_inactive" };
  if (m.revokedAt !== null) return { usable: false, reason: "mandate_revoked" };
  if (m.expiresAt !== null && new Date(m.expiresAt).getTime() <= now.getTime()) {
    return { usable: false, reason: "mandate_expired" };
  }
  return { usable: true };
}

/**
 * Adapter used when the agent receives a mandate created by the UI rather than
 * by its local fake port. The policy engine still reads fresh chain state before
 * a purchase; this representation is for shared API payloads and display.
 */
export function toCanonicalMandate(
  state: MandateState,
  identity: { owner: string; agent: string; paymentDelegate: string; policyHash: string | null },
): CanonicalMandate {
  const status: CanonicalMandate["status"] = !state.active
    ? "Archived"
    : state.revokedAt !== null
      ? "Revoked"
      : state.expiresAt !== null && new Date(state.expiresAt).getTime() <= Date.now()
        ? "Expired"
        : "Active";

  return {
    mandateId: state.mandateId,
    revision: 1,
    status,
    owner: identity.owner,
    agent: identity.agent,
    paymentDelegate: identity.paymentDelegate,
    validAfter: state.readAt,
    expiresAt: state.expiresAt ?? "",
    maxPerOperation: state.maxPerPurchaseArs ?? state.budgetTotalArs,
    maxTotal: state.budgetTotalArs,
    spent: state.budgetSpentArs,
    reserved: 0,
    policyHash: identity.policyHash,
    policy: {
      currency: "ARS",
      allowedSuppliers: state.allowedSuppliers ?? [],
      allowedCategories: state.allowedCategories,
      allowedSkus: [],
      maxUnitPrice: null,
      maxOrderAmount: state.maxPerPurchaseArs ?? state.budgetTotalArs,
      maxQuantityPerOrder: null,
      replenishmentFrequencyDays: null,
      exceptionHandling: "Request approval",
    },
  };
}
