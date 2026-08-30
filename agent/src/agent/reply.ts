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

import { ars } from "@/money.js";

/**
 * Los hechos que el redactor puede contar. Nada más que esto cruza.
 *
 * Las claves están en inglés porque este objeto se serializa y se le manda al
 * modelo tal cual: son parte del prompt, no un detalle interno.
 */
interface ReplyFacts {
  situation:
    | "missing_info"
    | "ready_to_buy"
    | "needs_approval"
    | "cannot"
    | "quote_only";
  /** La pregunta a hacer, si falta un dato. */
  question?: string;
  options?: string[];
  items?: { product: string; quantity: number; supplier: string; price: number }[];
  total?: number;
  deliveryDays?: number;
  /** Motivo en lenguaje llano, ya traducido desde el código interno. */
  reason?: string;
  /** Alternativas que se miraron y por qué no se eligieron. */
  ruledOut?: { product: string; why: string }[];
  suggestedBudget?: number;
  /**
   * El rango de gamas por ítem, al cotizar. Incluye las que se pasan del
   * presupuesto: al consultar eso es información, no un problema.
   */
  tiers?: {
    item: string;
    options: { product: string; tier: string; price: number; withinBudget: boolean | null }[];
  }[];
}

const SYSTEM = `Your name is Chk buyer. You are the supply-purchasing agent for a coffee shop, talking to the owner over chat.

Do not introduce yourself in every message: the conversation already opened with your greeting. Use your name only if they ask.

I give you the facts of what you just did. Write the reply you would give them, in natural, brief English.

Rules:
- Talk like a person, not like a system. Never say "the request was read as", "status", "unusable mandate", "exploratory" or any technical term.
- 1 to 3 sentences. Do not list the products one by one: the interface already shows them under your text.
- Use ONLY the figures I give you. Do not invent prices, quantities or brands.
- Prices are in Argentine pesos and written like $36,000. Never convert them to another currency and never restate them in a different format.
- Every price you are given is the TOTAL cost of covering that item, not a per-unit price. Never write "per liter" or "per kilo" next to one of these figures — you do not have unit prices.
- Product names in the facts are in Spanish because the catalog is Argentine. Keep them exactly as they are — do not translate a product title.
- If something is missing, ask that one thing, directly and warmly.
- If you cannot buy, explain why in business terms and offer what you can do instead.
- If the human was asking about quality, brand or alternatives, answer that — do not send them back to the start.
- When you are quoting and there are several options, describe the RANGE in one sentence ("it runs from X to Y", "the name brand is double"), do not list them: the interface shows them below.
- An option above the budget they mentioned is not a problem: it is information. Mention it and say by how much it goes over, do not hide it.
- No emojis. No "Hi!" if the conversation already started.

NEVER SAY YOU BOUGHT ANYTHING. You prepare the order; the charge is made by another part of the system.
Say "I found", "I put together", "it's ready to buy". Never "I bought", "I ordered it", "it's been purchased".

DO NOT PROMISE ACTIONS. You can only describe what already happened, which is exactly what "facts"
says. Do not offer to cancel, reserve, notify, wait, search again or anything of the sort: you have
no way of doing any of those things. If the human wants something else, they only have to ask and
the system runs again on its own.`;

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
    product: l.candidate.offer.product.title,
    quantity: l.candidate.qtyPacks,
    supplier: l.candidate.offer.supplier.name,
    price: Math.round(l.candidate.lineTotalArs),
  }));
}

/** Los descartes más informativos: por qué NO se eligió lo que el humano quizás esperaba. */
function descartesFrom(
  rejected: { sku: string; reason: string; detail: string }[],
  lines: CartLine[],
): ReplyFacts["ruledOut"] {
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
    .map((r) => ({ product: r.sku, why: r.detail }));
}

/** Motivos internos → inglés de negocio. */
function motivoLlano(reason: string, detail: string): string {
  switch (reason) {
    case "no_mandate":
      return "There is no signed mandate yet, so I can search and compare but not buy.";
    case "mandate_unusable":
      return "The permission to buy is not active right now.";
    case "exploratory_request":
      return "You haven't asked for this as an actual purchase yet.";
    case "conditional_request":
      return "The condition you set hasn't been met yet.";
    case "category_forbidden":
      return "That falls outside the categories the permission covers.";
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
      situation: "missing_info",
      question: q.question,
      ...(q.options !== undefined && q.options.length > 0 ? { options: q.options } : {}),
    };
  }

  if (suggestion !== null) {
    return {
      situation: "quote_only",
      tiers: suggestion.alternatives.map((a) => ({
        item: a.need.canonical,
        options: a.options.map((o) => ({
          product: o.candidate.offer.product.title,
          tier: o.tier,
          price: Math.round(o.candidate.lineTotalArs),
          withinBudget: o.vsBudget === null ? null : o.vsBudget === "within",
        })),
      })),
      items: itemsFrom(suggestion.lines),
      total: Math.round(suggestion.estimatedTotalArs),
      reason: motivoLlano(suggestion.reason, suggestion.detail),
      ruledOut: descartesFrom(suggestion.rejected, suggestion.lines),
      suggestedBudget: suggestion.mandateDraft.suggestedBudgetArs,
    };
  }

  if (outcome === null) return { situation: "cannot", reason: "I could not resolve it." };

  if (outcome.status === "proposal") {
    return {
      situation: "ready_to_buy",
      items: itemsFrom(outcome.cart.lines),
      total: Math.round(outcome.cart.totalArs),
      deliveryDays: outcome.cart.deliveryDays,
      ruledOut: descartesFrom(outcome.rejected, outcome.cart.lines),
    };
  }

  if (outcome.status === "escalation") {
    return {
      situation: "needs_approval",
      items: itemsFrom(outcome.cart.lines),
      total: Math.round(outcome.cart.totalArs),
      reason: motivoLlano(outcome.reason, outcome.detail),
      ruledOut: descartesFrom(outcome.rejected, outcome.cart.lines),
    };
  }

  return {
    situation: "cannot",
    reason: motivoLlano(outcome.reason, outcome.detail),
    ruledOut: descartesFrom(outcome.rejected, []),
  };
}

// ---------------------------------------------------------------------------
// Guarda contra cifras inventadas
// ---------------------------------------------------------------------------

/**
 * Toda cifra de plata que aparezca en la respuesta tiene que ser una de las que
 * le pasamos. Si el modelo redondea "$46,200" a "about $46 thousand" está bien;
 * si dice "$52,000" cuando nadie le pasó ese número, la respuesta se descarta.
 *
 * Es barato y ataja el único daño que este módulo podría hacer: la prosa es lo
 * que la persona lee, y una cifra equivocada ahí vale tanto como una cifra
 * equivocada en el carrito.
 *
 * OJO al cambiar el formato de plata: esta función PARSEA lo que `money.ts`
 * ESCRIBE. Con separador de miles en coma, "36,000" son treinta y seis mil; si
 * alguien vuelve al formato con punto sin tocar esto, "36.000" se lee como 36 y
 * la guarda empieza a rechazar cifras legítimas y a dejar pasar inventadas.
 */
export function citaCifrasInventadas(
  text: string,
  facts: ReplyFacts,
  /**
   * Cifras que el humano ya dijo, y que por lo tanto el agente puede repetir.
   *
   * Sin esto la guarda castiga la respuesta correcta: el modelo escribe "$46,200,
   * well within your budget of $120,000" —donde los 120.000 los puso el humano en
   * su propio pedido— y como ese número no está en `facts` la respuesta se
   * descarta entera. El resultado era que casi toda respuesta buena caía a la
   * plantilla, que dice lo mismo pero peor.
   *
   * Solo cuentan los turnos que escribió el humano. Los del agente quedan afuera
   * a propósito: si una cifra inventada se colara una vez, tomarla como válida en
   * el turno siguiente sería lavarla.
   */
  yaDichas: readonly number[] = [],
): boolean {
  const permitidas = new Set<number>();
  const permitir = (n: number | undefined) => {
    if (n === undefined) return;
    permitidas.add(Math.round(n));
    permitidas.add(Math.round(n / 1000)); // "46 thousand"
  };

  for (const n of yaDichas) permitir(n);

  permitir(facts.total);
  permitir(facts.suggestedBudget);
  permitir(facts.deliveryDays);
  for (const i of facts.items ?? []) {
    permitir(i.price);
    permitir(i.quantity);
  }
  for (const t of facts.tiers ?? []) {
    for (const o of t.options) permitir(o.price);
  }

  for (const raw of cifrasDePlata(text)) {
    if (!permitidas.has(Math.round(raw))) return true;
  }
  return false;
}

/**
 * Las cifras con pinta de plata de un texto: con "$" adelante o con separador
 * de miles. Un "2 kilos" no es una cifra de plata y no tiene por qué estar.
 *
 * Se acepta el punto además de la coma porque el humano escribe como quiere: la
 * interfaz está en inglés, pero quien la usa es argentino y va a tipear
 * "$120.000" tanto como "$120,000". Los dos son ciento veinte mil.
 *
 * Se sacan los dos separadores sin distinguir decimales, así que "$1,234.56"
 * se lee como 123456 y no como 1234,56. Es a sabiendas: acá no hay centavos
 * —`ars()` redondea a peso entero— y el error cae del lado seguro, porque una
 * cifra mal leída no coincide con ninguna permitida y la respuesta se descarta.
 * Lo inverso —leer de más y dejar pasar una cifra inventada— sería el problema.
 */
function cifrasDePlata(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.match(/\$\s?[\d.,]+|\b\d{1,3}(?:[.,]\d{3})+\b/g) ?? []) {
    const n = Number(raw.replace(/[$\s.,]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
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

/**
 * Los patrones en castellano se conservan aunque el agente ahora escriba en
 * inglés, y no es por nostalgia: el system prompt pide inglés, pero un prompt es
 * una instrucción y esta guarda existe justamente porque las instrucciones se
 * desobedecen. Con un catálogo de productos en castellano el modelo se va al
 * castellano solo cada tanto, y ese es exactamente el caso en el que la guarda
 * tiene que seguir puesta. Un patrón de más no cuesta nada: si dispara de más,
 * la respuesta cae a la plantilla, que dice la verdad igual.
 */
const ACCIONES_INEXISTENTES: RegExp[] = [
  // --- castellano ---
  frase("compr[éeoó]|lo ped[íi]|ya lo ped[íi]|est[áa] comprado|realic[ée] la compra"),
  frase("cancel[a-záéíóúñ]*|anul[a-záéíóúñ]*"),
  frase("te aviso|te notifico|te escribo cuando|voy a estar atento"),
  frase("reserv[oaé]|dej[oé] reservado"),
  frase("vuelvo a (?:buscar|revisar|consultar)"),
  frase("(?:esper[áa]|dame) un (?:momento|minuto|segundo)"),

  // --- inglés ---
  // Decir que compró. "the order is ready" tiene que pasar, "the order was
  // placed" no: la diferencia es el verbo, no el sustantivo.
  /\bi(?:'ve| have)? ?(?:just )?(?:bought|purchased|ordered)\b/i,
  /\bi placed the order\b/i,
  /\b(?:it|the order|the purchase) (?:has been|have been|was|were|is|'s) (?:bought|purchased|ordered|placed)\b/i,
  /\balready (?:bought|ordered|purchased)\b/i,
  // Cancelar o anular: no existe ninguna de las dos.
  /\bcancel(?:s|ed|led|ing|ling|lation)?\b/i,
  /\bvoid(?:s|ed|ing)?\b/i,
  // Avisar más tarde: no hay ningún proceso que pueda hacerlo.
  /\bi(?:'ll| will) (?:let you know|notify|tell you|text|message|ping|email)\b/i,
  /\bkeep(?:ing)? you posted\b/i,
  /\bi(?:'ll| will) keep an eye\b/i,
  // Reservar stock.
  /\bi(?:'ll| will) (?:reserve|hold)\b/i,
  /\b(?:reserved|on hold|put a hold)\b/i,
  // Volver a buscar por su cuenta.
  /\bi(?:'ll| will) (?:check|look|search|try) again\b/i,
  /\bi(?:'ll| will) re-?(?:check|search)\b/i,
  /\blet me (?:check|look) again\b/i,
  // Pedir que lo esperen: no hay trabajo en segundo plano.
  /\b(?:give me|just) a (?:moment|minute|second|sec)\b/i,
  /\b(?:hold on|one moment|bear with me)\b/i,
];

export function prometeAccionesInexistentes(text: string): boolean {
  return ACCIONES_INEXISTENTES.some((re) => re.test(text));
}

/** Respuesta armada en código, para cuando el modelo no está o dijo algo que no cierra. */
export function plantilla(facts: ReplyFacts): string {
  switch (facts.situation) {
    case "missing_info":
      return facts.question ?? "Could you give me one more detail?";
    case "ready_to_buy":
      return `Done, I found everything for ${ars(facts.total ?? 0)}${
        facts.deliveryDays !== undefined ? ` and it arrives in ${facts.deliveryDays} day(s)` : ""
      }.`;
    case "needs_approval":
      return `I found everything, but it comes to ${ars(facts.total ?? 0)} and that needs your sign-off. ${facts.reason ?? ""}`.trim();
    case "quote_only":
      return `${facts.reason ?? ""} Here's what it would cost: ${ars(facts.total ?? 0)}.`.trim();
    case "cannot":
      return facts.reason ?? "I can't do that.";
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
      conversation: conversation.slice(-6),
      facts,
    },
    null,
    2,
  );

  // Las cifras que el humano ya escribió. Solo sus turnos: repetir lo que dijo
  // no es inventar, pero tomar por bueno lo que dijo el agente sí sería lavarlo.
  const dichasPorElHumano = conversation
    .filter((t) => t.role === "user")
    .flatMap((t) => cifrasDePlata(t.content));

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
      citaCifrasInventadas(text, facts, dichasPorElHumano) ||
      prometeAccionesInexistentes(text)
    ) {
      return plantilla(facts);
    }
    return text.trim();
  } catch {
    return plantilla(facts);
  }
}
