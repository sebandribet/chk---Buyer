/**
 * El decision log del equipo, ejecutable.
 *
 * Las tres decisiones de diseño están escritas en el log y son un entregable del
 * challenge. Un log que dice una cosa y un código que hace otra es peor que no
 * tener log: es una defensa que se cae cuando el jurado abre un archivo.
 *
 * Estos tests son el candado. Si alguien rompe una decisión, no se entera en la
 * presentación — se entera acá.
 */

import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorize } from "@/agent/authorize.js";
import { confirmForm, editForm, matchesProposal, openForReview } from "@/mandate/form.js";
import { merchant as merchantKeys } from "@/mandate/keys.js";
import { FakePaymentPort } from "@/payments/fake.js";
import { Settlement } from "@/settlement/index.js";
import { borrador, carrito, IDENTIDAD, montar, TARJETA } from "./support/flow.js";

// ---------------------------------------------------------------------------
// #01 · Mandate creation experience
//      "A form-first flow generated from an agent's initial interpretation."
//      "Mandate creation is a responsibility of the user."
// ---------------------------------------------------------------------------

describe("#01 · el mandato lo crea el usuario, no el agente", () => {
  it("no se puede firmar un borrador que el humano no revisó", async () => {
    // La garantía la da el TIPO, no el runtime: `confirmMandate` sólo acepta un
    // `ConfirmedMandateForm`, y la única forma de conseguir uno es pasar por
    // `openForReview` → `confirmForm`. No hay constructor público.
    //
    // Lo que se puede comprobar en un test es que la firma siga siendo esa. Si
    // alguien la afloja a `MandateDraft`, esto falla — y el resto de la suite,
    // que hoy no puede saltearse la revisión, empezaría a poder.
    const fuente = await readFile(
      fileURLToPath(new URL("../src/mandate/open.ts", import.meta.url)),
      "utf8",
    );

    const firma = fuente
      .slice(fuente.indexOf("export async function confirmMandate("))
      .slice(0, fuente.slice(fuente.indexOf("export async function confirmMandate(")).indexOf(")"));

    expect(firma).toContain("ConfirmedMandateForm");
    expect(firma).not.toContain("MandateDraft");
  });

  it("el mandato firmado registra qué propuso el agente y qué cambió el humano", async () => {
    const propuesto = borrador();
    const escena = await montar(propuesto, { suggestedBudgetArs: 300_000 });
    const review = escena.issued.credential.payload.review;

    expect(review.draftedBy).toBe("agent");
    expect(review.editedFields).toEqual(["suggestedBudgetArs"]);
    // El hash prueba QUÉ se le puso adelante al humano. Con el borrador
    // original, cualquiera comprueba que lo firmado sale de esa propuesta.
    expect(matchesProposal(review, propuesto)).toBe(true);
  });

  it("lo que se firma es lo que editó el humano, no lo que propuso el agente", async () => {
    const escena = await montar(borrador(), { suggestedBudgetArs: 300_000 });
    const monto = escena.issued.constraints.find((c) => c.type === "checkout.max_amount");

    // El agente proponía $500.000; el humano firmó $300.000.
    expect(monto?.type === "checkout.max_amount" && monto.maxTotal).toBe(30_000_000);
    expect(escena.issued.terms.maxTotal).toBe(30_000_000);
  });

  it("leer y no cambiar nada también es revisar", () => {
    // No hace falta editar para que haya decisión. Lo que se registra es que
    // hubo revisión, no que hubo desacuerdo.
    const confirmado = confirmForm(openForReview(borrador()), new Date());
    expect(confirmado.review.editedFields).toEqual([]);
    expect(confirmado.review.confirmedAt).toBeGreaterThan(0);
  });

  it("reordenar una lista no cuenta como edición", () => {
    const propuesto = borrador({ allowedCategories: ["food", "cleaning"] });
    const form = editForm(openForReview(propuesto), { allowedCategories: ["food", "cleaning"] });

    // Contar cambios que el humano no hizo ensuciaría el registro justo donde
    // tiene que ser preciso.
    expect(form.editedFields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #02 · Mandate publication authority
//      "Publish the authorization through a smart contract."
//      "A merchant can verify ... against shared state rather than trusting an
//       agent assertion."
// ---------------------------------------------------------------------------

describe("#02 · la autoridad se publica en el contrato, no en una base", () => {
  it("el vendedor lee el estado del contrato, no lo que le dice el agente", async () => {
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
    if (result.status !== "authorized") throw new Error("debía autorizar");

    // La credencial sigue firmada y es auténtica. Lo que cambió es el estado
    // compartido, y el vendedor lo consulta en vez de creerle a la credencial.
    await escena.chain.revokeMandate(escena.issued.mandateId, IDENTIDAD.owner);
    const veredicto = await escena.merchant.verify(result.presentation);

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("mandate_not_usable");
  });

  it("el vendedor comprueba binding, estado, vencimiento y límites contra el contrato", async () => {
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
    if (result.status !== "authorized") throw new Error("debía autorizar");

    const veredicto = await escena.merchant.verify(result.presentation);
    expect(veredicto.ok).toBe(true);

    const chequeos = veredicto.checks.map((c) => c.check);
    // Lo que el decision log enumera como verificable contra estado compartido.
    expect(chequeos).toContain("estado_del_mandato");
    expect(chequeos).toContain("autorizacion");
    expect(chequeos).toContain("compromiso_de_politica");
    expect(chequeos).toContain("vigencia_open");
  });

  it("los límites evaluados son los comprometidos on-chain", async () => {
    const escena = await montar();

    // `policyHash` es la junta entre la credencial y el contrato. Sin esto, el
    // vendedor evaluaría límites que nadie garantiza que sean los firmados.
    expect(escena.chain.termsOf(escena.issued.mandateId).policyHash).toBe(
      escena.issued.credential.payload.policyHash,
    );
  });
});

// ---------------------------------------------------------------------------
// #03 · Buyer payment experience
//      "Trad-fi payment methods are the intended buyer experience.
//       Blockchain is internal authorization and audit layer."
// ---------------------------------------------------------------------------

describe("#03 · el comprador paga con tarjeta, no con una wallet", () => {
  it("el medio de pago del comprador es un token de tarjeta", async () => {
    const escena = await montar();
    const instrumentos = escena.issued.constraints.find(
      (c) => c.type === "checkout.allowed_payment_instruments",
    );

    expect(instrumentos?.type === "checkout.allowed_payment_instruments" && instrumentos.allowed).toEqual([
      { ref: "pm_test_visa_4242", brand: "visa", last4: "4242" },
    ]);
  });

  it("el comprador no necesita firmar nada con una wallet para pagar", async () => {
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
    if (result.status !== "authorized") throw new Error("debía autorizar");

    const veredicto = await escena.merchant.verify(result.presentation);
    if (!veredicto.ok) throw new Error("el vendedor debía aceptar");

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

    // Todo el cobro pasa por el puerto de pagos con un token de tarjeta. La
    // chain no mueve un peso: sólo dice si estaba permitido y cuánto queda.
    const held = await settlement.hold({
      authorizationId: result.presentation.authorizationId,
      instrument: TARJETA,
      merchantId: "distribuidora-norte",
      intentHash: result.presentation.closed.payload.checkout_hash,
      receipt: veredicto.receipt,
    });
    expect(held.status).toBe("held");
    if (held.status !== "held") return;

    const cobro = await settlement.capture(result.presentation.authorizationId, held.hold.holdRef);
    expect(cobro.status).toBe("captured");
  });

  it("el puerto de pagos no sabe nada de la chain", async () => {
    // Si el proveedor de pagos importara la chain, la experiencia trad-fi
    // dependería del mock de blockchain, que es exactamente al revés de la
    // decisión: la chain es la capa interna, no la que cobra.
    const dir = fileURLToPath(new URL("../src/payments", import.meta.url));
    const archivos = (await readdir(dir)).filter((f) => f.endsWith(".ts"));

    for (const nombre of archivos) {
      const code = await readFile(join(dir, nombre), "utf8");
      expect(code).not.toContain("@/mandate/chain");
      expect(code).not.toContain("MandateRegistryPort");
    }
  });
});
