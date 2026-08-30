/**
 * El catálogo en memoria, con persistencia a disco.
 *
 * Lo que se baja en vivo se guarda: si el agente sale a buscar "yerba orgánica"
 * porque alguien la pidió, la próxima vez ya está. Sin esto, cada reinicio
 * volvería a la foto congelada y el trabajo de las búsquedas en vivo se perdería.
 *
 * La escritura es diferida a propósito. Un refresco de fondo puede tocar varios
 * rubros seguidos, y escribir un archivo de 1300 productos en cada uno es
 * trabajo tirado — mientras tanto la memoria ya está actualizada, que es lo que
 * lee el agente.
 */

import { writeFileSync } from "node:fs";
import type { Product, Supplier } from "@/contracts/index.js";
import type { CatalogStore } from "./live.js";
import { normalizeTerm } from "./normalize.js";
import { loadCatalog, SCRAPED_PATH, type CatalogData } from "./loader.js";

const SAVE_DEBOUNCE_MS = 3_000;

export class FileCatalogStore implements CatalogStore {
  private items: Product[];
  private readonly sellers: Supplier[];
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly data: CatalogData = loadCatalog()) {
    this.items = [...data.products];
    this.sellers = [...data.suppliers];
  }

  products(): Product[] {
    return this.items;
  }

  suppliers(): Supplier[] {
    return this.sellers;
  }

  get origin(): CatalogData["origin"] {
    return this.data.origin;
  }

  /**
   * Reemplaza el rubro entero en vez de mezclar lo viejo con lo nuevo.
   *
   * Mezclar dejaría conviviendo precios de hoy con precios de la semana pasada
   * bajo el mismo rubro, y el agente elegiría el más barato de los dos — que es
   * el viejo, y ya no existe.
   */
  replace(canonical: string, products: Product[]): void {
    const key = normalizeTerm(canonical);
    const otros = this.items.filter((p) => normalizeTerm(p.canonical) !== key);

    // Si la búsqueda no trajo nada, se conserva lo que había: quedarse sin el
    // rubro por un mal momento de la tienda es peor que tener datos viejos.
    if (products.length === 0) return;

    this.items = [...otros, ...products];
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  saveNow(): void {
    try {
      const payload = {
        products: this.items,
        suppliers: this.sellers,
        stats: [],
        fetchedAt: new Date().toISOString(),
      };
      writeFileSync(SCRAPED_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } catch {
      // No poder escribir el archivo no puede tumbar el servidor: la memoria
      // ya tiene los datos y el agente sigue funcionando igual.
    }
  }
}
