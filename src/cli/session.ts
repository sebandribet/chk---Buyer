/**
 * El arco completo del banco de pruebas: borrador → open → compra → closed.
 *
 * Existe porque el resto del sistema es deliberadamente sin estado. `runAgent`
 * recibe todo el contexto en cada corrida y no se acuerda de nada, y eso está
 * bien: es lo que hace que un run se pueda reproducir con solo su prompt. Pero
 * un mandato SÍ es estado —se firma una vez y vale para muchas compras— y
 * alguien tiene que sostenerlo entre requests.
 *
 * Ese alguien es esta clase, y vive en el banco de pruebas y no en `agent/` a
 * propósito: es el andamiaje de la demo. En un producto de verdad el open lo
 * custodia el dispositivo del humano y la chain, no un objeto en memoria de un
 * servidor.
 *
 * Lo que NO hace, que es lo que importa:
 *
 *   - no firma nada por su cuenta. `signMandate` exige que alguien haya llamado
 *     a `proposeDraft` primero, y la firma sale de `confirmForm`, que es el
 *     único camino hacia `confirmMandate`.
 *   - no toca los límites. Una vez firmado el open, esta clase solo lo lee.
 *   - no decide comprar. Recibe un `CartDraft` que ya salió de `decide()` con
 *     estado `proposal`, o sea que ya pasó el policy engine.
 */

import type {
  CartDraft,
  MandateDraft,
  Product,
  Supplier,
} from "@/contracts/index.js";
import type { AgentContext } from "@/agent/context.js";
import { FakeMandateChain } from "@/mandate/chain.js";
import { agente, merchant as merchantKeys, usuario } from "@/mandate/keys.js";
import { confirmForm, editForm, openForReview, type EditableField, type MandateForm } from "@/mandate/form.js";
import { confirmMandate, type IssuedMandate, type MandateIdentity } from "@/mandate/open.js";
import { Merchant } from "@/merchant/index.js";
import { authorize, type AuthorizeResult } from "@/agent/authorize.js";
import type {
  BuyerProfile,
  CheckoutObject,
  ClosedCheckoutMandate,
  OpenCheckoutMandate,
  PaymentInstrumentRef,
} from "../../shared/ap2.js";

/**
 * La tarjeta que el mandato autoriza. Es un token del proveedor de pagos, nunca
 * un número de tarjeta: el sistema no ve ni guarda un PAN en ningún momento.
 */
const TARJETA: PaymentInstrumentRef = { ref: "pm_test_visa_4242", brand: "visa", last4: "4242" };

/**
 * El comprador. En la demo es fijo; en un producto sale del onboarding.
 *
 * Viaja hasheado dentro del mandato y solo se revela por campo, según el
 * propósito de cada compra — de eso se encarga `present.ts`.
 */
const PERFIL: BuyerProfile = {
  razonSocial: "Café del Sur S.R.L.",
  cuit: "30-71234567-4",
  direccionEntrega: "Av. Corrientes 1234, CABA",
  contactoNombre: "Marina Ferreyra",
  contactoEmail: "compras@cafedelsur.ar",
  contactoTelefono: "+54 11 4567-8901",
};

const IDENTIDAD: MandateIdentity = {
  owner: "0xCAFEDELSUR",
  agent: "0xAGENTE",
  paymentDelegate: "0xDELEGADO",
  currency: "ARS",
  paymentInstruments: [TARJETA],
};

/** Un closed mandate emitido, con todo lo que hace falta para mostrarlo. */
export interface ClosedRecord {
  merchantId: string;
  merchantName: string;
  checkout: CheckoutObject;
  closedJwt: string;
  closed: ClosedCheckoutMandate;
  authorizationId: string;
  /** Qué datos del comprador viajaron y cuáles no. */
  disclosed: string[];
  withheld: string[];
  at: string;
}

/** Un intento de compra que no llegó a emitir closed, con el motivo. */
export interface RefusedRecord {
  merchantId: string;
  merchantName: string;
  reason: string;
  detail: string;
  at: string;
}

export interface PurchaseOutcome {
  closed: ClosedRecord[];
  refused: RefusedRecord[];
}

export class DemoSession {
  readonly chain: FakeMandateChain;

  /**
   * Un `Merchant` por proveedor, creado al vuelo.
   *
   * Todos firman con la misma clave de demo, y eso hay que decirlo: en la
   * realidad cada vendedor tiene la suya y el verificador la busca en un
   * directorio. Lo que la demo sí conserva es lo que importa —que el que firma
   * el carrito NO es el agente— y por eso `checkout_hash` sigue significando
   * algo aunque las claves de los vendedores se repitan.
   */
  private readonly merchants = new Map<string, Merchant>();

  private issued: IssuedMandate | null = null;
  private form: MandateForm | null = null;
  private cart: CartDraft | null = null;
  private readonly closedRecords: ClosedRecord[] = [];
  private readonly refusedRecords: RefusedRecord[] = [];

  constructor(
    private readonly clock: { now(): Date },
    private readonly suppliers: () => Supplier[],
  ) {
    this.chain = new FakeMandateChain(clock);
  }

  get mandateId(): string | null {
    return this.issued?.mandateId ?? null;
  }

  get open(): IssuedMandate | null {
    return this.issued;
  }

  /**
   * El agente propone. Todavía no hay mandato: hay un formulario.
   *
   * Se descarta si ya hay uno firmado. Un mandato vigente no se pisa con un
   * borrador nuevo por el hecho de que el humano haya vuelto a preguntar algo;
   * para cambiarlo hay que revocarlo y firmar otro, que es justamente el
   * trámite que un permiso de gasto merece.
   */
  proposeDraft(draft: MandateDraft): MandateForm | null {
    if (this.issued !== null) return null;
    this.form = openForReview(draft);
    return this.form;
  }

  currentForm(): MandateForm | null {
    return this.form;
  }

  /** El humano edita el borrador. Cada cambio queda anotado contra lo propuesto. */
  edit(changes: Partial<Pick<MandateDraft, EditableField>>): MandateForm {
    if (this.form === null) throw new Error("There is no draft to edit yet.");
    this.form = editForm(this.form, changes);
    return this.form;
  }

  /**
   * El humano firma. Es el único punto del sistema donde nace autoridad de gasto.
   *
   * Nótese que recibe las ediciones y las aplica ANTES de confirmar: lo que se
   * firma es lo que el humano dejó en pantalla, y `editedFields` registra en qué
   * se diferencia de lo que el agente había propuesto.
   */
  async signMandate(
    changes: Partial<Pick<MandateDraft, EditableField>>,
    ctx: AgentContext,
  ): Promise<IssuedMandate> {
    if (this.form === null) throw new Error("There is no draft to sign yet.");
    if (this.issued !== null) throw new Error("A mandate is already signed for this session.");

    const form = Object.keys(changes).length > 0 ? editForm(this.form, changes) : this.form;
    const confirmed = confirmForm(form, this.clock.now());

    const nombres: Record<string, string> = {};
    for (const s of this.suppliers()) nombres[s.id] = s.name;

    this.issued = await confirmMandate(confirmed, IDENTIDAD, PERFIL, {
      registry: this.chain,
      userKey: usuario,
      agentKey: agente,
      clock: this.clock,
      supplierNames: nombres,
    });
    this.form = form;

    const payload = this.issued.credential.payload;
    ctx.audit.emit({
      type: "mandate_signed",
      mandateId: this.issued.mandateId,
      policyHash: payload.policyHash,
      editedFields: confirmed.review.editedFields,
      proposedHash: confirmed.review.proposedHash,
      budgetArs: form.current.suggestedBudgetArs,
      maxPerPurchaseArs: form.current.suggestedMaxPerPurchaseArs,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });

    return this.issued;
  }

  /** Revoca el open en la chain. Lo que venga después lo frena el contrato. */
  async revoke(ctx: AgentContext): Promise<void> {
    if (this.issued === null) throw new Error("There is no mandate to revoke.");
    await this.chain.revokeMandate(this.issued.mandateId, IDENTIDAD.owner);
    ctx.audit.emit({ type: "mandate_revoked", mandateId: this.issued.mandateId });
  }

  /** El último carrito que `decide()` aprobó. Es lo único que se puede ejecutar. */
  rememberCart(cart: CartDraft): void {
    this.cart = cart;
  }

  get pendingCart(): CartDraft | null {
    return this.cart;
  }

  /**
   * Ejecuta la compra: un closed mandate por proveedor.
   *
   * Se agrupa por proveedor porque un `CheckoutObject` pertenece a UN vendedor y
   * lo firma su clave. Mandar un carrito surtido a un solo merchant produciría
   * un carrito firmado por alguien que no vende la mitad de lo que dice vender —
   * pasaría la verificación criptográfica y sería mentira igual.
   *
   * Cada grupo cuelga del MISMO open: es exactamente lo que el par open/closed
   * permite expresar, un permiso y varias compras dentro de él.
   */
  async executePurchase(ctx: AgentContext): Promise<PurchaseOutcome> {
    if (this.issued === null) throw new Error("There is no signed mandate to buy under.");
    if (this.cart === null) throw new Error("There is no approved cart to execute.");

    const issued = this.issued;
    const closed: ClosedRecord[] = [];
    const refused: RefusedRecord[] = [];

    for (const [supplierId, cart] of this.splitBySupplier(this.cart)) {
      const merchant = this.merchantFor(supplierId);
      const result: AuthorizeResult = await authorize(
        {
          cart,
          open: issued.credential,
          disclosures: issued.disclosures,
          merchantId: supplierId,
          paymentInstrument: TARJETA,
        },
        {
          authorizations: this.chain,
          checkout: merchant,
          agentKey: agente,
          merchantPublicKey: merchantKeys.publicKey,
          clock: this.clock,
        },
        ctx,
      );

      const at = this.clock.now().toISOString();
      if (result.status === "refused") {
        refused.push({
          merchantId: supplierId,
          merchantName: merchant.ref.name,
          reason: result.reason,
          detail: result.detail,
          at,
        });
        continue;
      }

      const p = result.presentation;
      closed.push({
        merchantId: supplierId,
        merchantName: merchant.ref.name,
        checkout: result.checkout,
        closedJwt: p.closed.jwt,
        closed: p.closed.payload,
        authorizationId: p.authorizationId,
        disclosed: p.disclosures.map((d) => d.claim),
        withheld: issued.disclosures
          .filter((d) => !p.disclosures.some((x) => x.claim === d.claim))
          .map((d) => d.claim),
        at,
      });
    }

    this.closedRecords.push(...closed);
    this.refusedRecords.push(...refused);
    // El carrito se consume: ejecutado o rechazado, no se vuelve a ejecutar
    // solo. Que apretar dos veces no compre dos veces no puede depender de la
    // UI — el contrato ya lo impide por el id de autorización, y esto lo hace
    // evidente en vez de dejarlo como un error que alguien tiene que ver.
    this.cart = null;

    return { closed, refused };
  }

  /** Un `CartDraft` por proveedor, conservando todo lo demás del original. */
  private splitBySupplier(cart: CartDraft): Map<string, CartDraft> {
    const porProveedor = new Map<string, CartDraft>();

    for (const line of cart.lines) {
      const id = line.candidate.offer.supplier.id;
      const actual = porProveedor.get(id);
      if (actual === undefined) {
        porProveedor.set(id, { ...cart, lines: [line], totalArs: line.candidate.lineTotalArs });
      } else {
        actual.lines.push(line);
        actual.totalArs += line.candidate.lineTotalArs;
      }
    }

    return porProveedor;
  }

  private merchantFor(supplierId: string): Merchant {
    const existente = this.merchants.get(supplierId);
    if (existente !== undefined) return existente;

    const proveedor = this.suppliers().find((s) => s.id === supplierId);
    const merchant = new Merchant({
      ref: { id: supplierId, name: proveedor?.name ?? supplierId },
      key: merchantKeys,
      clock: this.clock,
      chain: this.chain,
      userPublicKey: usuario.publicKey,
    });
    this.merchants.set(supplierId, merchant);
    return merchant;
  }

  /**
   * Lo que consume la pestaña de mandatos.
   *
   * Se manda el JWT crudo además del payload decodificado a propósito: la
   * pestaña muestra los dos, y ver el token al lado de su contenido es lo que
   * convierte "el sistema dice que está firmado" en algo que alguien puede
   * verificar por su cuenta.
   */
  async snapshot(): Promise<MandateSnapshot> {
    if (this.issued === null) {
      return {
        open: null,
        closed: this.closedRecords,
        refused: this.refusedRecords,
        form: this.form === null ? null : formView(this.form),
      };
    }

    const state = await this.chain.read(this.issued.mandateId);
    const payload = this.issued.credential.payload;

    return {
      open: {
        mandateId: this.issued.mandateId,
        jwt: this.issued.credential.jwt,
        payload,
        constraints: this.issued.constraints,
        terms: this.issued.terms,
        /** Los claims del comprador que el mandato compromete, solo por nombre. */
        disclosableClaims: this.issued.disclosures.map((d) => d.claim),
        state,
      },
      closed: this.closedRecords,
      refused: this.refusedRecords,
      form: this.form === null ? null : formView(this.form),
    };
  }
}

export interface MandateSnapshot {
  open: {
    mandateId: string;
    jwt: string;
    payload: OpenCheckoutMandate;
    constraints: unknown[];
    terms: unknown;
    disclosableClaims: string[];
    state: unknown;
  } | null;
  closed: ClosedRecord[];
  refused: RefusedRecord[];
  form: FormView | null;
}

export interface FormView {
  proposed: MandateDraft;
  current: MandateDraft;
  editedFields: readonly string[];
}

function formView(form: MandateForm): FormView {
  return { proposed: form.proposed, current: form.current, editedFields: form.editedFields };
}

/** Para que el server pueda listar proveedores sin importar el store. */
export type SupplierSource = () => Supplier[];
export type { Product };
