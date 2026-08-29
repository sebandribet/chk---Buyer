/**
 * Nuestra vista del mandato. SOLO LECTURA.
 *
 * El mandato vive en un smart contract en Solidity que mantiene otro equipo.
 * Este puerto es la única superficie por la que el agente lo toca, y no expone
 * ninguna operación de escritura a propósito: el agente no puede crear, ampliar
 * ni renovar su propia autorización. Si pudiera, el mandato no serviría de nada.
 *
 * Implementaciones: `FakeMandatePort` (local, para tests y demo offline) y la
 * que lea la chain cuando el contrato esté desplegado.
 */

import type { Category } from "./catalog.js";

export interface MandateState {
  mandateId: string;
  active: boolean;
  /** ISO. Presente si fue revocado. */
  revokedAt: string | null;
  /** ISO. */
  expiresAt: string | null;

  budgetTotalArs: number;
  budgetSpentArs: number;
  /** Techo por compra individual, además del presupuesto acumulado. null = sin techo por compra. */
  maxPerPurchaseArs: number | null;

  allowedCategories: Category[];
  /** Allowlist de proveedores. null = cualquiera. */
  allowedSuppliers: string[] | null;

  /**
   * Cuándo leímos este estado (ISO). Con la chain de por medio la lectura
   * siempre es de un momento pasado, y la diferencia importa: por eso el
   * agente vuelve a leer antes de proponer, en vez de guardarse esto.
   */
  readAt: string;
  /** Bloque del que se leyó, cuando la fuente es on-chain. */
  blockNumber: number | null;
  source: "chain" | "fake";
}

export interface MandatePort {
  read(mandateId: string): Promise<MandateState>;
}

/**
 * Borrador de mandato: lo que el agente le propone firmar al humano.
 *
 * Es la salida del modo sugerencia y tiene la forma del `IntentMandate` de AP2.
 * Que sea un borrador no es un detalle de implementación: el agente puede
 * redactarlo pero NO puede firmarlo ni activarlo. La firma es un acto del
 * humano con su clave, y es lo único que convierte esto en autoridad de gasto.
 *
 * Va al equipo de mandatos, que lo lleva al contrato en Solidity.
 */
export interface MandateDraft {
  /** El pedido original del humano, textual. AP2 lo exige. */
  naturalLanguageDescription: string;
  allowedCategories: Category[];
  /** Sugerido a partir de lo que costaría el carrito, no inventado. */
  suggestedBudgetArs: number;
  allowedSuppliers: string[] | null;
  expiresAt: string | null;
  /** Siempre true en un borrador: nadie firma a ciegas. */
  userCartConfirmationRequired: boolean;
}

export function budgetRemainingArs(m: MandateState): number {
  return Math.max(0, m.budgetTotalArs - m.budgetSpentArs);
}

/** Un mandato sirve solo si está activo, no revocado y no vencido, evaluado contra un reloj explícito. */
export function isUsable(m: MandateState, now: Date): { usable: boolean; reason?: string } {
  if (!m.active) return { usable: false, reason: "mandate_inactive" };
  if (m.revokedAt !== null) return { usable: false, reason: "mandate_revoked" };
  if (m.expiresAt !== null && new Date(m.expiresAt).getTime() <= now.getTime()) {
    return { usable: false, reason: "mandate_expired" };
  }
  return { usable: true };
}
