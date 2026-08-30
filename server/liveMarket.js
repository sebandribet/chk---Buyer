/**
 * El mercado, en vivo.
 *
 * Reemplaza al catálogo de 13 productos escritos a mano. El agente sale a
 * buscar lo que el humano pidió en los buscadores públicos de tiendas reales,
 * y el precio que termina firmado en el mandato es un precio que alguien está
 * cobrando hoy, con su link para ir a verificarlo.
 *
 * Quién decide qué, que es lo que hay que poder defender:
 *
 *   modelo  → cómo buscarlo ("something to sit on" → "silla oficina")
 *   tienda  → qué existe y a qué precio        ← el dato duro, de su propia API
 *   modelo  → cuál de los resultados es de verdad lo pedido
 *   código  → cuál es el más barato, y si entra en los topes del mandato
 *
 * El modelo nunca lee ni propone un precio. Los precios salen del JSON de la
 * tienda, el más barato lo elige el código y los topes se evalúan después.
 *
 * Nada de esto puede romper un run. Si una tienda no responde, tarda de más o
 * devuelve basura, se sigue con las que sí contestaron; si no contesta
 * ninguna, el agente dice que no encontró — nunca inventa una oferta.
 */

import { searchVtex, VTEX_STORES } from "../agent/src/catalog/scrape/vtex.ts";
import { planStoreQuery, pickRelevant } from "../agent/src/agent/market.ts";
import { toProviderCurrency } from "../agent/src/payments/fx.ts";
import { isExcluded } from "../agent/src/agent/office.ts";

/** Cuántos resultados por tienda se le muestran al filtro de relevancia. */
const RESULTS_PER_STORE = 10;
/** Cuántas tiendas terminan como vendedores del mandato. */
const MAX_SELLERS = 2;
/** Una tienda lenta no puede colgar el run. */
const STORE_TIMEOUT_MS = 12_000;

function slug(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "item";
}

/** ARS de la tienda → USD del mandato, por el único lugar donde se convierte. */
function arsToUsd(priceArs) {
  const converted = toProviderCurrency({ minor: Math.round(priceArs * 100), currency: "ars" }, "usd");
  return { usd: converted.to.minor / 100, rate: converted.rate };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("store timed out")), ms)),
  ]);
}

/**
 * Busca en todas las tiendas y devuelve un producto con ofertas reales.
 *
 * `null` significa que nadie tiene esto — respuesta honesta y frecuente, no un
 * error. El llamador la convierte en "no encontré", nunca en una oferta.
 */
export async function discoverProduct({ need, llm, ctx }) {
  const plan = await planStoreQuery(need, llm, ctx);

  const searches = await Promise.allSettled(
    VTEX_STORES.map((store) =>
      withTimeout(searchVtex(store, plan.query, RESULTS_PER_STORE), STORE_TIMEOUT_MS)
        .then((items) => ({ store, items })),
    ),
  );

  const reachable = [];
  for (const [index, result] of searches.entries()) {
    const store = VTEX_STORES[index];
    if (result.status === "fulfilled") {
      ctx.audit.emit({
        type: "catalog_fetched_live",
        canonical: need.canonical,
        category: "office",
        products: result.value.items.length,
        ms: 0,
      });
      reachable.push(result.value);
    } else {
      ctx.audit.emit({
        type: "catalog_fetch_failed",
        canonical: need.canonical,
        detail: `${store.name}: ${result.reason?.message ?? "unreachable"}`,
      });
    }
  }

  // Un resultado por tienda: el que el modelo dice que es realmente lo pedido.
  const offers = [];
  for (const { store, items } of reachable) {
    const usable = items.filter(
      (item) =>
        item.priceArs > 0 &&
        !isExcluded({ name: item.productName, description: item.brand }, need.excludes ?? []),
    );
    if (usable.length === 0) continue;

    const { index, reason } = await pickRelevant(
      need,
      usable.map((item, i) => ({ index: i, title: item.productName, brand: item.brand })),
      llm,
      ctx,
    );
    if (index === null) continue;

    const item = usable[index];
    const { usd, rate } = arsToUsd(item.priceArs);
    offers.push({
      merchant: store.name,
      storeId: store.id,
      unitPrice: usd.toFixed(2),
      priceArs: item.priceArs,
      fxRate: rate,
      delivery: `${store.deliveryDays} business days`,
      stock: item.stock > 0 ? `${item.stock} in stock` : "stock not reported",
      title: item.productName,
      brand: item.brand,
      url: item.url,
      relevance: reason,
      fetchedAt: new Date().toISOString(),
    });
  }

  if (offers.length === 0) return null;

  // El código ordena por precio. Los dos más baratos son los vendedores que
  // entran al mandato: el circuito de pago liquida contra dos wallets.
  offers.sort((left, right) => Number(left.unitPrice) - Number(right.unitPrice));
  const selected = offers.slice(0, MAX_SELLERS);

  return {
    id: `live-${slug(plan.label)}`,
    name: plan.label,
    description: selected[0].title,
    query: plan.query,
    searchedAt: new Date().toISOString(),
    offers: selected,
  };
}

export { VTEX_STORES };
