/**
 * El circuito de pago, de punta a punta, contra la chain en memoria.
 *
 * Corren con `MARKETPLACE_AGENT_MODE=fallback` a propósito: acá se verifica el
 * circuito —borrador, firma, comparación, verificación del merchant, captura y
 * revocación— y no la comprensión del pedido. Que el agente entienda lo que le
 * piden se verifica en `agent/tests/office.test.ts`, con el modelo scripteado.
 *
 * Separarlos importa: si estos tests dependieran del modelo, cada corrida
 * costaría plata, necesitaría red, y una respuesta distinta del modelo rompería
 * un test sobre plata que no tiene nada que ver con el modelo.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DemoChain } from "../server/demoChain.js";

/** El borrador se revisa y se confirma antes de poder firmarse. */
async function draftAndSign(demo, prompt) {
  const { draft } = await demo.recordIntent({ prompt });
  await demo.confirmMarketplaceDraft();
  const signed = await demo.createMarketplaceMandate();
  return { draft, signed };
}

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
});

test("a draft is not spend authority: signing requires an explicit confirmation first", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  const { draft } = await demo.recordIntent({ prompt: "Buy 2 ergonomic chairs under $500" });
  assert.equal(draft.status, "ready");

  await assert.rejects(
    demo.createMarketplaceMandate(),
    /confirm/i,
    "an unreviewed draft must not be signable",
  );

  const state = await demo.state();
  assert.equal(state.mandate, null, "no mandate may exist before confirmation");
});

test("marketplace demo selects the cheaper approved seller and settles into that seller wallet", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer({
    name: "Ada Lovelace",
    email: "ada@analytical.demo",
    company: "Analytical Engines",
  });

  const { draft, signed } = await draftAndSign(demo, "Buy 2 ergonomic chairs under $500");
  assert.equal(draft.product, "Ergonomic office chair");
  assert.equal(draft.maxUnitPrice, "250.00");
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

test("a request with no catalog match creates no mandate and moves no money", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  const unavailable = await demo.recordIntent({ prompt: "Buy 2 pizza ovens" });
  assert.equal(unavailable.draft.status, "needs_revision");
  assert.equal(unavailable.draft.productId, null);
  assert.match(unavailable.draft.reply, /no mandate or payment was created/i);
  assert.equal(unavailable.state.mandate, null);
  assert.equal(unavailable.state.balances.buyer, "2000.0");
});

test("a derived spending cap is labelled as the agent's suggestion, not the buyer's limit", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  const { draft } = await demo.recordIntent({ prompt: "Buy 3 mechanical keyboards" });
  assert.equal(draft.status, "ready");
  assert.equal(draft.budget, "327.00", "cap must come from the highest live quote, not a guess");
  assert.match(
    draft.budgetSource,
    /agent suggestion/i,
    "a cap the buyer never stated must not be presented as their limit",
  );
});

test("the agent buys the cheapest eligible seller for a different product", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  await draftAndSign(demo, "Buy 3 mechanical keyboards");
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

  await draftAndSign(demo, "Buy an ergonomic chair");
  const first = await demo.compareAndAuthorize();
  await demo.capturePurchase(first.purchaseId);

  const nextIntent = await demo.recordIntent({ prompt: "Buy a mechanical keyboard" });
  assert.equal(nextIntent.draft.product, "Wireless mechanical keyboard");
  assert.equal(nextIntent.state.mandate, null, "a completed purchase must not block the next mandate");
  assert.equal(nextIntent.state.marketplace.selection, null);

  await demo.confirmMarketplaceDraft();
  await demo.createMarketplaceMandate();
  const second = await demo.compareAndAuthorize();
  assert.equal(second.selection.mandateId, "2");
  assert.equal(second.selection.merchant, "OfficeCore");
  await demo.capturePurchase(second.purchaseId);

  const settled = await demo.state();
  assert.equal(settled.balances.buyer, "1715.0");
  assert.equal(settled.balances.merchant, "96.0");
  assert.equal(settled.balances.alternateMerchant, "189.0");
});

test("a signed mandate that no seller can satisfy authorizes nothing", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  await demo.recordIntent({ prompt: "Buy 2 standing desks under $300" });
  await demo.confirmMarketplaceDraft();
  await demo.createMarketplaceMandate();

  const result = await demo.compareAndAuthorize();
  assert.equal(result.status, "no_eligible_option");
  assert.equal(result.report.mockFundsMoved, false);
  assert.ok(
    result.report.decision.offers.every((offer) => offer.eligible === false),
    "every rejected offer must carry its reason",
  );

  const state = await demo.state();
  assert.equal(state.marketplace.selection, null);
  assert.equal(state.balances.buyer, "2000.0", "a rejected search must not move money");
});

test("live revocation blocks the next authorization", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  await draftAndSign(demo, "Buy 2 ergonomic chairs under $500");
  await demo.revokeMandate();

  // No se afirma sobre el texto del revert: ethers lo devuelve distinto según
  // dónde falle (estimateGas sin datos de revert vs. la cadena con el string
  // del contrato). Lo que tiene que valer siempre es que no se autorice nada
  // y que no se mueva un peso.
  await assert.rejects(demo.compareAndAuthorize());

  const state = await demo.state();
  assert.equal(state.mandate.status, "Revoked");
  assert.equal(state.marketplace.selection, null);
  assert.equal(state.balances.buyer, "2000.0");
  assert.equal(state.balances.merchant, "0.0");
  assert.equal(state.balances.alternateMerchant, "0.0");
});

test("a live price-cap cut invalidates an authorization taken under the old terms", async () => {
  const demo = new DemoChain();
  await demo.reset();
  await demo.loginAndEnrollBuyer();

  await draftAndSign(demo, "Buy 2 ergonomic chairs under $500");
  const authorized = await demo.compareAndAuthorize();
  assert.equal(authorized.status, "authorized");

  await demo.amendPriceCap("120");

  const verification = await demo.verifyPurchase(authorized.purchaseId);
  assert.equal(verification.verified, false, "the old credential must stop verifying");
  assert.equal(verification.checks.authorizationCurrent, false);

  await assert.rejects(demo.capturePurchase(authorized.purchaseId), /verification failed/i);
  const state = await demo.state();
  assert.equal(state.balances.buyer, "2000.0", "an invalidated credential must not settle");
});
