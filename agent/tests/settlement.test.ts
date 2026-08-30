/**
 * El settlement: donde la autorización se convierte en plata movida.
 *
 * El test que vale por todos es "revocar entre el hold y el capture". Es lo que
 * los jueces van a hacer en vivo, y es la única prueba de que la revocación no
 * es un cartel en una pantalla: hay una retención real sobre una tarjeta real,
 * el humano revoca, y esa retención se suelta sin que se mueva un peso.
 *
 * El resto de los tests están para que ese no sea un caso afortunado: que el
 * monto salga de la chain y no del agente, que un cobro fallido devuelva el
 * presupuesto, que no se cobre dos veces.
 */

import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "@/payments/fake.js";
import { Settlement } from "@/settlement/index.js";
import { ARS_POR_USD } from "@/payments/fx.js";
import { authorize } from "@/agent/authorize.js";
import { carrito, IDENTIDAD, montar, TARJETA } from "./support/flow.js";

/** Monta la escena completa y deja una compra autorizada, lista para cobrar. */
async function conCompraAutorizada() {
  const escena = await montar();

  const result = await authorize(
    {
      cart: { ...carrito(), mandateId: escena.issued.mandateId },
      open: escena.issued.credential,
      disclosures: escena.issued.disclosures,
      merchantId: "distribuidora-norte",
      paymentInstrument: TARJETA,
    },
    escena.authorizeDeps,
    escena.ctx,
  );
  if (result.status !== "authorized") throw new Error(`No autorizó: ${result.detail}`);

  const pagos = new FakePaymentPort(escena.clock);
  const settlement = new Settlement({
    payments: pagos,
    chain: escena.chain,
    settlement: escena.chain,
    authorizations: escena.chain,
    paymentDelegate: IDENTIDAD.paymentDelegate,
    clock: escena.clock,
    audit: escena.ctx.audit,
  });

  return {
    ...escena,
    pagos,
    settlement,
    presentation: result.presentation,
    checkout: result.checkout,
    pedido: {
      authorizationId: result.presentation.authorizationId,
      instrument: TARJETA,
      merchantId: "distribuidora-norte",
      intentHash: result.presentation.closed.payload.checkout_hash,
    },
  };
}

describe("el circuito completo", () => {
  it("retiene, cobra y descuenta del presupuesto", async () => {
    const e = await conCompraAutorizada();

    const held = await e.settlement.hold(e.pedido);
    expect(held.status).toBe("held");
    if (held.status !== "held") return;

    // Antes de cobrar: el presupuesto todavía no bajó. Está reservado, no gastado.
    expect((await e.chain.read(e.issued.mandateId)).budgetSpentArs).toBe(0);

    const cobro = await e.settlement.capture(e.pedido.authorizationId, held.hold.holdRef);
    expect(cobro.status).toBe("captured");

    // Después: el contrato registra lo que se gastó de verdad.
    expect((await e.chain.read(e.issued.mandateId)).budgetSpentArs).toBe(37_000);
  });

  it("el monto sale de la chain, no de lo que trajo el agente", async () => {
    const e = await conCompraAutorizada();
    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "held") throw new Error("debía retener");

    // El humano firmó pesos; se le retiene en dólares. Las dos cifras quedan
    // juntas, y la de pesos es la de la reserva on-chain.
    expect(held.hold.authorized).toEqual({ minor: 3_700_000, currency: "ars" });
    expect(held.hold.charged.currency).toBe("usd");
    expect(held.hold.fxRate).toBe(ARS_POR_USD);
    expect(e.pagos.authorizationOf(held.hold.holdRef)).toBe(e.pedido.authorizationId);
  });

  it("deja el rastro con las dos monedas", async () => {
    const e = await conCompraAutorizada();
    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "held") return;
    await e.settlement.capture(e.pedido.authorizationId, held.hold.holdRef);

    const eventos = e.ctx.audit.events();
    const autorizado = eventos.find((ev) => ev.type === "payment_authorized");
    const cobrado = eventos.find((ev) => ev.type === "payment_captured");

    expect(autorizado).toMatchObject({ authorizedCurrency: "ars", chargedCurrency: "usd" });
    expect(cobrado).toBeDefined();
  });
});

describe("revocación en vivo", () => {
  it("revocar entre el hold y el capture libera la plata sin moverla", async () => {
    const e = await conCompraAutorizada();

    const held = await e.settlement.hold(e.pedido);
    expect(held.status).toBe("held");
    if (held.status !== "held") return;
    expect(held.hold.status).toBe("requires_capture");

    // ── acá el juez aprieta "revocar" ──
    await e.chain.revokeMandate(e.issued.mandateId, IDENTIDAD.owner);

    const cobro = await e.settlement.capture(e.pedido.authorizationId, held.hold.holdRef);

    expect(cobro.status).toBe("refused");
    if (cobro.status !== "refused") return;
    expect(cobro.reason).toBe("mandate_not_usable");

    // Lo que importa de verdad: la retención se soltó y no se gastó un peso.
    expect((await e.pagos.read(held.hold.holdRef))?.status).toBe("released");
    expect((await e.chain.read(e.issued.mandateId)).budgetSpentArs).toBe(0);
    expect(e.pagos.captureRefOf(held.hold.holdRef)).toBeNull();
  });

  it("revocar antes del hold ni siquiera le pregunta al banco", async () => {
    const e = await conCompraAutorizada();
    await e.chain.revokeMandate(e.issued.mandateId, IDENTIDAD.owner);

    const held = await e.settlement.hold(e.pedido);

    expect(held.status).toBe("refused");
    if (held.status !== "refused") return;
    expect(held.reason).toBe("mandate_not_usable");
    // No se le pide autorización a un emisor por una compra que ya no está permitida.
    expect(e.ctx.audit.events().some((ev) => ev.type === "payment_authorized")).toBe(false);
  });

  it("revocar DESPUÉS de cobrar ya no puede deshacer la plata", async () => {
    const e = await conCompraAutorizada();
    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "held") return;
    await e.settlement.capture(e.pedido.authorizationId, held.hold.holdRef);

    await e.chain.revokeMandate(e.issued.mandateId, IDENTIDAD.owner);

    // Es honesto y hay que poder decirlo: revocar corta lo que viene, no
    // devuelve lo que ya se pagó. Para eso está el reembolso, que es otra cosa.
    expect((await e.pagos.read(held.hold.holdRef))?.status).toBe("captured");
    expect((await e.chain.read(e.issued.mandateId)).budgetSpentArs).toBe(37_000);
  });
});

describe("el proveedor dice que no", () => {
  it("una tarjeta rechazada devuelve el presupuesto", async () => {
    const e = await conCompraAutorizada();
    e.pagos.failWith("card_declined");

    const held = await e.settlement.hold(e.pedido);

    expect(held.status).toBe("refused");
    if (held.status !== "refused") return;
    expect(held.reason).toBe("payment_declined");

    // La reserva se cancela: dejarla viva inmovilizaría presupuesto por una
    // compra que no va a ocurrir, y el humano no sabría por qué le falta saldo.
    expect((await e.chain.readAuthorization(e.pedido.authorizationId))?.active).toBe(false);
  });

  it("distingue sin fondos de tarjeta bloqueada", async () => {
    const e = await conCompraAutorizada();
    e.pagos.failWith("insufficient_funds");

    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "refused") throw new Error("debía rechazar");

    // El motivo llega hasta el humano: "no hay plata" se resuelve distinto que
    // "la tarjeta está bloqueada".
    expect(held.code).toBe("insufficient_funds");
  });

  it("una compra que necesita al humano falla diciendo eso", async () => {
    const e = await conCompraAutorizada();
    e.pagos.failWith("authentication_required");

    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "refused") throw new Error("debía rechazar");

    // No es un bug del agente: hay compras que un agente no puede completar solo.
    expect(held.code).toBe("authentication_required");
  });
});

describe("reservas inválidas", () => {
  it("no cobra sin reserva on-chain", async () => {
    const e = await conCompraAutorizada();

    const held = await e.settlement.hold({ ...e.pedido, authorizationId: "0xinventado" });

    expect(held.status).toBe("refused");
    if (held.status !== "refused") return;
    expect(held.reason).toBe("authorization_invalid");
  });

  it("no cobra con una reserva vencida", async () => {
    const e = await conCompraAutorizada();
    e.clock.advance(11 * 60_000);

    const held = await e.settlement.hold(e.pedido);

    expect(held.status).toBe("refused");
    if (held.status !== "refused") return;
    expect(held.reason).toBe("authorization_invalid");
  });

  it("una reserva ya consumida no se cobra de nuevo", async () => {
    const e = await conCompraAutorizada();
    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "held") return;
    await e.settlement.capture(e.pedido.authorizationId, held.hold.holdRef);

    // El presupuesto se descuenta una sola vez. Cobrar dos veces la misma
    // compra es el fraude más obvio de todo el sistema.
    const segunda = await e.settlement.capture(e.pedido.authorizationId, held.hold.holdRef);
    expect(segunda.status).toBe("refused");
    expect((await e.chain.read(e.issued.mandateId)).budgetSpentArs).toBe(37_000);
  });
});

describe("abandonar", () => {
  it("suelta la retención y devuelve el presupuesto", async () => {
    const e = await conCompraAutorizada();
    const held = await e.settlement.hold(e.pedido);
    if (held.status !== "held") return;

    await e.settlement.abort(e.pedido.authorizationId, held.hold.holdRef, "el vendedor no tiene stock");

    expect((await e.pagos.read(held.hold.holdRef))?.status).toBe("released");
    expect((await e.chain.readAuthorization(e.pedido.authorizationId))?.active).toBe(false);
    expect((await e.chain.read(e.issued.mandateId)).budgetSpentArs).toBe(0);
  });
});
