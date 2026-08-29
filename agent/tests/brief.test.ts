/**
 * Reformulación del pedido.
 *
 * La propiedad crítica de la ficha no es que sea legible: es que NO PUEDE
 * INVENTAR. Se genera desde el intent validado, así que lo que el humano no
 * dijo aparece como faltante, nunca completado con algo razonable. Un agente
 * que "reconstruye" un pedido rellenando huecos es el que compra lo que nadie
 * pidió, con una explicación prolija de por qué estaba bien.
 */

import { describe, expect, it } from "vitest";
import { harness, intentOf, rawIntent } from "./support/harness.js";
import { buildOrderBrief } from "@/agent/brief.js";
import { runAgent } from "@/agent/run.js";

describe("ficha de pedido (committed)", () => {
  it("declara lo que falta en vez de completarlo", () => {
    const intent = intentOf({
      needs: [{ canonical: "arroz", attrs: { tipo: "yamani" }, qty: 5, unit: "kg" }],
      budgetArs: null,
      maxDeliveryDays: null,
    });

    const brief = buildOrderBrief(intent);

    expect(brief.unspecified).toContain("presupuesto");
    expect(brief.unspecified).toContain("plazo de entrega");
    expect(brief.unspecified).toContain("vigencia del pedido");

    // Y ningún número aparece de la nada.
    expect(brief.text).not.toMatch(/\$\s?\d/);
    expect(brief.text).toContain("5 kg de arroz (tipo: yamani)");
  });

  it("refleja exactamente lo que el pedido sí fijó", () => {
    const brief = buildOrderBrief(
      intentOf({
        needs: [{ canonical: "avena", attrs: { tipo: "instantanea" }, qty: 10, unit: "kg" }],
        budgetArs: 20_000,
        maxDeliveryDays: 6,
      }),
    );

    const porEtiqueta = Object.fromEntries(brief.lines.map((l) => [l.label, l.value]));
    expect(porEtiqueta["Techo de gasto"]).toBe("$20.000");
    expect(porEtiqueta["Para cuándo"]).toBe("entrega en hasta 6 día(s)");
    expect(porEtiqueta["Sustitutos"]).toBe("no se aceptan");
    expect(brief.unspecified).not.toContain("presupuesto");
  });

  it("distingue cuando los sustitutos valen solo para algunos ítems", () => {
    const brief = buildOrderBrief(
      intentOf({
        needs: [
          { canonical: "leche", qty: 12, unit: "L", substitutesAllowed: true },
          { canonical: "cafe", qty: 2, unit: "kg" },
        ],
      }),
    );

    const sustitutos = brief.lines.find((l) => l.label === "Sustitutos")?.value;
    expect(sustitutos).toBe("se aceptan solo para leche");
  });

  it("viaja con el intent hasta el carrito, para que el humano confirme lo que se entendió", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "leche", attrs: { tipo: "descremada" }, qty: 12, unit: "L" }],
            budgetArs: 200_000,
            description: "Comprá 12 litros de leche descremada, hasta $200.000",
          }),
      },
    });

    const run = await runAgent("Comprá 12 litros de leche descremada, hasta $200.000", "mandate_cafe_del_sur", h.deps, h.ctx);

    if (run.extraction.status !== "ok") throw new Error("esperaba extracción ok");
    expect(run.extraction.intent.brief.text).toContain("12 L de leche (tipo: descremada)");

    // Y el prompt original se conserva al lado, sin reformular: en una disputa
    // importan los dos, y si difieren esa diferencia es la evidencia.
    expect(run.extraction.intent.naturalLanguageDescription).toBe(
      "Comprá 12 litros de leche descremada, hasta $200.000",
    );
  });
});

describe("brief de búsqueda (exploratory)", () => {
  it("cotiza una consulta sin cantidad, en vez de frenar a preguntar", async () => {
    // "Estoy viendo opciones de detergente" no trae cantidad. Antes el agente
    // preguntaba "¿cuánto necesitás?"; ahora sale a buscar con una cantidad de
    // referencia y muestra precios.
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [],
            budgetArs: null,
            commitment: "exploratory",
            description: "Estoy viendo opciones de detergente para la semana, ¿qué conviene?",
          }),
        search_brief: () => ({
          rationale: "Reposición semanal típica de un comercio chico: 5 litros de detergente.",
          items: [{ canonical: "detergente", attrs: [], reference_qty: 5, unit: "L" }],
        }),
      },
    });

    const run = await runAgent(
      "Estoy viendo opciones de detergente para la semana, ¿qué conviene?",
      "mandate_cafe_del_sur",
      h.deps,
      h.ctx,
    );

    expect(run.extraction.status).toBe("ok");
    expect(run.suggestion?.reason).toBe("exploratory_request");
    expect(run.suggestion?.lines).toHaveLength(1);
    expect(run.suggestion?.estimatedTotalArs).toBe(8_200);

    // La cantidad la puso el agente, no el humano, y queda marcada como tal.
    expect(run.suggestion?.lines[0]?.need.isReference).toBe(true);

    const evento = h.ctx.audit.events().find((e) => e.type === "search_brief_built");
    expect(evento).toMatchObject({ rationale: expect.stringContaining("5 litros") });
  });

  it("no frena aunque el modelo insista en preguntar la cantidad", async () => {
    // El modelo devuelve status clarification_needed pidiendo la cantidad. En
    // un pedido que no compra eso no frena nada: la resuelve el brief.
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [],
            budgetArs: null,
            commitment: "exploratory",
            questions: [{ field: "needs", question: "¿Cuánto detergente necesitás?" }],
          }),
        search_brief: () => ({
          rationale: "Reposición semanal típica: 5 litros.",
          items: [{ canonical: "detergente", attrs: [], reference_qty: 5, unit: "L" }],
        }),
      },
    });

    const run = await runAgent("¿Qué detergente conviene?", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("ok");
    expect(run.suggestion?.lines).toHaveLength(1);
  });

  it("no toca las cantidades cuando el humano sí las dio", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "detergente", qty: 5, unit: "L" }],
            budgetArs: null,
            commitment: "exploratory",
          }),
        // Si el brief se llamara, este stub explota el test a propósito.
        search_brief: () => {
          throw new Error("no debería pedirse un brief: el pedido ya dice qué y cuánto");
        },
      },
    });

    const run = await runAgent("¿Cuánto salen 5 litros de detergente?", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.suggestion?.lines[0]?.need.isReference).toBeUndefined();
    expect(h.ctx.audit.events().filter((e) => e.type === "search_brief_built")).toHaveLength(0);
  });

  it("una orden de compra sin cantidad sigue frenando a preguntar", async () => {
    // La contracara: el brief de búsqueda existe solo en el camino que NO
    // compra. Si hay una orden concreta, la cantidad la tiene que dar el humano.
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({ needs: [], budgetArs: 50_000, commitment: "committed", description: "Comprá insumos de limpieza" }),
        search_brief: () => {
          throw new Error("una orden de compra nunca debe inventar qué comprar");
        },
      },
    });

    const run = await runAgent("Comprá insumos de limpieza", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("clarification_needed");
    expect(run.suggestion).toBeNull();
  });
});
