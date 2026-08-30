import assert from "node:assert/strict";
import test from "node:test";
import { DemoChain } from "../server/demoChain.js";
import { StubLlmClient } from "../server/agent/llm.js";
import { searchFlights } from "../server/mockFlights.js";

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

test("the signed free-text product query is still a real search filter", () => {
  const noMatch = searchFlights({
    productName: "Book a flight to Mendoza",
    origin: "Buenos Aires",
    destination: "Cordoba",
  });
  assert.equal(noMatch.offers.length, 0);
});
