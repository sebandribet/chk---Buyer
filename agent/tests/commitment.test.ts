/**
 * Gate de mandato.
 *
 * La propiedad que se verifica: sin mandato firmado no hay compra, con mandato
 * firmado el agente siempre intenta comprar y es el policy engine quien decide.
 */

import { describe, expect, it } from "vitest";
import { harness, rawIntent } from "./support/harness.js";
import { runAgent } from "@/agent/run.js";

const pedidoLeche = {
  needs: [{ canonical: "leche", attrs: { tipo: "descremada" }, qty: 12, unit: "L" as const }],
  budgetArs: 200_000,
};

describe("sin mandato firmado", () => {
  it("no puede comprar, aunque el pedido sea una orden directa", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            ...pedidoLeche,
            description: "Comprá YA 12 litros de leche descremada, es urgente, dale",
          }),
      },
    });

    const run = await runAgent("Comprá YA 12 litros de leche descremada, es urgente, dale", null, h.deps, h.ctx);

    expect(run.outcome).toBeNull();
    expect(run.suggestion?.reason).toBe("no_mandate");

    // El agente igual hizo el trabajo: buscó, comparó y armó el carrito.
    expect(run.suggestion?.lines).toHaveLength(1);
    expect(run.suggestion?.estimatedTotalArs).toBe(16_800);

    // Y no tocó ningún mandato, ni para leerlo.
    expect(h.mandates.readCount()).toBe(0);
    expect(h.ctx.audit.events().filter((e) => e.type === "mandate_read")).toHaveLength(0);
  });

  it("adjunta un borrador de mandato con el mínimo privilegio que alcanza", async () => {
    const h = harness({
      llm: { intent_extraction: () => rawIntent(pedidoLeche) },
    });

    const run = await runAgent("Reponé 12 litros de leche descremada, hasta $200.000", null, h.deps, h.ctx);

    // Solo la categoría que el carrito necesita, no todas las del catálogo.
    expect(run.suggestion?.mandateDraft.allowedCategories).toEqual(["alimentos"]);
    // El borrador nunca se auto-aprueba.
    expect(run.suggestion?.mandateDraft.userCartConfirmationRequired).toBe(true);
    // El presupuesto del borrador usa el techo que el humano dijo.
    expect(run.suggestion?.mandateDraft.suggestedBudgetArs).toBe(200_000);
  });
});

describe("con mandato firmado y vigente", () => {
  it("ejecuta la compra directamente", async () => {
    const h = harness({
      llm: { intent_extraction: () => rawIntent(pedidoLeche) },
    });

    const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.suggestion).toBeNull();
    expect(run.outcome?.status).toBe("proposal");

    // `decide()` lee el mandato dos veces; no hay lectura extra en run.ts.
    expect(h.mandates.readCount()).toBe(2);
  });

  it("mandato revocado = rechazo aunque el pedido sea válido", async () => {
    const h = harness({
      llm: { intent_extraction: () => rawIntent(pedidoLeche) },
    });
    h.mandates.revoke();

    const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.suggestion).toBeNull();
    expect(run.outcome?.status).toBe("rejection");
    if (run.outcome?.status !== "rejection") throw new Error("unreachable");
    expect(run.outcome.reason).toBe("mandate_unusable");
  });
});

describe("preguntas de más", () => {
  it("no frena por preguntas sobre categorías, proveedores ni atributos de ítem", async () => {
    const casos = [
      { field: "constraints.allowed_categories", question: "¿Qué categorías están permitidas?" },
      { field: "needs[0].attrs", question: "¿Qué tipo de leche necesitás?" },
      { field: "constraints.allowed_suppliers", question: "¿Qué proveedores puedo usar?" },
    ];

    for (const pregunta of casos) {
      const h = harness({
        llm: {
          intent_extraction: () => rawIntent({ ...pedidoLeche, questions: [pregunta] }),
        },
      });

      const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

      expect(run.extraction.status).toBe("ok");
      expect(run.outcome?.status).toBe("proposal");
    }
  });

  it("sí frena cuando falta la cantidad", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "leche", qty: 0, unit: "L" }],
            questions: [{ field: "needs[0].qty", question: "¿Cuántos litros necesitás?" }],
          }),
      },
    });

    const run = await runAgent("Comprame leche", "mandate_cafe_del_sur", h.deps, h.ctx);
    expect(run.extraction.status).toBe("clarification_needed");
  });

  it("sí frena cuando falta el presupuesto", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            ...pedidoLeche,
            budgetArs: null,
            questions: [{ field: "constraints.budget_ars", question: "¿Cuál es el presupuesto?" }],
          }),
      },
    });

    const run = await runAgent("Comprá 12 litros de leche", "mandate_cafe_del_sur", h.deps, h.ctx);
    expect(run.extraction.status).toBe("clarification_needed");
  });
});

describe("con mandato caído", () => {
  it("sugiere sin acotarse a un mandato que ya no rige", async () => {
    const h = harness({
      llm: { intent_extraction: () => rawIntent(pedidoLeche) },
      mandate: { expiresAt: "2026-08-01T00:00:00.000Z" },
    });

    const run = await runAgent("Comprá leche", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.outcome?.status).toBe("rejection");
    if (run.outcome?.status !== "rejection") throw new Error("unreachable");
    expect(run.outcome.reason).toBe("mandate_unusable");
  });
});
