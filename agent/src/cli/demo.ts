/**
 * Demo por terminal: corre un run completo y muestra el trail.
 *
 *   npm run demo -- --prompt "comprá 12L de leche descremada y 2kg de café, hasta $200.000"
 *   npm run demo -- --prompt "..." --revoke-mid-run     # simula al juez revocando
 *   npm run demo -- --prompt "..." --expired            # mandato vencido
 *   npm run demo -- --prompt "..." --allow equipamiento # amplía el mandato
 *
 * Modo del LLM: por defecto `live` si hay OPENAI_API_KEY, `replay` si no.
 * Se puede forzar con LLM_MODE. Para el ensayo conviene `record` una vez y
 * después `replay`, que corre offline.
 */

import type { Category } from "@/contracts/index.js";
import { SystemClock, SeqIds, createContext } from "@/agent/context.js";
import { LocalCatalog } from "@/catalog/search.js";
import { loadCatalog } from "@/catalog/loader.js";
import { FakeMandatePort } from "@/mandate/fake.js";
import { runAgent } from "@/agent/run.js";
import { createLlmClient, type LlmMode } from "@/llm/index.js";
import { renderRun } from "./render.js";

interface Args {
  prompt: string;
  revokeMidRun: boolean;
  expired: boolean;
  noMandate: boolean;
  allow: Category[];
  budget: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    prompt: "Reponé 12 litros de leche descremada y 2 kilos de café molido, hasta $200.000",
    revokeMidRun: false,
    expired: false,
    noMandate: false,
    allow: ["alimentos", "limpieza", "descartables"],
    budget: 500_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--prompt":
        args.prompt = argv[++i] ?? args.prompt;
        break;
      case "--revoke-mid-run":
        args.revokeMidRun = true;
        break;
      case "--expired":
        args.expired = true;
        break;
      case "--no-mandate":
        args.noMandate = true;
        break;
      case "--allow":
        args.allow = [...args.allow, (argv[++i] ?? "") as Category];
        break;
      case "--budget":
        args.budget = Number(argv[++i] ?? args.budget);
        break;
    }
  }
  return args;
}

function resolveMode(): LlmMode {
  const explicit = process.env.LLM_MODE;
  if (explicit === "replay" || explicit === "record" || explicit === "live") return explicit;
  return (process.env.OPENAI_API_KEY ?? "").length > 0 ? "live" : "replay";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = resolveMode();

  const clock = new SystemClock();
  const mandates = new FakeMandatePort(
    {
      mandateId: "mandate_cafe_del_sur",
      budgetTotalArs: args.budget,
      budgetSpentArs: 0,
      maxPerPurchaseArs: 200_000,
      allowedCategories: args.allow,
      allowedSuppliers: null,
      expiresAt: args.expired
        ? new Date(Date.now() - 86_400_000).toISOString()
        : new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
    clock,
  );

  // La revocación se dispara antes de la segunda lectura, que es lo que hace un
  // juez cuando revoca mientras el agente ya empezó a buscar.
  if (args.revokeMidRun) mandates.revokeAfterReads(2);

  const ctx = createContext(clock, new SeqIds());
  const catalogo = loadCatalog();
  const deps = { catalog: new LocalCatalog(catalogo.products, catalogo.suppliers), mandates, llm: createLlmClient(mode) };

  console.log(
    `\x1b[2mLLM_MODE=${mode} · catálogo ${catalogo.origin} (${catalogo.products.length} productos` +
      `${catalogo.fetchedAt !== null ? `, bajado ${catalogo.fetchedAt.slice(0, 16).replace("T", " ")}` : ""})\x1b[0m\n`,
  );
  const run = await runAgent(args.prompt, args.noMandate ? null : "mandate_cafe_del_sur", deps, ctx);
  console.log(renderRun(run));
}

main().catch((err: unknown) => {
  console.error(`\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
  process.exit(1);
});
