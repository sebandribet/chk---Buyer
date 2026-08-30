/**
 * The model, behind a single typed door.
 *
 * Ported from `agente-Nico` (agent/src/llm/*.ts, commit c344d1a). Two reasons
 * the door is narrow, and both matter for the demo:
 *
 *   1. The tests have to run offline, free, and identically every time. An
 *      agent whose behaviour can only be checked by spending credits cannot be
 *      checked.
 *   2. If the model enters through one typed call site, it is obvious where it
 *      intervenes and where it does not. Everything that does not pass through
 *      here is deterministic code.
 *
 * Modes:
 *   replay - read fixtures from disk. Offline, free, deterministic. Tests.
 *   record - call the API for real and save the response to fixtures.
 *   live   - answer from a fixture when there is one, otherwise call the API.
 *
 * With no LLM_MODE set the mode is `live` when an API key is present and
 * `replay` when it is not, so a checkout with no key still runs the demo.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(HERE, "fixtures");
const ENV_FILE = resolve(HERE, "..", "..", ".env");
const DEFAULT_MODEL = "gpt-4o";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Minimal .env reader. The project has no dotenv dependency and this has to
 * work under a plain `node server/index.js`. Never overrides a variable that
 * is already set in the real environment.
 */
export function loadEnvFile(path = ENV_FILE) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

export function currentMode() {
  const raw = process.env.LLM_MODE;
  if (raw === undefined || raw === "") {
    return process.env.OPENAI_API_KEY ? "live" : "replay";
  }
  if (raw === "replay" || raw === "record" || raw === "live") return raw;
  throw new Error(`Invalid LLM_MODE: "${raw}". Use replay | record | live.`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The fixture key is (op, hash of the user message) and deliberately leaves the
 * system prompt out: the system prompt gets rewritten often, and re-recording
 * the whole set over a comma is not worth it. The honest trade-off is that a
 * system-prompt change does NOT invalidate fixtures - re-record by hand when
 * you want to see its real effect.
 */
export function fixtureKey(op, user) {
  return `${op}/${createHash("sha1").update(user).digest("hex").slice(0, 12)}`;
}

export function fixturePath(op, user) {
  return join(FIXTURES_DIR, `${fixtureKey(op, user)}.json`);
}

export function readFixture(op, user) {
  const path = fixturePath(op, user);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeFixture(op, user, response) {
  const path = fixturePath(op, user);
  mkdirSync(dirname(path), { recursive: true });
  const file = { op, user, recordedAt: new Date().toISOString(), response };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/**
 * The real client. `strict: true` on the json_schema means the model cannot
 * return an object that fails the shape. That does not replace validation
 * downstream - the schema guarantees the shape, not that the values make
 * sense - but it removes the whole parse-error class in one move.
 */
export class OpenAiClient {
  constructor(model = process.env.OPENAI_MODEL || DEFAULT_MODEL) {
    this.model = model;
  }

  async json(request) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Copy .env.example to .env and fill it in.");

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: this.model,
        // Extraction, not creativity: the same prompt should give the same output.
        temperature: 0,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: request.schema.name, schema: request.schema.schema, strict: true },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI returned ${response.status} for op="${request.op}". ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(`The model returned no content for op="${request.op}".`);
    }
    return JSON.parse(content);
  }
}

export class ReplayClient {
  async json(request) {
    const fixture = readFixture(request.op, request.user);
    if (fixture === null) {
      throw new Error(
        `No fixture for "${fixtureKey(request.op, request.user)}".\n` +
          "Record it with: LLM_MODE=record npm run agent:record\n" +
          `Prompt looked up:\n${request.user.slice(0, 400)}`,
      );
    }
    return fixture.response;
  }
}

export class RecordingClient {
  constructor(inner = new OpenAiClient()) {
    this.inner = inner;
  }

  async json(request) {
    const response = await this.inner.json(request);
    writeFixture(request.op, request.user, response);
    return response;
  }
}

/** Client for tests that need one specific response without touching disk. */
export class StubLlmClient {
  constructor(responses) {
    this.responses = responses;
  }

  async json(request) {
    if (!(request.op in this.responses)) {
      throw new Error(`StubLlmClient has no response for op="${request.op}".`);
    }
    const canned = this.responses[request.op];
    return typeof canned === "function" ? canned(request) : canned;
  }
}

/**
 * Replay that falls back to the live model, and records what it learns.
 *
 * This is the mode the demo runs in front of an audience. Pure replay only
 * knows the prompts we rehearsed, and the trial by fire is precisely a prompt
 * nobody rehearsed: in replay a new request does not give a worse answer, it
 * throws. Pure live re-charges for every rehearsal. This gives rehearsed
 * prompts for free and still answers a new one.
 */
export class ReplayThenLiveClient {
  constructor(inner = new OpenAiClient()) {
    this.inner = inner;
  }

  async json(request) {
    const fixture = readFixture(request.op, request.user);
    if (fixture !== null) return fixture.response;
    const response = await this.inner.json(request);
    writeFixture(request.op, request.user, response);
    return response;
  }
}

export function createLlmClient(mode = currentMode()) {
  switch (mode) {
    case "replay":
      return new ReplayClient();
    case "record":
      return new RecordingClient();
    case "live":
      return new ReplayThenLiveClient();
    default:
      throw new Error(`Invalid LLM mode: "${mode}".`);
  }
}
