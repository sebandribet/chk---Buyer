/**
 * Parseo y saneamiento del catálogo real.
 *
 * Estas funciones deciden el tamaño y el precio con los que el agente después
 * compara: un error de factor 1000 al leer "gr" en vez de "kg" no rompe nada
 * visiblemente, solo hace que el agente elija mal con total confianza. Por eso
 * son las únicas piezas del scraper que tienen tests, y por eso son
 * determinísticas en vez de estar delegadas a un modelo.
 */

import { describe, expect, it } from "vitest";
import { parseSize, isSanePrice } from "@/catalog/scrape/parse.js";
import { extractVariant } from "@/catalog/scrape/variants.js";
import { dropUnitPriceOutliers } from "@/catalog/scrape/index.js";
import { normalizeTerm } from "@/catalog/normalize.js";
import type { Product } from "@/contracts/index.js";

describe("parseo de tamaño", () => {
  const casos: { nombre: string; unit: string; size: number; pack: number }[] = [
    { nombre: "Café Molido 250 Grs Lavazza", unit: "kg", size: 0.25, pack: 1 },
    { nombre: "Café Molido Torrado La Virginia 125 Gr.", unit: "kg", size: 0.125, pack: 1 },
    { nombre: "Leche Entera DIA Larga Vida 1 Lt.", unit: "L", size: 1, pack: 1 },
    { nombre: "Detergente Lavavajilla DIA Limón 750 Ml.", unit: "L", size: 0.75, pack: 1 },
    { nombre: "Arroz Largo Fino Gallo 1 Kg", unit: "kg", size: 1, pack: 1 },
    { nombre: "Papel Higiénico Elite x 4 Un", unit: "unidad", size: 4, pack: 1 },
    { nombre: "Aceite Girasol Natura 900 cc", unit: "L", size: 0.9, pack: 1 },
    { nombre: "Harina 000 Pureza 1,5 Kg", unit: "kg", size: 1.5, pack: 1 },
  ];

  for (const c of casos) {
    it(`lee "${c.nombre}"`, () => {
      const parsed = parseSize(c.nombre);
      expect(parsed?.presentation.unit).toBe(c.unit);
      expect(parsed?.presentation.sizePerPack).toBeCloseTo(c.size, 5);
      expect(parsed?.presentation.packQty).toBe(c.pack);
    });
  }

  it("no inventa un tamaño cuando el nombre no lo dice", () => {
    // Preferimos perder el producto a publicarlo con un tamaño supuesto: sin
    // tamaño no hay precio por unidad, y sin eso la comparación es ruido.
    expect(parseSize("Cafetera Express Philips")).toBeNull();
    expect(parseSize("Yerba Mate Playadito")).toBeNull();
  });

  it("no cuenta el mismo número como tamaño y como multiplicador de pack", () => {
    // "x 4 Un" son 4 unidades, no 4 packs de 4. Contarlo dos veces daba 16 y un
    // precio por unidad cuatro veces más barato del real.
    const p = parseSize("Papel Higiénico Elite x 4 Un")!;
    expect(p.presentation.sizePerPack * p.presentation.packQty).toBe(4);
  });

  it("sí cuenta el multiplicador cuando es un número distinto", () => {
    const p = parseSize("Leche Entera La Serenísima 3x1L")!;
    expect(p.presentation.packQty).toBe(3);
    expect(p.presentation.sizePerPack * p.presentation.packQty).toBe(3);
  });

  it("elige la unidad que se le pide cuando el nombre tiene dos", () => {
    // "300 Cc" es la capacidad de cada vaso; "20 U" es lo que se compra. Sin
    // decirle qué unidad esperamos, publica "0.3 L de vasos", que no sirve para
    // comparar contra nada.
    const sinPreferencia = parseSize("Vasos Descartables 300 Cc X 20 U Mia Casa")!;
    expect(sinPreferencia.presentation.unit).toBe("L");

    const conPreferencia = parseSize("Vasos Descartables 300 Cc X 20 U Mia Casa", "unidad")!;
    expect(conPreferencia.presentation.unit).toBe("unidad");
    expect(conPreferencia.presentation.sizePerPack * conPreferencia.presentation.packQty).toBe(20);
  });

  it("lee cantidades escritas con U sola", () => {
    expect(parseSize("Servilletas x 100 U", "unidad")?.presentation.sizePerPack).toBe(100);
    expect(parseSize("Rollo de Cocina 3 Un", "unidad")?.presentation.sizePerPack).toBe(3);
  });

  it("distingue gramos de kilos, que es el error caro", () => {
    const g = parseSize("Café 500 Gr")!;
    const kg = parseSize("Café 500 Kg")!;
    expect(g.presentation.sizePerPack).toBe(0.5);
    expect(kg.presentation.sizePerPack).toBe(500);
  });
});

describe("cordura de precios", () => {
  it("acepta un precio de góndola normal", () => {
    expect(isSanePrice(1_700, { unit: "L", sizePerPack: 1, packQty: 1 })).toBe(true);
  });

  it("rechaza un precio en otra escala", () => {
    // Jumbo devuelve `ListPrice: 2644628` junto a `Price: 32000` para el mismo
    // producto. Si el campo equivocado entra, el agente compara centavos contra
    // pesos.
    expect(isSanePrice(2_644_628, { unit: "kg", sizePerPack: 0.25, packQty: 1 })).toBe(false);
  });

  it("rechaza precio cero o negativo", () => {
    expect(isSanePrice(0, { unit: "L", sizePerPack: 1, packQty: 1 })).toBe(false);
    expect(isSanePrice(-100, { unit: "L", sizePerPack: 1, packQty: 1 })).toBe(false);
  });
});

describe("variantes", () => {
  it("extrae la variante desde el nombre de góndola", () => {
    expect(extractVariant("leche", "Leche Entera DIA Larga Vida 1 Lt.")).toEqual({ tipo: "entera" });
    expect(extractVariant("cafe", "Café Molido Torrado La Virginia 125 Gr.")).toEqual({ tipo: "molido" });
    expect(extractVariant("detergente", "Detergente Lavavajilla DIA Limón 750 Ml.")).toEqual({ tipo: "limon" });
  });

  it("prefiere la variante más específica", () => {
    // "parcialmente descremada" tiene que ganarle a "descremada", o toda leche
    // parcialmente descremada queda mal etiquetada.
    expect(extractVariant("leche", "Leche Parcialmente Descremada 1L")).toEqual({
      tipo: "parcialmente descremada",
    });
  });

  it("devuelve vacío en vez de inventar", () => {
    // Un atributo vacío significa "el nombre no lo dice", y deja al producto
    // disponible para cualquier pedido que no pida variante. Inventarla lo
    // excluiría de pedidos que sí podría cubrir.
    expect(extractVariant("leche", "Leche Bulnez 1 lt")).toEqual({});
  });
});

describe("outliers de precio", () => {
  const producto = (sku: string, priceArs: number): Product => ({
    sku,
    supplierId: "jumbo",
    canonical: "leche",
    title: sku,
    brand: "x",
    attrs: {},
    category: "alimentos",
    presentation: { unit: "L", sizePerPack: 1, packQty: 1 },
    priceArs,
    stock: 10,
  });

  it("saca el precio que se despega del rubro", () => {
    // Apareció leche a $220/L junto a leche a $1700/L. Puede ser promo, error de
    // carga o un tamaño mal leído; desde acá no se distingue, y el agente que lo
    // vea elige eso.
    const limpios = dropUnitPriceOutliers([
      producto("a", 1_700),
      producto("b", 1_790),
      producto("c", 2_249),
      producto("d", 1_850),
      producto("basura", 220),
    ]);

    expect(limpios.map((p) => p.sku)).not.toContain("basura");
    expect(limpios).toHaveLength(4);
  });

  it("no toca una lista donde todos son razonables", () => {
    const ps = [producto("a", 1_700), producto("b", 1_790), producto("c", 2_249), producto("d", 1_850)];
    expect(dropUnitPriceOutliers(ps)).toHaveLength(4);
  });

  it("no filtra con muestras chicas, donde la mediana no significa nada", () => {
    const ps = [producto("a", 1_700), producto("b", 220)];
    expect(dropUnitPriceOutliers(ps)).toHaveLength(2);
  });
});

describe("normalización de términos", () => {
  it("hace coincidir lo que antes no coincidía", () => {
    // Los tres casos que rompían la búsqueda contra el catálogo real.
    expect(normalizeTerm("café")).toBe(normalizeTerm("cafe"));
    expect(normalizeTerm("azúcar")).toBe(normalizeTerm("azucar"));
    expect(normalizeTerm("servilletas")).toBe(normalizeTerm("servilleta"));
  });

  it("no destroza palabras cortas terminadas en s", () => {
    expect(normalizeTerm("gas")).toBe("gas");
    expect(normalizeTerm("arroz")).toBe("arroz");
  });
});
