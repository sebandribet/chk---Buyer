/**
 * Cliente contra los modelos hosteados de NVIDIA (endpoint compatible con OpenAI).
 *
 * Se usa para UNA cosa: clasificar texto de producto que ya bajamos —
 * "Café Molido 250 Grs Lavazza" → canonical "cafe", 0.25 kg — durante el
 * scraping. Nunca en el camino de decisión del agente.
 *
 * A diferencia de OpenAI, acá no asumimos structured outputs con `strict`:
 * varios NIM no lo soportan. Pedimos JSON por instrucción y validamos con zod
 * del lado nuestro, que es donde la garantía tiene que estar igual.
 */

import type { LlmClient, LlmRequest } from "./client.js";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
/**
 * Ojo: el listado de `/v1/models` muestra lo que existe en la plataforma, no lo
 * que la cuenta puede invocar. Buena parte de los modelos del listado devuelven
 * 404 ("Function not found for account") o 410. Estos dos se probaron contra
 * esta key y responden; si alguna vez deja de andar, probar con
 * `nvidia/nemotron-3-nano-30b-a3b`, que también responde pero emite su
 * razonamiento antes del JSON (lo recorta `extractJson`).
 */
const DEFAULT_MODEL = "mistralai/mistral-nemotron";

export class NvidiaClient implements LlmClient {
  constructor(
    private readonly model: string = process.env.NVIDIA_MODEL ?? DEFAULT_MODEL,
    private readonly apiKey: string = process.env.NVIDIA_API_KEY ?? "",
  ) {}

  async json<T>(req: LlmRequest): Promise<T> {
    if (this.apiKey.length === 0) {
      throw new Error("Falta NVIDIA_API_KEY. Completala en .env.");
    }

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 1024,
        // Sin esto, un modelo que no contesta cuelga el scrape entero sin
        // decir por qué. El scraper prefiere seguir sin clasificar antes que
        // esperar para siempre.
        messages: [
          {
            role: "system",
            content:
              `${req.system}\n\n` +
              "Respondé ÚNICAMENTE con un objeto JSON válido que cumpla este schema. " +
              "Sin texto antes ni después, sin bloques de markdown.\n" +
              JSON.stringify(req.schema.schema),
          },
          { role: "user", content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.NVIDIA_TIMEOUT_MS ?? 45_000)),
    });

    if (!res.ok) {
      throw new Error(`NVIDIA ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(`NVIDIA no devolvió contenido para op="${req.op}".`);
    }

    return JSON.parse(extractJson(content)) as T;
  }
}

/**
 * Recorta el JSON de una respuesta que puede venir envuelta en prosa o en un
 * bloque de markdown. Sin structured outputs, esto pasa seguido.
 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fenced?.[1] ?? raw).trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`La respuesta no contiene un objeto JSON:\n${raw.slice(0, 300)}`);
  }
  return text.slice(start, end + 1);
}
