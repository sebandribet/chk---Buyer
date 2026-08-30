/**
 * What the human reads.
 *
 * Ported in spirit from `agente-Nico` (agent/src/agent/reply.ts, commit
 * c344d1a). One rule governs every sentence here: the reply may only state
 * things the structured decision already contains. It never rewords the
 * outcome into something softer, and it never claims an action the agent did
 * not take. A reply that says "booked" when the policy engine said "suggested"
 * is worse than no reply at all.
 */

const REFERENCE_LABELS = {
  passengers: "one passenger",
  origin: "any departure city",
  departureDate: "any date",
  cabin: "any cabin",
  maxStops: "any number of stops",
};

function money(value) {
  return `US$${Number(value).toFixed(2)}`;
}

function itinerary(offer) {
  return `${offer.airline} ${offer.quoteId} (${offer.origin} to ${offer.destination}, ${offer.departureDate} ${offer.departureTime}, ${offer.stops === 0 ? "direct" : `${offer.stops} stop(s)`}, ${offer.cabin})`;
}

/** The terms the agent filled in itself, said out loud so they cannot pass as the human's. */
function referenceNote(brief) {
  if (brief.reference.length === 0) return "";
  const labels = brief.reference.map((field) => REFERENCE_LABELS[field] ?? field);
  return ` You did not specify ${labels.join(" or ")}, so I compared using ${labels.join(" and ")} as a reference - not as something you asked for.`;
}

export function clarificationReply(decision) {
  const questions = decision.questions.map((question) => question.question);
  const opening = questions.length === 1
    ? "I need one more thing before I can look anything up:"
    : `I need ${questions.length} more things before I can look anything up:`;
  return `${opening} ${questions.join(" ")} I have not searched, signed, or charged anything.`;
}

export function suggestionReply(decision) {
  const { best, options, overBudget, brief, detail } = decision;

  if (!best) {
    const nothing = options.length === 0 && overBudget.length === 0
      ? "I could not find any itinerary on that route in the catalogue."
      : `Nothing fits ${brief.budgetUsd === null ? "what you asked for" : `the ${money(brief.budgetUsd)} cap`}: the closest option is ${money(overBudget[0].totalPrice)}.`;
    return `${detail} ${nothing} I have not booked anything.`;
  }

  const alternatives = options.length > 1 ? ` I compared ${options.length} options and this was the best of them.` : "";
  return `${detail} I would book ${itinerary(best)} at ${money(best.unitPrice)} per ticket, ${money(best.totalPrice)} for ${best.passengers} passenger(s).${alternatives}${referenceNote(brief)}`;
}

export function purchaseOrderReply(intent) {
  return `Understood as a booking order: ${intent.naturalLanguageDescription}. Checking it against your signed mandate now - the mandate decides, not me.`;
}

export function agentReply(decision) {
  switch (decision.kind) {
    case "clarification":
      return clarificationReply(decision);
    case "suggestion":
      return suggestionReply(decision);
    case "purchase_order":
      return purchaseOrderReply(decision.intent);
    default:
      return "I could not process that request.";
  }
}
