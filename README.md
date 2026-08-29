# Chk! Buyer

Chk! Buyer is an AI purchasing assistant for small businesses. A business owner spends too much time opening supplier sites, comparing prices, tracking stock, and keeping scattered purchase notes up to date. Chk! Buyer turns that work into a controlled purchasing loop: the owner describes the goal, the agent makes the market legible, and the system only spends within rules the owner has explicitly approved.

The product does not give an AI agent a raw card or an unlimited budget. It gives the agent a **mandate**: a structured, revocable authorization that the owner can read, edit, sign, and withdraw at any time.

## Product Flow

```text
Owner prompt
  -> Chk! Buyer creates an editable mandate draft
  -> Owner reviews, edits, selects a payment method, and confirms
  -> Signed mandate is active on Polygon
  -> "chk! it out": agent discovers and compares eligible supplier offers
  -> "write the chk!": policy and payment mock authorize one exact order
  -> Merchant verifies the authorization and captures the one-use virtual card
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
- **Payment adapter:** receives a short-lived, one-use authorization.

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

`contracts/MandateVault.sol` is the payment-demo authority. It binds an owner, agent, merchant, product hash, payment method, quantity, unit-price cap, budget, and expiry. It supports:

- `createMandate`
- `reservePurchase`
- `settlePurchase`
- `releasePurchase`
- `revokeMandate`

`MockCardProcessor` and `MockUSD` simulate card-on-file charging, a merchant-specific one-use virtual card, capture, and refund. They prove the product boundary without claiming to operate a card program, custody customer money, or replace KYC/PCI/card-network obligations.

`contracts/mandates/MandateModule.sol` is a second, policy-oriented prototype with versioning and one-time authorizations. It remains covered by Foundry tests, but the team should not deploy it as a second payment authority alongside `MandateVault`. The next contract task is to consolidate its revision and policy-hash capabilities into the canonical vault flow.

### Revocation and settlement

Revocation is immediate for a new authorization or an unused virtual card. It does not undo a payment that has already settled or goods that have already shipped; that is a normal refund or dispute workflow. This distinction is essential to a truthful merchant experience.

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
| Payment demo | `contracts/MandateVault.sol`, `contracts/MockCardProcessor.sol`, `contracts/MockUSD.sol` | Mock payment authorization, virtual-card capture, refund, and revocation. |
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

## MVP Demo

1. The owner asks Chk! Buyer to replenish a business supply.
2. The agent produces a structured draft and asks only for missing constraints.
3. The owner edits and signs the mandate, choosing a mock payment method.
4. The agent compares offers and proposes or reserves an eligible purchase.
5. The mock payment flow issues a one-use virtual card for the approved merchant and amount.
6. The merchant captures it and the audit trail shows the mandate, decision, payment result, and evidence.
7. The judge revokes the mandate and a new attempt or unused-card capture fails.

## Production Boundary

Blockchain provides a shared, tamper-evident authorization and audit layer. It does not make Chk! Buyer a bank or card issuer. A production virtual-card flow requires a regulated issuer or sponsor bank; a production merchant integration needs a live verifier that checks mandate status, order binding, expiry, and one-use authorization at checkout.
