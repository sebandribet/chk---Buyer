# The Buyer Who Isn't Human

An autonomous purchasing system for SMEs. A business owner gives an AI agent a **mandate** once; the agent can then find and buy the best eligible offer without requesting approval for every order.

The owner delegates purchasing decisions, not unrestricted access to money.

## Why blockchain

Blockchain gives CHK Buyer a shared, tamper-evident source of truth for the owner’s mandate, every agent authorization, and every payment outcome. Smart contracts enforce spending limits and live revocation automatically, so neither the agent nor the seller can bypass the rules. This enables autonomous purchasing with verifiable accountability across buyer, seller, and auditor—without trusting one central party’s internal database.

## The problem

SMEs need to compare supplier offers and react quickly to prices, but existing payment systems assume that the person pressing “pay” is human. Giving an AI agent a raw card is unsafe; blocking it means losing the benefits of automation.

Our system makes an agent payment safe, limited, revocable and auditable.

## Example

> “Before June 30, buy 100 kg of coffee beans from an approved supplier, at no more than $12/kg, with a maximum budget of $1,200.”

When the agent finds an eligible offer, it purchases automatically. It escalates to the owner only when an offer falls outside the mandate.

## How a payment works

```text
Owner creates and funds a mandate
        ↓
Agent finds and compares supplier offers
        ↓
Agent submits one specific purchase
        ↓
Policy checks mandate; funds are reserved
        ↓
Merchant captures payment; purchase settles
        ↓
Owner receives a record; an auditable trail remains
```

An automatic purchase is permitted only if all of these pass:

- the mandate is active and the agent identity is valid;
- the supplier and product/category are allowed;
- price and quantity are within limits;
- the purchase is before the expiry date;
- enough budget remains; and

Otherwise the system rejects the purchase or asks for human approval. Revoking a mandate blocks every later payment immediately.

## Payment architecture

The core product is the **transaction authorization engine**, not a card issuer. It verifies that an agent has authority for one exact purchase, charges the buyer's saved payment method for that purchase, and issues a merchant-specific payment authorization.

```text
MandateVault (on-chain) → card-on-file adapter → one-use virtual card → merchant
       ↑                         ↓                         ↓
 limits, capacity,      buyer charged for          capture / refund /
 revocation, audit       the exact order             settlement events
```

### MandateVault

The smart contract records the mandate and enforces its payment authority:

- owner, authorized agent and approved supplier/category;
- maximum order value and total budget;
- price, quantity and date limits;
- `reservePurchase`, `settlePurchase`, `releasePurchase` and `revoke`;
- immutable events for mandate creation, reservation, settlement and revocation.

Each purchase follows this state machine:

```text
ACTIVE → RESERVED → SETTLED
   ↓         ↓
REVOKED   RELEASED
```

Revocation prevents new reservations. It does not pretend to reverse a payment that has already settled; that follows the normal refund/dispute process.

## Hackathon MVP

The MVP proves the difficult part end to end using a mock USD payment method, mock card processor and simulated merchant. It does **not** attempt to become a regulated card issuer in 24 hours.

### Build

1. A UI for the owner to register a payment method, create and revoke a mandate.
2. A Solidity `MandateVault` that actually validates static limits and records payment capacity without locking the full mandate budget.
3. An agent that finds an offer matching the fixed mandate and calls `reservePurchase()` without asking the owner for confirmation.
4. A mock card processor that charges the buyer for the exact order and issues a short-lived, one-use virtual card for the exact merchant and amount.
5. Merchant controls to capture or cancel that payment; capture transfers mock USD to the merchant and cancellation refunds the buyer.
6. An audit view for the owner, merchant and judge.

### Demo script

1. Owner links a payment method and creates a $1,000 mandate for a defined product from an approved SME supplier.
2. Agent autonomously buys an eligible $400 offer; the buyer is charged $400 and a one-use virtual card is issued.
3. Merchant captures the virtual card and receives $400.
4. Agent attempts an ineligible or over-budget purchase; it is rejected.
5. Owner revokes the mandate; a new attempt and capture of an unused virtual card fail, then the buyer is refunded.

The agent never receives the owner's raw card details.

### Run the smart-contract test

```bash
npm install
npm run test:contracts
```

The local-chain test deploys `MockUSD`, `MockCardProcessor` and `MandateVault`, then plays the owner, authorized agent and approved seller. It proves that creating a mandate locks no money, an eligible purchase charges the buyer and pays the seller only after capture, failed charges leave capacity untouched, and revocation refunds an unused payment authorization.

## Future production goal: traditional USD, universal merchant access

Most SMEs use traditional payment rails. Production adds a **virtual-card payment adapter** while retaining the same mandate and authorization logic.

```text
Buyer deposits USD through a regulated partner
        ↓
Partner holds fiat in a safeguarded/FBO program account
        ↓
Mandate and reservation are controlled and audited on-chain
        ↓
For an approved order, issue a one-time virtual USD card
        ↓
Merchant charges card; card network settles USD
        ↓
Reconciler marks the on-chain reservation settled
```

The virtual card is restricted to the exact amount, merchant, one use and short expiry. At card authorization, the issuer can ask our payment engine for a live allow/deny decision, so a revoked or out-of-policy mandate cannot pay.

The buyer and seller can both use USD without seeing a crypto wallet. Blockchain is used as programmable mandate, escrow state and audit infrastructure; regulated banking/issuing partners hold and move legal fiat funds.

### Rail selection

- **Blockchain-enabled seller:** future direct settlement through a smart-contract escrow.
- **Card-accepting seller:** use a one-time virtual USD card.
- **Large B2B seller:** future bank-transfer/invoice adapter.

The mandate is universal; the payment rail is chosen for the seller.

## What we are not claiming

- A card network does not pull USDC directly from Polygon at checkout. A production virtual-card program needs a regulated issuer/sponsor bank and prefunded USD liquidity.
- Smart contracts do not remove KYC/AML, payment-regulation or RWA issuance obligations.
- Virtual cards are broadly compatible with online card checkout, not universal: merchant, country, issuer and card-network restrictions still apply.
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
