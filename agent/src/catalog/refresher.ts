/**
 * Refresco periódico del catálogo.
 *
 * Corre en el servidor y va rubro por rubro, refrescando solo los que
 * vencieron según su propia volatilidad. No refresca todo junto: bajar 55
 * rubros de 3 tiendas de una es un pico de tráfico contra los supermercados y
 * un minuto largo de proceso, y la mayoría de las veces no hacía falta porque
 * casi nada venció.
 *
 * El barrido corre seguido y hace poco. La frecuencia del barrido no es la
 * frecuencia de refresco de un rubro: el barrido solo mira quién venció.
 */

import type { LlmClient } from "@/llm/index.js";
import { isStale } from "./freshness.js";
import { normalizeTerm } from "./normalize.js";
import {
  dropUnitPriceOutliers,
  scrapeTarget,
  SCRAPE_TARGETS,
  tierOf,
  type ScrapeTarget,
  type StoreFetcher,
} from "./scrape/index.js";
import type { CatalogStore } from "./live.js";

export interface RefresherOptions {
  /** Cada cuánto se fija si hay algo vencido. */
  sweepMs?: number;
  /** Cuántos rubros refresca por barrido. Bajo a propósito: es trabajo de fondo. */
  batchSize?: number;
  targets?: ScrapeTarget[];
  /** Inyectable para tests: por defecto consulta las tiendas de verdad. */
  fetcher?: StoreFetcher;
  onRefresh?: (canonical: string, products: number) => void;
}

const DEFAULT_SWEEP_MS = 5 * 60_000;
const DEFAULT_BATCH = 3;

export class CatalogRefresher {
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;

  constructor(
    private readonly store: CatalogStore,
    private readonly llm: LlmClient,
    private readonly opts: RefresherOptions = {},
  ) {}

  /** Rubros vencidos, del más viejo al más nuevo. */
  stale(now = new Date()): ScrapeTarget[] {
    const targets = this.opts.targets ?? SCRAPE_TARGETS;
    const productos = this.store.products();

    const conEdad = targets.map((target) => {
      const delRubro = productos.filter(
        (p) => normalizeTerm(p.canonical) === normalizeTerm(target.canonical),
      );
      // Un rubro sin productos cuenta como vencidísimo: nunca se bajó.
      const masViejo =
        delRubro.length === 0
          ? undefined
          : delRubro
              .map((p) => p.source?.fetchedAt)
              .sort((a, b) => (a ?? "").localeCompare(b ?? ""))[0];

      return { target, masViejo, vencido: isStale(masViejo, tierOf(target), now) };
    });

    return conEdad
      .filter((x) => x.vencido)
      .sort((a, b) => (a.masViejo ?? "").localeCompare(b.masViejo ?? ""))
      .map((x) => x.target);
  }

  /** Un barrido: refresca hasta `batchSize` rubros vencidos. */
  async sweep(now = new Date()): Promise<number> {
    if (this.corriendo) return 0;
    this.corriendo = true;

    let refrescados = 0;
    try {
      const pendientes = this.stale(now).slice(0, this.opts.batchSize ?? DEFAULT_BATCH);

      for (const target of pendientes) {
        try {
          const { products } = await scrapeTarget(target, this.llm, new Date().toISOString(), this.opts.fetcher);
          const limpios = dropUnitPriceOutliers(products);

          // Volver con las manos vacías no es refrescar. `scrapeTarget` captura
          // el error de cada tienda por su cuenta, así que si las tres estaban
          // caídas llega hasta acá sin tirar y con cero productos: contarlo como
          // éxito haría que el rubro figure actualizado sin haberse tocado.
          if (limpios.length === 0) continue;

          this.store.replace(target.canonical, limpios);
          this.opts.onRefresh?.(target.canonical, limpios.length);
          refrescados += 1;
        } catch {
          // Un rubro que falla no frena a los demás ni al servidor. Se vuelve a
          // intentar en el próximo barrido, porque sigue vencido.
        }
      }
    } finally {
      this.corriendo = false;
    }
    return refrescados;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.sweep(), this.opts.sweepMs ?? DEFAULT_SWEEP_MS);
    // Que el proceso pueda terminar aunque el refresher esté programado.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
