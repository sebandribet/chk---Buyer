# Decision Log — chk

NextWave Hackathon 2026 · Buenos Aires

## 1. Mandate creation experience  `T+07:47`

**Options considered**

- A fully conversational chatbot flow.
- A form-first flow generated from an agent's initial interpretation.

**Chosen:** A form-first flow generated from an agent's initial interpretation.

**Why:** This core decision aims to solve the AI agent's fallibility while making decisions. An agent generates the first mandate draft; the user reviews and edits it in a form-like interface before confirmation (signature). We aimed to preserve the time-saving benefit of AI while making the authorization predictable, legible and reviewable. Mandate creation is a responsibility of the user and should be treated as such.

## 2. Mandate publication authority in the current mock  `T+07:50`

**Options considered**

- Keep mandate state only in an application database.
- Publish the authorization through a smart contract.

**Chosen:** `MandateVault` is the current mock's on-chain mandate authority.

**Why:** A merchant can later verify the buyer/agent binding, mandate status, expiry, merchant binding, and numeric limits against shared state rather than trusting an agent assertion.

## 3. Buyer payment experience  `T+07:52`

**Options considered**

- Require the buyer to use a blockchain wallet.
- Accept a traditional payment method while Chk! Buyer uses blockchain internally for mandate authorization.

**Chosen:** Trad-fi payment methods are the intended buyer experience. Blockchain is internal authorization and audit layer.

**Why:** Requiring Web3 knowledge or wallet management would add friction for the buyer and merchant. The current browser-wallet mandate publisher is a technical bridge for the blockchain mock, not the intended end-user payment experience.
