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

test("marketplace demo selects the cheaper approved seller and settles into that seller wallet", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer({
    name: "Ada Lovelace",
    email: "ada@analytical.demo",
    company: "Analytical Engines",
  });

  const { intent } = await demo.recordIntent({ prompt: "Buy 2 ergonomic chairs under $500" });
  assert.equal(intent.product, "Ergonomic office chair");
  assert.equal(intent.maxUnitPrice, "250.00");

  const signed = await demo.createMarketplaceMandate();
  assert.equal(signed.mandate.marketplace, true);

  const result = await demo.compareAndAuthorize();
  assert.equal(result.selection.merchant, "SupplyHub", "agent must select the lower eligible quote");
  assert.equal(result.selection.selected.amount, "378.00");

  const verification = await demo.verifyPurchase(result.purchaseId);
  assert.equal(verification.verified, true);

  const beforeCapture = await demo.state();
  assert.equal(beforeCapture.balances.buyer, "2000.0");
  assert.equal(beforeCapture.balances.merchant, "0.0");
  assert.equal(beforeCapture.balances.alternateMerchant, "0.0");

  await demo.capturePurchase(result.purchaseId);
  const settled = await demo.state();
  assert.equal(settled.balances.buyer, "1622.0");
  assert.equal(settled.balances.merchant, "0.0");
  assert.equal(settled.balances.alternateMerchant, "378.0");
});

test("agent declines an unavailable prompt, then selects a different seller for a different product", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  const unavailable = await demo.recordIntent({ prompt: "Buy 2 pizza ovens" });
  assert.equal(unavailable.intent.status, "not_found");
  assert.match(unavailable.intent.reply, /couldn't find/i);
  assert.equal(unavailable.state.mandate, null);
  assert.equal(unavailable.state.balances.buyer, "2000.0");

  const available = await demo.recordIntent({ prompt: "Buy 3 mechanical keyboards" });
  assert.equal(available.intent.status, "available");
  assert.equal(available.intent.budgetSource, "live seller quotes");
  assert.equal(available.intent.budget, "327.00");

  await demo.createMarketplaceMandate();
  const purchase = await demo.compareAndAuthorize();
  assert.equal(purchase.selection.merchant, "OfficeCore");
  assert.equal(purchase.selection.selected.amount, "288.00");

  await demo.capturePurchase(purchase.purchaseId);
  const settled = await demo.state();
  assert.equal(settled.balances.buyer, "1712.0");
  assert.equal(settled.balances.merchant, "288.0");
  assert.equal(settled.balances.alternateMerchant, "0.0");
});

test("the buyer can continue the conversation and make a second purchase without resetting wallets", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  await demo.recordIntent({ prompt: "Buy an ergonomic chair" });
  await demo.createMarketplaceMandate();
  const first = await demo.compareAndAuthorize();
  await demo.capturePurchase(first.purchaseId);

  const nextIntent = await demo.recordIntent({ prompt: "Buy a mechanical keyboard" });
  assert.equal(nextIntent.intent.product, "Wireless mechanical keyboard");
  assert.equal(nextIntent.state.mandate, null, "a completed purchase must not block the next mandate");
  assert.equal(nextIntent.state.marketplace.selection, null);

  await demo.createMarketplaceMandate();
  const second = await demo.compareAndAuthorize();
  assert.equal(second.selection.mandateId, "2");
  assert.equal(second.selection.merchant, "OfficeCore");
  await demo.capturePurchase(second.purchaseId);

  const settled = await demo.state();
  assert.equal(settled.balances.buyer, "1715.0");
  assert.equal(settled.balances.merchant, "96.0");
  assert.equal(settled.balances.alternateMerchant, "189.0");
  assert.match(settled.marketplace.conversation.at(-1).content, /What would you like to buy next/);
});
