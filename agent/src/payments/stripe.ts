/**
 * Stripe, con captura manual.
 *
 * Un `PaymentIntent` con `capture_method: "manual"` tiene exactamente los tres
 * tiempos que el puerto necesita:
 *
 *     confirm            → `requires_capture`, la plata queda retenida y no se movió
 *     POST .../capture   → `succeeded`, se cobra
 *     POST .../cancel    → `canceled`, se suelta y nunca se movió nada
 *
 * Es la API que Stripe usa desde siempre para hoteles y alquiler de autos —
 * reservás contra la tarjeta y cobrás cuando el servicio ocurre— y resulta ser
 * la forma correcta para un agente que compra: entre que decide y que se cobra
 * hay una ventana en la que el humano todavía puede echarse atrás.
 *
 * ---
 *
 * **Por qué esto y no un Shared Payment Token.** El SPT es el objeto que Stripe
 * diseñó para justamente este caso y es lo que este puerto imita. Está en
 * private preview y no cubre Argentina. Escribir contra una API a la que quizá
 * no entremos, para un sistema que los jueces van a operar en vivo, es una
 * apuesta que no hace falta hacer: el puerto ya tiene forma de SPT, así que el
 * día que se abra el preview es un archivo nuevo al lado de este.
 *
 * **`off_session: true`** no es una bandera de conveniencia: es la traducción
 * literal del flujo "Human Not Present" de AP2 a la capa de plata. Le dice al
 * emisor que el titular no está mirando, y por eso el banco puede responder
 * `authentication_required` — que no es un error nuestro, es el sistema
 * funcionando: hay compras que un agente no puede completar solo.
 */

import Stripe from "stripe";
import type { Clock } from "@/contracts/clock.js";
import type {
  AuthorizeChargeRequest,
  Money,
  PaymentCapture,
  PaymentFailureCode,
  PaymentHold,
  PaymentHoldStatus,
  PaymentPort,
} from "../../../shared/payments.js";
import { PaymentError } from "../../../shared/payments.js";
import { toProviderCurrency } from "./fx.js";

/** La moneda en la que liquida esta cuenta. Stripe no toma ARS. */
const MONEDA_DEL_PROVEEDOR = "usd";

export interface StripePaymentPortOptions {
  secretKey: string;
  clock: Clock;
  /** Sobre qué moneda liquida. Sólo para tests. */
  currency?: string;
  /** Inyectable para poder testear sin red. */
  client?: Stripe;
}

/** De los códigos de Stripe a los nuestros. Lo que no reconocemos es error de proceso, no éxito. */
function toFailureCode(error: Stripe.errors.StripeError): PaymentFailureCode {
  const declineCode = (error as { decline_code?: string }).decline_code;

  if (error.code === "authentication_required") return "authentication_required";
  if (error.code === "expired_card") return "expired_card";
  if (declineCode === "insufficient_funds") return "insufficient_funds";
  if (error.code === "card_declined") return "card_declined";
  return "processing_error";
}

function toHoldStatus(intent: Stripe.PaymentIntent): PaymentHoldStatus {
  switch (intent.status) {
    case "requires_capture":
      return "requires_capture";
    case "succeeded":
      return "captured";
    case "canceled":
      return "released";
    case "requires_action":
    case "requires_confirmation":
      return "requires_action";
    default:
      // `requires_payment_method` después de confirmar significa que el emisor
      // rechazó. No hay estado neutro: o autorizó o no.
      return "declined";
  }
}

export class StripePaymentPort implements PaymentPort {
  readonly provider = "stripe";

  private readonly stripe: Stripe;
  private readonly currency: string;

  constructor(private readonly options: StripePaymentPortOptions) {
    if (options.secretKey === "" && options.client === undefined) {
      throw new Error(
        "Falta STRIPE_SECRET_KEY. Va en agent/.env (que está en .gitignore) — nunca en el repo.",
      );
    }
    this.stripe = options.client ?? new Stripe(options.secretKey);
    this.currency = options.currency ?? MONEDA_DEL_PROVEEDOR;
  }

  async authorize(request: AuthorizeChargeRequest): Promise<PaymentHold> {
    const conversion = toProviderCurrency(request.amount, this.currency);

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: conversion.to.minor,
          currency: conversion.to.currency,
          payment_method: request.instrumentRef,
          // Los tres juntos son el flujo del agente: retener sin cobrar,
          // confirmar ya, y sin el humano delante.
          capture_method: "manual",
          confirm: true,
          off_session: true,
          // Sin esto, un pago que requiera acción intenta redirigir al humano
          // que no está, y falla con un error confuso en vez del honesto.
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          // El puente entre el dashboard de Stripe y nuestro mandato. Meses
          // después, una disputa se contesta desde acá en vez de con capturas
          // de pantalla.
          metadata: {
            authorization_id: request.authorizationId,
            intent_hash: request.intentHash,
            merchant_id: request.merchantId,
            // Los dos importes. El humano firmó pesos y se le cobra dólares;
            // sin las dos cifras nadie puede auditar después si se respetó.
            authorized_ars: String(conversion.from.minor),
            fx_rate: String(conversion.rate),
          },
        },
        // Idempotencia del lado de Stripe: un reintento por timeout devuelve el
        // mismo PaymentIntent en vez de crear un segundo cobro.
        { idempotencyKey: request.idempotencyKey },
      );

      const status = toHoldStatus(intent);
      if (status === "declined" || status === "requires_action") {
        throw new PaymentError(
          status === "requires_action" ? "authentication_required" : "card_declined",
          `Stripe dejó el pago en "${intent.status}".`,
          intent.id,
        );
      }

      return {
        holdRef: intent.id,
        status,
        charged: conversion.to,
        authorized: conversion.from,
        fxRate: conversion.rate,
        expiresAt: request.expiresAt,
        provider: this.provider,
      };
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      if (error instanceof Stripe.errors.StripeError) {
        throw new PaymentError(
          toFailureCode(error),
          error.message,
          (error as { payment_intent?: { id: string } }).payment_intent?.id,
        );
      }
      throw error;
    }
  }

  async capture(holdRef: string, amount?: Money): Promise<PaymentCapture> {
    try {
      const intent = await this.stripe.paymentIntents.capture(
        holdRef,
        amount === undefined ? undefined : { amount_to_capture: amount.minor },
      );

      // El `charge` es lo que después se disputa. Guardarlo acá es lo que
      // permite atar una disputa futura con este mandato.
      const captureRef =
        typeof intent.latest_charge === "string"
          ? intent.latest_charge
          : (intent.latest_charge?.id ?? intent.id);

      return {
        holdRef,
        captureRef,
        captured: { minor: intent.amount_received, currency: intent.currency },
        capturedAt: this.options.clock.now().toISOString(),
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new PaymentError(toFailureCode(error), error.message, holdRef);
      }
      throw error;
    }
  }

  async release(holdRef: string, reason: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(holdRef, {
        // `abandoned` es el motivo honesto cuando el mandato dejó de valer: no
        // fue fraude ni un duplicado, la autoridad desapareció.
        cancellation_reason: reason === "revoked" ? "abandoned" : "requested_by_customer",
      });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new PaymentError(toFailureCode(error), error.message, holdRef);
      }
      throw error;
    }
  }

  async read(holdRef: string): Promise<PaymentHold | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(holdRef);
      const authorizedArs = Number(intent.metadata["authorized_ars"] ?? "0");
      const fxRate = Number(intent.metadata["fx_rate"] ?? "1");

      return {
        holdRef: intent.id,
        status: toHoldStatus(intent),
        charged: { minor: intent.amount, currency: intent.currency },
        authorized: { minor: authorizedArs, currency: "ars" },
        fxRate,
        expiresAt: this.options.clock.now().toISOString(),
        provider: this.provider,
      };
    } catch {
      return null;
    }
  }
}
