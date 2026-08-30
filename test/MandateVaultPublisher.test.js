import assert from "node:assert/strict";
import test from "node:test";
import { id } from "ethers";
import { buildCreateMandateArguments } from "../src/blockchain/mandateVaultPublisher.js";

const request = {
  agent: "0x00000000000000000000000000000000000000a1",
  merchant: "0x00000000000000000000000000000000000000b2",
  paymentMethodId: id("buyer-business-card-token"),
  productReference: "industrial-stretch-film-500m",
  quantity: 20,
  maxUnitPrice: "8500",
  budget: "500000",
  expiresAt: 4_102_444_800,
  tokenDecimals: 6,
};

test("buyer publication encodes a reviewed mandate into MandateVault arguments", () => {
  const [agent, merchant, paymentMethodId, productHash, quantity, maxUnitPrice, budget, expiresAt] =
    buildCreateMandateArguments(request);

  assert.equal(agent, request.agent);
  assert.equal(merchant, request.merchant);
  assert.equal(paymentMethodId, request.paymentMethodId);
  assert.equal(productHash, id(request.productReference));
  assert.equal(quantity, 20n);
  assert.equal(maxUnitPrice, 8_500_000_000n);
  assert.equal(budget, 500_000_000_000n);
  assert.equal(expiresAt, request.expiresAt);
});

test("buyer publication rejects a mandate whose budget cannot cover its limits", () => {
  assert.throws(
    () => buildCreateMandateArguments({ ...request, budget: "100" }),
    /budget must cover/,
  );
});
