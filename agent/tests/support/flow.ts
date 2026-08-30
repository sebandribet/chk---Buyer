/**
 * Un flujo completo armado a mano, para atacarlo.
 *
 * No usa `runAgent` a propósito: extraer el intent con un modelo mete
 * variabilidad y fixtures en unos tests que son sobre criptografía y control de
 * acceso. Acá lo que hace falta es un `CartDraft` concreto y un mandato firmado
 * de verdad, y ninguna de las dos cosas necesita al modelo.
 */

import { FixedClock, SeqIds, createContext } from "@/agent/context.js";
import { toOffer, type CartDraft, type CartLine, type NeedSpec, type Product, type Supplier } from "@/contracts/index.js";
import { FakeMandateChain } from "@/mandate/chain.js";
import { agente, merchant as merchantKeys, usuario } from "@/mandate/keys.js";
import { confirmForm, editForm, openForReview } from "@/mandate/form.js";
import { confirmMandate, type IssuedMandate, type MandateIdentity } from "@/mandate/open.js";
import { Merchant } from "@/merchant/index.js";
import type { MandateDraft } from "@/contracts/index.js";
import type { BuyerProfile, PaymentInstrumentRef } from "../../../shared/ap2.js";

/** La tarjeta autorizada. Token del proveedor, nunca un PAN. */
export const TARJETA: PaymentInstrumentRef = { ref: "pm_test_visa_4242", brand: "visa", last4: "4242" };

/** Otra tarjeta del mismo humano, que el mandato NO autoriza. */
export const OTRA_TARJETA: PaymentInstrumentRef = { ref: "pm_test_amex_0005", brand: "amex", last4: "0005" };

export const NOW = new Date("2026-08-29T12:00:00.000Z");

export const PERFIL: BuyerProfile = {
  razonSocial: "Café del Sur S.R.L.",
  cuit: "30-71234567-4",
  direccionEntrega: "Av. Corrientes 1234, CABA",
  contactoNombre: "Marina Ferreyra",
  contactoEmail: "compras@cafedelsur.ar",
  contactoTelefono: "+54 11 4567-8901",
};

export const IDENTIDAD: MandateIdentity = {
  owner: "0xCAFEDELSUR",
  agent: "0xAGENTE",
  paymentDelegate: "0xDELEGADO",
  currency: "ARS",
  paymentInstruments: [TARJETA],
};

const PROVEEDOR: Supplier = {
  id: "distribuidora-norte",
  name: "Distribuidora Norte",
  deliveryDays: 2,
  minOrderArs: 10_000,
  rating: 4.5,
};

function producto(overrides: Partial<Product> = {}): Product {
  return {
    sku: "CAFE-1KG",
    supplierId: PROVEEDOR.id,
    canonical: "café",
    title: "Café en grano 1kg",
    brand: "Tostado Sur",
    attrs: {},
    category: "food",
    presentation: { unit: "kg", sizePerPack: 1, packQty: 1 },
    priceArs: 18_500,
    stock: 40,
    ...overrides,
  };
}

function necesidad(): NeedSpec {
  return { canonical: "café", attrs: {}, qty: 2, unit: "kg", substitutesAllowed: false };
}

function linea(product: Product, packs: number): CartLine {
  const offer = toOffer(product, PROVEEDOR);
  return {
    need: necesidad(),
    candidate: {
      offer,
      need: necesidad(),
      kind: "exact",
      diffs: [],
      qtyPacks: packs,
      lineTotalArs: packs * product.priceArs,
    },
    rationale: "Única oferta habilitada.",
  };
}

export function carrito(lines: CartLine[] = [linea(producto(), 2)]): CartDraft {
  return {
    cartId: "cart_1",
    intentId: "intent_1",
    mandateId: "(se completa al firmar)",
    lines,
    totalArs: lines.reduce((acc, l) => acc + l.candidate.lineTotalArs, 0),
    deliveryDays: 2,
    mandateReadAt: NOW.toISOString(),
  };
}

/** Un carrito con un ítem de una categoría que el mandato no habilita. */
export function carritoConEquipamiento(): CartDraft {
  return carrito([
    linea(producto(), 1),
    linea(producto({ sku: "CAFETERA-PRO", title: "Cafetera industrial", category: "equipment", priceArs: 42_000 }), 1),
  ]);
}

const PROVEEDOR_AJENO: Supplier = {
  id: "proveedor-fantasma",
  name: "Proveedor Fantasma",
  deliveryDays: 2,
  minOrderArs: 0,
  rating: 3,
};

/**
 * Un carrito surtido por un proveedor que el mandato no habilita.
 *
 * El proveedor se cambia en el `Supplier` de la oferta y no sólo en el
 * `supplierId` del producto: el carrito que viaja se arma desde
 * `offer.supplier.id`, así que tocar sólo el producto produce un fixture
 * inconsistente que no prueba nada.
 */
export function carritoConProveedorAjeno(): CartDraft {
  const product = producto({ supplierId: PROVEEDOR_AJENO.id });
  const offer = toOffer(product, PROVEEDOR_AJENO);

  return carrito([
    {
      need: necesidad(),
      candidate: { offer, need: necesidad(), kind: "exact", diffs: [], qtyPacks: 2, lineTotalArs: 2 * product.priceArs },
      rationale: "Fixture: proveedor fuera del mandato.",
    },
  ]);
}

export function borrador(overrides: Partial<MandateDraft> = {}): MandateDraft {
  return {
    naturalLanguageDescription: "comprá 2kg de café para la semana",
    allowedCategories: ["food", "cleaning"],
    suggestedBudgetArs: 500_000,
    suggestedMaxPerPurchaseArs: 60_000,
    allowedSuppliers: ["distribuidora-norte"],
    maxDeliveryDays: 3,
    expiresAt: "2026-09-29T12:00:00.000Z",
    userCartConfirmationRequired: true,
    ...overrides,
  };
}

export interface Escena {
  clock: FixedClock;
  chain: FakeMandateChain;
  merchant: Merchant;
  issued: IssuedMandate;
  ctx: ReturnType<typeof createContext>;
  authorizeDeps: {
    authorizations: FakeMandateChain;
    checkout: Merchant;
    agentKey: typeof agente;
    merchantPublicKey: typeof merchantKeys.publicKey;
    clock: FixedClock;
  };
}

/**
 * Monta todo: chain, mandato firmado, vendedor.
 *
 * Pasa por la revisión aunque sea un fixture, porque no hay otra forma: el
 * mandato no se puede firmar sin que el humano confirme el formulario, y eso lo
 * impone el tipo. Que los tests tampoco puedan saltearlo es la prueba de que la
 * garantía es real.
 */
export async function montar(
  draft: MandateDraft = borrador(),
  edits: Partial<MandateDraft> = {},
): Promise<Escena> {
  const clock = new FixedClock(NOW);
  const chain = new FakeMandateChain(clock);

  const confirmado = confirmForm(editForm(openForReview(draft), edits), NOW);

  const issued = await confirmMandate(confirmado, IDENTIDAD, PERFIL, {
    registry: chain,
    userKey: usuario,
    agentKey: agente,
    clock,
    supplierNames: { "distribuidora-norte": "Distribuidora Norte" },
  });

  const merchant = new Merchant({
    ref: { id: "distribuidora-norte", name: "Distribuidora Norte" },
    key: merchantKeys,
    clock,
    chain,
    userPublicKey: usuario.publicKey,
  });

  return {
    clock,
    chain,
    merchant,
    issued,
    ctx: createContext(clock, new SeqIds()),
    authorizeDeps: {
      authorizations: chain,
      checkout: merchant,
      agentKey: agente,
      merchantPublicKey: merchantKeys.publicKey,
      clock,
    },
  };
}
