/**
 * Impresión del trail en la terminal.
 *
 * La UI de verdad la hace otro del equipo; esto existe para que nosotros
 * podamos leer un run completo mientras desarrollamos y para ensayar la
 * presentación sin depender del front.
 */

import type { AuditEvent, DecisionOutcome, Suggestion } from "@/contracts/index.js";
import type { RunResult } from "@/agent/run.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const ars = (n: number) => `$${n.toLocaleString("es-AR")}`;

function line(event: AuditEvent): string {
  switch (event.type) {
    case "run_started":
      return `${BOLD}▶ run ${event.runId}${RESET} · mandato ${event.mandateId}\n  ${DIM}"${event.prompt}"${RESET}`;
    case "intent_extracted": {
      const c = event.intent.constraints;
      const extras = [
        `presupuesto ${c.budgetArs === null ? "sin definir" : ars(c.budgetArs)}`,
        c.maxDeliveryDays !== null ? `entrega ≤ ${c.maxDeliveryDays}d` : null,
        c.forbiddenCategories.length > 0 ? `prohibido: ${c.forbiddenCategories.join(", ")}` : null,
        event.intent.intentExpiry !== null ? `vence ${event.intent.intentExpiry}` : null,
        event.intent.needs.some((n) => n.substitutesAllowed) ? "acepta sustitutos" : null,
      ].filter((x): x is string => x !== null);

      const ficha = event.intent.brief.lines
        .map((l) => `    ${DIM}${l.label.padEnd(22)}${RESET} ${l.value}`)
        .join("\n");
      const faltantes =
        event.intent.brief.unspecified.length > 0
          ? `\n    ${YELLOW}sin especificar${RESET}        ${DIM}${event.intent.brief.unspecified.join(", ")}${RESET}`
          : "";

      return (
        `${CYAN}✓ intent${RESET} ${event.intent.needs
          .map((n) => `${n.qty}${n.unit} ${n.canonical}${Object.keys(n.attrs).length > 0 ? ` (${Object.values(n.attrs).join(", ")})` : ""}`)
          .join(" · ")}  ${DIM}${extras.join(" · ")}${RESET}\n` +
        `  ${BOLD}ficha del pedido${RESET}\n${ficha}${faltantes}`
      );
    }
    case "catalog_stale":
      return `${DIM}↻ ${event.canonical}: datos vencidos, se refrescan en segundo plano${RESET}`;
    case "catalog_target_planned":
      return `${CYAN}◇ rubro nuevo${RESET} "${event.canonical}" → categoría ${event.category}, busco "${event.query}"`;
    case "catalog_fetched_live":
      return `${CYAN}⬇ búsqueda en vivo${RESET} ${event.canonical} → ${event.products} productos en ${event.ms}ms ${DIM}(${event.category})${RESET}`;
    case "catalog_fetch_failed":
      return `${YELLOW}⚠ búsqueda en vivo falló${RESET} ${event.canonical} ${DIM}— se sigue con lo que hay: ${event.detail}${RESET}`;
    case "search_brief_built":
      return `${CYAN}⌕ brief de búsqueda${RESET} ${event.text}\n  ${DIM}${event.rationale}${RESET}`;
    case "commitment_assessed":
      return `${event.executes ? GREEN : YELLOW}◆ compromiso: ${event.level}${RESET} → ${event.executes ? "ejecuta" : "solo sugiere"} ${DIM}${event.detail}${RESET}`;
    case "clarification_requested":
      return `${YELLOW}? faltan datos${RESET}\n${event.questions.map((q) => `    · ${q.question} ${DIM}[${q.field}]${RESET}`).join("\n")}`;
    case "mandate_read":
      return `${DIM}⛓ lectura de mandato (${event.phase}) · activo=${event.state.active} revocado=${event.state.revokedAt ?? "no"} saldo=${ars(event.state.budgetTotalArs - event.state.budgetSpentArs)}${RESET}`;
    case "search_executed":
      return `${CYAN}⌕ búsqueda${RESET} ${event.canonical} → ${event.resultCount} ofertas`;
    case "candidate_scored":
      return `  ${GREEN}·${RESET} ${event.sku} ${DIM}${event.supplierId} · ${ars(event.unitPriceArs)}/u · ${event.kind}${RESET}`;
    case "candidate_rejected":
      return `  ${RED}✗${RESET} ${event.rejected.sku} ${DIM}${event.rejected.reason}: ${event.rejected.detail}${RESET}`;
    case "substitution_evaluated":
      return `  ${event.accepted ? GREEN : RED}⇄${RESET} sustituto ${event.sku} ${event.accepted ? "aceptado" : "rechazado"} ${DIM}(${event.decidedBy}) ${event.detail}${RESET}`;
    case "injection_attempt_detected":
      return `  ${YELLOW}⚠ prompt injection${RESET} en ${event.sku} ${DIM}(${event.supplierId}): "${event.snippet}"${RESET}`;
    case "policy_check":
      return `  ${event.passed ? GREEN + "✓" : RED + "✗"}${RESET} ${event.check} ${DIM}${event.detail}${RESET}`;
    case "outcome_emitted":
      return `${BOLD}■ ${event.outcome}${RESET}${event.reason !== undefined ? ` ${DIM}(${event.reason})${RESET}` : ""}`;
  }
}

export function renderTrail(events: readonly AuditEvent[]): string {
  return events.map(line).join("\n");
}

export function renderOutcome(outcome: DecisionOutcome | null): string {
  if (outcome === null) {
    return `\n${YELLOW}${BOLD}El agente no compró nada: falta información del humano.${RESET}\n`;
  }

  switch (outcome.status) {
    case "proposal": {
      const rows = outcome.cart.lines
        .map(
          (l) =>
            `  ${l.candidate.qtyPacks}× ${l.candidate.offer.product.title}\n` +
            `     ${DIM}${l.candidate.offer.supplier.name} · ${ars(l.candidate.lineTotalArs)} · ${l.rationale}${RESET}`,
        )
        .join("\n");
      return (
        `\n${GREEN}${BOLD}PROPUESTA DE COMPRA${RESET} ${DIM}${outcome.cart.cartId}${RESET}\n${rows}\n` +
        `  ${BOLD}Total ${ars(outcome.cart.totalArs)}${RESET} · entrega en ${outcome.cart.deliveryDays} día(s)\n` +
        `  ${DIM}→ pasa al equipo de pagos. Mandato leído a las ${outcome.cart.mandateReadAt}.${RESET}\n`
      );
    }
    case "escalation":
      return (
        `\n${YELLOW}${BOLD}ESCALA A UN HUMANO${RESET} (${outcome.reason})\n` +
        `  ${outcome.detail}\n` +
        `  ${DIM}Carrito propuesto: ${ars(outcome.cart.totalArs)} en ${outcome.cart.lines.length} línea(s). No se cobró nada.${RESET}\n`
      );
    case "rejection":
      return (
        `\n${RED}${BOLD}RECHAZADO${RESET} (${outcome.reason})\n  ${outcome.detail}\n` +
        `  ${DIM}No se generó carrito ni se contactó al equipo de pagos.${RESET}\n`
      );
  }
}

export function renderSuggestion(s: Suggestion): string {
  const rows = s.lines
    .map(
      (l) =>
        `  ${l.candidate.qtyPacks}× ${l.candidate.offer.product.title}\n` +
        `     ${DIM}${l.candidate.offer.supplier.name} · ${ars(l.candidate.lineTotalArs)} · ${l.rationale}${RESET}`,
    )
    .join("\n");

  const d = s.mandateDraft;
  return (
    `\n${CYAN}${BOLD}SUGERENCIA — NO SE COMPRÓ NADA${RESET} ${DIM}(${s.reason})${RESET}\n` +
    `  ${s.detail}\n\n` +
    (rows.length > 0 ? `${rows}\n  ${BOLD}Estimado ${ars(s.estimatedTotalArs)}${RESET}\n` : "  (no se encontró nada que sugerir)\n") +
    `\n  ${BOLD}Borrador de mandato para firmar${RESET}\n` +
    `  ${DIM}categorías: ${d.allowedCategories.join(", ") || "—"}\n` +
    `  presupuesto sugerido: ${ars(d.suggestedBudgetArs)}\n` +
    `  proveedores: ${d.allowedSuppliers?.join(", ") ?? "cualquiera del marketplace"}\n` +
    `  vence: ${d.expiresAt ?? "sin vencimiento"}\n` +
    `  → lo firma el humano. El agente no puede.${RESET}\n`
  );
}

export function renderRun(run: RunResult): string {
  const tail =
    run.suggestion !== null ? renderSuggestion(run.suggestion) : renderOutcome(run.outcome);
  return `${renderTrail(run.events)}\n${tail}`;
}
