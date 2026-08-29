/**
 * La voz del agente.
 *
 * Todo lo demás del sistema produce estructuras: motivos en código
 * (`exploratory_request`), detalles escritos para un auditor, listas de
 * descartes. Eso sirve para la traza y es intragable para la persona del otro
 * lado — "el pedido se leyó como una consulta, no como una orden de compra" es
 * el razonamiento interno filtrándose a la cara del usuario.
 *
 * Este módulo traduce el resultado YA DECIDIDO a una respuesta conversacional.
 *
 * La garantía que lo hace seguro: recibe hechos y devuelve UN string. Su schema
 * de salida no tiene precios, ni productos, ni aprobaciones — no hay forma de
 * que cambie lo que pasó, solo cómo se cuenta. Y por si el modelo igual se
 * manda una cifra inventada en la prosa, hay un chequeo determinístico que la
 * ataja y cae a un texto armado en código.
 */

import { z } from "zod";
import type {
  CartLine,
  ClarificationQuestion,
  DecisionOutcome,
  Suggestion,
} from "@/contracts/index.js";
import type { LlmClient } from "@/llm/index.js";

const ars = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

/** Los hechos que el redactor puede contar. Nada más que esto cruza. */
interface ReplyFacts {
  situacion:
    | "falta_dato"
    | "compra_lista"
    | "necesita_aprobacion"
    | "no_puede"
    | "solo_cotiza";
  /** La pregunta a hacer, si falta un dato. */
  pregunta?: string;
  opciones?: string[];
  items?: { producto: string; cantidad: number; proveedor: string; precio: number }[];
  total?: number;
  entregaDias?: number;
  /** Motivo en lenguaje llano, ya traducido desde el código interno. */
  motivo?: string;
  /** Alternativas que se miraron y por qué no se eligieron. */
  descartes?: { producto: string; porque: string }[];
  presupuestoSugerido?: number;
  /**
   * El rango de gamas por ítem, al cotizar. Incluye las que se pasan del
   * presupuesto: al consultar eso es información, no un problema.
   */
  gamas?: {
    item: string;
    alternativas: { producto: string; gama: string; precio: number; dentroDelPresupuesto: boolean | null }[];
  }[];
}

const SYSTEM = `Te llamás Chk buyer. Sos el agente de compras de insumos de una cafetería, hablando con la persona dueña del comercio por chat.

No te presentes en cada mensaje: la conversación ya arrancó con tu saludo. Usá tu nombre solo si te lo preguntan.

Te paso los hechos de lo que acabás de hacer. Escribí la respuesta que le darías, en castellano rioplatense, natural y breve.

Reglas:
- Hablá como una persona, no como un sistema. Nunca digas "el pedido se leyó como", "status", "mandato no utilizable", "exploratory" ni ningún término técnico.
- 1 a 3 oraciones. Sin listar los productos uno por uno: la interfaz ya los muestra abajo de tu texto.
- Usá SOLO las cifras que te paso. No inventes precios, cantidades ni marcas.
- Si falta un dato, preguntá esa sola cosa, de forma directa y amable.
- Si no podés comprar, explicá por qué en términos del negocio y ofrecé qué sí podés hacer.
- Si el humano venía preguntando por calidad, marca o alternativas, respondé eso — no lo devuelvas al principio.
- Cuando cotizás y hay varias opciones, contá el RANGO en una oración ("va de X a Y", "la de primera marca sale el doble"), no las listes: la interfaz las muestra abajo.
- Una opción por encima del presupuesto que mencionó no es un problema: es información. Mencionala y aclarale cuánto se pasa, no la escondas.
- Nada de emojis. Nada de "¡Hola!" si la conversación ya empezó.

NUNCA DIGAS QUE COMPRASTE. Vos preparás el pedido; el cobro lo hace otra parte del sistema.
Decí "encontré", "te armé", "queda listo para comprar". Nunca "compré", "ya lo pedí", "está comprado".

NO PROMETAS ACCIONES. Solo podés describir lo que ya pasó, que es exactamente lo que dice
"hechos". No ofrezcas cancelar, reservar, avisar, esperar, volver a buscar ni nada por el
estilo: no tenés forma de hacer ninguna de esas cosas. Si el humano quiere otra cosa,
alcanza con que te la pida y el sistema vuelve a correr solo.`;

const ReplyText = z.object({ text: z.string() });

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
};

// ---------------------------------------------------------------------------
// Traducción de resultados a hechos contables
// ---------------------------------------------------------------------------

function itemsFrom(lines: CartLine[]): ReplyFacts["items"] {
  return lines.map((l) => ({
    producto: l.candidate.offer.product.title,
    cantidad: l.candidate.qtyPacks,
    proveedor: l.candidate.offer.supplier.name,
    precio: Math.round(l.candidate.lineTotalArs),
  }));
}

/** Los descartes más informativos: por qué NO se eligió lo que el humano quizás esperaba. */
function descartesFrom(
  rejected: { sku: string; reason: string; detail: string }[],
  lines: CartLine[],
): ReplyFacts["descartes"] {
  const interesantes = new Set([
    "substitutes_not_allowed",
    "substitute_rejected",
    "out_of_stock",
    "brand_mismatch",
    "delivery_too_slow",
    "below_supplier_minimum",
  ]);
  return rejected
    .filter((r) => interesantes.has(r.reason))
    .slice(0, 3)
    .map((r) => ({ producto: r.sku, porque: r.detail }));
}

/** Motivos internos → castellano de negocio. */
function motivoLlano(reason: string, detail: string): string {
  switch (reason) {
    case "no_mandate":
      return "Todavía no hay un mandato firmado, así que puedo buscar y comparar pero no comprar.";
    case "mandate_unusable":
      return "El permiso para comprar no está vigente en este momento.";
    case "exploratory_request":
      return "Todavía no me lo pidió como una compra concreta.";
    case "conditional_request":
      return "La condición que puso todavía no se cumplió.";
    case "category_forbidden":
      return "Eso está fuera de los rubros que el permiso habilita.";
    case "over_budget":
    case "over_max_per_purchase":
      return detail;
    default:
      return detail;
  }
}

export function factsFromOutcome(
  outcome: DecisionOutcome | null,
  suggestion: Suggestion | null,
  questions: ClarificationQuestion[] | null,
): ReplyFacts {
  if (questions !== null && questions.length > 0) {
    const q = questions[0]!;
    return {
      situacion: "falta_dato",
      pregunta: q.question,
      ...(q.options !== undefined && q.options.length > 0 ? { opciones: q.options } : {}),
    };
  }

  if (suggestion !== null) {
    return {
      situacion: "solo_cotiza",
      gamas: suggestion.alternatives.map((a) => ({
        item: a.need.canonical,
        alternativas: a.options.map((o) => ({
          producto: o.candidate.offer.product.title,
          gama: o.tier,
          precio: Math.round(o.candidate.lineTotalArs),
          dentroDelPresupuesto: o.vsBudget === null ? null : o.vsBudget === "dentro",
        })),
      })),
      items: itemsFrom(suggestion.lines),
      total: Math.round(suggestion.estimatedTotalArs),
      motivo: motivoLlano(suggestion.reason, suggestion.detail),
      descartes: descartesFrom(suggestion.rejected, suggestion.lines),
      presupuestoSugerido: suggestion.mandateDraft.suggestedBudgetArs,
    };
  }

  if (outcome === null) return { situacion: "no_puede", motivo: "No pude resolverlo." };

  if (outcome.status === "proposal") {
    return {
      situacion: "compra_lista",
      items: itemsFrom(outcome.cart.lines),
      total: Math.round(outcome.cart.totalArs),
      entregaDias: outcome.cart.deliveryDays,
      descartes: descartesFrom(outcome.rejected, outcome.cart.lines),
    };
  }

  if (outcome.status === "escalation") {
    return {
      situacion: "necesita_aprobacion",
      items: itemsFrom(outcome.cart.lines),
      total: Math.round(outcome.cart.totalArs),
      motivo: motivoLlano(outcome.reason, outcome.detail),
      descartes: descartesFrom(outcome.rejected, outcome.cart.lines),
    };
  }

  return {
    situacion: "no_puede",
    motivo: motivoLlano(outcome.reason, outcome.detail),
    descartes: descartesFrom(outcome.rejected, []),
  };
}

// ---------------------------------------------------------------------------
// Guarda contra cifras inventadas
// ---------------------------------------------------------------------------

/**
 * Toda cifra de plata que aparezca en la respuesta tiene que ser una de las que
 * le pasamos. Si el modelo redondea "$46.200" a "unos $46 mil" está bien; si
 * dice "$52.000" cuando nadie le pasó ese número, la respuesta se descarta.
 *
 * Es barato y ataja el único daño que este módulo podría hacer: la prosa es lo
 * que la persona lee, y una cifra equivocada ahí vale tanto como una cifra
 * equivocada en el carrito.
 */
export function citaCifrasInventadas(text: string, facts: ReplyFacts): boolean {
  const permitidas = new Set<number>();
  const permitir = (n: number | undefined) => {
    if (n === undefined) return;
    permitidas.add(Math.round(n));
    permitidas.add(Math.round(n / 1000)); // "46 mil"
  };

  permitir(facts.total);
  permitir(facts.presupuestoSugerido);
  permitir(facts.entregaDias);
  for (const i of facts.items ?? []) {
    permitir(i.precio);
    permitir(i.cantidad);
  }
  for (const g of facts.gamas ?? []) {
    for (const a of g.alternativas) permitir(a.precio);
  }

  // Solo se controlan cifras con pinta de plata: con $ adelante o con separador
  // de miles. Un "2 kilos" no es una cifra de plata y no tiene por qué estar.
  const cifras = text.match(/\$\s?[\d.,]+|\b\d{1,3}(?:\.\d{3})+\b/g) ?? [];
  for (const raw of cifras) {
    const n = Number(raw.replace(/[$\s.]/g, "").replace(",", "."));
    if (!Number.isFinite(n)) continue;
    if (!permitidas.has(Math.round(n))) return true;
  }
  return false;
}

/**
 * Frases que afirman una acción que el agente no puede hacer.
 *
 * El modelo escribió "puedo cancelar el pedido actual y buscar otra opción":
 * no existe ningún cancelar, y el carrito seguía siendo el mismo. Prometer algo
 * que el sistema no hace es peor que sonar robótico — la persona se queda
 * esperando algo que nunca va a pasar.
 *
 * También ataja el "compré": el agente prepara el pedido, el cobro es de otra
 * parte del sistema, y confundir eso destruye justo la separación que el
 * challenge pide demostrar.
 */
/**
 * `\b` en JavaScript es ASCII: "compré" termina en una letra que el motor
 * considera NO-palabra, así que `\bcompré\b` nunca matchea. La guarda contra la
 * frase más peligrosa —decir que compró— estaba rota justo en su forma más
 * común. Se usan lookarounds con la clase de letras del castellano en vez de
 * `\b`.
 */
const LETRA = "a-záéíóúüñ";
const frase = (patron: string) => new RegExp(`(?<![${LETRA}])(?:${patron})(?![${LETRA}])`, "i");

const ACCIONES_INEXISTENTES: RegExp[] = [
  frase("compr[éeoó]|lo ped[íi]|ya lo ped[íi]|est[áa] comprado|realic[ée] la compra"),
  frase("cancel[a-záéíóúñ]*|anul[a-záéíóúñ]*"),
  frase("te aviso|te notifico|te escribo cuando|voy a estar atento"),
  frase("reserv[oaé]|dej[oé] reservado"),
  frase("vuelvo a (?:buscar|revisar|consultar)"),
  frase("(?:esper[áa]|dame) un (?:momento|minuto|segundo)"),
];

export function prometeAccionesInexistentes(text: string): boolean {
  return ACCIONES_INEXISTENTES.some((re) => re.test(text));
}

/** Respuesta armada en código, para cuando el modelo no está o dijo algo que no cierra. */
export function plantilla(facts: ReplyFacts): string {
  switch (facts.situacion) {
    case "falta_dato":
      return facts.pregunta ?? "¿Me das un dato más?";
    case "compra_lista":
      return `Listo, encontré todo por ${ars(facts.total ?? 0)}${
        facts.entregaDias !== undefined ? ` y llega en ${facts.entregaDias} día(s)` : ""
      }.`;
    case "necesita_aprobacion":
      return `Encontré todo, pero sale ${ars(facts.total ?? 0)} y eso necesita tu visto bueno. ${facts.motivo ?? ""}`.trim();
    case "solo_cotiza":
      return `${facts.motivo ?? ""} Te dejo lo que saldría: ${ars(facts.total ?? 0)}.`.trim();
    case "no_puede":
      return facts.motivo ?? "No puedo hacer eso.";
  }
}

// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "agent";
  content: string;
}

export async function writeReply(
  facts: ReplyFacts,
  conversation: ConversationTurn[],
  llm: LlmClient,
): Promise<string> {
  const user = JSON.stringify(
    {
      conversacion: conversation.slice(-6),
      hechos: facts,
    },
    null,
    2,
  );

  try {
    const { text } = ReplyText.parse(
      await llm.json<unknown>({
        op: "reply_writer",
        system: SYSTEM,
        user,
        schema: { name: "reply", schema: SCHEMA },
      }),
    );

    if (
      text.trim().length === 0 ||
      citaCifrasInventadas(text, facts) ||
      prometeAccionesInexistentes(text)
    ) {
      return plantilla(facts);
    }
    return text.trim();
  } catch {
    return plantilla(facts);
  }
}
