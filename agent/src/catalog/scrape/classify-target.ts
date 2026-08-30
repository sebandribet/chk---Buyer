/**
 * Qué hacer cuando el humano pide un rubro que el catálogo no conoce.
 *
 * Para salir a buscarlo hace falta una categoría, y la categoría NO es un dato
 * cosmético: es exactamente lo que el mandato filtra. Si el agente busca whisky
 * y lo clasifica como `alimentos`, se saltea una restricción del mandato sin que
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
    category: "bebidas_alcoholicas",
    words: [
      "vino", "cerveza", "whisky", "whiskey", "vodka", "gin", "ginebra", "ron",
      "tequila", "fernet", "aperitivo", "champagne", "champan", "espumante",
      "licor", "sidra", "aperol", "campari", "vermouth", "vermut", "malbec",
      "cabernet", "chardonnay", "aperitivo", "amargo obrero", "bitter",
    ],
  },
  {
    category: "equipamiento",
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
  category: z.enum(["alimentos", "limpieza", "descartables", "bebidas_alcoholicas", "equipamiento"]),
  query: z.string(),
  expect_units: z.array(z.enum(["L", "kg", "unidad"])),
  exclude: z.array(z.string()),
});

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["category", "query", "expect_units", "exclude"],
  properties: {
    category: {
      type: "string",
      enum: ["alimentos", "limpieza", "descartables", "bebidas_alcoholicas", "equipamiento"],
    },
    query: { type: "string" },
    expect_units: { type: "array", items: { type: "string", enum: ["L", "kg", "unidad"] } },
    exclude: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `Preparás una búsqueda en el catálogo de un supermercado argentino, para un agente que compra insumos de una cafetería.

Te doy el nombre genérico de un producto. Devolvé cómo buscarlo:

- category: alimentos | limpieza | descartables | bebidas_alcoholicas | equipamiento.
  bebidas_alcoholicas es cualquier bebida con alcohol. equipamiento es maquinaria y electrodomésticos, no insumos.
- query: cómo lo buscarías en el buscador del supermercado. Corto y concreto.
- expect_units: en qué unidades se vende, en orden de preferencia. "L" para líquidos, "kg" para sólidos por peso, "unidad" para lo que se cuenta.
- exclude: palabras que descartan un resultado irrelevante. Buscando "detergente" hay que excluir "ropa"; buscando "leche", "en polvo". Devolvé lista vacía si no se te ocurre ninguna.`;

/**
 * Arma el plan de búsqueda para un rubro desconocido.
 *
 * Si el modelo falla, se usa un plan mínimo: la categoría más restringida que
 * las palabras permitan, o `alimentos` si ninguna aplica. Nunca se cancela la
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
  const category: Category = forzada ?? propuesta?.category ?? "alimentos";

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
