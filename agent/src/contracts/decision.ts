/**
 * Salida de discover + decide.
 *
 * El principio del módulo: toda oferta que el agente miró queda registrada,
 * elegida o descartada, y las descartadas llevan la razón. Un agente que solo
 * informa lo que compró es incontrolable — el trail auditable que pide el
 * challenge es justamente el de las decisiones que NO se ven en el carrito.
 */

import type { Offer } from "./catalog.js";
import type { NeedSpec, PurchaseIntent } from "./intent.js";
import type { MandateDraft } from "./mandate.js";

/** En qué se diferencia un sustituto de lo que se pidió. */
export interface AttrDiff {
  attr: string;
  requested: string;
  offered: string;
}

export interface Candidate {
  offer: Offer;
  need: NeedSpec;
  /** `exact` = coincide en todos los atributos pedidos. `substitute` = difiere en alguno. */
  kind: "exact" | "substitute";
  diffs: AttrDiff[];
  /** Packs a comprar para cubrir la cantidad pedida (entero, hacia arriba). */
  qtyPacks: number;
  lineTotalArs: number;
}

export type RejectionReason =
  | "no_match"
  | "out_of_stock"
  | "insufficient_stock"
  | "category_forbidden"
  | "supplier_not_allowed"
  | "delivery_too_slow"
  | "over_budget"
  | "over_max_per_purchase"
  | "brand_mismatch"
  | "substitutes_not_allowed"
  | "substitute_rejected"
  | "worse_unit_price"
  | "below_supplier_minimum";

export interface RejectedCandidate {
  sku: string;
  supplierId: string;
  reason: RejectionReason;
  /** Explicación legible por un humano, con los números que la sostienen. */
  detail: string;
}

export interface CartLine {
  need: NeedSpec;
  candidate: Candidate;
  /** Por qué ganó esta oferta y no otra. */
  rationale: string;
}

export interface CartDraft {
  cartId: string;
  intentId: string;
  mandateId: string;
  lines: CartLine[];
  totalArs: number;
  /** Máximo deliveryDays de los proveedores involucrados. */
  deliveryDays: number;
  /** Estado del mandato leído justo antes de emitir esto. */
  mandateReadAt: string;
}

/** Necesidades que no se pudieron cubrir, con el motivo. */
export interface UnmetNeed {
  need: NeedSpec;
  reason: RejectionReason;
  detail: string;
}

/**
 * El resultado de un run. Tres salidas posibles y ninguna silenciosa:
 * - `proposal`: dentro del mandato, listo para que el equipo de pagos lo cobre.
 * - `escalation`: fuera del mandato pero plausible — decide un humano.
 * - `rejection`: no procede, y el agente no le pregunta a nadie.
 */
export type DecisionOutcome =
  | { status: "proposal"; cart: CartDraft; rejected: RejectedCandidate[]; unmet: UnmetNeed[] }
  | {
      status: "escalation";
      reason: RejectionReason;
      detail: string;
      /** El carrito propuesto, para que el humano vea qué se estaba por comprar. */
      cart: CartDraft;
      rejected: RejectedCandidate[];
      unmet: UnmetNeed[];
    }
  | {
      status: "rejection";
      reason: RejectionReason | "mandate_unusable";
      detail: string;
      rejected: RejectedCandidate[];
      unmet: UnmetNeed[];
    };

export interface DecisionTrace {
  runId: string;
  intent: PurchaseIntent;
  outcome: DecisionOutcome;
}

/** Por qué el agente sugirió en vez de comprar. */
export type SuggestionReason =
  /** No hay ningún mandato firmado. El agente no puede comprar, con o sin ganas. */
  | "no_mandate"
  /** Hay mandato pero está revocado, vencido o inactivo. */
  | "mandate_unusable"
  /** El pedido era una consulta, no una orden de compra. */
  | "exploratory_request"
  /** El pedido depende de una condición que todavía no se cumplió. */
  | "conditional_request";

/**
 * Una opción dentro del abanico que se muestra al cotizar.
 *
 * Cotizar y comprar son cosas distintas: comprando hay que elegir una, y
 * cotizando lo útil es ver el rango. Un agente que contesta "¿qué café hay?"
 * con un solo producto no está respondiendo la pregunta.
 */
export interface AlternativeOption {
  candidate: Candidate;
  /** Dónde cae en el rango de precios de ese rubro. */
  tier: "economica" | "intermedia" | "premium";
  /**
   * Cómo queda contra el presupuesto que el humano mencionó, si mencionó alguno.
   * `por_encima` NO la descalifica: al cotizar se muestran igual, marcadas.
   * Saber que la buena cuesta el doble es exactamente lo que se está preguntando.
   */
  vsBudget: "dentro" | "por_encima" | null;
}

export interface NeedAlternatives {
  need: NeedSpec;
  options: AlternativeOption[];
}

/**
 * Salida del modo sugerencia: el agente buscó y comparó, pero no compró.
 *
 * Hace todo el trabajo de discovery y decisión —el humano ve exactamente qué
 * compraría y por cuánto— sin ninguna capacidad de gastar. Y adjunta el
 * borrador de mandato listo para firmar, que es el único camino por el que esto
 * puede convertirse en una compra.
 */
export interface Suggestion {
  suggestionId: string;
  intentId: string;
  reason: SuggestionReason;
  detail: string;
  lines: CartLine[];
  estimatedTotalArs: number;
  /**
   * El abanico por ítem: económica, intermedia y premium cuando existen.
   * Acá el presupuesto no recorta nada — solo etiqueta.
   */
  alternatives: NeedAlternatives[];
  mandateDraft: MandateDraft;
  rejected: RejectedCandidate[];
  unmet: UnmetNeed[];
}
