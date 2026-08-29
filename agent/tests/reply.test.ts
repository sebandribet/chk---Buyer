/**
 * La voz del agente, y sus dos frenos.
 *
 * El redactor existe para que la persona no lea el razonamiento interno del
 * sistema. Pero un módulo que escribe libremente sobre plata puede mentir de dos
 * maneras: diciendo una cifra que nadie calculó, o prometiendo una acción que el
 * sistema no puede hacer. Las dos se atajan en código, no con una instrucción
 * en el prompt — porque una instrucción se puede desobedecer y esto no.
 */

import { describe, expect, it } from "vitest";
import {
  citaCifrasInventadas,
  prometeAccionesInexistentes,
  plantilla,
  factsFromOutcome,
} from "@/agent/reply.js";
import { harness, intentOf } from "./support/harness.js";
import { decide, suggest } from "@/agent/decide.js";

const hechos = {
  situacion: "compra_lista" as const,
  items: [{ producto: "Café", cantidad: 2, proveedor: "Día", precio: 36_000 }],
  total: 36_000,
  entregaDias: 3,
};

describe("cifras inventadas", () => {
  it("acepta las cifras que se le pasaron", () => {
    expect(citaCifrasInventadas("Te armé el pedido por $36.000, llega en 3 días.", hechos)).toBe(false);
  });

  it("acepta un redondeo en palabras", () => {
    expect(citaCifrasInventadas("Sale unos 36 mil pesos.", hechos)).toBe(false);
  });

  it("rechaza una cifra que nadie calculó", () => {
    // Es el único daño real que este módulo puede hacer: la prosa es lo que la
    // persona lee, y un precio equivocado ahí vale igual que uno en el carrito.
    expect(citaCifrasInventadas("Te lo consigo por $52.000.", hechos)).toBe(true);
  });

  it("no confunde una cantidad con un precio", () => {
    expect(citaCifrasInventadas("Son 2 kilos de café.", hechos)).toBe(false);
  });
});

describe("acciones que el agente no puede hacer", () => {
  const casos: { texto: string; porque: string }[] = [
    { texto: "Listo, compré 2 kilos de café.", porque: "dice que compró — el cobro es de otra parte del sistema" },
    { texto: "Puedo cancelar el pedido actual y buscar otra opción.", porque: "no existe cancelar un pedido" },
    { texto: "Te aviso cuando baje de precio.", porque: "no puede avisar nada" },
    { texto: "Dejo reservado el stock.", porque: "no puede reservar" },
    { texto: "Esperá un momento que reviso.", porque: "no hay proceso en segundo plano" },
  ];

  for (const caso of casos) {
    it(`rechaza: ${caso.porque}`, () => {
      expect(prometeAccionesInexistentes(caso.texto)).toBe(true);
    });
  }

  it("acepta una respuesta que solo describe lo que pasó", () => {
    expect(prometeAccionesInexistentes("Te armé el pedido, queda listo para comprar.")).toBe(false);
  });
});

describe("plantilla de respaldo", () => {
  it("responde igual sin modelo", () => {
    // Si el redactor falla o miente, la conversación sigue: la respuesta se
    // arma en código con los mismos hechos.
    expect(plantilla(hechos)).toContain("$36.000");
    expect(prometeAccionesInexistentes(plantilla(hechos))).toBe(false);
  });

  it("no filtra jerga interna en un rechazo", () => {
    const facts = factsFromOutcome(
      { status: "rejection", reason: "category_forbidden", detail: "x", rejected: [], unmet: [] },
      null,
      null,
    );
    const texto = plantilla(facts);
    expect(texto).not.toMatch(/category_forbidden|status|mandate/i);
    expect(texto).toContain("rubros");
  });
});

describe("preferencia de calidad", () => {
  const cafe = [{ canonical: "cafe", attrs: { tipo: "molido" }, qty: 2, unit: "kg" as const }];

  it("por defecto elige lo más barato para cubrir la necesidad", async () => {
    const h = harness({ llm: {} });
    const outcome = await decide(intentOf({ needs: cafe }), "mandate_cafe_del_sur", h.deps, h.ctx);

    if (outcome.status !== "proposal") throw new Error(`esperaba proposal, hubo ${outcome.status}`);
    expect(outcome.cart.lines[0]?.candidate.offer.product.sku).toBe("NOR-CAF-1K");
    expect(outcome.cart.totalArs).toBe(37_000);
  });

  it("con calidad premium elige otra cosa, y sigue dentro del presupuesto", async () => {
    // "Quiero de mejor calidad" tiene que cambiar el resultado. Si devuelve el
    // mismo carrito, el agente parece no estar escuchando.
    const h = harness({ llm: {} });
    const outcome = await decide(
      intentOf({ needs: cafe, qualityPreference: "premium", budgetArs: 200_000 }),
      "mandate_cafe_del_sur",
      h.deps,
      h.ctx,
    );

    if (outcome.status !== "proposal") throw new Error(`esperaba proposal, hubo ${outcome.status}`);
    expect(outcome.cart.lines[0]?.candidate.offer.product.sku).not.toBe("NOR-CAF-1K");
    expect(outcome.cart.totalArs).toBeLessThanOrEqual(200_000);
  });

  it("premium no puede pasarse del presupuesto", async () => {
    // El techo lo sigue poniendo el mandato: "lo mejor" nunca es "lo que sea".
    const h = harness({ llm: {} });
    const outcome = await decide(
      intentOf({ needs: cafe, qualityPreference: "premium", budgetArs: 40_000 }),
      "mandate_cafe_del_sur",
      h.deps,
      h.ctx,
    );

    if (outcome.status !== "proposal") throw new Error(`esperaba proposal, hubo ${outcome.status}`);
    expect(outcome.cart.totalArs).toBeLessThanOrEqual(40_000);
  });
});

describe("el presupuesto no recorta una cotización", () => {
  // El presupuesto define qué se puede COMPRAR, no qué se puede MOSTRAR.
  // Recortar una consulta al techo esconde justo la información que se está
  // pidiendo: cuánto más sale el bueno.
  const cafe = [{ canonical: "cafe", attrs: { tipo: "molido" }, qty: 2, unit: "kg" as const }];

  it("muestra opciones por encima del presupuesto, marcadas", async () => {
    const h = harness({ llm: {} });
    const s = await suggest(
      intentOf({ needs: cafe, budgetArs: 20_000 }),
      null,
      "exploratory_request",
      "consulta",
      h.deps,
      h.ctx,
    );

    const opciones = s.alternatives[0]?.options ?? [];
    expect(opciones.length).toBeGreaterThan(1);
    expect(opciones.some((o) => o.vsBudget === "por_encima")).toBe(true);
  });

  it("ordena el abanico por precio por unidad, igual que las gamas", async () => {
    const h = harness({ llm: {} });
    const s = await suggest(
      intentOf({ needs: cafe, budgetArs: 20_000 }),
      null,
      "exploratory_request",
      "consulta",
      h.deps,
      h.ctx,
    );

    // El orden acompaña a la etiqueta: económica → premium es de menor a mayor
    // precio POR UNIDAD, que es la señal de gama. El total a pagar puede no
    // seguir ese orden —una bolsa de 5kg es más barata por kilo y más cara de
    // comprar— y por eso la interfaz muestra las dos cifras.
    const unitarios = (s.alternatives[0]?.options ?? []).map((o) => o.candidate.offer.unitPriceArs);
    expect([...unitarios].sort((a, b) => a - b)).toEqual(unitarios);
  });

  it("comprando, en cambio, el presupuesto sí manda", async () => {
    // La otra mitad: al comprar, pedir calidad premium no puede empujar el
    // carrito por encima del techo.
    const h = harness({ llm: {} });
    const outcome = await decide(
      intentOf({ needs: cafe, qualityPreference: "premium", budgetArs: 40_000 }),
      "mandate_cafe_del_sur",
      h.deps,
      h.ctx,
    );

    if (outcome.status !== "proposal") throw new Error(`esperaba proposal, hubo ${outcome.status}`);
    expect(outcome.cart.totalArs).toBeLessThanOrEqual(40_000);
  });
});
