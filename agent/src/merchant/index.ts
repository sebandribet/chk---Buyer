/**
 * El vendedor, como una sola parte con memoria.
 *
 * Las funciones de `checkout.ts`, `verify.ts` y `receipt.ts` son puras a
 * propósito: se pueden testear con entradas armadas a mano, sin montar nada.
 * Pero un vendedor real tiene una cosa que no puede ser pura — se acuerda de
 * qué nonces emitió y cuáles ya se usaron.
 *
 * Esa memoria es lo único que impide que una presentación perfectamente válida
 * se cobre dos veces. Todo lo demás de la verificación es criptografía y se
 * puede repetir; esto es estado, y por eso vive en una clase y no en una
 * función.
 */

import { randomBytes } from "node:crypto";
import type { Clock } from "@/contracts/clock.js";
import type { ChainReader } from "@/contracts/mandate.js";
import type {
  CheckoutPort,
  CheckoutRequest,
  IssuedCheckout,
  MerchantPresentation,
  MerchantRef,
  VerificationResult,
} from "../../../shared/ap2.js";
import { b64uEncode, type KeyPair } from "@/mandate/sdjwt.js";
import { issueCheckout } from "./checkout.js";
import { verifyPresentation } from "./verify.js";

export interface MerchantConfig {
  ref: MerchantRef;
  key: KeyPair;
  clock: Clock;
  chain: ChainReader;
  /** La pública del comprador, conocida de antemano. Nunca sale de la presentación. */
  userPublicKey: KeyPair["publicKey"];
  /** Para que la demo y los tests puedan fijar ids y nonces reproducibles. */
  newId?: () => string;
  newNonce?: () => string;
}

export class Merchant implements CheckoutPort {
  /** Nonces emitidos y todavía sin usar. Salir de acá es gastarlos. */
  private readonly pendientes = new Set<string>();
  private seq = 0;

  constructor(private readonly config: MerchantConfig) {}

  get ref(): MerchantRef {
    return this.config.ref;
  }

  async close(request: CheckoutRequest): Promise<IssuedCheckout> {
    this.seq += 1;

    const checkout = issueCheckout(request, {
      ref: this.config.ref,
      key: this.config.key,
      clock: this.config.clock,
      checkoutId: this.config.newId?.() ?? `chk-${this.config.ref.id}-${this.seq}`,
    });

    // El nonce lo emite el vendedor, no el agente. Si lo eligiera el agente,
    // podría reusar una presentación entera cambiándolo y el vendedor no
    // tendría contra qué compararlo.
    const nonce = this.config.newNonce?.() ?? b64uEncode(randomBytes(12));
    this.pendientes.add(nonce);

    return { checkout, nonce };
  }

  async verify(presentation: MerchantPresentation): Promise<VerificationResult> {
    return verifyPresentation(presentation, {
      userPublicKey: this.config.userPublicKey,
      merchantKey: this.config.key,
      merchantId: this.config.ref.id,
      chain: this.config.chain,
      clock: this.config.clock,
      consumeNonce: (nonce) => this.pendientes.delete(nonce),
    });
  }
}

export { issueCheckout } from "./checkout.js";
export { signReceipt } from "./receipt.js";
export { verifyPresentation, type VerifyDeps } from "./verify.js";
