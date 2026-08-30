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

const SYSTEM = `Clasificás resultados del buscador de un supermercado argentino para un agente que compra insumos de un comercio gastronómico.

Te doy un término buscado y una lista numerada de nombres de productos. Para cada uno decidís:

- relevant: true si el producto ES el insumo buscado. false si es un accesorio, un electrodoméstico, un repuesto o un producto de otra categoría que apareció por coincidencia de texto. Buscando "cafe": el café molido es relevante; una cafetera, un filtro, una taza o unas cápsulas de otra máquina NO lo son.
- attrs: los atributos que distinguen variantes del mismo producto, en minúsculas y sin tildes. Usá la clave "tipo" para la variante principal.
    "Café Molido Descafeinado" → [{"key":"tipo","value":"descafeinado"}]
    "Leche Entera"             → [{"key":"tipo","value":"entera"}]
    "Arroz Largo Fino"         → [{"key":"tipo","value":"largo fino"}]
  Si no hay variante clara, devolvé attrs vacío. No inventes atributos.

Devolvé un item por cada índice que recibiste, con el mismo índice.

No opines sobre el precio, el tamaño ni el stock: no te los doy y no forman parte de tu respuesta.`;

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
