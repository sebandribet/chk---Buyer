import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  CreditCard,
  History,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Store,
  Unplug,
  WalletCards,
} from "lucide-react";
import { mandateScenarios, toCanonicalMandate } from "../ui/mandates/mandateDisplayModels.ts";

const tabs = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "demo", label: "Live demo", icon: ShieldCheck },
  { id: "mandates", label: "Mandates", icon: ClipboardList },
  { id: "history", label: "History", icon: History },
  { id: "account", label: "Account", icon: WalletCards },
  { id: "whatsapp", label: "Alerts", icon: Bell },
];

const initialMessages = [
  {
    id: 1,
    role: "user",
    content: "I need to restock 20 rolls of 500-meter stretch film every 15 days. I don't want to pay more than $8,500 per roll.",
    time: "09:40",
  },
  {
    id: 2,
    role: "agent",
    content: "Got it. So that you, the agent and the suppliers all work from the same rules, I've prepared a standardized draft of the mandate.",
    time: "09:41",
  },
  {
    id: 3,
    role: "agent",
    kind: "draft",
    time: "09:41",
    draft: {
      version: 4,
      product: "Industrial stretch film",
      specification: "50 cm x 500 m · 23 microns",
      quantity: "Up to 20 rolls",
      frequency: "Every 15 days",
      unitLimit: "$8,500",
      totalLimit: "$500,000",
      expiration: "Sep 30, 2026",
      paymentMethod: "Company card · •••• 4242",
    },
  },
];

const initialMandateViews = [
  {
    id: "MD-001",
    product: "Industrial stretch film",
    description: "50 cm x 500 m roll, 23 microns",
    status: "Active",
    frequency: "Every 15 days",
    quantity: "Up to 20 rolls",
    unitPrice: 8500,
    monthlyBudget: 500000,
    suppliers: "PackAR and Distribuidora Centro",
    expires: "Sep 30, 2026",
    version: 3,
    owner: "0x71A4...92F1",
    agent: "chk! Buyer",
    agentAddress: "0xA91C...4E20",
    paymentDelegate: "VirtualCardAdapter",
    validAfter: "Aug 1, 2026",
    maxPerOperation: 170000,
    spent: 291800,
    reserved: 0,
    allowedActions: ["Search offers", "Choose supplier", "Buy automatically"],
    policyHash: "0x9f8a7c4e...13bd92a1",
    account: "ARS operating account · •••• 1842",
    accountBalance: 1108000,
    paymentMethod: "Single-use virtual card",
    currentSupplier: "Distribuidora Centro",
    previousSupplier: "PackAR",
    supplierReason: "12% cheaper and delivers within 48 hours.",
    lastRun: "Aug 29, 2026 · 10:24",
    nextRun: "Sep 12, 2026 · 08:00",
    lastCard: "•••• 4821",
  },
  {
    id: "MD-002",
    product: "Nitrile gloves",
    description: "Box of 100, size M, powder-free",
    status: "Active",
    frequency: "Monthly",
    quantity: "Up to 12 boxes",
    unitPrice: 12600,
    monthlyBudget: 151200,
    suppliers: "Proveeduría Norte",
    expires: "Oct 15, 2026",
    version: 2,
    owner: "0x71A4...92F1",
    agent: "chk! Buyer",
    agentAddress: "0xB281...9C15",
    paymentDelegate: "VirtualCardAdapter",
    validAfter: "Jul 15, 2026",
    maxPerOperation: 151200,
    spent: 98400,
    reserved: 0,
    allowedActions: ["Search offers", "Choose supplier", "Buy automatically"],
    policyHash: "0x4b18d620...8f31b781",
    account: "ARS operating account · •••• 1842",
    accountBalance: 1108000,
    paymentMethod: "Single-use virtual card",
    currentSupplier: "Proveeduría Norte",
    previousSupplier: "Proveeduría Norte",
    supplierReason: "Kept the best balance of price and availability.",
    lastRun: "Aug 22, 2026 · 09:11",
    nextRun: "Sep 3, 2026 · 08:00",
    lastCard: "•••• 1906",
  },
  {
    id: "MD-003",
    product: "ISO 46 hydraulic oil",
    description: "20-liter drum, DIN 51524 standard",
    status: "Draft",
    frequency: "Every 60 days",
    quantity: "Up to 4 drums",
    unitPrice: 92000,
    monthlyBudget: 368000,
    suppliers: "To be defined",
    expires: "Nov 30, 2026",
    version: 1,
    owner: "0x71A4...92F1",
    agent: "chk! Buyer",
    agentAddress: "0xA91C...4E20",
    paymentDelegate: "VirtualCardAdapter",
    validAfter: "Pending activation",
    maxPerOperation: 368000,
    spent: 0,
    reserved: 0,
    allowedActions: ["Search offers", "Choose supplier"],
    policyHash: "0x7c941d02...c4af7710",
    account: "ARS operating account · •••• 1842",
    accountBalance: 1108000,
    paymentMethod: "Single-use virtual card",
    currentSupplier: "Not selected",
    previousSupplier: "—",
    supplierReason: "No purchase has run yet.",
    lastRun: "Aug 28, 2026 · 16:42",
    nextRun: "Not scheduled",
    lastCard: "—",
  },
];

const canonicalFixtureByMandateId = {
  "MD-001": mandateScenarios[1].mandate,
  "MD-002": mandateScenarios[3].mandate,
  "MD-003": mandateScenarios[0].mandate,
};

const initialMandates = initialMandateViews.map((mandate) => ({
  ...mandate,
  canonical: toCanonicalMandate(canonicalFixtureByMandateId[mandate.id], mandate.owner),
}));

const purchases = [
  {
    id: "OC-2841",
    date: "Aug 29, 2026",
    product: "Industrial stretch film",
    supplier: "Distribuidora Centro",
    quantity: "20 rolls",
    total: 142000,
    mandate: "MD-001 · v3",
    card: "•••• 4821",
    transaction: "0x81c2...4f90",
    status: "Purchased",
  },
  {
    id: "OC-2827",
    date: "Aug 22, 2026",
    product: "Nitrile gloves",
    supplier: "Proveeduría Norte",
    quantity: "8 boxes",
    total: 98400,
    mandate: "MD-002 · v2",
    card: "•••• 1906",
    transaction: "0x2d19...a782",
    status: "Purchased",
  },
  {
    id: "OC-2788",
    date: "Aug 14, 2026",
    product: "Industrial stretch film",
    supplier: "PackAR",
    quantity: "20 rolls",
    total: 149800,
    mandate: "MD-001 · v2",
    card: "•••• 7334",
    transaction: "0x749a...118c",
    status: "Purchased",
  },
];

const mandateActivity = {
  "MD-001": [
    { time: "10:24", title: "Purchase confirmed", detail: "Distribuidora Centro confirmed order OC-2841.", type: "success" },
    { time: "10:23", title: "Virtual card issued", detail: "Card •••• 4821 for $142,000, valid for a single use.", type: "card" },
    { time: "10:23", title: "Authorization recorded", detail: "Mock transaction confirmed on Polygon · Demo.", type: "chain" },
    { time: "10:22", title: "Funds withdrawn", detail: "$142,000 withdrawn from the operating account.", type: "account" },
    { time: "10:22", title: "Supplier switched", detail: "The agent chose Distribuidora Centro over PackAR.", type: "supplier" },
    { time: "10:21", title: "8 offers found", detail: "Price, availability and delivery were compared.", type: "search" },
    { time: "10:20", title: "Search started", detail: "Run scheduled by cron.", type: "search" },
  ],
  "MD-002": [
    { time: "09:11", title: "Purchase confirmed", detail: "Proveeduría Norte confirmed order OC-2827.", type: "success" },
    { time: "09:10", title: "Virtual card issued", detail: "Card •••• 1906 for $98,400.", type: "card" },
    { time: "09:08", title: "Search completed", detail: "5 valid offers were found.", type: "search" },
  ],
  "MD-003": [
    { time: "16:42", title: "No valid offers", detail: "All 4 options found exceeded the maximum price.", type: "search" },
    { time: "16:40", title: "Search started", detail: "Test run of the draft.", type: "search" },
  ],
};

const mandateOffers = {
  "MD-001": [
    { supplier: "Distribuidora Centro", unitPrice: 7100, delivery: "48 h", score: 94, result: "Chosen" },
    { supplier: "PackAR", unitPrice: 8000, delivery: "24 h", score: 88, result: "Ruled out" },
    { supplier: "FlexPack Córdoba", unitPrice: 7480, delivery: "72 h", score: 84, result: "Ruled out" },
  ],
  "MD-002": [
    { supplier: "Proveeduría Norte", unitPrice: 12300, delivery: "3 days", score: 92, result: "Chosen" },
    { supplier: "Seguridad Industrial SA", unitPrice: 12550, delivery: "5 days", score: 81, result: "Ruled out" },
  ],
  "MD-003": [
    { supplier: "Hidráulica Federal", unitPrice: 101500, delivery: "4 days", score: 68, result: "Over limit" },
  ],
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function App() {
  const [activeTab, setActiveTab] = useState("chat");
  const [messages, setMessages] = useState(initialMessages);
  const [draftApproved, setDraftApproved] = useState(false);
  const [mandates, setMandates] = useState(initialMandates);
  const [selectedMandateId, setSelectedMandateId] = useState(null);

  function navigateToTab(tab) {
    setActiveTab(tab);
    setSelectedMandateId(null);
  }

  function openMandate(mandateId) {
    setActiveTab("mandates");
    setSelectedMandateId(mandateId);
  }

  return (
    <div className="app">
      <Header activeTab={activeTab} onTabChange={navigateToTab} />
      <main className={`main ${activeTab === "chat" ? "chat-main" : ""}`}>
        {activeTab === "chat" && (
          <ChatPage
            messages={messages}
            onMessagesChange={setMessages}
            draftApproved={draftApproved}
            onDraftApproved={() => {
              setDraftApproved(true);
              setMandates((current) => current.map((item) => item.id === "MD-001" ? { ...item, version: 4 } : item));
            }}
            mandates={mandates}
            onOpenMandates={() => navigateToTab("mandates")}
            onOpenMandate={openMandate}
          />
        )}
        {activeTab === "demo" && <LiveDemoPage />}
        {activeTab === "mandates" && (
          selectedMandateId ? (
            <MandateDetailPage
              mandate={mandates.find((item) => item.id === selectedMandateId)}
              onBack={() => setSelectedMandateId(null)}
              onRevoke={(mandateId) => setMandates((current) => current.map((item) => item.id === mandateId ? {
                ...item,
                status: "Revoked",
                canonical: { ...item.canonical, status: "Revoked" },
              } : item))}
            />
          ) : (
            <MandatesPage
              onCreate={() => navigateToTab("chat")}
              onSelect={openMandate}
              mandates={mandates}
            />
          )
        )}
        {activeTab === "history" && <HistoryPage />}
        {activeTab === "account" && <AccountPage />}
        {activeTab === "whatsapp" && <WhatsappPage />}
      </main>
    </div>
  );
}

function Header({ activeTab, onTabChange }) {
  return (
    <header className="header">
      <div className="header-inner">
        <button className="brand" onClick={() => onTabChange("chat")}>
          <span className="brand-name">chk! <span>Buyer</span></span>
        </button>
        <nav className="tabs" aria-label="Main navigation">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => onTabChange(tab.id)}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function ChatPage({ messages, onMessagesChange, draftApproved, onDraftApproved, mandates, onOpenMandates, onOpenMandate }) {
  const [message, setMessage] = useState("");

  function sendMessage(event) {
    event.preventDefault();
    const content = message.trim();
    if (!content) return;
    onMessagesChange((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content, time: "Now" },
    ]);
    setMessage("");
  }

  function approveDraft() {
    if (draftApproved) return;
    onDraftApproved();
    onMessagesChange((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "agent",
        content: "Mandate v4 signed and recorded on Polygon · Demo. I can start with chk! it out now.",
        time: "Now",
      },
    ]);
  }

  return (
    <section className="page chat-page">
      <div className="chat-layout">
        <aside className="mandates-overview">
          <div className="overview-header">
            <div>
              <span>ACTIVE MANDATES</span>
              <h2>Your products</h2>
            </div>
            <span className="overview-count">{mandates.filter((item) => item.status === "Active").length}</span>
          </div>

          <div className="overview-list">
            {mandates.filter((item) => item.status === "Active").map((mandate) => (
              <button
                type="button"
                className="overview-card"
                key={mandate.id}
                onClick={() => onOpenMandate(mandate.id)}
              >
                <div className="overview-card-top">
                  <span>{mandate.id}</span>
                  <Status value={mandate.status} />
                </div>
                <h3>{mandate.product}</h3>
                <p>{mandate.description}</p>
                <dl>
                  <div><dt>Restocking</dt><dd>{mandate.frequency}</dd></div>
                  <div><dt>Unit cap</dt><dd>{currency.format(mandate.unitPrice)}</dd></div>
                </dl>
              </button>
            ))}
          </div>

          <button className="overview-link" onClick={onOpenMandates}>
            See all mandates <ChevronRight size={16} />
          </button>
        </aside>

        <div className="chat-shell">
          <div className="chat-topbar">
            <div><strong>chk! Buyer</strong><span>Your purchasing agent</span></div>
          </div>
          <div className="conversation">
            <div className="message-list">
              <div className="conversation-date">TODAY</div>
              {messages.map((item) => (
                <div className={`chat-message ${item.role}`} key={item.id}>
                  <div>
                    {item.kind === "draft" ? (
                      <MandateDraftCard
                        draft={item.draft}
                        approved={draftApproved}
                        onApprove={approveDraft}
                        onEdit={() => setMessage("I'd like to change: ")}
                      />
                    ) : <p>{item.content}</p>}
                    <span>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              rows="2"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(event);
                }
              }}
              placeholder="Write a message..."
              aria-label="Message for the agent"
            />
            <button type="submit" disabled={!message.trim()} aria-label="Send message"><Send size={17} /></button>
          </form>
        </div>
      </div>
    </section>
  );
}

function MandateDraftCard({ draft, approved, onApprove, onEdit }) {
  return (
    <article className="draft-card">
      <div className="draft-card-header">
        <div><span>MANDATE DRAFT</span><strong>Draft v{draft.version}</strong></div>
        <em>{approved ? "Signed" : "Unsigned"}</em>
      </div>
      <div className="draft-product"><strong>{draft.product}</strong><span>{draft.specification}</span></div>
      <dl>
        <DataRow label="Quantity" value={draft.quantity} />
        <DataRow label="Frequency" value={draft.frequency} />
        <DataRow label="Max per unit" value={draft.unitLimit} />
        <DataRow label="Total limit" value={draft.totalLimit} />
        <DataRow label="Valid until" value={draft.expiration} />
        <DataRow label="Method" value={draft.paymentMethod} />
      </dl>
      <div className="draft-actions">
        <button onClick={onEdit} disabled={approved}>Keep editing</button>
        <button className="approve-draft" onClick={onApprove} disabled={approved}>
          {approved ? <><Check size={14} />Mandate signed</> : <>Review and sign <ArrowRight size={14} /></>}
        </button>
      </div>
    </article>
  );
}

function MandatesPage({ mandates, onCreate, onSelect }) {
  return (
    <section className="page">
      <div className="page-toolbar">
        <div className="list-summary"><span>{mandates.length} mandates</span><span>{mandates.filter((item) => item.status === "Active").length} active</span></div>
        <button className="primary-button" onClick={onCreate}><Plus size={17} />New mandate</button>
      </div>
      <div className="mandate-list">
        {mandates.map((mandate) => (
            <article className="mandate-card" key={mandate.id}>
              <button className="mandate-main" onClick={() => onSelect(mandate.id)}>
                <div className="mandate-product">
                  <span>{mandate.id}</span>
                  <strong>{mandate.product}</strong>
                  <small>{mandate.description}</small>
                </div>
                <div className="mandate-field"><span>Restocking</span><strong>{mandate.frequency}</strong></div>
                <div className="mandate-field"><span>Max price</span><strong>{currency.format(mandate.unitPrice)}</strong></div>
                <Status value={mandate.status} />
                <ChevronRight className="mandate-chevron" size={18} />
              </button>
            </article>
        ))}
      </div>
    </section>
  );
}

const mandateSections = [
  { id: "detail", label: "Details" },
  { id: "activity", label: "Activity" },
  { id: "offers", label: "Offers" },
  { id: "purchases", label: "Purchases" },
];

function MandateDetailPage({ mandate, onBack, onRevoke }) {
  const [section, setSection] = useState("detail");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const activity = mandateActivity[mandate.id] || [];
  const offers = mandateOffers[mandate.id] || [];
  const relatedPurchases = purchases.filter((purchase) => purchase.mandate.startsWith(mandate.id));
  const available = Math.max(mandate.monthlyBudget - mandate.spent - mandate.reserved, 0);

  return (
    <section className="page mandate-detail-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to mandates</button>

      <div className="detail-hero">
        <div>
          <div className="detail-identity"><span>{mandate.id}</span><Status value={mandate.status} /><em>DEMO</em></div>
          <h1>{mandate.product}</h1>
          <p>{mandate.description}</p>
        </div>
        <div className="detail-hero-actions">
          <div className="detail-hero-meta">
            <span>Revision</span>
            <strong>v{mandate.version}</strong>
          </div>
          {mandate.status === "Active" && (
            <button className="revoke-button" onClick={() => setConfirmingRevoke(true)}>Revoke mandate</button>
          )}
        </div>
      </div>

      {confirmingRevoke && (
        <div className="revoke-confirmation">
          <div><strong>Revoke this mandate now?</strong><p>Future authorizations will fail. Purchases already confirmed are not cancelled.</p></div>
          <button onClick={() => setConfirmingRevoke(false)}>Back</button>
          <button onClick={() => { onRevoke(mandate.id); setConfirmingRevoke(false); }}>Confirm revocation</button>
        </div>
      )}

      <nav className="mandate-subnav" aria-label="Mandate sections">
        {mandateSections.map((item) => (
          <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
            {item.label}
            {item.id === "offers" && <span>{offers.length}</span>}
            {item.id === "purchases" && <span>{relatedPurchases.length}</span>}
          </button>
        ))}
      </nav>

      {section === "detail" && (
        <MandateSummary mandate={mandate} available={available} activity={activity} purchases={relatedPurchases} />
      )}
      {section === "activity" && <MandateActivity activity={activity} />}
      {section === "offers" && <MandateOffers offers={offers} mandate={mandate} />}
      {section === "purchases" && <MandatePurchases purchases={relatedPurchases} />}
    </section>
  );
}

function MandateSummary({ mandate, available, activity, purchases: relatedPurchases }) {
  const lastPurchase = relatedPurchases[0];
  const executionSteps = lastPurchase ? [
    { label: "chk! it out · offer chosen", detail: `${lastPurchase.quantity} from ${lastPurchase.supplier}` },
    { label: "write the chk! · funds withdrawn", detail: `${currency.format(lastPurchase.total)} → chk! fund` },
    { label: "Authorization recorded", detail: `Polygon · Demo · ${lastPurchase.transaction}` },
    { label: "Virtual card issued", detail: `${lastPurchase.card} · single use` },
    { label: "Mandate validated by the merchant", detail: "Active · agent and amount authorized" },
    { label: "Purchase confirmed", detail: lastPurchase.id },
  ] : [];

  return (
    <div className="mandate-section-content">
      <div className="mandate-metrics">
        <Metric label="Available" value={currency.format(available)} />
        <Metric label="Spent" value={currency.format(mandate.spent)} />
        <Metric label="Reserved" value={currency.format(mandate.reserved)} />
        <Metric label="Max per purchase" value={currency.format(mandate.maxPerOperation)} />
      </div>

      <div className="mandate-detail-grid">
        <article className="detail-panel">
          <div className="panel-heading"><ClipboardList size={17} /><h2>Mandate rules</h2></div>
          <dl className="detail-data-list">
            <DataRow label="Max quantity" value={mandate.quantity} />
            <DataRow label="Restocking" value={mandate.frequency} />
            <DataRow label="Max unit price" value={currency.format(mandate.unitPrice)} />
            <DataRow label="Total budget" value={currency.format(mandate.monthlyBudget)} />
            <DataRow label="Valid" value={`${mandate.validAfter} — ${mandate.expires}`} />
            <DataRow label="Authorized agent" value={`${mandate.agent} · ${mandate.agentAddress}`} />
          </dl>
          <div className="allowed-actions">
            <span>Allowed actions</span>
            <div>{mandate.allowedActions.map((action) => <em key={action}>{action}</em>)}</div>
          </div>
        </article>

        <article className="detail-panel supplier-panel">
          <div className="panel-heading"><Store size={17} /><h2>Chosen supplier</h2></div>
          <strong className="selected-supplier">{mandate.currentSupplier}</strong>
          <p>{mandate.supplierReason}</p>
          <dl className="detail-data-list compact">
            <DataRow label="Previous supplier" value={mandate.previousSupplier} />
            <DataRow label="Last search" value={mandate.lastRun} />
            <DataRow label="Next search" value={mandate.nextRun} />
          </dl>
        </article>

        <article className="detail-panel payment-panel">
          <div className="panel-heading"><WalletCards size={17} /><h2>Account and method</h2></div>
          <dl className="detail-data-list">
            <DataRow label="Account" value={mandate.account} />
            <DataRow label="Current balance" value={currency.format(mandate.accountBalance)} />
            <DataRow label="Method" value={mandate.paymentMethod} />
            <DataRow label="Last card" value={mandate.lastCard} />
            <DataRow label="Payment delegate" value={mandate.paymentDelegate} />
          </dl>
        </article>

        <article className="detail-panel execution-panel">
          <div className="panel-heading"><CreditCard size={17} /><h2>Last purchase</h2></div>
          {executionSteps.length > 0 ? (
            <div className="execution-steps">
              {executionSteps.map((step) => (
                <div key={step.label}><i><Check size={12} /></i><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>
              ))}
            </div>
          ) : <p className="empty-copy">This mandate has not made any purchases yet.</p>}
        </article>
      </div>

      <article className="detail-panel recent-activity-panel">
        <div className="panel-heading"><Clock3 size={17} /><h2>Recent activity</h2></div>
        <div className="recent-activity-list">
          {activity.slice(0, 4).map((event) => (
            <div key={`${event.time}-${event.title}`}><span>{event.time}</span><strong>{event.title}</strong><p>{event.detail}</p></div>
          ))}
        </div>
      </article>

      {lastPurchase && (
        <article className="merchant-verification-panel">
          <div className="merchant-verification-copy">
            <span>PRESENTED TO THE MERCHANT · DEMO</span>
            <h2>{lastPurchase.supplier} accepted the purchase</h2>
            <p>The merchant verified the current authorization against MandateVault without accessing the full private policy.</p>
          </div>
          <div className="merchant-checks">
            <span><Check size={13} />Mandate active</span>
            <span><Check size={13} />Agent authorized</span>
            <span><Check size={13} />Amount within limit</span>
            <span><Check size={13} />Single-use authorization valid</span>
          </div>
        </article>
      )}

      <details className="technical-details">
        <summary><ShieldCheck size={16} />Simulated technical details</summary>
        <dl>
          <DataRow label="Owner" value={mandate.owner} />
          <DataRow label="Agent" value={mandate.agentAddress} />
          <DataRow label="Policy hash" value={mandate.canonical?.policyHash ?? mandate.policyHash} />
          <DataRow label="Contract" value="MandateVault · Polygon Demo" />
        </dl>
      </details>
    </div>
  );
}

function Metric({ label, value }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function DataRow({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function MandateActivity({ activity }) {
  const icons = { success: CheckCircle2, card: CreditCard, chain: ShieldCheck, account: WalletCards, supplier: Store, search: Clock3 };
  return (
    <div className="mandate-section-content narrow-content">
      <div className="full-activity-list">
        {activity.map((event) => {
          const Icon = icons[event.type] || Clock3;
          return (
            <article key={`${event.time}-${event.title}`}>
              <div className="activity-icon"><Icon size={16} /></div>
              <div><span>{event.time}</span><h3>{event.title}</h3><p>{event.detail}</p></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MandateOffers({ offers, mandate }) {
  return (
    <div className="mandate-section-content">
      <div className="offers-context">
        <span>Last search</span><strong>{mandate.lastRun}</strong><p>{offers.length} relevant offers found</p>
      </div>
      <div className="offers-table">
        <div className="offers-head"><span>Supplier</span><span>Unit price</span><span>Delivery</span><span>Score</span><span>Result</span></div>
        {offers.map((offer) => (
          <article key={offer.supplier} className={offer.result === "Chosen" ? "selected" : ""}>
            <div><strong>{offer.supplier}</strong>{offer.result === "Chosen" && <small>Chosen by the agent</small>}</div>
            <strong>{currency.format(offer.unitPrice)}</strong>
            <span>{offer.delivery}</span>
            <span>{offer.score}/100</span>
            <span className={`offer-result ${offer.result.toLowerCase().replaceAll(" ", "-")}`}>{offer.result}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function MandatePurchases({ purchases: relatedPurchases }) {
  return (
    <div className="mandate-section-content">
      <div className="history-list mandate-purchases-list">
        <div className="history-head">
          <span>Purchase</span><span>Supplier</span><span>Quantity</span><span>Total</span><span>Card</span>
        </div>
        {relatedPurchases.map((purchase) => (
          <article className="history-row" key={purchase.id}>
            <div><strong>{purchase.id}</strong><span>{purchase.date}</span></div>
            <div><strong>{purchase.supplier}</strong><span>{purchase.mandate}</span></div>
            <div><strong>{purchase.quantity}</strong></div>
            <div><strong>{currency.format(purchase.total)}</strong></div>
            <div><strong>{purchase.card}</strong><span>{purchase.status}</span></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function HistoryPage() {
  return (
    <section className="page">
      <div className="history-list">
        <div className="history-head">
          <span>Purchase</span><span>Product</span><span>Supplier</span><span>Total</span><span>Status</span>
        </div>
        {purchases.map((purchase) => (
          <article className="history-row" key={purchase.id}>
            <div><strong>{purchase.id}</strong><span>{purchase.date}</span></div>
            <div><strong>{purchase.product}</strong><span>{purchase.quantity} · {purchase.mandate}</span></div>
            <div><strong>{purchase.supplier}</strong></div>
            <div><strong>{currency.format(purchase.total)}</strong></div>
            <div><span className="purchase-status"><Check size={13} />Purchased</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AccountPage() {
  return (
    <section className="page account-page">
      <div className="account-grid">
        <article className="balance-card">
          <div className="account-card-heading"><Building2 size={18} /><span>SOURCE ACCOUNT</span></div>
          <p>Available balance</p>
          <strong>{currency.format(1108000)}</strong>
          <div className="account-number"><span>ARS operating account</span><em>•••• 1842</em></div>
        </article>

        <article className="account-panel">
          <div className="account-card-heading"><CreditCard size={18} /><span>PREFERRED METHOD</span></div>
          <div className="payment-method-mock">
            <span>Company card</span>
            <strong>•••• 4242</strong>
            <small>Used to fund chk! fund when the agent decides to buy.</small>
          </div>
          <button className="account-secondary-button">Change method</button>
        </article>

        <article className="account-panel fund-panel">
          <div className="account-card-heading"><WalletCards size={18} /><span>CHK! FUND</span></div>
          <div className="fund-stats">
            <div><span>In progress</span><strong>{currency.format(0)}</strong></div>
            <div><span>Executed this month</span><strong>{currency.format(240400)}</strong></div>
            <div><span>Refunds</span><strong>{currency.format(0)}</strong></div>
          </div>
          <p>Funds are withdrawn from your account when the agent decides to buy, and consumed when the virtual card is issued.</p>
        </article>

        <article className="account-panel card-policy-panel">
          <div className="account-card-heading"><ShieldCheck size={18} /><span>VIRTUAL CARDS</span></div>
          <dl className="detail-data-list">
            <DataRow label="Mode" value="Single use" />
            <DataRow label="Limit" value="Exact order amount" />
            <DataRow label="Valid" value="Until checkout completes" />
            <DataRow label="Payment delegate" value="VirtualCardAdapter" />
          </dl>
        </article>
      </div>

      <article className="money-flow-panel">
        <div className="account-card-heading"><ArrowRight size={18} /><span>ANATOMY OF A PURCHASE</span></div>
        <div className="money-flow">
          <div><i>1</i><span><strong>The agent decides</strong><small>The offer satisfies the mandate</small></span></div>
          <ArrowRight size={17} />
          <div><i>2</i><span><strong>Account → chk! fund</strong><small>The funds are withdrawn</small></span></div>
          <ArrowRight size={17} />
          <div><i>3</i><span><strong>Polygon</strong><small>Records the authorization</small></span></div>
          <ArrowRight size={17} />
          <div><i>4</i><span><strong>Virtual card</strong><small>Pays the supplier</small></span></div>
        </div>
      </article>

      <article className="account-movements">
        <div className="account-card-heading"><History size={18} /><span>RECENT MOVEMENTS</span></div>
        <div className="movement-row">
          <div><strong>Purchase OC-2841</strong><span>Stretch film · Distribuidora Centro</span></div>
          <div><strong>-{currency.format(142000)}</strong><span>Aug 29 · 10:22</span></div>
        </div>
        <div className="movement-row">
          <div><strong>Purchase OC-2827</strong><span>Nitrile gloves · Proveeduría Norte</span></div>
          <div><strong>-{currency.format(98400)}</strong><span>Aug 22 · 09:09</span></div>
        </div>
      </article>
    </section>
  );
}

function WhatsappPage() {
  const [view, setView] = useState("inbox");
  const [connection, setConnection] = useState({ status: "loading", qr: null, user: null, error: null });
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let active = true;

    async function refreshStatus() {
      try {
        const response = await fetch("/api/whatsapp/status");
        const data = await response.json();
        if (active) setConnection(data);
      } catch {
        if (active) setConnection({ status: "error", error: "Could not reach the server" });
      }
    }

    refreshStatus();
    const interval = setInterval(refreshStatus, 1500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  async function runAction(name, url, options) {
    setAction(name);
    setNotice(null);
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The operation could not be completed");
      if (name === "test") setNotice("Test message sent to your own chat.");
      else setConnection(data);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  const status = connection.status;
  const phone = connection.user?.id?.split("@")[0] || "";

  return (
    <section className="page whatsapp-page">
      <nav className="notice-subnav" aria-label="Alerts and notifications">
        <button className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")}>Inbox <span>4</span></button>
        <button className={view === "preferences" ? "active" : ""} onClick={() => setView("preferences")}>Preferences</button>
        <button className={view === "whatsapp" ? "active" : ""} onClick={() => setView("whatsapp")}>WhatsApp</button>
      </nav>

      {view === "inbox" && <NotificationsInbox />}
      {view === "preferences" && <NotificationPreferences />}
      {view === "whatsapp" && <div className="whatsapp-card">
        <div className="whatsapp-copy">
          <div className="whatsapp-icon"><Smartphone size={23} /></div>
          <span className="setup-label">INTEGRATION</span>
          <h1>Alerts and notifications</h1>
          <p>Set up WhatsApp to get updates from chk! Buyer, your purchasing agent, in your own chat.</p>
          <ol>
            <li>Open WhatsApp on your phone.</li>
            <li>Go to <strong>Linked devices</strong>.</li>
            <li>Choose <strong>Link a device</strong> and scan the QR code.</li>
          </ol>
          <div className="baileys-note">This demo uses Baileys and stores the session on this server only.</div>
        </div>

        <div className="whatsapp-state">
          {(status === "loading" || status === "connecting" || status === "reconnecting") && (
            <div className="connection-panel">
              <RefreshCw className="spin" size={27} />
              <strong>{status === "reconnecting" ? "Reconnecting WhatsApp" : "Preparing connection"}</strong>
              <p>This may take a few seconds.</p>
            </div>
          )}

          {status === "disconnected" && (
            <div className="connection-panel">
              <div className="state-icon"><QrCode size={27} /></div>
              <strong>Ready to link</strong>
              <p>Generate a QR code to get started.</p>
              <button
                className="whatsapp-primary"
                disabled={action === "connect"}
                onClick={() => runAction("connect", "/api/whatsapp/connect", { method: "POST" })}
              >
                {action === "connect" ? "Generating..." : "Generate QR code"}
              </button>
            </div>
          )}

          {status === "qr" && connection.qr && (
            <div className="qr-panel">
              <span>Scan this code</span>
              <div className="qr-frame"><img src={connection.qr} alt="QR code to link WhatsApp" /></div>
              <p>The code refreshes automatically if it expires.</p>
            </div>
          )}

          {status === "connected" && (
            <div className="connection-panel connected">
              <div className="connected-icon"><CheckCircle2 size={30} /></div>
              <strong>WhatsApp connected</strong>
              <p>{connection.user?.name || "Linked account"}{phone && ` · +${phone}`}</p>
              <button
                className="whatsapp-primary"
                disabled={action === "test"}
                onClick={() => runAction("test", "/api/whatsapp/test", { method: "POST" })}
              >
                <Send size={15} /> {action === "test" ? "Sending..." : "Send test message"}
              </button>
              <button
                className="disconnect-button"
                disabled={action === "disconnect"}
                onClick={() => runAction("disconnect", "/api/whatsapp/session", { method: "DELETE" })}
              >
                <Unplug size={14} /> Unlink account
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="connection-panel error">
              <strong>We could not start WhatsApp</strong>
              <p>{connection.error}</p>
              <button className="whatsapp-primary" onClick={() => runAction("connect", "/api/whatsapp/connect", { method: "POST" })}>Retry</button>
            </div>
          )}

          {notice && <div className="whatsapp-notice">{notice}</div>}
        </div>
      </div>}
    </section>
  );
}

function NotificationsInbox() {
  const notices = [
    { icon: Store, type: "Supplier switched", title: "Distribuidora Centro replaced PackAR", detail: "Stretch film · 12% cheaper and delivered within 48 hours.", meta: "MD-001 · Today, 10:22", channel: "WhatsApp sent" },
    { icon: CheckCircle2, type: "Purchase made", title: "Purchase OC-2841 confirmed", detail: "20 rolls of stretch film for $142,000.", meta: "MD-001 · Today, 10:24", channel: "WhatsApp sent" },
    { icon: ShieldCheck, type: "Mandate activated", title: "Mandate v3 recorded on Polygon", detail: "The policy is active and available for merchant verification.", meta: "MD-001 · Aug 15, 14:32", channel: "In-app only" },
    { icon: Clock3, type: "No valid offers", title: "The search could not be completed", detail: "The hydraulic oil offers exceeded the maximum price.", meta: "MD-003 · Yesterday, 16:42", channel: "WhatsApp sent" },
  ];

  return (
    <div className="notifications-layout">
      <div className="notifications-list">
        {notices.map((notice) => {
          const Icon = notice.icon;
          return (
            <article className="notification-item" key={`${notice.type}-${notice.meta}`}>
              <div className="notification-icon"><Icon size={16} /></div>
              <div className="notification-copy"><span>{notice.type}</span><h2>{notice.title}</h2><p>{notice.detail}</p><small>{notice.meta}</small></div>
              <em>{notice.channel}</em>
            </article>
          );
        })}
      </div>
      <aside className="notifications-summary">
        <span>TODAY</span>
        <strong>2</strong>
        <p>alerts sent over WhatsApp</p>
        <div><span>Supplier switched</span><em>1</em></div>
        <div><span>Purchase made</span><em>1</em></div>
      </aside>
    </div>
  );
}

function NotificationPreferences() {
  const preferences = [
    ["Purchase made", "Confirmation and details of every order", true],
    ["Supplier switched", "Previous supplier, new one, and why", true],
    ["Purchase failed", "Checkout errors or rejection", true],
    ["Insufficient balance", "The agent could not withdraw the funds", true],
    ["Blockchain failure", "The authorization could not be recorded", true],
    ["Virtual card failed", "The card could not be issued or used", true],
    ["No valid offers", "No option satisfied the mandate", true],
    ["Mandate expiring", "Notice 7 days before expiry", true],
    ["Search completed", "Summary of every scheduled run", false],
  ];

  return (
    <div className="preferences-panel">
      <div className="preferences-heading"><div><span>NOTIFICATIONS</span><h2>What you want to receive</h2></div><p>Critical events are always recorded in the inbox.</p></div>
      <div className="preference-list">
        {preferences.map(([title, description, enabled]) => (
          <label key={title}>
            <span><strong>{title}</strong><small>{description}</small></span>
            <input type="checkbox" defaultChecked={enabled} />
            <i />
          </label>
        ))}
      </div>
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
  const [verification, setVerification] = useState(null);
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState("Start the local chain, then complete KYC payment login before signing a mandate.");

  async function startDemo() {
    setAction("start");
    setNotice("");
    setPurchaseId(null);
    setVerification(null);
    try {
      const state = await demoRequest("/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({ product: "flight-cordoba", quantity: 1, maxUnitPrice: "150", budget: "150" }),
      });
      setDemo(state);
      setNotice(`Local payment stack deployed in block ${state.network.latestBlock}. No mandate or payment credential exists yet.`);
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
      const state = await demoRequest("/api/demo/kyc/login", { method: "POST" });
      setDemo(state);
      setNotice(`KYC payment login confirmed in block ${state.network.latestBlock}. Marta's opaque payment token is ready for capture; no money moved.`);
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
      const state = await demoRequest("/api/demo/mandate", {
        method: "POST",
        body: JSON.stringify({ quantity: 1, maxUnitPrice: "150", budget: "150" }),
      });
      setDemo(state);
      setNotice(`Mandate signed in block ${state.network.latestBlock}. Marta authorizes one flight to Córdoba up to US$150; no funds are locked.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function findAndAuthorize() {
    setAction("authorize");
    setNotice("");
    try {
      const result = await demoRequest("/api/demo/agent/purchase", {
        method: "POST",
        body: JSON.stringify({ orderReference: "VuelaYa-COR-130", quantity: 1, unitPrice: "130" }),
      });
      setPurchaseId(result.purchaseId);
      setDemo(result.state);
      setNotice(`Agent transaction confirmed in block ${result.state.network.latestBlock}. VuelaYa's signed US$130 checkout is bound to the mandate; Marta has not been charged.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function verifyPurchase() {
    if (!purchaseId) return;
    setAction("verify");
    setNotice("");
    try {
      const result = await demoRequest(`/api/demo/merchant/verify/${purchaseId}`);
      setVerification(result);
      setNotice(result.verified
        ? "VuelaYa read live chain state and approved every verification check."
        : "Merchant verification failed. Capture is blocked.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  async function capturePurchase() {
    if (!purchaseId) return;
    setAction("capture");
    setNotice("");
    try {
      const result = await demoRequest(`/api/demo/merchant/capture/${purchaseId}`, { method: "POST" });
      setDemo(result.state);
      setNotice(`Merchant capture confirmed in block ${result.state.network.latestBlock}. US$130 is now in VuelaYa's account.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  const balances = demo?.balances || { buyer: "—", cardProcessor: "—", merchant: "—" };
  const hasKycPayment = Boolean(demo?.kyc?.captureReady);
  const hasMandate = Boolean(demo?.mandate);
  const isCaptured = Boolean(demo) && Number(balances.merchant) > 0;
  const canVerify = Boolean(purchaseId) && !verification;
  const canCapture = Boolean(verification?.verified) && !isCaptured;
  const step = !demo ? 1 : !hasKycPayment ? 2 : !hasMandate ? 3 : !purchaseId ? 4 : !verification ? 5 : !isCaptured ? 6 : 7;

  return (
    <section className="page live-demo-page">
      <div className="page-header live-demo-header">
        <div>
          <span className="eyebrow">LIVE BACKEND DEMO · LOCAL EVM CHAIN</span>
          <h1>Autonomous purchase, proven step by step.</h1>
          <p>This is not a simulated progress bar. Every step below calls the local payment backend, submits a contract transaction, and reads the resulting state back from the chain.</p>
        </div>
        <button className="secondary-button" onClick={startDemo} disabled={action !== null}>
          <RefreshCw size={15} /> {action === "start" ? "Deploying..." : demo ? "Reset local chain" : "Start local chain"}
        </button>
      </div>

      <div className="demo-stepper">
        {[[1, "Start chain"], [2, "KYC + payment token"], [3, "Sign mandate"], [4, "Agent binds checkout"], [5, "Merchant verifies"], [6, "Capture and pay"]].map(([number, label]) => <div key={number} className={step > number ? "done" : step === number ? "current" : ""}><b>{step > number ? "✓" : number}</b><span>{label}</span></div>)}
      </div>

      <div className="live-demo-mandate">
        <div><span>BUYER + KYC LOGIN</span><strong>Marta · mock business bank account</strong><code>{demo?.kyc?.status || "not started"} · {shortAddress(demo?.identities?.owner)}</code></div>
        <div><span>MANDATE</span><strong>1 Córdoba flight · max US$ {demo?.mandate?.maxUnitPrice || "150.0"}</strong><code>revision {demo?.mandate?.revision || "—"} · {demo?.mandate?.status || "not signed"}</code></div>
        <div><span>PURCHASING AGENT</span><strong>CHK Buyer · separate wallet</strong><code>{shortAddress(demo?.identities.agent)}</code></div>
        <div><span>APPROVED MERCHANT</span><strong>VuelaYa</strong><code>{shortAddress(demo?.identities.merchant)}</code></div>
      </div>

      <section className="live-demo-actions demo-setup-actions">
        <article>
          <span>STEP 2 · BUYER KYC / PAYMENT LOGIN</span>
          <p>KYC verifies Marta and saves only an opaque card-on-file token. This permits instant capture later, but stores no raw card data and locks no funds.</p>
          <button className="secondary-button" onClick={completeKycLogin} disabled={!demo || hasKycPayment || action !== null}>
            <ShieldCheck size={15} /> {action === "kyc" ? "Enrolling payment token..." : hasKycPayment ? "KYC payment token ready" : "Complete KYC payment login"}
          </button>
        </article>
        <article>
          <span>STEP 3 · HUMAN SIGNS MANDATE</span>
          <p>Marta delegates one specific flight purchase to CHK Buyer. The contract binds the agent, merchant, product rule, price cap, KYC reference, and revocation state.</p>
          <button className="secondary-button" onClick={createMandate} disabled={!hasKycPayment || hasMandate || action !== null}>
            <CheckCircle2 size={15} /> {action === "mandate" ? "Signing mandate..." : hasMandate ? "Mandate signed" : "Sign mandate"}
          </button>
        </article>
      </section>

      <div className="live-demo-offer">
        <div className="offer-copy"><span>AGENT DISCOVERY RESULT</span><h2>Buenos Aires → Córdoba</h2><p>VuelaYa · US$130 · below Marta’s US$150 mandate limit.</p></div>
        <div className="offer-price"><span>US$130</span><small>best eligible offer</small></div>
        <button className="primary-button" onClick={findAndAuthorize} disabled={!hasMandate || action !== null || Boolean(purchaseId)}>
          <CheckCircle2 size={15} /> {action === "authorize" ? "Binding checkout..." : purchaseId ? "Checkout bound" : "Agent buys automatically"}
        </button>
      </div>

      <section className="money-flow" aria-label="Live money movement">
        <MoneyNode icon={Building2} label="Marta's bank balance" value={`US$${balances.buyer}`} status={isCaptured ? "US$130 debited at capture" : purchaseId ? "Unchanged — capture pending" : "No mandate funds locked"} address={shortAddress(demo?.identities?.owner)} />
        <FlowArrow active={isCaptured} label="capture-only debit" />
        <MoneyNode icon={CreditCard} label="KYC-linked one-use credential" value={isCaptured ? "Consumed" : purchaseId ? "US$130 authorized" : "Not issued"} status={isCaptured ? "Used for VuelaYa checkout" : purchaseId ? "No funds held; VuelaYa only" : "Issued after quote binding"} highlighted={Boolean(purchaseId)} address={shortAddress(demo?.contracts?.cardProcessor)} />
        <FlowArrow active={isCaptured} label="merchant capture" />
        <MoneyNode icon={Store} label="VuelaYa settlement balance" value={`US$${balances.merchant}`} status={isCaptured ? "Payment received" : "Cannot receive before verification"} highlighted={isCaptured} address={shortAddress(demo?.identities?.merchant)} />
      </section>

      <section className="live-demo-actions">
        <article>
          <span>STEP 5 · LIVE MERCHANT CHECK</span>
          <p>VuelaYa queries the contract. It must see an active mandate, KYC-linked payment token, matching merchant, current revision, signed checkout hash, and a live one-use credential.</p>
          <button className="secondary-button" onClick={verifyPurchase} disabled={!canVerify || action !== null}>
            <ShieldCheck size={15} /> {action === "verify" ? "Reading chain state..." : verification ? "Verification approved" : "Verify mandate live"}
          </button>
        </article>
        <article>
          <span>STEP 6 · CAPTURE PAYMENT</span>
          <p>Only a verified merchant can capture. This atomically debits Marta’s tokenized card-on-file and pays VuelaYa in the next block—no pre-funded escrow.</p>
          <button className="primary-button" onClick={capturePurchase} disabled={!canCapture || action !== null}>
            <WalletCards size={15} /> {action === "capture" ? "Capturing on-chain..." : isCaptured ? "Payment settled" : "Capture US$130"}
          </button>
        </article>
      </section>

      {verification && (
        <div className="verification-result">
          <strong><ShieldCheck size={16} /> Merchant verification {verification.verified ? "passed" : "failed"}</strong>
          <div>{Object.entries(verification.checks).map(([check, passed]) => <span key={check} className={passed ? "passed" : "failed"}>{passed ? "✓" : "×"} {humanizeCheck(check)}</span>)}</div>
        </div>
      )}

      <p className="live-demo-notice">{notice}</p>

      <section className="backend-proof">
        <div><span>BACKEND PROOF</span><strong>{demo?.network.name || "Waiting to start the local chain"}</strong><small>chain ID {demo?.network.chainId || "—"} · latest block {demo?.network.latestBlock || "—"}</small></div>
        <div><span>MANDATE CONTRACT</span><code>{demo?.contracts.vault || "—"}</code></div>
        <div><span>PAYMENT PROCESSOR CONTRACT</span><code>{demo?.contracts.cardProcessor || "—"}</code></div>
      </section>

      <div className="live-demo-audit">
        <span>ON-CHAIN TRANSACTION LOG</span>
        {(demo?.audit || []).map((entry, index) => <div key={`${entry.type}-${index}`}><b>{index + 1}</b><code>{entry.type}</code><p>{entry.detail || entry.orderReference || entry.maxUnitPrice || "contract state changed"}</p><small>block {entry.blockNumber} · {shortAddress(entry.transactionHash)}</small></div>)}
      </div>
    </section>
  );
}

function shortAddress(address) {
  return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—";
}

function humanizeCheck(check) {
  return check.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function MoneyNode({ icon: Icon, label, value, status, address, highlighted = false }) {
  return <article className={`money-node ${highlighted ? "highlighted" : ""}`}><Icon size={21} /><span>{label}</span><strong>{value}</strong><small>{status}</small><code>{address}</code></article>;
}

function FlowArrow({ active, label }) {
  return <div className={`flow-arrow ${active ? "active" : ""}`}><i>→</i><span>{label}</span></div>;
}

function Status({ value }) {
  return <span className={`status ${value.toLowerCase()}`}>{value}</span>;
}

export default App;
