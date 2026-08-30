/**
 * El módulo de comprensión en el dominio de oficina (USD).
 *
 * Ningún test toca la red: el modelo se scriptea. Lo que se verifica no es que
 * el modelo extraiga bien —eso se mira con fixtures grabados— sino qué hace el
 * agente ANTE una salida dada del modelo. Ahí viven las garantías, y ahí es
 * donde un cambio de prompt no puede aflojarlas sin que un test se ponga rojo.
 */

import { describe, expect, it } from "vitest";
import { createContext, FixedClock } from "@/agent/context.js";
import {
  extractOfficeIntent,
  isExcluded,
  judgeSubstitute,
  summarize,
  type OfficeExtraction,
  type OfficeNeed,
} from "@/agent/office.js";
import { ScriptedLlm, NOW } from "./support/harness.js";

interface RawOfficeOptions {
  commitment?: "exploratory" | "conditional" | "committed";
  needs?: {
    canonical: string;
    attrs?: Record<string, string>;
    qty: number | null;
    excludes?: string[];
    itemBudgetUsd?: number | null;
  }[];
  budgetUsd?: number | null;
  questions?: { field: string; question: string; options?: string[] }[];
  description?: string;
}

/** La forma cruda que devuelve el modelo en `office_intent_extraction`. */
function rawOffice(opts: RawOfficeOptions): unknown {
  return {
    status: (opts.questions ?? []).length > 0 ? "clarification_needed" : "ok",
    commitment: opts.commitment ?? "committed",
    natural_language_description: opts.description ?? "test request",
    needs: (opts.needs ?? [{ canonical: "office chair", qty: 2 }]).map((need) => ({
      canonical: need.canonical,
      attrs: Object.entries(need.attrs ?? {}).map(([key, value]) => ({ key, value })),
      qty: need.qty,
      unit: "unit",
      substitutes_allowed: false,
      excludes: need.excludes ?? [],
      item_budget_usd: need.itemBudgetUsd ?? null,
    })),
    constraints: {
      budget_usd: opts.budgetUsd === undefined ? 500 : opts.budgetUsd,
      quality_preference: "cheapest",
      allowed_suppliers: null,
      max_delivery_days: null,
    },
    questions: (opts.questions ?? []).map((q) => ({
      field: q.field,
      question: q.question,
      options: q.options ?? [],
    })),
  };
}

function ctx() {
  return createContext(new FixedClock(NOW));
}

async function extract(opts: RawOfficeOptions, context = ctx()) {
  const llm = new ScriptedLlm({ office_intent_extraction: () => rawOffice(opts) });
  const extraction = await extractOfficeIntent("prompt", llm, context);
  return { extraction, llm, context };
}

describe("el techo de gasto nunca se asume", () => {
  it("pregunta cuando hay orden de compra y no hay presupuesto", async () => {
    const { extraction } = await extract({ budgetUsd: null });
    expect(extraction.status).toBe("clarification_needed");
    expect(extraction.questions.some((q) => /budget|authorise/i.test(q.question))).toBe(true);
  });

  it("no inventa un techo a partir del catálogo", async () => {
    const { extraction } = await extract({ budgetUsd: null });
    expect(extraction.budgetUsd).toBeNull();
  });

  it("no frena por presupuesto si el pedido no compra", async () => {
    const { extraction } = await extract({ budgetUsd: null, commitment: "exploratory" });
    expect(extraction.status).toBe("ok");
  });
});

describe("la cantidad con techo declarado es un detalle, no un hueco", () => {
  it("un único ítem con techo total no frena por cantidad", async () => {
    const { extraction } = await extract({
      needs: [{ canonical: "chair", qty: null }],
      budgetUsd: 100,
    });
    expect(extraction.status).toBe("ok");
    expect(extraction.needs[0]?.qty).toBeNull();
  });

  it("sin techo total sí pregunta la cantidad", async () => {
    const { extraction } = await extract({
      needs: [{ canonical: "chair", qty: null }],
      budgetUsd: null,
    });
    expect(extraction.status).toBe("clarification_needed");
  });

  it("con dos ítems la cantidad vuelve a hacer falta", async () => {
    const { extraction } = await extract({
      needs: [
        { canonical: "chair", qty: null },
        { canonical: "monitor", qty: 1 },
      ],
      budgetUsd: 900,
    });
    expect(extraction.status).toBe("clarification_needed");
    expect(extraction.questions.some((q) => /how many/i.test(q.question))).toBe(true);
  });
});

describe("qué preguntas del modelo pueden frenar un run", () => {
  it("descarta una repregunta por el tipo de ítem: el pedido ya dice qué y con qué techo", async () => {
    const { extraction } = await extract({
      needs: [{ canonical: "chair", qty: 1 }],
      budgetUsd: 100,
      questions: [
        { field: "seat_type", question: "What specific type of seat do you need?" },
      ],
    });
    expect(extraction.status).toBe("ok");
  });

  it("descarta preguntas por proveedor o plazo: las define el mandato, no el chat", async () => {
    const { extraction } = await extract({
      questions: [
        { field: "allowed_suppliers", question: "Which sellers am I allowed to use?" },
        { field: "max_delivery_days", question: "By when do you need it?" },
      ],
    });
    expect(extraction.status).toBe("ok");
  });

  it("una pregunta por el presupuesto del modelo sí frena", async () => {
    const { extraction } = await extract({
      budgetUsd: null,
      questions: [{ field: "spend_cap", question: "What is your total budget?" }],
    });
    expect(extraction.status).toBe("clarification_needed");
  });

  it("sin ninguna necesidad extraída, frena: no sabemos ni qué comprar", async () => {
    const { extraction } = await extract({ needs: [], budgetUsd: 500 });
    expect(extraction.status).toBe("clarification_needed");
  });
});

describe("no se le pregunta dos veces lo mismo al humano", () => {
  it("colapsa la pregunta de cantidad del modelo con la del código", async () => {
    const { extraction } = await extract({
      needs: [{ canonical: "chair", qty: null }],
      budgetUsd: null,
      questions: [{ field: "qty", question: "How many chairs do you need?" }],
    });
    const quantityQuestions = extraction.questions.filter((q) => /how many/i.test(q.question));
    expect(quantityQuestions).toHaveLength(1);
  });
});

describe("el gate de compromiso", () => {
  it("deja pasar una orden concreta y lo registra", async () => {
    const { extraction, context } = await extract({ commitment: "committed" });
    expect(extraction.commitment).toBe("committed");
    const gate = context.audit.events().find((e) => e.type === "commitment_assessed");
    expect(gate).toMatchObject({ level: "committed", executes: true });
  });

  it("una consulta no ejecuta", async () => {
    const { context } = await extract({ commitment: "exploratory" });
    const gate = context.audit.events().find((e) => e.type === "commitment_assessed");
    expect(gate).toMatchObject({ level: "exploratory", executes: false });
  });

  it("un pedido condicional tampoco ejecuta", async () => {
    const { context } = await extract({ commitment: "conditional" });
    const gate = context.audit.events().find((e) => e.type === "commitment_assessed");
    expect(gate).toMatchObject({ executes: false });
  });
});

describe("la frontera: el modelo describe, no elige", () => {
  it("el prompt de extracción no lleva ningún id de catálogo", async () => {
    const { llm } = await extract({});
    const call = llm.calls.find((c) => c.op === "office_intent_extraction");
    expect(call).toBeDefined();
    expect(call!.user).not.toMatch(/ergonomic-chair|mechanical-keyboard|standing-desk/);
    expect(JSON.stringify(call!.schema)).not.toMatch(/product_id/);
  });

  it("la extracción no expone ningún campo de producto elegido", async () => {
    const { extraction } = await extract({});
    expect(Object.keys(extraction)).not.toContain("productId");
  });
});

describe("la frase que ve el humano", () => {
  const base: OfficeExtraction = {
    status: "ok",
    commitment: "committed",
    naturalLanguageDescription: "buy chairs",
    needs: [
      { canonical: "office chair", attrs: {}, excludes: [], qty: 2, itemBudgetUsd: null, substitutesAllowed: false },
    ],
    budgetUsd: 500,
    maxDeliveryDays: null,
    allowedSuppliers: null,
    qualityPreference: "cheapest",
    questions: [],
  };

  it("no nombra vendedor ni precio de catálogo", () => {
    const text = summarize(base);
    expect(text).not.toMatch(/OfficeCore|SupplyHub|\$189|\$219/);
  });

  it("dice que nada está autorizado todavía", () => {
    expect(summarize(base)).toMatch(/nothing is authorised/i);
  });

  it("avisa cuando la cantidad es un default y no algo que el humano dijo", () => {
    const withoutQty: OfficeExtraction = {
      ...base,
      needs: [{ ...base.needs[0]!, qty: null }],
    };
    expect(summarize(withoutQty)).toMatch(/did not say how many/i);
  });

  it("una consulta se anuncia como consulta", () => {
    expect(summarize({ ...base, commitment: "exploratory" })).toMatch(/without buying/i);
  });
});

describe("juicio de equivalencia, cuando el código no resuelve", () => {
  const need: OfficeNeed = {
    canonical: "stool",
    attrs: { type: "simple" },
    excludes: [],
    qty: 1,
    itemBudgetUsd: null,
    substitutesAllowed: false,
  };
  const candidates = [
    { id: "ergonomic-chair", name: "Ergonomic office chair", description: "mesh, lumbar support" },
    { id: "standing-desk", name: "Electric standing desk", description: "dual motor" },
  ];

  it("acepta un sustituto funcional y lo marca como decidido por el modelo", async () => {
    const context = ctx();
    const llm = new ScriptedLlm({
      office_substitution_judgement: () => ({ id: "ergonomic-chair", reason: "both are seating" }),
    });
    const verdict = await judgeSubstitute(need, candidates, llm, context);
    expect(verdict.id).toBe("ergonomic-chair");
    const event = context.audit.events().find((e) => e.type === "substitution_evaluated");
    expect(event).toMatchObject({ accepted: true, decidedBy: "llm" });
  });

  it("respeta un 'none': ante la duda no se compra", async () => {
    const context = ctx();
    const llm = new ScriptedLlm({
      office_substitution_judgement: () => ({ id: "none", reason: "no seating in the catalog" }),
    });
    const verdict = await judgeSubstitute(need, candidates, llm, context);
    expect(verdict.id).toBeNull();
    const event = context.audit.events().find((e) => e.type === "substitution_evaluated");
    expect(event).toMatchObject({ accepted: false });
  });

  it("descarta un id que no estaba entre los candidatos", async () => {
    const context = ctx();
    const llm = new ScriptedLlm({
      office_substitution_judgement: () => ({ id: "coffee-machine", reason: "invented" }),
    });
    const verdict = await judgeSubstitute(need, candidates, llm, context);
    expect(verdict.id).toBeNull();
  });

  it("no llama al modelo si no hay candidatos", async () => {
    const context = ctx();
    const llm = new ScriptedLlm({});
    const verdict = await judgeSubstitute(need, [], llm, context);
    expect(verdict.id).toBeNull();
    expect(llm.calls).toHaveLength(0);
  });

  it("solo le pasa al modelo campos elegidos a mano del catálogo", async () => {
    const context = ctx();
    const llm = new ScriptedLlm({
      office_substitution_judgement: () => ({ id: "none", reason: "-" }),
    });
    await judgeSubstitute(need, candidates, llm, context);
    const sent = JSON.parse(llm.calls[0]!.user) as { candidates: Record<string, unknown>[] };
    expect(Object.keys(sent.candidates[0]!).sort()).toEqual(["description", "id", "name"]);
  });
});

describe("lo que el humano descartó no se compra", () => {
  it("conserva la exclusión como campo tipado", async () => {
    const { extraction } = await extract({
      needs: [{ canonical: "chair", qty: 1, excludes: ["office chair"] }],
      budgetUsd: 250,
    });
    expect(extraction.needs[0]?.excludes).toEqual(["office chair"]);
  });

  it("veta el producto excluido aunque el matcher llegue a él", () => {
    const chair = { name: "Ergonomic office chair", description: "mesh, lumbar support" };
    expect(isExcluded(chair, ["office chair"])).toBe(true);
  });

  it("no veta nada cuando no se excluyó nada", () => {
    const chair = { name: "Ergonomic office chair", description: "mesh" };
    expect(isExcluded(chair, [])).toBe(false);
  });

  it("compara contra nombre y descripción, no contra el pedido", () => {
    const desk = { name: "Electric standing desk", description: "dual motor, programmable" };
    expect(isExcluded(desk, ["office chair"])).toBe(false);
    expect(isExcluded(desk, ["standing"])).toBe(true);
  });

  it("ignora términos demasiado cortos para discriminar", () => {
    const chair = { name: "Ergonomic office chair", description: "mesh" };
    expect(isExcluded(chair, ["a", "of"])).toBe(false);
  });
});
