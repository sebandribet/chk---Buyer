import assert from "node:assert/strict";
import test from "node:test";
import { DemoChain } from "../server/demoChain.js";

test("live demo chain runs the merchant-verification trial by fire", async () => {
  const demo = new DemoChain();
  const initial = await demo.reset({
    product: "flight-cordoba",
    quantity: 1,
    maxUnitPrice: "150",
    budget: "150",
  });
  assert.equal(initial.kyc.status, "Login required");
  assert.equal(initial.mandate, null);
  assert.equal(initial.balances.buyer, "2000.0", "initializing must not pre-fund a mandate");

  const kyc = await demo.loginAndEnrollBuyer();
  assert.equal(kyc.kyc.status, "Verified and payment-token enrolled");
  const signed = await demo.createMandate();
  assert.equal(signed.mandate.maxUnitPrice, "150.0");
  assert.equal(signed.balances.buyer, "2000.0", "signing a mandate must not debit the buyer");

  const purchase = await demo.reservePurchase({
    orderReference: "VuelaYa-COR-130",
    quantity: 1,
    unitPrice: "130",
  });
  const verification = await demo.verifyPurchase(purchase.purchaseId);
  assert.equal(verification.verified, true);
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
  assert.equal(finalState.audit.length, 8);
});
