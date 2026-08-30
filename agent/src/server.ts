import http from "node:http";
import { SystemClock, SeqIds, createContext } from "@/agent/context.js";
import { LocalCatalog } from "@/catalog/search.js";
import { loadCatalog } from "@/catalog/loader.js";
import { FakeMandatePort } from "@/mandate/fake.js";
import { runAgent } from "@/agent/run.js";
import { createLlmClient } from "@/llm/index.js";
import { factsFromOutcome, writeReply } from "@/agent/reply.js";
import type { Category } from "@/contracts/index.js";
import type { ConversationTurn } from "@/agent/reply.js";

const PORT = Number(process.env.AGENT_PORT ?? 3002);

interface MandateConfig {
  mandateId: string;
  budgetTotalArs: number;
  budgetSpentArs?: number;
  maxPerPurchaseArs?: number | null;
  allowedCategories: Category[];
  allowedSuppliers?: string[] | null;
  expiresAt?: string | null;
  active?: boolean;
}

const MANDATE_CONFIGS: Record<string, MandateConfig> = {
  "MD-001": {
    mandateId: "MD-001",
    budgetTotalArs: 500_000,
    budgetSpentArs: 291_800,
    maxPerPurchaseArs: 170_000,
    allowedCategories: ["descartables", "limpieza"],
    expiresAt: "2026-09-30T00:00:00.000Z",
  },
  "MD-002": {
    mandateId: "MD-002",
    budgetTotalArs: 151_200,
    budgetSpentArs: 98_400,
    maxPerPurchaseArs: 151_200,
    allowedCategories: ["descartables", "limpieza"],
    expiresAt: "2026-10-15T00:00:00.000Z",
  },
  "MD-003": {
    mandateId: "MD-003",
    budgetTotalArs: 368_000,
    budgetSpentArs: 0,
    allowedCategories: ["equipamiento"],
    expiresAt: "2026-11-30T00:00:00.000Z",
    active: false,
  },
};

const catalog = loadCatalog();
const llm = createLlmClient();
const mode = process.env.LLM_MODE ?? "replay";

console.log(
  `[agent] LLM_MODE=${mode} · catálogo ${catalog.origin} (${catalog.products.length} productos)`,
);

function respond(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    respond(res, 200, { status: "ok", mode, products: catalog.products.length });
    return;
  }

  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body) as {
          prompt: string;
          mandateId?: string | null;
          conversation?: ConversationTurn[];
          mandate?: MandateConfig | null;
        };

        const { prompt, conversation = [] } = payload;

        let mandateConfig: MandateConfig;
        let resolvedMandateId: string | null;

        if (payload.mandate) {
          mandateConfig = payload.mandate;
          resolvedMandateId = payload.mandate.mandateId;
        } else if (payload.mandateId && MANDATE_CONFIGS[payload.mandateId]) {
          mandateConfig = MANDATE_CONFIGS[payload.mandateId]!;
          resolvedMandateId = payload.mandateId;
        } else {
          mandateConfig = {
            mandateId: "demo",
            budgetTotalArs: 1_000_000,
            budgetSpentArs: 0,
            maxPerPurchaseArs: 300_000,
            allowedCategories: ["alimentos", "limpieza", "descartables"],
          };
          resolvedMandateId = null;
        }

        const clock = new SystemClock();
        const mandates = new FakeMandatePort(mandateConfig, clock);
        const ctx = createContext(clock, new SeqIds());
        const deps = {
          catalog: new LocalCatalog(catalog.products, catalog.suppliers),
          mandates,
          llm,
        };

        const run = await runAgent(prompt, resolvedMandateId, deps, ctx);

        const questions =
          run.extraction.status === "clarification_needed"
            ? run.extraction.questions
            : null;

        const facts = factsFromOutcome(run.outcome, run.suggestion, questions);
        const reply = await writeReply(facts, conversation, llm);

        respond(res, 200, {
          reply,
          outcome: run.outcome,
          suggestion: run.suggestion,
          extraction: {
            status: run.extraction.status,
          },
        });
      } catch (err) {
        console.error("[agent] error:", err);
        respond(res, 500, {
          error: String(err),
          reply: "No pude procesar el pedido. Revisá la consola del agente.",
        });
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[agent] servidor en http://localhost:${PORT}`);
});
