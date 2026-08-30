# chk! Buyer — pitch script

**6 minutes · 17 slides · one presenter**

Open `index.html`, press `F`. Arrows to move, `R` to replay a slide's animation,
`O` for the overview.

The whole pitch answers one question: *how does a merchant charge an AI agent
without opening the door to fraud?* Everything else is evidence.

Four slides carry the argument — **03, 07, 13, 17**. If you're running out of
time, those four and the demo are the pitch.

> **On timing.** The numbers below add up to about 5:40, which leaves room to
> breathe. Slides 05 and 13 have animations that need a beat — don't talk over
> them, let the room watch.

---

## 01 · The buyer isn't human

**~20s**

> More and more purchases aren't made by a person. Your assistant books the
> flight. A company's agent restocks inventory.
>
> Every payment system ever built assumes the one pressing "pay" is a human.
> That assumption is breaking.
>
> We're chk! Buyer. We let a merchant charge an agent — and prove a real person
> allowed it.

*Don't rush the pause after "that assumption is breaking."*

---

## 02 · Two doors. Both bad.

**~25s**

> Today a merchant sees a booking and can't tell who's behind it. They get two
> options, and both are losing ones.
>
> Block the bot — and the sale walks away. The customer was real; only the
> buyer wasn't.
>
> Or wave it through as if it were a person — and the chargeback lands a month
> later.
>
> The piece that would make this safe is the mandate. It doesn't exist in
> practice. So we built one, and then spent most of the time trying to break it.

*"The mandate is the missing door" is on screen — say it, don't read it.*

---

## 03 · What I allow

**~30s** — *the first of the four key slides*

> A mandate is the buyer saying, in advance and in writing: this is what my
> agent may buy.
>
> Categories — travel, lodging, supplies, food. Watch hardware stay dark; the
> buyer didn't allow it. Remember that one.
>
> Two hundred per purchase. Twelve hundred in total, until the end of the month.
>
> They sign it with their own key. And the card is a token, never a card number
> — the agent never sees it, and neither do we.

*The categories light up on their own. Let them.*
*"Remember that one" plants slide 13. Don't skip it.*

---

## 04 · The agent drafts. The buyer signs.

**~25s**

> Writing a mandate from scratch is work, so the agent drafts the first one from
> what you asked for. That's the part that saves time.
>
> But it's a form, not a chat. The buyer reads it, changes it — here they cut
> the per-purchase cap in half — and signs.
>
> And what gets recorded is both: what the agent proposed, and what the buyer
> changed. So "the user approved" isn't a claim. It's something you can check.

*The number changes on screen at ~1s. Time "changes it" to land with it.*

---

## 05 · It buys. Inside the limits.

**~25s**

> Now the agent goes to work. Different merchants, different things — a flight,
> two nights, a restock.
>
> One mandate covers all of it, and the budget comes down as it spends.
>
> Nothing here is the agent asking permission each time. The permission already
> exists. It just has edges.

*Let the three purchases land before the last line. About 2 seconds.*

---

## 06 · Both halves arrive

**~25s**

> Here's the part that matters for a merchant.
>
> There are two halves. The open mandate — what the buyer allows. And the closed
> mandate — what the agent actually did, signed by the agent.
>
> The merchant gets both. And its job is to decide whether the second one fits
> inside the first.
>
> It runs that check itself. It shares no code with our agent — there's a test
> that fails if anyone tries.

---

## 07 · Three questions. All three, or no sale.

**~35s** — *key slide*

> The merchant asks three things.
>
> One. Did the buyer really sign this? Checked against a key the merchant
> already had — not one we handed over with the signature.
>
> Two. Is this the mandate they signed? The purchase carries the hash of that
> exact one. You can't do the shopping under a narrow mandate and present a
> wider one.
>
> Three. Does the purchase fit what they allowed? Every limit, re-evaluated
> right here.
>
> Three yeses, or there's no sale.

*Slowest slide in the deck. One beat between each question.*

---

## 08 · No receipt, no charge

**~20s**

> Only once the merchant has accepted does anything touch money.
>
> Their signed receipt is what unlocks the payment. Stripe authorizes — the
> money is committed and hasn't moved — and then it's captured.
>
> Charging without the merchant's acceptance isn't a rule we wrote down. It
> doesn't compile.

---

## 09 · Who can do what

**~30s** — *the architecture deliverable*

> Five actors, and the interesting column is what each one can't do.
>
> The buyer signs. That's the only place authority is ever created.
>
> The agent proposes — and cannot sign a mandate or move money. Not "shouldn't";
> the code has no path to it.
>
> The policy engine re-checks and reserves budget, and never reads free text, so
> there's nothing there to talk into changing its mind.
>
> The merchant verifies. The payment delegate is the only thing that moves money.
>
> Underneath all of them, the smart contract holds the state nobody has to be
> trusted about: revocation, what's been spent, one-time authorizations.

*If they only remember one thing: the language model proposes, the code
authorizes. Say it here if it fits.*

---

## 10 · Only what the sale needs

**~20s**

> The merchant needs to invoice and deliver, so it gets the name, the tax ID,
> the address, the phone.
>
> It does not get the rest — and it can't tell the rest exists. Every field is a
> salted hash inside the signed mandate. The merchant verifies what it was
> shown, and is blind to what it wasn't.

*Let the four cells open. Two seconds.*

---

## 11 · Nine lies. Nine rejections.

**~25s**

> We spent most of our time on this slide.
>
> Nine ways an agent can lie: sign its own cart, spend over the cap, borrow a
> wider mandate, forge one outright, keep buying after a revocation, replay a
> valid purchase.
>
> Nine rejections, each at a named check. Every one of these is a test in the
> suite, not a bullet on a slide. You can run them.

---

## 12 · Under the cap. Still refused.

**~30s** — *key slide*

> This is my favourite one, and it's the reason the merchant has to do its own
> checking.
>
> The agent buys hardware. Ninety-five dollars — under the two-hundred cap.
>
> Every signature is authentic. The on-chain reservation is real: the contract
> approved it, because ninety-five does fit under two hundred.
>
> But hardware was never in the mandate. Remember the icon that stayed dark.
>
> A contract knows amounts. Only the merchant knows the mandate.

*Callback to 03. If they nod here, the deck worked.*

---

## 13 · Authorized, not charged

**~35s** — *the trial-by-fire slide*

> One more, and this is the one you should try yourselves.
>
> The purchase is authorized. A hundred and thirty is committed — and it's still
> in the buyer's account. Nothing has moved.
>
> Now the buyer revokes. Mid-purchase.
>
> The credential is still signed. It's still perfectly authentic — you can't
> un-sign a document. What changed is the state on-chain.
>
> The hold is released. The merchant is never paid. Not one dollar moved.

*The animation runs about 4 seconds. Narrate it as it happens, then stop talking.*

---

## 14 · "I never authorized this."

**~30s**

> Last one: the dispute. Someone says they never authorized the purchase.
>
> Normally the merchant has nothing — no signature, no session, nothing to show
> the bank.
>
> We have four signed documents, each pointing back at the one before it by
> hash. The mandate the buyer signed. The purchase the agent signed. The cart
> and the receipt the merchant signed.
>
> None of it was assembled when the claim arrived. It existed, signed, before
> the purchase.
>
> If that chain closes, either they authorized it or they gave away their
> private key. Both of those are theirs.

---

## 15 · What we chose against

**~25s**

> Four decisions, and what we turned down.
>
> Form-first instead of a chatbot, because creating a mandate is the user's
> responsibility and it should look like it.
>
> A smart contract instead of a database, so the merchant checks shared state
> instead of taking our word for it.
>
> Ordinary payment methods instead of a wallet — the chain is the authorization
> layer, not the checkout.
>
> And the last one is the honest one. Stripe has exactly the right object for
> this: the Shared Payment Token. We didn't use it. It's in private preview and
> doesn't cover Argentina, and you're operating this live today. Our port is
> shaped like it, so the swap is one file.

*The fourth is the one that earns credibility. Don't rush it.*

---

## 16 · Real, and mocked

**~20s**

> Before you ask.
>
> Real: the contracts compile and run on an EVM with real transactions and real
> reverts. The signatures are real ES256. The selective disclosure is real
> salted hashes. The payment adapter is Stripe's live API.
>
> Mocked on purpose: the money, the catalog, the buyer profile, the KYC.
>
> The brief allows all of it. The interesting part was never the money — it was
> whether the merchant can tell a real mandate from a lie.

---

## 17 · The third door

**~25s**

> So — back to where we started.
>
> Block the bot and lose the sale. Wave it through and eat the fraud.
>
> Or check the mandate. Sell to the agent, and keep the receipt that proves a
> person allowed it.
>
> Revoke it mid-purchase and watch the money come back. Please try that one.

*The third door lights up on its own. Stop and let it.*

---

# Questions they will ask

The brief says the technical defense weighs as much as the demo. These are the
ones worth having ready.

**"What stops the agent from just... lying?"**
Nothing stops it from lying. What stops it is that nobody takes its word.
The cart is signed by the merchant, so the agent can't set the price. The
mandate is signed by the buyer, so the agent can't widen its own limits. And
the merchant re-checks everything itself. Slide 12 is an agent that lied
successfully to the blockchain and still got caught.

**"Why blockchain at all?"**
For one thing a signed credential can't do: change its mind. You can't
un-sign a document. Revocation, how much has been spent, and whether an
authorization has already been used — that's shared state, and both sides need
to read it without trusting each other. That's the whole use.

**"Isn't this just OAuth / a virtual card?"**
A virtual card caps the amount. It doesn't know what you bought. Slide 12 is
exactly that gap: ninety-five dollars was fine, hardware wasn't. The mandate
carries the *policy*, and the merchant can verify the policy independently.

**"Who eats the loss on a dispute?"**
Whoever the trail says. That's the point of slide 14 — before this, the answer
was "the merchant, always," because nobody could prove anything. Now the
evidence predates the purchase and it's signed by the cardholder.

**"You mocked the money. Is any of this real?"**
The crypto is. The signatures verify, the hash chain closes, the contracts
revert on a real EVM. What's mocked is the boring part.

**"What would you do with another week?"**
Wire the agent to the UI — right now they're two surfaces over one
architecture. And get access to Stripe's Shared Payment Token, which is the
object we designed the port around.

---

# If the demo breaks

Everything runs offline. In order of what to reach for:

1. `npm run demo:stripe -- --revoke-en-hold` — the revocation window, in a
   terminal, no network
2. `npm run demo:mandate -- --attack=agente-malicioso` — the slide 12 case, live
3. `npm --prefix agent test` — the whole suite, offline

The deck itself has no external resources. It runs on a laptop in airplane mode.
