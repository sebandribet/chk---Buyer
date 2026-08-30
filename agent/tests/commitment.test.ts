/**
 * El gate de compromiso.
 *
 * La propiedad que se verifica acá es una sola, y es la que hay que poder
 * defender: el nivel de compromiso SOLO PUEDE RESTRINGIR. Nunca habilita una
 * compra que el mandato no permitiera ya, y nunca crea un mandato.
 */

import { describe, expect, it } from "vitest";
import { harness, rawIntent } from "./support/harness.js";
import { runAgent } from "@/agent/run.js";

const pedidoLeche = {
  needs: [{ canonical: "leche", attrs: { tipo: "descremada" }, qty: 12, unit: "L" as const }],
  budgetArs: 200_000,
};

describe("sin mandato firmado", () => {
  it("un pedido máximamente comprometido sigue sin poder comprar", async () => {
    // Este es EL test de la feature. Por más que el pedido sea una orden
    // directa y explícita, sin mandato firmado no hay compra: el compromiso no
    // sustituye a una firma.
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            ...pedidoLeche,
            commitment: "committed",
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
      llm: { intent_extraction: () => rawIntent({ ...pedidoLeche, budgetArs: null, commitment: "exploratory" }) },
    });

    const run = await runAgent("¿Cuánto me sale reponer 12 litros de leche descremada?", null, h.deps, h.ctx);

    // Sin presupuesto en el pedido, el borrador lo deriva del carrito real
    // ($16.800 → $17.000), no de un número inventado con margen.
    expect(run.suggestion?.mandateDraft.suggestedBudgetArs).toBe(17_000);
    // Solo la categoría que el carrito necesita, no todas las del catálogo.
    expect(run.suggestion?.mandateDraft.allowedCategories).toEqual(["food"]);
    // Y el borrador nunca se auto-aprueba.
    expect(run.suggestion?.mandateDraft.userCartConfirmationRequired).toBe(true);
  });
});

describe("con mandato firmado y vigente", () => {
  it("un pedido exploratorio sugiere en vez de comprar, aunque podría comprar", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            ...pedidoLeche,
            commitment: "exploratory",
            description: "¿Cuánto me saldría reponer 12 litros de leche descremada?",
          }),
      },
    });

    const run = await runAgent(
      "¿Cuánto me saldría reponer 12 litros de leche descremada?",
      "mandate_cafe_del_sur",
      h.deps,
      h.ctx,
    );

    expect(run.outcome).toBeNull();
    expect(run.suggestion?.reason).toBe("exploratory_request");
    expect(run.suggestion?.estimatedTotalArs).toBe(16_800);

    const gate = h.ctx.audit.events().find((e) => e.type === "commitment_assessed");
    expect(gate).toMatchObject({ level: "exploratory", executes: false });
  });

  it("un pedido condicional todavía no ejecuta", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({ ...pedidoLeche, commitment: "conditional", description: "Si baja de $1.300 el litro, comprá 12 litros" }),
      },
    });

    const run = await runAgent("Si baja de $1.300 el litro, comprá 12 litros", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.outcome).toBeNull();
    expect(run.suggestion?.reason).toBe("conditional_request");
  });

  it("un pedido comprometido sí ejecuta, y el camino de compra sigue leyendo el mandato dos veces", async () => {
    const h = harness({
      llm: { intent_extraction: () => rawIntent({ ...pedidoLeche, commitment: "committed" }) },
    });

    const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.suggestion).toBeNull();
    expect(run.outcome?.status).toBe("proposal");

    // El gate no agregó una lectura extra: siguen siendo las dos de `decide()`.
    expect(h.mandates.readCount()).toBe(2);
  });

  it("el compromiso no puede saltear el mandato: comprometido + revocado = rechazo", async () => {
    // La otra mitad de la asimetría. El gate deja pasar por compromiso, y el
    // policy engine igual rechaza. El compromiso nunca gana contra el mandato.
    const h = harness({
      llm: { intent_extraction: () => rawIntent({ ...pedidoLeche, commitment: "committed" }) },
    });
    h.mandates.revoke();

    const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.suggestion).toBeNull();
    expect(run.outcome?.status).toBe("rejection");

    const gate = h.ctx.audit.events().find((e) => e.type === "commitment_assessed");
    expect(gate).toMatchObject({ executes: true }); // el gate lo dejó pasar…
    // …y el mandato lo frenó igual.
    if (run.outcome?.status !== "rejection") throw new Error("unreachable");
    expect(run.outcome.reason).toBe("mandate_unusable");
  });
});

describe("preguntas de más", () => {
  it("no exige presupuesto para contestar una consulta, ni cuando el modelo lo pregunta", async () => {
    // El modelo devuelve una pregunta por el presupuesto aunque el pedido sea
    // una consulta. Pedirle un techo de gasto a alguien que pregunta "¿cuánto
    // sale?" no tiene sentido: en este camino no se gasta nada.
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            ...pedidoLeche,
            budgetArs: null,
            commitment: "exploratory",
            questions: [
              { field: "constraints.budget_ars", question: "¿Cuál es el presupuesto total disponible?" },
            ],
          }),
      },
    });

    const run = await runAgent("¿Cuánto me sale reponer 12 litros de leche?", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("ok");
    expect(run.suggestion?.reason).toBe("exploratory_request");
    expect(run.suggestion?.estimatedTotalArs).toBe(16_800);
  });

  it("pero sí lo exige cuando el pedido es una orden de compra", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            ...pedidoLeche,
            budgetArs: null,
            commitment: "committed",
            questions: [
              { field: "constraints.budget_ars", question: "¿Cuál es el presupuesto total disponible?" },
            ],
          }),
      },
    });

    const run = await runAgent("Comprá 12 litros de leche", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("clarification_needed");
    expect(run.suggestion).toBeNull();
  });
});

describe("el código decide qué hueco bloquea, no el modelo", () => {
  // El modelo insiste en pedir datos que no son huecos. Si lo dejáramos
  // decidir, el agente pediría permisos en vez de usarlos.
  const casos = [
    {
      nombre: "categorías permitidas (las define el mandato, no el prompt)",
      pregunta: { field: "constraints.allowed_categories", question: "¿Qué categorías están permitidas?" },
    },
    {
      nombre: "atributos del ítem (refinamiento opcional, no dato faltante)",
      pregunta: { field: "needs[0].attrs", question: "¿Qué tipo de leche necesitás?" },
    },
    {
      nombre: "proveedores habilitados",
      pregunta: { field: "constraints.allowed_suppliers", question: "¿Qué proveedores puedo usar?" },
    },
  ];

  for (const caso of casos) {
    it(`no frena por preguntar sobre ${caso.nombre}`, async () => {
      const h = harness({
        llm: {
          intent_extraction: () =>
            rawIntent({ ...pedidoLeche, commitment: "committed", questions: [caso.pregunta] }),
        },
      });

      const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

      expect(run.extraction.status).toBe("ok");
      expect(run.outcome?.status).toBe("proposal");
    });
  }

  it("pero sí frena cuando falta la cantidad", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "leche", qty: 0, unit: "L" }],
            commitment: "committed",
            questions: [{ field: "needs[0].qty", question: "¿Cuántos litros necesitás?" }],
          }),
      },
    });

    const run = await runAgent("Comprame leche", "mandate_cafe_del_sur", h.deps, h.ctx);
    expect(run.extraction.status).toBe("clarification_needed");
  });
});

describe("con mandato caído", () => {
  it("sugiere sin acotarse a un mandato que ya no rige", async () => {
    const h = harness({
      llm: {
        intent_extraction: () => rawIntent({ ...pedidoLeche, commitment: "exploratory" }),
      },
      mandate: { expiresAt: "2026-08-01T00:00:00.000Z" },
    });

    const run = await runAgent("¿Cuánto sale la leche?", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.outcome).toBeNull();
    expect(run.suggestion?.reason).toBe("mandate_unusable");
    expect(run.suggestion?.lines).toHaveLength(1);
  });
});
