/**
 * Reformulación del pedido para confirmación y auditoría.
 * Generada desde el intent ya validado: cero creatividad, cero inventos.
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

const ars = (n: number) => `$${n.toLocaleString("es-AR")}`;

function describeNeed(n: NeedSpec): string {
  const attrs = Object.entries(n.attrs);
  const detalle = attrs.length > 0 ? ` (${attrs.map(([k, v]) => `${k}: ${v}`).join(", ")})` : "";
  const ref = n.isReference === true ? " [cantidad de referencia]" : "";
  return `${n.qty} ${n.unit} de ${n.canonical}${detalle}${ref}`;
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
    label: "Qué",
    value: intent.needs.length > 0 ? intent.needs.map(describeNeed).join(" · ") : "—",
  });

  if (c.budgetArs !== null) lines.push({ label: "Techo de gasto", value: ars(c.budgetArs) });
  else unspecified.push("presupuesto");

  if (c.maxDeliveryDays !== null) {
    lines.push({ label: "Para cuándo", value: `entrega en hasta ${c.maxDeliveryDays} día(s)` });
  } else {
    unspecified.push("plazo de entrega");
  }

  const conSustitutos = intent.needs.filter((n) => n.substitutesAllowed).map((n) => n.canonical);
  lines.push({
    label: "Sustitutos",
    value:
      conSustitutos.length === 0
        ? "no se aceptan"
        : conSustitutos.length === intent.needs.length
          ? "se aceptan"
          : `se aceptan solo para ${conSustitutos.join(", ")}`,
  });

  if (c.allowedSuppliers !== null) {
    lines.push({ label: "Proveedores", value: c.allowedSuppliers.join(", ") });
  } else {
    lines.push({ label: "Proveedores", value: "cualquiera de los que habilite el mandato" });
  }

  if (c.forbiddenCategories.length > 0) {
    lines.push({ label: "Prohibido", value: c.forbiddenCategories.join(", ") });
  }

  if (intent.intentExpiry !== null) {
    lines.push({ label: "Pedido vigente hasta", value: intent.intentExpiry });
  } else {
    unspecified.push("vigencia del pedido");
  }

  const text =
    lines.map((l) => `${l.label}: ${l.value}`).join(". ") +
    (unspecified.length > 0 ? `. Sin especificar: ${unspecified.join(", ")}.` : ".");

  return { text, lines, unspecified };
}

// ---------------------------------------------------------------------------
// Brief de búsqueda (modo sugerencia sin mandato)
// ---------------------------------------------------------------------------

const UNITS = ["L", "kg", "unidad"] as const satisfies readonly Unit[];

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

const SEARCH_BRIEF_SYSTEM = `Sos el módulo de búsqueda de un agente de compras de insumos para un comercio gastronómico en Argentina.

Recibís una consulta del humano que NO es una orden de compra: está preguntando, comparando o explorando. Tu tarea es decidir qué buscar en el catálogo para poder contestarle con precios concretos.

NO se va a comprar nada con esto. Es una cotización de referencia.

Reglas:
1. Devolvé los ítems que hay que buscar, con nombre canónico genérico en minúsculas y singular: "detergente", "leche", "arroz". Las variantes van en attrs.
2. reference_qty es una cantidad TÍPICA de reposición semanal para un comercio gastronómico chico, elegida solo para poder cotizar. Si el humano dio una cantidad, usá esa. Si no, elegí una razonable y explicala en rationale.
3. Si la consulta menciona un rubro amplio ("insumos de limpieza", "cosas para el desayuno"), desglosalo en 2 a 4 ítems concretos y frecuentes de ese rubro.
4. No inventes marcas ni proveedores.
5. rationale: una o dos oraciones, en español, explicando qué vas a buscar y de dónde salieron las cantidades de referencia.
6. Si la consulta no permite deducir ningún producto, devolvé items vacío.`;

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
        ? `Buscando ${needs.map(describeNeed).join(" · ")}`
        : "No se pudo deducir qué buscar.",
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
