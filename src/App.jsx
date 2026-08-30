import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  CreditCard,
  History,
  MessageSquare,
  Plus,
  Send,
  Store,
  WalletCards,
} from "lucide-react";

const tabs = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "mandates", label: "Mandatos", icon: ClipboardList },
  { id: "history", label: "Historial", icon: History },
  { id: "account", label: "Cuenta", icon: WalletCards },
];

const initialMessages = [];

const initialMandates = [];

const purchases = [];

const mandateActivity = {};

const mandateOffers = {};

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
        {activeTab === "mandates" && (
          selectedMandateId ? (
            <MandateDetailPage
              mandate={mandates.find((item) => item.id === selectedMandateId)}
              onBack={() => setSelectedMandateId(null)}
              onRevoke={(mandateId) => setMandates((current) => current.map((item) => item.id === mandateId ? { ...item, status: "Revocado" } : item))}
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
        content: "Mandato v4 firmado. Ya puedo comenzar con chk! it out.",
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
    { label: "Oferta elegida", detail: `${lastPurchase.quantity} a ${lastPurchase.supplier}` },
    { label: "Saldo retirado", detail: `${currency.format(lastPurchase.total)} de la cuenta` },
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
  const icons = { success: Check, card: CreditCard, account: WalletCards, supplier: Store, search: Clock3 };
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
          <strong>—</strong>
          <div className="account-number"><span>Cuenta operativa ARS</span><em>—</em></div>
        </article>

        <article className="account-panel">
          <div className="account-card-heading"><CreditCard size={18} /><span>MÉTODO PREFERIDO</span></div>
          <div className="payment-method-mock">
            <span>Tarjeta empresa</span>
            <strong>—</strong>
            <small>Se usa para fondear chk! fund cuando el agente decide comprar.</small>
          </div>
          <button className="account-secondary-button">Cambiar método</button>
        </article>

        <article className="account-panel fund-panel">
          <div className="account-card-heading"><WalletCards size={18} /><span>CHK! FUND</span></div>
          <div className="fund-stats">
            <div><span>En proceso</span><strong>{currency.format(0)}</strong></div>
            <div><span>Ejecutado este mes</span><strong>{currency.format(0)}</strong></div>
            <div><span>Reintegros</span><strong>{currency.format(0)}</strong></div>
          </div>
          <p>Los fondos se retiran de tu cuenta cuando el agente decide comprar.</p>
        </article>
      </div>

      <article className="money-flow-panel">
        <div className="account-card-heading"><ArrowRight size={18} /><span>FLUJO DE UNA COMPRA</span></div>
        <div className="money-flow">
          <div><i>1</i><span><strong>El agente decide</strong><small>La oferta cumple el mandato</small></span></div>
          <ArrowRight size={17} />
          <div><i>2</i><span><strong>Saldo retirado</strong><small>De la cuenta de origen</small></span></div>
          <ArrowRight size={17} />
          <div><i>3</i><span><strong>Compra confirmada</strong><small>El proveedor recibe el pago</small></span></div>
        </div>
      </article>

      <article className="account-movements">
        <div className="account-card-heading"><History size={18} /><span>ÚLTIMOS MOVIMIENTOS</span></div>
        <p className="empty-copy">No hay movimientos todavía.</p>
      </article>
    </section>
  );
}


function Status({ value }) {
  return <span className={`status ${value.toLowerCase()}`}>{value}</span>;
}

export default App;
