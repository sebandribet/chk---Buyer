/**
 * El circuito de pago, de punta a punta.
 *
 *   npm run demo:stripe                     camino completo
 *   npm run demo:stripe -- --revoke-en-hold revocar con la plata retenida
 *   npm run demo:stripe -- --declina        el emisor rechaza
 *   npm run demo:stripe -- --disputa        el titular desconoce el cobro
 *   npm run demo:stripe -- --offline        sin red, con el proveedor en memoria
 *
 * Sin `STRIPE_SECRET_KEY` corre en modo offline solo, y lo dice. Eso no es un
 * degradado triste: es el seguro. El challenge se juzga con los jueces operando
 * el sistema en vivo, y una demo que depende de que ande el wifi del evento no
 * es una demo defendible.
 */

import { FixedClock, SeqIds, createContext } from "@/agent/context.js";
import { authorize } from "@/agent/authorize.js";
import { toOffer, type CartDraft, type MandateDraft, type NeedSpec, type Product, type Supplier } from "@/contracts/index.js";
import { FakeMandateChain } from "@/mandate/chain.js";
import { agente, merchant as merchantKeys, usuario } from "@/mandate/keys.js";
import { confirmForm, editForm, openForReview, reviewSummary } from "@/mandate/form.js";
import { confirmMandate } from "@/mandate/open.js";
import { Merchant } from "@/merchant/index.js";
import { FakeDisputePort, StripeDisputePort } from "@/payments/disputes.js";
import { FakePaymentPort } from "@/payments/fake.js";
import { ARS_POR_USD, formatMoney } from "@/payments/fx.js";
import { StripePaymentPort } from "@/payments/stripe.js";
import { buildDisputeEvidence, TEST_MODE_OUTCOME } from "@/settlement/dispute.js";
import { Settlement } from "@/settlement/index.js";
import { renderTrail } from "./render.js";
import type { BuyerProfile, PaymentInstrumentRef } from "../../../shared/ap2.js";
import type { DisputePort, PaymentPort } from "../../../shared/payments.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const corto = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n)}…` : s);

function paso(n: number, titulo: string, quien: string): void {
  console.log(`\n${BOLD}${n}. ${titulo}${RESET}  ${DIM}— ${quien}${RESET}`);
}

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

const PERFIL: BuyerProfile = {
  razonSocial: "Café del Sur S.R.L.",
  cuit: "30-71234567-4",
  direccionEntrega: "Av. Corrientes 1234, CABA",
  contactoNombre: "Marina Ferreyra",
  contactoEmail: "marina.personal@gmail.com",
  contactoTelefono: "+54 11 4567-8901",
};

const PROVEEDOR: Supplier = {
  id: "distribuidora-norte",
  name: "Distribuidora Norte",
  deliveryDays: 2,
  minOrderArs: 10_000,
  rating: 4.5,
};

const CAFE: Product = {
  sku: "CAFE-1KG",
  supplierId: PROVEEDOR.id,
  canonical: "café",
  title: "Café en grano 1kg",
  brand: "Tostado Sur",
  attrs: {},
  category: "alimentos",
  presentation: { unit: "kg", sizePerPack: 1, packQty: 1 },
  priceArs: 18_500,
  stock: 40,
};

const NECESIDAD: NeedSpec = { canonical: "café", attrs: {}, qty: 2, unit: "kg", substitutesAllowed: false };

const PROMPT = "comprá 2kg de café para la semana";

const BORRADOR: MandateDraft = {
  naturalLanguageDescription: PROMPT,
  allowedCategories: ["alimentos", "limpieza"],
  suggestedBudgetArs: 500_000,
  suggestedMaxPerPurchaseArs: 60_000,
  allowedSuppliers: ["distribuidora-norte"],
  maxDeliveryDays: 3,
  expiresAt: "2026-09-29T12:00:00.000Z",
  userCartConfirmationRequired: true,
};

function carrito(clock: FixedClock): CartDraft {
  const offer = toOffer(CAFE, PROVEEDOR);
  return {
    cartId: "cart_1",
    intentId: "intent_1",
    mandateId: "",
    lines: [
      {
        need: NECESIDAD,
        candidate: { offer, need: NECESIDAD, kind: "exact", diffs: [], qtyPacks: 2, lineTotalArs: 37_000 },
        rationale: "Menor costo total entre las ofertas habilitadas.",
      },
    ],
    totalArs: 37_000,
    deliveryDays: 2,
    mandateReadAt: clock.now().toISOString(),
  };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const revocarEnHold = args.includes("--revoke-en-hold");
  const declina = args.includes("--declina");
  const conDisputa = args.includes("--disputa");

  const key = process.env["STRIPE_SECRET_KEY"] ?? "";
  const offline = args.includes("--offline") || key === "";

  // El reloj de la demo es el de verdad: contra Stripe real, un reloj congelado
  // en 2026 produciría vencimientos que su API rechaza.
  const clock = new FixedClock(new Date());
  const chain = new FakeMandateChain(clock);
  const ctx = createContext(clock, new SeqIds());

  console.log(`\n${BOLD}chk! Buyer — el circuito de pago${RESET}`);
  if (offline) {
    console.log(
      key === ""
        ? `${YELLOW}Sin STRIPE_SECRET_KEY: corre con el proveedor en memoria.${RESET}\n${DIM}Poné la key en agent/.env para pegarle a Stripe de verdad.${RESET}`
        : `${YELLOW}Modo offline pedido: proveedor en memoria, cero red.${RESET}`,
    );
  } else {
    console.log(`${CYAN}Contra Stripe (test mode). Los PaymentIntent quedan en el dashboard.${RESET}`);
  }

  // La tarjeta. Con Stripe de verdad hace falta un `pm_...` real: se crea una
  // vez con la Payment Element y a partir de ahí el agente sólo ve el token.
  const tarjeta: PaymentInstrumentRef = declina
    ? { ref: offline ? "pm_test_declined" : (process.env["STRIPE_PM_DECLINED"] ?? "pm_card_visa_chargeDeclined"), brand: "visa", last4: "0002" }
    : { ref: offline ? "pm_test_visa_4242" : (process.env["STRIPE_PM"] ?? "pm_card_visa"), brand: "visa", last4: "4242" };

  const pagos: PaymentPort = offline
    ? new FakePaymentPort(clock)
    : new StripePaymentPort({ secretKey: key, clock });

  // -------------------------------------------------------------------------
  paso(1, "El agente redacta, el humano revisa y edita", "agente → humano");
  console.log(`   ${DIM}el agente propone a partir de: "${PROMPT}"${RESET}`);

  // El agente redacta el primer borrador —eso es lo que ahorra tiempo— pero
  // quien decide es la persona. Acá el humano baja el presupuesto: el mandato
  // que se firma es el suyo, no el que le propusieron.
  const revisado = editForm(openForReview(BORRADOR), { suggestedBudgetArs: 300_000 });

  for (const campo of reviewSummary(revisado)) {
    const marca = campo.edited ? `${YELLOW}editado${RESET}` : `${DIM}como venía${RESET}`;
    console.log(`   ${campo.edited ? YELLOW + "✎" : DIM + "·"}${RESET} ${campo.field.padEnd(30)} ${JSON.stringify(campo.value)}  ${marca}`);
  }

  const confirmado = confirmForm(revisado, clock.now());
  console.log(`   ${GREEN}✓${RESET} confirmado por el humano ${DIM}(cambió: ${confirmado.review.editedFields.join(", ") || "nada"})${RESET}`);

  paso(2, "El humano firma", "humano · clave del usuario");
  const issued = await confirmMandate(
    confirmado,
    {
      owner: "0xCAFEDELSUR",
      agent: "0xAGENTE",
      paymentDelegate: "0xDELEGADO",
      currency: "ARS",
      paymentInstruments: [tarjeta],
    },
    PERFIL,
    { registry: chain, userKey: usuario, agentKey: agente, clock, supplierNames: { "distribuidora-norte": "Distribuidora Norte" } },
  );
  console.log(`   ${GREEN}✓${RESET} límites firmados: alimentos/limpieza · $60.000 por compra · $300.000 en total`);
  console.log(`   ${GREEN}✓${RESET} medio de pago: ${BOLD}${tarjeta.brand} ····${tarjeta.last4}${RESET} ${DIM}(token ${corto(tarjeta.ref, 22)})${RESET}`);
  console.log(`   ${DIM}la tarjeta entra al mandato como TOKEN. Ni el agente ni nosotros vemos el número.${RESET}`);

  // -------------------------------------------------------------------------
  paso(3, "El agente compra y el vendedor verifica", "agente · vendedor");
  const merchant = new Merchant({
    ref: { id: "distribuidora-norte", name: "Distribuidora Norte" },
    key: merchantKeys,
    clock,
    chain,
    userPublicKey: usuario.publicKey,
  });

  const result = await authorize(
    {
      cart: { ...carrito(clock), mandateId: issued.mandateId },
      open: issued.credential,
      disclosures: issued.disclosures,
      merchantId: "distribuidora-norte",
      paymentInstrument: tarjeta,
    },
    { authorizations: chain, checkout: merchant, agentKey: agente, merchantPublicKey: merchantKeys.publicKey, clock },
    ctx,
  );

  if (result.status !== "authorized") {
    console.log(`   ${RED}✗ ${result.reason}: ${result.detail}${RESET}\n`);
    return;
  }

  const veredicto = await merchant.verify(result.presentation);
  if (!veredicto.ok) {
    console.log(`   ${RED}✗ el vendedor rechazó: ${veredicto.failure}${RESET}\n   ${veredicto.detail}\n`);
    return;
  }
  console.log(`   ${GREEN}✓${RESET} ${veredicto.checks.length} chequeos del vendedor, todos en verde`);
  console.log(`   ${GREEN}✓${RESET} reserva on-chain ${DIM}${corto(result.presentation.authorizationId)}${RESET}`);

  // -------------------------------------------------------------------------
  paso(4, "Se retiene la plata — pero NO se mueve", `delegado de pago · ${pagos.provider}`);
  const settlement = new Settlement({
    payments: pagos,
    chain,
    settlement: chain,
    authorizations: chain,
    paymentDelegate: "0xDELEGADO",
    clock,
    audit: ctx.audit,
  });

  const held = await settlement.hold({
    authorizationId: result.presentation.authorizationId,
    instrument: tarjeta,
    merchantId: "distribuidora-norte",
    intentHash: result.presentation.closed.payload.checkout_hash,
  });

  if (held.status !== "held") {
    console.log(`   ${RED}✗ ${held.reason}${RESET} ${held.code === undefined ? "" : `(${held.code})`}`);
    console.log(`   ${DIM}${held.detail}${RESET}`);
    console.log(
      `\n${GREEN}${BOLD}No se movió un peso${RESET} ${DIM}y la reserva on-chain se canceló: el presupuesto vuelve a estar disponible.${RESET}\n`,
    );
    return;
  }

  console.log(`   ${GREEN}✓${RESET} ${BOLD}${formatMoney(held.hold.authorized)}${RESET} ${DIM}→ ${formatMoney(held.hold.charged)} (tasa ${ARS_POR_USD})${RESET}`);
  console.log(`   ${DIM}${held.hold.holdRef}  ·  estado: ${held.hold.status}${RESET}`);
  console.log(`   ${YELLOW}${BOLD}La plata está comprometida y sigue en la cuenta del comprador.${RESET}`);
  console.log(`   ${YELLOW}Esta es la ventana en la que revocar todavía sirve.${RESET}`);

  // -------------------------------------------------------------------------
  if (revocarEnHold) {
    console.log(`\n   ${YELLOW}${BOLD}⚡ el humano revoca el mandato — ahora mismo${RESET}`);
    await chain.revokeMandate(issued.mandateId, "0xCAFEDELSUR");
  }

  paso(5, "Se cobra", `delegado de pago · ${pagos.provider}`);
  const cobro = await settlement.capture(result.presentation.authorizationId, held.hold.holdRef);

  if (cobro.status !== "captured") {
    console.log(`   ${RED}✗ no se cobró${RESET} ${DIM}(${cobro.reason})${RESET}`);
    console.log(`   ${cobro.detail}`);

    const estado = await pagos.read(held.hold.holdRef);
    console.log(`\n   ${BOLD}Estado de la retención:${RESET} ${estado?.status ?? "(no se pudo leer)"}`);
    console.log(`   ${BOLD}Gastado del mandato:${RESET} $${(await chain.read(issued.mandateId)).budgetSpentArs.toLocaleString("es-AR")}`);
    console.log(
      `\n${GREEN}${BOLD}La plata nunca se movió.${RESET}\n${DIM}La credencial seguía firmada y era auténtica. Lo que cambió fue el estado`,
    );
    console.log(`${DIM}on-chain, y por eso revocar sirve incluso con la compra ya en curso.${RESET}\n`);
    return;
  }

  console.log(`   ${GREEN}${BOLD}✓ cobrado${RESET} ${formatMoney({ minor: cobro.capturedMinor, currency: cobro.capturedCurrency })}`);
  console.log(`   ${DIM}${cobro.captureRef}${RESET}`);
  console.log(`   ${DIM}gastado del mandato: $${(await chain.read(issued.mandateId)).budgetSpentArs.toLocaleString("es-AR")} de $500.000${RESET}`);

  // -------------------------------------------------------------------------
  if (conDisputa) {
    paso(6, 'El titular dice "yo no autoricé esto"', "disputa");

    const disputas: DisputePort = offline
      ? new FakeDisputePort(clock)
      : new StripeDisputePort({ secretKey: key, testOutcome: "gana" });

    const disputa = offline
      ? (disputas as FakeDisputePort).open(cobro.captureRef, {
          minor: cobro.capturedMinor,
          currency: cobro.capturedCurrency,
        })
      : (await disputas.list()).find((d) => d.captureRef === cobro.captureRef);

    if (disputa === undefined) {
      console.log(`   ${YELLOW}Todavía no hay disputa para ese cobro.${RESET}`);
      console.log(`   ${DIM}Con Stripe real hay que cobrar con la tarjeta 4000000000000259, que dispara`);
      console.log(`   una disputa auténtica, y esperar unos segundos a que aparezca.${RESET}\n`);
      return;
    }

    console.log(`   ${RED}disputa ${disputa.disputeRef}${RESET} ${DIM}· motivo: ${disputa.reason} · estado: ${disputa.status}${RESET}`);

    const evidencia = buildDisputeEvidence({
      presentation: result.presentation,
      receipt: veredicto.receipt,
      prompt: PROMPT,
      events: ctx.audit.events(),
    });

    console.log(`\n   ${BOLD}La evidencia ya existía desde antes de la compra:${RESET}`);
    console.log(`   ${GREEN}·${RESET} el mandato, ${BOLD}firmado por él${RESET} ${DIM}(${evidencia.customerSignature.length} bytes de JWT verificable)${RESET}`);
    console.log(`   ${GREEN}·${RESET} su pedido textual: ${DIM}"${evidencia.customerCommunication}"${RESET}`);
    console.log(`   ${GREEN}·${RESET} el recibo firmado por el vendedor`);
    console.log(`   ${GREEN}·${RESET} el trail completo ${DIM}(${ctx.audit.events().length} eventos)${RESET}`);

    const resuelta = await disputas.submitEvidence(
      disputa.disputeRef,
      offline
        ? { ...evidencia, uncategorizedText: `${TEST_MODE_OUTCOME.gana}\n${evidencia.uncategorizedText}` }
        : evidencia,
    );

    console.log(
      `\n   ${resuelta.status === "won" ? GREEN + BOLD + "GANADA" : YELLOW + resuelta.status.toUpperCase()}${RESET}`,
    );
    console.log(`   ${DIM}Si la cadena de hashes cierra, o el titular autorizó la compra o entregó`);
    console.log(`   su clave privada. Las dos son responsabilidad suya, ninguna del comercio.${RESET}`);
  }

  if (args.includes("--trail")) {
    console.log(`\n${BOLD}Trail completo${RESET}\n${renderTrail(ctx.audit.events())}`);
  }

  console.log();
}

main().catch((error: unknown) => {
  console.error(`${RED}${error instanceof Error ? error.stack : String(error)}${RESET}`);
  process.exitCode = 1;
});
