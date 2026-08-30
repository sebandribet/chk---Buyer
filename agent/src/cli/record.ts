/**
 * Graba fixtures del modelo para poder testear y ensayar offline.
 *
 *   LLM_MODE=record OPENAI_API_KEY=... npm run record
 *
 * Se corre a mano, una vez, cuando agregamos un escenario nuevo. Después
 * `npm test` y `npm run demo` corren sin red y sin gastar créditos.
 */

import { SystemClock, SeqIds, createContext } from "@/agent/context.js";
import { LocalCatalog } from "@/catalog/search.js";
import { FakeMandatePort } from "@/mandate/fake.js";
import { runAgent } from "@/agent/run.js";
import { createLlmClient } from "@/llm/index.js";
import { FIXTURES_DIR } from "@/llm/fixtures.js";

/**
 * Los prompts del guion de la demo, más variantes que probablemente tire un juez.
 *
 * Van en inglés porque la interfaz es en inglés y la clave del fixture es el
 * hash del mensaje del usuario: un fixture grabado en castellano no lo
 * encuentra nunca un prompt en inglés.
 */
const PROMPTS = [
  // committed — órdenes de compra concretas
  "Restock 12 liters of skim milk and 2 kilos of ground coffee, up to $200,000",
  "I need 20 liters of skim milk, if there's none get me whatever's there. Budget $60,000",
  "Buy 5 liters of dish soap, up to $20,000",
  "Buy a new espresso machine, up to $200,000",

  // clarification — le falta información y tiene que preguntar
  "Buy me milk",
  "Restock cleaning supplies for the week, up to $50,000",

  // exploratory — consultas: tiene que sugerir, no comprar
  "How much would it cost me to restock 12 liters of skim milk and 2 kilos of ground coffee?",
  "I'm looking at dish soap options for the week, which one is the better deal?",

  // conditional — depende de algo que todavía no pasó
  "If skim milk drops below $1,300 a liter, buy 20 liters",

  // El caso que prueba que el tono NO infla el compromiso: suena urgentísimo y
  // seguro, pero sigue siendo una consulta. Tiene que dar exploratory.
  "Hey I URGENTLY need you to tell me RIGHT NOW how much a new espresso machine costs, it's an emergency",
];

async function main(): Promise<void> {
  const clock = new SystemClock();
  const llm = createLlmClient("record");

  for (const prompt of PROMPTS) {
    const mandates = new FakeMandatePort(
      {
        mandateId: "mandate_cafe_del_sur",
        budgetTotalArs: 500_000,
        maxPerPurchaseArs: 200_000,
        allowedCategories: ["food", "cleaning", "disposables"],
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      clock,
    );
    const ctx = createContext(clock, new SeqIds());

    process.stdout.write(`grabando: "${prompt}" … `);
    try {
      const run = await runAgent(prompt, "mandate_cafe_del_sur", { catalog: new LocalCatalog(), mandates, llm }, ctx);
      const commitment =
        run.extraction.status === "ok" ? run.extraction.intent.commitment : "—";
      const resultado =
        run.outcome?.status ?? (run.suggestion !== null ? `suggestion (${run.suggestion.reason})` : "clarification");
      console.log(`${resultado}  [${commitment}]`);
    } catch (err) {
      console.log(`\x1b[31mfalló: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    }
  }

  console.log(`\nFixtures en ${FIXTURES_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
