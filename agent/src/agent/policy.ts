/**
 * El policy engine. Determinístico, sin LLM, sin excepciones.
 *
 * Esta es la frontera que define la arquitectura: el modelo propone, esto
 * autoriza. Ninguna función de este archivo recibe texto libre ni llama a un
 * modelo, y esa es la razón por la que un agente adversarial —o un vendedor que
 * escribe instrucciones en la descripción de su producto— no puede negociar con
 * ella. No hay nada con quien negociar.
 *
 * Corolario: cualquier chequeo que se mueva de acá a un prompt deja de ser una
 * garantía y pasa a ser una sugerencia.
 */

import type {
  Category,
  MandateState,
  Offer,
  PurchaseIntent,
  RejectionReason,
} from "@/contracts/index.js";
import { budgetRemainingArs } from "@/contracts/index.js";
import { ars } from "@/money.js";

export interface PolicyCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface OfferVerdict {
  allowed: boolean;
  reason?: RejectionReason;
  detail: string;
}

/**
 * Categorías con las que el agente puede comprar: la intersección de lo que el
 * mandato habilita y lo que el humano pidió en este prompt.
 *
 * Es intersección y no unión a propósito. El prompt no puede ampliar el
 * mandato; a lo sumo puede restringirlo más. Si el humano escribe "comprá
 * también una cafetera" y el mandato no habilita `equipment`, la cafetera no
 * entra — el mandato está firmado on-chain, el prompt es texto.
 */
export function effectiveCategories(intent: PurchaseIntent, mandate: MandateState): Category[] {
  const fromIntent = intent.constraints.allowedCategories;
  const base = fromIntent.length > 0
    ? mandate.allowedCategories.filter((c) => fromIntent.includes(c))
    : mandate.allowedCategories;
  return base.filter((c) => !intent.constraints.forbiddenCategories.includes(c));
}

/** Misma lógica para proveedores: el prompt puede achicar la allowlist del mandato, nunca ampliarla. */
export function effectiveSuppliers(
  intent: PurchaseIntent,
  mandate: MandateState,
): string[] | null {
  const fromMandate = mandate.allowedSuppliers;
  const fromIntent = intent.constraints.allowedSuppliers;
  if (fromMandate === null) return fromIntent;
  if (fromIntent === null) return fromMandate;
  return fromMandate.filter((s) => fromIntent.includes(s));
}

/** Chequeos por oferta individual, antes de que compita con las demás. */
export function checkOffer(
  offer: Offer,
  opts: {
    categories: Category[];
    suppliers: string[] | null;
    maxDeliveryDays: number | null;
    packsNeeded: number;
  },
): OfferVerdict {
  const { product, supplier } = offer;

  if (!opts.categories.includes(product.category)) {
    return {
      allowed: false,
      reason: "category_forbidden",
      detail: `Category "${product.category}" is outside the mandate (allowed: ${opts.categories.join(", ") || "none"}).`,
    };
  }

  if (opts.suppliers !== null && !opts.suppliers.includes(supplier.id)) {
    return {
      allowed: false,
      reason: "supplier_not_allowed",
      detail: `Supplier "${supplier.name}" is not on the mandate allowlist.`,
    };
  }

  if (product.stock === 0) {
    return { allowed: false, reason: "out_of_stock", detail: `Out of stock at ${supplier.name}.` };
  }

  if (product.stock < opts.packsNeeded) {
    return {
      allowed: false,
      reason: "insufficient_stock",
      detail: `Needs ${opts.packsNeeded} packs and ${supplier.name} has ${product.stock}.`,
    };
  }

  if (opts.maxDeliveryDays !== null && supplier.deliveryDays > opts.maxDeliveryDays) {
    return {
      allowed: false,
      reason: "delivery_too_slow",
      detail: `Delivers in ${supplier.deliveryDays} day(s), the request accepts up to ${opts.maxDeliveryDays}.`,
    };
  }

  return { allowed: true, detail: `Allowed: ${supplier.name}, $${offer.unitPriceArs.toFixed(2)}/${product.presentation.unit}.` };
}

export interface BudgetVerdict {
  passed: boolean;
  reason?: RejectionReason;
  detail: string;
  checks: PolicyCheck[];
}

/**
 * Chequeo del total contra los tres techos que existen: el del prompt, el techo
 * por compra del mandato y el presupuesto acumulado que queda en el mandato.
 * Los tres se evalúan siempre y los tres quedan registrados, aunque el primero
 * ya haya fallado — el auditor quiere saber por cuánto se pasó de cada uno, no
 * solo cuál saltó primero.
 */
export function checkBudget(
  totalArs: number,
  intent: PurchaseIntent,
  mandate: MandateState,
): BudgetVerdict {
  const checks: PolicyCheck[] = [];
  let firstFailure: { reason: RejectionReason; detail: string } | null = null;

  const record = (check: string, passed: boolean, detail: string, reason: RejectionReason) => {
    checks.push({ check, passed, detail });
    if (!passed && firstFailure === null) firstFailure = { reason, detail };
  };

  const promptBudget = intent.constraints.budgetArs;
  if (promptBudget !== null) {
    const ok = totalArs <= promptBudget;
    record(
      "prompt_budget",
      ok,
      `Total ${ars(totalArs)} vs the request budget ${ars(promptBudget)}.`,
      "over_budget",
    );
  }

  if (mandate.maxPerPurchaseArs !== null) {
    const ok = totalArs <= mandate.maxPerPurchaseArs;
    record(
      "mandate_max_per_purchase",
      ok,
      `Total ${ars(totalArs)} vs per-purchase cap ${ars(mandate.maxPerPurchaseArs)}.`,
      "over_max_per_purchase",
    );
  }

  const remaining = budgetRemainingArs(mandate);
  const ok = totalArs <= remaining;
  record(
    "mandate_budget_remaining",
    ok,
    `Total ${ars(totalArs)} vs mandate remaining balance ${ars(remaining)}.`,
    "over_budget",
  );

  if (firstFailure !== null) {
    const failure = firstFailure as { reason: RejectionReason; detail: string };
    return { passed: false, reason: failure.reason, detail: failure.detail, checks };
  }
  return { passed: true, detail: `Total ${ars(totalArs)} is within every limit.`, checks };
}
