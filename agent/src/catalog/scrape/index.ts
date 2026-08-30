/**
 * Armado del catálogo a partir de datos reales.
 *
 * El pipeline, y qué garantiza cada paso:
 *
 *   1. buscar en la tienda   → precio, stock y link REALES, del JSON de la tienda
 *   2. parsear el tamaño     → determinístico, desde el nombre; si no se puede, se descarta
 *   3. chequear cordura      → ataja precios en otra escala
 *   4. clasificar con modelo → relevancia y variante; NO toca precio ni tamaño
 *   5. publicar con origen   → cada producto guarda store + url + fetchedAt
 *
 * Se corre offline y se congela a un archivo. El demo NO scrapea en vivo: una
 * tienda que cambia su API o un wifi lento no pueden ser el motivo por el que el
 * agente no encuentra nada delante del jurado.
 */

import type { Category, Product, Supplier, Unit } from "@/contracts/index.js";
import { DEFAULT_TIER, type VolatilityTier } from "../freshness.js";
import type { LlmClient } from "@/llm/index.js";
import { normalizeTerm } from "../normalize.js";
import { classifyProducts } from "./classify.js";
import { isSanePrice, parseSize } from "./parse.js";
import { extractVariant } from "./variants.js";
import { searchVtex, VTEX_STORES, type VtexItem, type VtexStore } from "./vtex.js";

/** Qué buscar y bajo qué canonical y categoría publicarlo. */
export interface ScrapeTarget {
  canonical: string;
  /** Término de búsqueda para la tienda, si difiere del canonical. */
  query?: string;
  category: Category;
  aliases?: string[];
  /**
   * Unidades aceptables, en orden de preferencia. La primera guía el parseo:
   * "Vasos 300 Cc X 20 U" tiene dos números con unidad, y sin saber cuál
   * esperamos el parser publica "0.3 L de vasos". Un resultado en ninguna de
   * estas unidades se descarta.
   *
   * Varias unidades no es indecisión: el edulcorante viene en sobres, en gramos
   * y en mililitros, y exigir una sola tira el 90% del rubro en silencio.
   */
  expectUnits?: Unit[];
  /**
   * Palabras que descalifican el resultado aunque el buscador lo haya devuelto.
   * El buscador de la tienda no sabe que somos una cafetería: "detergente" le
   * trae jabón para ropa, y "leche" le trae leche en polvo y crema. Comprar eso
   * sería tan malo como no comprar nada.
   */
  exclude?: string[];
  /**
   * Cada cuánto vence el precio de este rubro. Si no se declara, sale de la
   * categoría (ver freshness.ts). Es lo que separa "la harina se mira una vez
   * por semana" de "un pasaje se mira cada media hora".
   */
  tier?: VolatilityTier;
}

/**
 * Qué rubros bajar.
 *
 * La lista está pensada para una cafetería/restaurante chico: si un juez pide
 * algo razonable de ese negocio, tiene que haber contra qué buscarlo. Un
 * `no_match` honesto es una respuesta válida, pero no queremos que sea LA
 * respuesta habitual.
 *
 * `expectUnits` es el campo que más rinde y el que más rompe: un rubro con la
 * unidad equivocada descarta el 100% de sus resultados en silencio. Si un rubro
 * baja 0 productos, es lo primero que hay que mirar.
 */
export const SCRAPE_TARGETS: ScrapeTarget[] = [
  { canonical: "leche", query: "leche larga vida", category: "food", expectUnits: ["L"], aliases: ["lacteo"], exclude: ["en polvo", "polvo", "condensada", "crema", "chocolatada", "postre", "flan"] },
  { canonical: "cafe", query: "cafe molido", category: "food", expectUnits: ["kg"], aliases: ["cafe en grano"], exclude: ["capsula", "capsulas", "cafetera", "filtro", "taza", "molinillo", "saborizador"] },
  { canonical: "yerba", query: "yerba mate", category: "food", expectUnits: ["kg"], aliases: ["mate"] },
  { canonical: "azucar", query: "azucar", category: "food", expectUnits: ["kg"], exclude: ["edulcorante", "stevia"] },
  { canonical: "harina", query: "harina de trigo", category: "food", expectUnits: ["kg"], exclude: ["premezcla", "rebozador"] },
  { canonical: "arroz", query: "arroz", category: "food", expectUnits: ["kg"], exclude: ["leche de arroz", "galleta", "snack"] },
  { canonical: "avena", query: "avena", category: "food", expectUnits: ["kg"], exclude: ["barra", "galleta", "bebida"] },
  { canonical: "aceite", query: "aceite girasol", category: "food", expectUnits: ["L"], exclude: ["corporal", "capilar", "esencial", "motor", "bebe"] },
  { canonical: "fideos", query: "fideos secos", category: "food", expectUnits: ["kg"], aliases: ["pasta"] },
  { canonical: "sal", query: "sal fina", category: "food", expectUnits: ["kg"], exclude: ["sales de bano", "sal de frutas", "marina gruesa para bano"] },
  { canonical: "detergente", query: "detergente", category: "cleaning", expectUnits: ["L"], aliases: ["lavavajilla"], exclude: ["ropa", "lavarropas", "baby", "prendas", "jabon liquido para ropa"] },
  { canonical: "lavandina", query: "lavandina", category: "cleaning", expectUnits: ["L"], aliases: ["cloro"], exclude: ["pastilla"] },
  { canonical: "jabon liquido", query: "jabon liquido manos", category: "cleaning", expectUnits: ["L"], exclude: ["ropa", "lavarropas"] },
  { canonical: "papel higienico", query: "papel higienico", category: "disposables", expectUnits: ["unit"], aliases: ["papel"], exclude: ["dispenser", "portarrollo"] },
  { canonical: "rollo de cocina", query: "rollo de cocina", category: "disposables", expectUnits: ["unit"] },
  { canonical: "servilletas", query: "servilletas de papel", category: "disposables", expectUnits: ["unit"], exclude: ["dispenser", "femenina", "panuelo", "panuelos"] },
  { canonical: "bolsas de residuo", query: "bolsas de residuos", category: "disposables", expectUnits: ["unit"], aliases: ["bolsa de basura"], exclude: ["canasto", "cesto de bano"] },

  // --- desayuno y cafetería ------------------------------------------------
  { canonical: "te", query: "te en saquitos", category: "food", expectUnits: ["unit", "kg"], aliases: ["te en saquitos"], exclude: ["tetera", "infusor", "cafe", "mate cocido"] },
  { canonical: "cacao", query: "cacao en polvo", category: "food", expectUnits: ["kg"], aliases: ["chocolate en polvo"], exclude: ["jugo", "tang", "leche"] },
  { canonical: "dulce de leche", query: "dulce de leche", category: "food", expectUnits: ["kg"], exclude: ["alfajor", "helado", "galleta"] },
  { canonical: "mermelada", query: "mermelada", category: "food", expectUnits: ["kg"], exclude: ["galleta"] },
  { canonical: "miel", query: "miel", category: "food", expectUnits: ["kg"], exclude: ["shampoo", "jabon", "crema"] },
  { canonical: "manteca", query: "manteca", category: "food", expectUnits: ["kg"], exclude: ["cacao", "mani"] },
  { canonical: "crema de leche", query: "crema de leche", category: "food", expectUnits: ["L"], exclude: ["corporal", "facial"] },
  { canonical: "queso crema", query: "queso crema", category: "food", expectUnits: ["kg"], exclude: ["alimento a base de"] },
  { canonical: "galletitas", query: "galletitas", category: "food", expectUnits: ["kg", "unit"], aliases: ["galletas"] },
  { canonical: "endulzante", query: "edulcorante", category: "food", expectUnits: ["unit", "kg", "L"], aliases: ["edulcorante"] },

  // --- almacén -------------------------------------------------------------
  { canonical: "tomate triturado", query: "tomate triturado", category: "food", expectUnits: ["kg"], aliases: ["pure de tomate", "salsa de tomate"] },
  { canonical: "atun", query: "atun lata", category: "food", expectUnits: ["kg", "unit"], exclude: ["gato", "mascota"] },
  { canonical: "aceitunas", query: "aceitunas", category: "food", expectUnits: ["kg"] },
  { canonical: "vinagre", query: "vinagre", category: "food", expectUnits: ["L"], exclude: ["limpieza", "limpiador"] },
  { canonical: "mayonesa", query: "mayonesa", category: "food", expectUnits: ["kg"] },
  { canonical: "ketchup", query: "ketchup", category: "food", expectUnits: ["kg"] },
  { canonical: "mostaza", query: "mostaza", category: "food", expectUnits: ["kg"] },
  { canonical: "pan rallado", query: "pan rallado", category: "food", expectUnits: ["kg"], aliases: ["rebozador"] },
  { canonical: "queso rallado", query: "queso rallado", category: "food", expectUnits: ["kg"], exclude: ["alimento a base de", "untable", "en fetas"] },
  { canonical: "levadura", query: "levadura seca", category: "food", expectUnits: ["kg", "unit"], exclude: ["cerveza"] },
  { canonical: "polenta", query: "polenta", category: "food", expectUnits: ["kg"] },
  { canonical: "lentejas", query: "lentejas", category: "food", expectUnits: ["kg"], aliases: ["legumbres"] },

  // --- bebidas sin alcohol -------------------------------------------------
  // Van en `alimentos` a propósito: la categoría `bebidas_alcoholicas` existe
  // para poder demostrar el rechazo por categoría, y meter agua ahí adentro
  // arruinaría ese caso.
  { canonical: "agua mineral", query: "agua mineral sin gas", category: "food", expectUnits: ["L"], aliases: ["agua"], exclude: ["saborizada", "tonica"] },
  { canonical: "gaseosa", query: "gaseosa", category: "food", expectUnits: ["L"], aliases: ["refresco"] },
  { canonical: "jugo", query: "jugo exprimido", category: "food", expectUnits: ["L"], exclude: ["polvo", "sobre"] },
  { canonical: "soda", query: "soda sifon", category: "food", expectUnits: ["L"] },

  // --- limpieza ------------------------------------------------------------
  { canonical: "desengrasante", query: "desengrasante cocina", category: "cleaning", expectUnits: ["L"], exclude: ["detergente", "lavavajilla"] },
  { canonical: "limpiador de pisos", query: "limpiador de pisos", category: "cleaning", expectUnits: ["L"], aliases: ["limpiapisos"] },
  { canonical: "limpiavidrios", query: "limpiavidrios", category: "cleaning", expectUnits: ["L"], exclude: ["repuesto", "pano"] },
  { canonical: "alcohol en gel", query: "alcohol en gel", category: "cleaning", expectUnits: ["L"], aliases: ["sanitizante"], exclude: ["lavandina", "desinfectante de ropa"] },
  { canonical: "jabon en polvo", query: "jabon en polvo", category: "cleaning", expectUnits: ["kg"] },
  { canonical: "esponja", query: "esponja cocina", category: "cleaning", expectUnits: ["unit", "kg"], aliases: ["esponjas"] },
  { canonical: "trapo de piso", query: "trapo de piso", category: "cleaning", expectUnits: ["unit"], aliases: ["rejilla"] },
  { canonical: "guantes", query: "guantes latex limpieza", category: "cleaning", expectUnits: ["unit"] },

  // --- descartables --------------------------------------------------------
  // Los platos y los cubiertos descartables se probaron y se sacaron: las tres
  // tiendas los listan como "Platos Descartables Manhattan", sin cantidad en el
  // nombre, así que no hay tamaño que parsear y no se pueden comparar precios.
  // Dejar el target daría cobertura aparente que no existe.
  { canonical: "vasos descartables", query: "vasos descartables", category: "disposables", expectUnits: ["unit"], aliases: ["vaso descartable"] },
  { canonical: "papel aluminio", query: "papel aluminio", category: "disposables", expectUnits: ["unit"], aliases: ["aluminio"] },
  { canonical: "film", query: "film adherente", category: "disposables", expectUnits: ["unit"], aliases: ["film adherente"] },
  { canonical: "papel manteca", query: "papel manteca", category: "disposables", expectUnits: ["unit"] },
];

export interface ScrapeStats {
  target: string;
  store: string;
  crudos: number;
  sinTamano: number;
  precioRaro: number;
  irrelevantes: number;
  publicados: number;
}

export interface ScrapeResult {
  products: Product[];
  suppliers: Supplier[];
  stats: ScrapeStats[];
  fetchedAt: string;
}

function skuFor(storeId: string, canonical: string, index: number): string {
  const base = normalizeTerm(canonical).replace(/[^a-z]/g, "").slice(0, 6).toUpperCase();
  return `${storeId.slice(0, 3).toUpperCase()}-${base}-${index}`;
}

/**
 * Cómo se consulta una tienda. Es inyectable para que los tests puedan correr
 * sin red: un test que depende de que tres supermercados estén arriba no prueba
 * nuestro código, prueba internet.
 */
export type StoreFetcher = (store: VtexStore, term: string) => Promise<VtexItem[]>;

export async function scrapeTarget(
  target: ScrapeTarget,
  llm: LlmClient,
  fetchedAt: string,
  fetcher: StoreFetcher = searchVtex,
): Promise<{ products: Product[]; stats: ScrapeStats[] }> {
  const products: Product[] = [];
  const stats: ScrapeStats[] = [];

  for (const store of VTEX_STORES) {
    const stat: ScrapeStats = {
      target: target.canonical,
      store: store.id,
      crudos: 0,
      sinTamano: 0,
      precioRaro: 0,
      irrelevantes: 0,
      publicados: 0,
    };

    let raw: VtexItem[];
    try {
      raw = await fetcher(store, target.query ?? target.canonical);
    } catch {
      stats.push(stat);
      continue;
    }
    stat.crudos = raw.length;

    // Paso 2 y 3, antes de gastar una llamada al modelo: lo que no tiene tamaño
    // legible o tiene un precio absurdo no llega a clasificarse.
    const viables: { item: VtexItem; presentation: Product["presentation"] }[] = [];
    const vistos = new Set<string>();

    for (const item of raw) {
      const nombre = normalizeTerm(item.productName);

      if (target.exclude?.some((kw) => nombre.includes(normalizeTerm(kw))) === true) {
        stat.irrelevantes += 1;
        continue;
      }

      // El buscador devuelve el mismo producto más de una vez cuando tiene
      // varias presentaciones cargadas. Duplicarlo en el catálogo haría que el
      // trail muestre dos veces la misma oferta compitiendo consigo misma.
      const clave = `${nombre}|${item.priceArs}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);

      const parsed = parseSize(item.productName, target.expectUnits?.[0]);
      if (parsed === null) {
        stat.sinTamano += 1;
        continue;
      }
      if (target.expectUnits !== undefined && !target.expectUnits.includes(parsed.presentation.unit)) {
        stat.sinTamano += 1;
        continue;
      }
      if (!isSanePrice(item.priceArs, parsed.presentation)) {
        stat.precioRaro += 1;
        continue;
      }
      viables.push({ item, presentation: parsed.presentation });
    }

    // Paso 4. Por defecto, reglas. El clasificador con modelo queda detrás de
    // una bandera porque medimos que empeora el resultado: ver variants.ts.
    const clasificados =
      process.env.NVIDIA_CLASSIFY === "1"
        ? await classifyProducts(target.canonical, viables.map((v) => v.item.productName), llm)
        : viables.map((v) => ({
            relevant: true,
            attrs: extractVariant(target.canonical, v.item.productName),
          }));

    viables.forEach((v, i) => {
      const c = clasificados[i];
      if (c === undefined || !c.relevant) {
        stat.irrelevantes += 1;
        return;
      }

      products.push({
        sku: skuFor(store.id, target.canonical, products.length),
        supplierId: store.id,
        canonical: target.canonical,
        ...(target.aliases !== undefined ? { aliases: target.aliases } : {}),
        title: v.item.productName,
        brand: v.item.brand,
        attrs: c.attrs,
        category: target.category,
        presentation: v.presentation,
        priceArs: v.item.priceArs,
        stock: v.item.stock,
        source: { store: store.id, url: v.item.url, fetchedAt },
      });
      stat.publicados += 1;
    });

    stats.push(stat);
  }

  return { products, stats };
}

/**
 * Descarta precios que se alejan demasiado de la mediana de su propio rubro.
 *
 * Apareció leche a $220/L en la misma góndola que leche a $1700/L. Puede ser una
 * promo, un precio mal cargado o un tamaño que leímos mal — desde acá no se
 * puede saber cuál, y no importa: si el agente lo ve, elige eso y se lleva la
 * anomalía por delante con total convicción.
 *
 * Se compara contra la mediana y no contra un rango fijo porque la mediana se
 * adapta sola a la inflación y a cada rubro. El factor 6 es ancho a propósito:
 * tiene que atajar errores de carga, no ofertas buenas.
 */
/** La volatilidad efectiva de un rubro: la declarada, o la de su categoría. */
export function tierOf(target: ScrapeTarget): VolatilityTier {
  return target.tier ?? DEFAULT_TIER[target.category];
}

/** Busca el plan ya definido para un rubro, comparando en forma normalizada. */
export function findTarget(canonical: string, targets: ScrapeTarget[] = SCRAPE_TARGETS): ScrapeTarget | null {
  const key = normalizeTerm(canonical);
  return (
    targets.find(
      (t) =>
        normalizeTerm(t.canonical) === key ||
        (t.aliases ?? []).some((a) => normalizeTerm(a) === key),
    ) ?? null
  );
}

export function dropUnitPriceOutliers(products: Product[], factor = 6): Product[] {
  if (products.length < 4) return products;

  const unitPrice = (p: Product) =>
    p.priceArs / (p.presentation.sizePerPack * p.presentation.packQty);

  const ordenados = [...products].sort((a, b) => unitPrice(a) - unitPrice(b));
  const mediana = unitPrice(ordenados[Math.floor(ordenados.length / 2)]!);
  if (!Number.isFinite(mediana) || mediana <= 0) return products;

  return products.filter((p) => {
    const u = unitPrice(p);
    return u >= mediana / factor && u <= mediana * factor;
  });
}

export async function scrapeCatalog(
  llm: LlmClient,
  targets: ScrapeTarget[] = SCRAPE_TARGETS,
  onProgress?: (t: ScrapeTarget, publicados: number) => void,
  fetcher: StoreFetcher = searchVtex,
): Promise<ScrapeResult> {
  const fetchedAt = new Date().toISOString();
  const products: Product[] = [];
  const stats: ScrapeStats[] = [];

  for (const target of targets) {
    const r = await scrapeTarget(target, llm, fetchedAt, fetcher);
    const limpios = dropUnitPriceOutliers(r.products);

    const descartados = r.products.length - limpios.length;
    if (descartados > 0 && r.stats[0] !== undefined) r.stats[0].precioRaro += descartados;

    products.push(...limpios);
    stats.push(...r.stats);
    onProgress?.(target, limpios.length);
  }

  const suppliers: Supplier[] = VTEX_STORES.map((s) => ({
    id: s.id,
    name: s.name,
    deliveryDays: s.deliveryDays,
    minOrderArs: s.minOrderArs,
    rating: s.rating,
  }));

  return { products, suppliers, stats, fetchedAt };
}
