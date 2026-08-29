/**
 * La cadena completa, impresa: del borrador al recibo del vendedor.
 *
 *   npx tsx src/cli/mandate-demo.ts
 *   npx tsx src/cli/mandate-demo.ts --attack=monto-inflado
 *   npx tsx src/cli/mandate-demo.ts --list
 *
 * Sin `--attack` corre el camino feliz. Con `--attack` corre un agente que
 * miente de alguna forma y muestra en qué chequeo lo agarran. Los ataques son
 * los mismos de `tests/merchant-verify.test.ts`: esto no prueba nada que los
 * tests no prueben, sólo lo hace mirable.
 */

import { FixedClock, SeqIds, createContext } from "@/agent/context.js";
import { authorize, toCheckoutRequest } from "@/agent/authorize.js";
import { toOffer, type CartDraft, type MandateDraft, type NeedSpec, type Product, type Supplier } from "@/contracts/index.js";
import { FakeMandateChain } from "@/mandate/chain.js";
import { fromMinorUnits } from "@/mandate/constraints.js";
import { closeCheckout } from "@/mandate/closed.js";
import { agente, impostor, merchant as merchantKeys, usuario } from "@/mandate/keys.js";
import { confirmMandate } from "@/mandate/open.js";
import { withheldFor } from "@/mandate/present.js";
import { signJwt } from "@/mandate/sdjwt.js";
import { Merchant } from "@/merchant/index.js";
import type {
  BuyerProfile,
  MerchantPresentation,
  PaymentInstrumentRef,
  VerificationResult,
} from "../../../shared/ap2.js";

/**
 * La tarjeta del comprador, como token.
 *
 * `pm_...` es lo que devuelve Stripe después de que el humano carga la tarjeta
 * una sola vez. Nunca vemos el número: el agente autoriza contra esta
 * referencia y nada más. Eso es "sin entregarle la tarjeta al agente".
 */
const TARJETA: PaymentInstrumentRef = { ref: "pm_demo_visa_4242", brand: "visa", last4: "4242" };

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const ars = (minor: number) => `$${fromMinorUnits(minor).toLocaleString("es-AR")}`;
const corto = (s: string, n = 20) => (s.length > n ? `${s.slice(0, n)}…` : s);

function paso(n: number, titulo: string, quien: string): void {
  console.log(`\n${BOLD}${n}. ${titulo}${RESET}  ${DIM}— ${quien}${RESET}`);
}

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-29T12:00:00.000Z");

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

function carrito(product = CAFE, supplier = PROVEEDOR, packs = 2): CartDraft {
  const offer = toOffer(product, supplier);
  return {
    cartId: "cart_1",
    intentId: "intent_1",
    mandateId: "",
    lines: [
      {
        need: NECESIDAD,
        candidate: { offer, need: NECESIDAD, kind: "exact", diffs: [], qtyPacks: packs, lineTotalArs: packs * product.priceArs },
        rationale: "Menor costo total entre las ofertas habilitadas.",
      },
    ],
    totalArs: packs * product.priceArs,
    deliveryDays: supplier.deliveryDays,
  mandateReadAt: NOW.toISOString(),
  };
}

const BORRADOR: MandateDraft = {
  naturalLanguageDescription: "comprá 2kg de café para la semana",
  allowedCategories: ["alimentos", "limpieza"],
  suggestedBudgetArs: 500_000,
  suggestedMaxPerPurchaseArs: 60_000,
  allowedSuppliers: ["distribuidora-norte"],
  maxDeliveryDays: 3,
  expiresAt: "2026-09-29T12:00:00.000Z",
  userCartConfirmationRequired: true,
};

// ---------------------------------------------------------------------------
// Ataques
// ---------------------------------------------------------------------------

type Ataque =
  | "monto-inflado"
  | "categoria-prohibida"
  | "agente-malicioso"
  | "mandato-cruzado"
  | "mandato-falso"
  | "cuit-adulterado"
  | "revocado"
  | "replay"
  | "clave-ajena";

const ATAQUES: Record<Ataque, string> = {
  "monto-inflado": "El agente rearma el carrito con otro total y lo firma él.",
  "categoria-prohibida": "El agente compra equipamiento con un mandato que sólo habilita alimentos.",
  "agente-malicioso": "El agente se saltea su propio policy engine. Sólo el vendedor puede atajarlo.",
  "mandato-cruzado": "El agente presenta la compra de hoy bajo otro mandato, de límites más amplios.",
  "mandato-falso": "Alguien que no es el comprador firma un mandato sin límites.",
  "cuit-adulterado": "El agente cambia el CUIT del comprador en los datos que entrega.",
  revocado: "El humano revoca entre la reserva y la presentación.",
  replay: "La misma presentación se cobra dos veces.",
  "clave-ajena": "Un tercero intercepta la presentación e intenta usarla.",
};

/**
 * El agente comprometido: arma la presentación a mano, sin pasar por
 * `authorize()`.
 *
 * Es el escenario que justifica que el verificador exista. Todas sus firmas son
 * válidas —tiene la clave que el humano endosó— y la reserva on-chain es real,
 * porque el contrato sólo mira montos y no sabe nada de rubros. Lo único que
 * queda entre esta compra y el cobro es que el vendedor evalúe los límites por
 * su cuenta.
 */
async function agenteMalicioso(escena: Escena): Promise<MerchantPresentation> {
  const cart = carrito({ ...CAFE, sku: "CAFETERA-PRO", title: "Cafetera industrial", category: "equipamiento", priceArs: 25_000 });

  const { checkout, nonce } = await escena.merchant.close(
    toCheckoutRequest(cart, "distribuidora-norte", "ARS"),
  );

  const reserva = await escena.chain.reserve({
    mandateId: escena.issued.mandateId,
    agent: "0xAGENTE",
    paymentDelegate: "0xDELEGADO",
    amount: checkout.payload.amount,
    action: 0,
    intentHash: "carrito-fuera-de-rubro",
    expiresAt: Math.floor(escena.clock.now().getTime() / 1000) + 600,
  });

  console.log(`   ${YELLOW}⚡ el agente NO llamó a su policy engine${RESET}`);
  console.log(`   ${DIM}la chain igual le dio la reserva ${corto(reserva.authorizationId, 20)}: el monto entraba,`);
  console.log(`   y un contrato no sabe qué es una "cafetera". Los rubros no son su problema.${RESET}`);

  const closed = closeCheckout(
    { open: escena.issued.credential, checkout, audience: "distribuidora-norte", nonce },
    agente,
    escena.clock,
  );

  return {
    open: escena.issued.credential,
    closed: closed.credential,
    kbJwt: closed.kbJwt,
    disclosures: escena.issued.disclosures.filter((d) => d.claim !== "contactoEmail"),
    authorizationId: reserva.authorizationId,
    paymentInstrument: TARJETA,
  };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.log(`\n${BOLD}Ataques disponibles${RESET}\n`);
    for (const [nombre, desc] of Object.entries(ATAQUES)) {
      console.log(`  ${CYAN}${nombre.padEnd(22)}${RESET}${DIM}${desc}${RESET}`);
    }
    console.log();
    return;
  }

  const ataque = args.find((a) => a.startsWith("--attack="))?.split("=")[1] as Ataque | undefined;
  if (ataque !== undefined && !(ataque in ATAQUES)) {
    console.error(`${RED}Ataque desconocido: "${ataque}".${RESET} Probá con --list.`);
    process.exitCode = 1;
    return;
  }

  const clock = new FixedClock(NOW);
  const chain = new FakeMandateChain(clock);
  const ctx = createContext(clock, new SeqIds());

  console.log(`\n${BOLD}chk! Buyer — mandato AP2, de punta a punta${RESET}`);
  console.log(`${DIM}Flujo "Human Not Present": el humano firma los límites y se va; el agente`);
  console.log(`compra solo; el vendedor verifica que la compra cae dentro de esos límites.${RESET}`);
  if (ataque !== undefined) {
    console.log(`\n${YELLOW}${BOLD}ATAQUE: ${ataque}${RESET}\n${YELLOW}${ATAQUES[ataque]}${RESET}`);
  }

  // -------------------------------------------------------------------------
  paso(1, "El agente redacta el borrador", "agente");
  console.log(`   ${DIM}pedido:${RESET} "${BORRADOR.naturalLanguageDescription}"`);
  console.log(`   ${DIM}rubros:${RESET} ${BORRADOR.allowedCategories.join(", ")}`);
  console.log(`   ${DIM}techos:${RESET} $${BORRADOR.suggestedMaxPerPurchaseArs.toLocaleString("es-AR")} por compra · $${BORRADOR.suggestedBudgetArs.toLocaleString("es-AR")} acumulado`);
  console.log(`   ${YELLOW}El agente puede redactarlo. No puede firmarlo.${RESET}`);

  // -------------------------------------------------------------------------
  paso(2, "El humano confirma y firma", "humano · clave del usuario");
  const issued = await confirmMandate(
    ataque === "categoria-prohibida" ? { ...BORRADOR, allowedCategories: ["alimentos"] } : BORRADOR,
    { owner: "0xCAFEDELSUR", agent: "0xAGENTE", paymentDelegate: "0xDELEGADO", currency: "ARS", paymentInstruments: [TARJETA] },
    PERFIL,
    { registry: chain, userKey: usuario, agentKey: agente, clock, supplierNames: { "distribuidora-norte": "Distribuidora Norte" } },
  );
  console.log(`   ${GREEN}✓${RESET} Open Checkout Mandate ${DIM}(mandate.checkout.open.1)${RESET}`);
  console.log(`   ${DIM}mandateId ${corto(issued.mandateId, 24)}  ·  policyHash ${corto(issued.terms.policyHash, 16)}${RESET}`);
  console.log(`   ${DIM}el mismo policyHash quedó on-chain: eso ata la credencial al contrato${RESET}`);
  console.log(`   ${DIM}datos del comprador: ${issued.credential.payload._sd.length} hashes, 0 valores en claro${RESET}`);

  // -------------------------------------------------------------------------
  const merchant = new Merchant({
    ref: { id: "distribuidora-norte", name: "Distribuidora Norte" },
    key: merchantKeys,
    clock,
    chain,
    userPublicKey: usuario.publicKey,
  });
  const escena: Escena = { chain, clock, merchant, issued, ctx };

  // El agente comprometido no pasa por el policy engine: arma la presentación
  // él mismo. Por eso se bifurca acá y no en `aplicarAtaque`.
  if (ataque === "agente-malicioso") {
    paso(3, "El agente compra FUERA de su mandato", "agente comprometido");
    const presentacion = await agenteMalicioso(escena);
    await verificar(merchant, presentacion, ataque, 4);
    return;
  }

  paso(3, "El agente compra dentro de esos límites", "agente · policy engine");

  const cart =
    ataque === "categoria-prohibida"
      ? carrito({ ...CAFE, sku: "CAFETERA-PRO", title: "Cafetera industrial", category: "equipamiento", priceArs: 25_000 })
      : carrito();

  const result = await authorize(
    {
      cart: { ...cart, mandateId: issued.mandateId },
      open: issued.credential,
      disclosures: issued.disclosures,
      merchantId: "distribuidora-norte",
      paymentInstrument: TARJETA,
    },
    { authorizations: chain, checkout: merchant, agentKey: agente, merchantPublicKey: merchantKeys.publicKey, clock },
    ctx,
  );

  if (result.status === "refused") {
    console.log(`   ${RED}✗ el propio policy engine del agente lo frena${RESET}`);
    console.log(`   ${DIM}${result.reason}: ${result.detail}${RESET}`);
    console.log(`\n${GREEN}${BOLD}No se comprometió un peso.${RESET} ${DIM}La compra ni llegó al vendedor.${RESET}\n`);
    return;
  }

  console.log(`   ${GREEN}✓${RESET} el vendedor cerró y firmó el carrito ${DIM}${result.checkout.checkoutId} · ${ars(result.checkout.amount)}${RESET}`);
  console.log(`   ${GREEN}✓${RESET} reserva on-chain ${DIM}${corto(result.presentation.authorizationId, 24)}${RESET}`);
  console.log(`   ${DIM}de un solo uso, acotada al monto y con vencimiento propio${RESET}`);
  console.log(`   ${GREEN}✓${RESET} Closed Checkout Mandate ${DIM}(mandate.checkout.1), firmado por el agente${RESET}`);

  // -------------------------------------------------------------------------
  paso(4, "Qué se le muestra al vendedor", "agente");
  console.log(`   ${GREEN}revela${RESET}  ${result.presentation.disclosures.map((d) => d.claim).join(", ")}`);
  console.log(`   ${RED}oculta${RESET}  ${withheldFor("fulfillment", issued.disclosures).join(", ")}`);
  console.log(`   ${DIM}lo oculto queda comprometido en el mandato firmado: el vendedor sabe`);
  console.log(`   que hay algo y no lo puede cambiar, pero no lo puede leer${RESET}`);

  // -------------------------------------------------------------------------
  const presentacion = await aplicarAtaque(ataque, result.presentation, escena);
  await verificar(merchant, presentacion, ataque);
}

/** El paso 5, compartido por los dos caminos: el agente honesto y el comprometido. */
async function verificar(
  merchant: Merchant,
  presentacion: MerchantPresentation,
  ataque: Ataque | undefined,
  n = 5,
): Promise<void> {
  paso(n, "El vendedor verifica, sin confiar en el agente", "vendedor");

  const veredicto: VerificationResult = await merchant.verify(presentacion);
  for (const check of veredicto.checks) {
    console.log(`   ${check.passed ? GREEN + "✓" : RED + "✗"}${RESET} ${check.check.padEnd(34)} ${DIM}${check.detail}${RESET}`);
  }

  if (ataque === "replay") {
    console.log(`\n   ${DIM}…y ahora la misma presentación, otra vez:${RESET}`);
    imprimirVeredicto(await merchant.verify(presentacion));
    return;
  }

  imprimirVeredicto(veredicto);
}

function imprimirVeredicto(veredicto: VerificationResult): void {
  if (veredicto.ok) {
    const recibo = veredicto.receipt.payload;
    console.log(`\n${GREEN}${BOLD}ACEPTADA${RESET} — recibo firmado por el vendedor`);
    console.log(`   ${DIM}reference ${corto(recibo.reference, 24)} (hash de la compra)${RESET}`);
    console.log(`   ${DIM}${ars(recibo.amount)} ${recibo.currency} · ${recibo.acceptedAt}${RESET}`);
    console.log(`\n   ${BOLD}A quién le factura:${RESET}`);
    for (const [k, v] of Object.entries(veredicto.buyer)) {
      console.log(`   ${DIM}${k.padEnd(18)}${RESET} ${v}`);
    }
    console.log();
    return;
  }

  console.log(`\n${RED}${BOLD}RECHAZADA${RESET} — ${RED}${veredicto.failure}${RESET}`);
  console.log(`   ${veredicto.detail}\n`);
}

// ---------------------------------------------------------------------------

interface Escena {
  chain: FakeMandateChain;
  clock: FixedClock;
  merchant: Merchant;
  issued: Awaited<ReturnType<typeof confirmMandate>>;
  ctx: ReturnType<typeof createContext>;
}

/** Rompe la presentación de la forma que pida el flag. Cada caso es un test de verdad. */
async function aplicarAtaque(
  ataque: Ataque | undefined,
  p: MerchantPresentation,
  escena: Escena,
): Promise<MerchantPresentation> {
  switch (ataque) {
    case undefined:
    case "categoria-prohibida":
    // Se bifurca antes de llegar acá: no pasa por el policy engine.
    case "agente-malicioso":
      return p;

    case "monto-inflado": {
      const checkout = JSON.parse(
        Buffer.from(p.closed.payload.checkout_jwt.split(".")[1]!, "base64url").toString("utf8"),
      );
      const falsificado = signJwt({ ...checkout, amount: 100 }, agente.privateKey);
      const closed = closeCheckout(
        { open: p.open, checkout: falsificado, audience: "distribuidora-norte", nonce: p.closed.payload.nonce },
        agente,
        escena.clock,
      );
      return { ...p, closed: closed.credential, kbJwt: closed.kbJwt };
    }

    case "mandato-cruzado": {
      const amplio = await confirmMandate(
        { ...BORRADOR, allowedCategories: ["alimentos", "limpieza", "equipamiento"], suggestedMaxPerPurchaseArs: 400_000 },
        { owner: "0xCAFEDELSUR", agent: "0xAGENTE", paymentDelegate: "0xDELEGADO", currency: "ARS", paymentInstruments: [TARJETA] },
        PERFIL,
        { registry: escena.chain, userKey: usuario, agentKey: agente, clock: escena.clock },
      );
      return { ...p, open: amplio.credential };
    }

    case "mandato-falso": {
      const falso = signJwt({ ...p.open.payload, constraints: [] }, impostor.privateKey);
      return { ...p, open: falso };
    }

    case "cuit-adulterado":
      return {
        ...p,
        disclosures: p.disclosures.map((d) => (d.claim === "cuit" ? { ...d, value: "30-99999999-9" } : d)),
      };

    case "revocado":
      await escena.chain.revokeMandate(escena.issued.mandateId, "0xCAFEDELSUR");
      console.log(`\n   ${YELLOW}⚡ el humano acaba de revocar el mandato${RESET}`);
      return p;

    case "replay":
      return p;

    case "clave-ajena": {
      const { signKeyBinding } = await import("@/mandate/sdjwt.js");
      return {
        ...p,
        kbJwt: signKeyBinding(
          {
            sd_hash: p.closed.payload.sd_hash,
            aud: "distribuidora-norte",
            nonce: p.closed.payload.nonce,
            iat: Math.floor(escena.clock.now().getTime() / 1000),
          },
          impostor.privateKey,
        ),
      };
    }
  }
}

main().catch((error: unknown) => {
  console.error(`${RED}${error instanceof Error ? error.stack : String(error)}${RESET}`);
  process.exitCode = 1;
});
