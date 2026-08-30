/**
 * Reformulación del pedido, en dos sabores según qué tan comprometido esté.
 *
 * La asimetría es deliberada y va al revés de lo intuitivo:
 *
 *   committed   → ficha DETERMINÍSTICA, generada desde el intent ya validado.
 *                 Cero creatividad. Acá una invención cuesta plata.
 *   exploratory → brief CON MODELO, que puede expandir un pedido incompleto
 *                 hasta algo buscable. Acá inventar de más solo cuesta una
 *                 sugerencia que nadie pidió.
 *
 * Dicho de otra forma: el modelo tiene permitido imaginar exactamente donde no
 * hay una tarjeta del otro lado.
 */

import { z } from "zod";
import type {
  NeedSpec,
  OrderBrief,
  PurchaseIntent,
  SearchBrief,
  Unit,
} from "@/contracts/index.js";
import type { LlmClient } from "@/llm/index.js";

import { ars } from "@/money.js";

function describeNeed(n: NeedSpec): string {
  const attrs = Object.entries(n.attrs);
  const detalle = attrs.length > 0 ? ` (${attrs.map(([k, v]) => `${k}: ${v}`).join(", ")})` : "";
  const ref = n.isReference === true ? " [reference quantity]" : "";
  return `${n.qty} ${n.unit} of ${n.canonical}${detalle}${ref}`;
}

// ---------------------------------------------------------------------------
// Ficha de pedido (committed)
// ---------------------------------------------------------------------------

/**
 * Reformula el pedido a partir del intent validado.
 *
 * Ninguna rama de esta función puede introducir un dato: todo lo que escribe
 * sale de un campo de `intent`. Cuando un campo es null, lo dice — no lo llena.
 */
export function buildOrderBrief(intent: Omit<PurchaseIntent, "brief" | "intentId">): OrderBrief {
  const c = intent.constraints;
  const lines: { label: string; value: string }[] = [];
  const unspecified: string[] = [];

  lines.push({
    label: "What",
    value: intent.needs.length > 0 ? intent.needs.map(describeNeed).join(" · ") : "—",
  });

  if (c.budgetArs !== null) lines.push({ label: "Spending cap", value: ars(c.budgetArs) });
  else unspecified.push("budget");

  if (c.maxDeliveryDays !== null) {
    lines.push({ label: "By when", value: `delivered within ${c.maxDeliveryDays} day(s)` });
  } else {
    unspecified.push("delivery window");
  }

  const conSustitutos = intent.needs.filter((n) => n.substitutesAllowed).map((n) => n.canonical);
  lines.push({
    label: "Substitutes",
    value:
      conSustitutos.length === 0
        ? "not accepted"
        : conSustitutos.length === intent.needs.length
          ? "accepted"
          : `accepted only for ${conSustitutos.join(", ")}`,
  });

  if (c.allowedSuppliers !== null) {
    lines.push({ label: "Suppliers", value: c.allowedSuppliers.join(", ") });
  } else {
    lines.push({ label: "Suppliers", value: "any the mandate allows" });
  }

  if (c.forbiddenCategories.length > 0) {
    lines.push({ label: "Forbidden", value: c.forbiddenCategories.join(", ") });
  }

  if (intent.intentExpiry !== null) {
    lines.push({ label: "Request valid until", value: intent.intentExpiry });
  } else {
    unspecified.push("request validity");
  }

  const text =
    lines.map((l) => `${l.label}: ${l.value}`).join(". ") +
    (unspecified.length > 0 ? `. Unspecified: ${unspecified.join(", ")}.` : ".");

  return { text, lines, unspecified };
}

// ---------------------------------------------------------------------------
// Brief de búsqueda (exploratory / conditional)
// ---------------------------------------------------------------------------

const UNITS = ["L", "kg", "unit"] as const satisfies readonly Unit[];

const RawSearchBrief = z.object({
  rationale: z.string(),
  items: z.array(
    z.object({
      canonical: z.string(),
      attrs: z.array(z.object({ key: z.string(), value: z.string() })),
      reference_qty: z.number(),
      unit: z.enum(UNITS),
    }),
  ),
});

const SEARCH_BRIEF_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["rationale", "items"],
  properties: {
    rationale: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["canonical", "attrs", "reference_qty", "unit"],
        properties: {
          canonical: { type: "string" },
          attrs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: { key: { type: "string" }, value: { type: "string" } },
            },
          },
          reference_qty: { type: "number" },
          unit: { type: "string", enum: [...UNITS] },
        },
      },
    },
  },
};

const SEARCH_BRIEF_SYSTEM = `You are the search module of a purchasing agent that buys supplies for a food business in Argentina.

You receive a query from the human that is NOT a purchase order: they are asking, comparing or browsing. Your task is to decide what to search for in the catalog so the agent can answer with concrete prices.

NOTHING will be bought with this. It is a reference quote.

Rules:
1. Return the items to search for, with a generic canonical name, lowercase and singular. It must be written in SPANISH, because it is matched against an Argentine catalog: "detergente", "leche", "arroz". Translate the English word the human used into the Spanish term an Argentine shopper would use (rice -> "arroz", bleach -> "lavandina", napkins -> "servilletas"). Variants go in attrs, also in Spanish.
2. reference_qty is a TYPICAL weekly restocking quantity for a small food business, chosen only so a quote is possible. If the human gave a quantity, use that one. If not, pick a reasonable one and explain it in rationale.
3. If the query mentions a broad area ("cleaning supplies", "stuff for breakfast"), break it down into 2 to 4 concrete, common items from that area.
4. Do not invent brands or suppliers.
5. rationale: one or two sentences, in English, explaining what you are going to search for and where the reference quantities came from.
6. If the query does not allow deducing any product, return an empty items list.`;

/**
 * Decide qué buscar para una consulta que no es una orden de compra.
 *
 * Devuelve el brief y las necesidades marcadas con `isReference`, para que
 * nadie confunda una cantidad que eligió el modelo con una que pidió el humano.
 */
export async function buildSearchBrief(
  intent: PurchaseIntent,
  llm: LlmClient,
): Promise<{ brief: SearchBrief; needs: NeedSpec[] }> {
  const parsed = RawSearchBrief.parse(
    await llm.json<unknown>({
      op: "search_brief",
      system: SEARCH_BRIEF_SYSTEM,
      user: intent.naturalLanguageDescription,
      schema: { name: "search_brief", schema: SEARCH_BRIEF_SCHEMA },
    }),
  );

  const needs: NeedSpec[] = parsed.items.map((item) => {
    const attrs: Record<string, string> = {};
    for (const p of item.attrs) attrs[p.key] = p.value;
    return {
      canonical: item.canonical.trim().toLowerCase(),
      attrs,
      // Una cantidad de referencia de 0 no cotiza nada: el piso es 1.
      qty: item.reference_qty > 0 ? item.reference_qty : 1,
      unit: item.unit,
      substitutesAllowed: false,
      isReference: true,
    };
  });

  const brief: SearchBrief = {
    text:
      needs.length > 0
        ? `Searching ${needs.map(describeNeed).join(" · ")}`
        : "Could not work out what to search for.",
    rationale: parsed.rationale,
  };

  return { brief, needs };
}

/**
 * Las necesidades con las que hay que salir a buscar en el modo sugerencia.
 *
 * Si el humano ya dijo qué y cuánto, se usa eso tal cual: el brief es para
 * completar lo que falta, no para reinterpretar lo que ya está claro.
 */
export async function resolveSearchNeeds(
  intent: PurchaseIntent,
  llm: LlmClient,
): Promise<{ brief: SearchBrief | null; needs: NeedSpec[] }> {
  const completo =
    intent.needs.length > 0 && intent.needs.every((n) => Number.isFinite(n.qty) && n.qty > 0);

  if (completo) return { brief: null, needs: intent.needs };

  return buildSearchBrief(intent, llm);
}
