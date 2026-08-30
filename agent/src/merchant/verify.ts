/**
 * La verificación del merchant. Catorce chequeos, en orden, sin confiar en nada.
 *
 * Este archivo es el argumento entero del proyecto. Todo lo demás —el agente,
 * el catálogo, el policy engine— produce una afirmación: "esta compra está
 * autorizada". Acá esa afirmación se comprueba desde afuera, por una parte que
 * no tiene ninguna razón para creerle al agente y sí varias para desconfiar.
 *
 * Tres reglas que gobiernan todo lo que sigue:
 *
 * 1. NADA que venga en la presentación se usa como fuente de verdad sobre sí
 *    mismo. El monto no sale del closed, sale del carrito que firmó el
 *    merchant. Los límites no salen de lo que el agente diga, salen del open
 *    firmado por el humano. El estado del mandato no sale de ninguno de los
 *    dos, sale de la chain.
 *
 * 2. Las claves con las que se verifica se conocían de ANTES. No se toman de la
 *    presentación. Una firma verificada contra una clave que vino adjunta a la
 *    firma no prueba nada.
 *
 * 3. Fail-closed en todos los caminos. Un constraint que no se entiende, un
 *    dato que no cierra, una lectura que falla: rechazo. La spec de AP2 lo dice
 *    para los constraints —"Any unknown Constraints MUST be treated as failing
 *    evaluation"— y acá se aplica al archivo entero.
 *
 * El orden de los chequeos es de más barato a más caro y de más estructural a
 * más semántico: primero que los documentos sean auténticos, después que estén
 * atados entre sí, después que digan lo que tienen que decir, y último lo que
 * requiere ir a buscar estado afuera.
 */

import type { Clock } from "@/contracts/clock.js";
import type { ChainReader } from "@/contracts/mandate.js";
import type {
  CheckoutObject,
  ClosedCheckoutMandate,
  MerchantPresentation,
  OpenCheckoutMandate,
  VerificationCheck,
  VerificationFailure,
  VerificationResult,
} from "../../../shared/ap2.js";
import { evaluateConstraints, policyHash } from "@/mandate/constraints.js";
import {
  fromConfirmationKey,
  sha256b64u,
  verifyDisclosures,
  verifyJwt,
  verifyKeyBinding,
} from "@/mandate/sdjwt.js";
import type { KeyObject } from "node:crypto";
import { signReceipt } from "./receipt.js";
import type { KeyPair } from "@/mandate/sdjwt.js";

export interface VerifyDeps {
  /**
   * La pública del humano, conocida de antemano.
   *
   * En producción sale de un directorio consultable —es el problema que resuelve
   * el Trusted Agent Protocol de Visa— y no de la presentación. Acá alcanza con
   * que el concepto exista: se verifica CONTRA algo que ya se sabía.
   */
  userPublicKey: KeyObject;
  /** Las propias del merchant: firmó el carrito y va a firmar el recibo. */
  merchantKey: KeyPair;
  merchantId: string;
  chain: ChainReader;
  clock: Clock;
  /**
   * Marca el nonce como usado y devuelve `false` si ya lo estaba o si el
   * merchant nunca lo emitió. Es lo único con estado de toda la verificación:
   * sin esto, una presentación válida sirve infinitas veces.
   */
  consumeNonce(nonce: string): boolean;
}

export async function verifyPresentation(
  presentation: MerchantPresentation,
  deps: VerifyDeps,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const nowMs = deps.clock.now().getTime();
  const nowSec = Math.floor(nowMs / 1000);

  const pass = (check: string, detail: string) => {
    checks.push({ check, passed: true, detail });
  };
  const reject = (
    check: string,
    failure: VerificationFailure,
    detail: string,
  ): VerificationResult => {
    checks.push({ check, passed: false, detail });
    return { ok: false, failure, detail, checks };
  };

  // -------------------------------------------------------------------------
  // 1-2. ¿Los documentos son auténticos?
  // -------------------------------------------------------------------------

  // Se re-verifica el JWT en vez de leer `presentation.open.payload`. El payload
  // adjunto es una comodidad para quien construye; para decidir sólo vale lo que
  // salió de comprobar la firma.
  const open = verifyJwt<OpenCheckoutMandate>(presentation.open.jwt, deps.userPublicKey);
  if (open === null) {
    return reject(
      "firma_open",
      "open_signature_invalid",
      "El mandato no está firmado por el comprador que dice ser. Sin esto no hay autoridad de gasto: es la única firma que la crea.",
    );
  }
  pass("firma_open", `Mandato firmado por ${open.owner}, verificado contra la clave conocida del comprador.`);

  if (open.exp <= nowSec) {
    return reject(
      "vigencia_open",
      "open_expired",
      `El mandato venció el ${new Date(open.exp * 1000).toISOString()}.`,
    );
  }
  pass("vigencia_open", `Mandato vigente hasta ${new Date(open.exp * 1000).toISOString()}.`);

  // La clave del agente sale del `cnf` del mandato YA VERIFICADO. Ese es el
  // endoso: el humano dijo "este agente puede firmar compras por mí".
  let agentKey: KeyObject;
  try {
    agentKey = fromConfirmationKey(open.cnf);
  } catch {
    return reject("cnf_open", "open_signature_invalid", "El mandato no contiene una clave de agente utilizable.");
  }

  const closed = verifyJwt<ClosedCheckoutMandate>(presentation.closed.jwt, agentKey);
  if (closed === null) {
    return reject(
      "firma_closed",
      "closed_signature_invalid",
      "La compra no está firmada por el agente que el comprador endosó en este mandato.",
    );
  }
  pass("firma_closed", "Compra firmada por el agente endosado en el mandato.");

  if (closed.exp <= nowSec) {
    return reject(
      "vigencia_closed",
      "closed_expired",
      `La presentación venció el ${new Date(closed.exp * 1000).toISOString()}.`,
    );
  }
  pass("vigencia_closed", "Presentación dentro de su ventana de validez.");

  // -------------------------------------------------------------------------
  // 3-6. ¿Están atados entre sí, y a ESTE uso?
  // -------------------------------------------------------------------------

  if (closed.aud !== deps.merchantId) {
    return reject(
      "destinatario",
      "audience_mismatch",
      `La presentación es para "${closed.aud}" y este vendedor es "${deps.merchantId}". Una presentación válida para otro no vale acá.`,
    );
  }
  pass("destinatario", `Dirigida a ${deps.merchantId}.`);

  if (!deps.consumeNonce(closed.nonce)) {
    return reject(
      "nonce",
      "nonce_replayed",
      "El nonce no fue emitido por este vendedor o ya se usó. Una presentación se cobra una sola vez.",
    );
  }
  pass("nonce", "Nonce emitido por este vendedor y sin usar.");

  // El closed tiene que colgar de ESTE open. Sin este chequeo, el agente podría
  // combinar el carrito caro de hoy con un mandato viejo de límites amplios.
  const sdHashReal = sha256b64u(presentation.open.jwt);
  if (closed.sd_hash !== sdHashReal) {
    return reject(
      "atadura_al_mandato",
      "sd_hash_mismatch",
      "La compra dice colgar de otro mandato distinto del que se presentó.",
    );
  }
  pass("atadura_al_mandato", "La compra cuelga del mandato presentado.");

  // La prueba de posesión: quien presenta esto AHORA tiene la clave endosada.
  // La firma del closed prueba que el documento es auténtico; esto prueba que
  // no lo está reusando un tercero que lo interceptó.
  if (
    !verifyKeyBinding(presentation.kbJwt, agentKey, {
      sd_hash: sdHashReal,
      aud: deps.merchantId,
      nonce: closed.nonce,
    })
  ) {
    return reject(
      "posesion_de_clave",
      "key_binding_invalid",
      "Quien presenta esto no probó tener la clave que el comprador endosó.",
    );
  }
  pass("posesion_de_clave", "El presentador probó poseer la clave endosada.");

  // -------------------------------------------------------------------------
  // 7-8. El carrito: lo firmó este vendedor y es el que la compra cita
  // -------------------------------------------------------------------------

  const checkout = verifyJwt<CheckoutObject>(closed.checkout_jwt, deps.merchantKey.publicKey);
  if (checkout === null) {
    return reject(
      "firma_carrito",
      "checkout_signature_invalid",
      "El carrito citado no lo firmó este vendedor. El precio lo pone quien vende, no quien compra.",
    );
  }
  pass("firma_carrito", `Carrito ${checkout.checkoutId} firmado por este vendedor.`);

  if (closed.checkout_hash !== sha256b64u(closed.checkout_jwt)) {
    return reject(
      "atadura_al_carrito",
      "checkout_hash_mismatch",
      "El hash del carrito que declara la compra no corresponde al carrito adjunto.",
    );
  }
  pass("atadura_al_carrito", "La compra está atada al carrito adjunto.");

  if (new Date(checkout.expiresAt).getTime() <= nowMs) {
    return reject(
      "vigencia_carrito",
      "checkout_expired",
      `El carrito venció el ${checkout.expiresAt}. Hay que volver a cotizar.`,
    );
  }
  pass("vigencia_carrito", `Carrito vigente hasta ${checkout.expiresAt}.`);

  // -------------------------------------------------------------------------
  // 9. Los límites del humano, re-evaluados acá
  // -------------------------------------------------------------------------

  // El instrumento con el que se va a pagar es parte de lo que se evalúa: el
  // mandato no sólo dice qué se puede comprar y por cuánto, también con qué. Un
  // agente que compra lo correcto con una tarjeta que el humano no autorizó
  // está fuera del mandato igual que uno que compra de más.
  const verdict = evaluateConstraints(open.constraints, {
    checkout,
    paymentInstrument: presentation.paymentInstrument,
  });
  for (const e of verdict.evaluations) {
    checks.push({ check: `limite:${e.type}`, passed: e.passed, detail: e.detail });
  }

  if (verdict.unknownType) {
    const desconocido = verdict.evaluations.find((e) => !e.passed);
    return {
      ok: false,
      failure: "constraint_unknown",
      detail: `The mandate carries a constraint this verifier cannot evaluate (${desconocido?.type}). The spec requires rejecting: a constraint you do not understand is not one you ignore.`,
      checks,
    };
  }

  if (!verdict.passed) {
    const primera = verdict.evaluations.find((e) => !e.passed);
    return {
      ok: false,
      failure: "constraint_violated",
      detail: primera?.detail ?? "La compra viola un límite del mandato.",
      checks,
    };
  }

  // -------------------------------------------------------------------------
  // 10. Los datos del comprador
  // -------------------------------------------------------------------------

  const buyer = verifyDisclosures(open._sd, presentation.disclosures);
  if (buyer === null) {
    return reject(
      "datos_del_comprador",
      "disclosure_invalid",
      "Algún dato del comprador no corresponde al mandato firmado. Se rechaza el lote completo: un CUIT que no cierra invalida la presentación, no sólo ese campo.",
    );
  }
  pass(
    "datos_del_comprador",
    `Verificados contra el mandato: ${Object.keys(buyer).join(", ") || "(ninguno revelado)"}.`,
  );

  // -------------------------------------------------------------------------
  // 11-14. La chain: ¿sigue vivo esto, y hay plata reservada?
  // -------------------------------------------------------------------------

  let mandateState;
  try {
    mandateState = await deps.chain.readMandate(open.mandateId);
  } catch (error) {
    return reject(
      "estado_del_mandato",
      "mandate_not_usable",
      `No se pudo leer el mandato ${open.mandateId}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  if (!mandateState.active || mandateState.revokedAt !== null) {
    // El caso que hace que todo esto valga la pena. La credencial es
    // perfectamente válida y está perfectamente firmada; el humano cambió de
    // opinión. Una credencial no se puede "desfirmar", por eso el estado vive
    // en otro lado.
    return reject(
      "estado_del_mandato",
      "mandate_not_usable",
      `El mandato fue revocado${mandateState.revokedAt !== null ? ` el ${mandateState.revokedAt}` : ""}. La credencial sigue siendo auténtica y aun así no autoriza nada.`,
    );
  }
  pass("estado_del_mandato", "El mandato sigue activo en la chain.");

  // La junta entre los dos anclajes: los límites que se acaban de evaluar son
  // los que el humano firmó on-chain, no unos que el agente haya inventado.
  const hashReal = policyHash(open.constraints);
  if (hashReal !== open.policyHash) {
    return reject(
      "compromiso_de_politica",
      "policy_hash_mismatch",
      "Los límites del mandato no hashean a su propio policyHash: el documento fue alterado después de firmarse.",
    );
  }
  pass("compromiso_de_politica", "Los límites evaluados son los comprometidos en el mandato.");

  const authorization = await deps.chain.readAuthorization(presentation.authorizationId);
  if (authorization === null || !authorization.active) {
    return reject(
      "autorizacion",
      "authorization_invalid",
      "No hay ninguna reserva activa con ese id. Sin reserva no hay presupuesto comprometido y el cobro puede fallar después.",
    );
  }
  if (authorization.mandateId !== open.mandateId) {
    return reject(
      "autorizacion",
      "authorization_invalid",
      "La reserva pertenece a otro mandato distinto del presentado.",
    );
  }
  if (authorization.amount !== checkout.amount) {
    return reject(
      "autorizacion",
      "authorization_invalid",
      `La reserva es por ${authorization.amount} y el carrito suma ${checkout.amount}.`,
    );
  }
  if (authorization.expiresAt <= nowSec) {
    return reject("autorizacion", "authorization_invalid", "La reserva ya venció.");
  }
  pass(
    "autorizacion",
    `Reserva ${presentation.authorizationId.slice(0, 18)}… activa por ${authorization.amount}, de un solo uso.`,
  );

  // -------------------------------------------------------------------------
  // Aceptado
  // -------------------------------------------------------------------------

  return {
    ok: true,
    checks,
    buyer,
    receipt: signReceipt(
      {
        closedJwt: presentation.closed.jwt,
        merchant: checkout.merchant,
        authorizationId: presentation.authorizationId,
        currency: checkout.currency,
        amount: checkout.amount,
      },
      deps.merchantKey,
      deps.clock,
    ),
  };
}
