/**
 * El run completo: prompt → intent → (comprar | sugerir).
 *
 * La única bifurcación: ¿hay mandato firmado?
 *   - No → sugerir. El agente busca y compara, pero no puede gastar.
 *   - Sí → decide. El policy engine verifica límites y emite el carrito.
 *
 * Termina en un `CartDraft` (compra) o en una `Suggestion` (sin mandato), y
 * ahí se corta nuestra frontera: el cobro es del equipo de pagos.
 */

import type {
  AuditEvent,
  DecisionOutcome,
  IntentExtraction,
  Suggestion,
} from "@/contracts/index.js";
import type { LlmClient } from "@/llm/index.js";
import type { AgentContext } from "./context.js";
import { extractIntent } from "./intent.js";
import { decide, suggest, type DecideDeps } from "./decide.js";

export interface RunResult {
  runId: string;
  extraction: IntentExtraction;
  /** Presente solo si el agente llegó a decidir una compra. */
  outcome: DecisionOutcome | null;
  /** Presente cuando el agente buscó y comparó pero no compró. */
  suggestion: Suggestion | null;
  events: readonly AuditEvent[];
}

export interface RunDeps extends DecideDeps {
  llm: LlmClient;
}

const NO_MANDATE_DETAIL =
  "No hay ningún mandato firmado para esta cuenta. El agente puede buscar y comparar, pero no puede comprar hasta que firmes el mandato de abajo.";

export async function runAgent(
  prompt: string,
  /** `null` = el humano todavía no firmó ningún mandato. */
  mandateId: string | null,
  deps: RunDeps,
  ctx: AgentContext,
): Promise<RunResult> {
  ctx.audit.emit({ type: "run_started", mandateId: mandateId ?? "(sin mandato)", prompt });

  const extraction = await extractIntent(prompt, deps.llm, ctx);
  if (extraction.status === "clarification_needed") {
    ctx.audit.emit({ type: "outcome_emitted", outcome: "clarification" });
    return { runId: ctx.runId, extraction, outcome: null, suggestion: null, events: ctx.audit.events() };
  }

  const intent = extraction.intent;
  const done = (outcome: DecisionOutcome | null, suggestion: Suggestion | null): RunResult => ({
    runId: ctx.runId,
    extraction,
    outcome,
    suggestion,
    events: ctx.audit.events(),
  });

  // Sin mandato firmado no hay compra posible: el agente busca y sugiere.
  if (mandateId === null) {
    return done(null, await suggest(intent, null, "no_mandate", NO_MANDATE_DETAIL, deps, ctx));
  }

  // Con mandato firmado, decide el policy engine. No leemos el mandato acá:
  // `decide()` lo lee dos veces por su cuenta y una lectura extra sería un
  // estado más viejo sin ninguna garantía adicional.
  return done(await decide(intent, mandateId, deps, ctx), null);
}
