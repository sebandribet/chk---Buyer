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
  "alimentos",
  "limpieza",
  "descartables",
  "bebidas_alcoholicas",
  "equipamiento",
] as const satisfies readonly Category[];

const UNITS = ["L", "kg", "unidad"] as const satisfies readonly Unit[];

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
    quality_preference: z.enum(["economica", "equilibrada", "premium"]),
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
        quality_preference: { type: "string", enum: ["economica", "equilibrada", "premium"] },
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
  const diaSemana = now.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  return `${SYSTEM_PROMPT}

Hoy es ${diaSemana} ${hoy}. Resolvé contra esa fecha cualquier plazo relativo.

Distinguí dos cosas que se dicen parecido:
- max_delivery_days: en cuántos días como máximo tiene que ESTAR ENTREGADO. "antes de la semana que viene", "para el viernes", "lo necesito ya", "urgente". Calculá los días desde hoy y poné el número. Si no hay plazo, null.
- intent_expiry: hasta cuándo sigue VIGENTE este pedido, en ISO 8601. "válido hasta fin de mes", "durante esta semana". Si no lo dijo, null.

Un pedido puede tener uno, el otro, los dos o ninguno. "Comprá antes del viernes" es max_delivery_days, no intent_expiry.

Lo que recibís puede ser una CONVERSACIÓN de varios turnos, no un pedido suelto. En ese caso:
- Interpretá el pedido ACUMULADO, no solo el último mensaje. "Comprame café" + "2 kilos" + "que sea de buena marca" es un solo pedido de 2kg de café de marca.
- Los mensajes posteriores refinan o corrigen a los anteriores. Si el humano dice "mejor 3 kilos", la cantidad final es 3.
- Si el humano cambia de tema y pide otra cosa, el pedido es lo nuevo.

quality_preference — qué prioriza el humano cuando varias opciones cumplen:
- "economica": pidió lo más barato, o no dijo nada al respecto. Es el default.
- "equilibrada": pidió algo intermedio, o descartó explícitamente lo más barato sin pedir lo mejor.
- "premium": pidió mejor calidad, primera marca, "el mejor", "que no sea el más barato", "algo bueno".

brand_preference — solo si nombró una marca concreta ("quiero Lavazza", "de La Serenísima"). Si no nombró ninguna, null.

anchor — qué fijó el humano, la cantidad o la plata:
- "quantity": dijo cuánto quiere llevar. "2 kilos de café", "10 litros de leche", "3 paquetes". Llená qty y unit; item_budget_ars va null.
- "budget": dijo cuánta plata quiere gastar en ese ítem. "un café de 20 lucas", "traeme yerba por 15 mil", "$8.000 de servilletas". Llená item_budget_ars con el monto; qty poné 1 y unit la que corresponda al producto.

"Un café" / "una yerba" NO es un kilo ni un litro: es UN envase. Si dice solo "un café" sin plata ni cantidad, preguntá cuánto necesita — no asumas 1 kg.

PLATA EN ARGENTINO. Convertí a número antes de cargar cualquier monto:
- "20 lucas" = "20 mil" = "20k" = "20 palos verdes" NO — "luca" es mil pesos: 20 lucas = 20000
- "un palo" = 1000000 (un millón)
- "una gamba" = 100
- "20 mangos" = 20 pesos; "mango" es simplemente peso
- "$20.000" y "20.000 pesos" = 20000 (el punto es separador de miles, no decimal)`;
}

const SYSTEM_PROMPT = `Sos el módulo de comprensión de un agente de compras de insumos para un comercio gastronómico en Argentina.

Tu única tarea es traducir el pedido del humano a una estructura tipada. NO elegís productos, NO evaluás presupuestos, NO aprobás nada.

Reglas:
1. No inventes datos que el humano no dijo. Si falta algo necesario, devolvé status="clarification_needed" y una pregunta concreta por cada hueco.
2. Necesitás, para cada ítem: qué es (canonical), cuánto (qty) y en qué unidad. Si falta la cantidad, preguntá.
3. Si el humano no dio presupuesto total, preguntá. Nunca asumas un techo.
4. substitutes_allowed es false salvo que el humano diga explícitamente que acepta alternativas ("lo que haya", "o similar", "cualquier marca").
5. canonical es el nombre genérico y singular del producto, en minúsculas, sin marca ni presentación: "leche", "cafe", "detergente", "servilletas". Las variantes van en attrs: {"key":"tipo","value":"descremada"}.
6. Categorías válidas: alimentos, limpieza, descartables, bebidas_alcoholicas, equipamiento. allowed_categories son las que el humano restringió EN ESTE PEDIDO; forbidden_categories las que prohibió explícitamente. Si no dijo nada, van vacías: los permisos de fondo los da el mandato firmado, no el prompt. NUNCA preguntes qué categorías, proveedores o plazos están permitidos — no es algo que el humano defina acá.
7. Si un término es ambiguo entre categorías (por ejemplo "bebidas", que puede ser alcohólica o no), preguntá en vez de elegir.
8. intent_expiry en ISO 8601 solo si el humano puso un plazo. Si no, null.
9. natural_language_description es el pedido original del humano, textual, sin reformular.
10. Si status="ok", questions va vacío. Si status="clarification_needed", cargá needs y constraints con lo que sí pudiste extraer.

commitment — cuán comprometido está el pedido. Clasificá por la ESTRUCTURA del pedido, nunca por el tono ni por cuánta seguridad transmite:
- "committed": hay una orden de compra concreta. Verbo imperativo de compra (comprá, pedí, reponé, encargá) sobre ítems y cantidades identificables, sin condiciones pendientes.
- "conditional": la compra depende de algo que todavía no pasó ("si baja de $X", "cuando llegue el pedido anterior", "si no hay stock de lo otro").
- "exploratory": consulta, comparación o exploración. Preguntas ("cuánto sale", "qué opciones hay", "conviene más"), o menciones sin orden ("estoy viendo", "necesitaría en algún momento").

Ante la duda entre committed y exploratory, elegí exploratory. Que el agente sugiera de más es un problema menor; que compre de más, no.
Un pedido escrito con mucha seguridad o urgencia NO es más "committed" por eso: mirá si hay una orden concreta, no cómo suena.`;

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
      question: "¿Cuál es el presupuesto máximo para esta compra?",
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
        question: `¿Qué cantidad de ${n.canonical} necesitás?`,
      });
    }
  });

  if (raw.needs.length === 0) {
    gaps.push({ field: "needs", question: "¿Qué productos necesitás comprar?" });
  }

  return gaps;
}

function isAboutBudget(field: string, question: string): boolean {
  return /budget|presupuesto/i.test(field) || /presupuesto/i.test(question);
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
  if (/attrs|atributo|marca|brand/i.test(field)) return false;
  if (/^constraints\./i.test(field)) return false;
  if (/categor|proveedor|supplier|delivery|entrega|plazo/i.test(field)) return false;
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
  if (/qty|cantidad/.test(campo)) return `qty:${campo.replace(/[^0-9]/g, "")}`;
  if (/^needs$/.test(campo)) return "needs";
  return campo.replace(/[^a-z0-9]/g, "");
}

/**
 * Dedupe por tema, priorizando las preguntas del modelo (suelen tener mejor
 * redacción).
 *
 * Exportada porque el módulo de oficina (`office.ts`) la reusa: los nombres de
 * los campos cambian entre dominios, pero "no le preguntes dos veces lo mismo
 * al humano" es la misma regla en todos.
 */
export function mergeQuestions(
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
