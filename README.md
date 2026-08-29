# Chk! Buyer

MVP for Challenge 1 of NextWave Hackathon 2026: **"The Buyer Who Isn't Human"**.

Chk! Buyer lets a human delegate purchases to an AI agent without handing over their payment method or losing control of the transaction. The product is divided into four blocks: **Mandates** (this module), UI/UX, payments, and agent.

## MVP Scope

We will demonstrate the full circuit: a user creates a mandate, the agent attempts a purchase, the merchant verifies the authorization, and the user receives a receipt. A purchase outside the scope, with an expired mandate, or with a revoked mandate must be rejected or escalated to the user; it must never be silently approved.

Guiding case: a small business authorizes its agent to replenish approved supplies from an approved vendor, up to a defined budget and frequency. Judges can change limits or revoke the mandate live, and the next attempt must fail.

## Mandates: Initial Technical Decision

A mandate is a signed, verifiable authorization; it is neither a payment method nor a transfer of funds. We chose a hybrid design:

- **Signed mandate:** the user signs an EIP-712 payload with their wallet. It contains `mandateId`, user, public agent identity, validity period, policy, and `nonce`.
- **Versioned policy:** per-operation and period limits, currency, allowed categories/merchants, payment method or delegated payment token, conditions, and exception action (`deny` or `require_approval`). The complete document stays off-chain; its hash is signed and anchored.
- **Polygon state registry:** the `MandateModule` contract stores the hash, issuer, authorized agent, `expiresAt`, version/nonce, and status (`active`/`revoked`). Revocation is a user transaction and becomes effective for every later validation.
- **Verification service:** before issuing a one-time payment authorization, it validates the signature, policy integrity, agent identity, TTL, on-chain state, cumulative limits, and match with the purchase intent. Merchant and payment systems never trust the agent's claim by itself.
- **Auditability:** every creation, verification, denial, approval, use, and revocation produces an immutable event with hashes of the intent, decision, and evidence; no card data or unnecessary PII is put on-chain.

The smart contract is the shared, revocable state anchor; it does not model every business rule on-chain. This keeps cost and privacy reasonable while supporting any payment rail. The payment block must require a short-lived authorization bound to `mandateId`, intent, amount, merchant, and expiry, preventing replay.

### Implemented On-Chain Module

The contract lives in [`contracts/mandates`](contracts/mandates). The purchase program ([`BuyerCheckoutCoordinator`](contracts/BuyerCheckoutCoordinator.sol)) depends only on [`IMandateModule`](contracts/mandates/IMandateModule.sol): it does not access storage or duplicate authorization logic. To deploy without a circular dependency: deploy `MandateModule`, deploy the coordinator with its address, then have the module admin call `setCoordinator`.

```text
Purchase coordinator -> IMandateModule.reserveAuthorization(...) -> payment adapter.consumeAuthorization(...)
       |                         |                                          |
       |                         +-- TTL, revocation, agent, scope,        +-- one-time use
       |                             per-operation limit and budget
       +-- validates the complete off-chain policy and builds intentHash
```

`MandateModule` supports creating, amending, and revoking mandates. Each mandate is bound to an agent key and a payment adapter; it configures TTL, a per-operation cap, a total budget, allowed actions, and the hash of the complete policy. The coordinator reserves a one-time authorization bound to the intent hash; the designated adapter consumes it. Amendments invalidate earlier reservations, and expired reservations can be released without permissions. Events make up the on-chain audit log, while private details and evidence remain hashed off-chain.

For small-business supply replenishment, the off-chain policy should include supplier, allowed category/SKU, replenishment frequency, maximum quantity, and unit/total price. A scraper or ChatGPT plugin may propose a purchase, but cannot approve it: it always submits a verifiable intent to the coordinator.

## UI/UX Requirements: Small-Business Supply Replenishment

The UI must let a business owner safely delegate routine purchasing while making the mandate, each attempted purchase, and every exception understandable.

1. **Mandate creation and editing:** select the purchasing agent and payment method; define approved suppliers, categories/SKUs, maximum unit and order prices, monthly budget, replenishment frequency, mandate end date, and out-of-policy behavior (block or ask for approval). Show a plain-language summary before wallet signature.
2. **Mandate list and detail:** show status (`Active`, `Revoked`, `Expired`), remaining budget, reserved amount, spent amount, next expiry, latest policy version, and a prominent immediate revoke action. Editing creates a new version and clearly warns that pending authorizations will no longer be usable.
3. **Purchase inbox:** show agent proposals with supplier, items, quantity, price, delivery estimate, policy checks, and the linked mandate. Clearly distinguish `Proposed`, `Approved`, `Payment authorized`, `Purchased`, `Rejected`, and `Needs approval`.
4. **Human approval queue:** for an exception such as a price increase, unapproved SKU, new supplier, or exhausted budget, present the reason and the exact proposed purchase. The owner can deny it, approve it once, or amend the mandate; each choice is recorded in the audit trail.
5. **Audit trail and receipts:** provide a readable timeline for every mandate and purchase: policy version, intent hash, checks performed, authorization ID, payment outcome, and revocation/amendment events. Technical hashes should be expandable, not the primary interface.
6. **Safety feedback:** never imply a purchase was made when it was only proposed or reserved. Immediately reflect expiry, revocation, failed policy checks, and invalidated authorizations. Confirm destructive actions and explain their effect in plain language.

The MVP should prioritize three screens: **Mandates**, **Purchase inbox**, and **Approvals & audit trail**. They are enough to demonstrate normal replenishment, an out-of-policy escalation, and a live revocation test.

UI mock data is available in [`ui/mandates/mandateDisplayModels.ts`](ui/mandates/mandateDisplayModels.ts). It provides display-only structures and fixtures for drafting, creating, amending, revoking, and archiving mandates. Archive is intentionally a UI action rather than on-chain deletion: revoked and expired mandates must remain available as audit evidence.

## End-to-End System Inputs and Outputs

### Mandate creation flow

Mandate creation is a human-owned authorization flow assisted by the agent, never an autonomous agent action:

```text
Business owner prompt + form values
    -> agent preprocessing and clarifying questions
    -> editable MandateDraft
    -> owner validation, edits, and wallet confirmation
    -> signed Mandate becomes Active
```

The initial interface should work like a guided prompt: for example, “Keep coffee-shop packaging supplies in stock from Acme Supplies, up to USD 500 per month.” The agent turns it into structured terms, identifies missing constraints, and asks targeted questions. The owner can edit every field, return to the prompt, or ask the agent to regenerate the draft before signing. This adds friction, but protects against incorrect or overly broad delegation.

### System input contract

| Input | Producer | Required result |
| --- | --- | --- |
| `MandateDraftInput` | Business owner and agent | Natural-language goal, editable terms, unanswered questions, and source prompt hash. |
| `Mandate` | Business owner | Signed, versioned authorization with agent, policy hash, limits, TTL, and payment adapter. |
| `PurchaseIntent` | Scraper/plugin or purchasing agent | Supplier, items/SKUs, quantity, currency, quote, delivery data, and evidence hashes. |
| `PaymentResult` | Payment adapter | Authorized, settled, failed, or reversed status without exposing card data to the agent. |
| `LifecycleEvent` | Any circuit participant | Verifiable fact such as creation, amendment, verification, authorization, payment, rejection, or revocation. |

### System output contract

| Output | Consumer | Purpose |
| --- | --- | --- |
| `MerchantMandatePresentation` | Merchant | Minimal proof that a real user authorized this agent, this transaction scope, and this payment path. |
| `PaymentAuthorization` | Payment adapter | Short-lived, one-time authorization bound to one purchase intent. |
| `MandateRecord` | Owner, merchant, and auditor | Readable and verifiable history of what happened and why. |
| `Decision` | Agent and UI | `Approved`, `Rejected`, or `Needs approval`, including machine-readable reason codes. |

## Domain Models

The following class-like models separate the user-facing policy from its audit evidence. Full documents remain off-chain; the contract anchors their hashes and critical state.

```text
MandateDraft
  draftId, owner, sourcePromptHash, terms, openQuestions, generatedAt
  -> editable; never valid for purchases

Mandate
  mandateId, owner, agent, paymentDelegate, policyHash, allowedActions
  validAfter, expiresAt, maxPerOperation, maxTotal, spent, reserved
  revision, status
  -> signed by owner; active/revoked state anchored on Polygon

PurchaseIntent
  intentId, mandateId, supplier, items[], currency, totalAmount
  quoteExpiresAt, evidenceHashes[], proposedBy, createdAt
  -> evaluated against the current Mandate policy

MandateRecord
  recordId, mandateId, intentHash, authorizationId, eventType, actor
  decision, reasonCode, policyRevision, occurredAt, evidenceHash, chainTxHash
  -> append-only audit record; readable timeline plus cryptographic evidence

MerchantMandatePresentation
  mandateId, agent, authorizationId, intentHash, amount, currency
  expiresAt, policyHash, mandateRevision, signature or chain proof
  -> minimum disclosure proof for merchant verification
```

The merchant must be able to verify the mandate, but does not need the business owner's full purchasing policy. It receives `MerchantMandatePresentation`, verifies the user/agent binding, current on-chain status, expiry, authorization ID, amount, and intent binding, then accepts or rejects the order. It can retain the presentation and receipt as dispute evidence.

## Payment Funding and Virtual Cards: Open Design Decision

The preferred candidate is a Chk! Buyer-funded balance plus a payment adapter that issues a virtual card or rail-specific credential per approved purchase. The agent receives only a scoped, short-lived authorization reference; it never receives raw card details. The adapter consumes the on-chain authorization, obtains the virtual credential, and reports the payment result as a `MandateRecord`.

Operating a customer balance or issuing virtual cards creates card-network, PCI, custody, KYC, and regulatory obligations. Therefore, the MVP should use a mocked adapter or a partner-issued sandbox virtual card and demonstrate the authorization boundary, not custody or card issuance. The production decision remains open: partner-led virtual cards versus a Chk! Buyer wallet/fund.

## Security Invariants

1. An agent can act only when the mandate is active, unexpired, and bound to that agent key.
2. Revocation and expiry override any prior token; final validation reads fresh state.
3. Every purchase must satisfy the current policy or be escalated/rejected.
4. An attempt cannot reuse an authorization or exceed the cumulative budget concurrently.
5. Human, merchant, and auditor can reconstruct what was authorized, attempted, and decided, and why.

## Testing

The Foundry test suite in [`test/MandateModule.t.sol`](test/MandateModule.t.sol) covers the mandate lifecycle: creation, agent binding, one-time authorization consumption, revocation, expiry, and amendment invalidation.

```bash
forge test
```

Foundry is the only required test runner. The suite declares the minimal cheatcode interface locally, so it does not require `forge-std`.

## Design References

- The challenge brief requires mandates with limits, verification, revocation, dispute handling, and an auditable trail.
- AP2 inspires the mandate as a signed, auditable authorization; its Open/Closed stages separate user restrictions from a closed transaction.
- ACP inspires a delegated payment token constrained by amount and expiry. Settlement remains decoupled from authorization.

## Decisions to Finalize

- Exact schema for policy and purchase intent.
- User and agent identity model (wallet, DID, or both).
- Semantics for cumulative budget, reservations, and concurrency.
- Human approval, dispute, and evidence interface for each party.
# chk! Buyer

MVP for the NextWave Hackathon challenge **The Buyer Who Isn't Human**.

chk! Buyer is a conversational purchasing interface for small businesses. It turns a user's request into a structured mandate, exposes the agent's decisions and keeps purchases auditable for the buyer and merchant.

## Current prototype

- Conversational, versioned `MandateDraft` flow.
- Mandate list and detail views with activity, offers and purchases.
- Mock account, `chk! fund`, Polygon authorization and virtual-card flow.
- Merchant mandate-verification presentation.
- Notification inbox and configurable event preferences.
- Real WhatsApp pairing and self-messaging through Baileys.
- Responsive dark admin interface.

## Run locally

```bash
npm install
npm run dev
```

- Web application: `http://localhost:5173`
- Node.js API: `http://localhost:3001`

## Production build

```bash
npm run build
npm start
```

Baileys credentials are stored locally in `.baileys-auth/` and are excluded from Git.
