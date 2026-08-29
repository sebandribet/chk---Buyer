/**
 * El trail auditable.
 *
 * Es la única salida que el agente produce además del carrito, y es la que
 * consume la UI. Regla del módulo: si una decisión no emitió evento, no pasó.
 * Un humano, el merchant y un auditor tienen que poder reconstruir el run
 * completo leyendo solo esta lista.
 */

import type { RejectedCandidate, RejectionReason, DecisionOutcome } from "./decision.js";
import type { PurchaseIntent, ClarificationQuestion, NeedSpec } from "./intent.js";
import type { MandateState } from "./mandate.js";

export interface AuditEventBase {
  runId: string;
  /** ISO, del reloj inyectado — no de `Date.now()`, para que los runs sean reproducibles. */
  at: string;
  seq: number;
}

export type AuditEvent = AuditEventBase &
  (
    | { type: "run_started"; mandateId: string; prompt: string }
    | { type: "intent_extracted"; intent: PurchaseIntent }
    /**
     * La lectura del nivel de compromiso y qué habilitó.
     *
     * `executes: true` significa solo que este gate dejó pasar el pedido al
     * motor de decisión — no que se haya comprado. El mandato todavía puede
     * rechazarlo, y de hecho es lo que pasa si está revocado o vencido.
     * `executes: false` sí es definitivo: no hubo compra.
     */
    | {
        type: "commitment_assessed";
        level: PurchaseIntent["commitment"];
        executes: boolean;
        detail: string;
      }
    | { type: "clarification_requested"; questions: ClarificationQuestion[] }
    /** Cada lectura del mandato queda registrada: es la prueba de que no se cacheó. */
    | { type: "mandate_read"; phase: "pre_search" | "pre_proposal"; state: MandateState }
    /**
     * Las necesidades no venían del humano: las dedujo el brief de búsqueda.
     * Solo puede aparecer en runs que no compran, y queda registrado para que
     * nadie confunda una cantidad de referencia con una que alguien pidió.
     */
    | { type: "search_brief_built"; text: string; rationale: string; needs: NeedSpec[] }
    /**
     * Movimientos del catálogo. Importan en la traza porque cambian de dónde
     * salieron los precios con los que se decidió: no es lo mismo comparar
     * contra datos de ayer que contra datos bajados hace un segundo, y un
     * auditor tiene que poder ver cuál de las dos cosas pasó.
     */
    | { type: "catalog_stale"; canonical: string; offers: number }
    | { type: "catalog_target_planned"; canonical: string; category: string; query: string }
    | {
        type: "catalog_fetched_live";
        canonical: string;
        category: string;
        products: number;
        ms: number;
      }
    /** La búsqueda en vivo falló o tardó de más. El run siguió con lo que había. */
    | { type: "catalog_fetch_failed"; canonical: string; detail: string }
    | { type: "search_executed"; canonical: string; filters: Record<string, unknown>; resultCount: number }
    | {
        type: "candidate_scored";
        canonical: string;
        sku: string;
        supplierId: string;
        unitPriceArs: number;
        score: number;
        kind: "exact" | "substitute";
      }
    | { type: "candidate_rejected"; canonical: string; rejected: RejectedCandidate }
    | {
        type: "substitution_evaluated";
        canonical: string;
        sku: string;
        accepted: boolean;
        /** `policy` = lo resolvió código. `llm` = hubo juicio de un modelo, y queda marcado como tal. */
        decidedBy: "policy" | "llm";
        detail: string;
      }
    /**
     * Un producto del catálogo intentó darle instrucciones al agente.
     * Se registra explícitamente: es evidencia para el jurado de que el texto
     * del vendedor se trata como dato hostil y no como orden.
     */
    | { type: "injection_attempt_detected"; sku: string; supplierId: string; snippet: string }
    | { type: "policy_check"; check: string; passed: boolean; detail: string }
    /**
     * `clarification` y `suggestion` no son `DecisionOutcome`: en ninguno de los
     * dos el agente llegó a decidir una compra.
     */
    | {
        type: "outcome_emitted";
        outcome: DecisionOutcome["status"] | "clarification" | "suggestion";
        reason?: RejectionReason | string;
      }
  );

/**
 * `Omit` sobre una unión la colapsa a las claves comunes de todas sus ramas, y
 * `AuditEvent` no tiene ninguna propia en común: el resultado sería un objeto
 * vacío que rechaza todos los campos. Este condicional distribuye el `Omit`
 * rama por rama y preserva la unión.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Un evento tal como lo emite el agente: sin los campos que completa el log. */
export type AuditEventInput = DistributiveOmit<AuditEvent, "runId" | "at" | "seq">;

export interface AuditLog {
  emit(event: AuditEventInput): void;
  events(): readonly AuditEvent[];
}
