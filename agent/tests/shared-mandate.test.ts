import { describe, expect, it } from "vitest";
import { toCanonicalMandate as toAgentCanonicalMandate } from "@/contracts/mandate.js";
import { mandateScenarios, toCanonicalMandate as toUiCanonicalMandate } from "../../ui/mandates/mandateDisplayModels.js";

describe("shared mandate contract", () => {
  it("maps the UI display model into the canonical purchasing vocabulary", () => {
    const scenario = mandateScenarios[1];
    if (scenario === undefined) throw new Error("Missing active mandate fixture");
    const display = scenario.mandate;
    const mandate = toUiCanonicalMandate(display, "0xowner", new Date("2026-09-01T00:00:00.000Z"));

    expect(mandate.mandateId).toBe("0x4e0f...07bc");
    expect(mandate.status).toBe("Active");
    expect(mandate.policy.allowedSuppliers).toEqual(["acme-supplies"]);
    expect(mandate.maxTotal).toBe(500);
  });

  it("maps the agent's read-only mandate state into the same vocabulary", () => {
    const mandate = toAgentCanonicalMandate(
      {
        mandateId: "mandate-001",
        active: true,
        revokedAt: null,
        expiresAt: "2099-01-01T00:00:00.000Z",
        budgetTotalArs: 500_000,
        budgetSpentArs: 120_000,
        maxPerPurchaseArs: 150_000,
        allowedCategories: ["cleaning"],
        allowedSuppliers: ["acme-supplies"],
        readAt: "2026-08-29T12:00:00.000Z",
        blockNumber: 1,
        source: "fake",
      },
      {
        owner: "0xowner",
        agent: "0xagent",
        paymentDelegate: "0xadapter",
        policyHash: "0xpolicy",
      },
    );

    expect(mandate.status).toBe("Active");
    expect(mandate.spent).toBe(120_000);
    expect(mandate.policy.allowedCategories).toEqual(["cleaning"]);
  });
});
