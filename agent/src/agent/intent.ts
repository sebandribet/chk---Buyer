/**
 * E1 · Prompt → IntentMandate (draft, sin firmar).
 *
 * El modelo hace UNA cosa: traducir lenguaje natural a una estructura tipada.
 * No evalúa límites, no elige productos, no aprueba nada. Todo eso pasa después
 * y en código.
 *
 * La regla dura del módulo: si algo no está en el prompt, no se inventa. Falta
 * el presupuesto => pregunta. Falta la cantidad => pregunta. "Bebidas" puede
 * ser gaseosa o vino => pregunta. Un agente que completa huecos con defaults
 * razonables es exactamente el que compra lo que nadie pidió, y el challenge
 * pide explícitamente que nada se apruebe en silencio.
 */

import { z } from "zod";
import type {
  Category,
  ClarificationQuestion,
  CommitmentLevel,
  IntentExtraction,
  NeedSpec,
  PurchaseIntent,
  Unit,
} from "@/contracts/index.js";
import type { LlmClient } from "@/llm/index.js";
import type { AgentContext } from "./context.js";
import { buildOrderBrief } from "./brief.js";

const CATEGORIES = [
  "food",
  "cleaning",
  "disposables",
  "alcoholic_beverages",
  "equipment",
] as const satisfies readonly Category[];

const UNITS = ["L", "kg", "unit"] as const satisfies readonly Unit[];

/**
 * Los `attrs` viajan como lista de pares y no como objeto: structured outputs
 * en modo estricto no admite mapas de claves libres.
 */
const AttrPair = z.object({ key: z.string(), value: z.string() });

const COMMITMENT_LEVELS = [
  "exploratory",
  "conditional",
  "committed",
] as const satisfies readonly CommitmentLevel[];

const RawExtraction = z.object({
  status: z.enum(["ok", "clarification_needed"]),
  commitment: z.enum(COMMITMENT_LEVELS),
  natural_language_description: z.string(),
  needs: z.array(
    z.object({
      canonical: z.string(),
      attrs: z.array(AttrPair),
      qty: z.number(),
      unit: z.enum(UNITS),
      substitutes_allowed: z.boolean(),
      brand_preference: z.string().nullable(),
      anchor: z.enum(["quantity", "budget"]),
      item_budget_ars: z.number().nullable(),
    }),
  ),
  constraints: z.object({
    budget_ars: z.number().nullable(),
    quality_preference: z.enum(["cheapest", "balanced", "premium"]),
    allowed_categories: z.array(z.enum(CATEGORIES)),
    forbidden_categories: z.array(z.enum(CATEGORIES)),
    allowed_suppliers: z.array(z.string()).nullable(),
    max_delivery_days: z.number().nullable(),
  }),
  intent_expiry: z.string().nullable(),
  user_cart_confirmation_required: z.boolean(),
  questions: z.array(
    z.object({ field: z.string(), question: z.string(), options: z.array(z.string()) }),
  ),
});

type RawExtraction = z.infer<typeof RawExtraction>;

/** JSON Schema equivalente, para `strict: true` de structured outputs. */
const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "commitment",
    "natural_language_description",
    "needs",
    "constraints",
    "intent_expiry",
    "user_cart_confirmation_required",
    "questions",
  ],
  properties: {
    status: { type: "string", enum: ["ok", "clarification_needed"] },
    commitment: { type: "string", enum: [...COMMITMENT_LEVELS] },
    natural_language_description: { type: "string" },
    needs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["canonical", "attrs", "qty", "unit", "substitutes_allowed", "brand_preference", "anchor", "item_budget_ars"],
        properties: {
          canonical: { type: "string" },
          attrs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value"],
              properties: { key: { type: "string" }, value: { type: "string" } },
            },
          },
          qty: { type: "number" },
          unit: { type: "string", enum: [...UNITS] },
          substitutes_allowed: { type: "boolean" },
          brand_preference: { type: ["string", "null"] },
          anchor: { type: "string", enum: ["quantity", "budget"] },
          item_budget_ars: { type: ["number", "null"] },
        },
      },
    },
    constraints: {
      type: "object",
      additionalProperties: false,
      required: [
        "budget_ars",
        "quality_preference",
        "allowed_categories",
        "forbidden_categories",
        "allowed_suppliers",
        "max_delivery_days",
      ],
      properties: {
        budget_ars: { type: ["number", "null"] },
        quality_preference: { type: "string", enum: ["cheapest", "balanced", "premium"] },
        allowed_categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
        forbidden_categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
        allowed_suppliers: { type: ["array", "null"], items: { type: "string" } },
        max_delivery_days: { type: ["number", "null"] },
      },
    },
    intent_expiry: { type: ["string", "null"] },
    user_cart_confirmation_required: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "question", "options"],
        properties: {
          field: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

/**
 * El system prompt lleva la fecha de hoy porque sin ella ninguna fecha relativa
 * es resoluble: "la semana que viene", "para el viernes" y "hasta fin de mes"
 * no significan nada para un modelo sin reloj, y lo que hacía antes era
 * descartarlas en silencio.
 *
 * Va en el system y no en el mensaje de usuario a propósito: la clave del
 * fixture se calcula sobre el mensaje de usuario, así que meter la fecha ahí
 * invalidaría todas las grabaciones cada día. La contracara es que un fixture
 * grabado hoy conserva las fechas de hoy — para los tests da igual, porque
 * usan un LLM scripteado, pero conviene regrabar si una fecha empieza a
 * quedar vieja en la demo.
 */
function buildSystemPrompt(now: Date): string {
  const hoy = now.toISOString().slice(0, 10);
  const diaSemana = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${SYSTEM_PROMPT}

Today is ${diaSemana} ${hoy}. Resolve any relative deadline against that date.

Tell apart two things that sound alike:
- max_delivery_days: the maximum number of days within which it must BE DELIVERED. "before next week", "by Friday", "I need it now", "urgent". Compute the days from today and put the number. If there is no deadline, null.
- intent_expiry: how long this request stays VALID, in ISO 8601. "good until the end of the month", "during this week". If they did not say, null.

A request can have one, the other, both or neither. "Buy it before Friday" is max_delivery_days, not intent_expiry.

What you receive may be a multi-turn CONVERSATION, not a single request. In that case:
- Interpret the ACCUMULATED request, not just the last message. "Buy me coffee" + "2 kilos" + "make it a good brand" is one single request for 2kg of branded coffee.
- Later messages refine or correct earlier ones. If the human says "make it 3 kilos instead", the final quantity is 3.
- If the human changes topic and asks for something else, the request is the new thing.

quality_preference — what the human prioritizes when several options qualify:
- "cheapest": they asked for the cheapest, or said nothing about it. This is the default.
- "balanced": they asked for something mid-range, or explicitly ruled out the cheapest without asking for the best.
- "premium": they asked for better quality, a name brand, "the best", "not the cheapest", "something good".

brand_preference — only if they named a specific brand ("I want Lavazza", "the La Serenísima one"). If they named none, null.

anchor — what the human fixed, the quantity or the money:
- "quantity": they said how much they want to take. "2 kilos of coffee", "10 liters of milk", "3 packs". Fill qty and unit; item_budget_ars is null.
- "budget": they said how much money to spend on that item. "20 bucks worth of coffee", "get me 15 thousand of yerba", "$8,000 of napkins". Fill item_budget_ars with the amount; set qty to 1 and unit to whatever fits the product.

"A coffee" / "a yerba" is NOT a kilo or a liter: it is ONE package. If they only say "a coffee" with no money and no quantity, ask how much they need — do not assume 1 kg.

MONEY. The business is in Argentina and every amount is in Argentine pesos (ARS). Convert to a plain number before filling any amount:
- "20k" = "20 thousand" = 20000
- "a grand" = 1000
- "$20,000" and "20,000 pesos" = 20000 (the comma is a thousands separator, not a decimal point)
- The human may fall back to Argentine slang even while writing in English. "luca" is a thousand pesos, so "20 lucas" = 20000; "un palo" = 1000000; "mango" is simply a peso, so "20 mangos" = 20.
- Beware of European-style formatting: "20.000" written by an Argentine means 20000, not 20.`;
}

const SYSTEM_PROMPT = `You are the comprehension module of a purchasing agent that buys supplies for a food business in Argentina.

Your only task is to translate the human's request into a typed structure. You do NOT pick products, you do NOT evaluate budgets, you do NOT approve anything.

Rules:
1. Do not invent data the human did not say. If something necessary is missing, return status="clarification_needed" and one concrete question per gap.
2. For each item you need: what it is (canonical), how much (qty) and in what unit. If the quantity is missing, ask.
3. If the human gave no total budget, ask. Never assume a cap.
4. substitutes_allowed is false unless the human explicitly says they accept alternatives ("whatever's there", "or similar", "any brand").
5. canonical is the generic singular name of the product, lowercase, with no brand and no packaging — and it must be written in SPANISH, because it is matched against an Argentine catalog: "leche", "cafe", "detergente", "servilletas". Variants go in attrs, also in Spanish: {"key":"tipo","value":"descremada"}.
   Use the SHORTEST everyday word an Argentine shopper would say out loud — the word on the shelf label, not a literal translation. One or two words. "espresso machine" is "cafetera", not "máquina de espresso"; "paper towels" is "rollo de cocina"; "bleach" is "lavandina"; "trash bags" is "bolsas de residuo"; "dish soap" is "detergente". A long literal translation finds nothing in the catalog.
6. Valid categories: food, cleaning, disposables, alcoholic_beverages, equipment. allowed_categories are the ones the human restricted IN THIS REQUEST; forbidden_categories the ones they explicitly banned. If they said nothing, leave them empty: the underlying permissions come from the signed mandate, not from the prompt. NEVER ask which categories, suppliers or delivery windows are allowed — that is not something the human defines here.
7. If a term is ambiguous across categories (for example "drinks", which may or may not be alcoholic), ask instead of choosing.
8. intent_expiry in ISO 8601 only if the human set a deadline. Otherwise, null.
9. natural_language_description is the human's original request, verbatim, not reworded. Keep it in whatever language they wrote it.
10. If status="ok", questions is empty. If status="clarification_needed", fill needs and constraints with whatever you did manage to extract.
11. Write questions in English — they are shown to the human in an English interface.

commitment — how committed the request is. Classify by the STRUCTURE of the request, never by tone or by how confident it sounds:
- "committed": there is a concrete purchase order. An imperative buying verb (buy, order, restock, get) over identifiable items and quantities, with no pending conditions.
- "conditional": the purchase depends on something that has not happened yet ("if it drops below $X", "once the previous order arrives", "if the other one is out of stock").
- "exploratory": a query, a comparison or browsing. Questions ("how much is", "what options are there", "which is better value"), or mentions without an order ("I'm looking at", "I'll need at some point").

When torn between committed and exploratory, choose exploratory. An agent that suggests too much is a minor problem; one that buys too much is not.
A request written with great confidence or urgency is NOT more "committed" for that reason: look for a concrete order, not for how it sounds.`;

function pairsToRecord(pairs: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) out[p.key] = p.value;
  return out;
}

function toNeeds(raw: RawExtraction): NeedSpec[] {
  return raw.needs.map((n) => ({
    canonical: n.canonical.trim().toLowerCase(),
    attrs: pairsToRecord(n.attrs),
    qty: n.qty,
    unit: n.unit,
    substitutesAllowed: n.substitutes_allowed,
    brandPreference: n.brand_preference,
    anchor: n.anchor,
    itemBudgetArs: n.item_budget_ars,
  }));
}

/**
 * Huecos que el código detecta por su cuenta, sin confiar en que el modelo los
 * haya marcado. Si el modelo dice "ok" pero falta el presupuesto o una
 * cantidad, gana el código: la decisión de preguntar no puede quedar del lado
 * del que tiene incentivo a parecer útil.
 */
function findGaps(raw: RawExtraction): ClarificationQuestion[] {
  const gaps: ClarificationQuestion[] = [];

  // El presupuesto solo se exige cuando el pedido es una orden de compra.
  // Si el humano está preguntando cuánto sale algo, pedirle un techo antes de
  // contestarle es absurdo: nadie va a gastar nada en este run.
  const todosConPlata =
    raw.needs.length > 0 &&
    raw.needs.every((n) => n.anchor === "budget" && (n.item_budget_ars ?? 0) > 0);

  if (raw.constraints.budget_ars === null && raw.commitment === "committed" && !todosConPlata) {
    gaps.push({
      field: "constraints.budgetArs",
      question: "What's the maximum budget for this purchase?",
    });
  }

  // Qué y cuánto solo son obligatorios para comprar. En una consulta, frenar a
  // preguntar "¿cuánto detergente necesitás?" es peor respuesta que mostrar las
  // opciones: de eso se encarga el brief de búsqueda, con cantidades marcadas
  // como de referencia.
  if (raw.commitment !== "committed") return gaps;

  raw.needs.forEach((n, i) => {
    // Con anclaje en plata la cantidad no aplica: el humano dijo cuánto quiere
    // gastar, no cuánto quiere llevar. Preguntarle la cantidad ahí es no
    // haberlo escuchado.
    if (n.anchor === "budget") return;
    if (!Number.isFinite(n.qty) || n.qty <= 0) {
      gaps.push({
        field: `needs[${i}].qty`,
        question: `How much ${n.canonical} do you need?`,
      });
    }
  });

  if (raw.needs.length === 0) {
    gaps.push({ field: "needs", question: "What products do you need to buy?" });
  }

  return gaps;
}

/**
 * Los patrones siguen aceptando castellano además de inglés a propósito. El
 * modelo escribe el `field` bastante libre y, con un catálogo y un negocio
 * argentinos, sigue devolviendo "presupuesto" cada tanto. Que un patrón de más
 * matchee no cuesta nada; que falte, sí: una pregunta por el presupuesto que no
 * se reconoce como tal se duplica o frena un run que no debía frenarse.
 */
function isAboutBudget(field: string, question: string): boolean {
  return /budget|presupuesto/i.test(field) || /budget|presupuesto/i.test(question);
}

/**
 * Qué preguntas del modelo pueden frenar un run.
 *
 * El modelo insiste en pedir datos que no son huecos: presupuesto para
 * contestar "¿cuánto sale?", o directamente "¿qué categorías están permitidas?"
 * —que es una pregunta al mandato firmado, no al humano—. Si lo dejáramos
 * decidir, el agente pediría permisos en vez de usarlos.
 *
 * Así que la regla la tiene el código:
 *   · qué se compra y cuánto  → bloquea siempre. Sin eso no hay nada que buscar.
 *   · presupuesto             → bloquea solo si se va a gastar.
 *   · atributos del ítem      → nunca bloquean. Son un refinamiento opcional
 *     ("¿qué tipo de cafetera?"), no un dato faltante: el pedido ya dice qué y
 *     cuánto. Dejarlos bloquear convierte una compra válida en una consulta.
 *   · categorías, proveedores, plazos → nunca bloquean. Los define el mandato,
 *     y que el prompt no los mencione es lo normal, no un hueco.
 *
 * Las preguntas filtradas se descartan, no se responden solas: el agente no
 * asume nada, simplemente no pregunta lo que no le corresponde preguntar.
 */
function isBlockingQuestion(field: string, question: string, commitment: CommitmentLevel): boolean {
  // En un pedido que no compra, ninguna pregunta frena. Lo que falte —qué,
  // cuánto, con qué techo— lo resuelve el brief de búsqueda con cantidades de
  // referencia, y mostrar precios es mejor respuesta que un cuestionario.
  // Misma regla que `findGaps`: si estuviera en un solo lado, el modelo podría
  // frenar un run que el código ya decidió que no hace falta frenar.
  if (commitment !== "committed") return false;

  if (isAboutBudget(field, question)) return true;
  if (/attrs|atributo|attribute|marca|brand/i.test(field)) return false;
  if (/^constraints\./i.test(field)) return false;
  if (/categor|proveedor|supplier|delivery|entrega|plazo|lead.?time/i.test(field)) return false;
  return true;
}

/**
 * Tema de una pregunta, para poder deduplicar.
 *
 * No alcanza con comparar `field`: el modelo escribe "budget_ars" y el código
 * "constraints.budgetArs", así que dos preguntas por el presupuesto pasaban
 * como distintas y el agente preguntaba lo mismo dos veces seguidas con otra
 * redacción. En un chat eso se lee como que no está escuchando.
 */
function questionTopic(q: ClarificationQuestion): string {
  if (isAboutBudget(q.field, q.question)) return "budget";
  const campo = q.field.toLowerCase();
  if (/qty|quantity|cantidad|amount/.test(campo)) return `qty:${campo.replace(/[^0-9]/g, "")}`;
  if (/^needs$/.test(campo)) return "needs";
  return campo.replace(/[^a-z0-9]/g, "");
}

/** Dedupe por tema, priorizando las preguntas del modelo (suelen tener mejor redacción). */
function mergeQuestions(
  fromModel: ClarificationQuestion[],
  fromCode: ClarificationQuestion[],
): ClarificationQuestion[] {
  const byTopic = new Map<string, ClarificationQuestion>();
  for (const q of [...fromModel, ...fromCode]) {
    const topic = questionTopic(q);
    if (!byTopic.has(topic)) byTopic.set(topic, q);
  }
  return [...byTopic.values()];
}

export async function extractIntent(
  prompt: string,
  llm: LlmClient,
  ctx: AgentContext,
): Promise<IntentExtraction> {
  const parsed = RawExtraction.parse(
    await llm.json<unknown>({
      op: "intent_extraction",
      system: buildSystemPrompt(ctx.clock.now()),
      user: prompt,
      schema: { name: "purchase_intent", schema: JSON_SCHEMA },
    }),
  );

  const needs = toNeeds(parsed);

  const modelQuestions: ClarificationQuestion[] = parsed.questions
    .filter((q) => isBlockingQuestion(q.field, q.question, parsed.commitment))
    .map((q) => ({
      field: q.field,
      question: q.question,
      ...(q.options.length > 0 ? { options: q.options } : {}),
    }));

  const questions = mergeQuestions(modelQuestions, findGaps(parsed));

  if (questions.length > 0) {
    ctx.audit.emit({ type: "clarification_requested", questions });
    return {
      status: "clarification_needed",
      questions,
      partial: {
        naturalLanguageDescription: parsed.natural_language_description,
        needs,
      },
    };
  }

  const sinFicha = {
    commitment: parsed.commitment,
    naturalLanguageDescription: parsed.natural_language_description,
    needs,
    constraints: {
      budgetArs: parsed.constraints.budget_ars,
      qualityPreference: parsed.constraints.quality_preference,
      allowedCategories: parsed.constraints.allowed_categories,
      forbiddenCategories: parsed.constraints.forbidden_categories,
      allowedSuppliers: parsed.constraints.allowed_suppliers,
      maxDeliveryDays: parsed.constraints.max_delivery_days,
    },
    intentExpiry: parsed.intent_expiry,
    userCartConfirmationRequired: parsed.user_cart_confirmation_required,
  };

  // La ficha se arma desde la estructura ya validada, nunca desde el prompt:
  // así no puede afirmar nada que el humano no haya dicho.
  const intent: PurchaseIntent = {
    intentId: ctx.ids.next("intent"),
    ...sinFicha,
    brief: buildOrderBrief(sinFicha),
  };

  ctx.audit.emit({ type: "intent_extracted", intent });
  return { status: "ok", intent };
}
