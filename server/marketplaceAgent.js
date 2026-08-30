import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-4.1-mini";
let client = null;

function openAiClient() {
  if (client === null) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function outputSchema(catalog) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      product_id: { type: "string", enum: [...catalog.map((product) => product.id), "not_found"] },
      quantity: { type: "integer", minimum: 1, maximum: 20 },
      has_quantity: { type: "boolean" },
      has_budget: { type: "boolean" },
      budget_total_usd: { type: "number", minimum: 0 },
    },
    required: ["reply", "product_id", "quantity", "has_quantity", "has_budget", "budget_total_usd"],
  };
}

/**
 * Converts natural language into a constrained catalog request. It has no
 * access to wallets, mandates, seller choice, or payment operations.
 */
export async function askMarketplaceAgent({ prompt, catalog, conversation, draft = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.MARKETPLACE_AGENT_MODE === "fallback") {
    return { mode: "catalog fallback", model: null, requestId: null, result: null };
  }

  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const catalogContext = catalog.map(({ id, name, description, aliases, matchTerms, offers }) => ({
    id,
    name,
    description,
    aliases,
    match_terms: matchTerms ?? [],
    offers: offers.map(({ merchant, unitPrice, delivery, stock }) => ({ merchant, unitPrice, delivery, stock })),
  }));
  const history = conversation.slice(-10).map(({ role, content }) => ({ role, content }));

  try {
    const response = await openAiClient().responses.create({
      model,
      store: false,
      max_output_tokens: 220,
      text: {
        // gpt-4.1-mini supports `medium` verbosity on the Responses API.
        // Keeping this explicit makes the structured response deterministic.
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "catalog_purchase_request",
          strict: true,
          schema: outputSchema(catalog),
        },
      },
      instructions: [
        "You are Chk Buyer, a concise purchasing-chat assistant.",
        "Interpret the buyer's latest message against only the supplied seller catalog and create or revise a purchase-mandate draft.",
        "Match semantically: use product names, descriptions, capabilities, aliases, and match_terms. Do not require an exact product name.",
        "Choose a catalog product only when it genuinely satisfies the buyer's request; otherwise use not_found and politely explain what kind of clarification or alternative would help.",
        "When active_draft exists, retain its product and constraints only when the latest message is clearly a revision of that draft. A request for a different item must be treated as a new product search.",
        "Set has_quantity true only when the latest message specifies or changes a quantity. Set has_budget true only when it specifies or changes a total budget. Use 1 and 0 respectively when absent.",
        "Your reply must be one helpful sentence about the draft. Never choose a seller, assess whether a budget is sufficient, or claim that a mandate, payment, seller selection, or price verification has occurred.",
      ].join(" "),
      input: JSON.stringify({
        conversation: history,
        active_draft: draft ? {
          product: draft.product,
          quantity: draft.quantity,
          unit_price_cap_usd: draft.maxUnitPrice,
          total_budget_usd: draft.budget,
          revision: draft.revision,
        } : null,
        latest_buyer_message: prompt,
        catalog: catalogContext,
      }),
    });

    const result = JSON.parse(response.output_text);
    if (!result || typeof result.reply !== "string" || typeof result.product_id !== "string") {
      throw new Error("The model returned an invalid catalog response.");
    }
    return {
      mode: "OpenAI live",
      model: response.model ?? model,
      requestId: response.id,
      result,
    };
  } catch (error) {
    return {
      mode: "OpenAI unavailable",
      model,
      requestId: null,
      result: null,
      error: error instanceof Error ? error.message : "OpenAI request failed",
    };
  }
}
