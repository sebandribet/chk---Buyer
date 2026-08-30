/**
 * Everything that comes back from a search is hostile data.
 *
 * Ported from `agente-Nico` (agent/src/agent/untrusted.ts, commit c344d1a).
 *
 * An agent that buys reads text written by whoever wants to sell to it. If
 * that text reaches a prompt unfiltered, the seller gets to give orders to the
 * buyer - which is the agentic version of writing your own discount.
 *
 * The defence here is structural, not a classifier: the model only ever
 * receives a hand-picked subset of typed fields. The seller's free text never
 * crosses. The detector below is not the protection; it is instrumentation, so
 * the attempt shows up in the audit trail.
 */

/**
 * The view of an offer that is allowed into a prompt.
 *
 * Deliberately without `fareNote`, `merchant` and `airline`: those are the
 * fields where a seller can write whatever they like. The model judges an
 * itinerary on its shape - route, date, time, stops, cabin, price - which is
 * all the equivalence question actually needs.
 */
export function sanitizeForLlm(offer) {
  return {
    quoteId: offer.quoteId,
    origin: offer.origin,
    destination: offer.destination,
    departureDate: offer.departureDate,
    departureTime: offer.departureTime,
    arrivalTime: offer.arrivalTime,
    cabin: offer.cabin,
    stops: offer.stops,
    seats: offer.seats,
    unitPriceUsd: Math.round(Number(offer.unitPrice) * 100) / 100,
  };
}

/**
 * Phrases that only make sense if the text was written for a model rather than
 * for a human traveller. Useful for logging the attempt, not for stopping it:
 * what stops it is that `fareNote` never travels to any prompt.
 */
const INJECTION_PATTERNS = [
  /\bignore\s+(all|any|previous|prior|your)\b/i,
  /\bdisregard\b/i,
  /\bsystem\s*:/i,
  /\bpre[-\s]?approved\b/i,
  /\bno\s+(further\s+)?(verification|authorization|approval)\s+(is\s+)?(required|needed)\b/i,
  /\bunlimited\s+(purchase|spend|budget)\b/i,
  /\b(ai\s+)?(assistants?|agents?)\s*[:,]/i,
  /\byou\s+(are|must|should)\s+(now\s+)?(authoriz|approv|book|buy)/i,
  /\bignor[aá]\s+(las?|los?|tus?)\b/i,
  /\bpre[-\s]?aprobado\b/i,
];

export function detectInjection(offer) {
  const note = offer.fareNote;
  if (typeof note !== "string" || note.length === 0) return null;
  if (!INJECTION_PATTERNS.some((pattern) => pattern.test(note))) return null;

  return {
    quoteId: offer.quoteId,
    merchant: offer.merchant,
    // Trimmed, so the audit event stays readable without dumping the whole text.
    snippet: note.length > 120 ? `${note.slice(0, 120)}...` : note,
  };
}

/** Every injection attempt in a result set, for one audit event per search. */
export function detectInjections(offers) {
  return offers.map((offer) => detectInjection(offer)).filter((finding) => finding !== null);
}
