import assert from "node:assert/strict";
import test from "node:test";
import { DemoChain } from "../server/demoChain.js";
import { StubLlmClient } from "../server/agent/llm.js";
import { allFlights, searchFlights } from "../server/mockFlights.js";

/**
 * The chain tests script the model so they stay offline and deterministic.
 * What the agent understands is covered in AgentBehaviour.test.js; here it only
 * has to produce the same intent every time so the chain path is what varies.
 */
function martaIntent() {
  return {
    status: "ok",
    commitment: "committed",
    natural_language_description: "Book 1 flight from Buenos Aires to Cordoba on 2026-09-15 under $150",
    trip: {
      origin: "Buenos Aires",
      destination: "Cordoba",
      departure_date: "2026-09-15",
      passengers: 1,
      cabin: null,
      max_stops: null,
      airline_preference: null,
    },
    constraints: { budget_usd: 150, quality_preference: "cheapest", authorization_expires_at: null },
    questions: [],
  };
}

function chainWithScriptedAgent(intent = martaIntent()) {
  return new DemoChain({
    llm: new StubLlmClient({
      flight_intent_extraction: intent,
      itinerary_equivalence: { acceptable: false, reason: "Not the same trip." },
    }),
  });
}

function futureDate(days = 30) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function signedMartaMandate(chain, { budget = "150", quantity = 1, expiry = futureDate() } = {}) {
  await chain.reset();
  await chain.loginAndEnrollBuyer();
  const intent = await chain.recordIntent({
    prompt: "Book 1 flight from Buenos Aires to Cordoba on 2026-09-15 under $150",
  });
  // With nothing signed yet, the agent compares and opens an editable draft.
  // It cannot reach a purchase from here no matter how the request was phrased.
  assert.equal(intent.kind, "suggestion");
  assert.equal(intent.state.flight.selection, null);
  assert.equal(intent.draft.status, "needs_input");
  assert.ok(intent.draft.questions.some((question) => question.field === "authorizationExpiresAt"));

  const revised = await chain.reviseDraft({
    productName: "Book 1 flight from Buenos Aires to Cordoba on 2026-09-15 under $150",
    origin: "Buenos Aires",
    destination: "Cordoba",
    departureDate: "2026-09-15",
    authorizationExpiresAt: expiry,
    seller: "Any airline",
    quantity,
    budget,
    cabin: "Economy",
    maxStops: 0,
  });
  assert.equal(revised.flight.draft.status, "ready");
  await chain.confirmDraft();
  return chain.createMarketplaceMandate();
}

test("Marta completes the human -> agent -> merchant -> payment flow at US$130", async () => {
  const chain = chainWithScriptedAgent();
  const signed = await signedMartaMandate(chain);
  assert.equal(signed.mandate.status, "Active");
  assert.equal(signed.balances.buyer, "2000.0");
  assert.equal(signed.flight.draft.signing.mandateId, signed.mandate.id);

  const authorization = await chain.compareAndAuthorize();
  assert.equal(authorization.status, "authorized");
  assert.equal(authorization.selection.merchant, "VuelaYa");
  assert.equal(authorization.selection.selected.airline, "AeroSur");
  assert.equal(authorization.selection.selected.amount, "130.00");
  assert.equal(authorization.state.balances.buyer, "2000.0");

  const verified = await chain.verifyPurchase(authorization.purchaseId);
  assert.equal(verified.verified, true);
  assert.equal(verified.checks.flightConstraintHashMatches, true);

  const captured = await chain.capturePurchase(authorization.purchaseId);
  assert.equal(captured.state.balances.buyer, "1870.0");
  assert.equal(captured.state.balances.VuelaYa, "130.0");
  assert.equal(captured.state.flight.selection.status, "Settled");
});

test("an incomplete draft cannot be confirmed or signed", async () => {
  const chain = chainWithScriptedAgent({
    ...martaIntent(),
    constraints: { budget_usd: null, quality_preference: "cheapest", authorization_expires_at: null },
  });
  await chain.reset();

  // No budget on a booking order: the agent asks instead of guessing, and no
  // draft is opened for a request it does not yet understand.
  const asked = await chain.recordIntent({ prompt: "Book a flight from Buenos Aires to Cordoba" });
  assert.equal(asked.kind, "clarification");
  assert.ok(asked.questions.some((question) => /budget/i.test(question.question)));
  assert.equal(asked.state.flight.draft, null);
  assert.equal(asked.state.flight.selection, null);

  await assert.rejects(chain.confirmDraft(), /Complete the flight mandate fields/);
  await assert.rejects(chain.createMarketplaceMandate(), /Complete mock KYC|Review and confirm/);
});

test("an out-of-limit fare is rejected before authorization or payment", async () => {
  const chain = chainWithScriptedAgent();
  await signedMartaMandate(chain);
  const result = await chain.attemptOutsideMandate();
  assert.equal(result.rejected, true);
  assert.equal(Number(result.attemptedUnitPrice), 300);
  assert.equal(result.state.flight.selection, null);
  assert.equal(result.state.balances.buyer, "2000.0");
  assert.ok(result.state.audit.some((entry) => entry.type === "outside_mandate_purchase_rejected"));
});

test("a non-delegated wallet cannot impersonate the agent", async () => {
  const chain = chainWithScriptedAgent();
  await signedMartaMandate(chain);
  const result = await chain.attemptImpersonatedAgent();
  assert.equal(result.rejected, true);
  assert.match(result.reason, /NOT_AGENT|agent/i);
  assert.equal(result.state.flight.selection, null);
  assert.equal(result.state.balances.buyer, "2000.0");
});

test("revocation invalidates an unused authorization and blocks the next attempt", async () => {
  const chain = chainWithScriptedAgent();
  await signedMartaMandate(chain);
  const authorization = await chain.compareAndAuthorize();
  await chain.revokeMandate();

  const verification = await chain.verifyPurchase(authorization.purchaseId);
  assert.equal(verification.verified, false);
  assert.equal(verification.checks.mandateActive, false);
  await assert.rejects(chain.capturePurchase(authorization.purchaseId), /verification failed/i);

  const nextAttempt = await chain.attemptAfterRevocation();
  assert.equal(nextAttempt.rejected, true);
  assert.equal(nextAttempt.state.mandate.status, "Revoked");
  assert.equal(nextAttempt.state.balances.buyer, "2000.0");
});

test("expiry blocks a valid-looking purchase on the local chain", async () => {
  const chain = chainWithScriptedAgent();
  await signedMartaMandate(chain, { expiry: futureDate(2) });
  const result = await chain.attemptExpiredMandate();
  assert.equal(result.rejected, true);
  assert.equal(result.state.mandate.status, "Expired");
  assert.equal(result.state.balances.buyer, "2000.0");
  await assert.rejects(chain.compareAndAuthorize(), /Sign a flight mandate|no longer active/);
});

test("every mock destination has a nonstop option a mandate can actually reach", () => {
  const routes = new Map();
  for (const flight of allFlights()) {
    if (!routes.has(flight.destination)) routes.set(flight.destination, []);
    routes.get(flight.destination).push(flight);
  }
  assert.deepEqual(
    [...routes.keys()].sort(),
    ["Bogota", "Cordoba", "Mendoza", "Mexico City", "Sao Paulo"],
  );
  for (const [destination, flights] of routes) {
    // maxStops defaults to 0 on an unstated draft, so a route whose every
    // itinerary connects can never produce an eligible offer.
    assert.ok(
      flights.some((flight) => flight.stops === 0),
      `${destination} has no nonstop option`,
    );
  }
});

test("a city is not also read as the country its name contains", () => {
  // " mexico city " contains " mexico ", so the country alias matched inside
  // the city one. That put two places in a single-destination request, and
  // productMatchesOffer then demanded the itinerary match a country nobody
  // named. Longest alias wins, and its span is consumed.
  for (const [query, destination] of [
    ["Flight from Buenos Aires to Mexico City on 2026-09-15", "Mexico City"],
    ["Flight from Buenos Aires to CDMX on 2026-09-15", "Mexico City"],
    ["Flight from Buenos Aires to Sao Paulo on 2026-09-15", "Sao Paulo"],
    ["Flight from Buenos Aires to Bogota on 2026-09-15", "Bogota"],
  ]) {
    const found = searchFlights({ productName: query, origin: "Buenos Aires", destination });
    assert.equal(found.offers.length, 3, `${destination} should return its three itineraries`);
  }

  // The country on its own still matches no itinerary, which is the safe
  // "no offer" path the mandate is meant to reach.
  const country = searchFlights({ productName: "Flight to Mexico", origin: "Buenos Aires", destination: "Mexico City" });
  assert.equal(country.offers.length, 0);
});

test("the signed free-text product query is still a real search filter", () => {
  const noMatch = searchFlights({
    productName: "Book a flight to Mendoza",
    origin: "Buenos Aires",
    destination: "Cordoba",
  });
  assert.equal(noMatch.offers.length, 0);
});

test("the demo can return to the signed phase so a second trial can run", async () => {
  const chain = chainWithScriptedAgent();
  await signedMartaMandate(chain, { expiry: futureDate(2) });

  // The first trial ends the mandate it runs against, which is the point of it.
  const expiredTrial = await chain.attemptExpiredMandate();
  assert.equal(expiredTrial.state.mandate.status, "Expired");
  const stepsBefore = expiredTrial.state.audit.length;

  // The clock is now past the buyer's own validity date, so the reset has to
  // re-sign with a date the chain will still accept rather than refuse.
  const resigned = await chain.resetToSignedMandate();
  assert.equal(resigned.mandate.status, "Active");
  assert.notEqual(resigned.mandate.id, expiredTrial.state.mandate.id);
  assert.equal(resigned.flight.draft.status, "signed");
  assert.equal(resigned.flight.selection, null);
  assert.equal(resigned.flight.search.status, "not_started");
  assert.equal(resigned.balances.buyer, "2000.0");

  // Erasing the rejections that already happened is the one thing this must
  // never do: the trail is the evidence.
  assert.ok(resigned.audit.length > stepsBefore);
  assert.ok(resigned.audit.some((entry) => entry.type === "expired_mandate_purchase_rejected"));
  assert.ok(resigned.audit.some((entry) => entry.type === "demo_reset_to_signed_mandate"));

  // And the fresh mandate is a working one, not just an Active-looking record.
  const second = await chain.attemptOutsideMandate();
  assert.equal(second.rejected, true);
  assert.equal(second.state.balances.buyer, "2000.0");
});

test("a mandate that was never signed cannot be reset back to a signed phase", async () => {
  const chain = chainWithScriptedAgent();
  await chain.reset();
  await chain.loginAndEnrollBuyer();
  await assert.rejects(chain.resetToSignedMandate(), /Sign a mandate once/);
});
