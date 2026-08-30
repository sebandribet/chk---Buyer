import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  FileSignature,
  RefreshCw,
  Send,
  ShieldCheck,
  Store,
  WalletCards,
} from "lucide-react";

function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="brand">
            <span className="brand-name">chk! <span>Buyer</span></span>
          </span>
          <span className="header-tag">Agentic purchase demo · mock chain, mock USD</span>
        </div>
      </header>
      <main className="main">
        <LiveDemoPage />
      </main>
    </div>
  );
}

async function demoRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The operation could not be completed.");
  return payload;
}

function LiveDemoPage() {
  const [demo, setDemo] = useState(null);
  const [purchaseId, setPurchaseId] = useState(null);
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState("Start the demo, then introduce a buyer at the KYC desk.");
  const [buyer, setBuyer] = useState({ name: "Marta Ruiz", email: "marta@ruizstudio.demo", company: "Ruiz Studio" });
  const [intentMessage, setIntentMessage] = useState("");
  const [draftForm, setDraftForm] = useState({ productId: "", quantity: "1", maxUnitPrice: "", budget: "" });
  const [mandateOpen, setMandateOpen] = useState(false);

  const draft = demo?.marketplace?.draft;
  const chatMessages = demo?.marketplace?.conversation ?? [];
  const scrollerRef = useRef(null);
  const lastDraftStamp = useRef(null);

  useEffect(() => {
    if (!demo) return undefined;
    const refresh = setInterval(() => {
      demoRequest("/api/demo/state").then(setDemo).catch(() => {});
    }, 1500);
    return () => clearInterval(refresh);
  }, [Boolean(demo)]);

  // El chat siempre mira el último mensaje. Sin esto, la respuesta del agente
  // aparece fuera de pantalla y el humano cree que no pasó nada.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [chatMessages.length, action, draft?.revision, draft?.status]);

  useEffect(() => {
    if (!draft) return;
    setDraftForm({
      productId: draft.productId ?? "",
      quantity: String(draft.quantity ?? 1),
      maxUnitPrice: draft.maxUnitPrice ?? "",
      budget: draft.budget ?? "",
    });
  }, [draft?.id, draft?.revision, draft?.status]);

  /**
   * El panel del mandato se abre solo cuando el agente lo crea o lo cambia.
   * Que el humano tenga que ir a buscar lo que acaba de cambiar es la forma
   * más fácil de que firme algo que no miró.
   */
  useEffect(() => {
    if (!draft) {
      lastDraftStamp.current = null;
      return;
    }
    const stamp = `${draft.id}:${draft.revision}:${draft.status}`;
    if (lastDraftStamp.current !== stamp) {
      lastDraftStamp.current = stamp;
      if (draft.status !== "needs_input") setMandateOpen(true);
    }
  }, [draft?.id, draft?.revision, draft?.status]);

  async function startDemo() {
    setAction("start");
    setNotice("");
    setPurchaseId(null);
    setMandateOpen(false);
    try {
      const state = await demoRequest("/api/demo/reset", { method: "POST", body: JSON.stringify({}) });
      setDemo(state);
      setNotice(`Local chain and three mock wallets ready in block ${state.network.latestBlock}.`);
    } catch (error) {
      setNotice(`Backend unavailable: ${error.message}`);
    } finally {
      setAction(null);
    }
  }

  async function completeKycLogin() {
    setAction("kyc");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/kyc/login", { method: "POST", body: JSON.stringify(buyer) });
      setDemo(state);
      setNotice(`${state.buyer.name} is KYC-verified. Payment token ready; no money moved.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function submitIntent(event) {
    event.preventDefault();
    const prompt = intentMessage.trim();
    if (!prompt) return;
    setAction("intent");
    setNotice("");
    try {
      const result = await demoRequest("/api/demo/agent/intent", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setDemo(result.state);
      if (!result.state.marketplace.selection) setPurchaseId(null);
      setIntentMessage("");
      const nextDraft = result.draft ?? result.intent;
      setNotice(nextDraft.status === "ready"
        ? `Draft v${nextDraft.revision} ready for review. It is not a payment authorization.`
        : nextDraft.reply);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function applyDraftEdits(event) {
    event.preventDefault();
    setAction("edit-draft");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/mandate/draft", {
        method: "PATCH",
        body: JSON.stringify({
          productId: draftForm.productId,
          quantity: Number(draftForm.quantity),
          maxUnitPrice: draftForm.maxUnitPrice,
          budget: draftForm.budget,
        }),
      });
      setDemo(state);
      setNotice(`Draft v${state.marketplace.draft.revision} updated. Review it before confirming.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function confirmDraft() {
    setAction("confirm-draft");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/mandate/draft/confirm", { method: "POST" });
      setDemo(state);
      setNotice(`Draft v${state.marketplace.draft.revision} confirmed. Signing is still a separate action.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function createMandate() {
    setAction("mandate");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/mandate", { method: "POST", body: JSON.stringify({}) });
      setDemo(state);
      const signing = state.marketplace.signedMandate;
      setNotice(`Mandate signed to the local chain in block ${signing.blockNumber}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function compareAndAuthorize() {
    setAction("compare");
    setNotice("");
    try {
      const result = await demoRequest("/api/demo/agent/compare-and-authorize", { method: "POST" });
      setDemo(result.state);
      if (result.status === "authorized") {
        setPurchaseId(result.purchaseId);
        setNotice(`Agent selected ${result.selection.merchant}. Checkout authorized; the buyer has not been charged.`);
      } else {
        setPurchaseId(null);
        setNotice(result.report.recommendation);
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function reopenDraft() {
    setAction("reopen-draft");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/mandate/draft/reopen", { method: "POST" });
      setDemo(state);
      setMandateOpen(true);
      setNotice(`Previous mandate revoked without payment. Draft v${state.marketplace.draft.revision} is editable.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function revokeMandate() {
    setAction("revoke");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/mandate/revoke", { method: "POST" });
      setDemo(state);
      setPurchaseId(null);
      setNotice("Mandate revoked on chain. Every later authorization must now fail.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function amendPriceCap() {
    const next = draftForm.maxUnitPrice;
    setAction("price-cap");
    setNotice("");
    try {
      const state = await demoRequest("/api/demo/mandate/price-cap", {
        method: "POST",
        body: JSON.stringify({ maxUnitPrice: next }),
      });
      setDemo(state);
      setNotice(`Unit cap lowered to US$${next}. Credentials issued under the old terms are now invalid.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function validateAndCapture() {
    const activePurchaseId = demo?.marketplace?.selection?.purchaseId ?? purchaseId;
    if (!activePurchaseId) return;
    setAction("settle");
    setNotice("");
    try {
      const verificationResult = await demoRequest(`/api/demo/merchant/verify/${activePurchaseId}`);
      if (!verificationResult.verified) {
        const failed = Object.entries(verificationResult.checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name.replace(/([A-Z])/g, " $1").toLowerCase());
        setNotice(`Merchant verification failed (${failed.join(", ")}). Payment was not captured.`);
        return;
      }
      const result = await demoRequest(`/api/demo/merchant/capture/${activePurchaseId}`, { method: "POST" });
      setDemo(result.state);
      const selected = result.state.marketplace.selection.selected;
      setNotice(`Validated and paid. US$${selected.amount} moved to ${selected.merchant}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  const balances = demo?.balances || { buyer: "—", merchant: "—", alternateMerchant: "—" };
  const selection = demo?.marketplace?.selection;
  const agent = demo?.marketplace?.agent;
  const marketSearch = demo?.marketplace?.marketSearch;
  const report = demo?.marketplace?.lastReport;
  const draftReady = draft?.status === "ready";
  const draftReviewed = draft?.status === "reviewed";
  const draftSigned = draft?.status === "signed";
  const hasKycPayment = Boolean(demo?.kyc?.captureReady);
  const isAuthorized = selection?.status === "Authorized";
  const isCaptured = selection?.status === "Settled";
  const selectedMerchant = selection?.merchant;
  const currentProduct = demo?.marketplace?.catalog?.find((product) => product.id === draft?.productId);
  const busy = action !== null;

  const mandateStage = !draft
    ? "No draft yet"
    : draft.status === "needs_input"
      ? "Waiting on your answer"
      : draft.status === "needs_revision"
        ? "No safe match"
        : draft.status === "agent_error"
          ? "Agent unavailable"
          : draftSigned
            ? `Signed · mandate #${draft.signing?.mandateId ?? "?"}`
            : draftReviewed
              ? `Confirmed · v${draft.revision}`
              : `Draft v${draft.revision}`;

  const drawerAvailable = Boolean(draft) && draft.status !== "needs_input";

  return (
    <section className="workspace">
      {/* ---------------------------------------------------- chat, left half */}
      <section className="chat-pane">
        <header className="chat-pane-head">
          <div>
            <strong>chk! Buyer</strong>
            <span>{agent?.mode ?? "offline"}{agent?.model ? ` · ${agent.model}` : ""}</span>
          </div>
          <button className="ghost-button" onClick={startDemo} disabled={busy}>
            <RefreshCw size={14} /> {action === "start" ? "Starting…" : demo ? "Reset" : "Start"}
          </button>
        </header>

        <div className="chat-scroll" ref={scrollerRef}>
          {!demo && (
            <div className="chat-empty">
              <Bot size={22} />
              <p>Start the demo to create the buyer and seller wallets on a local chain.</p>
              <button className="primary-button" onClick={startDemo} disabled={busy}>Start live wallets</button>
            </div>
          )}

          {demo && !hasKycPayment && (
            <div className="chat-kyc">
              <p>Introduce the buyer for mock KYC. This enrolls an opaque payment token — no card number, no money moved.</p>
              <div className="kyc-fields">
                <input value={buyer.name} onChange={(e) => setBuyer((c) => ({ ...c, name: e.target.value }))} placeholder="Buyer name" />
                <input value={buyer.email} onChange={(e) => setBuyer((c) => ({ ...c, email: e.target.value }))} placeholder="Business email" />
                <input value={buyer.company} onChange={(e) => setBuyer((c) => ({ ...c, company: e.target.value }))} placeholder="Company" />
              </div>
              <button className="primary-button" onClick={completeKycLogin} disabled={busy}>
                <ShieldCheck size={15} /> {action === "kyc" ? "Verifying…" : "Verify buyer"}
              </button>
            </div>
          )}

          {hasKycPayment && chatMessages.map((message, index) => (
            <article className={`bubble ${message.role}`} key={`${message.role}-${index}`}>
              <span className="bubble-who">{message.role === "user" ? demo?.buyer?.name ?? "You" : "chk! Buyer"}</span>
              <p>{message.content}</p>
            </article>
          ))}

          {action === "intent" && (
            <article className="bubble assistant pending">
              <span className="bubble-who">chk! Buyer</span>
              <p><i>thinking…</i></p>
            </article>
          )}

          {hasKycPayment && draft?.status === "needs_input" && (
            <div className="chat-inline-note asking">
              <strong>Waiting on you</strong>
              <ul>{(draft.questions ?? []).map((q) => <li key={q.field}>{q.question}</li>)}</ul>
              <small>Read as a <b>{draft.commitment}</b> request. No cap was guessed — nothing exists yet.</small>
            </div>
          )}

          {hasKycPayment && draft?.status === "needs_revision" && (
            <div className="chat-inline-note">
              <strong>No safe match</strong>
              <p>{draft.recommendation}</p>
            </div>
          )}

          {hasKycPayment && draft?.status === "agent_error" && (
            <div className="chat-inline-note error">
              <strong>The agent could not run</strong>
              <p>{draft.recommendation}</p>
              <small>{draft.agentError}</small>
            </div>
          )}
        </div>

        {/* ------------------------------------ mandate drawer, over the chat */}
        {drawerAvailable && (
          <div className={`mandate-drawer ${mandateOpen ? "open" : ""}`}>
            <button className="drawer-handle" onClick={() => setMandateOpen((open) => !open)}>
              <FileSignature size={15} />
              <span>{mandateStage}</span>
              <em>{draft.quantity} × {draft.product} · US${draft.budget}</em>
              <ChevronDown size={16} className="drawer-chevron" />
            </button>

            {mandateOpen && (
              <div className="drawer-body">
                {draftReady && (
                  <form className="drawer-form" onSubmit={applyDraftEdits}>
                    <p className="drawer-lead">
                      Editable. Not spend authority.
                      {draft.resolvedBy === "substitution" && " Matched by equivalence, not an exact catalog name."}
                    </p>
                    {draft.budgetSource?.startsWith("agent suggestion") && (
                      <p className="drawer-warning">You did not state a cap — this is the agent's suggestion from live quotes, not a limit you authorised.</p>
                    )}
                    <div className="drawer-fields">
                      <label><span>Product</span>
                        <select value={draftForm.productId} onChange={(e) => setDraftForm((c) => ({ ...c, productId: e.target.value }))}>
                          {demo.marketplace.catalog.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                      <label><span>Quantity</span>
                        <input type="number" min="1" max="20" value={draftForm.quantity} onChange={(e) => setDraftForm((c) => ({ ...c, quantity: e.target.value }))} />
                      </label>
                      <label><span>Max unit price</span>
                        <input inputMode="decimal" value={draftForm.maxUnitPrice} onChange={(e) => setDraftForm((c) => ({ ...c, maxUnitPrice: e.target.value }))} />
                      </label>
                      <label><span>Total cap</span>
                        <input inputMode="decimal" value={draftForm.budget} onChange={(e) => setDraftForm((c) => ({ ...c, budget: e.target.value }))} />
                      </label>
                    </div>
                    <div className="drawer-policy">
                      Approved sellers: <b>{draft.approvedSellers?.join(" · ")}</b>
                    </div>
                    <div className="drawer-actions">
                      <button className="secondary-button" type="submit" disabled={busy}>
                        <RefreshCw size={14} /> {action === "edit-draft" ? "Applying…" : "Apply edits"}
                      </button>
                      <button className="primary-button" type="button" onClick={confirmDraft} disabled={busy}>
                        <CheckCircle2 size={14} /> {action === "confirm-draft" ? "Confirming…" : "Confirm terms"}
                      </button>
                    </div>
                  </form>
                )}

                {draftReviewed && (
                  <div className="drawer-review">
                    <p className="drawer-lead">Final review. This exact policy goes to the chain.</p>
                    <MandateTerms draft={draft} />
                    <div className="drawer-actions">
                      <button className="secondary-button" onClick={reopenDraft} disabled={busy}>Back to editing</button>
                      <button className="primary-button" onClick={createMandate} disabled={busy}>
                        <WalletCards size={14} /> {action === "mandate" ? "Signing…" : "Sign mandate"}
                      </button>
                    </div>
                  </div>
                )}

                {draftSigned && (
                  <div className="drawer-signed">
                    <p className="drawer-lead">
                      Signed in block {draft.signing?.blockNumber}. The agent may search only within these limits.
                    </p>
                    <MandateTerms draft={draft} />
                    <div className="drawer-live-controls">
                      <span>Live controls</span>
                      <div>
                        <input inputMode="decimal" value={draftForm.maxUnitPrice}
                          onChange={(e) => setDraftForm((c) => ({ ...c, maxUnitPrice: e.target.value }))}
                          aria-label="New unit cap" />
                        <button className="secondary-button" onClick={amendPriceCap} disabled={busy}>
                          {action === "price-cap" ? "Amending…" : "Lower cap"}
                        </button>
                        <button className="danger-button" onClick={revokeMandate} disabled={busy}>
                          {action === "revoke" ? "Revoking…" : "Revoke mandate"}
                        </button>
                      </div>
                      <small>Both take effect on chain immediately and invalidate unused credentials.</small>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <form className="chat-composer" onSubmit={submitIntent}>
          <textarea
            rows="1"
            value={intentMessage}
            onChange={(e) => setIntentMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitIntent(e); }
            }}
            placeholder={hasKycPayment ? "Tell the agent what you need…" : "Verify the buyer first"}
            aria-label="Message the purchasing agent"
            disabled={!hasKycPayment || busy}
          />
          <button type="submit" disabled={!hasKycPayment || busy || !intentMessage.trim()} aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </section>

      {/* --------------------------------------------- marketplace, right half */}
      <section className="market-pane">
        <div className="market-wallets">
          <article className="wallet-card buyer">
            <div className="wallet-head"><Building2 size={14} /> BUYER <i>{demo ? "LIVE" : "OFFLINE"}</i></div>
            <strong>US${balances.buyer}</strong>
            <span>{demo?.buyer?.name || "No buyer yet"}</span>
            <div className={`wallet-flag ${hasKycPayment ? "ready" : ""}`}>
              <ShieldCheck size={12} /> {hasKycPayment ? "KYC token ready" : "KYC pending"}
            </div>
          </article>
          {[{ name: "OfficeCore", balance: balances.merchant }, { name: "SupplyHub", balance: balances.alternateMerchant }].map((seller) => {
            const quote = currentProduct?.offers.find((o) => o.merchant === seller.name);
            return (
              <article className={`wallet-card seller ${seller.name === selectedMerchant ? "selected" : ""}`} key={seller.name}>
                <div className="wallet-head"><Store size={14} /> {seller.name}
                  {seller.name === selectedMerchant && <i>{isCaptured ? "PAID" : "CHOSEN"}</i>}
                </div>
                <strong>US${seller.balance}</strong>
                <span>{quote ? `${currentProduct.name} · US$${quote.unitPrice}` : "Awaiting a request"}</span>
              </article>
            );
          })}
        </div>

        <div className="market-actions">
          {draftSigned && !selection && marketSearch?.status !== "no_eligible_option" && (
            <button className="primary-button wide" onClick={compareAndAuthorize} disabled={busy}>
              <Bot size={15} /> {action === "compare" ? "Searching market…" : "Run agent market search"}
            </button>
          )}
          {draftSigned && marketSearch?.status === "no_eligible_option" && (
            <div className="market-blocked">
              <p>No seller met the signed limits. Nothing was authorized and no money moved.</p>
              <button className="secondary-button" onClick={reopenDraft} disabled={busy}>
                <RefreshCw size={14} /> {action === "reopen-draft" ? "Reopening…" : "Revise mandate"}
              </button>
            </div>
          )}
          {isAuthorized && (
            <button className="primary-button wide" onClick={validateAndCapture} disabled={busy}>
              <WalletCards size={15} /> {action === "settle" ? "Validating…" : `Validate & pay US$${selection.selected.amount}`}
            </button>
          )}
          {!draftSigned && !isAuthorized && (
            <p className="market-hint">
              {hasKycPayment ? "Sign a mandate in the chat panel before the agent can search." : "Complete KYC to begin."}
            </p>
          )}
        </div>

        <div className="market-catalog">
          <div className="market-catalog-head">
            <span><ClipboardList size={14} /> SELLER CATALOG</span>
            <em>{demo?.marketplace?.catalog?.length || 0} products</em>
          </div>
          {!demo ? (
            <p className="market-hint">Start the demo to load both catalogs.</p>
          ) : (
            <div className="catalog-rows">
              <div className="catalog-row head"><span>PRODUCT</span><span>OFFICECORE</span><span>SUPPLYHUB</span><span>AGENT</span></div>
              {demo.marketplace.catalog.map((product) => {
                const office = product.offers.find((o) => o.merchant === "OfficeCore");
                const supply = product.offers.find((o) => o.merchant === "SupplyHub");
                const lowest = Number(office.unitPrice) <= Number(supply.unitPrice) ? "OfficeCore" : "SupplyHub";
                const requested = product.id === draft?.productId;
                return (
                  <div className={`catalog-row ${requested ? "requested" : ""}`} key={product.id}>
                    <span className="catalog-name">{product.name}</span>
                    <CatalogOffer offer={office} lowest={lowest === "OfficeCore"} selected={requested && selectedMerchant === "OfficeCore"} />
                    <CatalogOffer offer={supply} lowest={lowest === "SupplyHub"} selected={requested && selectedMerchant === "SupplyHub"} />
                    <span className="catalog-state">
                      {requested
                        ? selection
                          ? <><CheckCircle2 size={12} /> {selection.merchant}</>
                          : draftSigned
                            ? marketSearch?.status === "no_eligible_option" ? <><Clock3 size={12} /> rejected</> : <><Clock3 size={12} /> signed</>
                            : <><Clock3 size={12} /> drafted</>
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {report && <DecisionReport report={report} />}

        <p className="market-notice"><span>{demo ? "● LIVE" : "○ READY"}</span>{notice}</p>
      </section>
    </section>
  );
}

function MandateTerms({ draft }) {
  return (
    <dl className="mandate-terms">
      <div><dt>What</dt><dd>{draft.quantity} × {draft.product}</dd></div>
      <div><dt>Per unit</dt><dd>US${draft.maxUnitPrice}</dd></div>
      <div><dt>Total cap</dt><dd>US${draft.budget}</dd></div>
      <div><dt>Sellers</dt><dd>{draft.approvedSellers?.join(", ")}</dd></div>
    </dl>
  );
}

function DecisionReport({ report }) {
  const offers = report.decision?.offers ?? [];
  const settlement = report.settlement;
  const status = report.status === "settled" ? "SETTLED" : report.status === "not_executed" ? "NOT EXECUTED" : "AWAITING CAPTURE";

  return (
    <section className={`decision-report ${report.status}`}>
      <div className="decision-report-heading">
        <div><span className="simple-window-label"><ClipboardList size={14} /> DECISION & TRANSACTION REPORT</span><h2>{report.title}</h2><p>{report.summary}</p></div>
        <span>{status}</span>
      </div>
      <div className="report-grid">
        <article><small>MANDATE POLICY</small><strong>{report.draft?.quantity} × {report.draft?.product ?? "No product"}</strong><p>Up to US${report.draft?.unitPriceCap ?? "—"} per unit · US${report.draft?.totalBudget ?? "—"} total</p></article>
        <article><small>AGENT</small><strong>{report.agent?.mode ?? "Catalog decision"}</strong><p>{report.agent?.model ?? "Policy engine"}</p></article>
        <article><small>DECISION</small><strong>{report.decision?.selectedMerchant ?? "No seller selected"}</strong><p>{report.decision?.rationale}</p></article>
        <article><small>AUTHORIZATION</small><strong>{report.authorization ? "Merchant quote bound" : "None created"}</strong><p>{report.authorization ? "Seller verification required before settlement." : report.recommendation}</p></article>
      </div>
      {offers.length > 0 && (
        <div className="report-offers">
          <div className="report-offer-head"><span>SELLER</span><span>UNIT</span><span>TOTAL</span><span>DECISION</span></div>
          {offers.map((offer) => (
            <article key={offer.merchant} className={offer.merchant === report.decision?.selectedMerchant ? "chosen" : ""}>
              <strong>{offer.merchant}</strong><span>US${offer.unitPrice}</span><span>US${offer.amount}</span>
              <span>{offer.eligible ? "Eligible" : offer.rejectionReasons?.join(" ")}</span>
            </article>
          ))}
        </div>
      )}
      {report.verification && (
        <div className="report-verification">
          <strong>Merchant verification: {report.verification.verified ? "passed" : "failed"}</strong>
          <div>{Object.entries(report.verification.checks).map(([name, passed]) => (
            <span className={passed ? "pass" : "fail"} key={name}>{passed ? "✓" : "×"} {name.replace(/([A-Z])/g, " $1")}</span>
          ))}</div>
        </div>
      )}
      {settlement && (
        <div className="report-settlement">
          <div><span>SETTLEMENT · MOCK CHAIN</span><strong>US${settlement.amount} paid</strong></div>
          <div className="report-balance-movements">
            {Object.entries(settlement.balances).map(([wallet, movement]) => (
              <span key={wallet}><b>{wallet}</b><i>{movement.before} → {movement.after}</i><em>{movement.delta}</em></span>
            ))}
          </div>
        </div>
      )}
      <small className="report-disclaimer">Generated from the signed mandate, seller quotes, on-chain authorization, verification checks and mock-USD settlement. Never a real payment.</small>
    </section>
  );
}

function CatalogOffer({ offer, lowest, selected }) {
  return (
    <span className={`catalog-offer ${lowest ? "lowest" : ""} ${selected ? "selected" : ""}`}>
      US${offer.unitPrice}
    </span>
  );
}

export default App;
