/**
 * Lo que el agente entiende del prompt del humano.
 *
 * La forma sigue el `IntentMandate` de AP2 (ap2-protocol.org): descripción en
 * lenguaje natural, allowlist de merchants, constraints y expiración. No lo
 * firmamos nosotros — el equipo de mandatos lo lleva on-chain. Nuestra salida
 * es el draft sin firmar.
 */

import type { Category, Unit } from "./catalog.js";

/**
 * La ficha del pedido: el pedido reformulado de forma explícita y canónica.
 *
 * Es lo que el humano confirma, lo que el merchant recibe y lo que resuelve una
 * disputa — "yo nunca autoricé esto" se contesta con esto, no con el texto que
 * alguien tipeó apurado.
 *
 * NO SE INFIERE. Se genera desde el `PurchaseIntent` ya validado, así que por
 * construcción no puede afirmar nada que la estructura no contenga. Un segundo
 * pase del modelo sobre el prompt original podría redondear un presupuesto o
 * inventar un plazo, y sería indistinguible de una reformulación fiel.
 *
 * Lo que falta se declara faltante. Un pedido sin plazo dice "sin plazo", no se
 * completa con uno razonable.
 */
export interface OrderBrief {
  /** Reformulación legible, para mostrarle al humano y firmar. */
  text: string;
  /** Una línea por dimensión: qué, cuánto, para cuándo, con qué límites. */
  lines: { label: string; value: string }[];
  /** Dimensiones que el pedido no fijó. Explícitas, no ausentes. */
  unspecified: string[];
}

/**
 * El brief de búsqueda, para pedidos que no son órdenes de compra.
 *
 * Acá sí interviene el modelo expandiendo: "estoy viendo opciones de detergente"
 * no trae cantidad, y frenar a preguntar "¿cuánto necesitás?" es peor respuesta
 * que mostrar las opciones. Es seguro porque en este camino no se compra nada:
 * lo peor que puede pasar es sugerir de más.
 *
 * Las cantidades que sale a buscar son DE REFERENCIA y viajan marcadas como
 * tales, para que nadie las confunda con algo que el humano pidió.
 */
export interface SearchBrief {
  text: string;
  /** Por qué se eligieron estos ítems y estas cantidades de referencia. */
  rationale: string;
}

/** Un ítem que el humano quiere comprar. */
export interface NeedSpec {
  /** Nombre canónico, comparable entre proveedores: "leche". */
  canonical: string;
  /** Variante pedida: { tipo: "descremada" }. Vacío = cualquier variante sirve. */
  attrs: Record<string, string>;
  qty: number;
  unit: Unit;
  /**
   * Si el humano aceptaría otra variante cuando la pedida no está.
   * Por defecto false: sustituir sin permiso es exactamente donde un agente
   * compra algo que nadie pidió.
   */
  substitutesAllowed: boolean;
  /** Marca pedida explícitamente ("quiero Lavazza"). null = cualquiera. */
  brandPreference?: string | null;
  /**
   * Qué fijó el humano: la cantidad o la plata.
   *
   * `quantity` — "2 kilos de café". Mandan `qty` y `unit`.
   * `budget`   — "un café de 20 lucas". Manda `budgetArs`: se busca UN envase,
   *              el que mejor aproveche esa plata. `qty` no significa nada acá.
   *
   * La distinción existe porque sin ella el agente convierte "un café" en "1 kg
   * de café", que es una cantidad que nadie pidió — o peor, pregunta cuánto
   * quiere gastar la persona que acaba de decir cuánto quiere gastar.
   */
  anchor?: "quantity" | "budget";
  /** Solo con `anchor: "budget"`: cuánta plata para ESTE ítem. */
  itemBudgetArs?: number | null;
  /**
   * La cantidad no la pidió el humano: la puso el brief de búsqueda para poder
   * cotizar algo. Solo puede aparecer en pedidos que NO son órdenes de compra.
   * Si esto es true, lo que salga de acá es una referencia, no un carrito.
   */
  isReference?: boolean;
}

/**
 * Qué prioriza el humano cuando hay varias opciones que cumplen.
 *
 * `economica` es el default y es lo que hacía el agente siempre: el menor costo
 * total para cubrir la necesidad.
 *
 * `premium` no ordena por precio al revés —eso sería comprar caro por comprar
 * caro—. Descarta primero las marcas propias del supermercado, que son el
 * escalón económico declarado, y entre las que quedan sigue eligiendo la más
 * barata. Es un proxy y hay que decirlo: no tenemos datos de calidad, tenemos
 * marca y precio.
 */
export type QualityPreference = "economica" | "equilibrada" | "premium";

export interface IntentConstraints {
  qualityPreference: QualityPreference;
  /** Techo total de la compra. null = no lo dijo (y hay que preguntar). */
  budgetArs: number | null;
  allowedCategories: Category[];
  forbiddenCategories: Category[];
  /** Allowlist de proveedores. null = cualquiera del marketplace. */
  allowedSuppliers: string[] | null;
  maxDeliveryDays: number | null;
}

export interface PurchaseIntent {
  intentId: string;
  /**
   * El prompt original, textual y sin reformular. AP2 lo exige y es lo que el
   * humano reconoce en su registro. Se conserva junto a `brief`, no en lugar
   * de él: en una disputa importan los dos —lo que se dijo y cómo se entendió—
   * y si difieren, esa diferencia es la evidencia.
   */
  naturalLanguageDescription: string;
  /** El pedido reformulado. Derivado de esta misma estructura, nunca inferido. */
  brief: OrderBrief;
  needs: NeedSpec[];
  constraints: IntentConstraints;
  /** ISO date. null = sin vencimiento explícito. */
  intentExpiry: string | null;
  /** Si el humano tiene que confirmar el carrito antes de pagar. */
  userCartConfirmationRequired: boolean;
}

export interface ClarificationQuestion {
  /** Qué campo del intent quedó indefinido: "constraints.budgetArs", "needs[0].qty" */
  field: string;
  question: string;
  /** Opciones concretas cuando aplica, para que el humano elija en vez de redactar. */
  options?: string[];
}

/**
 * Resultado de leer el prompt. Son dos caminos y solo dos: o entendimos, o
 * preguntamos. No existe un tercero donde el agente completa con defaults —
 * ahí es donde nacen las compras que nadie autorizó.
 */
export type IntentExtraction =
  | { status: "ok"; intent: PurchaseIntent }
  | {
      status: "clarification_needed";
      questions: ClarificationQuestion[];
      /** Lo que sí se pudo extraer, para no repreguntar todo. */
      partial: Partial<PurchaseIntent>;
    };
