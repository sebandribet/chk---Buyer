/**
 * Qué hacer cuando el humano pide un rubro que el catálogo no conoce.
 *
 * Para salir a buscarlo hace falta una categoría, y la categoría NO es un dato
 * cosmético: es exactamente lo que el mandato filtra. Si el agente busca whisky
 * y lo clasifica como `food`, se saltea una restricción del mandato sin que
 * nadie lo note.
 *
 * Por eso son dos pasos con roles distintos:
 *
 *   1. el modelo PROPONE una categoría y una unidad esperada
 *   2. una lista de palabras en código puede FORZAR una categoría restringida
 *
 * La asimetría es la garantía: el paso 2 solo mueve productos HACIA categorías
 * restringidas, nunca al revés. Un modelo que se equivoca —o al que convencieron
 * de equivocarse— puede a lo sumo hacer que algo quede más restringido de lo que
 * corresponde, y eso falla del lado seguro.
 */

import { z } from "zod";
import type { Category, Unit } from "@/contracts/index.js";
import type { LlmClient } from "@/llm/index.js";
import { normalizeTerm } from "../normalize.js";
import type { ScrapeTarget } from "./index.js";

/**
 * Palabras que fuerzan una categoría restringida, gane lo que gane el modelo.
 * Es deliberadamente generosa: un falso positivo deja algo fuera del mandato
 * —el humano lo destraba ampliando permisos— y un falso negativo deja entrar
 * una compra que nadie autorizó.
 */
const FORCED: { category: Category; words: string[] }[] = [
  {
    category: "alcoholic_beverages",
    words: [
      "vino", "cerveza", "whisky", "whiskey", "vodka", "gin", "ginebra", "ron",
      "tequila", "fernet", "aperitivo", "champagne", "champan", "espumante",
      "licor", "sidra", "aperol", "campari", "vermouth", "vermut", "malbec",
      "cabernet", "chardonnay", "aperitivo", "amargo obrero", "bitter",
    ],
  },
  {
    category: "equipment",
    words: [
      "cafetera", "heladera", "freidora", "horno", "microondas", "licuadora",
      "batidora", "procesadora", "amasadora", "anafe", "cocina industrial",
      "exhibidora", "freezer", "campana", "termotanque", "balanza", "mesada",
      "maquina", "electrodomestico",
    ],
  },
];

/** Categoría forzada por palabras, o null si ninguna aplica. */
export function forcedCategory(term: string): Category | null {
  const t = normalizeTerm(term);
  for (const { category, words } of FORCED) {
    if (words.some((w) => t.includes(normalizeTerm(w)))) return category;
  }
  return null;
}

const Proposal = z.object({
  category: z.enum(["food", "cleaning", "disposables", "alcoholic_beverages", "equipment"]),
  query: z.string(),
  expect_units: z.array(z.enum(["L", "kg", "unit"])),
  exclude: z.array(z.string()),
});

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["category", "query", "expect_units", "exclude"],
  properties: {
    category: {
      type: "string",
      enum: ["food", "cleaning", "disposables", "alcoholic_beverages", "equipment"],
    },
    query: { type: "string" },
    expect_units: { type: "array", items: { type: "string", enum: ["L", "kg", "unit"] } },
    exclude: { type: "array", items: { type: "string" } },
  },
};

/**
 * El prompt está en inglés pero `query` y `exclude` tienen que salir en
 * castellano rioplatense: son términos que se tipean en el buscador de un
 * supermercado argentino. Un "paper towels" no devuelve nada en Jumbo.
 */
const SYSTEM = `You are preparing a catalog search against an Argentine supermarket, for an agent that buys supplies for a coffee shop.

You get the generic name of a product. Return how to search for it:

- category: food | cleaning | disposables | alcoholic_beverages | equipment.
  alcoholic_beverages is any drink containing alcohol. equipment is machinery and appliances, not consumable supplies.
- query: what you would type into the supermarket's search box. Short and concrete.
- expect_units: the units it is sold in, in order of preference. "L" for liquids, "kg" for solids sold by weight, "unit" for things that are counted.
- exclude: words that rule out an irrelevant result. Searching "detergente" you must exclude "ropa"; searching "leche", "en polvo". Return an empty list if none come to mind.

CRITICAL: \`query\` and \`exclude\` must be written in Argentine Spanish, lowercase and without accents. They are typed verbatim into an Argentine supermarket's search box — an English term returns nothing. The product name you receive may be in English; translate it to the Spanish word an Argentine shopper would use ("paper towels" -> "rollo de cocina", "bleach" -> "lavandina").`;

/**
 * Arma el plan de búsqueda para un rubro desconocido.
 *
 * Si el modelo falla, se usa un plan mínimo: la categoría más restringida que
 * las palabras permitan, o `food` si ninguna aplica. Nunca se cancela la
 * búsqueda por no poder clasificar — se busca con lo que hay y el mandato sigue
 * filtrando después.
 */
export async function planFor(canonical: string, llm: LlmClient): Promise<ScrapeTarget> {
  const forzada = forcedCategory(canonical);

  let propuesta: z.infer<typeof Proposal> | null = null;
  try {
    propuesta = Proposal.parse(
      await llm.json<unknown>({
        op: "target_planning",
        system: SYSTEM,
        user: canonical,
        schema: { name: "scrape_target", schema: SCHEMA },
      }),
    );
  } catch {
    propuesta = null;
  }

  // La palabra clave gana siempre. El modelo solo elige cuando no hay ninguna
  // categoría restringida en juego.
  const category: Category = forzada ?? propuesta?.category ?? "food";

  return {
    canonical,
    query: propuesta?.query ?? canonical,
    category,
    ...(propuesta !== null && propuesta.expect_units.length > 0
      ? { expectUnits: propuesta.expect_units as Unit[] }
      : {}),
    ...(propuesta !== null && propuesta.exclude.length > 0 ? { exclude: propuesta.exclude } : {}),
  };
}
