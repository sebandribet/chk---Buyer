/**
 * El puente entre la demo y el agente de `agent/`.
 *
 * Reemplaza a `marketplaceAgent.js`, que era una llamada suelta a ChatGPT
 * pidiéndole que eligiera un `product_id` de una lista. La diferencia que
 * importa no es de código sino de quién decide qué:
 *
 *   antes   prompt ──> modelo ──> product_id + cantidad + presupuesto
 *                                 (y si faltaba el presupuesto, lo inventaba
 *                                  el servidor con el precio más caro × qty)
 *
 *   ahora   prompt ──> agente ──> necesidad tipada + nivel de compromiso
 *                        │        (sin id, sin vendedor, sin precio)
 *                        └──────> preguntas, si falta algo para gastar
 *                   código ─────> resuelve la necesidad contra el catálogo
 *
 * El modelo nunca ve un id de producto ni lo devuelve. Qué producto satisface
 * la necesidad lo decide `resolveNeed`, que es código determinístico del
 * servidor. Un modelo convencido de que el humano quiere el escritorio de
 * US$549 no puede colarlo: solo puede describir "desk", y el catálogo hace
 * el resto.
 */

import { OpenAiClient } from "../agent/src/llm/openai.ts";
import { createContext, SystemClock } from "../agent/src/agent/context.ts";
import {
  extractOfficeIntent,
  isExcluded,
  judgeSubstitute,
  summarize,
} from "../agent/src/agent/office.ts";

/** Cuántos turnos de conversación se le pasan al agente. */
const CONVERSATION_WINDOW = 10;

function agentConfigured() {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.MARKETPLACE_AGENT_MODE !== "fallback";
}

/**
 * La conversación entera como un solo mensaje.
 *
 * El agente extrae sobre el pedido ACUMULADO, no sobre el último mensaje: por
 * eso "que sean 4" tiene que llegarle junto con el turno que dijo qué eran.
 */
function transcript(conversation, prompt) {
  const turns = (conversation ?? [])
    .slice(-CONVERSATION_WINDOW)
    .map(({ role, content }) => `${role === "user" ? "Buyer" : "Agent"}: ${content}`);
  return [...turns, `Buyer: ${String(prompt).trim()}`].join("\n");
}

/**
 * Corre el agente sobre el pedido y devuelve lo que la demo necesita.
 *
 * Nunca lanza: un fallo del modelo es un estado del demo, no una excepción.
 * `result === null` con `mode !== "catalog fallback"` significa que el agente
 * no pudo correr — y en ese caso no se crea ningún borrador, porque un
 * borrador sin extracción sería exactamente el dato inventado que el agente
 * existe para no producir.
 */
export async function askOfficeAgent({ prompt, conversation, resolveNeed, catalog = [] }) {
  if (!agentConfigured()) {
    return { mode: "catalog fallback", model: null, requestId: null, runId: null, result: null };
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  try {
    const ctx = createContext(new SystemClock());
    ctx.audit.emit({ type: "run_started", mandateId: "(draft)", prompt: String(prompt).trim() });

    const extraction = await extractOfficeIntent(
      transcript(conversation, prompt),
      new OpenAiClient(model),
      ctx,
    );

    // El agente pide un dato que falta. No hay borrador: preguntar es la
    // respuesta correcta, no un error ni un paso previo a asumir algo.
    if (extraction.status === "clarification_needed") {
      ctx.audit.emit({ type: "outcome_emitted", outcome: "clarification" });
      return {
        mode: "agent · clarification",
        model,
        requestId: ctx.runId,
        runId: ctx.runId,
        result: {
          status: "clarification_needed",
          commitment: extraction.commitment,
          questions: extraction.questions,
          reply: summarize(extraction),
        },
        events: ctx.audit.events(),
      };
    }

    // La necesidad se resuelve contra el catálogo acá, en código. El modelo
    // no participa de este paso y no vio ningún id en ningún momento.
    const [need] = extraction.needs;
    const excludes = need?.excludes ?? [];
    let product = need ? resolveNeed(need) : null;

    // La exclusión se aplica sobre el resultado, no sobre la búsqueda: el
    // matcher puede haber llegado igual al producto vetado por otro término.
    if (product && isExcluded(product, excludes)) {
      ctx.audit.emit({
        type: "policy_check",
        check: "buyer_exclusion",
        passed: false,
        detail: `${product.name} was ruled out by the buyer (${excludes.join(", ")}).`,
      });
      product = null;
    }

    let resolvedBy = product ? "code" : null;
    ctx.audit.emit({
      type: "search_executed",
      canonical: need?.canonical ?? "(none)",
      filters: { attrs: need?.attrs ?? {}, qty: need?.qty ?? null, budgetUsd: extraction.budgetUsd },
      resultCount: product ? 1 : 0,
    });

    // Segundo intento: el humano pidió con sus palabras ("algo para sentarme",
    // "una banqueta") y el catálogo no tiene esa palabra. El modelo juzga
    // equivalencia sobre una lista cerrada de candidatos — puede señalar uno o
    // decir que ninguno sirve, y nada más.
    if (product === null && need) {
      // Lo excluido no entra siquiera como candidato: no se le da al modelo la
      // oportunidad de proponer lo que el humano ya rechazó.
      const candidates = catalog
        .filter((entry) => !isExcluded(entry, excludes))
        .map(({ id, name, description }) => ({ id, name, description }));

      const verdict = await judgeSubstitute(need, candidates, new OpenAiClient(model), ctx);
      if (verdict.id) {
        const chosen = catalog.find((entry) => entry.id === verdict.id) ?? null;
        // Cinturón y tiradores: el veredicto vuelve a pasar por la exclusión.
        product = chosen && !isExcluded(chosen, excludes) ? chosen : null;
        resolvedBy = product ? "substitution" : null;
      }
    }

    ctx.audit.emit({
      type: "outcome_emitted",
      outcome: product ? "suggestion" : "clarification",
      ...(product ? {} : { reason: "no catalog product satisfies the extracted need" }),
    });

    return {
      mode: "agent · live",
      model,
      requestId: ctx.runId,
      runId: ctx.runId,
      result: {
        status: "ok",
        commitment: extraction.commitment,
        productId: product?.id ?? null,
        resolvedBy,
        excludes,
        canonical: need?.canonical ?? null,
        attrs: need?.attrs ?? {},
        quantity: need?.qty ?? null,
        quantityStated: need?.qty !== null && need?.qty !== undefined,
        budgetUsd: extraction.budgetUsd,
        budgetStated: extraction.budgetUsd !== null,
        maxDeliveryDays: extraction.maxDeliveryDays,
        allowedSuppliers: extraction.allowedSuppliers,
        qualityPreference: extraction.qualityPreference,
        naturalLanguageDescription: extraction.naturalLanguageDescription,
        reply: summarize(extraction),
      },
      events: ctx.audit.events(),
    };
  } catch (error) {
    return {
      mode: "agent unavailable",
      model,
      requestId: null,
      runId: null,
      result: null,
      error: error instanceof Error ? error.message : "The purchasing agent could not complete the request.",
    };
  }
}

export { agentConfigured };
