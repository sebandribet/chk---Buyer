/**
 * Catálogo que se completa y se refresca solo.
 *
 * Tres comportamientos, y la diferencia entre ellos es qué tan caro es esperar:
 *
 *   MISS   — el rubro no está. Se busca EN VIVO y el run espera, porque sin
 *            datos la única alternativa es "no lo encontré", que es peor.
 *   VIEJO  — está pero venció. Se devuelve lo que hay AHORA y se refresca en
 *            segundo plano. Hacer esperar por un precio de ayer no vale la pena.
 *   FRESCO — se devuelve y listo.
 *
 * REGLA QUE NO SE NEGOCIA: nada de esto puede romper un run. Si la tienda no
 * responde, tarda de más o devuelve basura, se sigue con lo que había y queda
 * registrado en la traza. Un agente que falla porque un supermercado cambió su
 * API es un agente que falla delante del jurado.
 */

import type { AuditLog, Offer, Product, Supplier } from "@/contracts/index.js";
import type { LlmClient } from "@/llm/index.js";
import { LocalCatalog, type CatalogPort, type SearchQuery } from "./search.js";
import { normalizeTerm } from "./normalize.js";
import { isStale } from "./freshness.js";
import {
  dropUnitPriceOutliers,
  findTarget,
  scrapeTarget,
  tierOf,
  type ScrapeTarget,
  type StoreFetcher,
} from "./scrape/index.js";
import { planFor } from "./scrape/classify-target.js";

/** Guarda el catálogo y lo persiste, para que lo buscado en vivo quede. */
export interface CatalogStore {
  products(): Product[];
  suppliers(): Supplier[];
  /** Reemplaza todos los productos de un rubro por los recién bajados. */
  replace(canonical: string, products: Product[]): void;
}

export interface LiveCatalogOptions {
  /** Cuánto espera un run por una búsqueda en vivo antes de seguir sin ella. */
  missTimeoutMs?: number;
  /** Reloj inyectable, para que los tests no dependan de la hora. */
  now?: () => Date;
  /** Inyectable para tests: por defecto consulta las tiendas de verdad. */
  fetcher?: StoreFetcher;
}

const DEFAULT_MISS_TIMEOUT_MS = 12_000;

export class RefreshingCatalog implements CatalogPort {
  private base: LocalCatalog;
  /** Rubros que ya se están refrescando, para no disparar dos veces lo mismo. */
  private readonly enVuelo = new Set<string>();
  private readonly missTimeoutMs: number;
  private readonly now: () => Date;
  private readonly fetcher: StoreFetcher | undefined;

  constructor(
    private readonly store: CatalogStore,
    private readonly llm: LlmClient,
    private readonly audit: AuditLog | null = null,
    opts: LiveCatalogOptions = {},
  ) {
    this.base = new LocalCatalog(store.products(), store.suppliers());
    this.missTimeoutMs = opts.missTimeoutMs ?? DEFAULT_MISS_TIMEOUT_MS;
    this.now = opts.now ?? (() => new Date());
    this.fetcher = opts.fetcher;
  }

  async search(query: SearchQuery): Promise<Offer[]> {
    const hit = await this.base.search(query);

    if (hit.length === 0) {
      // No hay nada. Vale la pena esperar: la alternativa es no encontrarlo.
      const traidos = await this.fetchNow(query.canonical);
      if (traidos > 0) return this.base.search(query);
      return hit;
    }

    if (this.estaVencido(query.canonical, hit)) {
      // Hay datos, aunque viejos. Se devuelven ya y se refresca para la próxima:
      // esperar por un precio de ayer no le sirve a nadie.
      this.audit?.emit({
        type: "catalog_stale",
        canonical: query.canonical,
        offers: hit.length,
      });
      void this.refreshInBackground(query.canonical);
    }

    return hit;
  }

  /** Si el rubro venció, según la volatilidad de su plan. */
  private estaVencido(canonical: string, offers: Offer[]): boolean {
    const target = findTarget(canonical);
    if (target === null) return false; // sin plan no hay política de vencimiento

    // El más viejo manda: si una sola oferta está podrida, el rubro está podrido.
    const masViejo = offers
      .map((o) => o.product.source?.fetchedAt)
      .sort((a, b) => (a ?? "").localeCompare(b ?? ""))[0];

    return isStale(masViejo, tierOf(target), this.now());
  }

  /** Baja un rubro y lo incorpora. Devuelve cuántos productos quedaron. */
  private async fetchNow(canonical: string): Promise<number> {
    const key = normalizeTerm(canonical);
    if (this.enVuelo.has(key)) return 0;
    this.enVuelo.add(key);

    const started = Date.now();
    try {
      const target = findTarget(canonical) ?? (await this.planFor(canonical));

      const resultado = await withTimeout(
        scrapeTarget(target, this.llm, this.now().toISOString(), this.fetcher),
        this.missTimeoutMs,
      );
      if (resultado === null) {
        this.audit?.emit({
          type: "catalog_fetch_failed",
          canonical,
          detail: `The live search exceeded ${this.missTimeoutMs} ms and was skipped.`,
        });
        return 0;
      }

      const limpios = dropUnitPriceOutliers(resultado.products);
      this.store.replace(target.canonical, limpios);
      this.base = new LocalCatalog(this.store.products(), this.store.suppliers());

      this.audit?.emit({
        type: "catalog_fetched_live",
        canonical: target.canonical,
        category: target.category,
        products: limpios.length,
        ms: Date.now() - started,
      });
      return limpios.length;
    } catch (err) {
      // Una tienda caída no puede tumbar un run. Queda en la traza y se sigue.
      this.audit?.emit({
        type: "catalog_fetch_failed",
        canonical,
        detail: err instanceof Error ? err.message : String(err),
      });
      return 0;
    } finally {
      this.enVuelo.delete(key);
    }
  }

  private async planFor(canonical: string): Promise<ScrapeTarget> {
    const plan = await planFor(canonical, this.llm);
    this.audit?.emit({
      type: "catalog_target_planned",
      canonical,
      category: plan.category,
      query: plan.query ?? canonical,
    });
    return plan;
  }

  private async refreshInBackground(canonical: string): Promise<void> {
    try {
      await this.fetchNow(canonical);
    } catch {
      // Ya quedó registrado en fetchNow. Acá no hay nadie esperando.
    }
  }
}

/** `null` si se pasó del tiempo. No cancela la promesa: solo deja de esperarla. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout;
  const vencimiento = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, vencimiento]);
  } finally {
    clearTimeout(timer!);
  }
}
