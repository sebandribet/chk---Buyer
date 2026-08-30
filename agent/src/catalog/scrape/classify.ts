/**
 * Clasificación de resultados crudos, con el modelo de NVIDIA.
 *
 * El buscador de una tienda es full-text: buscar "cafe" devuelve cafeteras,
 * filtros y cápsulas. Decidir si "Café Molido Descafeinado 250g" cuenta como
 * "cafe" para un comercio gastronómico es una pregunta semántica, y ahí un
 * modelo sirve.
 *
 * LO QUE EL MODELO NO PUEDE TOCAR: el precio, el tamaño y el stock. No están en
 * el schema de salida, así que no es una regla de estilo — es imposible por
 * construcción. Esos tres salen del JSON de la tienda y del parser
 * determinístico, y son exactamente los tres con los que el agente después
 * decide gastar plata.
 */

import { z } from "zod";
import type { LlmClient } from "@/llm/index.js";

const Classification = z.object({
  items: z.array(
    z.object({
      index: z.number(),
      relevant: z.boolean(),
      attrs: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  ),
});

const SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "relevant", "attrs"],
        properties: {
          index: { type: "number" },
          relevant: { type: "boolean" },
          attrs: {
            type: "array",
            items: {
              type: "object",
              required: ["key", "value"],
              properties: { key: { type: "string" }, value: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You classify search results from an Argentine supermarket for an agent that buys supplies for a food business.

The product names are in Spanish. Read them as they are — do not translate them.

I give you a search term and a numbered list of product names. For each one you decide:

- relevant: true if the product IS the supply being searched for. false if it is an accessory, an appliance, a spare part, or a product from another category that showed up on a text match. Searching "cafe": ground coffee is relevant; a coffee maker, a filter, a mug or capsules for some other machine are NOT.
- attrs: the attributes that distinguish variants of the same product. They MUST be written in Spanish, lowercase and without accents — they are compared against the attributes extracted from the request, which are also in Spanish. Use the key "tipo" for the main variant.
    "Café Molido Descafeinado" -> [{"key":"tipo","value":"descafeinado"}]
    "Leche Entera"             -> [{"key":"tipo","value":"entera"}]
    "Arroz Largo Fino"         -> [{"key":"tipo","value":"largo fino"}]
  If there is no clear variant, return empty attrs. Do not invent attributes.

Return one item for every index you received, with the same index.

Do not comment on price, size or stock: I do not give them to you and they are not part of your answer.`;

export interface ClassifiedItem {
  relevant: boolean;
  attrs: Record<string, string>;
}

/**
 * Clasifica una tanda de nombres. Si el modelo falla o devuelve algo inválido,
 * se acepta todo con atributos vacíos: el scraping no puede depender de que un
 * modelo esté disponible, y un producto de más solo agrega ruido al catálogo,
 * mientras que un precio de más agregaría una mentira.
 */
export async function classifyProducts(
  canonical: string,
  names: string[],
  llm: LlmClient,
): Promise<ClassifiedItem[]> {
  const fallback = (): ClassifiedItem[] => names.map(() => ({ relevant: true, attrs: {} }));

  if (names.length === 0) return [];

  try {
    const user =
      `Término buscado: "${canonical}"\n\nProductos:\n` +
      names.map((n, i) => `${i}. ${n}`).join("\n");

    const parsed = Classification.parse(
      await llm.json<unknown>({
        op: "product_classification",
        system: SYSTEM,
        user,
        schema: { name: "product_classification", schema: SCHEMA },
      }),
    );

    const out = fallback();
    for (const item of parsed.items) {
      if (item.index < 0 || item.index >= names.length) continue;
      const attrs: Record<string, string> = {};
      for (const a of item.attrs) attrs[a.key.trim().toLowerCase()] = a.value.trim().toLowerCase();
      out[item.index] = { relevant: item.relevant, attrs };
    }
    return out;
  } catch {
    return fallback();
  }
}
