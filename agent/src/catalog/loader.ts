/**
 * De dónde sale el catálogo que usa el agente.
 *
 * Si existe `catalog.scraped.json`, se usan los datos reales bajados con
 * `npm run scrape`. Si no, el marketplace inventado de `data.ts`.
 *
 * Los dos son válidos y el sistema no cambia de comportamiento entre uno y otro
 * — lo único que cambia es de dónde salen los precios, y eso queda registrado
 * producto por producto en `source`. Un catálogo real sin trazabilidad sería
 * peor que uno inventado y honesto.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product, Supplier } from "@/contracts/index.js";
import { PRODUCTS, SUPPLIERS } from "./data.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRAPED_PATH = join(HERE, "..", "..", "catalog.scraped.json");

export interface CatalogData {
  products: Product[];
  suppliers: Supplier[];
  origin: "scraped" | "mock";
  fetchedAt: string | null;
}

export function loadCatalog(): CatalogData {
  if (existsSync(SCRAPED_PATH)) {
    const raw = JSON.parse(readFileSync(SCRAPED_PATH, "utf8")) as {
      products: Product[];
      suppliers: Supplier[];
      fetchedAt: string;
    };
    if (raw.products.length > 0) {
      return {
        products: raw.products,
        suppliers: raw.suppliers,
        origin: "scraped",
        fetchedAt: raw.fetchedAt,
      };
    }
  }
  return { products: PRODUCTS, suppliers: SUPPLIERS, origin: "mock", fetchedAt: null };
}
