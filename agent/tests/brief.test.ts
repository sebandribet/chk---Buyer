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

describe("validación de pedidos incompletos", () => {
  it("frena cuando faltan los productos", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({ needs: [], budgetArs: 50_000, description: "Comprá insumos de limpieza" }),
      },
    });

    const run = await runAgent("Comprá insumos de limpieza", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("clarification_needed");
    expect(run.suggestion).toBeNull();
  });

  it("frena cuando falta la cantidad de un ítem", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "leche", qty: 0, unit: "L" }],
            budgetArs: 50_000,
            questions: [{ field: "needs[0].qty", question: "¿Cuántos litros necesitás?" }],
          }),
      },
    });

    const run = await runAgent("Comprame leche", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("clarification_needed");
  });

  it("frena cuando falta el presupuesto", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "leche", attrs: { tipo: "descremada" }, qty: 12, unit: "L" }],
            budgetArs: null,
          }),
      },
    });

    const run = await runAgent("Comprá 12 litros de leche descremada", "mandate_cafe_del_sur", h.deps, h.ctx);

    expect(run.extraction.status).toBe("clarification_needed");
  });
});
