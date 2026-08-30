import assert from "node:assert/strict";
import test from "node:test";
import { DemoChain } from "../server/demoChain.js";

test("live demo chain runs the merchant-verification trial by fire", async () => {
  const demo = new DemoChain();
  const initial = await demo.reset({
    product: "flight-cordoba",
    quantity: 3,
    maxUnitPrice: "150",
    budget: "450",
  });
  assert.equal(initial.kyc.status, "Login required");
  assert.equal(initial.mandate, null);
  assert.equal(initial.balances.buyer, "2000.0", "initializing must not pre-fund a mandate");

  const kyc = await demo.loginAndEnrollBuyer();
  assert.equal(kyc.kyc.status, "Verified and payment-token enrolled");
  const signed = await demo.createMandate();
  assert.equal(signed.mandate.maxUnitPrice, "150.0");
  assert.equal(signed.balances.buyer, "2000.0", "signing a mandate must not debit the buyer");

  await assert.rejects(
    demo.reservePurchase({ orderReference: "VuelaYa-COR-300-first", quantity: 1, unitPrice: "300" }),
    /PRICE_EXCEEDED/,
  );

  const trialPurchase = await demo.reservePurchase({
    orderReference: "VuelaYa-COR-110-trial",
    quantity: 1,
    unitPrice: "110",
  });
  const releasedTrial = await demo.releasePurchase(trialPurchase.purchaseId, "agent");
  assert.equal(releasedTrial.mandate.remainingQuantity, "3");
  assert.equal(releasedTrial.mandate.remainingBudget, "450.0");
  const releaseEvidence = releasedTrial.audit.find((entry) => entry.type === "unused_authorization_released");
  assert.equal(releaseEvidence.releasedBy, "agent");
  assert.equal(releaseEvidence.releasedByAddress, releasedTrial.identities.agent);

  const purchase = await demo.reservePurchase({
    orderReference: "VuelaYa-COR-130",
    quantity: 1,
    unitPrice: "130",
  });
  const verification = await demo.verifyPurchase(purchase.purchaseId);
  assert.equal(verification.verified, true);
  const verificationEvidence = (await demo.state()).audit.find((entry) => entry.type === "merchant_verification_passed");
  assert.equal(Object.keys(verificationEvidence.checks).length, 10);
  assert.deepEqual(verificationEvidence.failedChecks, []);
  const beforeCapture = await demo.state();
  assert.equal(beforeCapture.balances.buyer, "2000.0", "authorization must not move money");
  assert.equal(beforeCapture.balances.merchant, "0.0");
  await demo.capturePurchase(purchase.purchaseId);

  await demo.amendPriceCap("120");
  await assert.rejects(
    demo.reservePurchase({ orderReference: "VuelaYa-COR-130-after-limit", quantity: 1, unitPrice: "130" }),
  );

  await demo.revokeMandate();
  await assert.rejects(
    demo.reservePurchase({ orderReference: "VuelaYa-COR-110-after-revocation", quantity: 1, unitPrice: "110" }),
  );

  const finalState = await demo.state();
  assert.equal(finalState.mandate.status, "Revoked");
  assert.equal(finalState.balances.merchant, "130.0");
  assert.equal(finalState.audit.length, 15);
  assert.deepEqual(
    finalState.audit.slice(-3).map((entry) => entry.type),
    ["agent_purchase_rejected", "mandate_revoked", "agent_purchase_rejected"],
  );
  assert.match(finalState.audit.at(-3).detail, /PRICE_EXCEEDED/);
  assert.equal(finalState.audit.at(-3).unitPrice, "130.0");
  assert.equal(finalState.audit.at(-3).maxUnitPrice, "120.0");
  assert.match(finalState.audit.at(-1).detail, /MANDATE_INACTIVE/);
  assert.equal(finalState.audit.some((entry) => entry.type === "merchant_verification_passed"), true);
  assert.equal(finalState.audit.some((entry) => entry.context === "capture_revalidation" && entry.type === "merchant_verification_passed"), true);
  const auditBlocks = finalState.audit.map((entry) => Number(entry.blockNumber));
  assert.deepEqual(auditBlocks, [...auditBlocks].sort((left, right) => left - right));
  assert.equal(Number(finalState.network.latestBlock), Math.max(...auditBlocks));
});
