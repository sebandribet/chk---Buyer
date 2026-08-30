# Chk! Buyer

Chk! Buyer is an AI purchasing assistant for small businesses. A business owner spends too much time opening supplier sites, comparing prices, tracking stock, and keeping scattered purchase notes up to date. Chk! Buyer turns that work into a controlled purchasing loop: the owner describes the goal, the agent makes the market legible, and the system only spends within rules the owner has explicitly approved.

To run the purchasing agent live, copy `.env.example` to `.env`, add `OPENAI_API_KEY`, then restart `npm run dev`. The chat shows the agent's run id and model; a failure is shown in the UI and never silently replaced with a local response. See [The purchasing agent](#the-purchasing-agent) for what the agent is allowed to decide and what it is not.

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

For the live marketplace demo, `createMarketplaceMandate` records an approved seller set and `reserveMarketplacePurchase` binds the selected seller into the signed quote and one-use credential. This lets the agent compare sellers without broadening its authority: only a seller explicitly named in the mandate may sign a checkout or capture the payment.

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
| Live demo UI | `src/` | The single operator surface: wallets, chat with the agent, mandate lifecycle, catalog, decision report. |
| Demo backend | `server/` | HTTP boundary, in-memory chain, and the bridge from the demo to the purchasing agent. |
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

### The purchasing agent

The chat is driven by the agent in `agent/`, not by a direct call to a chat model.
The difference is who decides what:

```text
prompt ──> agent ──> typed need + commitment level      (no product id, no seller, no price)
              │
              └────> clarifying questions, if something needed to spend is missing
           code ───> resolves that need against the seller catalog
```

The model never sees or returns a catalog id. It describes what the buyer needs
("office chair", ergonomic, 3 units); `resolveNeedToProduct` in
`server/demoChain.js` decides which catalog product satisfies it, in
deterministic code. A model convinced the buyer wants the US$549 desk cannot
smuggle it in — it can only say "desk", and the catalog does the rest.

Three guarantees come from `agent/src/agent/office.ts` and are worth demoing:

- **It asks instead of assuming.** A concrete order with no stated budget returns
  a question, not a draft. The earlier implementation filled that gap with the
  highest catalog price times the quantity — a spending cap nobody authorised.
- **Code wins over the model.** If the model answers `ok` but the budget or a
  quantity is missing, `findGaps` stops the run anyway. The decision to ask
  cannot sit with the party that has an incentive to seem helpful.
- **The commitment gate.** `exploratory` / `conditional` / `committed`, classified
  by the structure of the request rather than its tone, defaulting to
  `exploratory` when torn. "How much would two desks run me?" and "buy two desks"
  are not the same instruction.

The sentence shown to the buyer is generated by code from the validated
extraction (`summarize`), never written by the model, so it cannot claim a
seller, a price, or a purchase that did not happen.

`agent/src/agent/domain.ts` holds the domain as data. `GASTRONOMIC_ARS` is the
original Argentine supplies domain that the 245 agent tests cover; `OFFICE_USD`
is this demo. Same engine, same guarantees, different catalog and currency.

Copy the root example file, add your API key, then start the app:

```bash
cp .env.example .env
# Set OPENAI_API_KEY in .env
npm run dev
```

`OPENAI_MODEL` defaults to `gpt-4.1-mini`. With no key configured the demo falls
back to a local keyword matcher and labels itself `catalog fallback`; it stays
usable offline but that path is not the agent.

The server imports the agent's TypeScript directly and therefore runs under
`tsx`. Path aliases resolve through the root `tsconfig.json`.

## Live trial-by-fire API

`server/demoChain.js` is the shared local integration boundary for the demo. It deploys the mock USD, card processor and canonical `MandateVault` into an in-memory chain, so no deployed network, raw card data or manual contract-console step is required.

Start the server with `npm start`, then use these endpoints from the UI, agent or an API client:

| Action | Endpoint | Example payload |
| --- | --- | --- |
| Reset and deploy the marketplace stack | `POST /api/demo/reset` | `{}` |
| Introduce and KYC the mock buyer | `POST /api/demo/kyc/login` | `{ "name": "Ada Lovelace", "email": "ada@demo.test", "company": "Analytical Engines" }` |
| Send a live purchase intention | `POST /api/demo/agent/intent` | `{ "prompt": "Buy 2 ergonomic chairs under $500" }` |
| Sign the two-seller marketplace mandate | `POST /api/demo/mandate` | `{}` |
| Agent compares both signed offers and authorizes the cheapest eligible one | `POST /api/demo/agent/compare-and-authorize` | — |
| Merchant verifies before accepting | `GET /api/demo/merchant/verify/:purchaseId` | — |
| Merchant captures a verified authorization | `POST /api/demo/merchant/capture/:purchaseId` | — |
| Owner lowers price cap live | `POST /api/demo/mandate/price-cap` | `{ "maxUnitPrice": "120" }` |
| Owner revokes mandate live | `POST /api/demo/mandate/revoke` | — |
| Inspect mandate, balances and audit log | `GET /api/demo/state` | — |

The merchant-verification response is computed from live chain state: mandate activity and revision, KYC-linked payment-token validity, merchant match, a matching merchant-signed checkout hash, reserved one-use authorization, quote expiry, and virtual-card status. A changed price cap invalidates an unused credential from an earlier mandate revision; revocation blocks all later reservations and capture.

## MVP Demo

1. The presenter introduces a mock buyer and their mock wallet at the KYC desk.
2. The buyer enters a live purchase intention for an office chair, monitor, or keyboard and a total budget.
3. The agent turns that intent into explicit product, quantity, unit-cap, and budget rules.
4. The buyer signs a marketplace mandate that names both seller wallets: OfficeCore and SupplyHub.
5. The agent compares their seller-signed quotes and binds only the lowest eligible one to the mandate.
6. The mock payment flow issues a one-use credential for the selected seller and exact amount, but the buyer balance remains unchanged.
7. The selected merchant verifies it, then capture atomically debits the buyer mock wallet and credits that seller wallet; the UI and audit trail show both balances changing.
8. The judge lowers the price cap; an old unused credential and a new over-cap attempt fail, while a new in-policy attempt succeeds.
9. The judge revokes the mandate and a new attempt or unused-credential capture fails.

## Production Boundary

Blockchain provides a shared, tamper-evident authorization and audit layer. It does not make Chk! Buyer a bank or card issuer. A production virtual-card flow requires a regulated issuer or sponsor bank; a production merchant integration needs a live verifier that checks mandate status, order binding, expiry, and one-use authorization at checkout.
