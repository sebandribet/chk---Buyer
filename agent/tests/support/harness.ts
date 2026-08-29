/**
 * Andamiaje de los tests.
 *
 * Ningún test toca la red ni el disco de fixtures: el LLM se scripta a mano.
 * Eso es deliberado — queremos verificar el comportamiento del agente ante una
 * salida dada del modelo, no la salida del modelo. Que el modelo extraiga bien
 * un prompt real se verifica aparte, grabando fixtures con `npm run record`.
 */

import type { Category, CommitmentLevel, PurchaseIntent, NeedSpec } from "@/contracts/index.js";
import type { LlmClient, LlmRequest } from "@/llm/index.js";
import { FixedClock, SeqIds, createContext, type AgentContext } from "@/agent/context.js";
import { buildOrderBrief } from "@/agent/brief.js";
import { LocalCatalog } from "@/catalog/search.js";
import { FakeMandatePort, type FakeMandateInit } from "@/mandate/fake.js";
import type { RunDeps } from "@/agent/run.js";

/** LLM con una función por operación. Permite respuestas distintas según el request. */
export class ScriptedLlm implements LlmClient {
  public readonly calls: LlmRequest[] = [];

  constructor(private readonly handlers: Record<string, (req: LlmRequest) => unknown>) {}

  async json<T>(req: LlmRequest): Promise<T> {
    this.calls.push(req);
    const handler = this.handlers[req.op];
    if (handler === undefined) {
      throw new Error(`El test no scripteó la operación "${req.op}".`);
    }
    return handler(req) as T;
  }
}

/** Forma cruda que devuelve el modelo en `intent_extraction`, para scriptearla cómodo. */
export interface RawIntentOptions {
  /** Por defecto "committed": la mayoría de los tests verifican el camino de compra. */
  commitment?: CommitmentLevel;
  needs: {
    canonical: string;
    attrs?: Record<string, string>;
    qty: number;
    unit: "L" | "kg" | "unidad";
    substitutesAllowed?: boolean;
    anchor?: "quantity" | "budget";
    itemBudgetArs?: number | null;
  }[];
  budgetArs?: number | null;
  qualityPreference?: "economica" | "equilibrada" | "premium";
  allowedCategories?: Category[];
  forbiddenCategories?: Category[];
  allowedSuppliers?: string[] | null;
  maxDeliveryDays?: number | null;
  description?: string;
  questions?: { field: string; question: string; options?: string[] }[];
}

export function rawIntent(opts: RawIntentOptions): unknown {
  return {
    status: (opts.questions ?? []).length > 0 ? "clarification_needed" : "ok",
    commitment: opts.commitment ?? "committed",
    natural_language_description: opts.description ?? "pedido de prueba",
    needs: opts.needs.map((n) => ({
      canonical: n.canonical,
      attrs: Object.entries(n.attrs ?? {}).map(([key, value]) => ({ key, value })),
      qty: n.qty,
      unit: n.unit,
      substitutes_allowed: n.substitutesAllowed ?? false,
      brand_preference: null,
      anchor: n.anchor ?? "quantity",
      item_budget_ars: n.itemBudgetArs ?? null,
    })),
    constraints: {
      budget_ars: opts.budgetArs === undefined ? 200_000 : opts.budgetArs,
      quality_preference: opts.qualityPreference ?? "economica",
      allowed_categories: opts.allowedCategories ?? [],
      forbidden_categories: opts.forbiddenCategories ?? [],
      allowed_suppliers: opts.allowedSuppliers ?? null,
      max_delivery_days: opts.maxDeliveryDays ?? null,
    },
    intent_expiry: null,
    user_cart_confirmation_required: false,
    questions: (opts.questions ?? []).map((q) => ({
      field: q.field,
      question: q.question,
      options: q.options ?? [],
    })),
  };
}

/** Intent ya armado, para tests que van directo a `decide` sin pasar por el modelo. */
export function intentOf(opts: RawIntentOptions & { intentId?: string }): PurchaseIntent {
  const needs: NeedSpec[] = opts.needs.map((n) => ({
    canonical: n.canonical,
    attrs: n.attrs ?? {},
    qty: n.qty,
    unit: n.unit,
    substitutesAllowed: n.substitutesAllowed ?? false,
    anchor: n.anchor ?? "quantity",
    itemBudgetArs: n.itemBudgetArs ?? null,
  }));
  const sinFicha = {
    commitment: opts.commitment ?? ("committed" as const),
    naturalLanguageDescription: opts.description ?? "pedido de prueba",
    needs,
    constraints: {
      budgetArs: opts.budgetArs === undefined ? 200_000 : opts.budgetArs,
      qualityPreference: opts.qualityPreference ?? "economica",
      allowedCategories: opts.allowedCategories ?? [],
      forbiddenCategories: opts.forbiddenCategories ?? [],
      allowedSuppliers: opts.allowedSuppliers ?? null,
      maxDeliveryDays: opts.maxDeliveryDays ?? null,
    },
    intentExpiry: null,
    userCartConfirmationRequired: false,
  };

  return { intentId: opts.intentId ?? "intent_test", ...sinFicha, brief: buildOrderBrief(sinFicha) };
}

export const NOW = new Date("2026-08-29T12:00:00.000Z");

export const DEFAULT_MANDATE: FakeMandateInit = {
  mandateId: "mandate_cafe_del_sur",
  budgetTotalArs: 500_000,
  budgetSpentArs: 0,
  maxPerPurchaseArs: 200_000,
  allowedCategories: ["alimentos", "limpieza", "descartables"],
  allowedSuppliers: null,
  expiresAt: "2026-09-30T00:00:00.000Z",
};

export interface Harness {
  ctx: AgentContext;
  clock: FixedClock;
  mandates: FakeMandatePort;
  deps: RunDeps;
  llm: ScriptedLlm;
}

export function harness(opts: {
  llm: Record<string, (req: LlmRequest) => unknown>;
  mandate?: Partial<FakeMandateInit>;
  now?: Date;
}): Harness {
  const clock = new FixedClock(opts.now ?? NOW);
  const mandates = new FakeMandatePort({ ...DEFAULT_MANDATE, ...opts.mandate }, clock);
  const llm = new ScriptedLlm(opts.llm);
  const ctx = createContext(clock, new SeqIds());
  return {
    ctx,
    clock,
    mandates,
    llm,
    deps: { catalog: new LocalCatalog(), mandates, llm },
  };
}

/** Acceso tipado a los eventos de auditoría de un tipo dado. */
export function eventsOfType<T extends string>(
  events: readonly { type: string }[],
  type: T,
): Record<string, unknown>[] {
  return events.filter((e) => e.type === type) as unknown as Record<string, unknown>[];
}
