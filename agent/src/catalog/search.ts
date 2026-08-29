/**
 * Discover: encontrar en el marketplace las ofertas que podrían cubrir una necesidad.
 *
 * Esta capa NO decide ni filtra por mandato. Devuelve todo lo que existe para
 * un canonical —incluidos los sustitutos y lo que está sin stock— y deja que el
 * motor de decisión descarte con una razón registrada. Si el filtro viviera acá,
 * las ofertas descartadas desaparecerían del trail y el auditor no podría ver
 * qué alternativas tuvo el agente enfrente.
 */

import type { Offer, Product, Supplier } from "@/contracts/index.js";
import { toOffer } from "@/contracts/index.js";
import { PRODUCTS, SUPPLIERS } from "./data.js";
import { normalizeTerm } from "./normalize.js";

export interface SearchQuery {
  canonical: string;
  /** Atributos pedidos. Se usan para clasificar exacto vs sustituto, no para excluir. */
  attrs?: Record<string, string>;
}

export interface CatalogPort {
  search(query: SearchQuery): Promise<Offer[]>;
}

/**
 * Catálogo en memoria. Cuando el merchant sea un servicio externo (A2A), se
 * reemplaza esta implementación y el resto del agente no se entera.
 */
export class LocalCatalog implements CatalogPort {
  /**
   * Índice por término normalizado. Cada producto entra por su canonical y por
   * cada uno de sus alias, así "café", "cafe" y "cafés" caen en la misma clave.
   * Se arma una vez en el constructor: un catálogo real sería una consulta al
   * merchant, y no queremos que el costo de buscar dependa del tamaño.
   */
  private readonly index = new Map<string, Product[]>();

  constructor(
    private readonly products: Product[] = PRODUCTS,
    private readonly suppliers: Supplier[] = SUPPLIERS,
  ) {
    for (const product of this.products) {
      for (const term of [product.canonical, ...(product.aliases ?? [])]) {
        const key = normalizeTerm(term);
        const bucket = this.index.get(key);
        if (bucket === undefined) this.index.set(key, [product]);
        else bucket.push(product);
      }
    }
  }

  /** Los términos que el catálogo entiende. Sirve para explicar un `no_match`. */
  knownTerms(): string[] {
    return [...this.index.keys()].sort();
  }

  async search(query: SearchQuery): Promise<Offer[]> {
    const offers: Offer[] = [];
    for (const product of this.index.get(normalizeTerm(query.canonical)) ?? []) {
      const supplier = this.suppliers.find((s) => s.id === product.supplierId);
      if (supplier === undefined) continue; // producto huérfano: dato roto, no oferta

      offers.push(toOffer(product, supplier));
    }

    // Orden estable por precio unitario. El desempate por SKU existe para que
    // dos runs con el mismo catálogo produzcan exactamente el mismo trail.
    return offers.sort(
      (a, b) => a.unitPriceArs - b.unitPriceArs || a.product.sku.localeCompare(b.product.sku),
    );
  }
}

/** Cuántos packs hacen falta para cubrir `qty` unidades del producto. */
export function packsNeeded(qty: number, offer: Offer): number {
  return Math.ceil(qty / offer.totalSize);
}
