/**
 * Firmar el mandato y registrarlo: el único punto del sistema donde nace
 * autoridad de gasto.
 *
 * Dos familias de tests. Una comprueba que la credencial y el contrato quedan
 * atados por `policyHash` —si se despegan, todo lo de arriba verifica contra
 * límites que el humano nunca firmó—. La otra comprueba que el espejo del
 * contrato rechaza exactamente lo que rechaza el Solidity, para que un error de
 * términos se descubra en un test y no en la demo.
 */

import { describe, expect, it } from "vitest";
import { FixedClock } from "@/agent/context.js";
import { ACTION_PURCHASE, type MandateDraft } from "@/contracts/index.js";
import { ChainError, FakeMandateChain } from "@/mandate/chain.js";
import { policyHash, toMinorUnits } from "@/mandate/constraints.js";
import { agente, impostor, usuario } from "@/mandate/keys.js";
import { confirmMandate, type MandateIdentity } from "@/mandate/open.js";
import { fromConfirmationKey, signJwt, verifyJwt } from "@/mandate/sdjwt.js";
import type { BuyerProfile, OpenCheckoutMandate } from "../../shared/ap2.js";

const NOW = new Date("2026-08-29T12:00:00.000Z");

const perfil: BuyerProfile = {
  razonSocial: "Café del Sur S.R.L.",
  cuit: "30-71234567-4",
  direccionEntrega: "Av. Corrientes 1234, CABA",
  contactoNombre: "Marina Ferreyra",
  contactoEmail: "compras@cafedelsur.ar",
  contactoTelefono: "+54 11 4567-8901",
};

const identidad: MandateIdentity = {
  owner: "0xCAFEDELSUR",
  agent: "0xAGENTE",
  paymentDelegate: "0xDELEGADO",
  currency: "ARS",
};

function borrador(overrides: Partial<MandateDraft> = {}): MandateDraft {
  return {
    naturalLanguageDescription: "comprá café y detergente para la semana",
    allowedCategories: ["alimentos", "limpieza"],
    suggestedBudgetArs: 500_000,
    suggestedMaxPerPurchaseArs: 60_000,
    allowedSuppliers: null,
    maxDeliveryDays: 3,
    expiresAt: "2026-09-29T12:00:00.000Z",
    userCartConfirmationRequired: true,
    ...overrides,
  };
}

function setup() {
  const clock = new FixedClock(NOW);
  const chain = new FakeMandateChain(clock);
  return {
    clock,
    chain,
    deps: { registry: chain, userKey: usuario, agentKey: agente, clock },
  };
}

describe("confirmar el mandato", () => {
  it("produce una credencial que verifica con la clave del humano", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    const payload = verifyJwt<OpenCheckoutMandate>(issued.credential.jwt, usuario.publicKey);
    expect(payload).not.toBeNull();
    expect(payload!.vct).toBe("mandate.checkout.open.1");
    expect(payload!.mandateId).toBe(issued.mandateId);
    expect(payload!.owner).toBe("0xCAFEDELSUR");
    expect(await chain.read(issued.mandateId)).toMatchObject({ active: true, revokedAt: null });
  });

  it("la credencial NO verifica con ninguna otra clave", async () => {
    const { deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    expect(verifyJwt(issued.credential.jwt, agente.publicKey)).toBeNull();
    expect(verifyJwt(issued.credential.jwt, impostor.publicKey)).toBeNull();
  });

  it("el agente queda endosado en cnf: puede firmar compras, no mandatos", async () => {
    const { deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    const endosada = fromConfirmationKey(issued.credential.payload.cnf);
    expect(verifyJwt(signJwt({ x: 1 }, agente.privateKey).jwt, endosada)).toEqual({ x: 1 });
    expect(verifyJwt(signJwt({ x: 1 }, impostor.privateKey).jwt, endosada)).toBeNull();
  });

  it("el policyHash de la credencial es el mismo que quedó en el contrato", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    // Los tres tienen que coincidir: la credencial, el contrato, y lo que da
    // recomputar el hash sobre los constraints. Es la junta entre los dos
    // anclajes, y si se despega el merchant queda verificando contra aire.
    expect(issued.credential.payload.policyHash).toBe(issued.terms.policyHash);
    expect(chain.termsOf(issued.mandateId).policyHash).toBe(issued.terms.policyHash);
    expect(policyHash(issued.constraints)).toBe(issued.terms.policyHash);
  });

  it("los términos on-chain reflejan el borrador, en centavos", async () => {
    const { deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    expect(issued.terms).toMatchObject({
      agent: "0xAGENTE",
      paymentDelegate: "0xDELEGADO",
      maxTotal: toMinorUnits(500_000),
      maxPerOperation: toMinorUnits(60_000),
      allowedActions: 1 << ACTION_PURCHASE,
    });
  });

  it("los datos del comprador viajan hasheados, no en claro", async () => {
    const { deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    // El CUIT no puede aparecer en la credencial firmada: la credencial es
    // pública por definición, cualquiera que la reciba la puede leer.
    expect(issued.credential.jwt).not.toContain("71234567");
    expect(JSON.stringify(issued.credential.payload)).not.toContain("71234567");
    expect(issued.credential.payload._sd).toHaveLength(6);

    // Las divulgaciones quedan del lado del agente, sin viajar.
    expect(issued.disclosures.map((d) => d.claim).sort()).toEqual([
      "contactoEmail",
      "contactoNombre",
      "contactoTelefono",
      "cuit",
      "direccionEntrega",
      "razonSocial",
    ]);
  });

  it("un borrador sin vencimiento no produce un mandato eterno", async () => {
    const { deps } = setup();
    const issued = await confirmMandate(borrador({ expiresAt: null }), identidad, perfil, deps);

    const dias = (issued.terms.expiresAt - issued.terms.validAfter) / 86_400;
    expect(dias).toBe(30);
  });

  it("no firma un mandato que ya nació vencido", async () => {
    const { deps } = setup();
    await expect(
      confirmMandate(borrador({ expiresAt: "2020-01-01T00:00:00.000Z" }), identidad, perfil, deps),
    ).rejects.toThrow(/fecha futura/);
  });

  it("sin límite de proveedor el constraint se omite, no se manda vacío", async () => {
    const { deps } = setup();
    const abierto = await confirmMandate(borrador({ allowedSuppliers: null }), identidad, perfil, deps);
    const acotado = await confirmMandate(
      borrador({ allowedSuppliers: ["distribuidora-norte"] }),
      identidad,
      perfil,
      deps,
    );

    expect(abierto.constraints.some((c) => c.type === "checkout.allowed_merchants")).toBe(false);
    expect(acotado.constraints.some((c) => c.type === "checkout.allowed_merchants")).toBe(true);
    // Y son políticas distintas, así que el compromiso también cambia.
    expect(abierto.terms.policyHash).not.toBe(acotado.terms.policyHash);
  });
});

describe("el contrato rechaza términos inválidos", () => {
  it("no acepta un techo por compra mayor que el presupuesto total", async () => {
    const { deps } = setup();
    // El Solidity exige maxTotal >= maxPerOperation. Si el borrador se
    // desincroniza, tiene que romper acá y no en el deploy.
    await expect(
      confirmMandate(
        borrador({ suggestedBudgetArs: 10_000, suggestedMaxPerPurchaseArs: 60_000 }),
        identidad,
        perfil,
        deps,
      ),
    ).rejects.toThrow(ChainError);
  });

  it("no acepta un techo por compra de cero", async () => {
    const { deps } = setup();
    await expect(
      confirmMandate(borrador({ suggestedMaxPerPurchaseArs: 0 }), identidad, perfil, deps),
    ).rejects.toThrow(ChainError);
  });

  it("no acepta un mandato cuya política no hashea a su policyHash", async () => {
    const { chain } = setup();
    await expect(
      chain.createMandate(
        "0xOWNER",
        {
          agent: "0xAGENTE",
          paymentDelegate: "0xDELEGADO",
          validAfter: 1,
          expiresAt: 2,
          maxPerOperation: 100,
          maxTotal: 100,
          allowedActions: 1,
          policyHash: "hash-mentido",
        },
        [{ type: "checkout.allowed_categories", allowed: ["alimentos"] }],
      ),
    ).rejects.toThrow(/PolicyHashMismatch/);
  });
});

describe("revocación", () => {
  it("la próxima lectura ya ve el mandato muerto", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    expect((await chain.read(issued.mandateId)).active).toBe(true);
    await chain.revokeMandate(issued.mandateId, identidad.owner);

    const despues = await chain.read(issued.mandateId);
    expect(despues.active).toBe(false);
    expect(despues.revokedAt).toBe(NOW.toISOString());
  });

  it("sólo el dueño puede revocar", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    // Ni el agente ni nadie más. Si el agente pudiera tocar esto, podría
    // revocar y volver a crear con límites más amplios.
    await expect(chain.revokeMandate(issued.mandateId, "0xAGENTE")).rejects.toThrow(/NotOwner/);
  });

  it("revocar dos veces no rompe", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(borrador(), identidad, perfil, deps);

    await chain.revokeMandate(issued.mandateId, identidad.owner);
    await expect(chain.revokeMandate(issued.mandateId, identidad.owner)).resolves.toBeUndefined();
  });
});

describe("la vista que consume el agente", () => {
  it("combina el estado on-chain con la política que el hash compromete", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(
      borrador({ allowedSuppliers: ["distribuidora-norte"] }),
      identidad,
      perfil,
      deps,
    );

    expect(await chain.read(issued.mandateId)).toMatchObject({
      budgetTotalArs: 500_000,
      budgetSpentArs: 0,
      maxPerPurchaseArs: 60_000,
      allowedCategories: ["alimentos", "limpieza"],
      allowedSuppliers: ["distribuidora-norte"],
      source: "fake",
    });
  });

  it("sin constraint de proveedores la vista dice null, que es 'cualquiera'", async () => {
    const { chain, deps } = setup();
    const issued = await confirmMandate(borrador({ allowedSuppliers: null }), identidad, perfil, deps);

    expect((await chain.read(issued.mandateId)).allowedSuppliers).toBeNull();
  });
});
