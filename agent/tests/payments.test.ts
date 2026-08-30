/**
 * El puerto de pagos.
 *
 * Los tests que importan no son los del cobro feliz: son los que prueban que no
 * se puede cobrar dos veces, que no se puede cobrar más de lo autorizado, y que
 * un cobro hecho no se puede hacer desaparecer llamándolo "liberación". Cada uno
 * de esos es plata que se mueve mal si el puerto los deja pasar.
 */

import { describe, expect, it } from "vitest";
import { FixedClock } from "@/agent/context.js";
import { FakePaymentPort } from "@/payments/fake.js";
import { ARS_POR_USD, formatMoney, toProviderCurrency } from "@/payments/fx.js";
import { PaymentError, type AuthorizeChargeRequest } from "../../shared/payments.js";

const NOW = new Date("2026-08-29T12:00:00.000Z");

function pedido(overrides: Partial<AuthorizeChargeRequest> = {}): AuthorizeChargeRequest {
  return {
    instrumentRef: "pm_test_visa_4242",
    amount: { minor: 3_700_000, currency: "ars" },
    merchantId: "distribuidora-norte",
    authorizationId: "0xauth",
    intentHash: "hash-del-carrito",
    expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    idempotencyKey: "clave-1",
    ...overrides,
  };
}

function setup() {
  const clock = new FixedClock(NOW);
  return { clock, pagos: new FakePaymentPort(clock) };
}

describe("conversión de moneda", () => {
  it("convierte ARS a USD con la tasa declarada", () => {
    const c = toProviderCurrency({ minor: 3_700_000, currency: "ars" }, "usd");

    expect(c.rate).toBe(ARS_POR_USD);
    expect(c.to.currency).toBe("usd");
    expect(c.to.minor).toBe(Math.ceil(3_700_000 / ARS_POR_USD));
  });

  it("no convierte si ya está en la moneda del proveedor", () => {
    const c = toProviderCurrency({ minor: 1000, currency: "usd" }, "usd");
    expect(c.rate).toBe(1);
    expect(c.to).toEqual(c.from);
  });

  it("redondea hacia arriba: nunca se cobra menos de lo que cuesta", () => {
    // Un centavo de más en dólares es tolerable; uno de menos deja al comercio
    // cobrando por debajo del precio, y eso no lo puede decidir el redondeo.
    const c = toProviderCurrency({ minor: ARS_POR_USD + 1, currency: "ars" }, "usd");
    expect(c.to.minor).toBe(2);
  });

  it("se niega a inventar una tasa que nadie definió", () => {
    // Fallar es lo correcto. Un default silencioso acá sería convertir plata
    // real con un número que nadie eligió.
    expect(() => toProviderCurrency({ minor: 100, currency: "eur" }, "usd")).toThrow(/tasa definida/);
  });

  it("formatea para que lo lea una persona", () => {
    expect(formatMoney({ minor: 3_700_000, currency: "ars" })).toBe("ARS $37.000,00");
  });
});

describe("autorizar", () => {
  it("retiene sin cobrar, y las dos monedas viajan juntas", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());

    // `requires_capture` es el estado que importa: hay plata comprometida y
    // todavía no se movió.
    expect(hold.status).toBe("requires_capture");
    expect(hold.authorized).toEqual({ minor: 3_700_000, currency: "ars" });
    expect(hold.charged.currency).toBe("usd");
    expect(hold.fxRate).toBe(ARS_POR_USD);
  });

  it("guarda contra qué reserva on-chain se autorizó", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido({ authorizationId: "0xreserva-real" }));

    // Es el puente entre el proveedor de pagos y el mandato. Sin esto, una
    // disputa se contesta con capturas de pantalla.
    expect(pagos.authorizationOf(hold.holdRef)).toBe("0xreserva-real");
  });

  it("la tarjeta rechazada no produce hold", async () => {
    const { pagos } = setup();
    await expect(pagos.authorize(pedido({ instrumentRef: "pm_test_declined" }))).rejects.toThrow(
      PaymentError,
    );
  });

  it("distingue fondos insuficientes de un rechazo genérico", async () => {
    const { pagos } = setup();
    // El motivo importa: "no hay plata" se le informa al humano de una forma y
    // "la tarjeta está bloqueada" de otra.
    await expect(
      pagos.authorize(pedido({ instrumentRef: "pm_test_insufficient" })),
    ).rejects.toMatchObject({ code: "insufficient_funds" });
  });

  it("una compra que necesita al humano falla, y falla diciendo eso", async () => {
    const { pagos } = setup();
    // No es un bug: hay compras que un agente no puede completar solo, y el
    // sistema tiene que decirlo en vez de disfrazarlo de error genérico.
    await expect(pagos.authorize(pedido({ instrumentRef: "pm_test_3ds" }))).rejects.toMatchObject({
      code: "authentication_required",
    });
  });

  it("no autoriza importes de cero", async () => {
    const { pagos } = setup();
    await expect(pagos.authorize(pedido({ amount: { minor: 0, currency: "ars" } }))).rejects.toThrow(
      PaymentError,
    );
  });
});

describe("idempotencia", () => {
  it("dos llamadas con la misma clave producen un solo hold", async () => {
    const { pagos } = setup();
    const primera = await pagos.authorize(pedido({ idempotencyKey: "misma" }));
    const segunda = await pagos.authorize(pedido({ idempotencyKey: "misma" }));

    // El agente que reintenta por un timeout de red no puede cobrar dos veces.
    expect(segunda.holdRef).toBe(primera.holdRef);
  });

  it("claves distintas producen holds distintos", async () => {
    const { pagos } = setup();
    const a = await pagos.authorize(pedido({ idempotencyKey: "a" }));
    const b = await pagos.authorize(pedido({ idempotencyKey: "b" }));

    expect(b.holdRef).not.toBe(a.holdRef);
  });

  it("el reintento devuelve el hold aunque la tarjeta ahora falle", async () => {
    const { pagos } = setup();
    const primera = await pagos.authorize(pedido({ idempotencyKey: "stable" }));

    pagos.failWith("card_declined");
    const reintento = await pagos.authorize(pedido({ idempotencyKey: "stable" }));

    // Un reintento tiene que ser una lectura del resultado anterior, no una
    // operación nueva que puede salir distinto.
    expect(reintento.holdRef).toBe(primera.holdRef);
  });
});

describe("cobrar", () => {
  it("cobra lo retenido", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());
    const cobro = await pagos.capture(hold.holdRef);

    expect(cobro.captured).toEqual(hold.charged);
    expect((await pagos.read(hold.holdRef))?.status).toBe("captured");
  });

  it("puede cobrar MENOS de lo autorizado", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());
    const cobro = await pagos.capture(hold.holdRef, { minor: 100, currency: "usd" });

    expect(cobro.captured.minor).toBe(100);
  });

  it("no puede cobrar MÁS de lo autorizado", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());

    // Es la regla de cualquier red de tarjetas, y es lo que impide que una
    // autorización por $100 se convierta en un cobro por $1.000.
    await expect(
      pagos.capture(hold.holdRef, { minor: hold.charged.minor + 1, currency: "usd" }),
    ).rejects.toThrow(PaymentError);
  });

  it("no se cobra dos veces", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());
    await pagos.capture(hold.holdRef);

    await expect(pagos.capture(hold.holdRef)).rejects.toThrow(/sólo se puede cobrar uno autorizado/);
  });

  it("un hold vencido no se cobra", async () => {
    const { clock, pagos } = setup();
    const hold = await pagos.authorize(pedido());

    clock.advance(11 * 60_000);

    await expect(pagos.capture(hold.holdRef)).rejects.toThrow(/venció/);
  });
});

describe("liberar", () => {
  it("suelta la plata sin haberla movido", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());
    await pagos.release(hold.holdRef, "revoked");

    expect((await pagos.read(hold.holdRef))?.status).toBe("released");
  });

  it("liberar dos veces no rompe", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());

    await pagos.release(hold.holdRef, "revoked");
    await expect(pagos.release(hold.holdRef, "revoked")).resolves.toBeUndefined();
  });

  it("un cobro hecho NO se libera", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());
    await pagos.capture(hold.holdRef);

    // Un cobro se reembolsa, y eso es otra operación con otras consecuencias
    // contables. Dejar que "liberar" tape un cobro escondería plata movida.
    await expect(pagos.release(hold.holdRef, "revoked")).rejects.toThrow(/se reembolsa, no se libera/);
  });

  it("después de liberar tampoco se puede cobrar", async () => {
    const { pagos } = setup();
    const hold = await pagos.authorize(pedido());
    await pagos.release(hold.holdRef, "revoked");

    // Es la garantía que hace que la revocación en vivo signifique algo.
    await expect(pagos.capture(hold.holdRef)).rejects.toThrow(PaymentError);
  });
});
