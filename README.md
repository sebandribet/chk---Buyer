# Chk! Buyer

Chk! Buyer is an AI purchasing assistant for small businesses. A business owner spends too much time opening supplier sites, comparing prices, tracking stock, and keeping scattered purchase notes up to date. Chk! Buyer turns that work into a controlled purchasing loop: the owner describes the goal, the agent makes the market legible, and the system only spends within rules the owner has explicitly approved.

The product does not give an AI agent a raw card or an unlimited budget. It gives the agent a **mandate**: a structured, revocable authorization that the owner can read, edit, sign, and withdraw at any time.

## Product Flow

```text
Owner prompt
  -> Chk! Buyer creates an editable mandate draft
  -> Owner completes KYC/login and enrolls an opaque payment token
  -> Owner reviews, edits, selects that payment method, and confirms
  -> Signed mandate is active on Polygon
  -> "chk! it out": agent discovers and compares eligible supplier offers
  -> Merchant returns a signed checkout quote for one exact order
  -> "write the chk!": agent binds that quote to the active mandate
  -> Merchant verifies the authorization and captures the one-use credential
  -> Owner, merchant, and auditor can inspect the record
```

Example: "Replenish 20 rolls of industrial stretch film every 15 days. Buy only from approved suppliers, pay no more than ARS 8,500 per roll, and stay under ARS 500,000 per month. Ask me if a new supplier is needed."

## Mandates Are the Common Language

A prompt is useful for conversation but unsafe as a payment instruction. The agent turns it into a `MandateDraft` with explicit rules: supplier, SKU or category, quantities, prices, frequency, total budget, validity period, payment path, and exception behavior.

The owner can edit the fields directly or continue the conversation: "A is correct, remove B, and add C." The next draft is a new version. Only the owner can confirm it. A draft is never spend authority.

The resulting mandate is understandable by all parties:

- **Owner:** sees what the agent may do and can revoke it immediately.
- **Agent:** sees strict limits, not a raw payment credential.
- **Merchant:** receives proof that the agent is authorized for this order.
- **Payment adapter:** receives a short-lived, one-use authorization connected to a KYC-enrolled payment token.

## Architecture

```text
UI / conversational draft
        |
        v
Canonical off-chain mandate model (shared/mandate.ts)
   |                 |                     |
   v                 v                     v
Agent policy     Merchant proof       Payment adapter
   |                 |                     |
   +--------> Polygon mandate + purchase authorization <--------+
                         |
                         v
                 Mock virtual card and mock USD settlement
```

### On-chain authority

`contracts/MandateVault.sol` is the payment-demo authority. It binds an owner, agent, merchant, product hash, KYC-linked payment-method reference, quantity, unit-price cap, budget, and expiry. It supports:

- `createMandate`
- `amendMaxUnitPrice`
- `reservePurchase`
- `settlePurchase`
- `releasePurchase`
- `revokeMandate`
- `checkoutHashFor`

The agent cannot invent an order: `reservePurchase` accepts a checkout digest signed by the approved merchant. That digest is domain-bound to the chain, vault, mandate, merchant, product, order reference, price, quantity, and quote expiry.

`MockCardProcessor` and `MockUSD` simulate the external payment boundary. The mock credential provider enrolls an opaque payment token during KYC/login; no raw card number or buyer identity is put on-chain. Reservation issues a merchant-specific, one-use credential but does **not** debit or hold money. Only `settlePurchase`, after live merchant verification, atomically charges the buyer's mock card-on-file and pays the merchant. The processor never holds a buyer float. This proves the product boundary without claiming to operate a card program, custody customer money, or replace KYC/PCI/card-network obligations.

`contracts/mandates/MandateModule.sol` is a second, policy-oriented prototype with versioning and one-time authorizations. It remains covered by Foundry tests, but the team should not deploy it as a second payment authority alongside `MandateVault`. The next contract task is to consolidate its revision and policy-hash capabilities into the canonical vault flow.

### Revocation and settlement

Revocation is immediate for a new authorization or an unused virtual credential. An owner can also amend the price cap live; this increments the mandate revision, invalidating every unused credential created under earlier terms. Neither operation undoes a payment that has already settled or goods that have already shipped; that is a normal refund or dispute workflow. This distinction is essential to a truthful merchant experience.

## Shared Data Contract

`shared/mandate.ts` is the common API vocabulary for the UI, agent, merchant verifier, and payment mock.

- `CanonicalMandate`: identity, lifecycle status, limits, budget state, and policy.
- `CanonicalPurchaseIntent`: one merchant-specific order and its evidence hashes.
- `MerchantMandatePresentation`: minimum disclosure proof for merchant verification.

The UI adapter lives in `ui/mandates/mandateDisplayModels.ts`. The agent adapter lives in `agent/src/contracts/mandate.ts`. Neither adapter replaces a fresh on-chain read immediately before payment.

## Repository Map

| Area | Location | Responsibility |
| --- | --- | --- |
| Owner UI and WhatsApp notifications | `src/`, `server/` | Draft, review, mandate detail, approvals, and activity display. |
| UI mandate models | `ui/mandates/` | Display states and fixtures for draft, active, amended, revoked, and archived mandates. |
| Purchasing agent | `agent/` | Prompt extraction, catalog discovery, policy evaluation, audit trace, and safe proposal/escalation. |
| Shared data contract | `shared/` | Canonical serializable models across modules. |
| Payment demo | `contracts/MandateVault.sol`, `contracts/MockCardProcessor.sol`, `contracts/MockUSD.sol` | KYC-linked token enrollment, signed-checkout authorization, capture-only debit, and revocation. |
| Mandate prototype | `contracts/mandates/` | Versioned mandate and one-time authorization design. |
| Tests | `test/`, `agent/tests/` | Local-chain, Foundry, and agent behavioral tests. |

## Run and Test

Requirements: Node.js 20+, npm, and Foundry.

```bash
npm install
npm --prefix agent install
npm test
```

`npm test` runs the local-chain payment test, the Foundry mandate lifecycle suite, agent type-check/tests, and the production UI build. `npm run dev` starts the Vite UI and the local Express server.

## Live trial-by-fire API

`server/demoChain.js` is the shared local integration boundary for the demo. It deploys the mock USD, card processor and canonical `MandateVault` into an in-memory chain, so no deployed network, raw card data or manual contract-console step is required.

Start the server with `npm start`, then use these endpoints from the UI, agent or an API client:

| Action | Endpoint | Example payload |
| --- | --- | --- |
| Reset and deploy the demo stack | `POST /api/demo/reset` | `{ "product": "flight-cordoba", "quantity": 1, "maxUnitPrice": "150", "budget": "150" }` |
| Complete Marta's mock KYC/login and enroll the payment token | `POST /api/demo/kyc/login` | — |
| Sign Marta's mandate using the enrolled payment token | `POST /api/demo/mandate` | `{ "quantity": 1, "maxUnitPrice": "150", "budget": "150" }` |
| Agent attempts a purchase | `POST /api/demo/agent/purchase` | `{ "orderReference": "VuelaYa-130", "quantity": 1, "unitPrice": "130" }` |
| Merchant verifies before accepting | `POST /api/demo/merchant/verify/:purchaseId` | — |
| Merchant captures a verified authorization | `POST /api/demo/merchant/capture/:purchaseId` | — |
| Owner lowers price cap live | `POST /api/demo/mandate/price-cap` | `{ "maxUnitPrice": "120" }` |
| Owner revokes mandate live | `POST /api/demo/mandate/revoke` | — |
| Owner releases an unused authorization | `POST /api/demo/purchase/:purchaseId/release` | — |
| Demo agent releases an unused trial authorization | `POST /api/demo/purchase/:purchaseId/release-demo` | — |
| Inspect mandate, balances and audit log | `GET /api/demo/state` | — |

The merchant-verification response is computed from live chain state: mandate activity and revision, KYC-linked payment-token validity, merchant match, a matching merchant-signed checkout hash, reserved one-use authorization, quote expiry, and virtual-card status. A changed price cap invalidates an unused credential from an earlier mandate revision; revocation blocks all later reservations and capture.

### Judge-ready frontend

Run `npm run dev`, then open `http://localhost:5173/?tab=demo`. The Spanish demo UI exposes the complete circuit and a judge control panel without requiring a contract console:

1. initialize the local stack, complete Marta's mock KYC/payment login, and sign the mandate;
2. authorize, verify, and capture VuelaYa's eligible US$130 checkout;
3. enter any price to test an unrehearsed purchase attempt;
4. change the live unit-price cap or revoke the mandate, then try again;
5. switch among Marta, VuelaYa, and auditor views to inspect the appropriate evidence.

Rejected attempts are recorded as off-chain decision evidence with `sin transacción`: the contract reverted, so no transaction was confirmed and no money moved. The UI labels the authorization model as inspired by AP2/ACP rather than claiming protocol certification.

## MVP Demo

1. The owner asks Chk! Buyer to replenish a business supply.
2. The agent produces a structured draft and asks only for missing constraints.
3. The owner completes KYC/login, which enrolls a mock opaque payment token—without moving money.
4. The owner signs the mandate with that token reference.
5. The agent compares offers; VuelaYa signs the exact checkout quote and the agent binds it to the mandate.
6. The mock payment flow issues a one-use credential for the approved merchant and amount, but the buyer balance remains unchanged.
7. The merchant verifies it, then capture atomically debits the mock bank balance and pays the merchant; the audit trail shows the mandate, quote, decision, and payment result.
8. The judge lowers the price cap; an old unused credential and a new over-cap attempt fail, while a new in-policy attempt succeeds.
9. The judge revokes the mandate and a new attempt or unused-credential capture fails.

## Production Boundary

Blockchain provides a shared, tamper-evident authorization and audit layer. It does not make Chk! Buyer a bank or card issuer. A production virtual-card flow requires a regulated issuer or sponsor bank; a production merchant integration needs a live verifier that checks mandate status, order binding, expiry, and one-use authorization at checkout.
