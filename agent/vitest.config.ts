import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Los tests corren siempre offline: el LlmClient real nunca se instancia.
    env: { LLM_MODE: "replay" },
    include: ["tests/**/*.test.ts"],
  },
});
