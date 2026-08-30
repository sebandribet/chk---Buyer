/**
 * Record the rehearsed prompts, so the demo can run offline.
 *
 * Run this once, by hand, when the rehearsal script changes:
 *
 *     node server/agent/record.js
 *
 * It calls the real model and writes one fixture per prompt. After that the
 * server answers those prompts from disk with no key and no network, and still
 * falls back to the live model for anything nobody rehearsed - which is the
 * whole point, because the interesting question at a demo is always the one
 * that was not rehearsed.
 *
 * The tests do not use these fixtures. They script the model directly, so the
 * agent's behaviour stays verifiable even with an empty fixture directory.
 */

import { RecordingClient, loadEnvFile } from "./llm.js";
import { conversationPrompt, extractIntent } from "./intent.js";

loadEnvFile();

/** Each entry is one conversation, oldest turn first. */
const REHEARSALS = [
  ["How much is a flight to Cordoba?"],
  ["What flights are there to Mendoza?"],
  ["Book 2 flights from Buenos Aires to Cordoba on 2026-09-15 under $300"],
  ["Book a flight from Buenos Aires to Cordoba"],
  ["I want to go to Cordoba", "for two people", "on 2026-09-15, under $300"],
  ["Let's go to Brazil"],
  ["I want help preparing for a presentation."],
  ["Book me the cheapest direct flight to Cordoba on 2026-09-15 for one person, up to $200"],
];

const ctx = {
  now: () => new Date(),
  nextId: (prefix) => `${prefix}-record`,
  audit: () => {},
};

const llm = new RecordingClient();
let recorded = 0;
let failed = 0;

for (const turns of REHEARSALS) {
  const conversation = [];
  for (const turn of turns) {
    const prompt = conversationPrompt(conversation, turn);
    try {
      const result = await extractIntent({ message: turn, conversation, llm, ctx });
      conversation.push({ role: "user", content: turn });
      conversation.push({ role: "assistant", content: "(recorded)" });
      recorded += 1;
      const summary = result.status === "ok"
        ? `${result.intent.commitment} -> ${result.intent.trip.destination ?? "(no destination)"}`
        : `asks ${result.questions.length} question(s)`;
      console.log(`  recorded: ${JSON.stringify(turn)} - ${summary}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAILED:   ${JSON.stringify(turn)} - ${error.message}`);
      console.error(`            prompt key was built from:\n${prompt.slice(0, 200)}`);
    }
  }
}

console.log(`\n${recorded} fixture(s) recorded, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
