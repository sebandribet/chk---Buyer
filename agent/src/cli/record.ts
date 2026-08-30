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

/** Los prompts del guion de la demo, más variantes que probablemente tire un juez. */
const PROMPTS = [
  // órdenes de compra concretas
  "Reponé 12 litros de leche descremada y 2 kilos de café molido, hasta $200.000",
  "Necesito 20 litros de leche descremada, si no hay conseguime lo que haya. Presupuesto $60.000",
  "Comprá 5 litros de detergente, hasta $20.000",
  "Comprá una cafetera nueva, hasta $200.000",

  // clarification — le falta información y tiene que preguntar
  "Comprame leche",
  "Reponé insumos de limpieza para la semana, hasta $50.000",

  // sin mandato — busca y sugiere sin poder comprar
  "¿Cuánto me saldría reponer 12 litros de leche descremada y 2 kilos de café molido?",
  "Estoy viendo opciones de detergente para la semana, ¿qué conviene?",
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
        allowedCategories: ["alimentos", "limpieza", "descartables"],
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      clock,
    );
    const ctx = createContext(clock, new SeqIds());

    process.stdout.write(`grabando: "${prompt}" … `);
    try {
      const run = await runAgent(prompt, "mandate_cafe_del_sur", { catalog: new LocalCatalog(), mandates, llm }, ctx);
      const resultado =
        run.outcome?.status ?? (run.suggestion !== null ? `suggestion (${run.suggestion.reason})` : "clarification");
      console.log(resultado);
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
