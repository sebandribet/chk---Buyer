/**
 * Cuánto dura un precio antes de dejar de servir.
 *
 * No todos los rubros se mueven igual. La harina cambia de precio cada semanas;
 * un pasaje de avión cambia varias veces por día. Un catálogo con un solo TTL
 * global elige mal en los dos extremos: refresca de más lo que no se mueve y de
 * menos lo que sí.
 *
 * El TTL vive por rubro y no por categoría a propósito: la categoría existe para
 * los permisos del mandato, y mezclar "qué puedo comprar" con "cuándo vence el
 * precio" hace que cambiar una cosa rompa la otra.
 */

import type { Category } from "@/contracts/index.js";

/** Perfiles de volatilidad. El nombre dice qué tan seguido se mueve el precio. */
export type VolatilityTier = "estable" | "diario" | "intradia";

export const TTL_MINUTES: Record<VolatilityTier, number> = {
  /** Precios de góndola de secos y limpieza: se mueven por semana. */
  estable: 60 * 24 * 3,
  /** Frescos y todo lo que tenga promociones semanales. */
  diario: 60 * 24,
  /**
   * Precio dinámico: vuelos, hotelería, cualquier cosa con subastas o cupos.
   * Hoy ningún rubro nuestro está acá — el escalón existe porque el mecanismo
   * tiene que soportarlo el día que agreguemos uno, no porque lo usemos.
   */
  intradia: 45,
};

/** Volatilidad por defecto según la categoría, cuando el rubro no la declara. */
export const DEFAULT_TIER: Record<Category, VolatilityTier> = {
  alimentos: "diario",
  limpieza: "estable",
  descartables: "estable",
  bebidas_alcoholicas: "estable",
  equipamiento: "estable",
};

export function ttlMinutesFor(tier: VolatilityTier): number {
  return TTL_MINUTES[tier];
}

/** Si un dato bajado en `fetchedAt` ya venció para su volatilidad. */
export function isStale(fetchedAt: string | undefined, tier: VolatilityTier, now: Date): boolean {
  if (fetchedAt === undefined) return true;

  const edadMinutos = (now.getTime() - new Date(fetchedAt).getTime()) / 60_000;
  if (!Number.isFinite(edadMinutos)) return true;

  return edadMinutos > ttlMinutesFor(tier);
}
