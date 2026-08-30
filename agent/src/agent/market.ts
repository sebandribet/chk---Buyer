/**
 * E3 · Discovery contra tiendas reales.
 *
 * El catálogo dejó de ser una lista nuestra. El agente sale a buscar lo que el
 * humano pidió en los buscadores públicos de tiendas que existen, y el precio
 * que termina en el mandato es un precio que alguien está cobrando hoy.
 *
 * El modelo interviene en dos puntos y en ninguno toca plata:
 *
 *   1. `planStoreQuery` — traduce la necesidad a un término de búsqueda. El
 *      humano dice "something to sit on" y la tienda entiende "silla". Sin este
 *      paso el buscador no devuelve nada y el agente parece roto cuando en
 *      realidad no supo preguntar.
 *
 *   2. `pickRelevant` — de lo que devolvió la tienda, cuál es de verdad lo que
 *      se pidió. El buscador de una tienda no sabe qué necesitamos: pedir
 *      "silla" trae sillas de camping, fundas de silla y sillas para bebé.
 *      Comprar eso sería tan malo como no comprar nada.
 *
 * Lo que el modelo NO hace, y por eso el precio es defendible: no lee, no
 * ajusta y no propone ningún precio. Los precios salen del JSON de la tienda,
 * el más barato lo elige el código, y los topes del mandato se evalúan después
 * sobre ese número. Un modelo convencido de que la silla cuesta otra cosa no
 * tiene por dónde decirlo.
 */

import { z } from "zod";
import type { LlmClient } from "@/llm/index.js";
import type { AgentContext } from "./context.js";
import type { OfficeNeed } from "./office.js";

/** Lo que un resultado de tienda puede mostrarle al modelo. */
export interface StoreCandidate {
  /** Índice en la lista original. Es lo único que el modelo devuelve. */
  index: number;
  title: string;
  brand: string;
}

export interface StoreQueryPlan {
  /** Término tal como se le manda al buscador de la tienda. */
  query: string;
  /** Nombre legible del rubro, para mostrarle al humano. */
  label: string;
}

const PlanShape = z.object({ query: z.string(), label: z.string() });

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["query", "label"],
  properties: {
    query: { type: "string" },
    label: { type: "string" },
  },
};

const PLAN_SYSTEM = `You turn a buyer's need into a search term for an Argentine online store's search box.

The stores are Argentine and their catalogs are in Spanish. The need arrives in English.

Rules:
- query: two or three words in Spanish, the words a shopper would actually type. "office chair" becomes "silla oficina". "27-inch monitor" becomes "monitor". Do not include brands, sizes, colours or prices unless the buyer named them.
- Prefer the general term over the specific one. A search that returns many results the next step can filter beats a search that returns nothing.
- label: a short English name for what is being bought, for showing to the buyer. "Office chair", "Monitor", "Mechanical keyboard".
- Never invent a product the buyer did not ask for.`;

export async function planStoreQuery(
  need: OfficeNeed,
  llm: LlmClient,
  ctx: AgentContext,
): Promise<StoreQueryPlan> {
  const described = [need.canonical, ...Object.values(need.attrs)].join(" ").trim();
  const plan = PlanShape.parse(
    await llm.json<unknown>({
      op: "store_query_planning",
      system: PLAN_SYSTEM,
      user: JSON.stringify({ need: described, excludes: need.excludes }),
      schema: { name: "store_query", schema: PLAN_SCHEMA },
    }),
  );

  const query = plan.query.trim() || need.canonical;
  ctx.audit.emit({
    type: "catalog_target_planned",
    canonical: need.canonical,
    category: "office",
    query,
  });
  return { query, label: plan.label.trim() || need.canonical };
}

const RelevanceShape = z.object({ index: z.number(), reason: z.string() });

function relevanceSchema(indexes: readonly number[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["index", "reason"],
    properties: {
      // -1 es "ninguno sirve". Va en el enum para que el modelo no pueda
      // devolver un índice que no exista.
      index: { type: "integer", enum: [...indexes, -1] },
      reason: { type: "string" },
    },
  };
}

const RELEVANCE_SYSTEM = `You are the relevance filter of a purchasing agent. A store search returned these results for a buyer's request. Say which single result is genuinely the thing the buyer asked for.

Rules:
- Judge ONLY whether the item is the requested kind of product. Do not consider price, brand quality, or the seller: another module handles all of those, after you.
- The store's search engine is not careful. Asking for a chair returns camping chairs, chair covers, high chairs and replacement wheels. None of those is an office chair.
- An accessory, a spare part, a cover or a case for the product is NOT the product.
- If the buyer ruled something out, never pick it.
- If nothing in the list is genuinely the requested product, answer index -1. Buying the wrong thing is worse than buying nothing.
- reason: one short sentence.`;

/**
 * Cuál de los resultados de la tienda es realmente lo que se pidió.
 *
 * Devuelve `null` cuando ninguno sirve, y eso es una respuesta correcta y
 * frecuente: buscar "silla" en un supermercado trae mayoría de cosas que no
 * son una silla de escritorio.
 */
export async function pickRelevant(
  need: OfficeNeed,
  candidates: readonly StoreCandidate[],
  llm: LlmClient,
  ctx: AgentContext,
): Promise<{ index: number | null; reason: string }> {
  if (candidates.length === 0) return { index: null, reason: "The store returned no results." };

  const verdict = RelevanceShape.parse(
    await llm.json<unknown>({
      op: "store_result_relevance",
      system: RELEVANCE_SYSTEM,
      user: JSON.stringify({
        requested: { need: need.canonical, attrs: need.attrs, excludes: need.excludes },
        results: candidates.map(({ index, title, brand }) => ({ index, title, brand })),
      }),
      schema: { name: "store_relevance", schema: relevanceSchema(candidates.map((c) => c.index)) },
    }),
  );

  const chosen = candidates.some((candidate) => candidate.index === verdict.index)
    ? verdict.index
    : null;

  ctx.audit.emit({
    type: "substitution_evaluated",
    canonical: need.canonical,
    sku: chosen === null ? "(none)" : String(chosen),
    accepted: chosen !== null,
    decidedBy: "llm",
    detail: String(verdict.reason ?? "").slice(0, 240),
  });

  return { index: chosen, reason: String(verdict.reason ?? "") };
}
