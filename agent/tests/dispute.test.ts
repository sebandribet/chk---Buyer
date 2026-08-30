/**
 * La disputa, que es donde se cobra todo lo construido antes.
 *
 * El titular dice "yo no autoricé esto". La respuesta no se fabrica en ese
 * momento: ya existía, firmada por él, desde antes de la compra. Estos tests
 * comprueban que la evidencia efectivamente cierra —que cada eslabón referencia
 * al anterior por hash— porque una cadena que no cierra es peor que no tener
 * nada: es una defensa que se cae cuando alguien la revisa.
 */

import { describe, expect, it } from "vitest";
import { authorize } from "@/agent/authorize.js";
import { FakeDisputePort } from "@/payments/disputes.js";
import { FakePaymentPort } from "@/payments/fake.js";
import { buildDisputeEvidence, TEST_MODE_OUTCOME } from "@/settlement/dispute.js";
import { Settlement } from "@/settlement/index.js";
import { sha256b64u, verifyJwt } from "@/mandate/sdjwt.js";
import { merchant as merchantKeys, usuario } from "@/mandate/keys.js";
import { carrito, IDENTIDAD, montar, TARJETA } from "./support/flow.js";
import type { OpenCheckoutMandate } from "../../shared/ap2.js";

const PROMPT = "comprá 2kg de café para la semana";

/** Compra completa, cobrada, con recibo. El punto de partida de cualquier disputa. */
async function compraCobrada() {
  const escena = await montar();

  const result = await authorize(
    {
      cart: { ...carrito(), mandateId: escena.issued.mandateId },
      open: escena.issued.credential,
      disclosures: escena.issued.disclosures,
      merchantId: "distribuidora-norte",
      paymentInstrument: TARJETA,
    },
    escena.authorizeDeps,
    escena.ctx,
  );
  if (result.status !== "authorized") throw new Error("no autorizó");

  const veredicto = await escena.merchant.verify(result.presentation);
  if (!veredicto.ok) throw new Error(`el vendedor rechazó: ${veredicto.detail}`);

  const pagos = new FakePaymentPort(escena.clock);
  const settlement = new Settlement({
    payments: pagos,
    chain: escena.chain,
    settlement: escena.chain,
    authorizations: escena.chain,
    paymentDelegate: IDENTIDAD.paymentDelegate,
    merchantPublicKey: merchantKeys.publicKey,
    clock: escena.clock,
    audit: escena.ctx.audit,
  });

  const held = await settlement.hold({
    authorizationId: result.presentation.authorizationId,
    instrument: TARJETA,
    merchantId: "distribuidora-norte",
    intentHash: result.presentation.closed.payload.checkout_hash,
    receipt: veredicto.receipt,
  });
  if (held.status !== "held") throw new Error("no retuvo");

  const cobro = await settlement.capture(result.presentation.authorizationId, held.hold.holdRef);
  if (cobro.status !== "captured") throw new Error("no cobró");

  // El recibo FIRMADO por el vendedor, tal como salió de la verificación.
  const recibo = veredicto.receipt;

  return {
    escena,
    presentation: result.presentation,
    cobro,
    recibo,
    pagos,
    holdRef: held.hold.holdRef,
    disputas: new FakeDisputePort(escena.clock),
  };
}

describe("la evidencia", () => {
  it("junta todo lo que ya existía, sin inventar nada", async () => {
    const c = await compraCobrada();

    const evidencia = buildDisputeEvidence({
      presentation: c.presentation,
      receipt: c.recibo,
      prompt: PROMPT,
      events: c.escena.ctx.audit.events(),
    });

    // La firma del titular no es un proxy ni una casilla marcada: es su clave
    // sobre los límites que él eligió, de antes de que existiera esta compra.
    expect(evidencia.customerSignature).toBe(c.presentation.open.jwt);
    expect(evidencia.customerCommunication).toBe(PROMPT);
    expect(evidencia.productDescription).toContain("Café en grano");
    expect(evidencia.accessActivityLog.length).toBeGreaterThan(0);
  });

  it("la firma del mandato se verifica contra la clave pública del titular", async () => {
    const c = await compraCobrada();
    const evidencia = buildDisputeEvidence({
      presentation: c.presentation,
      receipt: c.recibo,
      prompt: PROMPT,
      events: c.escena.ctx.audit.events(),
    });

    // Lo que hace que la evidencia valga: cualquiera puede comprobarla sin
    // pedirnos permiso ni creernos nada.
    const mandato = verifyJwt<OpenCheckoutMandate>(evidencia.customerSignature, usuario.publicKey);
    expect(mandato).not.toBeNull();
    expect(mandato!.owner).toBe(IDENTIDAD.owner);
  });

  it("la cadena de hashes cierra: cada eslabón referencia al anterior", async () => {
    const c = await compraCobrada();

    // El eslabón 2 cuelga del 1.
    expect(c.presentation.closed.payload.sd_hash).toBe(sha256b64u(c.presentation.open.jwt));
    // El eslabón 5 (recibo) referencia al 2 (la compra).
    expect(c.recibo.payload.reference).toBe(sha256b64u(c.presentation.closed.jwt));
  });

  it("el relato explica cómo verificarla, no sólo la adjunta", async () => {
    const c = await compraCobrada();
    const evidencia = buildDisputeEvidence({
      presentation: c.presentation,
      receipt: c.recibo,
      prompt: PROMPT,
      events: c.escena.ctx.audit.events(),
    });

    // Un analista de disputas no corre código. Si la evidencia no dice qué
    // prueba y cómo se ata, es un adjunto que nadie va a mirar.
    expect(evidencia.uncategorizedText).toContain(c.presentation.open.payload.mandateId);
    expect(evidencia.uncategorizedText).toContain("CÓMO SE VERIFICA");
    expect(evidencia.uncategorizedText).toContain("o entregó su clave");
  });

  it("el trail incluye las ofertas descartadas, no sólo la comprada", async () => {
    const c = await compraCobrada();
    const evidencia = buildDisputeEvidence({
      presentation: c.presentation,
      receipt: c.recibo,
      prompt: PROMPT,
      events: c.escena.ctx.audit.events(),
    });

    // Un agente que sólo informa lo que compró es incontrolable. Que el trail
    // muestre contra qué se comparó es lo que separa un criterio de un impulso.
    expect(evidencia.accessActivityLog).toContain("policy_check");
    expect(evidencia.accessActivityLog).toContain("payment_captured");
  });
});

describe("el circuito de la disputa", () => {
  it("el titular desconoce el cobro y la evidencia lo resuelve", async () => {
    const c = await compraCobrada();

    const disputa = c.disputas.open(c.cobro.captureRef, { minor: 2552, currency: "usd" });
    expect(disputa.status).toBe("needs_response");

    const evidencia = buildDisputeEvidence({
      presentation: c.presentation,
      receipt: c.recibo,
      prompt: PROMPT,
      events: c.escena.ctx.audit.events(),
    });

    const resuelta = await c.disputas.submitEvidence(disputa.disputeRef, {
      ...evidencia,
      uncategorizedText: `${TEST_MODE_OUTCOME.gana}\n${evidencia.uncategorizedText}`,
    });

    expect(resuelta.status).toBe("won");
  });

  it("la disputa apunta al cobro real, que es lo que ata todo con el mandato", async () => {
    const c = await compraCobrada();
    const disputa = c.disputas.open(c.cobro.captureRef, { minor: 2552, currency: "usd" });

    // Desde la disputa se llega al cobro, del cobro a la reserva on-chain, y de
    // ahí al mandato firmado. Esa cadena es lo que permite contestar meses
    // después sin depender de que alguien se acuerde de nada.
    expect(disputa.captureRef).toBe(c.cobro.captureRef);
    expect(c.pagos.authorizationOf(c.holdRef)).toBe(c.presentation.authorizationId);
  });

  it("sin evidencia la disputa no se gana sola", async () => {
    const c = await compraCobrada();
    const disputa = c.disputas.open(c.cobro.captureRef, { minor: 2552, currency: "usd" });

    const evidencia = buildDisputeEvidence({
      presentation: c.presentation,
      receipt: c.recibo,
      prompt: PROMPT,
      events: c.escena.ctx.audit.events(),
    });

    // Sin el gancho de test mode queda en revisión, que es lo honesto: quien
    // decide es el banco, no nosotros.
    const resuelta = await c.disputas.submitEvidence(disputa.disputeRef, evidencia);
    expect(resuelta.status).toBe("under_review");
  });
});
