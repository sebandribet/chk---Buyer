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
  situation: "ready_to_buy" as const,
  items: [{ product: "Café La Virginia Molido 1kg", quantity: 2, supplier: "Día", price: 36_000 }],
  total: 36_000,
  deliveryDays: 3,
};

describe("cifras inventadas", () => {
  it("acepta las cifras que se le pasaron", () => {
    expect(citaCifrasInventadas("I put the order together for $36,000, it arrives in 3 days.", hechos)).toBe(false);
  });

  it("acepta un redondeo en palabras", () => {
    expect(citaCifrasInventadas("It comes to about 36 thousand pesos.", hechos)).toBe(false);
  });

  it("rechaza una cifra que nadie calculó", () => {
    // Es el único daño real que este módulo puede hacer: la prosa es lo que la
    // persona lee, y un precio equivocado ahí vale igual que uno en el carrito.
    expect(citaCifrasInventadas("I can get it for you for $52,000.", hechos)).toBe(true);
  });

  it("no confunde una cantidad con un precio", () => {
    expect(citaCifrasInventadas("That's 2 kilos of coffee.", hechos)).toBe(false);
  });

  it("lee la coma como separador de miles, no como decimal", () => {
    // El formato de plata pasó a en-US y esta guarda PARSEA lo que `money.ts`
    // ESCRIBE. Si los dos se desincronizan, "$36,000" se leería como 36 y la
    // guarda rechazaría la cifra correcta — que es el modo de falla que más
    // cuesta ver, porque la respuesta cae a la plantilla y parece que anduvo.
    expect(citaCifrasInventadas("It's $36,000 total.", hechos)).toBe(false);

    // "$36" pasa, y está bien que pase: es el mismo permiso que deja decir
    // "about 36 thousand". El precio de dejar redondear en palabras es aceptar
    // la versión en miles de toda cifra permitida.
    expect(citaCifrasInventadas("It's $36 total.", hechos)).toBe(false);

    // Lo que no puede pasar es una cifra que nadie calculó, en cualquier escala.
    expect(citaCifrasInventadas("It's $41,500 total.", hechos)).toBe(true);
  });

  it("deja repetir el presupuesto que dijo el humano", () => {
    // La guarda existe para atajar cifras INVENTADAS. El techo que puso el
    // humano no es una de ellas, y sin esto la respuesta buena —"$36,000, well
    // within your budget of $120,000"— se descartaba entera y caía a la
    // plantilla, que dice lo mismo pero peor.
    const texto = "I found everything for $36,000, well within your $120,000 budget.";
    expect(citaCifrasInventadas(texto, hechos)).toBe(true);
    expect(citaCifrasInventadas(texto, hechos, [120_000])).toBe(false);
  });

  it("no acepta una cifra por venir del propio agente", () => {
    // Solo cuentan los turnos del humano: si una cifra inventada se colara una
    // vez, tomarla por válida en el turno siguiente sería lavarla.
    const conversacion = [
      { role: "user" as const, content: "Buy coffee, up to $120,000" },
      { role: "agent" as const, content: "I can get it for $99,999." },
    ];
    const delHumano = conversacion
      .filter((t) => t.role === "user")
      .flatMap((t) => (t.content.match(/\d{1,3}(?:[.,]\d{3})+/g) ?? []).map((s) => Number(s.replace(/[.,]/g, ""))));

    expect(citaCifrasInventadas("Still $99,999.", hechos, delHumano)).toBe(true);
    expect(citaCifrasInventadas("Still $120,000.", hechos, delHumano)).toBe(false);
  });

  it("lee el formato con punto, que es como lo tipea un argentino", () => {
    // La interfaz está en inglés pero quien la usa es argentino: va a escribir
    // "$120.000" tanto como "$120,000", y los dos son ciento veinte mil.
    expect(citaCifrasInventadas("Within your $120.000 budget.", hechos, [120_000])).toBe(false);
  });
});

describe("acciones que el agente no puede hacer", () => {
  const casos: { texto: string; porque: string }[] = [
    { texto: "Done, I bought 2 kilos of coffee.", porque: "dice que compró — el cobro es de otra parte del sistema" },
    { texto: "I've ordered it from Día.", porque: "dice que hizo el pedido" },
    { texto: "The order was placed this morning.", porque: "afirma una compra en pasiva" },
    { texto: "I can cancel the current order and look for another option.", porque: "no existe cancelar un pedido" },
    { texto: "I'll let you know when the price drops.", porque: "no puede avisar nada" },
    { texto: "I'll keep you posted.", porque: "no hay nada que pueda mandar un mensaje después" },
    { texto: "I'll hold the stock for you.", porque: "no puede reservar" },
    { texto: "Give me a moment while I check.", porque: "no hay proceso en segundo plano" },
    { texto: "I'll check again tomorrow.", porque: "no puede volver a correr solo" },
  ];

  for (const caso of casos) {
    it(`rechaza: ${caso.porque}`, () => {
      expect(prometeAccionesInexistentes(caso.texto)).toBe(true);
    });
  }

  // El prompt pide inglés, pero un prompt es una instrucción y esta guarda
  // existe porque las instrucciones se desobedecen. Con productos en castellano
  // el modelo se va al castellano solo cada tanto, y ahí la guarda tiene que
  // seguir puesta.
  it("sigue atajando el castellano si el modelo se cambia de idioma", () => {
    expect(prometeAccionesInexistentes("Listo, compré 2 kilos de café.")).toBe(true);
    expect(prometeAccionesInexistentes("Te aviso cuando baje de precio.")).toBe(true);
  });

  const permitidas = [
    "I put the order together, it's ready to buy.",
    "I found everything at Día and Jumbo.",
    "The order is ready for your sign-off.",
  ];

  for (const texto of permitidas) {
    it(`acepta: ${texto}`, () => {
      expect(prometeAccionesInexistentes(texto)).toBe(false);
    });
  }
});

describe("plantilla de respaldo", () => {
  it("responde igual sin modelo", () => {
    // Si el redactor falla o miente, la conversación sigue: la respuesta se
    // arma en código con los mismos hechos.
    expect(plantilla(hechos)).toContain("$36,000");
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
    expect(texto).toContain("categories");
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
    expect(opciones.some((o) => o.vsBudget === "above")).toBe(true);
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
