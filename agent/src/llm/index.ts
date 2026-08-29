/**
 * Selección del cliente según LLM_MODE:
 *
 *   replay (default) — lee fixtures del disco. Offline, gratis, determinístico.
 *                      Es el modo de los tests y el que conviene para el demo.
 *   record           — llama a OpenAI de verdad y guarda la respuesta a fixtures.
 *                      Se corre una vez, a mano, cuando agregamos un escenario.
 *   live             — llama a OpenAI y no guarda nada.
 *
 * EL DEMO FRENTE AL JURADO VA EN `live`. Replay solo conoce los prompts que
 * grabamos, y la trial by fire es precisamente un prompt que nadie ensayó: en
 * replay, un pedido nuevo no da una respuesta peor, da un error. Replay es para
 * los tests y para ensayar sin quemar créditos, no para el escenario.
 */

import { currentMode, type LlmClient, type LlmRequest, type LlmMode } from "./client.js";
import { readFixture, writeFixture, fixtureKey } from "./fixtures.js";
import { OpenAiClient } from "./openai.js";

export * from "./client.js";
export { OpenAiClient } from "./openai.js";

export class ReplayClient implements LlmClient {
  async json<T>(req: LlmRequest): Promise<T> {
    const fixture = readFixture(req.op, req.user);
    if (fixture === null) {
      throw new Error(
        `No hay fixture para "${fixtureKey(req.op, req.user)}".\n` +
          `Grabalo con: LLM_MODE=record npm run record\n` +
          `Prompt buscado:\n${req.user.slice(0, 400)}`,
      );
    }
    return fixture.response as T;
  }
}

export class RecordingClient implements LlmClient {
  constructor(private readonly inner: LlmClient = new OpenAiClient()) {}

  async json<T>(req: LlmRequest): Promise<T> {
    const response = await this.inner.json<T>(req);
    writeFixture(req.op, req.user, response);
    return response;
  }
}

export function createLlmClient(mode: LlmMode = currentMode()): LlmClient {
  switch (mode) {
    case "replay":
      return new ReplayClient();
    case "record":
      return new RecordingClient();
    case "live":
      return new OpenAiClient();
  }
}

/** Cliente para tests que necesitan una respuesta puntual sin tocar el disco. */
export class StubLlmClient implements LlmClient {
  constructor(private readonly responses: Record<string, unknown>) {}

  async json<T>(req: LlmRequest): Promise<T> {
    if (!(req.op in this.responses)) {
      throw new Error(`StubLlmClient sin respuesta para op="${req.op}".`);
    }
    return this.responses[req.op] as T;
  }
}
