/**
 * El acto de firmar: borrador → Open Checkout Mandate.
 *
 * Esto es lo que AP2 llama la *trusted surface*, y su definición es por lo que
 * NO hace: no razona, no completa lo que falta, no llama a ningún modelo.
 * Toma lo que el humano tiene delante, lo firma con su clave y lo registra.
 * Cada dato que sale de acá entró por un campo del borrador que el humano vio.
 *
 * Es el único lugar del sistema donde nace autoridad de gasto. Todo lo demás
 * —el agente, el policy engine, el verificador— consume autoridad creada acá o
 * la restringe; nada la amplía.
 *
 * En un producto de verdad esta función corre en el dispositivo del humano,
 * detrás de una biometría, y la clave privada nunca sale de ahí.
 */

import {
  ACTION_PURCHASE,
  type Clock,
  type MandateDraft,
  type MandateRegistryPort,
  type MandateTerms,
} from "@/contracts/index.js";
import type {
  BuyerProfile,
  Constraint,
  Disclosure,
  MerchantRef,
  OpenCheckoutMandate,
  PaymentInstrumentRef,
  SignedCredential,
} from "../../../shared/ap2.js";
import { buildConstraints, policyHash, toMinorUnits } from "./constraints.js";
import { makeDisclosures, nowSeconds, signJwt, toConfirmationKey, type KeyPair } from "./sdjwt.js";

/**
 * Cuánto dura un mandato al que el humano no le puso vencimiento.
 *
 * Que exista un default es una decisión, no una comodidad. Un mandato sin
 * vencimiento es autoridad de gasto perpetua, y "el humano no dijo nada" es
 * exactamente el caso donde no corresponde asumir lo más permisivo. Treinta
 * días es corto para hacer daño y largo para que la demo tenga sentido; el
 * humano siempre puede firmar otro.
 */
const VENCIMIENTO_POR_DEFECTO_DIAS = 30;

export interface MandateIdentity {
  /** El comercio que compra. Dueño del mandato en el contrato. */
  owner: string;
  /** El agente que queda habilitado. Su clave pública va en `cnf`. */
  agent: string;
  /** Quién puede consumir la reserva para cobrar. */
  paymentDelegate: string;
  currency: string;
  /**
   * Con qué tarjetas puede pagar este mandato.
   *
   * Viene de acá y no del borrador a propósito: el borrador lo redacta el
   * agente, y de qué tarjeta se usa no opina el agente. El humano la elige en
   * el momento de firmar, viendo marca y últimos cuatro dígitos.
   */
  paymentInstruments: PaymentInstrumentRef[];
}

export interface IssuedMandate {
  mandateId: string;
  /** La credencial firmada. Es lo que viaja al merchant. */
  credential: SignedCredential<OpenCheckoutMandate>;
  /**
   * Las divulgaciones quedan del lado del agente, NO dentro de la credencial.
   * En la credencial sólo van los hashes; el agente elige en cada compra cuáles
   * de estas entrega. Si viajaran todas juntas no habría divulgación selectiva,
   * habría un perfil completo con pasos extra.
   */
  disclosures: Disclosure[];
  constraints: Constraint[];
  terms: MandateTerms;
}

export interface ConfirmMandateDeps {
  registry: MandateRegistryPort;
  /** La clave del humano. Sin esto no hay mandato, y no hay sustituto. */
  userKey: KeyPair;
  /** La pública del agente, para endosarla en `cnf`. */
  agentKey: Pick<KeyPair, "publicKey">;
  clock: Clock;
  /** Nombres legibles de los proveedores. Si falta uno, se usa su id. */
  supplierNames?: Record<string, string>;
}

function toMerchantRefs(
  ids: string[] | null,
  names: Record<string, string> | undefined,
): MerchantRef[] | null {
  if (ids === null) return null;
  return ids.map((id) => ({ id, name: names?.[id] ?? id }));
}

/**
 * El humano confirma el borrador y el mandato pasa a existir.
 *
 * El orden importa y no es intercambiable:
 *
 *   1. se arman los límites y se calcula su hash
 *   2. se crea el mandato on-chain CON ese hash
 *   3. recién ahí se firma la credencial, que ya puede citar el `mandateId`
 *
 * Al revés no cierra: la credencial tiene que nombrar el mandato del contrato,
 * y el id lo produce el contrato. Ese ida y vuelta es lo que deja los dos
 * anclajes atados por `policyHash` — el merchant puede comprobar que los
 * límites que le muestran son los que el humano firmó, sin creerle a nadie.
 */
export async function confirmMandate(
  draft: MandateDraft,
  identity: MandateIdentity,
  profile: BuyerProfile,
  deps: ConfirmMandateDeps,
): Promise<IssuedMandate> {
  const iat = nowSeconds(deps.clock);
  const exp =
    draft.expiresAt !== null
      ? Math.floor(new Date(draft.expiresAt).getTime() / 1000)
      : iat + VENCIMIENTO_POR_DEFECTO_DIAS * 24 * 60 * 60;

  if (!Number.isFinite(exp) || exp <= iat) {
    throw new Error(
      `El borrador vence en "${draft.expiresAt}", que no es una fecha futura válida. Un mandato ya vencido no se firma.`,
    );
  }

  const constraints = buildConstraints({
    allowedCategories: draft.allowedCategories,
    allowedSuppliers: toMerchantRefs(draft.allowedSuppliers, deps.supplierNames),
    currency: identity.currency,
    maxPerOperationArs: draft.suggestedMaxPerPurchaseArs,
    maxTotalArs: draft.suggestedBudgetArs,
    maxDeliveryDays: draft.maxDeliveryDays,
    paymentInstruments: identity.paymentInstruments,
  });

  const hash = policyHash(constraints);

  const terms: MandateTerms = {
    agent: identity.agent,
    paymentDelegate: identity.paymentDelegate,
    validAfter: iat,
    expiresAt: exp,
    maxPerOperation: toMinorUnits(draft.suggestedMaxPerPurchaseArs),
    maxTotal: toMinorUnits(draft.suggestedBudgetArs),
    allowedActions: 1 << ACTION_PURCHASE,
    policyHash: hash,
  };

  const mandateId = await deps.registry.createMandate(identity.owner, terms, constraints);

  const { _sd, disclosures } = makeDisclosures(profile);

  const payload: OpenCheckoutMandate = {
    vct: "mandate.checkout.open.1",
    mandateId,
    owner: identity.owner,
    constraints,
    policyHash: hash,
    cnf: toConfirmationKey(deps.agentKey.publicKey),
    agent: identity.agent,
    paymentDelegate: identity.paymentDelegate,
    _sd,
    _sd_alg: "sha-256",
    iat,
    exp,
  };

  return {
    mandateId,
    credential: signJwt(payload, deps.userKey.privateKey),
    disclosures,
    constraints,
    terms,
  };
}
