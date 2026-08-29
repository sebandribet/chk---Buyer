/**
 * El contrato, en memoria. Espejo de `contracts/mandates/MandateModule.sol`.
 *
 * No es "un mock que hace más o menos lo mismo": replica las validaciones del
 * Solidity una por una, con los mismos nombres de error. Eso lo vuelve útil
 * para lo que importa —si el agente arma unos términos que el contrato real
 * rechazaría, acá también fallan, y se descubre en un test en vez de en la
 * demo— y hace que reemplazarlo por un adapter viem sea cambiar de dónde salen
 * los datos, no qué significan.
 *
 * Distinto de `FakeMandatePort`, que es un fixture: "existe un mandato con
 * estas propiedades". Esto es el registro completo, con creación, revocación,
 * reservas y consumo.
 *
 * ---
 *
 * Un detalle que conviene entender porque se repite en cualquier sistema de
 * este tipo: **el contrato no guarda la política, guarda su hash.** Las
 * categorías y los proveedores permitidos no están on-chain. Están en los
 * constraints del mandato firmado, y lo único que vive en la chain es el
 * `policyHash` que se compromete con ellos.
 *
 * Por eso esta clase mantiene un registro de políticas al lado del de mandatos:
 * es la contraparte off-chain que en producción viene dentro de la credencial.
 * El flujo real es el mismo que acá — se toma la política de donde esté, se
 * recomputa su hash y se compara con el de la chain. Si no coinciden, la
 * política es falsa, sin importar de dónde vino.
 */

import { createHash } from "node:crypto";
import type { Clock } from "@/contracts/index.js";
import type {
  Authorization,
  AuthorizationPort,
  Category,
  ChainReader,
  MandatePort,
  MandateRegistryPort,
  MandateState,
  MandateTerms,
} from "@/contracts/index.js";
import type { Constraint } from "../../../shared/ap2.js";
import { fromMinorUnits, policyHash } from "./constraints.js";

/** Mismos nombres que los `error` del Solidity, para que un fallo se busque igual en los dos lados. */
export type ChainErrorCode =
  | "NotOwner"
  | "UnknownMandate"
  | "InvalidTerms"
  | "MandateNotUsable"
  | "UnauthorizedAgent"
  | "UnauthorizedPaymentDelegate"
  | "ActionNotAllowed"
  | "AmountExceedsLimit"
  | "AuthorizationExists"
  | "AuthorizationNotActive"
  | "InvalidAuthorizationExpiry"
  | "MandateChanged"
  | "PolicyHashMismatch";

export class ChainError extends Error {
  constructor(readonly code: ChainErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "ChainError";
  }
}

type Status = "None" | "Active" | "Revoked";

interface StoredMandate {
  mandateId: string;
  owner: string;
  terms: MandateTerms;
  status: Status;
  revision: number;
  /** Unidad mínima de la moneda. */
  spent: number;
  reserved: number;
  revokedAt: string | null;
}

export class FakeMandateChain implements MandateRegistryPort, AuthorizationPort, ChainReader, MandatePort {
  private readonly mandates = new Map<string, StoredMandate>();
  private readonly authorizations = new Map<string, Authorization>();
  /** La contraparte off-chain del `policyHash`. En producción viene en la credencial. */
  private readonly policies = new Map<string, Constraint[]>();
  private readonly nonces = new Map<string, number>();
  private reads = 0;

  constructor(private readonly clock: Clock) {}

  private now(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  // -------------------------------------------------------------------------
  // Registro
  // -------------------------------------------------------------------------

  policyFor(hash: string): Constraint[] | null {
    return this.policies.get(hash) ?? null;
  }

  /**
   * El hash se recomputa acá y no se le cree al que vino en los términos.
   *
   * Es el único chequeo que impide registrar un mandato cuyo `policyHash` se
   * comprometa con una política y cuyo contenido sea otro. Si esto pasara, todo
   * lo de arriba seguiría verificando "correctamente" contra límites que el
   * humano nunca firmó.
   */
  private bindPolicy(terms: MandateTerms, policy: Constraint[]): void {
    const real = policyHash(policy);
    if (real !== terms.policyHash) {
      throw new ChainError(
        "PolicyHashMismatch",
        `los términos dicen ${terms.policyHash} y la política hashea ${real}`,
      );
    }
    this.policies.set(real, policy);
  }

  async createMandate(owner: string, terms: MandateTerms, policy: Constraint[]): Promise<string> {
    this.validateTerms(terms, 0, 0);
    this.bindPolicy(terms, policy);

    const nonce = this.nonces.get(owner) ?? 0;
    this.nonces.set(owner, nonce + 1);

    const mandateId =
      "0x" + createHash("sha256").update(`chk-buyer|${owner}|${nonce}`).digest("hex").slice(0, 64);

    this.mandates.set(mandateId, {
      mandateId,
      owner,
      terms,
      status: "Active",
      revision: 1,
      spent: 0,
      reserved: 0,
      revokedAt: null,
    });

    return mandateId;
  }

  async amendMandate(
    mandateId: string,
    owner: string,
    terms: MandateTerms,
    policy: Constraint[],
  ): Promise<void> {
    const mandate = this.mustFind(mandateId);
    if (mandate.owner !== owner) throw new ChainError("NotOwner");
    if (mandate.status !== "Active" || this.now() >= mandate.terms.expiresAt) {
      throw new ChainError("MandateNotUsable");
    }

    this.validateTerms(terms, mandate.spent, mandate.reserved);
    this.bindPolicy(terms, policy);

    mandate.terms = terms;
    // Sube la revisión, y eso invalida las reservas en vuelo: `consume`
    // compara la revisión guardada contra la actual. Cambiar los límites del
    // mandato no puede dejar viva una autorización emitida bajo los viejos.
    mandate.revision += 1;
  }

  /**
   * Revocación. Es lo único que el humano puede hacer siempre y sin condiciones.
   *
   * Toma efecto de inmediato: la próxima lectura ya la ve, y cualquier reserva
   * que todavía no se haya consumido queda muerta porque `consumeAuthorization`
   * vuelve a exigir que el mandato esté vivo. Esa segunda comprobación es la que
   * hace que revocar sirva incluso después de que el agente ya reservó.
   */
  async revokeMandate(mandateId: string, owner: string): Promise<void> {
    const mandate = this.mustFind(mandateId);
    if (mandate.owner !== owner) throw new ChainError("NotOwner");
    if (mandate.status === "Revoked") return;

    mandate.status = "Revoked";
    mandate.revokedAt = this.clock.now().toISOString();
  }

  // -------------------------------------------------------------------------
  // Autorizaciones
  // -------------------------------------------------------------------------

  async reserve(request: {
    mandateId: string;
    agent: string;
    paymentDelegate: string;
    amount: number;
    action: number;
    intentHash: string;
    expiresAt: number;
  }): Promise<Authorization> {
    const mandate = this.mustFind(request.mandateId);

    if (!this.isUsable(mandate)) throw new ChainError("MandateNotUsable");
    if (mandate.terms.agent !== request.agent) throw new ChainError("UnauthorizedAgent");
    if (mandate.terms.paymentDelegate !== request.paymentDelegate) {
      throw new ChainError("UnauthorizedPaymentDelegate");
    }
    if (request.action >= 32 || (mandate.terms.allowedActions & (1 << request.action)) === 0) {
      throw new ChainError("ActionNotAllowed");
    }
    if (
      request.amount <= 0 ||
      request.amount > mandate.terms.maxPerOperation ||
      mandate.spent + mandate.reserved + request.amount > mandate.terms.maxTotal
    ) {
      throw new ChainError(
        "AmountExceedsLimit",
        `pide ${request.amount}, techo por operación ${mandate.terms.maxPerOperation}, disponible ${mandate.terms.maxTotal - mandate.spent - mandate.reserved}`,
      );
    }
    if (request.expiresAt <= this.now() || request.expiresAt > mandate.terms.expiresAt) {
      throw new ChainError("InvalidAuthorizationExpiry");
    }

    // El id sale del mandato y del hash de la compra. Dos consecuencias: la
    // misma compra no se puede reservar dos veces, y el id es reproducible por
    // cualquiera que tenga los dos ingredientes.
    const authorizationId =
      "0x" +
      createHash("sha256").update(`${request.mandateId}|${request.intentHash}`).digest("hex").slice(0, 64);

    if (this.authorizations.has(authorizationId)) throw new ChainError("AuthorizationExists");

    const authorization: Authorization = {
      authorizationId,
      mandateId: request.mandateId,
      amount: request.amount,
      expiresAt: request.expiresAt,
      mandateRevision: mandate.revision,
      active: true,
    };

    this.authorizations.set(authorizationId, authorization);
    mandate.reserved += request.amount;

    return authorization;
  }

  /**
   * El cobro. Lo llama el delegado de pago, no el agente.
   *
   * Vuelve a comprobar TODO —mandato vivo, revisión sin cambiar, vencimiento—
   * aunque ya se haya comprobado al reservar. Entre la reserva y el cobro pasa
   * tiempo, y en ese tiempo el humano puede haber revocado. Un consumo que
   * confiara en la validación de la reserva haría que revocar no sirviera para
   * nada justo en el momento en que más importa.
   */
  async consume(authorizationId: string, caller: string): Promise<void> {
    const authorization = this.authorizations.get(authorizationId);
    if (authorization === undefined || !authorization.active || authorization.expiresAt <= this.now()) {
      throw new ChainError("AuthorizationNotActive");
    }

    const mandate = this.mustFind(authorization.mandateId);
    if (!this.isUsable(mandate)) throw new ChainError("MandateNotUsable");
    if (authorization.mandateRevision !== mandate.revision) throw new ChainError("MandateChanged");
    if (mandate.terms.paymentDelegate !== caller) throw new ChainError("UnauthorizedPaymentDelegate");

    authorization.active = false;
    mandate.reserved -= authorization.amount;
    mandate.spent += authorization.amount;
  }

  async cancel(authorizationId: string): Promise<void> {
    const authorization = this.authorizations.get(authorizationId);
    if (authorization === undefined || !authorization.active) {
      throw new ChainError("AuthorizationNotActive");
    }

    authorization.active = false;
    const mandate = this.mustFind(authorization.mandateId);
    mandate.reserved -= authorization.amount;
  }

  async readAuthorization(authorizationId: string): Promise<Authorization | null> {
    const stored = this.authorizations.get(authorizationId);
    return stored === undefined ? null : { ...stored };
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  async readMandate(mandateId: string): Promise<MandateState> {
    return this.read(mandateId);
  }

  /**
   * La vista que consume el agente.
   *
   * Combina lo que está on-chain (presupuesto, gasto, revocación, vencimiento)
   * con la política off-chain que el `policyHash` compromete (categorías,
   * proveedores). Que haga falta combinar dos fuentes no es un defecto del
   * fake: es cómo funciona de verdad, y tenerlo explícito acá evita la
   * sorpresa de descubrirlo el día que se conecta la chain.
   */
  async read(mandateId: string): Promise<MandateState> {
    const mandate = this.mustFind(mandateId);
    this.reads += 1;

    const constraints = this.policies.get(mandate.terms.policyHash) ?? [];
    const categorias = constraints.find((c) => c.type === "checkout.allowed_categories");
    const proveedores = constraints.find((c) => c.type === "checkout.allowed_merchants");

    return {
      mandateId,
      active: mandate.status === "Active",
      revokedAt: mandate.revokedAt,
      expiresAt: new Date(mandate.terms.expiresAt * 1000).toISOString(),
      budgetTotalArs: fromMinorUnits(mandate.terms.maxTotal),
      budgetSpentArs: fromMinorUnits(mandate.spent),
      maxPerPurchaseArs: fromMinorUnits(mandate.terms.maxPerOperation),
      allowedCategories:
        categorias?.type === "checkout.allowed_categories" ? (categorias.allowed as Category[]) : [],
      // Ausencia del constraint = sin límite de proveedor. Lista vacía sería
      // "ninguno permitido", que es lo contrario.
      allowedSuppliers:
        proveedores?.type === "checkout.allowed_merchants" ? proveedores.allowed.map((m) => m.id) : null,
      readAt: this.clock.now().toISOString(),
      blockNumber: null,
      source: "fake",
    };
  }

  /** Cuántas veces se leyó el mandato. Un run de compra correcto lee dos veces. */
  readCount(): number {
    return this.reads;
  }

  termsOf(mandateId: string): MandateTerms {
    return { ...this.mustFind(mandateId).terms };
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private mustFind(mandateId: string): StoredMandate {
    const mandate = this.mandates.get(mandateId);
    if (mandate === undefined) throw new ChainError("UnknownMandate", mandateId);
    return mandate;
  }

  private isUsable(mandate: StoredMandate): boolean {
    const now = this.now();
    return mandate.status === "Active" && now >= mandate.terms.validAfter && now < mandate.terms.expiresAt;
  }

  /** Las mismas ocho condiciones que `_validateTerms` en el Solidity, en el mismo orden. */
  private validateTerms(terms: MandateTerms, spent: number, reserved: number): void {
    const invalido =
      terms.agent === "" ||
      terms.paymentDelegate === "" ||
      terms.expiresAt <= terms.validAfter ||
      terms.maxPerOperation === 0 ||
      terms.maxTotal < terms.maxPerOperation ||
      terms.maxTotal < spent + reserved ||
      terms.allowedActions === 0 ||
      terms.policyHash === "";

    if (invalido) throw new ChainError("InvalidTerms");
  }
}
