/**
 * El proveedor de pagos, en memoria.
 *
 * No es "un stub que devuelve ok": replica la máquina de estados de un
 * PaymentIntent de Stripe, con las mismas transiciones y los mismos errores. Eso
 * lo hace útil para lo que importa —si el settlement hace algo que Stripe
 * rechazaría, acá también falla— y hace que cambiarlo por el adapter real sea
 * cambiar de dónde vienen los datos, no qué significan.
 *
 * Existe por dos razones, y la segunda es la que importa el día de la demo:
 *
 * 1. Los tests corren sin red. Toda la suite es offline y determinista.
 * 2. **Es el seguro.** El challenge se juzga con los jueces operando el sistema
 *    en vivo. Si el wifi del evento falla, la demo tiene que correr igual. Un
 *    sistema cuya defensa depende de que ande internet no es un sistema
 *    defendible.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "@/contracts/clock.js";
import type {
  AuthorizeChargeRequest,
  Money,
  PaymentCapture,
  PaymentFailureCode,
  PaymentHold,
  PaymentPort,
} from "../../../shared/payments.js";
import { PaymentError } from "../../../shared/payments.js";
import { toProviderCurrency } from "./fx.js";

/**
 * Tarjetas con comportamiento, con los mismos números que las de test de Stripe.
 *
 * Usar los números reales de Stripe y no inventados tiene un efecto concreto:
 * el mismo escenario de test corre igual contra el fake y contra Stripe de
 * verdad. Un caso que sólo existe en el mock es un caso que nadie probó.
 */
const TARJETAS_ESPECIALES: Record<string, PaymentFailureCode> = {
  pm_test_declined: "card_declined",
  pm_test_insufficient: "insufficient_funds",
  pm_test_expired: "expired_card",
  pm_test_3ds: "authentication_required",
};

interface StoredHold {
  hold: PaymentHold;
  instrumentRef: string;
  authorizationId: string;
  intentHash: string;
  captureRef: string | null;
}

export interface FakePaymentPortOptions {
  /** La moneda en la que "cobra" este proveedor. Stripe no toma ARS. */
  currency?: string;
  /** Fuerza un fallo en el próximo `authorize`, sea cual sea la tarjeta. */
  failNext?: PaymentFailureCode | null;
}

export class FakePaymentPort implements PaymentPort {
  readonly provider = "fake";

  private readonly holds = new Map<string, StoredHold>();
  /** Idempotencia: misma clave, mismo hold. Nunca dos cobros. */
  private readonly porClave = new Map<string, string>();
  private readonly currency: string;
  private failNext: PaymentFailureCode | null;
  private seq = 0;

  constructor(
    private readonly clock: Clock,
    options: FakePaymentPortOptions = {},
  ) {
    this.currency = options.currency ?? "usd";
    this.failNext = options.failNext ?? null;
  }

  /** Programa el próximo fallo. Es lo que usan los tests para el camino triste. */
  failWith(code: PaymentFailureCode | null): void {
    this.failNext = code;
  }

  async authorize(request: AuthorizeChargeRequest): Promise<PaymentHold> {
    // Idempotencia primero, antes que cualquier validación. Un reintento por
    // timeout de red tiene que devolver el hold que ya existe, no crear otro ni
    // fallar distinto que la primera vez.
    const yaExiste = this.porClave.get(request.idempotencyKey);
    if (yaExiste !== undefined) {
      return { ...this.holds.get(yaExiste)!.hold };
    }

    const falla = this.failNext ?? TARJETAS_ESPECIALES[request.instrumentRef];
    if (falla !== undefined && falla !== null) {
      this.failNext = null;
      throw new PaymentError(falla, `La tarjeta ${request.instrumentRef} no autorizó el cobro.`);
    }

    if (request.amount.minor <= 0) {
      throw new PaymentError("processing_error", "No se autoriza un importe de cero o negativo.");
    }

    const conversion = toProviderCurrency(request.amount, this.currency);
    this.seq += 1;
    const holdRef = `pi_fake_${this.seq}_${randomUUID().slice(0, 8)}`;

    const hold: PaymentHold = {
      holdRef,
      status: "requires_capture",
      charged: conversion.to,
      authorized: conversion.from,
      fxRate: conversion.rate,
      expiresAt: request.expiresAt,
      provider: this.provider,
    };

    this.holds.set(holdRef, {
      hold,
      instrumentRef: request.instrumentRef,
      authorizationId: request.authorizationId,
      intentHash: request.intentHash,
      captureRef: null,
    });
    this.porClave.set(request.idempotencyKey, holdRef);

    return { ...hold };
  }

  async capture(holdRef: string, amount?: Money): Promise<PaymentCapture> {
    const stored = this.holds.get(holdRef);
    if (stored === undefined) {
      throw new PaymentError("processing_error", `No existe el hold ${holdRef}.`);
    }
    if (stored.hold.status !== "requires_capture") {
      // Cobrar dos veces, o cobrar algo ya liberado, tiene que fallar acá y no
      // producir un segundo movimiento de plata.
      throw new PaymentError(
        "processing_error",
        `El hold ${holdRef} está en "${stored.hold.status}" y sólo se puede cobrar uno autorizado.`,
      );
    }
    if (new Date(stored.hold.expiresAt).getTime() <= this.clock.now().getTime()) {
      throw new PaymentError("processing_error", `El hold ${holdRef} venció el ${stored.hold.expiresAt}.`);
    }

    const capturado = amount ?? stored.hold.charged;
    if (capturado.minor > stored.hold.charged.minor) {
      // Se puede cobrar menos de lo autorizado, nunca más. Es la regla de
      // cualquier red de tarjetas y es la que impide que una autorización por
      // $100 se convierta en un cobro de $1.000.
      throw new PaymentError(
        "processing_error",
        `Se intenta cobrar ${capturado.minor} sobre un hold de ${stored.hold.charged.minor}.`,
      );
    }

    const captureRef = `ch_fake_${holdRef.slice(8)}`;
    stored.hold = { ...stored.hold, status: "captured" };
    stored.captureRef = captureRef;

    return {
      holdRef,
      captureRef,
      captured: capturado,
      capturedAt: this.clock.now().toISOString(),
    };
  }

  async release(holdRef: string, reason: string): Promise<void> {
    const stored = this.holds.get(holdRef);
    if (stored === undefined) {
      throw new PaymentError("processing_error", `No existe el hold ${holdRef}.`);
    }
    if (stored.hold.status === "captured") {
      // Un cobro hecho no se "libera": se devuelve, y eso es otra operación con
      // otras consecuencias contables. Confundirlas escondería plata movida.
      throw new PaymentError(
        "processing_error",
        `El hold ${holdRef} ya se cobró. Un cobro se reembolsa, no se libera.`,
      );
    }
    if (stored.hold.status === "released") return;

    void reason;
    stored.hold = { ...stored.hold, status: "released" };
  }

  async read(holdRef: string): Promise<PaymentHold | null> {
    const stored = this.holds.get(holdRef);
    return stored === undefined ? null : { ...stored.hold };
  }

  /** Para los tests y la demo: qué reserva on-chain respalda este cobro. */
  authorizationOf(holdRef: string): string | null {
    return this.holds.get(holdRef)?.authorizationId ?? null;
  }

  captureRefOf(holdRef: string): string | null {
    return this.holds.get(holdRef)?.captureRef ?? null;
  }
}
