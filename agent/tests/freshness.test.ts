/**
 * Frescura del catálogo y búsqueda en vivo.
 *
 * Lo que se verifica acá no es que la búsqueda en vivo funcione —eso depende de
 * tres supermercados— sino que NO PUEDA ROMPER UN RUN. Una tienda caída, lenta o
 * devolviendo basura tiene que terminar en "seguí con lo que había", nunca en
 * una excepción delante del jurado.
 */

import { describe, expect, it, vi } from "vitest";
import { isStale, TTL_MINUTES } from "@/catalog/freshness.js";
import { forcedCategory } from "@/catalog/scrape/classify-target.js";
import { CatalogRefresher } from "@/catalog/refresher.js";
import { RefreshingCatalog, type CatalogStore } from "@/catalog/live.js";
import { PRODUCTS, SUPPLIERS } from "@/catalog/data.js";
import type { Product } from "@/contracts/index.js";
import { StubLlmClient } from "@/llm/index.js";
import type { StoreFetcher } from "@/catalog/scrape/index.js";

/** Tienda que siempre falla. Ningún test toca la red. */
const tiendaCaida: StoreFetcher = async () => {
  throw new Error("la tienda no responde");
};

/** Tienda que tarda más de lo que el agente está dispuesto a esperar. */
const tiendaLenta: StoreFetcher = () => new Promise(() => {});

const AHORA = new Date("2026-08-29T12:00:00.000Z");
const haceMinutos = (n: number) => new Date(AHORA.getTime() - n * 60_000).toISOString();

describe("vencimiento por volatilidad", () => {
  it("un precio de góndola aguanta días", () => {
    expect(isStale(haceMinutos(60 * 24), "stable", AHORA)).toBe(false);
  });

  it("el mismo precio con perfil intradía ya venció", () => {
    // El mecanismo tiene que soportar rubros de precio dinámico —vuelos,
    // hotelería— aunque hoy ninguno de los nuestros lo sea.
    expect(isStale(haceMinutos(60 * 24), "intraday", AHORA)).toBe(true);
    expect(isStale(haceMinutos(20), "intraday", AHORA)).toBe(false);
  });

  it("sin fecha, se considera vencido", () => {
    // Los productos del mock no tienen `source`. Tratarlos como frescos sería
    // asumir que un dato sin procedencia es confiable.
    expect(isStale(undefined, "stable", AHORA)).toBe(true);
  });

  it("los escalones están ordenados de más a menos duradero", () => {
    expect(TTL_MINUTES.stable).toBeGreaterThan(TTL_MINUTES.daily);
    expect(TTL_MINUTES.daily).toBeGreaterThan(TTL_MINUTES.intraday);
  });
});

describe("categoría forzada de un rubro nuevo", () => {
  // La categoría es lo que el mandato filtra. Un rubro que el agente sale a
  // buscar solo no puede terminar en una categoría más permisiva de la que le
  // corresponde: ahí se saltearía una restricción sin que nadie lo note.
  it("manda una bebida con alcohol a su categoría, gane lo que gane el modelo", () => {
    expect(forcedCategory("whisky")).toBe("alcoholic_beverages");
    expect(forcedCategory("vino tinto")).toBe("alcoholic_beverages");
    expect(forcedCategory("fernet")).toBe("alcoholic_beverages");
  });

  it("manda un electrodoméstico a equipamiento", () => {
    expect(forcedCategory("freidora industrial")).toBe("equipment");
    expect(forcedCategory("heladera exhibidora")).toBe("equipment");
  });

  it("deja pasar un insumo común sin forzar nada", () => {
    expect(forcedCategory("yerba organica")).toBeNull();
    expect(forcedCategory("pan rallado")).toBeNull();
  });
});

describe("la búsqueda en vivo no puede romper un run", () => {
  const store = (products: Product[]): CatalogStore => {
    let items = [...products];
    return {
      products: () => items,
      suppliers: () => SUPPLIERS,
      replace: (canonical, ps) => {
        items = [...items.filter((p) => p.canonical !== canonical), ...ps];
      },
    };
  };

  it("devuelve vacío en vez de explotar cuando la búsqueda falla", async () => {
    const llm = new StubLlmClient({});
    const catalog = new RefreshingCatalog(store(PRODUCTS), llm, null, {
      missTimeoutMs: 50,
      now: () => AHORA,
      fetcher: tiendaCaida,
    });

    const offers = await catalog.search({ canonical: "unobtanium" });
    expect(offers).toEqual([]);
  });

  it("no espera para siempre a una tienda que no contesta", async () => {
    // Sin este corte, un supermercado lento cuelga el run entero y el agente
    // se queda mudo delante de quien lo esté mirando.
    const catalog = new RefreshingCatalog(store(PRODUCTS), new StubLlmClient({}), null, {
      missTimeoutMs: 40,
      now: () => AHORA,
      fetcher: tiendaLenta,
    });

    const empezo = Date.now();
    const offers = await catalog.search({ canonical: "lavandina" });
    expect(Date.now() - empezo).toBeLessThan(1500);
    expect(offers.length).toBeGreaterThan(0); // devolvió lo que ya tenía
  });

  it("sirve lo que ya tiene sin salir a la red", async () => {
    const llm = new StubLlmClient({});
    const catalog = new RefreshingCatalog(store(PRODUCTS), llm, null, {
      missTimeoutMs: 50,
      now: () => AHORA,
      fetcher: tiendaCaida,
    });

    const offers = await catalog.search({ canonical: "leche" });
    expect(offers.length).toBeGreaterThan(0);
  });
});

describe("refresco periódico", () => {
  const conFecha = (canonical: string, fetchedAt: string | undefined): Product => ({
    sku: `X-${canonical}`,
    supplierId: "norte",
    canonical,
    title: canonical,
    brand: "x",
    attrs: {},
    category: "cleaning",
    presentation: { unit: "L", sizePerPack: 1, packQty: 1 },
    priceArs: 1000,
    stock: 5,
    ...(fetchedAt !== undefined ? { source: { store: "jumbo", url: "u", fetchedAt } } : {}),
  });

  it("solo marca vencido lo que efectivamente venció", () => {
    const items = [conFecha("lavandina", haceMinutos(10)), conFecha("detergente", haceMinutos(60 * 24 * 10))];
    const refresher = new CatalogRefresher(
      { products: () => items, suppliers: () => SUPPLIERS, replace: () => {} },
      new StubLlmClient({}),
      { targets: [
        { canonical: "lavandina", category: "cleaning" },
        { canonical: "detergente", category: "cleaning" },
      ] },
    );

    const vencidos = refresher.stale(AHORA).map((t) => t.canonical);
    expect(vencidos).toEqual(["detergente"]);
  });

  it("pone primero lo más viejo", () => {
    const items = [
      conFecha("lavandina", haceMinutos(60 * 24 * 20)),
      conFecha("detergente", haceMinutos(60 * 24 * 10)),
    ];
    const refresher = new CatalogRefresher(
      { products: () => items, suppliers: () => SUPPLIERS, replace: () => {} },
      new StubLlmClient({}),
      { targets: [
        { canonical: "detergente", category: "cleaning" },
        { canonical: "lavandina", category: "cleaning" },
      ] },
    );

    expect(refresher.stale(AHORA).map((t) => t.canonical)).toEqual(["lavandina", "detergente"]);
  });

  it("un rubro sin productos cuenta como vencido: nunca se bajó", () => {
    const refresher = new CatalogRefresher(
      { products: () => [], suppliers: () => SUPPLIERS, replace: () => {} },
      new StubLlmClient({}),
      { targets: [{ canonical: "yerba", category: "food" }] },
    );
    expect(refresher.stale(AHORA)).toHaveLength(1);
  });

  it("un rubro que falla no frena a los demás", async () => {
    const refrescados: string[] = [];
    const refresher = new CatalogRefresher(
      { products: () => [], suppliers: () => SUPPLIERS, replace: () => {} },
      new StubLlmClient({}),
      {
        batchSize: 2,
        fetcher: tiendaCaida,
        targets: [
          { canonical: "uno", category: "food" },
          { canonical: "dos", category: "food" },
        ],
        onRefresh: (c) => refrescados.push(c),
      },
    );

    // La tienda falla en los dos: el barrido tiene que terminar igual, sin
    // tirar y sin colgarse.
    await expect(refresher.sweep(AHORA)).resolves.toBe(0);
    expect(refrescados).toEqual([]);
  });
});
