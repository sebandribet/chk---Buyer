/**
 * Todo lo que viene del catálogo es dato hostil.
 *
 * Un agente que compra lee texto escrito por quien le quiere vender. Si ese
 * texto llega a un prompt sin filtrar, el vendedor puede darle órdenes al
 * comprador — que es la versión agéntica de escribir tu propio descuento.
 *
 * La defensa acá es estructural, no un clasificador: al modelo solo le llega un
 * subconjunto de campos tipados y elegidos a mano. El texto libre del vendedor
 * nunca cruza. El detector de abajo no es la protección; es instrumentación
 * para que el intento quede registrado en el trail.
 */

import type { Offer } from "@/contracts/index.js";

/**
 * Vista de una oferta que sí puede entrar a un prompt.
 * Deliberadamente sin `sellerNote`, sin `title` y sin `brand`: son los tres
 * campos donde un vendedor puede escribir lo que quiera.
 */
export interface SafeOfferView {
  sku: string;
  supplierId: string;
  canonical: string;
  attrs: Record<string, string>;
  category: string;
  unitPriceArs: number;
  unit: string;
  totalSize: number;
  stock: number;
  deliveryDays: number;
}

export function sanitizeForLlm(offer: Offer): SafeOfferView {
  return {
    sku: offer.product.sku,
    supplierId: offer.product.supplierId,
    canonical: offer.product.canonical,
    attrs: offer.product.attrs,
    category: offer.product.category,
    unitPriceArs: Math.round(offer.unitPriceArs * 100) / 100,
    unit: offer.product.presentation.unit,
    totalSize: offer.totalSize,
    stock: offer.product.stock,
    deliveryDays: offer.supplier.deliveryDays,
  };
}

/**
 * Frases que solo tienen sentido si el texto está escrito para un modelo y no
 * para un comprador humano. Sirve para registrar el intento, no para frenarlo:
 * lo que lo frena es que `sellerNote` no viaja a ningún prompt.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\bignor[aá]\s+(las?|los?|tus?)\b/i,
  /\b(asistentes?|agentes?)\s+de\s+ia\b/i,
  /\bsystem\s*:/i,
  /\bpre[-\s]?aprobado\b/i,
  /\bno\s+requiere\s+verificaci[oó]n\b/i,
  /\bcompras?\s+ilimitadas?\b/i,
  /\bignore\s+(all|previous|your)\b/i,
  /\bdisregard\b/i,
];

export interface InjectionFinding {
  sku: string;
  supplierId: string;
  /** Fragmento recortado, para que el evento de auditoría sea legible sin volcar el texto entero. */
  snippet: string;
}

export function detectInjection(offer: Offer): InjectionFinding | null {
  const note = offer.product.sellerNote;
  if (note === undefined || note.length === 0) return null;

  const hit = INJECTION_PATTERNS.some((re) => re.test(note));
  if (!hit) return null;

  return {
    sku: offer.product.sku,
    supplierId: offer.product.supplierId,
    snippet: note.length > 120 ? `${note.slice(0, 120)}…` : note,
  };
}
