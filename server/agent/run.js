/**
 * The whole run: prompt -> intent -> (buy | suggest | ask).
 *
 * Ported from `agente-Nico` (agent/src/agent/run.ts, commit c344d1a). The
 * order of the checks is where the guarantee lives, so it is worth reading
 * carefully:
 *
 *   1. Is there a signed mandate?   if not -> suggest. Commitment is not consulted.
 *   2. Is the request an order?     if not -> suggest.
 *   3. Does the mandate allow it?   decided in code, by the policy engine.
 *
 * Step 2 can only turn a "yes" from step 1 into a "no". Never the other way
 * round: there is no path by which a very committed request reaches a purchase
 * without a mandate. That is why step 1 goes first and does not even look at
 * the commitment level.
 *
 * This module never touches the chain. It ends at a decision - buy this, or
 * suggest this - and the caller carries it out. The agent's inability to spend
 * on its own is a property of what it was handed, not of a promise it makes.
 */

import { extractIntent } from "./intent.js";
import { suggest } from "./suggest.js";

/** Why this run is suggesting instead of buying, in the human's language. */
function suggestionDetail(reason, intent) {
  switch (reason) {
    case "no_mandate":
      return "There is no signed mandate for this account. I can search and compare, but I cannot book until you sign the mandate below.";
    case "mandate_unusable":
      return "The mandate exists but is not usable right now (revoked, expired, or out of budget). This is what I would book if it were active again.";
    case "exploratory_request":
      return `I read this as a question rather than an order to book: "${intent.naturalLanguageDescription}". Ask me directly if you want me to book it.`;
    case "conditional_request":
      return `This depends on something that has not happened yet: "${intent.naturalLanguageDescription}". Here is what I would book today if that condition were met.`;
    default:
      return "I compared the options without booking anything.";
  }
}

/**
 * @param mandate `null` means the human has not signed any mandate yet.
 *   Otherwise `{ id, usable, terms }` - read once, by the caller, which is the
 *   only party with chain access.
 */
export async function runAgent({ message, conversation, mandate, llm, ctx }) {
  ctx.audit({
    type: "agent_run_started",
    detail: `Buyer turn received with ${mandate ? `signed mandate #${mandate.id}` : "no signed mandate"}.`,
  });

  const extraction = await extractIntent({ message, conversation, llm, ctx });
  if (extraction.status === "clarification_needed") {
    return {
      kind: "clarification",
      commitment: extraction.commitment,
      questions: extraction.questions,
      partial: extraction.partial,
    };
  }

  const intent = extraction.intent;
  const asSuggestion = async (reason) => ({
    ...(await suggest({
      brief: intent.brief,
      reason,
      mandateTerms: reason === "no_mandate" || reason === "mandate_unusable" ? null : mandate?.terms ?? null,
      llm,
      ctx,
    })),
    intent,
    detail: suggestionDetail(reason, intent),
  });

  // Step 1. With no signed mandate there is no possible purchase, and the
  // commitment level is irrelevant: it is not consulted, and it is not recorded
  // as though it enabled anything.
  if (mandate === null) {
    ctx.audit({
      type: "agent_commitment_assessed",
      detail: `Request commitment "${intent.commitment}" was not consulted: with no signed mandate it cannot stand in for one. Executes: no.`,
    });
    return asSuggestion("no_mandate");
  }

  // Step 2. There is a mandate and the request is a concrete order: the gate
  // lets it through and the policy engine decides.
  if (intent.commitment === "committed" && mandate.usable) {
    ctx.audit({
      type: "agent_commitment_assessed",
      detail: 'Concrete booking order over a usable mandate. The commitment gate passes it to the policy engine. Executes: yes.',
    });
    return { kind: "purchase_order", intent };
  }

  // Step 3. The request is not an order, or the mandate cannot be used. Either
  // way this run compares without spending.
  const reason = !mandate.usable
    ? "mandate_unusable"
    : intent.commitment === "exploratory"
      ? "exploratory_request"
      : "conditional_request";

  ctx.audit({
    type: "agent_commitment_assessed",
    detail: `Request is "${intent.commitment}" and the mandate is ${mandate.usable ? "usable" : "not usable"}: search and compare, do not book. Executes: no.`,
  });
  return asSuggestion(reason);
}
