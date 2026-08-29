/**
 * El delegado de pago: quien mueve la plata.
 *
 * No es un rol inventado para este archivo. `MandateTypes.Terms.paymentDelegate`
 * ya existe en el Solidity desde antes, y `consumeAuthorization` exige
 * `msg.sender == paymentDelegate`. Este módulo es esa dirección: el único actor
 * del sistema que puede convertir una autorización en un cobro.
 *
 * ---
 *
 * **Las dos preguntas.** Una compra necesita dos permisos distintos y las dos
 * respuestas tienen que ser que sí:
 *
 *     ¿el mandato tiene lugar?   ← la reserva on-chain. Es la de AUTORIDAD.
 *     ¿la tarjeta tiene fondos?  ← el hold del proveedor. Es la de CAPACIDAD.
 *
 * Se preguntan en ese orden, y no es arbitrario: la primera es barata, local y
 * es la que define si esto está permitido; la segunda es cara, externa y sólo
 * tiene sentido preguntarla si la primera dio que sí. Un sistema que las
 * invierta le pregunta al banco por compras que nunca debieron intentarse.
 *
 * **La ventana.** Entre `hold()` y `capture()` la compra está comprometida y la
 * plata sigue en la cuenta del comprador. Esa ventana es lo que hace que
 * revocar signifique algo: un mandato revocado ahí adentro termina en una
 * retención liberada y cero pesos movidos. Es exactamente lo que el challenge
 * pide poder demostrar en vivo, y por eso las dos operaciones están separadas
 * en la API en vez de escondidas en un solo `pagar()`.
 *
 * **El monto no sale de la presentación.** Sale de leer la reserva on-chain.
 * El agente arma la presentación y el agente puede mentir; el contrato no. Que
 * el número que se cobra venga de la chain y no del documento que trajo el
 * agente es lo que hace que este módulo no tenga que confiar en él.
 */

import type { Clock } from "@/contracts/clock.js";
import type { AuthorizationPort, ChainReader, SettlementPort } from "@/contracts/mandate.js";
import type { AuditLog } from "@/contracts/audit.js";
import type { PaymentInstrumentRef } from "../../../shared/ap2.js";
import type { PaymentHold, PaymentPort } from "../../../shared/payments.js";
import { PaymentError } from "../../../shared/payments.js";

export interface SettlementDeps {
  payments: PaymentPort;
  chain: ChainReader;
  settlement: SettlementPort;
  /**
   * Sólo para cancelar reservas que no se van a cobrar. Es `Pick` y no el
   * puerto entero a propósito: el delegado de pago no reserva presupuesto, y
   * que no pueda hacerlo lo garantiza el tipo.
   */
  authorizations: Pick<AuthorizationPort, "cancel">;
  /** La dirección del delegado. El contrato la compara al consumir. */
  paymentDelegate: string;
  clock: Clock;
  audit: AuditLog;
}

export interface HoldRequest {
  /** La reserva on-chain. De acá sale el monto: no se le cree a nadie más. */
  authorizationId: string;
  instrument: PaymentInstrumentRef;
  merchantId: string;
  /** Hash del carrito. Ata el cobro a una compra concreta y da la idempotencia. */
  intentHash: string;
}

export type HoldResult =
  | { status: "held"; hold: PaymentHold }
  | {
      status: "refused";
      reason: "authorization_invalid" | "mandate_not_usable" | "payment_declined";
      code?: string;
      detail: string;
    };

export type CaptureResult =
  | { status: "captured"; captureRef: string; capturedMinor: number; capturedCurrency: string }
  | { status: "refused"; reason: "mandate_not_usable" | "hold_invalid"; detail: string };

/** La moneda del dominio. Es en la que el humano firmó y en la que la chain lleva las cuentas. */
const MONEDA_DEL_MANDATO = "ars";

export class Settlement {
  constructor(private readonly deps: SettlementDeps) {}

  /**
   * Fase 1: comprometer la plata sin moverla.
   *
   * Si el proveedor rechaza, la reserva on-chain se cancela en el mismo paso.
   * Dejarla viva inmovilizaría presupuesto del comprador por una compra que no
   * va a ocurrir, y el humano no tendría forma de saber por qué le falta saldo.
   */
  async hold(request: HoldRequest): Promise<HoldResult> {
    const authorization = await this.deps.chain.readAuthorization(request.authorizationId);

    if (authorization === null || !authorization.active) {
      return {
        status: "refused",
        reason: "authorization_invalid",
        detail: `No hay reserva activa con id ${request.authorizationId}. Sin reserva no hay autoridad para cobrar.`,
      };
    }

    const now = Math.floor(this.deps.clock.now().getTime() / 1000);
    if (authorization.expiresAt <= now) {
      return {
        status: "refused",
        reason: "authorization_invalid",
        detail: `La reserva venció el ${new Date(authorization.expiresAt * 1000).toISOString()}.`,
      };
    }

    // El mandato puede haber muerto entre que se reservó y ahora. Se comprueba
    // otra vez, y se va a comprobar una tercera antes de cobrar.
    const mandate = await this.deps.chain.readMandate(authorization.mandateId);
    if (!mandate.active || mandate.revokedAt !== null) {
      return {
        status: "refused",
        reason: "mandate_not_usable",
        detail: `El mandato ${authorization.mandateId} está revocado. No se le pide autorización al banco por una compra que ya no está permitida.`,
      };
    }

    try {
      const hold = await this.deps.payments.authorize({
        instrumentRef: request.instrument.ref,
        // El monto sale de la chain, no de la presentación.
        amount: { minor: authorization.amount, currency: MONEDA_DEL_MANDATO },
        merchantId: request.merchantId,
        authorizationId: request.authorizationId,
        intentHash: request.intentHash,
        expiresAt: new Date(authorization.expiresAt * 1000).toISOString(),
        // La clave de idempotencia sale del carrito y del mandato: el mismo
        // carrito bajo el mismo mandato es el mismo cobro, siempre. Un
        // reintento por timeout de red no puede cobrar dos veces.
        idempotencyKey: `${authorization.mandateId}:${request.intentHash}`,
      });

      this.deps.audit.emit({
        type: "payment_authorized",
        provider: hold.provider,
        holdRef: hold.holdRef,
        authorizationId: request.authorizationId,
        authorizedMinor: hold.authorized.minor,
        authorizedCurrency: hold.authorized.currency,
        chargedMinor: hold.charged.minor,
        chargedCurrency: hold.charged.currency,
        fxRate: hold.fxRate,
      });

      return { status: "held", hold };
    } catch (error) {
      const code = error instanceof PaymentError ? error.code : "processing_error";
      const detail = error instanceof Error ? error.message : String(error);

      this.deps.audit.emit({ type: "payment_failed", provider: this.deps.payments.provider, code, detail });

      // El presupuesto vuelve a estar disponible. Una reserva colgada de un
      // cobro que falló es plata trabada sin motivo.
      await this.cancelarReserva(request.authorizationId);

      return { status: "refused", reason: "payment_declined", code, detail };
    }
  }

  /**
   * Fase 2: cobrar.
   *
   * Vuelve a leer el mandato antes de mover un peso, y esa lectura es el corazón
   * de la revocación en vivo. Entre el hold y este momento pasa tiempo real —el
   * vendedor prepara el pedido, el humano mira lo que compró el agente— y en ese
   * rato el mandato puede haber muerto. Confiar en la comprobación del hold
   * haría que revocar no sirviera justo cuando más importa.
   */
  async capture(authorizationId: string, holdRef: string): Promise<CaptureResult> {
    const authorization = await this.deps.chain.readAuthorization(authorizationId);
    if (authorization === null || !authorization.active) {
      return { status: "refused", reason: "hold_invalid", detail: "La reserva ya no está activa." };
    }

    const mandate = await this.deps.chain.readMandate(authorization.mandateId);
    if (!mandate.active || mandate.revokedAt !== null) {
      // El caso que el challenge pide demostrar en vivo. No se cobra, se suelta
      // la retención, y la plata nunca se movió.
      await this.soltar(holdRef, "revoked");
      return {
        status: "refused",
        reason: "mandate_not_usable",
        detail: `El mandato fue revocado el ${mandate.revokedAt}. Se liberó la retención sin cobrar: no se movió un peso.`,
      };
    }

    let capture;
    try {
      capture = await this.deps.payments.capture(holdRef);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.audit.emit({
        type: "payment_failed",
        provider: this.deps.payments.provider,
        code: error instanceof PaymentError ? error.code : "processing_error",
        detail,
      });
      return { status: "refused", reason: "hold_invalid", detail };
    }

    this.deps.audit.emit({
      type: "payment_captured",
      provider: this.deps.payments.provider,
      holdRef,
      captureRef: capture.captureRef,
      capturedMinor: capture.captured.minor,
      capturedCurrency: capture.captured.currency,
    });

    // El descuento del presupuesto va DESPUÉS del cobro. El contrato registra
    // lo que se gastó, no lo que se pensaba gastar; adelantarlo dejaría el
    // saldo mintiendo si el cobro fallaba.
    await this.deps.settlement.consume(authorizationId, this.deps.paymentDelegate);

    return {
      status: "captured",
      captureRef: capture.captureRef,
      capturedMinor: capture.captured.minor,
      capturedCurrency: capture.captured.currency,
    };
  }

  /** Abandonar: soltar la retención y devolver el presupuesto. */
  async abort(authorizationId: string, holdRef: string, reason: string): Promise<void> {
    await this.soltar(holdRef, reason);
    await this.cancelarReserva(authorizationId);
  }

  private async soltar(holdRef: string, reason: string): Promise<void> {
    try {
      await this.deps.payments.release(holdRef, reason);
      this.deps.audit.emit({
        type: "payment_released",
        provider: this.deps.payments.provider,
        holdRef,
        reason,
      });
    } catch (error) {
      // Se registra y no se propaga: liberar es limpieza, y si falla no puede
      // tapar el motivo real por el que llegamos acá.
      this.deps.audit.emit({
        type: "payment_failed",
        provider: this.deps.payments.provider,
        code: "processing_error",
        detail: `No se pudo liberar ${holdRef}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async cancelarReserva(authorizationId: string): Promise<void> {
    try {
      await this.deps.authorizations.cancel(authorizationId);
    } catch {
      // Si ya estaba cancelada, mejor. El contrato tiene además
      // `releaseExpiredAuthorization` sin permisos, justamente para que una
      // reserva olvidada nunca deje presupuesto trabado para siempre.
    }
  }
}
