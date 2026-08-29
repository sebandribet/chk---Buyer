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
