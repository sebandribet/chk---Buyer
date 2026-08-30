import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
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
  { id: "mandates", label: "Mandatos", icon: ClipboardList },
  { id: "history", label: "Historial", icon: History },
  { id: "account", label: "Cuenta", icon: WalletCards },
  { id: "whatsapp", label: "Avisos", icon: Bell },
];

const initialMessages = [
  {
    id: 1,
    role: "user",
    content: "Necesito reponer 20 rollos de film stretch de 500 metros cada 15 días. No quiero pagar más de $8.500 por rollo.",
    time: "09:40",
  },
  {
    id: 2,
    role: "agent",
    content: "Entendido. Para que vos, el agente y los proveedores trabajemos con las mismas reglas, preparé un borrador estandarizado del mandato.",
    time: "09:41",
  },
  {
    id: 3,
    role: "agent",
    kind: "draft",
    time: "09:41",
    draft: {
      version: 4,
      product: "Film stretch industrial",
      specification: "50 cm x 500 m · 23 micrones",
      quantity: "Hasta 20 rollos",
      frequency: "Cada 15 días",
      unitLimit: "$8.500",
      totalLimit: "$500.000",
      expiration: "30 sep 2026",
      paymentMethod: "Tarjeta empresa · •••• 4242",
    },
  },
];

const initialMandateViews = [
  {
    id: "MD-001",
    product: "Film stretch industrial",
    description: "Rollo de 50 cm x 500 m, 23 micrones",
    status: "Activo",
    frequency: "Cada 15 días",
    quantity: "Hasta 20 rollos",
    unitPrice: 8500,
    monthlyBudget: 500000,
    suppliers: "PackAR y Distribuidora Centro",
    expires: "30 sep 2026",
    version: 3,
    owner: "0x71A4...92F1",
    agent: "chk! Buyer",
    agentAddress: "0xA91C...4E20",
    paymentDelegate: "VirtualCardAdapter",
    validAfter: "1 ago 2026",
    maxPerOperation: 170000,
    spent: 291800,
    reserved: 0,
    allowedActions: ["Buscar ofertas", "Elegir proveedor", "Comprar automáticamente"],
    policyHash: "0x9f8a7c4e...13bd92a1",
    account: "Cuenta operativa ARS · •••• 1842",
    accountBalance: 1108000,
    paymentMethod: "Tarjeta virtual de un solo uso",
    currentSupplier: "Distribuidora Centro",
    previousSupplier: "PackAR",
    supplierReason: "12% más económico y entrega dentro de las 48 horas.",
    lastRun: "29 ago 2026 · 10:24",
    nextRun: "12 sep 2026 · 08:00",
    lastCard: "•••• 4821",
  },
  {
    id: "MD-002",
    product: "Guantes de nitrilo",
    description: "Caja x 100 unidades, talle M, sin polvo",
    status: "Activo",
    frequency: "Mensual",
    quantity: "Hasta 12 cajas",
    unitPrice: 12600,
    monthlyBudget: 151200,
    suppliers: "Proveeduría Norte",
    expires: "15 oct 2026",
    version: 2,
    owner: "0x71A4...92F1",
    agent: "chk! Buyer",
    agentAddress: "0xB281...9C15",
    paymentDelegate: "VirtualCardAdapter",
    validAfter: "15 jul 2026",
    maxPerOperation: 151200,
    spent: 98400,
    reserved: 0,
    allowedActions: ["Buscar ofertas", "Elegir proveedor", "Comprar automáticamente"],
    policyHash: "0x4b18d620...8f31b781",
    account: "Cuenta operativa ARS · •••• 1842",
    accountBalance: 1108000,
    paymentMethod: "Tarjeta virtual de un solo uso",
    currentSupplier: "Proveeduría Norte",
    previousSupplier: "Proveeduría Norte",
    supplierReason: "Mantuvo el mejor equilibrio entre precio y disponibilidad.",
    lastRun: "22 ago 2026 · 09:11",
    nextRun: "3 sep 2026 · 08:00",
    lastCard: "•••• 1906",
  },
  {
    id: "MD-003",
    product: "Aceite hidráulico ISO 46",
    description: "Tambor de 20 litros, norma DIN 51524",
    status: "Borrador",
    frequency: "Cada 60 días",
    quantity: "Hasta 4 tambores",
    unitPrice: 92000,
    monthlyBudget: 368000,
    suppliers: "A definir",
    expires: "30 nov 2026",
    version: 1,
    owner: "0x71A4...92F1",
    agent: "chk! Buyer",
    agentAddress: "0xA91C...4E20",
    paymentDelegate: "VirtualCardAdapter",
    validAfter: "Pendiente de activación",
    maxPerOperation: 368000,
    spent: 0,
    reserved: 0,
    allowedActions: ["Buscar ofertas", "Elegir proveedor"],
    policyHash: "0x7c941d02...c4af7710",
    account: "Cuenta operativa ARS · •••• 1842",
    accountBalance: 1108000,
    paymentMethod: "Tarjeta virtual de un solo uso",
    currentSupplier: "Sin seleccionar",
    previousSupplier: "—",
    supplierReason: "Todavía no se ejecutó una compra.",
    lastRun: "28 ago 2026 · 16:42",
    nextRun: "Sin programar",
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
    date: "29 ago 2026",
    product: "Film stretch industrial",
    supplier: "Distribuidora Centro",
    quantity: "20 rollos",
    total: 142000,
    mandate: "MD-001 · v3",
    card: "•••• 4821",
    transaction: "0x81c2...4f90",
    status: "Comprada",
  },
  {
    id: "OC-2827",
    date: "22 ago 2026",
    product: "Guantes de nitrilo",
    supplier: "Proveeduría Norte",
    quantity: "8 cajas",
    total: 98400,
    mandate: "MD-002 · v2",
    card: "•••• 1906",
    transaction: "0x2d19...a782",
    status: "Comprada",
  },
  {
    id: "OC-2788",
    date: "14 ago 2026",
    product: "Film stretch industrial",
    supplier: "PackAR",
    quantity: "20 rollos",
    total: 149800,
    mandate: "MD-001 · v2",
    card: "•••• 7334",
    transaction: "0x749a...118c",
    status: "Comprada",
  },
];

const mandateActivity = {
  "MD-001": [
    { time: "10:24", title: "Compra confirmada", detail: "Distribuidora Centro confirmó la orden OC-2841.", type: "success" },
    { time: "10:23", title: "Tarjeta virtual generada", detail: "Tarjeta •••• 4821 por $142.000, válida para un solo uso.", type: "card" },
    { time: "10:23", title: "Autorización registrada", detail: "Transacción mock confirmada en Polygon · Demo.", type: "chain" },
    { time: "10:22", title: "Saldo retirado", detail: "$142.000 retirados de la cuenta operativa.", type: "account" },
    { time: "10:22", title: "Proveedor cambiado", detail: "El agente eligió Distribuidora Centro en lugar de PackAR.", type: "supplier" },
    { time: "10:21", title: "8 ofertas encontradas", detail: "Se compararon precio, disponibilidad y entrega.", type: "search" },
    { time: "10:20", title: "Búsqueda iniciada", detail: "Ejecución programada por cron.", type: "search" },
  ],
  "MD-002": [
    { time: "09:11", title: "Compra confirmada", detail: "Proveeduría Norte confirmó la orden OC-2827.", type: "success" },
    { time: "09:10", title: "Tarjeta virtual generada", detail: "Tarjeta •••• 1906 por $98.400.", type: "card" },
    { time: "09:08", title: "Búsqueda completada", detail: "Se encontraron 5 ofertas válidas.", type: "search" },
  ],
  "MD-003": [
    { time: "16:42", title: "Sin ofertas válidas", detail: "Las 4 opciones encontradas superaron el precio máximo.", type: "search" },
    { time: "16:40", title: "Búsqueda iniciada", detail: "Ejecución de prueba del borrador.", type: "search" },
  ],
};

const mandateOffers = {
  "MD-001": [
    { supplier: "Distribuidora Centro", unitPrice: 7100, delivery: "48 h", score: 94, result: "Elegida" },
    { supplier: "PackAR", unitPrice: 8000, delivery: "24 h", score: 88, result: "Descartada" },
    { supplier: "FlexPack Córdoba", unitPrice: 7480, delivery: "72 h", score: 84, result: "Descartada" },
  ],
  "MD-002": [
    { supplier: "Proveeduría Norte", unitPrice: 12300, delivery: "3 días", score: 92, result: "Elegida" },
    { supplier: "Seguridad Industrial SA", unitPrice: 12550, delivery: "5 días", score: 81, result: "Descartada" },
  ],
  "MD-003": [
    { supplier: "Hidráulica Federal", unitPrice: 101500, delivery: "4 días", score: 68, result: "Fuera de límite" },
  ],
};

const currency = new Intl.NumberFormat("es-AR", {
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
                status: "Revocado",
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
        <nav className="tabs" aria-label="Navegación principal">
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
      { id: crypto.randomUUID(), role: "user", content, time: "Ahora" },
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
        content: "Mandato v4 firmado y registrado en Polygon · Demo. Ya puedo comenzar con chk! it out.",
        time: "Ahora",
      },
    ]);
  }

  return (
    <section className="page chat-page">
      <div className="chat-layout">
        <aside className="mandates-overview">
          <div className="overview-header">
            <div>
              <span>MANDATOS ACTIVOS</span>
              <h2>Tus productos</h2>
            </div>
            <span className="overview-count">{mandates.filter((item) => item.status === "Activo").length}</span>
          </div>

          <div className="overview-list">
            {mandates.filter((item) => item.status === "Activo").map((mandate) => (
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
                  <div><dt>Reposición</dt><dd>{mandate.frequency}</dd></div>
                  <div><dt>Tope unitario</dt><dd>{currency.format(mandate.unitPrice)}</dd></div>
                </dl>
              </button>
            ))}
          </div>

          <button className="overview-link" onClick={onOpenMandates}>
            Ver todos los mandatos <ChevronRight size={16} />
          </button>
        </aside>

        <div className="chat-shell">
          <div className="chat-topbar">
            <div><strong>chk! Buyer</strong><span>Tu agente de compras</span></div>
          </div>
          <div className="conversation">
            <div className="message-list">
              <div className="conversation-date">HOY</div>
              {messages.map((item) => (
                <div className={`chat-message ${item.role}`} key={item.id}>
                  <div>
                    {item.kind === "draft" ? (
                      <MandateDraftCard
                        draft={item.draft}
                        approved={draftApproved}
                        onApprove={approveDraft}
                        onEdit={() => setMessage("Quiero modificar: ")}
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
              placeholder="Escribí un mensaje..."
              aria-label="Mensaje para el agente"
            />
            <button type="submit" disabled={!message.trim()} aria-label="Enviar mensaje"><Send size={17} /></button>
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
        <div><span>MANDATE DRAFT</span><strong>Borrador v{draft.version}</strong></div>
        <em>{approved ? "Firmado" : "Sin firmar"}</em>
      </div>
      <div className="draft-product"><strong>{draft.product}</strong><span>{draft.specification}</span></div>
      <dl>
        <DataRow label="Cantidad" value={draft.quantity} />
        <DataRow label="Frecuencia" value={draft.frequency} />
        <DataRow label="Máximo por unidad" value={draft.unitLimit} />
        <DataRow label="Límite total" value={draft.totalLimit} />
        <DataRow label="Vigencia" value={draft.expiration} />
        <DataRow label="Método" value={draft.paymentMethod} />
      </dl>
      <div className="draft-actions">
        <button onClick={onEdit} disabled={approved}>Seguir editando</button>
        <button className="approve-draft" onClick={onApprove} disabled={approved}>
          {approved ? <><Check size={14} />Mandato firmado</> : <>Revisar y firmar <ArrowRight size={14} /></>}
        </button>
      </div>
    </article>
  );
}

function MandatesPage({ mandates, onCreate, onSelect }) {
  return (
    <section className="page">
      <div className="page-toolbar">
        <div className="list-summary"><span>{mandates.length} mandatos</span><span>{mandates.filter((item) => item.status === "Activo").length} activos</span></div>
        <button className="primary-button" onClick={onCreate}><Plus size={17} />Nuevo mandato</button>
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
                <div className="mandate-field"><span>Reposición</span><strong>{mandate.frequency}</strong></div>
                <div className="mandate-field"><span>Precio máximo</span><strong>{currency.format(mandate.unitPrice)}</strong></div>
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
  { id: "detail", label: "Detalle" },
  { id: "activity", label: "Actividad" },
  { id: "offers", label: "Ofertas" },
  { id: "purchases", label: "Compras" },
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
      <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Volver a mandatos</button>

      <div className="detail-hero">
        <div>
          <div className="detail-identity"><span>{mandate.id}</span><Status value={mandate.status} /><em>DEMO</em></div>
          <h1>{mandate.product}</h1>
          <p>{mandate.description}</p>
        </div>
        <div className="detail-hero-actions">
          <div className="detail-hero-meta">
            <span>Revisión</span>
            <strong>v{mandate.version}</strong>
          </div>
          {mandate.status === "Activo" && (
            <button className="revoke-button" onClick={() => setConfirmingRevoke(true)}>Revocar mandato</button>
          )}
        </div>
      </div>

      {confirmingRevoke && (
        <div className="revoke-confirmation">
          <div><strong>¿Revocar este mandato ahora?</strong><p>Las próximas autorizaciones fallarán. Las compras ya confirmadas no se cancelan.</p></div>
          <button onClick={() => setConfirmingRevoke(false)}>Volver</button>
          <button onClick={() => { onRevoke(mandate.id); setConfirmingRevoke(false); }}>Confirmar revocación</button>
        </div>
      )}

      <nav className="mandate-subnav" aria-label="Secciones del mandato">
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
    { label: "chk! it out · oferta elegida", detail: `${lastPurchase.quantity} a ${lastPurchase.supplier}` },
    { label: "write the chk! · saldo retirado", detail: `${currency.format(lastPurchase.total)} → chk! fund` },
    { label: "Autorización registrada", detail: `Polygon · Demo · ${lastPurchase.transaction}` },
    { label: "Tarjeta virtual generada", detail: `${lastPurchase.card} · un solo uso` },
    { label: "Mandato validado por el vendedor", detail: "Activo · agente y monto autorizados" },
    { label: "Compra confirmada", detail: lastPurchase.id },
  ] : [];

  return (
    <div className="mandate-section-content">
      <div className="mandate-metrics">
        <Metric label="Disponible" value={currency.format(available)} />
        <Metric label="Gastado" value={currency.format(mandate.spent)} />
        <Metric label="Reservado" value={currency.format(mandate.reserved)} />
        <Metric label="Máximo por compra" value={currency.format(mandate.maxPerOperation)} />
      </div>

      <div className="mandate-detail-grid">
        <article className="detail-panel">
          <div className="panel-heading"><ClipboardList size={17} /><h2>Reglas del mandato</h2></div>
          <dl className="detail-data-list">
            <DataRow label="Cantidad máxima" value={mandate.quantity} />
            <DataRow label="Reposición" value={mandate.frequency} />
            <DataRow label="Precio unitario máximo" value={currency.format(mandate.unitPrice)} />
            <DataRow label="Presupuesto total" value={currency.format(mandate.monthlyBudget)} />
            <DataRow label="Vigencia" value={`${mandate.validAfter} — ${mandate.expires}`} />
            <DataRow label="Agente autorizado" value={`${mandate.agent} · ${mandate.agentAddress}`} />
          </dl>
          <div className="allowed-actions">
            <span>Acciones permitidas</span>
            <div>{mandate.allowedActions.map((action) => <em key={action}>{action}</em>)}</div>
          </div>
        </article>

        <article className="detail-panel supplier-panel">
          <div className="panel-heading"><Store size={17} /><h2>Proveedor elegido</h2></div>
          <strong className="selected-supplier">{mandate.currentSupplier}</strong>
          <p>{mandate.supplierReason}</p>
          <dl className="detail-data-list compact">
            <DataRow label="Proveedor anterior" value={mandate.previousSupplier} />
            <DataRow label="Última búsqueda" value={mandate.lastRun} />
            <DataRow label="Próxima búsqueda" value={mandate.nextRun} />
          </dl>
        </article>

        <article className="detail-panel payment-panel">
          <div className="panel-heading"><WalletCards size={17} /><h2>Cuenta y método</h2></div>
          <dl className="detail-data-list">
            <DataRow label="Cuenta" value={mandate.account} />
            <DataRow label="Saldo actual" value={currency.format(mandate.accountBalance)} />
            <DataRow label="Método" value={mandate.paymentMethod} />
            <DataRow label="Última tarjeta" value={mandate.lastCard} />
            <DataRow label="Payment delegate" value={mandate.paymentDelegate} />
          </dl>
        </article>

        <article className="detail-panel execution-panel">
          <div className="panel-heading"><CreditCard size={17} /><h2>Última compra</h2></div>
          {executionSteps.length > 0 ? (
            <div className="execution-steps">
              {executionSteps.map((step) => (
                <div key={step.label}><i><Check size={12} /></i><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>
              ))}
            </div>
          ) : <p className="empty-copy">Este mandato todavía no realizó compras.</p>}
        </article>
      </div>

      <article className="detail-panel recent-activity-panel">
        <div className="panel-heading"><Clock3 size={17} /><h2>Actividad reciente</h2></div>
        <div className="recent-activity-list">
          {activity.slice(0, 4).map((event) => (
            <div key={`${event.time}-${event.title}`}><span>{event.time}</span><strong>{event.title}</strong><p>{event.detail}</p></div>
          ))}
        </div>
      </article>

      {lastPurchase && (
        <article className="merchant-verification-panel">
          <div className="merchant-verification-copy">
            <span>PRESENTACIÓN AL VENDEDOR · DEMO</span>
            <h2>{lastPurchase.supplier} aceptó la compra</h2>
            <p>El vendedor verificó la autorización actual contra MandateVault sin acceder a la política privada completa.</p>
          </div>
          <div className="merchant-checks">
            <span><Check size={13} />Mandato activo</span>
            <span><Check size={13} />Agente autorizado</span>
            <span><Check size={13} />Monto dentro del límite</span>
            <span><Check size={13} />Autorización de un uso válida</span>
          </div>
        </article>
      )}

      <details className="technical-details">
        <summary><ShieldCheck size={16} />Detalles técnicos simulados</summary>
        <dl>
          <DataRow label="Owner" value={mandate.owner} />
          <DataRow label="Agent" value={mandate.agentAddress} />
          <DataRow label="Policy hash" value={mandate.canonical?.policyHash ?? mandate.policyHash} />
          <DataRow label="Contrato" value="MandateVault · Polygon Demo" />
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
        <span>Última búsqueda</span><strong>{mandate.lastRun}</strong><p>{offers.length} ofertas relevantes encontradas</p>
      </div>
      <div className="offers-table">
        <div className="offers-head"><span>Proveedor</span><span>Precio unitario</span><span>Entrega</span><span>Puntaje</span><span>Resultado</span></div>
        {offers.map((offer) => (
          <article key={offer.supplier} className={offer.result === "Elegida" ? "selected" : ""}>
            <div><strong>{offer.supplier}</strong>{offer.result === "Elegida" && <small>Elegida por el agente</small>}</div>
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
          <span>Compra</span><span>Proveedor</span><span>Cantidad</span><span>Total</span><span>Tarjeta</span>
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
          <span>Compra</span><span>Producto</span><span>Proveedor</span><span>Total</span><span>Estado</span>
        </div>
        {purchases.map((purchase) => (
          <article className="history-row" key={purchase.id}>
            <div><strong>{purchase.id}</strong><span>{purchase.date}</span></div>
            <div><strong>{purchase.product}</strong><span>{purchase.quantity} · {purchase.mandate}</span></div>
            <div><strong>{purchase.supplier}</strong></div>
            <div><strong>{currency.format(purchase.total)}</strong></div>
            <div><span className="purchase-status"><Check size={13} />Comprada</span></div>
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
          <div className="account-card-heading"><Building2 size={18} /><span>CUENTA DE ORIGEN</span></div>
          <p>Saldo disponible</p>
          <strong>{currency.format(1108000)}</strong>
          <div className="account-number"><span>Cuenta operativa ARS</span><em>•••• 1842</em></div>
        </article>

        <article className="account-panel">
          <div className="account-card-heading"><CreditCard size={18} /><span>MÉTODO PREFERIDO</span></div>
          <div className="payment-method-mock">
            <span>Tarjeta empresa</span>
            <strong>•••• 4242</strong>
            <small>Se usa para fondear chk! fund cuando el agente decide comprar.</small>
          </div>
          <button className="account-secondary-button">Cambiar método</button>
        </article>

        <article className="account-panel fund-panel">
          <div className="account-card-heading"><WalletCards size={18} /><span>CHK! FUND</span></div>
          <div className="fund-stats">
            <div><span>En proceso</span><strong>{currency.format(0)}</strong></div>
            <div><span>Ejecutado este mes</span><strong>{currency.format(240400)}</strong></div>
            <div><span>Reintegros</span><strong>{currency.format(0)}</strong></div>
          </div>
          <p>Los fondos se retiran de tu cuenta cuando el agente decide comprar y se consumen al emitir la tarjeta virtual.</p>
        </article>

        <article className="account-panel card-policy-panel">
          <div className="account-card-heading"><ShieldCheck size={18} /><span>TARJETAS VIRTUALES</span></div>
          <dl className="detail-data-list">
            <DataRow label="Modalidad" value="Un solo uso" />
            <DataRow label="Límite" value="Importe exacto de la orden" />
            <DataRow label="Vigencia" value="Hasta completar el checkout" />
            <DataRow label="Payment delegate" value="VirtualCardAdapter" />
          </dl>
        </article>
      </div>

      <article className="money-flow-panel">
        <div className="account-card-heading"><ArrowRight size={18} /><span>FLUJO DE UNA COMPRA</span></div>
        <div className="money-flow">
          <div><i>1</i><span><strong>El agente decide</strong><small>La oferta cumple el mandato</small></span></div>
          <ArrowRight size={17} />
          <div><i>2</i><span><strong>Cuenta → chk! fund</strong><small>El saldo se retira</small></span></div>
          <ArrowRight size={17} />
          <div><i>3</i><span><strong>Polygon</strong><small>Registra la autorización</small></span></div>
          <ArrowRight size={17} />
          <div><i>4</i><span><strong>Tarjeta virtual</strong><small>Paga al productor</small></span></div>
        </div>
      </article>

      <article className="account-movements">
        <div className="account-card-heading"><History size={18} /><span>ÚLTIMOS MOVIMIENTOS</span></div>
        <div className="movement-row">
          <div><strong>Compra OC-2841</strong><span>Film stretch · Distribuidora Centro</span></div>
          <div><strong>-{currency.format(142000)}</strong><span>29 ago · 10:22</span></div>
        </div>
        <div className="movement-row">
          <div><strong>Compra OC-2827</strong><span>Guantes de nitrilo · Proveeduría Norte</span></div>
          <div><strong>-{currency.format(98400)}</strong><span>22 ago · 09:09</span></div>
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
        if (active) setConnection({ status: "error", error: "No se pudo contactar al servidor" });
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
      if (!response.ok) throw new Error(data.error || "La operación no pudo completarse");
      if (name === "test") setNotice("Mensaje de prueba enviado a tu propio chat.");
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
      <nav className="notice-subnav" aria-label="Avisos y notificaciones">
        <button className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")}>Bandeja <span>4</span></button>
        <button className={view === "preferences" ? "active" : ""} onClick={() => setView("preferences")}>Preferencias</button>
        <button className={view === "whatsapp" ? "active" : ""} onClick={() => setView("whatsapp")}>WhatsApp</button>
      </nav>

      {view === "inbox" && <NotificationsInbox />}
      {view === "preferences" && <NotificationPreferences />}
      {view === "whatsapp" && <div className="whatsapp-card">
        <div className="whatsapp-copy">
          <div className="whatsapp-icon"><Smartphone size={23} /></div>
          <span className="setup-label">INTEGRACIÓN</span>
          <h1>Avisos y notificaciones</h1>
          <p>Configurá WhatsApp para recibir en tu propio chat las novedades de chk! Buyer, tu agente de compras.</p>
          <ol>
            <li>Abrí WhatsApp en tu teléfono.</li>
            <li>Entrá en <strong>Dispositivos vinculados</strong>.</li>
            <li>Elegí <strong>Vincular un dispositivo</strong> y escaneá el QR.</li>
          </ol>
          <div className="baileys-note">Esta prueba utiliza Baileys y guarda la sesión solamente en este servidor.</div>
        </div>

        <div className="whatsapp-state">
          {(status === "loading" || status === "connecting" || status === "reconnecting") && (
            <div className="connection-panel">
              <RefreshCw className="spin" size={27} />
              <strong>{status === "reconnecting" ? "Reconectando WhatsApp" : "Preparando conexión"}</strong>
              <p>Esto puede demorar unos segundos.</p>
            </div>
          )}

          {status === "disconnected" && (
            <div className="connection-panel">
              <div className="state-icon"><QrCode size={27} /></div>
              <strong>Listo para vincular</strong>
              <p>Generá un código QR para comenzar.</p>
              <button
                className="whatsapp-primary"
                disabled={action === "connect"}
                onClick={() => runAction("connect", "/api/whatsapp/connect", { method: "POST" })}
              >
                {action === "connect" ? "Generando..." : "Generar código QR"}
              </button>
            </div>
          )}

          {status === "qr" && connection.qr && (
            <div className="qr-panel">
              <span>Escaneá este código</span>
              <div className="qr-frame"><img src={connection.qr} alt="Código QR para vincular WhatsApp" /></div>
              <p>El código se renueva automáticamente si vence.</p>
            </div>
          )}

          {status === "connected" && (
            <div className="connection-panel connected">
              <div className="connected-icon"><CheckCircle2 size={30} /></div>
              <strong>WhatsApp conectado</strong>
              <p>{connection.user?.name || "Cuenta vinculada"}{phone && ` · +${phone}`}</p>
              <button
                className="whatsapp-primary"
                disabled={action === "test"}
                onClick={() => runAction("test", "/api/whatsapp/test", { method: "POST" })}
              >
                <Send size={15} /> {action === "test" ? "Enviando..." : "Enviar mensaje de prueba"}
              </button>
              <button
                className="disconnect-button"
                disabled={action === "disconnect"}
                onClick={() => runAction("disconnect", "/api/whatsapp/session", { method: "DELETE" })}
              >
                <Unplug size={14} /> Desvincular cuenta
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="connection-panel error">
              <strong>No pudimos iniciar WhatsApp</strong>
              <p>{connection.error}</p>
              <button className="whatsapp-primary" onClick={() => runAction("connect", "/api/whatsapp/connect", { method: "POST" })}>Reintentar</button>
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
    { icon: Store, type: "Proveedor cambiado", title: "Distribuidora Centro reemplazó a PackAR", detail: "Film stretch · 12% más económico y entrega en 48 horas.", meta: "MD-001 · Hoy, 10:22", channel: "WhatsApp enviado" },
    { icon: CheckCircle2, type: "Compra realizada", title: "Compra OC-2841 confirmada", detail: "20 rollos de film stretch por $142.000.", meta: "MD-001 · Hoy, 10:24", channel: "WhatsApp enviado" },
    { icon: ShieldCheck, type: "Mandato activado", title: "Mandato v3 registrado en Polygon", detail: "La política está activa y disponible para verificación del vendedor.", meta: "MD-001 · 15 ago, 14:32", channel: "Solo en la app" },
    { icon: Clock3, type: "Sin ofertas válidas", title: "No se pudo completar la búsqueda", detail: "Las ofertas de aceite hidráulico superaron el precio máximo.", meta: "MD-003 · Ayer, 16:42", channel: "WhatsApp enviado" },
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
        <span>HOY</span>
        <strong>2</strong>
        <p>avisos enviados por WhatsApp</p>
        <div><span>Proveedor cambiado</span><em>1</em></div>
        <div><span>Compra realizada</span><em>1</em></div>
      </aside>
    </div>
  );
}

function NotificationPreferences() {
  const preferences = [
    ["Compra realizada", "Confirmación y detalle de cada orden", true],
    ["Proveedor cambiado", "Proveedor anterior, nuevo y motivo", true],
    ["Compra fallida", "Errores de checkout o rechazo", true],
    ["Saldo insuficiente", "El agente no pudo retirar los fondos", true],
    ["Fallo blockchain", "La autorización no pudo registrarse", true],
    ["Tarjeta virtual fallida", "No se pudo emitir o utilizar la tarjeta", true],
    ["Sin ofertas válidas", "Ninguna opción cumplió el mandato", true],
    ["Mandato por vencer", "Aviso 7 días antes del vencimiento", true],
    ["Búsqueda completada", "Resumen de cada ejecución programada", false],
  ];

  return (
    <div className="preferences-panel">
      <div className="preferences-heading"><div><span>NOTIFICACIONES</span><h2>Qué querés recibir</h2></div><p>Los eventos críticos siempre quedan registrados en la bandeja.</p></div>
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
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState("Start the local marketplace, then introduce a buyer at the KYC desk.");
  const [buyer, setBuyer] = useState({ name: "Marta Ruiz", email: "marta@ruizstudio.demo", company: "Ruiz Studio" });
  const [intentMessage, setIntentMessage] = useState("Buy 2 ergonomic chairs under $500");
  const [draftForm, setDraftForm] = useState({ productId: "", quantity: "1", maxUnitPrice: "", budget: "" });
  const draft = demo?.marketplace?.draft;

  useEffect(() => {
    if (!demo) return undefined;
    const refresh = setInterval(() => {
      demoRequest("/api/demo/state").then(setDemo).catch(() => {});
    }, 1500);
    return () => clearInterval(refresh);
  }, [Boolean(demo)]);

  useEffect(() => {
    if (!draft) return;
    setDraftForm({
      productId: draft.productId ?? "",
      quantity: String(draft.quantity ?? 1),
      maxUnitPrice: draft.maxUnitPrice ?? "",
      budget: draft.budget ?? "",
    });
  }, [draft?.id, draft?.revision, draft?.status]);

  async function startDemo() {
    setAction("start");
    setNotice("");
    setPurchaseId(null);
    try {
      const state = await demoRequest("/api/demo/reset", { method: "POST", body: JSON.stringify({}) });
      setDemo(state);
      setNotice(`Local chain and three mock wallets are ready in block ${state.network.latestBlock}. No buyer credential or mandate exists yet.`);
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
      setNotice(`${state.buyer.name} is KYC-verified. Their opaque payment token is ready; no money moved.`);
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
        ? `Draft v${nextDraft.revision} is ready for your review. It is not a payment authorization.`
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
      setNotice(`Definitive mandate sent to the local mock chain in block ${signing.blockNumber}. The agent can now search only within its signed limits.`);
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
        setNotice(`Agent selected ${result.selection.merchant}'s lowest eligible quote. The checkout is authorized, but the buyer has not been charged.`);
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
      setNotice(`The previous mandate was revoked without payment. Draft v${state.marketplace.draft.revision} is ready to revise.`);
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
        setNotice("Merchant validation failed. Payment was not captured.");
        return;
      }
      const result = await demoRequest(`/api/demo/merchant/capture/${activePurchaseId}`, { method: "POST" });
      setDemo(result.state);
      const selected = result.state.marketplace.selection.selected;
      setNotice(`Validated and paid. US$${selected.amount} moved from ${result.state.buyer.name} to ${selected.merchant}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAction(null);
    }
  }

  const balances = demo?.balances || { buyer: "—", merchant: "—", alternateMerchant: "—" };
  const selection = demo?.marketplace?.selection;
  const chatMessages = demo?.marketplace?.conversation ?? [];
  const agentMode = demo?.marketplace?.agent?.mode;
  const agent = demo?.marketplace?.agent;
  const marketSearch = demo?.marketplace?.marketSearch;
  const report = demo?.marketplace?.lastReport;
  const draftReady = draft?.status === "ready";
  const draftReviewed = draft?.status === "reviewed";
  const draftSigned = draft?.status === "signed";
  const selectedMerchant = selection?.merchant;
  const hasKycPayment = Boolean(demo?.kyc?.captureReady);
  const isAuthorized = selection?.status === "Authorized";
  const isCaptured = selection?.status === "Settled";
  const currentProduct = demo?.marketplace?.catalog?.find((product) => product.id === draft?.productId);

  return (
    <section className="page simple-demo-page">
      <div className="simple-demo-header">
        <div><span className="eyebrow">LIVE PURCHASE DEMO</span><h1>One buyer. Two sellers. One approved payment.</h1></div>
        <button className="secondary-button" onClick={startDemo} disabled={action !== null}><RefreshCw size={15} /> {action === "start" ? "Starting..." : demo ? "Reset" : "Start demo"}</button>
      </div>

      <div className="simple-demo-grid">
        <article className="simple-window buyer-window">
          <div className="simple-window-label"><Building2 size={16} /> BUYER WALLET <i>{demo ? "LIVE" : "OFFLINE"}</i></div>
          <strong className="wallet-balance">US${balances.buyer}</strong>
          <span className="wallet-owner">{demo?.buyer?.name || "Start the demo to create a buyer wallet"}</span>
          <p>{isCaptured ? `Payment sent: −US$${selection.selected.amount}` : isAuthorized ? "Payment authorized. Balance stays unchanged until capture." : "Funds stay in this wallet until a validated seller captures payment."}</p>
          <code>{shortAddress(demo?.buyer?.wallet)}</code>
          <div className={`wallet-state ${hasKycPayment ? "ready" : ""}`}><ShieldCheck size={14} /> {hasKycPayment ? "KYC payment token ready" : "KYC not completed"}</div>
        </article>

        <article className="simple-window control-window">
          <div className="simple-window-label"><Bot size={16} /> KYC + ASK THE AGENT {agentMode && <i>{agentMode}</i>}</div>
          {!demo && <div className="control-empty"><p>Start the demo, introduce the buyer, then tell the agent what to purchase.</p><button className="primary-button" onClick={startDemo} disabled={action !== null}>Start live wallets</button></div>}

          {demo && !hasKycPayment && <div className="control-flow"><p>Introduce the buyer for mock KYC.</p><div className="simple-fields"><input value={buyer.name} onChange={(event) => setBuyer((current) => ({ ...current, name: event.target.value }))} placeholder="Buyer name" /><input value={buyer.email} onChange={(event) => setBuyer((current) => ({ ...current, email: event.target.value }))} placeholder="Business email" /><input value={buyer.company} onChange={(event) => setBuyer((current) => ({ ...current, company: event.target.value }))} placeholder="Company" /></div><button className="primary-button" onClick={completeKycLogin} disabled={action !== null}><ShieldCheck size={15} /> {action === "kyc" ? "Verifying buyer..." : "Verify buyer"}</button></div>}

          {hasKycPayment && (!draftSigned || isCaptured) && <div className="control-flow"><p>{isCaptured ? "Purchase complete. What would you like to buy next?" : draftReady ? "Revise the draft here, or edit its final terms below." : "What should the agent draft for you?"}</p><div className="simple-chat" aria-live="polite">{chatMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}>{message.content}</div>)}</div>{agent?.requestId && <div className="agent-runtime live">Live OpenAI response <code>{agent.requestId}</code>{agent.model && <> · {agent.model}</>}</div>}{agent?.error && <div className="agent-runtime error">OpenAI error: {agent.error}</div>}<form className="simple-composer" onSubmit={submitIntent}><textarea value={intentMessage} onChange={(event) => setIntentMessage(event.target.value)} rows="2" aria-label="Purchase intention" /><button type="submit" disabled={action !== null || !intentMessage.trim()}><Send size={16} /></button></form><small>Describe the use case naturally — e.g. “I need two supportive mesh seats for long desk sessions under $500”.</small></div>}

          {hasKycPayment && draftReviewed && <div className="control-flow"><p>Draft v{draft.revision} is confirmed. The exact terms below are ready for a separate blockchain-signing action.</p></div>}

          {hasKycPayment && draftSigned && !selection && marketSearch?.status !== "no_eligible_option" && <div className="control-flow"><p>Definitive mandate signed. The agent can now search the live seller offers using only its signed product, quantity, and price caps.</p><button className="primary-button" onClick={compareAndAuthorize} disabled={action !== null}><Bot size={16} /> {action === "compare" ? "Searching market..." : "Run agent market search"}</button></div>}

          {hasKycPayment && draftSigned && marketSearch?.status === "no_eligible_option" && <div className="control-flow"><p>No seller met the signed limits. No checkout was authorized and no money moved.</p><button className="secondary-button" onClick={reopenDraft} disabled={action !== null}><RefreshCw size={15} /> {action === "reopen-draft" ? "Reopening..." : "Revise signed mandate"}</button></div>}

          {isAuthorized && <div className="control-flow"><p><b>{selection.merchant}</b> was selected at US${selection.selected.amount}. The seller must validate the mandate proof before payment can settle.</p><button className="primary-button" onClick={validateAndCapture} disabled={action !== null}><WalletCards size={15} /> {action === "settle" ? "Validating and paying..." : `Validate & pay US$${selection.selected.amount}`}</button></div>}

        </article>

        <article className="simple-window sellers-window">
          <div className="simple-window-label"><Store size={16} /> SELLER WALLETS <i>{demo ? "LIVE" : "OFFLINE"}</i></div>
          <div className="seller-wallet-list">
            {[{ name: "OfficeCore", balance: balances.merchant, address: demo?.identities?.merchant }, { name: "SupplyHub", balance: balances.alternateMerchant, address: demo?.identities?.alternateMerchant }].map((seller) => {
              const quote = currentProduct?.offers.find((offer) => offer.merchant === seller.name);
              const selected = seller.name === selectedMerchant;
              return <article className={selected ? "selected" : ""} key={seller.name}><div><span>{seller.name}</span>{selected && <em>{isCaptured ? "PAID" : "CHOSEN"}</em>}</div><strong>US${seller.balance}</strong><small>{quote ? `${currentProduct.name} · US$${quote.unitPrice} each` : "Waiting for a purchase request"}</small><code>{shortAddress(seller.address)}</code></article>;
            })}
          </div>
          <p className="seller-note">{selection ? `${selection.merchant} has the lowest eligible total: US$${selection.selected.amount}.` : marketSearch?.status === "no_eligible_option" ? "Both offers were rejected by the signed mandate; no checkout or payment exists." : draftSigned ? "The signed mandate is ready for a policy-bound market search." : draftReady ? "The draft is editable and is not yet spend authority." : "The agent compares both sellers only after the buyer signs a mandate."}</p>
        </article>
      </div>

      <section className="mandate-workbench">
        <div className="mandate-workbench-heading">
          <div><span className="simple-window-label"><ClipboardList size={16} /> MANDATE LIFECYCLE</span><h2>Draft first. Spend authority only after an explicit signature.</h2></div>
          <span className={`mandate-state ${draft?.status ?? "empty"}`}>{draft ? draft.status.replace("_", " ") : "waiting for request"}</span>
        </div>
        <div className="mandate-steps" aria-label="Mandate lifecycle">
          <span className={draft ? "complete" : "active"}>1. Draft</span><span className={draftReviewed || draftSigned ? "complete" : ""}>2. Review</span><span className={draftSigned ? "complete" : ""}>3. Sign to chain</span><span className={marketSearch?.status !== "not_started" ? "complete" : ""}>4. Search</span><span className={report ? "complete" : ""}>5. Report</span>
        </div>

        {!demo && <p className="mandate-empty">Start the demo and complete mock KYC to create a buyer-owned mandate draft.</p>}
        {demo && !hasKycPayment && <p className="mandate-empty">Complete mock KYC first. It creates a payment token only; it does not create a mandate.</p>}
        {hasKycPayment && !draft && <p className="mandate-empty">Ask the agent for something in natural language. It will propose a semantic catalog match and a non-binding mandate draft.</p>}

        {draft?.status === "needs_revision" && <div className="mandate-message"><strong>No safe mandate draft yet.</strong><p>{draft.recommendation}</p><small>{draft.reply}</small></div>}
        {draft?.status === "agent_error" && <div className="mandate-message error"><strong>The live agent was unavailable.</strong><p>{draft.recommendation}</p><small>{draft.reply}</small></div>}

        {draftReady && <form className="draft-editor" onSubmit={applyDraftEdits}>
          <div className="draft-editor-heading"><div><strong>MANDATE DRAFT v{draft.revision}</strong><span>Not spend authority · created from your prompt</span></div><small>{draft.agentMode === "OpenAI live" ? "Semantic match proposed by live OpenAI" : "Local catalog fallback"}</small></div>
          <p className="draft-reply">{draft.reply}</p>
          <div className="draft-fields">
            <label><span>Product to authorize</span><select value={draftForm.productId} onChange={(event) => setDraftForm((current) => ({ ...current, productId: event.target.value }))}>{demo.marketplace.catalog.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
            <label><span>Quantity</span><input type="number" min="1" max="20" value={draftForm.quantity} onChange={(event) => setDraftForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
            <label><span>Maximum unit price (USD)</span><input inputMode="decimal" value={draftForm.maxUnitPrice} onChange={(event) => setDraftForm((current) => ({ ...current, maxUnitPrice: event.target.value }))} /></label>
            <label><span>Total mandate cap (USD)</span><input inputMode="decimal" value={draftForm.budget} onChange={(event) => setDraftForm((current) => ({ ...current, budget: event.target.value }))} /></label>
          </div>
          <div className="draft-policy"><span>Approved sellers</span><strong>{draft.approvedSellers?.join(" · ")}</strong><small>The agent may only choose an exact catalog offer that is below both signed caps.</small></div>
          <div className="draft-actions"><button className="secondary-button" type="submit" disabled={action !== null}><RefreshCw size={15} /> {action === "edit-draft" ? "Applying..." : "Apply edits"}</button><button className="primary-button" type="button" onClick={confirmDraft} disabled={action !== null}><CheckCircle2 size={15} /> {action === "confirm-draft" ? "Confirming..." : "Confirm final terms"}</button></div>
        </form>}

        {draftReviewed && <div className="mandate-final-review"><div><strong>FINAL REVIEW · DRAFT v{draft.revision}</strong><p>This is the exact policy that will be sent to the local mock chain. Editing it will require a new review.</p></div><MandateTerms draft={draft} /><button className="primary-button" onClick={createMandate} disabled={action !== null}><WalletCards size={15} /> {action === "mandate" ? "Sending to chain..." : "Sign definitive mandate"}</button></div>}

        {draftSigned && <div className="mandate-signed"><div><strong>SIGNED DEFINITIVE MANDATE · #{draft.signing?.mandateId}</strong><p>Signed in local block {draft.signing?.blockNumber}. The agent can search only for <b>{draft.product}</b> within these exact limits.</p></div><MandateTerms draft={draft} /><div className="chain-proof"><span>LOCAL CHAIN TX</span><code>{shortAddress(draft.signing?.transactionHash)}</code><small>Mock USD only · no real funds or card data</small></div></div>}
      </section>

      <section className="catalog-window">
        <div className="catalog-window-heading">
          <div><span className="simple-window-label"><ClipboardList size={16} /> LIVE COMPANY CATALOG</span><h2>What each seller offers</h2><p>Prices are per unit. The outlined price is the lowest offer; when the agent buys, its chosen quote is highlighted here.</p></div>
          <span className="catalog-count">{demo?.marketplace?.catalog?.length || 0} products</span>
        </div>
        {!demo ? <div className="catalog-waiting">Start the demo to load both seller catalogs and their live wallet-backed offers.</div> : <div className="catalog-scroll"><div className="catalog-price-table">
          <div className="catalog-price-head"><span>PRODUCT</span><span>OFFICECORE</span><span>SUPPLYHUB</span><span>AGENT</span></div>
          {demo.marketplace.catalog.map((product) => {
            const officeOffer = product.offers.find((offer) => offer.merchant === "OfficeCore");
            const supplyOffer = product.offers.find((offer) => offer.merchant === "SupplyHub");
            const lowestMerchant = Number(officeOffer.unitPrice) <= Number(supplyOffer.unitPrice) ? "OfficeCore" : "SupplyHub";
            const requested = product.id === draft?.productId;
            return <article className={requested ? "requested" : ""} key={product.id}>
              <div className="catalog-product"><strong>{product.name}</strong><small>{product.description}</small></div>
              <CatalogOffer offer={officeOffer} lowest={lowestMerchant === "OfficeCore"} selected={requested && selectedMerchant === "OfficeCore"} />
              <CatalogOffer offer={supplyOffer} lowest={lowestMerchant === "SupplyHub"} selected={requested && selectedMerchant === "SupplyHub"} />
              <div className="catalog-agent-state">{requested ? selection ? <><CheckCircle2 size={13} /><span>{selection.merchant}<small>US${selection.selected.amount} total</small></span></> : draftSigned ? marketSearch?.status === "no_eligible_option" ? <><Clock3 size={13} /><span>No eligible offer<small>review report</small></span></> : <><Clock3 size={13} /><span>Signed<small>search ready</small></span></> : <><Clock3 size={13} /><span>Drafted<small>awaiting confirmation</small></span></> : <span>—</span>}</div>
            </article>;
          })}
        </div></div>}
      </section>

      {report && <DecisionReport report={report} />}

      <p className="simple-demo-notice"><span>{demo ? "● LIVE" : "○ READY"}</span>{notice}</p>
    </section>
  );
}

function MandateTerms({ draft }) {
  return <dl className="mandate-terms"><div><dt>What</dt><dd>{draft.quantity} × {draft.product}</dd></div><div><dt>Per unit</dt><dd>US${draft.maxUnitPrice}</dd></div><div><dt>Total cap</dt><dd>US${draft.budget}</dd></div><div><dt>Sellers</dt><dd>{draft.approvedSellers?.join(", ")}</dd></div></dl>;
}

function DecisionReport({ report }) {
  const offers = report.decision?.offers ?? [];
  const settlement = report.settlement;
  const isSettled = report.status === "settled";
  const isNotExecuted = report.status === "not_executed";
  const status = isSettled ? "SETTLED" : isNotExecuted ? "NOT EXECUTED" : "AWAITING CAPTURE";

  return <section className={`decision-report ${report.status}`}>
    <div className="decision-report-heading"><div><span className="simple-window-label"><ClipboardList size={16} /> DECISION & TRANSACTION REPORT</span><h2>{report.title}</h2><p>{report.summary}</p></div><span>{status}</span></div>
    <div className="report-grid">
      <article><small>MANDATE POLICY</small><strong>{report.draft?.quantity} × {report.draft?.product ?? "No product"}</strong><p>Up to US${report.draft?.unitPriceCap ?? "—"} per unit · US${report.draft?.totalBudget ?? "—"} total</p>{report.mandate?.transactionHash && <code>signed {shortAddress(report.mandate.transactionHash)} · block {report.mandate.blockNumber}</code>}</article>
      <article><small>AGENT INTERPRETATION</small><strong>{report.agent?.mode ?? "Catalog decision"}</strong><p>{report.agent?.model ?? "Policy engine"}</p>{report.agent?.responseId && <code>{shortAddress(report.agent.responseId)}</code>}</article>
      <article><small>DECISION</small><strong>{report.decision?.selectedMerchant ?? "No seller selected"}</strong><p>{report.decision?.rationale}</p>{report.decision?.savingsVsNextEligible && <code>US${report.decision.savingsVsNextEligible} saved vs. next eligible quote</code>}</article>
      <article><small>AUTHORIZATION</small><strong>{report.authorization ? "Merchant quote bound" : "No authorization created"}</strong><p>{report.authorization ? "Seller verification is required before settlement." : report.recommendation}</p>{report.authorization?.transactionHash && <code>{shortAddress(report.authorization.transactionHash)} · block {report.authorization.blockNumber}</code>}</article>
    </div>

    {offers.length > 0 && <div className="report-offers"><div className="report-offer-head"><span>SELLER</span><span>UNIT</span><span>TOTAL</span><span>DECISION</span></div>{offers.map((offer) => <article key={offer.merchant} className={offer.merchant === report.decision?.selectedMerchant ? "chosen" : ""}><strong>{offer.merchant}</strong><span>US${offer.unitPrice}</span><span>US${offer.amount}</span><span>{offer.eligible ? "Eligible" : offer.rejectionReasons?.join(" ")}</span></article>)}</div>}

    {report.verification && <div className="report-verification"><strong>Merchant verification: {report.verification.verified ? "passed" : "failed"}</strong><div>{Object.entries(report.verification.checks).map(([name, passed]) => <span className={passed ? "pass" : "fail"} key={name}>{passed ? "✓" : "×"} {name.replace(/([A-Z])/g, " $1")}</span>)}</div></div>}

    {settlement && <div className="report-settlement"><div><span>SETTLEMENT · LOCAL MOCK CHAIN</span><strong>US${settlement.amount} paid</strong><code>{shortAddress(settlement.transactionHash)} · block {settlement.blockNumber}</code></div><div className="report-balance-movements">{Object.entries(settlement.balances).map(([wallet, movement]) => <span key={wallet}><b>{wallet}</b><i>{movement.before} → {movement.after}</i><em>{movement.delta}</em></span>)}</div></div>}
    <small className="report-disclaimer">This report is generated from the signed mandate, seller quotes, on-chain authorization, verification checks, and mock-USD settlement. It never represents a real payment.</small>
  </section>;
}

function CatalogOffer({ offer, lowest, selected }) {
  return <div className={`catalog-offer ${lowest ? "lowest" : ""} ${selected ? "selected" : ""}`}><strong>US${offer.unitPrice}</strong>{lowest && <em>best price</em>}<small>{offer.delivery}</small></div>;
}

function shortAddress(address) {
  return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—";
}

function Status({ value }) {
  return <span className={`status ${value.toLowerCase()}`}>{value}</span>;
}

export default App;
