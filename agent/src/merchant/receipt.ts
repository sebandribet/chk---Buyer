/**
 * El recibo del vendedor: lo último que se firma, y lo que cierra el rastro.
 *
 * `reference` es el hash del Closed Checkout Mandate, como pide la spec. Esa
 * elección tiene una consecuencia concreta: cualquiera que después tenga el
 * recibo y la presentación puede comprobar por su cuenta que este vendedor
 * aceptó ESA compra y no otra. Ni el comprador puede desconocerla ni el
 * vendedor puede después decir que aceptó algo distinto.
 *
 * Es también lo que AP2 usa para achicar el mandato: "the agent stores the
 * open-closed-receipt tuple and reduces the scope of the open mandate based on
 * the receipt". Nosotros esa reducción la hacemos on-chain, con `spent` y
 * `reserved` — que es más fuerte, porque no depende de que el agente sea honesto
 * guardando sus propios recibos.
 */

import type { Clock } from "@/contracts/clock.js";
import type { CheckoutReceipt, MerchantRef, SignedCredential } from "../../../shared/ap2.js";
import { sha256b64u, signJwt, type KeyPair } from "@/mandate/sdjwt.js";

export interface ReceiptInput {
  /** El JWT del closed mandate. Se hashea acá para que `reference` no venga de afuera. */
  closedJwt: string;
  merchant: MerchantRef;
  authorizationId: string;
  currency: string;
  amount: number;
}

export function signReceipt(
  input: ReceiptInput,
  merchantKey: KeyPair,
  clock: Clock,
): SignedCredential<CheckoutReceipt> {
  const receipt: CheckoutReceipt = {
    vct: "receipt.checkout.1",
    // El hash se calcula acá y no se recibe. Un `reference` que viniera de
    // afuera dejaría al vendedor firmando un recibo sobre una compra que no es
    // la que verificó.
    reference: sha256b64u(input.closedJwt),
    merchant: input.merchant,
    authorizationId: input.authorizationId,
    currency: input.currency,
    amount: input.amount,
    acceptedAt: clock.now().toISOString(),
  };

  return signJwt(receipt, merchantKey.privateKey);
}
