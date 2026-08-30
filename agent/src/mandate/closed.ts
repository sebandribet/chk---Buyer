/**
 * El Closed Checkout Mandate: la compra concreta, firmada por el agente.
 *
 * Es la mitad del par. El open dice "podés gastar hasta X en estos rubros"; el
 * closed dice "gasté esto, acá, hoy". Firmarlo es lo único que el agente puede
 * hacer con su clave — y eso es exactamente lo que el humano le concedió al
 * poner esa clave en el `cnf` del open.
 *
 * Las dos ataduras, que son todo el archivo:
 *
 *   checkout_hash → al carrito que firmó el MERCHANT. El agente no puede
 *                   mostrar un carrito barato y cobrar uno caro, porque no
 *                   puede emitir carritos firmados.
 *
 *   sd_hash       → al open del que cuelga. El agente no puede tomar el
 *                   carrito de hoy y presentarlo bajo un mandato viejo con
 *                   límites más amplios.
 *
 * Sin la primera, el monto es negociable. Sin la segunda, los límites lo son.
 * Ninguna de las dos es opcional y las dos se verifican del otro lado.
 */

import type { Clock } from "@/contracts/index.js";
import type {
  CheckoutObject,
  ClosedCheckoutMandate,
  OpenCheckoutMandate,
  SignedCredential,
} from "../../../shared/ap2.js";
import { hashObject, nowSeconds, sha256b64u, signJwt, signKeyBinding, type KeyPair } from "./sdjwt.js";

/**
 * Cuánto vale una presentación. Corto a propósito.
 *
 * No es la vigencia del mandato ni la del carrito: es cuánto tiempo tiene el
 * merchant para usar ESTA presentación. Que sea corto limita la ventana en la
 * que una presentación interceptada sirve de algo, y no molesta a nadie porque
 * entre que el agente la arma y el merchant la verifica pasan segundos.
 */
const VIGENCIA_PRESENTACION_MINUTOS = 5;

/**
 * El hash del open. Es lo que el closed cita para decir de quién cuelga.
 *
 * Se hashea el JWT completo y no el payload: el JWT incluye la firma, así que
 * dos opens con el mismo contenido pero firmados por personas distintas dan
 * hashes distintos. Hashear sólo el payload dejaría que un mandato firmado por
 * un impostor se hiciera pasar por el bueno ante quien sólo compare el hash.
 */
export function openHash(open: SignedCredential<OpenCheckoutMandate>): string {
  return sha256b64u(open.jwt);
}

/** El hash del carrito cerrado. Mismo criterio: se hashea el JWT firmado. */
export function checkoutHash(checkout: SignedCredential<CheckoutObject>): string {
  return sha256b64u(checkout.jwt);
}

/**
 * `intentHash` para la reserva on-chain.
 *
 * Se usa el hash del carrito, y eso le da al contrato una propiedad gratis: como
 * `authorizationId = hash(mandateId, intentHash)` y una autorización ya existente
 * hace fallar la reserva, el mismo carrito no se puede reservar dos veces. La
 * protección contra doble cobro no es una comprobación extra que alguien tiene
 * que acordarse de hacer: es la forma en que se calcula el id.
 */
export function intentHashFor(checkout: SignedCredential<CheckoutObject>): string {
  return checkoutHash(checkout);
}

export interface ClosedMandate {
  credential: SignedCredential<ClosedCheckoutMandate>;
  /** La prueba de posesión, aparte del mandato: ata la presentación a este uso. */
  kbJwt: string;
  sdHash: string;
  checkoutHash: string;
}

export interface CloseCheckoutInput {
  open: SignedCredential<OpenCheckoutMandate>;
  checkout: SignedCredential<CheckoutObject>;
  /** Para quién es. Fuera de este destinatario la presentación no vale. */
  audience: string;
  /** Lo emitió el merchant. El agente lo repite, no lo elige. */
  nonce: string;
}

/**
 * Firma la compra. Es todo lo que el agente puede hacer con su clave.
 *
 * Notar lo que NO recibe: ni el `MandateRegistryPort` ni nada que le permita
 * cambiar los límites. Puede atestiguar una compra dentro del mandato; no puede
 * tocar el mandato. La diferencia la sostienen los tipos, no la buena voluntad.
 */
export function closeCheckout(
  input: CloseCheckoutInput,
  agentKey: KeyPair,
  clock: Clock,
): ClosedMandate {
  const iat = nowSeconds(clock);
  const sdHash = openHash(input.open);
  const ckHash = checkoutHash(input.checkout);

  const payload: ClosedCheckoutMandate = {
    vct: "mandate.checkout.1",
    checkout_jwt: input.checkout.jwt,
    checkout_hash: ckHash,
    sd_hash: sdHash,
    aud: input.audience,
    nonce: input.nonce,
    iat,
    exp: iat + VIGENCIA_PRESENTACION_MINUTOS * 60,
  };

  const credential = signJwt(payload, agentKey.privateKey);

  // El kb-JWT va aparte del mandato y repite las tres cosas que atan la
  // presentación a este uso. Va aparte porque es la prueba de que quien está
  // presentando esto AHORA tiene la clave — no la de que el documento sea
  // auténtico, que ya la da la firma del mandato.
  const kbJwt = signKeyBinding(
    { sd_hash: sdHash, aud: input.audience, nonce: input.nonce, iat },
    agentKey.privateKey,
  );

  return { credential, kbJwt, sdHash, checkoutHash: ckHash };
}

/** El hash del closed. El merchant lo pone en el recibo como `reference`. */
export function closedHash(closed: SignedCredential<ClosedCheckoutMandate>): string {
  return sha256b64u(closed.jwt);
}

/** Reexportado para que quien arme un recibo no tenga que ir a buscar el de sdjwt. */
export { hashObject };
