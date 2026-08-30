/**
 * Los ataques.
 *
 * Este archivo vale más que cualquier pantalla del proyecto. Cada test es un
 * agente que miente de una forma distinta, y en todos el vendedor lo agarra sin
 * saber nada del agente más allá de lo que le mostró.
 *
 * El primer test es el camino feliz, y está sólo para que los demás signifiquen
 * algo: un verificador que rechaza todo también pasaría los quince siguientes.
 */

import { describe, expect, it } from "vitest";
import { authorize, toCheckoutRequest } from "@/agent/authorize.js";
import { ChainError } from "@/mandate/chain.js";
import { closeCheckout } from "@/mandate/closed.js";
import { policyHash } from "@/mandate/constraints.js";
import { agente, impostor, merchant as merchantKeys, usuario } from "@/mandate/keys.js";
import { signJwt, signKeyBinding, verifyJwt } from "@/mandate/sdjwt.js";
import type { MerchantPresentation, OpenCheckoutMandate } from "../../shared/ap2.js";
import {
  borrador,
  carrito,
  carritoConEquipamiento,
  carritoConProveedorAjeno,
  IDENTIDAD,
  montar,
  OTRA_TARJETA,
  TARJETA,
} from "./support/flow.js";

/** Corre el camino completo y devuelve la presentación válida, para después romperla. */
async function presentacionValida(escena: Awaited<ReturnType<typeof montar>>, cart = carrito()) {
  const result = await authorize(
    {
      cart: { ...cart, mandateId: escena.issued.mandateId },
      open: escena.issued.credential,
      disclosures: escena.issued.disclosures,
      merchantId: "distribuidora-norte",
      paymentInstrument: TARJETA,
    },
    escena.authorizeDeps,
    escena.ctx,
  );

  if (result.status !== "authorized") {
    throw new Error(`Se esperaba autorización y vino "${result.reason}": ${result.detail}`);
  }
  return result;
}

// ---------------------------------------------------------------------------

describe("camino feliz", () => {
  it("el vendedor acepta una compra legítima y firma el recibo", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const veredicto = await escena.merchant.verify(presentation);

    expect(veredicto.ok).toBe(true);
    if (!veredicto.ok) return;

    expect(veredicto.receipt.payload.vct).toBe("receipt.checkout.1");
    expect(veredicto.receipt.payload.amount).toBe(3_700_000);
    // El recibo viaja FIRMADO: sin la firma es un objeto que cualquiera pudo
    // escribir, y no serviría como evidencia en una disputa.
    expect(verifyJwt(veredicto.receipt.jwt, merchantKeys.publicKey)).not.toBeNull();
    expect(veredicto.checks.every((c) => c.passed)).toBe(true);
  });

  it("el vendedor ve lo que necesita para facturar y nada más", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);
    const veredicto = await escena.merchant.verify(presentation);

    expect(veredicto.ok).toBe(true);
    if (!veredicto.ok) return;

    expect(veredicto.buyer).toEqual({
      razonSocial: "Café del Sur S.R.L.",
      cuit: "30-71234567-4",
      direccionEntrega: "Av. Corrientes 1234, CABA",
      contactoNombre: "Marina Ferreyra",
      contactoTelefono: "+54 11 4567-8901",
    });

    // El mail no se revela, y el vendedor tampoco sabe que existe: en el
    // mandato es un hash entre otros cinco.
    expect(veredicto.buyer.contactoEmail).toBeUndefined();
    expect(JSON.stringify(presentation)).not.toContain("compras@cafedelsur.ar");
  });

  it("el vendedor no ve el presupuesto ni el gasto acumulado del comprador", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    // Lo que viaja son los TECHOS que autorizan esta compra, no el estado
    // financiero. Cuánto lleva gastado el comprador este mes es información
    // comercial suya y el vendedor no la necesita para vender.
    const serializada = JSON.stringify(presentation);
    expect(serializada).not.toContain("budgetSpent");
    expect(serializada).not.toContain("spent");
    expect(serializada).not.toContain("reserved");
  });
});

// ---------------------------------------------------------------------------
// Los ataques
// ---------------------------------------------------------------------------

describe("el agente miente el monto", () => {
  it("no puede: el carrito lo firma el vendedor, no él", async () => {
    const escena = await montar();
    const { presentation, checkout } = await presentacionValida(escena);

    // El agente rearma el carrito con un total menor y lo firma él.
    const falsificado = signJwt({ ...checkout, amount: 100 }, agente.privateKey);
    const closed = closeCheckout(
      {
        open: escena.issued.credential,
        checkout: falsificado,
        audience: "distribuidora-norte",
        nonce: presentation.closed.payload.nonce,
      },
      agente,
      escena.clock,
    );

    const veredicto = await escena.merchant.verify({
      ...presentation,
      closed: closed.credential,
      kbJwt: closed.kbJwt,
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("checkout_signature_invalid");
  });

  it("tampoco puede editar el carrito firmado: el hash deja de cerrar", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    // Se cambia un byte del JWT del carrito manteniendo el checkout_hash viejo.
    const closedAdulterado = signJwt(
      { ...presentation.closed.payload, checkout_jwt: presentation.closed.payload.checkout_jwt + "x" },
      agente.privateKey,
    );

    const veredicto = await escena.merchant.verify({ ...presentation, closed: closedAdulterado });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("checkout_signature_invalid");
  });
});

describe("compra fuera del mandato", () => {
  it("una categoría que el humano no habilitó no llega ni a reservarse", async () => {
    const escena = await montar();

    const result = await authorize(
      {
        cart: { ...carritoConEquipamiento(), mandateId: escena.issued.mandateId },
        open: escena.issued.credential,
        disclosures: escena.issued.disclosures,
        merchantId: "distribuidora-norte",
        paymentInstrument: TARJETA,
      },
      escena.authorizeDeps,
      escena.ctx,
    );

    // El propio policy engine la frena antes de comprometer plata.
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toBe("constraint_violated");
    expect(result.detail).toContain("equipment");
  });

  it("un agente que se saltea su propio policy engine igual lo agarra el vendedor", async () => {
    // El caso que justifica que el verificador exista. Acá el agente NO llama a
    // `authorize()`: arma la presentación a mano, como haría uno modificado o
    // comprometido. Todas sus firmas son válidas y la reserva on-chain es real
    // —el contrato no sabe de categorías, sólo de montos—, así que lo único que
    // queda entre esta compra y el cobro es que el vendedor evalúe los límites.
    const escena = await montar(borrador({ allowedCategories: ["cleaning"] }));
    const cart = carrito(); // café: categoría "food", fuera del mandato

    const { checkout, nonce } = await escena.merchant.close(
      toCheckoutRequest(cart, "distribuidora-norte", "ARS"),
    );

    const reserva = await escena.chain.reserve({
      mandateId: escena.issued.mandateId,
      agent: IDENTIDAD.agent,
      paymentDelegate: IDENTIDAD.paymentDelegate,
      amount: checkout.payload.amount,
      action: 0,
      intentHash: "carrito-fuera-de-categoria",
      expiresAt: Math.floor(escena.clock.now().getTime() / 1000) + 600,
    });
    // La chain lo dejó pasar: el monto entraba. Los rubros no son su problema.
    expect(reserva.active).toBe(true);

    const closed = closeCheckout(
      { open: escena.issued.credential, checkout, audience: "distribuidora-norte", nonce },
      agente,
      escena.clock,
    );

    const veredicto = await escena.merchant.verify({
      open: escena.issued.credential,
      closed: closed.credential,
      kbJwt: closed.kbJwt,
      disclosures: escena.issued.disclosures.filter((d) => d.claim === "razonSocial"),
      authorizationId: reserva.authorizationId,
      paymentInstrument: TARJETA,
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("constraint_violated");
    expect(veredicto.detail).toContain("food");
  });

  it("un proveedor fuera de la allowlist se rechaza", async () => {
    const escena = await montar();

    const result = await authorize(
      {
        cart: { ...carritoConProveedorAjeno(), mandateId: escena.issued.mandateId },
        open: escena.issued.credential,
        disclosures: escena.issued.disclosures,
        merchantId: "distribuidora-norte",
        paymentInstrument: TARJETA,
      },
      escena.authorizeDeps,
      escena.ctx,
    );

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.detail).toContain("proveedor-fantasma");
  });

  it("una compra por encima del techo por operación se rechaza", async () => {
    const escena = await montar(borrador({ suggestedMaxPerPurchaseArs: 1000 }));

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

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toBe("constraint_violated");
  });
});

describe("la tarjeta equivocada", () => {
  it("el policy engine frena al agente que quiere pagar con otra tarjeta", async () => {
    const escena = await montar();

    const result = await authorize(
      {
        cart: { ...carrito(), mandateId: escena.issued.mandateId },
        open: escena.issued.credential,
        disclosures: escena.issued.disclosures,
        merchantId: "distribuidora-norte",
        // Otra tarjeta del MISMO humano. El mandato autoriza una sola.
        paymentInstrument: OTRA_TARJETA,
      },
      escena.authorizeDeps,
      escena.ctx,
    );

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toBe("constraint_violated");
    expect(result.detail).toContain("amex");
  });

  it("y si igual llega al vendedor, el vendedor la rechaza", async () => {
    // Un mandato es "qué, cuánto, hasta cuándo Y CON QUÉ". Cambiar la tarjeta
    // es salirse del mandato igual que comprar de más: el humano autorizó gastar
    // de una cuenta concreta, no de cualquiera que tenga.
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const veredicto = await escena.merchant.verify({
      ...presentation,
      paymentInstrument: OTRA_TARJETA,
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("constraint_violated");
    expect(veredicto.detail).toContain("····0005");
  });

  it("no alcanza con clonar marca y últimos cuatro: se compara por token", async () => {
    // Dos tarjetas distintas pueden terminar en 4242. Si el chequeo mirara los
    // últimos dígitos, aceptaría por una coincidencia.
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const veredicto = await escena.merchant.verify({
      ...presentation,
      paymentInstrument: { ref: "pm_otra_distinta", brand: "visa", last4: "4242" },
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("constraint_violated");
  });
});

describe("mandatos cruzados", () => {
  it("no se puede colgar una compra de un mandato que no es el suyo", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    // Otro mandato del mismo humano, con límites más amplios.
    const amplio = await montar(
      borrador({ allowedCategories: ["food", "cleaning", "equipment"], suggestedMaxPerPurchaseArs: 500_000 }),
    );

    // El agente presenta la compra de hoy bajo el mandato amplio. Los dos son
    // auténticos y firmados por el humano; lo que no cierra es la atadura.
    const veredicto = await escena.merchant.verify({
      ...presentation,
      open: amplio.issued.credential,
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("sd_hash_mismatch");
  });
});

describe("mandato inventado", () => {
  it("un mandato firmado por cualquiera que no sea el comprador se rechaza", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const falso = signJwt<OpenCheckoutMandate>(
      { ...presentation.open.payload, constraints: [] },
      impostor.privateKey,
    );

    const veredicto = await escena.merchant.verify({ ...presentation, open: falso });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("open_signature_invalid");
  });

  it("una compra firmada por una clave que el humano no endosó se rechaza", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const falsa = signJwt(presentation.closed.payload, impostor.privateKey);
    const veredicto = await escena.merchant.verify({ ...presentation, closed: falsa });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("closed_signature_invalid");
  });
});

describe("constraint desconocido", () => {
  it("un mandato legítimo con un límite que este verificador no conoce se rechaza", async () => {
    // El escenario realista no es un atacante: es el tiempo. Alguien despliega
    // un mandato con un tipo de límite nuevo y este vendedor todavía corre la
    // versión vieja del verificador. Todo es auténtico —lo firmó el humano, el
    // hash cierra, la reserva existe— y aun así hay que rechazar, porque
    // aceptar significaría ignorar un límite que el comprador puso a propósito.
    //
    // Es la regla que la spec escribe en mayúsculas y es contraintuitiva: lo
    // normal en un parser es tolerar lo que no entiende.
    const escena = await montar();

    const constraints = [
      ...escena.issued.constraints,
      { type: "checkout.max_items_per_order", max: 3 } as never,
    ];
    const hash = policyHash(constraints);

    const mandateId = await escena.chain.createMandate(
      IDENTIDAD.owner,
      { ...escena.issued.terms, policyHash: hash },
      constraints,
    );

    const open = signJwt<OpenCheckoutMandate>(
      { ...escena.issued.credential.payload, mandateId, constraints, policyHash: hash },
      usuario.privateKey,
    );

    const { checkout, nonce } = await escena.merchant.close(
      toCheckoutRequest(carrito(), "distribuidora-norte", "ARS"),
    );
    const reserva = await escena.chain.reserve({
      mandateId,
      agent: IDENTIDAD.agent,
      paymentDelegate: IDENTIDAD.paymentDelegate,
      amount: checkout.payload.amount,
      action: 0,
      intentHash: "con-constraint-nuevo",
      expiresAt: Math.floor(escena.clock.now().getTime() / 1000) + 600,
    });
    const closed = closeCheckout(
      { open, checkout, audience: "distribuidora-norte", nonce },
      agente,
      escena.clock,
    );

    const veredicto = await escena.merchant.verify({
      open,
      closed: closed.credential,
      kbJwt: closed.kbJwt,
      disclosures: [],
      authorizationId: reserva.authorizationId,
      paymentInstrument: TARJETA,
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("constraint_unknown");
    expect(veredicto.detail).toContain("max_items_per_order");
  });
});

describe("datos del comprador adulterados", () => {
  it("cambiar el CUIT invalida la presentación entera", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const veredicto = await escena.merchant.verify({
      ...presentation,
      disclosures: presentation.disclosures.map((d) =>
        d.claim === "cuit" ? { ...d, value: "30-99999999-9" } : d,
      ),
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("disclosure_invalid");
  });

  it("inventar un dato que el mandato no compromete también falla", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const veredicto = await escena.merchant.verify({
      ...presentation,
      disclosures: [
        ...presentation.disclosures,
        { salt: "c2Fs", claim: "contactoEmail" as const, value: "otro@dominio.com" },
      ],
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("disclosure_invalid");
  });
});

describe("revocación", () => {
  it("revocar entre la reserva y la presentación mata la compra", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    // El humano revoca. La credencial sigue siendo auténtica y perfectamente
    // firmada: no se puede "desfirmar" un documento. Por eso el estado vive en
    // la chain y el vendedor lo consulta.
    await escena.chain.revokeMandate(escena.issued.mandateId, IDENTIDAD.owner);

    const veredicto = await escena.merchant.verify(presentation);

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("mandate_not_usable");
    expect(veredicto.detail).toContain("revocado");
  });

  it("revocar antes de reservar impide que se comprometa plata", async () => {
    const escena = await montar();
    await escena.chain.revokeMandate(escena.issued.mandateId, IDENTIDAD.owner);

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

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toBe("reservation_rejected");
    expect(result.detail).toContain("MandateNotUsable");
  });
});

describe("replay", () => {
  it("la misma presentación no se cobra dos veces", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    expect((await escena.merchant.verify(presentation)).ok).toBe(true);

    const segunda = await escena.merchant.verify(presentation);
    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.failure).toBe("nonce_replayed");
  });

  it("el mismo carrito no se puede reservar dos veces on-chain", async () => {
    const escena = await montar();

    // `authorizationId = hash(mandateId, checkout_hash)`, así que el segundo
    // intento con el mismo carrito choca contra una autorización que ya existe.
    // La protección contra doble gasto no es un chequeo aparte: es la forma en
    // que se calcula el id.
    const primera = await escena.chain.reserve({
      mandateId: escena.issued.mandateId,
      agent: IDENTIDAD.agent,
      paymentDelegate: IDENTIDAD.paymentDelegate,
      amount: 3_700_000,
      action: 0,
      intentHash: "hash-del-mismo-carrito",
      expiresAt: Math.floor(escena.clock.now().getTime() / 1000) + 600,
    });
    expect(primera.active).toBe(true);

    await expect(
      escena.chain.reserve({
        mandateId: escena.issued.mandateId,
        agent: IDENTIDAD.agent,
        paymentDelegate: IDENTIDAD.paymentDelegate,
        amount: 3_700_000,
        action: 0,
        intentHash: "hash-del-mismo-carrito",
        expiresAt: Math.floor(escena.clock.now().getTime() / 1000) + 600,
      }),
    ).rejects.toThrow(ChainError);
  });

  it("una presentación robada no sirve contra otro vendedor", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const otro = await montar();
    const veredicto = await otro.merchant.verify(presentation);

    // Falla por el nonce: ese vendedor nunca lo emitió. Aunque el nonce
    // coincidiera por casualidad, `aud` lo frenaría igual.
    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(["nonce_replayed", "audience_mismatch"]).toContain(veredicto.failure);
  });

  it("una prueba de posesión de otro no sirve", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const robada = signKeyBinding(
      {
        sd_hash: presentation.closed.payload.sd_hash,
        aud: "distribuidora-norte",
        nonce: presentation.closed.payload.nonce,
        iat: Math.floor(escena.clock.now().getTime() / 1000),
      },
      impostor.privateKey,
    );

    const veredicto = await escena.merchant.verify({ ...presentation, kbJwt: robada });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("key_binding_invalid");
  });
});

describe("vencimientos", () => {
  it("una presentación vieja no vale", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    escena.clock.advance(6 * 60_000);

    const veredicto = await escena.merchant.verify(presentation);
    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("closed_expired");
  });

  it("un mandato vencido no autoriza aunque la firma esté perfecta", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    escena.clock.set(new Date("2026-10-15T12:00:00.000Z"));

    const veredicto = await escena.merchant.verify(presentation);
    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("open_expired");
  });
});

describe("el vendedor tampoco puede hacer trampa", () => {
  it("si devuelve un carrito distinto del que se pidió, el agente no reserva", async () => {
    const escena = await montar();

    // Vendedor que sube el precio al cerrar. La verificación va en las dos
    // direcciones: el comprador no tiene por qué confiar en el vendedor más de
    // lo que el vendedor confía en él.
    const original = escena.merchant.close.bind(escena.merchant);
    escena.merchant.close = async (request) => {
      const inflado = {
        ...request,
        items: request.items.map((i) => ({ ...i, lineAmount: i.lineAmount * 3 })),
      };
      return original(inflado);
    };

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

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.reason).toBe("checkout_tampered");
  });
});

describe("la reserva refleja la compra", () => {
  it("una autorización por otro monto se rechaza", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    // Se apunta a una reserva real pero de otro monto.
    const otra = await escena.chain.reserve({
      mandateId: escena.issued.mandateId,
      agent: IDENTIDAD.agent,
      paymentDelegate: IDENTIDAD.paymentDelegate,
      amount: 500,
      action: 0,
      intentHash: "otro-carrito",
      expiresAt: Math.floor(escena.clock.now().getTime() / 1000) + 600,
    });

    const veredicto = await escena.merchant.verify({
      ...presentation,
      authorizationId: otra.authorizationId,
    });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("authorization_invalid");
  });

  it("una autorización inexistente se rechaza", async () => {
    const escena = await montar();
    const { presentation } = await presentacionValida(escena);

    const veredicto = await escena.merchant.verify({ ...presentation, authorizationId: "0xinventado" });

    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) return;
    expect(veredicto.failure).toBe("authorization_invalid");
  });
});

describe("presupuesto acumulado", () => {
  it("el techo por compra no alcanza: el acumulado también frena", async () => {
    // Cada compra entra en el techo por operación, pero juntas se pasan del
    // presupuesto. Es el límite que ninguna credencial puede hacer cumplir sola,
    // porque requiere saber qué pasó antes. Por eso el estado vive en la chain.
    const escena = await montar(
      borrador({ suggestedBudgetArs: 50_000, suggestedMaxPerPurchaseArs: 40_000 }),
    );

    const cart = { ...carrito(), mandateId: escena.issued.mandateId };
    const primera = await authorize(
      { cart, open: escena.issued.credential, disclosures: escena.issued.disclosures, merchantId: "distribuidora-norte", paymentInstrument: TARJETA },
      escena.authorizeDeps,
      escena.ctx,
    );
    expect(primera.status).toBe("authorized");

    // Segunda compra idéntica: entra en el techo por operación y no en el saldo.
    const segunda = await authorize(
      { cart, open: escena.issued.credential, disclosures: escena.issued.disclosures, merchantId: "distribuidora-norte", paymentInstrument: TARJETA },
      escena.authorizeDeps,
      escena.ctx,
    );

    expect(segunda.status).toBe("refused");
    if (segunda.status !== "refused") return;
    expect(segunda.reason).toBe("reservation_rejected");
    expect(segunda.detail).toContain("AmountExceedsLimit");
  });
});
