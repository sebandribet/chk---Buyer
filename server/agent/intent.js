/**
 * E1 - Prompt to a typed flight intent (draft, unsigned).
 *
 * Ported from `agente-Nico` (agent/src/agent/intent.ts, commit c344d1a) and
 * moved from its grocery catalog to this flight demo.
 *
 * The model does ONE thing: translate natural language into a typed structure.
 * It does not evaluate limits, it does not pick flights, it does not approve
 * anything. All of that happens afterwards, in code.
 *
 * The hard rule of this module: if it is not in the prompt, it is not invented.
 * No budget => ask. No passenger count => ask. An agent that fills gaps with
 * reasonable defaults is exactly the one that buys what nobody asked for.
 */

const COMMITMENT_LEVELS = ["exploratory", "conditional", "committed"];
const CABINS = ["Economy", "Premium Economy", "Business", "First"];
const QUALITY = ["cheapest", "balanced", "premium"];

const SYSTEM_PROMPT = `You are the comprehension module of an agent that books flights for a traveller.

Your only task is to translate the human's request into a typed structure. You do NOT pick flights, you do NOT evaluate budgets, you do NOT approve anything.

Rules:
1. Do not invent data the human did not say. If something necessary is missing, return status="clarification_needed" and one concrete question per gap.
2. natural_language_description is the human's original request, verbatim, not reworded. Keep it in whatever language they wrote it.
3. Cities: write origin and destination as the plain city name in English, as an airport board would show it ("Buenos Aires", "Madrid", "Sao Paulo"). If the human names a country only ("I want to go to Brazil"), put the country in destination and ask which city.
4. Dates in ISO 8601 (YYYY-MM-DD). Resolve relative dates against today's date, given below. If the human gave no date, null - never guess a date.
5. passengers is how many people are flying. "A flight for me and my wife" is 2. If they did not say, null. Do not assume 1.
6. cabin only if they named one. "Business", "first class", "economy". Otherwise null.
7. max_stops only if they said something about connections ("direct", "non-stop" = 0; "one stop is fine" = 1). Otherwise null.
8. airline_preference: the airline the human named. If they explicitly said any airline is acceptable ("any airline", "I do not mind which airline"), write exactly "Any airline" - that is a term they stated, not an assumption. If they said nothing about airlines at all, null.
9. budget_usd is the maximum TOTAL amount for the whole purchase, in US dollars. "Under $800" = 800. "$400 each" for 2 passengers = 800. If they gave no cap, null. Never assume a cap.
10. authorization_expires_at: how long this request stays VALID as spending authority, ISO 8601. Only if the human said something like "this offer holds until Friday". A travel date is NOT an authorization expiry. Otherwise null.
11. If status="ok", questions is empty. If status="clarification_needed", still fill trip and constraints with whatever you did manage to extract.
12. Write questions in English - they are shown to the human in an English interface.
13. NEVER ask which airlines, payment methods or authorization windows are allowed. Those come from the signed mandate, not from the human here.

quality_preference - what the human prioritizes when several flights qualify:
- "cheapest": they asked for the cheapest, or said nothing about it. This is the default.
- "balanced": they asked for something mid-range, or ruled out the cheapest without asking for the best.
- "premium": they asked for better quality, a specific comfort level, "the best", "not the cheapest".

What you receive may be a multi-turn CONVERSATION, not a single request. In that case:
- Interpret the ACCUMULATED request, not just the last message. "Get me a flight to Madrid" + "for two" + "under 900 dollars" is one single request.
- Later messages refine or correct earlier ones. If the human says "make it three people instead", the final count is 3.
- If the human changes topic and asks for something else, the request is the new thing. An old travel turn does not capture a later unrelated question.

commitment - how committed the request is. Classify by the STRUCTURE of the request, never by tone or by how confident it sounds:
- "committed": there is a concrete purchase order. An imperative buying verb (book, buy, get me, reserve) over an identifiable trip, with no pending conditions.
- "conditional": the purchase depends on something that has not happened yet ("if it drops below $600", "once my leave is approved", "if there is a direct one").
- "exploratory": a query, a comparison or browsing. Questions ("how much is", "what flights are there", "which is cheaper"), or mentions without an order ("I'm thinking about", "I'll need to go at some point").

When torn between committed and exploratory, choose exploratory. An agent that suggests too much is a minor problem; one that buys too much is not.
A request written with great confidence or urgency is NOT more "committed" for that reason: look for a concrete order, not for how it sounds.`;

/**
 * The system prompt carries today's date because without it no relative date is
 * resolvable: "next week", "on Friday" and "end of the month" mean nothing to a
 * model with no clock, and what it did before was drop them silently.
 *
 * It goes in the system message and not the user message on purpose: the
 * fixture key is computed over the user message, so putting the date there
 * would invalidate every recording every day.
 */
function buildSystemPrompt(now) {
  const today = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${SYSTEM_PROMPT}

Today is ${weekday} ${today}. Resolve any relative date against that date. A date you compute must never be in the past.`;
}

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "commitment", "natural_language_description", "trip", "constraints", "questions"],
  properties: {
    status: { type: "string", enum: ["ok", "clarification_needed"] },
    commitment: { type: "string", enum: [...COMMITMENT_LEVELS] },
    natural_language_description: { type: "string" },
    trip: {
      type: "object",
      additionalProperties: false,
      required: ["origin", "destination", "departure_date", "passengers", "cabin", "max_stops", "airline_preference"],
      properties: {
        origin: { type: ["string", "null"] },
        destination: { type: ["string", "null"] },
        departure_date: { type: ["string", "null"] },
        passengers: { type: ["number", "null"] },
        cabin: { type: ["string", "null"], enum: [...CABINS, null] },
        max_stops: { type: ["number", "null"] },
        airline_preference: { type: ["string", "null"] },
      },
    },
    constraints: {
      type: "object",
      additionalProperties: false,
      required: ["budget_usd", "quality_preference", "authorization_expires_at"],
      properties: {
        budget_usd: { type: ["number", "null"] },
        quality_preference: { type: "string", enum: [...QUALITY] },
        authorization_expires_at: { type: ["string", "null"] },
      },
    },
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

// ---------------------------------------------------------------------------
// Validation. The schema guarantees the shape; this guarantees the values.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function oneOf(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

/**
 * A hand-rolled parse rather than a schema library: this project ships with no
 * validation dependency, and the shape is small enough that an explicit reader
 * is clearer than a schema. Anything the model returns that does not survive
 * this becomes null, which the gap rules below then treat as missing.
 */
export function parseExtraction(raw) {
  if (raw === null || typeof raw !== "object") throw new Error("The model did not return an object.");
  const trip = typeof raw.trip === "object" && raw.trip !== null ? raw.trip : {};
  const constraints = typeof raw.constraints === "object" && raw.constraints !== null ? raw.constraints : {};
  const maxStops = typeof trip.max_stops === "number" && Number.isInteger(trip.max_stops) && trip.max_stops >= 0
    ? trip.max_stops
    : null;

  return {
    status: oneOf(raw.status, ["ok", "clarification_needed"]) ?? "clarification_needed",
    commitment: oneOf(raw.commitment, COMMITMENT_LEVELS) ?? "exploratory",
    naturalLanguageDescription: text(raw.natural_language_description) ?? "",
    trip: {
      origin: text(trip.origin),
      destination: text(trip.destination),
      departureDate: isIsoDate(trip.departure_date) ? trip.departure_date : null,
      passengers: Number.isInteger(trip.passengers) && trip.passengers > 0 ? trip.passengers : null,
      cabin: oneOf(trip.cabin, CABINS),
      maxStops,
      airlinePreference: text(trip.airline_preference),
    },
    constraints: {
      budgetUsd: positiveNumber(constraints.budget_usd),
      qualityPreference: oneOf(constraints.quality_preference, QUALITY) ?? "cheapest",
      authorizationExpiresAt: isIsoDate(constraints.authorization_expires_at)
        ? constraints.authorization_expires_at
        : null,
    },
    questions: Array.isArray(raw.questions)
      ? raw.questions
          .filter((q) => q !== null && typeof q === "object" && text(q.question))
          .map((q) => ({
            field: text(q.field) ?? "",
            question: text(q.question),
            options: Array.isArray(q.options) ? q.options.filter((o) => text(o)) : [],
          }))
      : [],
  };
}

// ---------------------------------------------------------------------------
// Gaps the code finds on its own, without trusting the model to flag them.
// ---------------------------------------------------------------------------

/**
 * If the model says "ok" but the budget or the passenger count is missing, the
 * code wins. The decision to ask cannot sit with the party that has an
 * incentive to look helpful.
 */
export function findGaps(extraction) {
  const gaps = [];

  // Route and date are what a fare IS. No flight search can proceed without
  // them at any commitment level: "how much is a flight to Cordoba?" has no
  // answer until we know from where and when, and the honest reply to it is the
  // question, not a price for a route the human never named. Nico's grocery
  // catalog can be browsed with no item in mind; a fare cannot.
  if (!extraction.trip.destination) {
    gaps.push({ field: "trip.destination", question: "Where do you want to fly to?" });
  }
  if (!extraction.trip.origin) {
    gaps.push({ field: "trip.origin", question: "Which city are you flying from?" });
  }
  if (!extraction.trip.departureDate) {
    gaps.push({ field: "trip.departureDate", question: "What date do you want to depart?" });
  }

  // Everything below is only required in order to BUY. Once the route and date
  // are known there is a real fare to show, and stopping to ask for a budget
  // and a passenger count is a worse answer than showing it. The search brief
  // covers those with reference values, clearly marked as reference.
  if (extraction.commitment !== "committed") return gaps;

  if (extraction.trip.passengers === null) {
    gaps.push({ field: "trip.passengers", question: "How many passengers is this for?" });
  }
  if (extraction.constraints.budgetUsd === null) {
    gaps.push({ field: "constraints.budgetUsd", question: "What is the maximum total budget in USD?" });
  }

  return gaps;
}

function about(pattern, field, question) {
  return pattern.test(field) || pattern.test(question);
}

const BUDGET = /budget|presupuesto|price cap|maximum.*(spend|pay)|how much.*(spend|pay|budget)/i;
// Origin is tested before destination and the two must not overlap. "Which
// city are you departing from?" used to match the destination pattern on the
// bare words "which city", with two consequences: an origin question blocked an
// exploratory query it had no business blocking, and questionTopic collapsed
// origin and destination onto one topic - so a genuine pair of them was deduped
// down to whichever came first.
const ORIGIN = /\borigin\b|from which city|which city are you (?:depart|leav|fly)|depart(?:ing|ure)? from|flying from|leaving from|travell?ing from/i;
const DESTINATION = /\bdestination\b|destino|fly(?:ing)? to|travell?ing to|going to|where .*(?:go|fly|travel)|which city .*(?:to|arrive|land)/i;
// Tested after ORIGIN, which owns "departing from". This one owns the day.
const DATE = /\bdate\b|\bwhen\b|\bfecha\b|what day/i;
const REFINEMENT = /cabin|class|airline|carrier|stop|layover|seat|baggage|luggage|time of day|window|aisle|return/i;
const MANDATE_TERMS = /authoriz|expir|valid|mandate|payment|card|kyc|wallet|merchant|supplier/i;

/**
 * Which of the model's questions may stop a run.
 *
 * The model keeps asking for things that are not gaps: a budget in order to
 * answer "how much is it?", or which airlines are allowed - which is a question
 * for the signed mandate, not for the human. Left to decide, the agent would
 * ask for permissions instead of using them.
 *
 * So the rule lives in code:
 *   - route and date          -> always block. They are what a fare is; without
 *     them there is nothing to search, whatever the request was for.
 *   - passengers, budget      -> block only if money is going to be spent.
 *   - cabin, airline, stops   -> never block. They refine a request that is
 *     already answerable; letting them block turns a valid purchase into a
 *     questionnaire.
 *   - authorization, payment  -> never block. The mandate defines those, and a
 *     prompt not mentioning them is normal, not a gap.
 *
 * Filtered questions are dropped, not answered by assumption: the agent does
 * not guess, it simply does not ask what is not its to ask.
 */
export function isBlockingQuestion(field, question, commitment) {
  // First, because it is the only rule that must survive every later pattern.
  // "Until what date may this mandate authorize a purchase?" is a mandate term
  // the human never has to volunteer, and it would otherwise be caught by DATE
  // below and stop a run over a question that is not the human's to answer.
  if (about(MANDATE_TERMS, field, question)) return false;

  // The same three terms findGaps requires, on the same terms - if the rule
  // lived on only one side, one of them could let through what the other stops.
  if (about(ORIGIN, field, question)) return true;
  if (about(DESTINATION, field, question)) return true;
  if (about(DATE, field, question)) return true;

  // In a request that will not buy, nothing else blocks. Whatever is missing is
  // resolved by the search brief with reference values, and showing fares is a
  // better answer than a questionnaire.
  if (commitment !== "committed") return false;

  if (about(BUDGET, field, question)) return true;
  if (about(REFINEMENT, field, question)) return false;
  return true;
}

/**
 * The topic of a question, so duplicates can be dropped.
 *
 * Comparing `field` is not enough: the model writes "budget_usd" and the code
 * writes "constraints.budgetUsd", so two questions about the budget went
 * through as different and the agent asked the same thing twice in a row with
 * different wording. In a chat that reads as not listening.
 */
export function questionTopic(question) {
  const field = question.field.toLowerCase();
  const body = question.question.toLowerCase();
  if (about(BUDGET, field, body)) return "budget";
  if (about(ORIGIN, field, body)) return "origin";
  if (about(DESTINATION, field, body)) return "destination";
  if (/date|when/.test(`${field} ${body}`)) return "date";
  if (/passenger|traveller|traveler|people|how many|qty|quantity|ticket/.test(`${field} ${body}`)) return "passengers";
  return field.replace(/[^a-z0-9]/g, "") || body.replace(/[^a-z0-9]/g, "").slice(0, 24);
}

/** Dedupe by topic, preferring the model's questions - they are better worded. */
export function mergeQuestions(fromModel, fromCode) {
  const byTopic = new Map();
  for (const question of [...fromModel, ...fromCode]) {
    const topic = questionTopic(question);
    if (!byTopic.has(topic)) byTopic.set(topic, question);
  }
  return [...byTopic.values()];
}

// ---------------------------------------------------------------------------
// Search brief
// ---------------------------------------------------------------------------

/**
 * What to search with when the human has not pinned everything down.
 *
 * A term the human did not give becomes an absent filter, not an invented
 * value: no date means "show me what flies this route", not "assume the 15th".
 * Guessing a date would produce an empty result set that looks like an answer,
 * which is worse than a wide one that is honest about being wide.
 *
 * The single exception is `passengers`, because a total price cannot be
 * computed without a count. It defaults to 1 and is listed in `reference` so
 * nothing downstream - and no sentence shown to the human - can mistake a
 * value the agent chose for a term the human gave.
 *
 * Reference values can produce a suggestion. They can never produce a
 * purchase: the buy path needs a signed mandate, and the mandate is built from
 * the human's own terms.
 */
export function buildSearchBrief(intent) {
  const reference = [];
  const filters = {
    origin: intent.trip.origin,
    destination: intent.trip.destination,
    departureDate: intent.trip.departureDate,
    cabin: intent.trip.cabin,
    maxStops: intent.trip.maxStops,
    airlinePreference: intent.trip.airlinePreference,
  };

  let passengers = intent.trip.passengers;
  if (passengers === null) {
    passengers = 1;
    reference.push("passengers");
  }

  return {
    ...filters,
    passengers,
    budgetUsd: intent.constraints.budgetUsd,
    qualityPreference: intent.constraints.qualityPreference,
    reference,
  };
}

// ---------------------------------------------------------------------------
// The extraction itself
// ---------------------------------------------------------------------------

/**
 * What gets sent is the human's side of the conversation, and only that.
 *
 * A follow-up like "make it two" means nothing on its own, so the accumulated
 * request has to travel. But the agent's own turns deliberately do not: a reply
 * that says "I would book AeroSur at US$130" is the agent's proposal, and
 * feeding it back is how a value the agent chose gets re-read as a term the
 * human gave. The whole module exists to keep those apart.
 *
 * It also keeps the fixtures stable. The fixture key is a hash of this string,
 * so including agent wording would invalidate every recording the moment a
 * reply is reworded.
 */
export function conversationPrompt(conversation, message) {
  const turns = (conversation ?? [])
    .filter((turn) => turn.role === "user")
    .slice(-6)
    .map((turn) => turn.content);
  if (turns[turns.length - 1] !== message) turns.push(message);
  return turns.map((turn) => `Human: ${turn}`).join("\n");
}

export async function extractIntent({ message, conversation, llm, ctx }) {
  const user = conversationPrompt(conversation, message);
  const extraction = parseExtraction(
    await llm.json({
      op: "flight_intent_extraction",
      system: buildSystemPrompt(ctx.now()),
      user,
      schema: { name: "flight_intent", schema: JSON_SCHEMA },
    }),
  );

  const modelQuestions = extraction.questions
    .filter((q) => isBlockingQuestion(q.field, q.question, extraction.commitment))
    .map((q) => ({ field: q.field, question: q.question, ...(q.options.length > 0 ? { options: q.options } : {}) }));

  const questions = mergeQuestions(modelQuestions, findGaps(extraction));

  if (questions.length > 0) {
    ctx.audit({
      type: "agent_clarification_requested",
      detail: `The agent is missing ${questions.length} term(s) and will not guess: ${questions.map((q) => q.question).join(" ")}`,
    });
    return {
      status: "clarification_needed",
      commitment: extraction.commitment,
      questions,
      partial: {
        naturalLanguageDescription: extraction.naturalLanguageDescription,
        trip: extraction.trip,
        constraints: extraction.constraints,
      },
    };
  }

  const intent = {
    intentId: ctx.nextId("intent"),
    commitment: extraction.commitment,
    naturalLanguageDescription: extraction.naturalLanguageDescription,
    trip: extraction.trip,
    constraints: extraction.constraints,
  };
  intent.brief = buildSearchBrief(intent);

  ctx.audit({
    type: "agent_intent_extracted",
    detail: `Understood a "${intent.commitment}" request: ${intent.naturalLanguageDescription}`,
  });
  return { status: "ok", intent };
}
