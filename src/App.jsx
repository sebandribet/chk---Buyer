import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileSignature,
  Plane,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "The demo operation failed.");
  return payload;
}

/**
 * The rehearsed demo path, offered as a Tab completion in the composer.
 *
 * Every chat turn of the flow is here, including the answer to the agent's
 * clarifying question, so the whole demo can be driven with Tab + Enter and
 * ends in an authorized purchase.
 *
 * The numbers are chosen against the mock catalogue, and getting them wrong is
 * the trap this script exists to avoid: budget is the TOTAL, so US$300 over 2
 * tickets is a US$150 per-ticket cap, which admits the US$130, US$134 and
 * US$149 Cordoba fares and excludes the US$189 one. A US$150 total would derive
 * a US$75 cap and reject every fare in the catalogue.
 *
 * "any airline" matters too: the Seller term is a hard constraint, and only
 * that exact phrase means "no airline restriction". Anything else - including a
 * typo - is read as a specific carrier and matches nothing.
 */
const DEMO_SCRIPT = {
  explore: "How much is a flight to Cordoba?",
  terms: "From Buenos Aires, 2 passengers, on 2026-09-15, any airline, up to $300 total, and this mandate stays valid through 2026-09-20",
  book: "Book it",
};

/**
 * The next thing worth typing, from demo state alone.
 *
 * Returns "" when the next action is not a chat turn - a ready draft is waiting
 * on Confirm and Sign, and suggesting a prompt there points away from the
 * button the demo actually needs.
 */
function nextScriptPrompt(demo) {
  const flight = demo?.flight;
  if (!flight) return "";
  if (demo.mandate?.active) return flight.selection ? "" : DEMO_SCRIPT.book;
  if (flight.draft && ["ready", "reviewed"].includes(flight.draft.status)) return "";
  // Whatever the agent asked for, this one answer carries every term the
  // mandate needs, so the flow never stalls on a question we did not predict.
  if (flight.clarification) return DEMO_SCRIPT.terms;
  if (!flight.draft) return DEMO_SCRIPT.explore;
  return DEMO_SCRIPT.terms;
}

/**
 * What the status line says for each decision the commitment gate can reach.
 * Keyed by kind rather than sniffing the reply text, so a reply reworded in
 * the agent cannot silently change what the operator is told happened.
 */
const NOTICE_BY_KIND = {
  clarification: "The agent is missing a term and would not guess it.",
  suggestion: "The agent searched and compared. It authorized nothing.",
  purchase: "The agent acted inside your signed mandate.",
  blocked: "Your signed mandate refused that request.",
  error: "The agent stopped rather than guess.",
};

function money(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function shortHash(value) {
  if (!value) return "-";
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function App() {
  const [demo, setDemo] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Start the local demo, then chat with chk! Buyer.");
  const [prompt, setPrompt] = useState("");
  const [mandateOpen, setMandateOpen] = useState(false);
  const [editingReviewedDraft, setEditingReviewedDraft] = useState(false);
  const [verification, setVerification] = useState(null);
  const [liveCap, setLiveCap] = useState("");
  const [buyer] = useState({ name: "Marta Ruiz", email: "marta@chk.demo", company: "Marta Studio" });
  const [draftForm, setDraftForm] = useState(blankDraft());
  const chatRef = useRef(null);

  const flight = demo?.flight;
  const draft = flight?.draft;
  const selection = flight?.selection;
  const activeMandate = Boolean(demo?.mandate?.active);
  const isSigned = draft?.status === "signed";
  const isReviewed = draft?.status === "reviewed";
  const isEditable = ["needs_input", "ready"].includes(draft?.status) || editingReviewedDraft;
  const hasKyc = Boolean(demo?.kyc?.captureReady);
  const scriptPrompt = nextScriptPrompt(demo);

  /**
   * The operations pane reveals one card at a time, as the flow earns it.
   *
   * Every card rendered from the start was a screen of empty placeholders -
   * "awaiting a quote", "sign the mandate first", two merchant wallets at
   * US$0.00 - and a viewer had no way to tell which of them was the live one.
   * A card appears at the moment it has something to say: search when the
   * mandate is signed, the merchant desk when a quote is bound to one, the
   * trials once the honest path has been shown to work.
   *
   * The trials also stay up once any of them has run, so a reset back to the
   * signed phase lands the operator straight on the next one.
   */
  const mandateSigned = Boolean(demo?.mandate);
  const settled = selection?.status === "Settled";
  const showTrials = mandateSigned
    && (settled || (flight?.trials?.length ?? 0) > 0 || !activeMandate);

  useEffect(() => {
    if (!draft) return;
    setDraftForm(toForm(draft));
    setLiveCap(draft.maxUnitPrice ?? "");
    setEditingReviewedDraft(false);
    setMandateOpen(true);
  }, [draft?.id, draft?.revision, draft?.status]);

  // Always scroll the chat down when messages, validation questions, or the
  // mandate menu changes. The buyer never has to hunt for the agent's reply.
  useEffect(() => {
    const scroller = chatRef.current;
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
  }, [flight?.conversation?.length, draft?.revision, draft?.status, mandateOpen, busy]);

  async function run(label, work) {
    setBusy(label);
    setNotice("");
    try {
      const result = await work();
      return result;
    } catch (error) {
      setNotice(error.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function startDemo() {
    const state = await run("reset", () => api("/api/demo/reset", { method: "POST" }));
    if (state) {
      setDemo(state);
      setVerification(null);
      setNotice(`Local chain ready at block ${state.network.latestBlock}. No real card or money is involved.`);
    }
  }

  async function verifyBuyer() {
    const state = await run("kyc", () => api("/api/demo/kyc/login", {
      method: "POST",
      body: JSON.stringify(buyer),
    }));
    if (state) {
      setDemo(state);
      setNotice(`${state.buyer.name} is KYC-verified and an opaque mock payment token is enrolled.`);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !demo) return;
    const result = await run("chat", () => api("/api/demo/agent/intent", {
      method: "POST",
      body: JSON.stringify({ prompt: text }),
    }));
    if (result) {
      setDemo(result.state);
      setPrompt("");
      setVerification(null);
      if (result.draft) setMandateOpen(true);
      setNotice(NOTICE_BY_KIND[result.kind] ?? result.reply);
    }
  }

  /**
   * Enter sends; Shift+Enter is a newline. Tab fills the next rehearsed prompt
   * but never sends it - the demo should still show a human choosing to send.
   */
  function onComposerKey(event) {
    if (event.key === "Tab" && !event.shiftKey && !prompt.trim() && scriptPrompt) {
      event.preventDefault();
      setPrompt(scriptPrompt);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (prompt.trim() && !busy) sendMessage(event);
    }
  }

  function updateDraftField(field, value) {
    setDraftForm((current) => ({ ...current, [field]: value }));
  }

  async function saveDraft(event) {
    event.preventDefault();
    const state = await run("draft", () => api("/api/demo/mandate/draft", {
      method: "PATCH",
      body: JSON.stringify({
        ...draftForm,
        quantity: Number(draftForm.quantity),
        maxStops: Number(draftForm.maxStops),
      }),
    }));
    if (state) {
      setDemo(state);
      setNotice(state.flight.draft.status === "ready"
        ? `Draft v${state.flight.draft.revision} is ready to confirm. It still cannot spend.`
        : "The mandate menu still needs the highlighted details.");
    }
  }

  async function confirmDraft() {
    const state = await run("confirm", () => api("/api/demo/mandate/draft/confirm", { method: "POST" }));
    if (state) {
      setDemo(state);
      setNotice("Terms confirmed. Signing remains a separate, explicit step.");
    }
  }

  async function signMandate() {
    const state = await run("sign", () => api("/api/demo/mandate", { method: "POST" }));
    if (state) {
      setDemo(state);
      setNotice(`Mandate #${state.mandate.id} is live on the mock chain.`);
    }
  }

  /**
   * Back to the signed mandate, without redoing KYC and the chat.
   *
   * Every trial by fire ends the mandate it runs against, so showing a second
   * one meant restarting the whole demo. The audit trail deliberately survives.
   */
  async function resetToSigned() {
    const state = await run("resign", () => api("/api/demo/reset-to-signed", { method: "POST" }));
    if (state) {
      setDemo(state);
      setVerification(null);
      setNotice(`Back at the signed phase on mandate #${state.mandate.id}. The audit trail keeps every earlier rejection.`);
    }
  }

  async function searchFlights() {
    const result = await run("search", () => api("/api/demo/flight/search-and-authorize", { method: "POST" }));
    if (result) {
      setDemo(result.state);
      setVerification(null);
      setNotice(result.status === "authorized"
        ? `${result.selection.selected.airline} was selected. The merchant must still verify before capture.`
        : result.report.summary);
    }
  }

  async function verifyMerchant() {
    if (!selection) return;
    const result = await run("verify", () => api(`/api/demo/merchant/verify/${selection.purchaseId}`));
    if (result) {
      setVerification(result);
      setNotice(result.verified
        ? "Merchant verification passed. The one-use mock payment is eligible for capture."
        : "Merchant verification failed. Capture is blocked and no money moved.");
    }
  }

  async function capturePayment() {
    if (!selection) return;
    const result = await run("capture", () => api(`/api/demo/merchant/capture/${selection.purchaseId}`, { method: "POST" }));
    if (result) {
      setDemo(result.state);
      setNotice(`Order filled. ${selection.merchant} received US$${selection.selected.amount} from the mock payment method.`);
    }
  }

  async function amendCap() {
    const state = await run("amend", () => api("/api/demo/mandate/price-cap", {
      method: "POST",
      body: JSON.stringify({ maxUnitPrice: liveCap }),
    }));
    if (state) {
      setDemo(state);
      setVerification(null);
      setNotice(`Live fare cap amended to US$${liveCap}. Existing uncaptured authorizations are no longer current.`);
    }
  }

  async function revokeMandate() {
    const state = await run("revoke", () => api("/api/demo/mandate/revoke", { method: "POST" }));
    if (state) {
      setDemo(state);
      setVerification(null);
      setNotice("Mandate revoked on-chain. Every later authorization and unused capture must fail.");
    }
  }

  async function outsideMandateTrial() {
    const result = await run("outside", () => api("/api/demo/trial/outside-mandate", { method: "POST" }));
    if (result) {
      setDemo(result.state);
      setNotice(`Correctly rejected an out-of-limit US$${result.attemptedUnitPrice} fare before authorization.`);
    }
  }

  async function revokedMandateTrial() {
    const result = await run("revoked", () => api("/api/demo/trial/revoked-mandate", { method: "POST" }));
    if (result) {
      setDemo(result.state);
      setNotice("Correctly rejected the post-revocation purchase attempt. No money moved.");
    }
  }

  async function impersonatedAgentTrial() {
    const result = await run("imposter", () => api("/api/demo/trial/impersonated-agent", { method: "POST" }));
    if (result) {
      setDemo(result.state);
      setNotice("Correctly rejected a non-delegated wallet, even with a merchant-signed quote.");
    }
  }

  async function expiredMandateTrial() {
    const result = await run("expired", () => api("/api/demo/trial/expired-mandate", { method: "POST" }));
    if (result) {
      setDemo(result.state);
      setVerification(null);
      setNotice("The local clock passed the signed validity date; the purchase was correctly rejected.");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span>chk!</span> Buyer</div>
        <p>Agentic flight purchase demo <i>mock chain + mock USD</i></p>
        <button className="quiet-button" onClick={startDemo} disabled={Boolean(busy)}>
          <RefreshCw size={14} className={busy === "reset" ? "spin" : ""} />
          {demo ? "Reset demo" : "Start demo"}
        </button>
      </header>

      <main className="demo-grid">
        <section className="chat-pane" aria-label="Chk Buyer chat">
          <div className="pane-heading">
            <div><Bot size={18} /><span><strong>chk! Buyer</strong><small>flight mandate agent</small></span></div>
            <span className={`live-dot ${demo ? "on" : ""}`}>{demo ? "LIVE" : "READY"}</span>
          </div>

          <div className="chat-scroll" ref={chatRef}>
            {!demo && (
              <EmptyState onStart={startDemo} busy={Boolean(busy)} />
            )}

            {demo && !hasKyc && (
              <section className="kyc-card login-card">
                <div className="section-label"><ShieldCheck size={14} /> Step 1 - mock KYC and payment token</div>
                <p>Enrolls a tokenized mock payment method. No card number and no real funds.</p>
                <div className="login-row">
                  <span><strong>{buyer.name}</strong><small>{buyer.email} &middot; {buyer.company}</small></span>
                  <button className="primary-button" onClick={verifyBuyer} disabled={Boolean(busy)}>
                    <ShieldCheck size={15} /> {busy === "kyc" ? "Signing in..." : "Sign in"}
                  </button>
                </div>
              </section>
            )}

            {demo && flight?.conversation.map((message, index) => (
              <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                <span>{message.role === "user" ? demo.buyer.name : "chk! Buyer"}</span>
                <p>{message.content}</p>
              </article>
            ))}

            {busy === "chat" && (
              <article className="message assistant pending">
                <span>chk! Buyer</span>
                <p className="thinking">Thinking<i /><i /><i /></p>
              </article>
            )}

            {flight?.clarification && !busy && <ClarificationCard clarification={flight.clarification} />}

            {draft && (
              <button className={`mandate-strip ${draft.status}`} onClick={() => setMandateOpen((open) => !open)}>
                <FileSignature size={15} />
                <span><strong>{mandateLabel(draft)}</strong><small>{draft.productName || "Flight request"}</small></span>
                <ChevronDown size={16} className={mandateOpen ? "up" : ""} />
              </button>
            )}

            {draft && mandateOpen && (
              <MandateMenu
                draft={draft}
                form={draftForm}
                editable={isEditable}
                reviewed={isReviewed}
                signed={isSigned}
                busy={busy}
                onChange={updateDraftField}
                onSave={saveDraft}
                onConfirm={confirmDraft}
                onSign={signMandate}
                onEditReviewed={() => setEditingReviewedDraft(true)}
              />
            )}
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onComposerKey}
              placeholder={demo ? "Type a request - Enter sends, Shift+Enter adds a line" : "Start the demo first"}
              disabled={!demo || Boolean(busy)}
              rows="2"
            />
            <button className="send-button" disabled={!demo || !prompt.trim() || Boolean(busy)} aria-label="Send message"><Send size={17} /></button>
          </form>
          {scriptPrompt
            ? <p className="composer-tip script-tip"><kbd>Tab</kbd> fills: &ldquo;{scriptPrompt}&rdquo;</p>
            : <p className="composer-tip">Chat can search and compare. Booking needs a signed mandate.</p>}
        </section>

        <section className="operations-pane" aria-label="Merchant and audit showcase">
          <div className="ops-heading">
            <div><Plane size={19} /><span><strong>Flight operations</strong><small>scrape, verify, capture</small></span></div>
            {demo?.mandate && <span className={`mandate-status ${demo.mandate.status.toLowerCase()}`}>{demo.mandate.status}</span>}
          </div>

          {!demo ? <OperationsEmpty /> : <>
            <WalletRow demo={demo} showMerchants={Boolean(selection)} />
            <AgentSuggestion suggestion={flight?.suggestion} />
            {mandateSigned && (
              <SearchPanel
                flight={flight}
                active={activeMandate}
                busy={busy}
                onSearch={searchFlights}
              />
            )}
            {selection && (
              <MerchantPanel
                selection={selection}
                verification={verification}
                busy={busy}
                onVerify={verifyMerchant}
                onCapture={capturePayment}
                active={activeMandate}
              />
            )}
            {showTrials && (
              <TrialByFire
                active={activeMandate}
                mandate={demo.mandate}
                selection={selection}
                liveCap={liveCap}
                onCapChange={setLiveCap}
                onAmend={amendCap}
                onOutside={outsideMandateTrial}
                onImposter={impersonatedAgentTrial}
                onExpired={expiredMandateTrial}
                onRevoke={revokeMandate}
                onRevoked={revokedMandateTrial}
                onResetSigned={resetToSigned}
                busy={busy}
                trial={flight?.trial}
              />
            )}
            {flight?.lastReport && <DecisionReport report={flight.lastReport} />}
            <AuditTrail audit={demo.audit} />
          </>}
          <p className={`notice ${notice ? "show" : ""}`}>{notice}</p>
        </section>
      </main>
    </div>
  );
}

function blankDraft() {
  return { productName: "", origin: "", destination: "", departureDate: "", authorizationExpiresAt: "", seller: "", quantity: "1", budget: "", cabin: "Economy", maxStops: "0" };
}

function toForm(draft) {
  return {
    productName: draft.productName ?? "",
    origin: draft.origin ?? "",
    destination: draft.destination ?? "",
    departureDate: draft.departureDate ?? "",
    authorizationExpiresAt: draft.authorizationExpiresAt ?? "",
    seller: draft.seller ?? "",
    quantity: String(draft.quantity ?? 1),
    budget: draft.budget ?? "",
    cabin: draft.cabin ?? "Economy",
    maxStops: String(draft.maxStops ?? 0),
  };
}

function mandateLabel(draft) {
  if (draft.status === "needs_input") return "Mandate draft needs your input";
  if (draft.status === "ready") return `Draft v${draft.revision} - ready to review`;
  if (draft.status === "reviewed") return `Draft v${draft.revision} - confirmed, not signed`;
  if (draft.status === "signed") return `Mandate #${draft.signing?.mandateId ?? "live"} - signed on chain`;
  if (draft.status === "revoked") return "Mandate revoked";
  return "Mandate draft";
}

function EmptyState({ onStart, busy }) {
  return <div className="empty-state"><Bot size={28} /><h1>Safe purchases start with a mandate.</h1><p>A full human &rarr; agent &rarr; merchant &rarr; capture flow on a local chain.</p><button className="primary-button" onClick={onStart} disabled={busy}><RefreshCw size={15} /> Start local live demo</button></div>;
}

/**
 * Why the derived cap is not showing yet.
 *
 * The cap depends on the budget and the ticket count and on nothing else, so
 * this must not blame a field it does not use. Saying "waiting for budget" over
 * an entered budget is what made the form look like it was rejecting a valid
 * one, while the field actually blocking the signature sat elsewhere.
 */
function unitCapPending(draft) {
  const tickets = Number(draft.quantity);
  const needsBudget = !String(draft.budget ?? "").trim();
  const needsTickets = !Number.isInteger(tickets) || tickets < 1;
  if (needsBudget && needsTickets) return "Waiting for budget and tickets";
  if (needsBudget) return "Waiting for budget";
  if (needsTickets) return "Waiting for ticket count";
  return "Budget must be a positive USD amount";
}

function MandateMenu({ draft, form, editable, reviewed, signed, busy, onChange, onSave, onConfirm, onSign, onEditReviewed }) {
  const missing = draft.questions ?? [];
  return (
    <section className="mandate-menu">
      <div className="menu-heading"><span className="section-label"><FileSignature size={14} /> Human validation menu</span><span className={`draft-pill ${draft.status}`}>{draft.status.replace("_", " ")}</span></div>
      {missing.length > 0 && <div className="required-note"><AlertTriangle size={15} /><span><strong>Before this can be signed:</strong> {missing.map((question) => question.question).join(" ")}</span></div>}

      <form className="mandate-form" onSubmit={onSave}>
        <label className="wide">Product name / free-text flight request
          <textarea value={form.productName} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("productName", event.target.value)} placeholder="Flight from Buenos Aires to Cordoba on 2026-09-15" rows="2" />
        </label>
        <label>Budget (US$)<input value={form.budget} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("budget", event.target.value)} inputMode="decimal" placeholder="e.g. 300" />
          <small>Total for every ticket. The cap below divides it by the ticket count.</small>
        </label>
        <label>Seller / airline<input value={form.seller} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("seller", event.target.value)} placeholder="e.g. Any airline" />
          <small>Exactly &ldquo;Any airline&rdquo; allows every carrier. Anything else is enforced as that carrier.</small>
        </label>
        <label>Units / tickets<input value={form.quantity} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("quantity", event.target.value)} inputMode="numeric" /></label>
        <label>Departure date<input type="date" value={form.departureDate} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("departureDate", event.target.value)} /></label>
        <label>Mandate valid through<input type="date" value={form.authorizationExpiresAt} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("authorizationExpiresAt", event.target.value)} /></label>
        <label>Origin<input value={form.origin} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("origin", event.target.value)} /></label>
        <label>Destination<input value={form.destination} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("destination", event.target.value)} /></label>
        <label>Cabin<input value={form.cabin} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("cabin", event.target.value)} /></label>
        <label>Max stops<input type="number" min="0" max="2" value={form.maxStops} disabled={!editable || Boolean(busy)} onChange={(event) => onChange("maxStops", event.target.value)} /></label>
        {editable && <button className="secondary-button wide" disabled={Boolean(busy)}><CheckCircle2 size={15} /> {busy === "draft" ? "Updating..." : "Save mandate fields"}</button>}
      </form>

      <div className="mandate-summary">
        <span>Derived per-ticket cap</span><strong>{draft.maxUnitPrice ? `US$${money(draft.maxUnitPrice)}` : unitCapPending(draft)}</strong>
        <span>Authority valid through</span><strong>{draft.authorizationExpiresAt || "Waiting for your date"}</strong>
        <span>Signed only after</span><strong>KYC &rarr; review &rarr; signature</strong>
      </div>

      <div className="menu-actions">
        {draft.status === "ready" && <button className="primary-button" onClick={onConfirm} disabled={Boolean(busy)}><BadgeCheck size={15} /> {busy === "confirm" ? "Confirming..." : "Confirm exact terms"}</button>}
        {reviewed && !editable && <button className="secondary-button" onClick={onEditReviewed} disabled={Boolean(busy)}>Edit terms</button>}
        {reviewed && <button className="primary-button" onClick={onSign} disabled={Boolean(busy)}><FileSignature size={15} /> {busy === "sign" ? "Signing..." : "Sign mandate on chain"}</button>}
        {signed && <p className="signed-note"><ShieldCheck size={15} /> Mandate #{draft.signing?.mandateId} is constrained by: <code>{shortHash(draft.signing?.constraintHash)}</code></p>}
      </div>
    </section>
  );
}

/**
 * The merchant wallets only once a merchant is in the picture.
 *
 * Two US$0.00 cards next to the buyer from the first frame told a viewer
 * nothing and read as part of the buyer's own balance. They earn their place
 * when a quote is bound to one of them and the capture is about to move money.
 */
function WalletRow({ demo, showMerchants }) {
  return <section className={`wallet-row ${showMerchants ? "" : "solo"}`}>
    <article className="wallet buyer"><span>Buyer</span><strong>US${money(demo.balances.buyer)}</strong><small>{demo.buyer.name}<br />{demo.kyc.captureReady ? "KYC token ready" : "KYC pending"}</small></article>
    {showMerchants && demo.flight.merchants.map((merchant) => <article className="wallet merchant" key={merchant.name}><span>{merchant.name}</span><strong>US${money(merchant.balance)}</strong><small>approved merchant</small></article>)}
  </section>;
}

/**
 * Field names as a human reads them.
 *
 * The agent's `field` is a path into the typed intent ("trip.departure_date",
 * "constraints.budgetUsd"), and both the model and the code write it in their
 * own casing. Showing that raw put "departure_date" and "budgetUsd" in front of
 * the buyer.
 */
const QUESTION_LABELS = {
  origin: "Origin",
  destination: "Destination",
  departuredate: "Departure date",
  returndate: "Return date",
  passengers: "Passengers",
  budgetusd: "Budget",
  budget: "Budget",
  cabin: "Cabin",
  maxstops: "Stops",
  airlinepreference: "Airline",
  airline: "Airline",
  authorizationexpiresat: "Valid through",
};

function questionLabel(field) {
  const key = String(field ?? "").split(".").pop();
  const normalised = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (QUESTION_LABELS[normalised]) return QUESTION_LABELS[normalised];
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : "Detail";
}

/**
 * The terms the agent had to ask for.
 *
 * Rendered in the chat rather than the operations pane because that is where
 * the question was asked. An unanswered gap is the agent refusing to invent a
 * value, so it is shown as a normal part of the conversation, not an error.
 */
function ClarificationCard({ clarification }) {
  return (
    <section className="kyc-card clarification-card">
      <div className="section-label"><AlertTriangle size={14} /> Missing terms</div>
      <p>Nothing was searched, signed, or charged.</p>
      <dl className="clarification-list">
        {clarification.questions.map((question) => (
          <div key={question.field || question.question}>
            <dt>{questionLabel(question.field)}</dt>
            <dd>{question.question}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const COMMITMENT_LABEL = {
  committed: "booking order",
  conditional: "conditional",
  exploratory: "question",
};

/**
 * What the agent would book, and what it actually did: nothing.
 *
 * This panel exists to make the commitment gate visible. Everything in it was
 * produced with no mandate access and no way to move money, which is why it can
 * be shown before anything is signed.
 */
function AgentSuggestion({ suggestion }) {
  if (!suggestion) return null;
  // `detail` is deliberately not rendered here: the chat reply already opens
  // with that exact sentence, and printing it twice was half this card.
  const { best, options, overBudget, rejected, trace, brief, commitment } = suggestion;

  return (
    <section className="operations-card search-card">
      <div className="card-heading">
        <div><Search size={16} /><span><strong>Agent comparison</strong><small>compared, authorized nothing</small></span></div>
        <em>{COMMITMENT_LABEL[commitment] ?? commitment}</em>
      </div>

      {best && (
        <div className="selected-itinerary">
          <Plane size={16} />
          <div>
            <strong>Would book: {best.airline} {best.quoteId}</strong>
            <small>
              {best.origin} to {best.destination} · {best.departureDate} {best.departureTime} ·
              {best.stops === 0 ? " direct" : ` ${best.stops} stop(s)`} · {best.cabin} ·
              {` ${best.passengers} passenger(s)`}
            </small>
          </div>
          <b>US${money(best.totalPrice)}</b>
        </div>
      )}

      {brief?.reference?.length > 0 && (
        <div className="required-note">
          <AlertTriangle size={14} />
          <span>
            You did not give {brief.reference.join(", ")}. The agent compared on a reference value, not on
            something you asked for. It cannot reach a mandate.
          </span>
        </div>
      )}

      {options?.length > 1 && (
        <div className="offer-list">
          {options.slice(1).map((offer) => (
            <div className="offer eligible" key={offer.quoteId}>
              <strong>{offer.airline}</strong>
              <small>{offer.departureTime} · {offer.stops === 0 ? "direct" : `${offer.stops} stop(s)`} · {offer.cabin}</small>
              <span className="offer-price">US${money(offer.totalPrice)}</span>
            </div>
          ))}
        </div>
      )}

      {overBudget?.length > 0 && (
        <div className="offer-list">
          {overBudget.map((offer) => (
            <div className="offer rejected" key={offer.quoteId}>
              <strong>{offer.airline}</strong>
              <small>over the cap you gave</small>
              <span className="offer-price">US${money(offer.totalPrice)}</span>
            </div>
          ))}
        </div>
      )}

      {rejected?.length > 0 && (
        <div className="offer-list">
          {rejected.map((offer) => (
            <div className="offer rejected" key={offer.quoteId}>
              <strong>{offer.airline} {offer.quoteId}</strong>
              <small>{offer.differences.map((difference) => `${difference.term}: asked ${difference.requested}, offered ${difference.offered}`).join("; ")}</small>
              <p>{offer.verdict?.reason ?? "Did not match a term you gave."}</p>
            </div>
          ))}
        </div>
      )}

      <ul className="scrape-trace">
        {trace.map((step) => (
          <li key={`${step.source}-${step.detail}`}><span>{step.status}</span>{step.detail}</li>
        ))}
      </ul>
    </section>
  );
}

function SearchPanel({ flight, active, busy, onSearch }) {
  const offers = flight?.search?.offers ?? [];
  return <section className="operations-card search-card">
    <div className="card-heading"><div><Search size={17} /><span><strong>Agent flight search</strong><small>Scrape, then filter on the signed terms</small></span></div>{flight?.search?.status && <em>{flight.search.status.replaceAll("_", " ")}</em>}</div>
    {active && !flight?.selection && <button className="primary-button wide" onClick={onSearch} disabled={Boolean(busy)}><Plane size={15} /> {busy === "search" ? "Searching..." : "Search and authorize the cheapest eligible flight"}</button>}
    {flight?.search?.trace?.length > 0 && <ul className="scrape-trace">{flight.search.trace.map((step) => <li key={step.source}><span>{step.status}</span>{step.detail}</li>)}</ul>}
    {offers.length > 0 && <div className="offer-list">{offers.map((offer) => <article className={`offer ${offer.eligible ? "eligible" : "rejected"}`} key={offer.quoteId}><div><strong>{offer.airline}</strong><small>{offer.merchant} · {offer.quoteId}</small></div><div><span>{offer.departureTime} - {offer.arrivalTime}</span><small>{offer.route} · {offer.stops === 0 ? "nonstop" : `${offer.stops} stop(s)`}</small></div><div className="offer-price"><strong>US${money(offer.amount)}</strong><small>US${money(offer.unitPrice)} / ticket</small></div><p>{offer.eligible ? "Eligible under signed terms" : offer.rejectionReasons.join(" ")}</p></article>)}</div>}
  </section>;
}

function MerchantPanel({ selection, verification, busy, onVerify, onCapture, active }) {
  const settled = selection.status === "Settled";
  return <section className="operations-card merchant-card">
    <div className="card-heading"><div><ShieldCheck size={17} /><span><strong>{selection.merchant} merchant desk</strong><small>Quote {selection.orderReference} · mandate #{selection.mandateId}</small></span></div><em className={settled ? "settled" : "authorized"}>{selection.status}</em></div>
    <div className="selected-itinerary"><Plane size={19} /><div><strong>{selection.selected.airline} · {selection.selected.route}</strong><small>{selection.selected.departureDate} · {selection.selected.departureTime} - {selection.selected.arrivalTime} · {selection.selected.cabin}</small></div><b>US${money(selection.selected.amount)}</b></div>
    {!settled && <div className="merchant-actions"><button className="secondary-button" onClick={onVerify} disabled={Boolean(busy)}><ShieldCheck size={15} /> {busy === "verify" ? "Verifying..." : "Verify mandate on chain"}</button>{verification?.verified && active && <button className="primary-button" onClick={onCapture} disabled={Boolean(busy)}><WalletCards size={15} /> {busy === "capture" ? "Capturing..." : "Fill order & capture mock payment"}</button>}</div>}
    {verification && <VerificationChecks verification={verification} />}
  </section>;
}

function VerificationChecks({ verification }) {
  return <div className={`verification ${verification.verified ? "passed" : "failed"}`}><strong>{verification.verified ? "Verification passed" : "Verification blocked capture"}</strong><div>{Object.entries(verification.checks).map(([name, passed]) => <span key={name} className={passed ? "pass" : "fail"}>{passed ? "✓" : "×"} {readable(name)}</span>)}</div></div>;
}

/**
 * The unsafe paths, all of them always on screen.
 *
 * A trial that no longer applies is greyed out rather than removed. Removing it
 * was read as the demo breaking: the buttons a viewer had just been looking at
 * disappeared the moment one of them worked, and nothing said why. Disabled and
 * still there, with the reason on hover, shows the same thing honestly - this
 * one is spent, that one needs a revoked mandate.
 */
function TrialByFire({ active, mandate, selection, liveCap, onCapChange, onAmend, onOutside, onImposter, onExpired, onRevoke, onRevoked, onResetSigned, busy, trial }) {
  const revoked = mandate?.status === "Revoked";
  const expired = mandate?.status === "Expired";
  const anyBusy = Boolean(busy);
  const needsLive = "Needs a live mandate - reset to the signed phase first.";
  const trials = [
    { key: "outside", idle: "Flight $150 over cap", busy: "Testing...", onClick: onOutside, enabled: active, why: needsLive },
    { key: "imposter", idle: "Impersonated agent", busy: "Testing...", onClick: onImposter, enabled: active, why: needsLive },
    { key: "expired", idle: "Expire the mandate", busy: "Expiring...", onClick: onExpired, enabled: active, why: needsLive },
    { key: "revoke", idle: "Revoke the mandate", busy: "Revoking...", onClick: onRevoke, enabled: active, why: needsLive },
    { key: "revoked", idle: "Buy after revocation", busy: "Testing...", onClick: onRevoked, enabled: revoked, why: "Revoke the mandate first." },
  ];

  return <section className="operations-card trial-card">
    <div className="card-heading">
      <div><AlertTriangle size={17} /><span><strong>Trial by fire</strong><small>Unsafe paths fail loudly and leave no charge behind</small></span></div>
      <button className="quiet-button" type="button" onClick={onResetSigned} disabled={anyBusy}>
        <RefreshCw size={13} className={busy === "resign" ? "spin" : ""} /> {busy === "resign" ? "Re-signing..." : "Reset to signed"}
      </button>
    </div>
    <div className="trial-actions">
      {trials.map((entry) => (
        <button
          key={entry.key}
          className="danger-button"
          onClick={entry.onClick}
          disabled={anyBusy || !entry.enabled}
          title={entry.enabled ? undefined : entry.why}
        >
          <Ban size={15} /> {busy === entry.key ? entry.busy : entry.idle}
        </button>
      ))}
      <label className="cap-control">Live ticket cap
        <input value={liveCap} onChange={(event) => onCapChange(event.target.value)} disabled={anyBusy || selection?.status !== "Authorized"} />
        <button className="quiet-button" type="button" onClick={onAmend} disabled={anyBusy || selection?.status !== "Authorized"} title={selection?.status === "Authorized" ? undefined : "Needs an authorized, uncaptured quote."}>Apply</button>
      </label>
    </div>
    {expired && <p className="trial-result"><CheckCircle2 size={15} /> The clock is past the signed validity date. Search, authorization and capture are all blocked.</p>}
    {trial && <p className="trial-result"><CheckCircle2 size={15} /> <strong>Rejected as intended:</strong> {trial.reason}</p>}
  </section>;
}

function DecisionReport({ report }) {
  return <section className={`operations-card decision-report ${report.status}`}>
    <div className="card-heading"><div><ClipboardList size={17} /><span><strong>{report.title}</strong><small>{report.summary}</small></span></div></div>
    <div className="report-grid"><div><span>Mandate</span><strong>{report.draft?.route}</strong><small>{report.draft?.tickets} ticket(s) · US${money(report.draft?.totalBudget)} total cap</small></div><div><span>Decision</span><strong>{report.decision?.selectedMerchant ?? "No eligible seller"}</strong><small>{report.decision?.rationale}</small></div><div><span>Authorization</span><strong>{report.authorization ? "On-chain quote bound" : "None created"}</strong><small>{report.authorization ? shortHash(report.authorization.checkoutHash) : "No mock USD moved"}</small></div></div>
    {report.settlement && <div className="settlement"><strong>Settlement complete: US${money(report.settlement.amount)}</strong>{Object.entries(report.settlement.balances).map(([wallet, movement]) => <span key={wallet}>{wallet}: {movement.before} &rarr; {movement.after} ({movement.delta})</span>)}</div>}
  </section>;
}

/**
 * The latest step, with the rest one click away.
 *
 * The full trail is the point of the demo, but printing every entry pushed the
 * operations pane past a screen and buried whatever just happened. The newest
 * entry is what an operator is actually looking at.
 *
 * The step count is the number the room is meant to leave with, so it is set as
 * a figure and not buried in a subtitle nobody can read from the back.
 */
function AuditTrail({ audit }) {
  const [expanded, setExpanded] = useState(false);
  const entries = audit.slice().reverse();
  if (entries.length === 0) return null;
  const shown = expanded ? entries : entries.slice(0, 1);

  return (
    <section className="operations-card audit-card">
      <div className="card-heading">
        <div><ClipboardList size={17} /><span><strong>Auditor trail</strong></span></div>
        <div className="audit-count">
          <span className="count-pill">{entries.length}<small>steps</small></span>
          {entries.length > 1 && (
            <button className="quiet-button" type="button" onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Latest only" : "Show all"}
            </button>
          )}
        </div>
      </div>
      <ol>
        {shown.map((entry, index) => (
          <li key={`${entry.type}-${index}`}>
            <strong>{readable(entry.type)}</strong>
            <span>{entry.detail}</span>
            {entry.transactionHash && <code>{shortHash(entry.transactionHash)}</code>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function OperationsEmpty() {
  return <div className="ops-empty"><Plane size={30} /><h2>Ready for a safe flight purchase.</h2><p>Search, verification, capture and the auditor record appear here as the flow reaches them.</p></div>;
}

function readable(value) {
  return String(value).replaceAll("_", " ").replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

export default App;
