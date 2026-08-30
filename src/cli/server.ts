/**
 * Servidor del banco de pruebas.
 *
 * Es una herramienta nuestra para ver el agente funcionando, no la UI del
 * producto — esa la hace el equipo de UX/UI consumiendo los mismos
 * `AuditEvent`. Sin dependencias: `node:http` y un HTML estático.
 *
 *   npm run ui
 *
 * El arco que demuestra, en cuatro actos:
 *
 *   1. el humano pide algo. Sin mandato firmado el agente busca, compara y
 *      redacta un borrador — pero no puede comprar, y eso lo garantiza el tipo
 *      de `suggest()`, que ni siquiera recibe el puerto de mandatos.
 *   2. el humano revisa el borrador, lo edita y lo FIRMA. Nace el Open
 *      Checkout Mandate y queda registrado qué campos tocó.
 *   3. el humano vuelve a pedir. Ahora `decide()` corre contra el mandato real.
 *   4. el humano ejecuta. El merchant firma el carrito, se re-evalúan los
 *      límites, se reserva on-chain y el agente firma el Closed Checkout
 *      Mandate.
 *
 * El estado del mandato vive en `DemoSession` y NO en cada request. El resto
 * del agente sigue sin estado.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SystemClock, SeqIds, createContext } from "@/agent/context.js";
import { RefreshingCatalog } from "@/catalog/live.js";
import { FileCatalogStore } from "@/catalog/store.js";
import { CatalogRefresher } from "@/catalog/refresher.js";
import { runAgent } from "@/agent/run.js";
import { factsFromOutcome, writeReply } from "@/agent/reply.js";
import { createLlmClient, type LlmMode } from "@/llm/index.js";
import { DemoSession } from "./session.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// El catálogo vive mientras vive el proceso: lo que se baja en vivo durante una
// conversación queda disponible para la siguiente, y se persiste a disco.
const store = new FileCatalogStore();
const clock = new SystemClock();

/**
 * Una sola sesión para todo el proceso.
 *
 * Alcanza porque el banco de pruebas lo usa una persona por vez. Un producto
 * necesitaría una por usuario, y ese es exactamente el motivo por el que el
 * estado del mandato está encapsulado acá y no desparramado en variables
 * sueltas: cambiar a "una por usuario" es cambiar dónde se busca el objeto.
 */
let session = new DemoSession(clock, () => store.suppliers());

interface RunRequest {
  /** La conversación completa. El último turno del humano es el pedido vigente. */
  messages: { role: "user" | "agent"; content: string }[];
}

/**
 * Arma el prompt efectivo a partir de la conversación entera.
 *
 * El agente no guarda estado entre turnos a propósito: la conversación vive en
 * el cliente y cada run recibe todo el contexto de nuevo. Así un run sigue
 * siendo reproducible con solo su prompt efectivo — si guardáramos sesión en el
 * servidor, reconstruir por qué el agente decidió algo requeriría reconstruir
 * también el estado que tenía en ese momento.
 *
 * Se manda la conversación completa y no solo el último mensaje porque los
 * pedidos se construyen de a pedazos: "comprame café" + "2 kilos" + "que sea de
 * mejor calidad" son un solo pedido, y leer solo el último es no escuchar.
 */
function composePrompt(messages: RunRequest["messages"]): string {
  const humanos = messages.filter((m) => m.role === "user");
  if (humanos.length <= 1) return humanos[0]?.content ?? "";

  const transcripcion = messages
    .map((m) => `[${m.role === "user" ? "human" : "agent"}] ${m.content}`)
    .join("\n");

  return (
    `Conversation with the human. The request is whatever follows from the WHOLE ` +
    `conversation, with newer messages correcting earlier ones:\n\n${transcripcion}`
  );
}

function resolveMode(): LlmMode {
  const explicit = process.env.LLM_MODE;
  if (explicit === "replay" || explicit === "record" || explicit === "live") return explicit;
  return (process.env.OPENAI_API_KEY ?? "").length > 0 ? "live" : "replay";
}

async function readJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw.length === 0 ? {} : JSON.parse(raw)) as T;
}

function newContext() {
  return createContext(clock, new SeqIds());
}

function deps(ctx: ReturnType<typeof newContext>) {
  const llm = createLlmClient(resolveMode());
  return {
    // El catálogo recibe el log del run: si sale a buscar en vivo o encuentra
    // datos vencidos, queda en la misma traza que el resto de las decisiones.
    catalog: new RefreshingCatalog(store, llm, ctx.audit),
    mandates: session.chain,
    llm,
  };
}

async function handleRun(body: RunRequest) {
  const ctx = newContext();
  const d = deps(ctx);

  const effectivePrompt = composePrompt(body.messages);

  // El mandato sale de la sesión, no del request. Un cliente no puede decir
  // "hacé de cuenta que hay mandato": o hay uno firmado o no lo hay.
  const run = await runAgent(effectivePrompt, session.mandateId, d, ctx);

  // Si el agente no pudo comprar por falta de mandato, lo que propone es un
  // borrador. Se guarda para que el humano lo revise y lo firme.
  if (run.suggestion !== null && session.open === null) {
    session.proposeDraft(run.suggestion.mandateDraft);
  }

  // Si llegó a una propuesta, queda lista para ejecutar. Solo se recuerda el
  // carrito que ya pasó el policy engine.
  if (run.outcome?.status === "proposal") {
    session.rememberCart(run.outcome.cart);
  }

  // La respuesta conversacional se redacta DESPUÉS de decidir, sobre el
  // resultado ya cerrado: el redactor no puede cambiar qué pasó, solo cómo se
  // cuenta.
  const facts = factsFromOutcome(
    run.outcome,
    run.suggestion,
    run.extraction.status === "clarification_needed" ? run.extraction.questions : null,
  );
  const reply = await writeReply(facts, body.messages, d.llm);

  return {
    reply,
    effectivePrompt,
    catalog: { origin: store.origin, products: store.products().length },
    extraction: run.extraction,
    outcome: run.outcome,
    suggestion: run.suggestion,
    events: run.events,
    mandates: await session.snapshot(),
    canExecute: session.pendingCart !== null && session.open !== null,
  };
}

/** El humano firma el borrador. Acá nace la autoridad de gasto. */
async function handleSign(body: { edits?: Record<string, unknown> }) {
  const ctx = newContext();
  await session.signMandate((body.edits ?? {}) as never, ctx);
  return { mandates: await session.snapshot(), events: ctx.audit.events() };
}

/** El humano ejecuta la compra ya aprobada. Acá nacen los closed. */
async function handleExecute() {
  const ctx = newContext();
  const outcome = await session.executePurchase(ctx);
  return {
    purchase: outcome,
    mandates: await session.snapshot(),
    events: ctx.audit.events(),
    canExecute: false,
  };
}

async function handleRevoke() {
  const ctx = newContext();
  await session.revoke(ctx);
  return { mandates: await session.snapshot(), events: ctx.audit.events() };
}

type Handler = () => Promise<unknown>;

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(join(HERE, "ui.html"), "utf8"));
        return;
      }

      const routes: Record<string, Handler> = {
        "POST /run": async () => handleRun(await readJson<RunRequest>(req)),
        "POST /mandate/sign": async () => handleSign(await readJson(req)),
        "POST /mandate/revoke": handleRevoke,
        "POST /purchase": handleExecute,
        // Arranca una sesión limpia: nuevo mandato, nueva chain. Para poder
        // volver a demostrar el arco entero sin reiniciar el proceso.
        "POST /mandate/reset": async () => {
          session = new DemoSession(clock, () => store.suppliers());
          return { mandates: await session.snapshot() };
        },
        "GET /mandates": async () => ({ mandates: await session.snapshot() }),
      };

      const handler = routes[`${req.method} ${req.url}`];
      if (handler !== undefined) {
        const result = await handler();
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`\nTest bench at http://localhost:${PORT}`);
  console.log(`LLM_MODE=${resolveMode()} · catalog ${store.origin}, ${store.products().length} products`);

  // Refresco de fondo: cada barrido mira quién venció según su volatilidad y
  // refresca unos pocos. No es un re-scrape completo cada vez.
  const refresher = new CatalogRefresher(store, createLlmClient(resolveMode()), {
    onRefresh: (canonical, n) => console.log(`  refreshed ${canonical}: ${n} products`),
  });
  const vencidos = refresher.stale().length;
  console.log(`${vencidos} stale item group(s) — refreshed gradually in the background\n`);
  refresher.start();
});
