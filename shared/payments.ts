/**
 * El puerto de pagos. Un contrato, varios proveedores.
 *
 * Yuno —el host de este challenge— es una plataforma de orquestación de pagos:
 * "un comercio integra una vez y cobra por muchos proveedores". Este archivo es
 * esa idea aplicada al agente. Nada de lo que está arriba del puerto sabe si
 * detrás hay Stripe, un mock o un contrato en Solidity.
 *
 * ---
 *
 * **Por qué tiene la forma que tiene.** Stripe ya definió el objeto correcto
 * para esto y se llama Shared Payment Token: una referencia a un medio de pago,
 * acotada a un comercio, a un monto y a un vencimiento, y revocable. Es casi
 * exactamente nuestra reserva on-chain, y no es casualidad — los dos resuelven
 * el mismo problema.
 *
 * No lo usamos, y conviene poder defender por qué: los SPT están en private
 * preview (waitlist, `Stripe-Version: 2026-04-22.preview`) y sólo operan en
 * Estados Unidos, Canadá y parte de Europa. Argentina no está en la lista. Un
 * sistema que los jueces van a operar en vivo no se puede apoyar en una API a
 * la que quizá no tengamos acceso ese día.
 *
 * Así que el puerto tiene forma de SPT y el adapter que corre hoy es de
 * `PaymentIntent` con captura manual, que es GA y anda con test keys. La
 * semántica es la misma en tres tiempos:
 *
 *     authorize   la plata queda comprometida pero NO se movió
 *     capture     se cobra
 *     release     se suelta, y nunca se movió nada
 *
 * Cuando el preview se abra, entra `SptPaymentPort` y no cambia una línea de
 * quien llama.
 *
 * ---
 *
 * **El hueco entre `authorize` y `capture` es lo más importante de este
 * archivo.** Ahí la compra está comprometida y la plata todavía está en la
 * cuenta del comprador. Es la ventana en la que una revocación todavía sirve
 * para algo, y es exactamente lo que el challenge pide demostrar en vivo.
 */

export type ISODateTime = string;

/**
 * Un importe, con su moneda y en unidad mínima.
 *
 * El par va junto y no separado porque un número sin moneda es una trampa: 3700
 * es $37 o $3.700 según de qué se hable, y en un sistema que convierte ARS a
 * USD en el medio, esa ambigüedad se paga.
 */
export interface Money {
  /** Unidad mínima de la moneda (centavos), entero. */
  minor: number;
  /** ISO 4217 en minúsculas, como lo quiere Stripe: "ars", "usd". */
  currency: string;
}

export type PaymentHoldStatus =
  /** Autorizado y sin cobrar. La plata está comprometida y no se movió. */
  | "requires_capture"
  /** Cobrado. */
  | "captured"
  /** Liberado sin cobrar. */
  | "released"
  /** El banco quiere al humano y el humano no está. */
  | "requires_action"
  /** El emisor dijo que no. */
  | "declined";

export interface PaymentHold {
  /** Referencia del proveedor (`pi_...` en Stripe). */
  holdRef: string;
  status: PaymentHoldStatus;
  /** Lo que se le va a cobrar de verdad al comprador, en la moneda del proveedor. */
  charged: Money;
  /**
   * El mismo importe en la moneda del mandato.
   *
   * Los dos viajan juntos siempre. El humano firmó un límite en pesos y se le
   * cobra en dólares; sin las dos cifras al lado, nadie puede auditar después
   * si lo que se cobró respetaba lo que se autorizó.
   */
  authorized: Money;
  /** La tasa que se usó para pasar de una a otra. */
  fxRate: number;
  expiresAt: ISODateTime;
  /** Qué proveedor lo emitió: "stripe", "fake". Va al trail. */
  provider: string;
}

export interface PaymentCapture {
  holdRef: string;
  /** Referencia del cobro (`ch_...` en Stripe). Es lo que se disputa después. */
  captureRef: string;
  captured: Money;
  capturedAt: ISODateTime;
}

export interface AuthorizeChargeRequest {
  /** El token del medio de pago. Nunca un PAN. */
  instrumentRef: string;
  /** Lo que autorizó el mandato, en su propia moneda. La conversión es del adapter. */
  amount: Money;
  /** A quién se le paga. */
  merchantId: string;
  /**
   * La reserva on-chain que respalda este cobro.
   *
   * Viaja hasta el proveedor y queda en su `metadata`. Es lo que permite, meses
   * después y desde el dashboard de Stripe, llegar al mandato que autorizó ese
   * cobro. Sin esto, una disputa se contesta con capturas de pantalla.
   */
  authorizationId: string;
  /** Hash del carrito. Ata el cobro a una compra concreta. */
  intentHash: string;
  expiresAt: ISODateTime;
  /**
   * Idempotencia. Dos llamadas con la misma clave producen un solo cobro.
   *
   * Un agente que reintenta por un timeout de red no puede cobrar dos veces, y
   * "el agente cobró dos veces por un reintento" es exactamente el tipo de
   * fraude nuevo que el challenge pide no dejar entrar.
   */
  idempotencyKey: string;
}

/** Por qué el proveedor dijo que no. Los nombres son los de Stripe. */
export type PaymentFailureCode =
  | "card_declined"
  | "insufficient_funds"
  | "expired_card"
  | "authentication_required"
  | "processing_error";

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentFailureCode,
    detail: string,
    /** Presente si el proveedor llegó a crear algo que hay que limpiar. */
    readonly holdRef?: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "PaymentError";
  }
}

/**
 * Lo que cualquier proveedor tiene que saber hacer.
 *
 * Tres operaciones y ninguna más. Que sea chico es el punto: cuanto más grande
 * el puerto, más difícil que el segundo proveedor lo implemente igual, y menos
 * cierto es que se puedan cambiar sin tocar a quien llama.
 */
export interface PaymentPort {
  /** Compromete la plata sin moverla. */
  authorize(request: AuthorizeChargeRequest): Promise<PaymentHold>;
  /** Cobra lo comprometido. `amount` omitido = todo. */
  capture(holdRef: string, amount?: Money): Promise<PaymentCapture>;
  /** Suelta lo comprometido. La plata nunca se movió. */
  release(holdRef: string, reason: string): Promise<void>;
  /** Estado actual, para auditar y para la demo. */
  read(holdRef: string): Promise<PaymentHold | null>;
  /** Nombre del proveedor, para el trail. */
  readonly provider: string;
}

// ---------------------------------------------------------------------------
// Disputas
// ---------------------------------------------------------------------------

export type DisputeStatus =
  | "needs_response"
  | "under_review"
  | "won"
  | "lost";

export interface Dispute {
  disputeRef: string;
  captureRef: string;
  amount: Money;
  /** Lo que dijo el titular: "fraudulent", "product_not_received"… */
  reason: string;
  status: DisputeStatus;
  openedAt: ISODateTime;
}

/**
 * La evidencia con la que se contesta una disputa.
 *
 * Los nombres son los de Stripe a propósito. La correspondencia con lo que ya
 * tenemos es casi literal, y esa es toda la gracia: cuando el comprador dice
 * "yo no autoricé esto", la respuesta no hay que fabricarla — ya existe, firmada
 * por él, desde antes de la compra.
 */
export interface DisputeEvidence {
  /** El Open Mandate firmado por el humano. Literalmente su firma. */
  customerSignature: string;
  /** El prompt original, textual. */
  customerCommunication: string;
  /** El recibo firmado por el vendedor. */
  receipt: string;
  /** El carrito cerrado. */
  productDescription: string;
  /** El trail completo, evento por evento. */
  accessActivityLog: string;
  /** La cadena de hashes que ata todo lo anterior. */
  uncategorizedText: string;
}

export interface DisputePort {
  list(): Promise<Dispute[]>;
  read(disputeRef: string): Promise<Dispute | null>;
  submitEvidence(disputeRef: string, evidence: DisputeEvidence): Promise<Dispute>;
}
