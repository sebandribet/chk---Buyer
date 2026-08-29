/**
 * Lectura de catálogos reales de supermercados argentinos.
 *
 * Jumbo, Día y Carrefour corren sobre VTEX, que expone un endpoint público de
 * búsqueda en JSON. Preferimos eso a parsear HTML por tres razones: es la API
 * que la propia tienda usa para su buscador, devuelve datos ya estructurados
 * (nombre, marca, precio, stock, link), y no se rompe cada vez que alguien
 * cambia una clase de CSS.
 *
 * Lo que sale de acá es dato crudo y NO CONFIABLE: nombres inconsistentes,
 * resultados irrelevantes y al menos un campo de precio en otra escala. Todo lo
 * que se publique al catálogo tiene que pasar por parseo y chequeos primero.
 */

export interface VtexStore {
  id: string;
  name: string;
  host: string;
  /** Días de entrega. Inventado: la API no lo expone y el challenge lo permite. */
  deliveryDays: number;
  minOrderArs: number;
  rating: number;
}

export const VTEX_STORES: VtexStore[] = [
  { id: "jumbo", name: "Jumbo", host: "www.jumbo.com.ar", deliveryDays: 2, minOrderArs: 15_000, rating: 4.5 },
  { id: "dia", name: "Supermercados Día", host: "diaonline.supermercadosdia.com.ar", deliveryDays: 3, minOrderArs: 10_000, rating: 4.1 },
  { id: "carrefour", name: "Carrefour", host: "www.carrefour.com.ar", deliveryDays: 2, minOrderArs: 12_000, rating: 4.3 },
];

export interface VtexItem {
  store: VtexStore;
  productName: string;
  brand: string;
  url: string;
  priceArs: number;
  stock: number;
}

interface VtexRawProduct {
  productName?: string;
  brand?: string;
  link?: string;
  items?: {
    sellers?: {
      commertialOffer?: {
        Price?: number;
        PriceWithoutDiscount?: number;
        AvailableQuantity?: number;
      };
    }[];
  }[];
}

/**
 * `Price` y `PriceWithoutDiscount` coinciden y están en pesos; `ListPrice` viene
 * en otra escala y se ignora deliberadamente. Si los dos primeros discrepan
 * mucho, preferimos descartar el producto a adivinar cuál es el bueno.
 */
function readPrice(offer: { Price?: number; PriceWithoutDiscount?: number }): number | null {
  const price = offer.Price;
  const alt = offer.PriceWithoutDiscount;
  if (typeof price !== "number" || price <= 0) return null;
  if (typeof alt === "number" && alt > 0 && Math.abs(alt - price) / price > 10) return null;
  return price;
}

export async function searchVtex(
  store: VtexStore,
  term: string,
  limit = 12,
): Promise<VtexItem[]> {
  const url =
    `https://${store.host}/api/catalog_system/pub/products/search` +
    `?ft=${encodeURIComponent(term)}&_from=0&_to=${limit - 1}`;

  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });

  // 206 es la respuesta normal de VTEX para búsquedas paginadas.
  if (!res.ok && res.status !== 206) {
    throw new Error(`${store.id} devolvió ${res.status}`);
  }

  const raw = (await res.json()) as VtexRawProduct[];
  const items: VtexItem[] = [];

  for (const p of raw) {
    const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer;
    const name = p.productName;
    if (offer === undefined || name === undefined || p.link === undefined) continue;

    const priceArs = readPrice(offer);
    if (priceArs === null) continue;

    items.push({
      store,
      productName: name,
      brand: p.brand ?? "",
      url: p.link,
      priceArs,
      stock: offer.AvailableQuantity ?? 0,
    });
  }

  return items;
}
