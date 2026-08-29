/**
 * El trail tiene que ser legible por un humano sin herramientas.
 *
 * No es cosmética: el challenge pide que el humano, el merchant y un auditor
 * puedan leer la traza, y "está en los eventos" no alcanza si nadie los entiende.
 */

import { describe, expect, it } from "vitest";
import { harness, rawIntent } from "./support/harness.js";
import { runAgent } from "@/agent/run.js";
import { renderRun } from "@/cli/render.js";

/** Quita los códigos ANSI para poder asertar sobre el texto. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("render del trail", () => {
  it("muestra la propuesta con el motivo de cada elección y de cada descarte", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({
            needs: [{ canonical: "detergente", qty: 5, unit: "L" }],
            budgetArs: 20_000,
            description: "Comprá 5 litros de detergente, hasta $20.000",
          }),
      },
    });

    const run = await runAgent(
      "Comprá 5 litros de detergente, hasta $20.000",
      "mandate_cafe_del_sur",
      h.deps,
      h.ctx,
    );
    const out = plain(renderRun(run));

    expect(out).toContain("PROPUESTA DE COMPRA");
    expect(out).toContain("Total $8.200");
    // Las dos lecturas del mandato tienen que verse en la traza impresa.
    expect(out.match(/lectura de mandato/g)).toHaveLength(2);
    // El intento de manipulación queda a la vista del jurado.
    expect(out).toContain("prompt injection");
    // Y los descartes explican contra qué se comparó.
    expect(out).toContain("worse_unit_price");
  });

  it("explica un rechazo por revocación sin dejar carrito", async () => {
    const h = harness({
      llm: {
        intent_extraction: () =>
          rawIntent({ needs: [{ canonical: "detergente", qty: 5, unit: "L" }], budgetArs: 20_000 }),
      },
    });
    h.mandates.revokeAfterReads(2);

    const run = await runAgent("Comprá detergente", "mandate_cafe_del_sur", h.deps, h.ctx);
    const out = plain(renderRun(run));

    expect(out).toContain("RECHAZADO");
    expect(out).toContain("mandate_revoked");
    expect(out).toContain("No se generó carrito");
    expect(out).not.toContain("PROPUESTA DE COMPRA");
  });
});
