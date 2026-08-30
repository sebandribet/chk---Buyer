/**
 * The agent's behaviour, checked offline.
 *
 * Every test here scripts the model through `StubLlmClient`, so the suite runs
 * free, offline, and identically every time. That is the point of the single
 * typed door: an agent whose behaviour can only be verified by spending credits
 * cannot be verified.
 *
 * These tests deliberately do not touch the chain. What they pin down is the
 * part that decides whether the chain is reached at all.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { StubLlmClient } from "../server/agent/llm.js";
import {
  buildSearchBrief,
  findGaps,
  isBlockingQuestion,
  mergeQuestions,
  parseExtraction,
} from "../server/agent/intent.js";
import { runAgent } from "../server/agent/run.js";
import { detectInjection, sanitizeForLlm } from "../server/agent/untrusted.js";
import { allFlights } from "../server/mockFlights.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extraction({
  status,
  commitment = "committed",
  description = "a flight",
  trip = {},
  constraints = {},
  questions = [],
} = {}) {
  return {
    status: status ?? (questions.length > 0 ? "clarification_needed" : "ok"),
    commitment,
    natural_language_description: description,
    trip: {
      origin: null,
      destination: null,
      departure_date: null,
      passengers: null,
      cabin: null,
      max_stops: null,
      airline_preference: null,
      ...trip,
    },
    constraints: {
      budget_usd: null,
      quality_preference: "cheapest",
      authorization_expires_at: null,
      ...constraints,
    },
    questions,
  };
}

function scripted(intentResponse, equivalence = { acceptable: false, reason: "Not the same trip." }) {
  return new StubLlmClient({
    flight_intent_extraction: intentResponse,
    itinerary_equivalence: equivalence,
  });
}

function recordingCtx() {
  const events = [];
  let seq = 0;
  return {
    events,
    now: () => new Date("2026-08-30T00:00:00Z"),
    nextId: (prefix) => `${prefix}-${++seq}`,
    audit: (event) => events.push(event),
    has: (type, pattern) =>
      events.some((event) => event.type === type && (pattern ? pattern.test(event.detail) : true)),
  };
}

const FULL_TRIP = {
  origin: "Buenos Aires",
  destination: "Cordoba",
  departure_date: "2026-09-15",
  passengers: 2,
};

/**
 * The same trip with nobody counted and no cap named.
 *
 * Route and date are what a fare is, so they are always present in a request
 * the agent is allowed to answer. Who is flying and what they will spend are
 * not: those only matter once money is going to move.
 */
const OPEN_TRIP = { origin: "Buenos Aires", destination: "Cordoba", departure_date: "2026-09-15" };

// ---------------------------------------------------------------------------
// The commitment gate - the guarantee this whole design exists to make
// ---------------------------------------------------------------------------

test("with no signed mandate the agent suggests, however committed the request is", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "Book 2 flights from Buenos Aires to Cordoba on 2026-09-15, budget $300",
    conversation: [],
    mandate: null,
    llm: scripted(extraction({ commitment: "committed", trip: FULL_TRIP, constraints: { budget_usd: 300 } })),
    ctx,
  });

  assert.equal(decision.kind, "suggestion");
  assert.equal(decision.reason, "no_mandate");
  // The commitment level must not be recorded as though it enabled anything.
  assert.ok(ctx.has("agent_commitment_assessed", /not consulted/i));
  assert.ok(ctx.has("agent_commitment_assessed", /Executes: no/));
});

test("a signed, usable mandate plus a concrete order reaches the policy engine", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "Book it",
    conversation: [],
    mandate: { id: "0", usable: true, terms: null },
    llm: scripted(extraction({ commitment: "committed", trip: FULL_TRIP, constraints: { budget_usd: 300 } })),
    ctx,
  });

  assert.equal(decision.kind, "purchase_order");
  assert.ok(ctx.has("agent_commitment_assessed", /Executes: yes/));
});

test("a question over a signed mandate still only suggests", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "How much is a Buenos Aires to Cordoba flight on the 15th?",
    conversation: [],
    mandate: { id: "0", usable: true, terms: null },
    llm: scripted(extraction({ commitment: "exploratory", trip: OPEN_TRIP })),
    ctx,
  });

  assert.equal(decision.kind, "suggestion");
  assert.equal(decision.reason, "exploratory_request");
});

test("an unusable mandate cannot be spent, and the run says so instead of failing", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "Book 2 flights to Cordoba",
    conversation: [],
    mandate: { id: "0", usable: false, terms: null },
    llm: scripted(extraction({ commitment: "committed", trip: FULL_TRIP, constraints: { budget_usd: 300 } })),
    ctx,
  });

  assert.equal(decision.kind, "suggestion");
  assert.equal(decision.reason, "mandate_unusable");
});

// ---------------------------------------------------------------------------
// The agent does not invent, and the code decides what counts as a gap
// ---------------------------------------------------------------------------

test("a booking order with no budget is asked about, even when the model says it is fine", async () => {
  const ctx = recordingCtx();
  // The model claims status "ok" with no budget. The code must not accept that:
  // the decision to ask cannot sit with the party that wants to look helpful.
  const decision = await runAgent({
    message: "Book 2 flights from Buenos Aires to Cordoba on 2026-09-15",
    conversation: [],
    mandate: null,
    llm: scripted(extraction({ status: "ok", commitment: "committed", trip: FULL_TRIP })),
    ctx,
  });

  assert.equal(decision.kind, "clarification");
  assert.ok(decision.questions.some((question) => /budget/i.test(question.question)));
  assert.ok(ctx.has("agent_clarification_requested"));
});

test("a question is not interrogated for a budget it does not need", () => {
  const gaps = findGaps(
    parseExtraction(extraction({
      commitment: "exploratory",
      trip: { origin: "Buenos Aires", destination: "Cordoba", departure_date: "2026-09-15" },
    })),
  );
  // The route and the date are known, so there is a real fare to show. Money
  // terms only matter to a request that is going to spend.
  assert.deepEqual(gaps, []);
});

test("route and date block at every commitment level - there is no fare without them", () => {
  for (const commitment of ["exploratory", "conditional", "committed"]) {
    const gaps = findGaps(parseExtraction(extraction({ commitment, trip: { origin: "Buenos Aires" } })));
    for (const field of ["trip.destination", "trip.departureDate"]) {
      assert.ok(gaps.some((gap) => gap.field === field), `expected a ${field} gap for "${commitment}"`);
    }

    const noOrigin = findGaps(parseExtraction(extraction({ commitment, trip: { destination: "Cordoba" } })));
    assert.ok(
      noOrigin.some((gap) => gap.field === "trip.origin"),
      `expected an origin gap for "${commitment}"`,
    );
  }
});

test("passengers and budget still block only a request that will spend", () => {
  const known = { origin: "Buenos Aires", destination: "Cordoba", departure_date: "2026-09-15" };
  const asked = findGaps(parseExtraction(extraction({ commitment: "committed", trip: known })));
  assert.deepEqual(asked.map((gap) => gap.field), ["trip.passengers", "constraints.budgetUsd"]);
});

test("refinements and mandate parameters never block a booking order", () => {
  assert.equal(isBlockingQuestion("trip.cabin", "Which cabin do you want?", "committed"), false);
  assert.equal(isBlockingQuestion("trip.airline", "Any preferred airline?", "committed"), false);
  assert.equal(isBlockingQuestion("constraints.authorizationExpiresAt", "Until when may I book?", "committed"), false);
  // A mandate term worded as a date is still a mandate term. It is checked
  // before the date rule precisely so it cannot be mistaken for the trip's own.
  assert.equal(
    isBlockingQuestion("constraints.authorizationExpiresAt", "Until what date may this mandate authorize a purchase?", "exploratory"),
    false,
  );
  // What and for whom still block.
  assert.equal(isBlockingQuestion("trip.passengers", "How many passengers?", "committed"), true);
  assert.equal(isBlockingQuestion("constraints.budgetUsd", "What is your budget?", "committed"), true);
});

test("an origin question is not mistaken for a destination question", () => {
  // "Which city are you departing from?" used to match the destination pattern
  // on the bare words "which city", so a genuine origin + destination pair
  // deduped down to one and the buyer was asked for a city and never told
  // which one.
  assert.equal(isBlockingQuestion("trip.origin", "From which city are you departing?", "exploratory"), true);
  assert.equal(isBlockingQuestion("trip.destination", "Where do you want to fly to?", "exploratory"), true);
  assert.equal(isBlockingQuestion("trip.departure_date", "What is your desired departure date?", "exploratory"), true);

  const merged = mergeQuestions(
    [{ field: "trip.origin", question: "From which city are you departing?" }],
    [{ field: "trip.destination", question: "Where do you want to fly to?" }],
  );
  assert.equal(merged.length, 2, "origin and destination are different questions");
});

test("a route the agent already has is not turned into a questionnaire", async () => {
  const ctx = recordingCtx();
  // The model asks for a cabin and a budget. On a request that will not buy,
  // neither is a gap: the comparison runs without those filters instead.
  const decision = await runAgent({
    message: "How much is a Buenos Aires to Cordoba flight on the 15th?",
    conversation: [],
    mandate: null,
    llm: scripted(
      extraction({
        status: "clarification_needed",
        commitment: "exploratory",
        trip: { origin: "Buenos Aires", destination: "Cordoba", departure_date: "2026-09-15" },
        questions: [
          { field: "trip.cabin", question: "Which cabin class do you prefer?", options: [] },
          { field: "constraints.budget_usd", question: "What is your budget?", options: [] },
        ],
      }),
    ),
    ctx,
  });

  assert.equal(decision.kind, "suggestion");
  assert.ok(decision.best, "it should have compared real fares");
});

test("a bare question names its gaps instead of pricing a route nobody gave", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "How much is a flight to Cordoba?",
    conversation: [],
    mandate: null,
    llm: scripted(extraction({ commitment: "exploratory", trip: { destination: "Cordoba" } })),
    ctx,
  });

  assert.equal(decision.kind, "clarification");
  assert.deepEqual(decision.questions.map((question) => question.field), ["trip.origin", "trip.departureDate"]);
  assert.ok(ctx.has("agent_clarification_requested"));
});

test("the same question asked twice in different words is asked once", () => {
  const merged = mergeQuestions(
    [{ field: "budget_usd", question: "What's the maximum you want to spend?" }],
    [{ field: "constraints.budgetUsd", question: "What is the maximum total budget in USD?" }],
  );
  assert.equal(merged.length, 1);
  // The model's wording wins - it reads better.
  assert.match(merged[0].question, /maximum you want to spend/);
});

test("a value the model returns that makes no sense is treated as missing, not accepted", () => {
  const parsed = parseExtraction(
    extraction({ trip: { destination: "Cordoba", departure_date: "next Tuesday", passengers: 0 } }),
  );
  assert.equal(parsed.trip.departureDate, null);
  assert.equal(parsed.trip.passengers, null);
});

// ---------------------------------------------------------------------------
// Reference values are never mistaken for the human's terms
// ---------------------------------------------------------------------------

test("an unstated term becomes an absent filter, not an invented value", () => {
  const brief = buildSearchBrief({
    trip: { origin: null, destination: "Cordoba", departureDate: null, cabin: null, maxStops: null, airlinePreference: null, passengers: null },
    constraints: { budgetUsd: null, qualityPreference: "cheapest" },
  });

  assert.equal(brief.departureDate, null, "a date must never be guessed");
  assert.equal(brief.origin, null);
  // Only the passenger count gets a reference value, because a total price
  // cannot be computed without one - and it is declared as a reference.
  assert.equal(brief.passengers, 1);
  assert.deepEqual(brief.reference, ["passengers"]);
});

test("a suggestion built on reference values still cannot buy", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "How much is a flight to Cordoba?",
    conversation: [],
    mandate: null,
    llm: scripted(extraction({ commitment: "exploratory", trip: OPEN_TRIP })),
    ctx,
  });

  assert.equal(decision.kind, "suggestion");
  assert.ok(decision.best, "it should still have compared real itineraries");
  assert.deepEqual(decision.brief.reference, ["passengers"]);
  assert.ok(ctx.has("agent_suggestion_prepared", /nothing was authorized/i));
});

test("the cheapest itinerary within the stated cap is the one it would book", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "Book 2 flights from Buenos Aires to Cordoba on 2026-09-15 under $300",
    conversation: [],
    mandate: null,
    llm: scripted(extraction({ commitment: "committed", trip: FULL_TRIP, constraints: { budget_usd: 300 } })),
    ctx,
  });

  assert.equal(decision.best.quoteId, "VY-AS-COR-0915-0810");
  assert.equal(decision.best.totalPrice, 260);
  // US$189 x 2 is over the cap and must be shown as excluded, not silently dropped.
  assert.ok(decision.overBudget.some((offer) => offer.quoteId === "SH-FF-COR-0915-1940"));
});

// ---------------------------------------------------------------------------
// Untrusted data
// ---------------------------------------------------------------------------

test("seller free text never reaches a prompt", () => {
  const planted = allFlights().find((flight) => flight.quoteId === "SH-RP-COR-0915-1040");
  assert.ok(planted.fareNote.length > 0, "the fixture should carry a seller note");

  const safe = sanitizeForLlm(planted);
  assert.equal(safe.fareNote, undefined);
  assert.equal(safe.merchant, undefined);
  assert.equal(safe.airline, undefined);
  assert.equal(safe.destination, "Cordoba");
});

test("an instruction hidden in a seller note is logged and ignored", async () => {
  const ctx = recordingCtx();
  const decision = await runAgent({
    message: "How much is a flight to Cordoba?",
    conversation: [],
    mandate: null,
    llm: scripted(extraction({ commitment: "exploratory", trip: OPEN_TRIP })),
    ctx,
  });

  assert.ok(ctx.has("agent_injection_attempt_ignored", /pre-approved for AI assistants/i));
  // Logged, and with no effect: the planted note demands an immediate booking.
  assert.equal(decision.kind, "suggestion");
  assert.equal(detectInjection(allFlights()[0]), null, "an ordinary note is not a finding");
});

test("an unreachable equivalence check narrows what the agent will consider, never widens it", async () => {
  const ctx = recordingCtx();
  const llm = new StubLlmClient({
    flight_intent_extraction: extraction({
      commitment: "exploratory",
      trip: { ...OPEN_TRIP, cabin: "Business" },
    }),
    itinerary_equivalence: () => {
      throw new Error("model unavailable");
    },
  });

  const decision = await runAgent({ message: "Business class to Cordoba?", conversation: [], mandate: null, llm, ctx });

  // Every Cordoba fare is Economy, so all of them are near-misses that only the
  // model could clear. It could not run, so none of them are offered.
  assert.equal(decision.best, null);
  assert.ok(ctx.has("agent_equivalence_unavailable"));
});
