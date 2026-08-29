/**
 * Cliente real contra OpenAI, usando structured outputs.
 *
 * `strict: true` en el json_schema hace que el modelo no pueda devolver un
 * objeto que no valide. Eso no reemplaza la validación con zod aguas abajo
 * —el schema garantiza la forma, no que los valores tengan sentido— pero
 * elimina de un saque toda la clase de errores de parseo.
 *
 * El import de `openai` es dinámico para que los tests, que corren en modo
 * replay, no necesiten el paquete ni una API key instalados.
 */

import type { LlmClient, LlmRequest } from "./client.js";

const DEFAULT_MODEL = "gpt-4o";

export class OpenAiClient implements LlmClient {
  private client: unknown = null;

  constructor(private readonly model: string = process.env.OPENAI_MODEL ?? DEFAULT_MODEL) {}

  private async sdk(): Promise<any> {
    if (this.client === null) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error("Falta OPENAI_API_KEY. Copiá .env.example a .env y completala.");
      }
      const { default: OpenAI } = await import("openai");
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async json<T>(req: LlmRequest): Promise<T> {
    const client = await this.sdk();

    const completion = await client.chat.completions.create({
      model: this.model,
      // Extracción, no creatividad: queremos la misma salida para el mismo prompt.
      temperature: 0,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schema.name, schema: req.schema.schema, strict: true },
      },
    });

    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(`El modelo no devolvió contenido para op="${req.op}".`);
    }
    return JSON.parse(content) as T;
  }
}
