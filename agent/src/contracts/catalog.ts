/**
 * Modelo del catálogo. El marketplace es inventado (el challenge lo permite),
 * pero la forma es la de un catálogo B2B real: el mismo producto existe en
 * varios proveedores con presentaciones distintas, y por eso comparar precios
 * exige normalizar por unidad antes de decidir nada.
 */

export type Unit = "L" | "kg" | "unit";

/** Categorías del mandato. `equipment` existe para poder probar el caso de categoría prohibida. */
export type Category = "food" | "cleaning" | "disposables" | "alcoholic_beverages" | "equipment";

export const ALL_CATEGORIES: readonly Category[] = [
  "food",
  "cleaning",
  "disposables",
  "alcoholic_beverages",
  "equipment",
];

/**
 * Cómo viene empaquetado el producto.
 * Un bidón de 5L => { unit: "L", sizePerPack: 5, packQty: 1 }
 * Un pack de 6x1L => { unit: "L", sizePerPack: 1, packQty: 6 }
 * Ambos son 5L y 6L de producto: sin esto no se pueden comparar precios.
 */
export interface Presentation {
  unit: Unit;
  sizePerPack: number;
  packQty: number;
}

export interface Supplier {
  id: string;
  name: string;
  deliveryDays: number;
  minOrderArs: number;
  /** 0..5, reputación del proveedor en el marketplace */
  rating: number;
}

/**
 * De dónde salió este producto y su precio.
 *
 * Sin esto, un catálogo con datos reales y uno inventado son indistinguibles a
 * simple vista — y "¿de dónde sale este precio?" es la primera pregunta que
 * merece un agente que gasta plata. Cada precio tiene que poder rastrearse
 * hasta un documento que efectivamente bajamos.
 */
export interface ProductSource {
  /** Comercio del que se leyó: "jumbo", "dia", "carrefour". */
  store: string;
  /** URL del producto, para poder abrirla y verificar el precio a mano. */
  url: string;
  /** ISO. Un precio sin fecha no significa nada. */
  fetchedAt: string;
}

export interface Product {
  sku: string;
  supplierId: string;
  /** Nombre canónico del ítem, comparable entre proveedores: "leche", "detergente". */
  canonical: string;
  /**
   * Otros nombres con los que un humano puede pedir esto: "lavandina" también
   * es "cloro", "papel higienico" también es "papel". Se comparan normalizados,
   * así que no hace falta listar variantes de tilde ni de plural.
   */
  aliases?: string[];
  title: string;
  brand: string;
  /** Atributos que distinguen variantes del mismo canonical: { tipo: "descremada" } */
  attrs: Record<string, string>;
  category: Category;
  presentation: Presentation;
  /** Precio del pack completo, en ARS. */
  priceArs: number;
  stock: number;
  /**
   * Texto libre escrito por el vendedor. NUNCA es de confianza: es el vector
   * de prompt injection más obvio en un agente que compra. No entra a ningún
   * prompt sin pasar por `sanitizeForLlm`.
   */
  sellerNote?: string;
  /** Ausente en los productos inventados del mock. Presente en los scrapeados. */
  source?: ProductSource;
}

/** Un producto más su proveedor y los cálculos derivados. Es lo que ve el motor de decisión. */
export interface Offer {
  product: Product;
  supplier: Supplier;
  /** sizePerPack * packQty — cuánto producto trae el pack. */
  totalSize: number;
  /** priceArs / totalSize — la única cifra con la que se pueden comparar dos ofertas. */
  unitPriceArs: number;
}

export function totalSize(p: Presentation): number {
  return p.sizePerPack * p.packQty;
}

export function toOffer(product: Product, supplier: Supplier): Offer {
  const size = totalSize(product.presentation);
  return {
    product,
    supplier,
    totalSize: size,
    unitPriceArs: product.priceArs / size,
  };
}
