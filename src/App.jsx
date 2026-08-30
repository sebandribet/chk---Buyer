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

const tabs = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "mandates", label: "Mandatos", icon: ClipboardList },
  { id: "history", label: "Historial", icon: History },
  { id: "account", label: "Cuenta", icon: WalletCards },
  { id: "whatsapp", label: "Avisos", icon: Bell },
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
            <p>El vendedor verificó la autorización actual contra MandateModule sin acceder a la política privada completa.</p>
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
          <DataRow label="Policy hash" value={mandate.policyHash} />
          <DataRow label="Contrato" value="MandateModule · Polygon Demo" />
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
        <p className="empty-copy">No hay movimientos todavía.</p>
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
  const notices = [];

  return (
    <div className="notifications-layout">
      <div className="notifications-list">
        {notices.length === 0 ? (
          <p className="empty-copy">No hay avisos todavía.</p>
        ) : notices.map((notice) => {
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
        <strong>0</strong>
        <p>avisos enviados por WhatsApp</p>
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

function Status({ value }) {
  return <span className={`status ${value.toLowerCase()}`}>{value}</span>;
}

export default App;
