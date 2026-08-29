/**
 * El merchant cierra un carrito y lo firma.
 *
 * Está de este lado y no del nuestro a propósito, y no es un detalle
 * organizativo: es lo que hace que `checkout_hash` sirva de algo. El precio y
 * la disponibilidad son del vendedor. Si el agente pudiera emitir carritos
 * firmados, podría declarar el precio que quisiera y el hash sólo probaría que
 * el agente está de acuerdo consigo mismo.
 *
 * Este archivo pertenece a OTRO dominio de confianza. No importa nada de
 * `@/agent/**` y hay un test que lo verifica. La regla no es estética: si el
 * verificador del merchant compartiera código con el agente al que verifica, un
 * bug del agente se replicaría idéntico en quien tenía que atraparlo.
 */

import type { Clock } from "@/contracts/index.js";
import type {
  CheckoutObject,
  CheckoutRequest,
  MerchantRef,
  SignedCredential,
} from "../../../shared/ap2.js";
import { signJwt, type KeyPair } from "@/mandate/sdjwt.js";

/** Cuánto vale un carrito cerrado antes de que haya que volver a cotizarlo. */
export const VIGENCIA_CARRITO_MINUTOS = 15;

export interface IssueCheckoutConfig {
  ref: MerchantRef;
  key: KeyPair;
  clock: Clock;
  checkoutId: string;
}

/**
 * Cierra el carrito con el precio y el plazo del vendedor.
 *
 * Lo que hace de verdad: pone SU total, sumando sus propias líneas. No copia el
 * que haya mandado el agente — el que firma un número tiene que ser el que lo
 * calculó, o la firma no dice nada sobre el número.
 *
 * Lo que NO hace, porque no le toca: mirar el mandato. El vendedor no decide si
 * el comprador podía comprar; eso lo verifica después, contra la credencial.
 * Acá sólo decide qué vende y a cuánto.
 */
export function issueCheckout(
  request: CheckoutRequest,
  config: IssueCheckoutConfig,
): SignedCredential<CheckoutObject> {
  if (request.merchantId !== config.ref.id) {
    throw new Error(`El pedido es para "${request.merchantId}" y este vendedor es "${config.ref.id}".`);
  }
  if (request.items.length === 0) {
    throw new Error("No se cierra un carrito vacío.");
  }

  const now = config.clock.now();

  const checkout: CheckoutObject = {
    checkoutId: config.checkoutId,
    merchant: config.ref,
    currency: request.currency,
    amount: request.items.reduce((acc, item) => acc + item.lineAmount, 0),
    items: request.items,
    deliveryDays: request.deliveryDays,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VIGENCIA_CARRITO_MINUTOS * 60_000).toISOString(),
  };

  return signJwt(checkout, config.key.privateKey);
}
