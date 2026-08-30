/**
 * El modelo, detrás de una interfaz.
 *
 * Motivo principal: los tests tienen que correr offline, gratis y con el mismo
 * resultado siempre. Un agente cuyo comportamiento solo se puede verificar
 * gastando créditos no se puede verificar.
 *
 * Motivo secundario, y el que importa para la defensa: si el modelo entra por
 * una sola puerta tipada, es evidente dónde interviene y dónde no. Todo lo que
 * no pasa por acá es código determinístico.
 */

export interface JsonSchemaSpec {
  name: string;
  /** JSON Schema, en el dialecto de structured outputs de OpenAI. */
  schema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Identificador estable del call site: "intent_extraction", "substitution_judgement". */
  op: string;
  system: string;
  user: string;
  schema: JsonSchemaSpec;
}

export interface LlmClient {
  json<T>(req: LlmRequest): Promise<T>;
}

export type LlmMode = "replay" | "record" | "live";

export function currentMode(): LlmMode {
  const raw = process.env.LLM_MODE ?? "replay";
  if (raw === "replay" || raw === "record" || raw === "live") return raw;
  throw new Error(`LLM_MODE inválido: "${raw}". Usá replay | record | live.`);
}
