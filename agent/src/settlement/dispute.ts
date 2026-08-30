/**
 * La disputa: "yo no autoricé esto".
 *
 * Es la pregunta que el challenge pone al final —*"¿quién responde por la
 * disputa: el humano, el agente, el comercio?"*— y la que hoy no tiene buena
 * respuesta. Cuando el que apretó "pagar" fue un agente, el titular puede negar
 * la compra de buena fe y el comercio no tiene con qué contestar: no hay firma,
 * no hay sesión, no hay nada que mostrarle al banco.
 *
 * Nosotros sí tenemos. Y no porque hayamos construido algo para las disputas:
 * lo tenemos porque el mandato **ya existía firmado antes de la compra**. La
 * evidencia no se fabrica cuando llega el reclamo, se junta.
 *
 * ---
 *
 * **El mapeo es casi literal**, y ese es todo el argumento de este archivo:
 *
 *   `customer_signature`      → el Open Mandate. Es, exactamente, la firma del
 *                               titular autorizando este gasto. No un proxy: su
 *                               clave sobre los límites que él eligió.
 *   `customer_communication`  → el prompt que escribió, textual.
 *   `receipt`                 → el recibo firmado por el vendedor.
 *   `product_description`     → el carrito cerrado, con precios.
 *   `access_activity_log`     → el trail completo, evento por evento.
 *   `uncategorized_text`      → la cadena de hashes que ata todo lo anterior.
 *
 * Lo que responde la pregunta de "quién tiene razón" no es ninguna pieza suelta:
 * es que estén atadas. El recibo referencia el hash de la compra, la compra
 * referencia el hash del mandato, y el mandato lo firmó el titular. Romper esa
 * cadena requiere la clave privada del humano, que es justamente lo que él está
 * afirmando que nadie tuvo.
 *
 * Dicho de otra forma: si la cadena cierra, o el titular autorizó la compra, o
 * entregó su clave. Las dos son responsabilidad suya, y ninguna es del comercio.
 */

import type {
  CheckoutObject,
  MerchantPresentation,
  SignedCredential,
  CheckoutReceipt,
} from "../../../shared/ap2.js";
import type { AuditEvent } from "@/contracts/audit.js";
import type { DisputeEvidence } from "../../../shared/payments.js";
import { peekJwt, sha256b64u } from "@/mandate/sdjwt.js";

export interface EvidenceInput {
  presentation: MerchantPresentation;
  receipt: SignedCredential<CheckoutReceipt>;
  /** El pedido original del humano, textual. */
  prompt: string;
  /** El trail del run que produjo esta compra. */
  events: readonly AuditEvent[];
}

/**
 * La cadena de hashes, escrita para que la lea una persona.
 *
 * Va en `uncategorized_text` porque es el campo que un analista de disputas
 * abre primero. No alcanza con adjuntar documentos: hay que decir qué prueban y
 * cómo se atan, en un párrafo, sin pedirle a nadie que corra código.
 */
function cadenaDeCustodia(input: EvidenceInput): string {
  const open = input.presentation.open;
  const closed = input.presentation.closed;
  const checkout = peekJwt<CheckoutObject>(closed.payload.checkout_jwt);

  const openHash = sha256b64u(open.jwt);
  const closedHash = sha256b64u(closed.jwt);

  return [
    "AUTORIZACIÓN VERIFICABLE DE UNA COMPRA HECHA POR UN AGENTE",
    "",
    "El titular firmó por adelantado un mandato con límites, y esta compra cae",
    "dentro de ellos. Cada eslabón referencia al anterior por hash, así que la",
    "cadena no se puede alterar sin la clave privada del titular.",
    "",
    `1. MANDATO firmado por el titular (${open.payload.owner})`,
    `   id      ${open.payload.mandateId}`,
    `   hash    ${openHash}`,
    `   vigente ${new Date(open.payload.iat * 1000).toISOString()} → ${new Date(open.payload.exp * 1000).toISOString()}`,
    `   límites ${open.payload.constraints.map((c) => c.type).join(", ")}`,
    `   compromiso de política (policyHash): ${open.payload.policyHash}`,
    "",
    "2. COMPRA firmada por el agente que el titular autorizó en ese mandato",
    `   hash          ${closedHash}`,
    `   cuelga de     ${closed.payload.sd_hash}   ← es el hash del mandato de arriba`,
    `   carrito       ${closed.payload.checkout_hash}`,
    `   destinatario  ${closed.payload.aud}`,
    "",
    "3. CARRITO firmado por el vendedor (el precio lo puso él, no el comprador)",
    `   id     ${checkout?.checkoutId ?? "(ilegible)"}`,
    `   total  ${checkout === null ? "(ilegible)" : `${checkout.currency} ${(checkout.amount / 100).toFixed(2)}`}`,
    "",
    "4. RESERVA on-chain: acotada al monto exacto, de un solo uso, con vencimiento",
    `   ${input.presentation.authorizationId}`,
    "",
    "5. RECIBO firmado por el vendedor al aceptar",
    `   reference ${input.receipt.payload.reference}   ← es el hash de la compra del punto 2`,
    "",
    "CÓMO SE VERIFICA, sin confiar en nadie:",
    "  · la firma del mandato se comprueba contra la clave pública del titular",
    "  · sd_hash del punto 2 tiene que dar igual al hash del punto 1",
    "  · reference del punto 5 tiene que dar igual al hash del punto 2",
    "  · cada límite del mandato se re-evalúa contra el carrito del punto 3",
    "",
    "Si la cadena cierra, o el titular autorizó esta compra o entregó su clave",
    "privada. Las dos son responsabilidad suya.",
  ].join("\n");
}

/**
 * Junta la evidencia. No inventa nada: todo esto ya existía antes del reclamo.
 */
export function buildDisputeEvidence(input: EvidenceInput): DisputeEvidence {
  const checkout = peekJwt<CheckoutObject>(input.presentation.closed.payload.checkout_jwt);

  const productDescription =
    checkout === null
      ? "(no se pudo leer el carrito)"
      : checkout.items
          .map((i) => `${i.quantity}× ${i.title} (${i.sku}) — ${(i.lineAmount / 100).toFixed(2)} ${checkout.currency}`)
          .join("\n");

  return {
    // El JWT entero, no un resumen: es lo que permite verificar la firma.
    customerSignature: input.presentation.open.jwt,
    customerCommunication: input.prompt,
    receipt: input.receipt.jwt,
    productDescription,
    // El trail completo. Incluye las ofertas que el agente DESCARTÓ y por qué,
    // que es lo que muestra que hubo un criterio y no un impulso.
    accessActivityLog: input.events.map((e) => JSON.stringify(e)).join("\n"),
    uncategorizedText: cadenaDeCustodia(input),
  };
}

/**
 * El valor que Stripe interpreta en test mode para resolver la disputa.
 *
 * En `uncategorized_text`, la cadena `winning_evidence` cierra la disputa a
 * favor del comercio y `losing_evidence` en contra. Es un gancho de prueba de
 * Stripe, no algo nuestro, y por eso la demo puede terminar en un objeto
 * `dispute` con estado `won` de verdad en vez de en una animación.
 *
 * Se mantiene aparte de `buildDisputeEvidence` a propósito: la evidencia real
 * es la de arriba, esto es el interruptor de la simulación. Mezclarlos haría
 * que el resultado de la demo dependiera de un string mágico escondido adentro
 * de la evidencia, que es justo lo que un jurado debería sospechar.
 */
export const TEST_MODE_OUTCOME = {
  gana: "winning_evidence",
  pierde: "losing_evidence",
} as const;
