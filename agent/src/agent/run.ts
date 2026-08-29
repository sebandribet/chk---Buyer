/**
 * El run completo: prompt → intent → (comprar | sugerir).
 *
 * Acá vive el gate de compromiso, y conviene leer el orden de los chequeos con
 * atención porque es donde se sostiene la garantía:
 *
 *   1. ¿Hay mandato firmado?      si no → sugerir. El compromiso no se consulta.
 *   2. ¿El pedido es una orden?   si no → sugerir.
 *   3. ¿El mandato lo permite?    lo decide `decide()`, en código.
 *
 * El paso 2 solo puede convertir un "sí" del paso 1 en un "no". Nunca al revés:
 * no existe camino por el que un pedido muy comprometido llegue a comprar sin
 * mandato. Por eso el paso 1 va primero y ni siquiera mira el compromiso.
 *
 * Termina en un `CartDraft` (compra) o en una `Suggestion` (todo lo demás), y
 * ahí se corta nuestra frontera: el cobro es del equipo de pagos.
 */

import type {
  AuditEvent,
  DecisionOutcome,
  IntentExtraction,
  MandateState,
  PurchaseIntent,
  Suggestion,
  SuggestionReason,
} from "@/contracts/index.js";
import { isUsable } from "@/contracts/index.js";
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

/** Motivo por el que se sugiere en vez de comprar, en el idioma del humano. */
function suggestionDetail(reason: SuggestionReason, intent: PurchaseIntent): string {
  switch (reason) {
    case "no_mandate":
      return "No hay ningún mandato firmado para esta cuenta. El agente puede buscar y comparar, pero no puede comprar hasta que firmes el mandato de abajo.";
    case "mandate_unusable":
      return "El mandato existe pero no está vigente (revocado, vencido o inactivo). Esto es lo que compraría si lo reactivaras.";
    case "exploratory_request":
      return `El pedido se leyó como una consulta, no como una orden de compra: "${intent.naturalLanguageDescription}". Si querés que lo compre, pedímelo de forma directa.`;
    case "conditional_request":
      return `El pedido depende de una condición que todavía no se cumplió: "${intent.naturalLanguageDescription}". Esto es lo que compraría hoy si la condición se diera.`;
  }
}

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

  // Paso 1. Sin mandato firmado no hay compra posible, y el nivel de
  // compromiso es irrelevante: no se consulta ni se registra como habilitante.
  if (mandateId === null) {
    ctx.audit.emit({
      type: "commitment_assessed",
      level: intent.commitment,
      executes: false,
      detail: "No hay mandato firmado. El compromiso del pedido no puede sustituirlo.",
    });
    const detail = suggestionDetail("no_mandate", intent);
    return done(null, await suggest(intent, null, "no_mandate", detail, deps, ctx));
  }

  // Paso 2. Hay mandato y el pedido es una orden concreta: el gate lo deja
  // pasar y decide el policy engine.
  //
  // No leemos el mandato acá a propósito. `decide()` lo lee dos veces por su
  // cuenta —antes de buscar y antes de proponer— y una lectura extra en este
  // punto no agregaría ninguna garantía: sería un estado más viejo que el que
  // `decide()` va a leer igual. En una chain, además, cada lectura es una
  // llamada RPC, y el camino de compra tiene que quedar en dos.
  if (intent.commitment === "committed") {
    ctx.audit.emit({
      type: "commitment_assessed",
      level: intent.commitment,
      executes: true,
      detail: "Orden de compra concreta. El gate de compromiso la deja pasar al motor de decisión.",
    });
    return done(await decide(intent, mandateId, deps, ctx), null);
  }

  // Paso 3. El pedido no es una orden. Leemos el mandato una vez, solo para
  // acotar la sugerencia a lo que ya permitía.
  const state: MandateState = await deps.mandates.read(mandateId);
  ctx.audit.emit({ type: "mandate_read", phase: "pre_search", state });
  const usable = isUsable(state, ctx.clock.now());

  const reason: SuggestionReason = !usable.usable
    ? "mandate_unusable"
    : intent.commitment === "exploratory"
      ? "exploratory_request"
      : "conditional_request";

  ctx.audit.emit({
    type: "commitment_assessed",
    level: intent.commitment,
    executes: false,
    detail: `El pedido es "${intent.commitment}": se busca y se compara, no se compra.`,
  });

  // Un mandato caído no acota nada: se sugiere como si no existiera.
  const detail = suggestionDetail(reason, intent);
  return done(null, await suggest(intent, usable.usable ? state : null, reason, detail, deps, ctx));
}
