/**
 * Vocabulario AP2, en la forma que usa la spec ACTUAL.
 *
 * Ojo con la bibliografía: casi todo lo que se encuentra escrito describe el
 * modelo viejo de tres mandatos (Intent / Cart / Payment). Ese modelo ya no
 * existe. La spec vigente tiene dos mandatos —Checkout y Payment— y cada uno
 * pasa por dos etapas:
 *
 *   open   → los límites que el humano acepta de antemano. Los firma él.
 *   closed → una transacción concreta que cae dentro de esos límites.
 *            La firma el agente, con la clave que el humano endosó en el open.
 *
 * Nosotros implementamos el Checkout Mandate en sus dos etapas. El Payment
 * Mandate es del equipo de pagos y cuelga del mismo `checkout_hash`.
 *
 * El flujo que nos toca es el "Human Not Present": el humano firma el open y
 * se va; el agente compra solo y firma el closed; el merchant recibe LOS DOS y
 * verifica por su cuenta que el segundo cae dentro del primero. Esa
 * verificación independiente es el punto: el merchant no tiene por qué creerle
 * al agente, y no le cree.
 *
 * Este archivo es sólo vocabulario. Cruza fronteras entre los cuatro equipos,
 * así que es serializable a JSON y no importa nada.
 */

export type ISODateTime = string;

/** base64url sin padding. Es como viaja todo hash y toda firma acá. */
export type Base64Url = string;

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/**
 * Un límite que el humano puso en el open y que el merchant va a re-evaluar.
 *
 * La unión es discriminada por `type` y los valores son los de la spec, con
 * prefijo `checkout.`. Los dos primeros son de AP2; los otros dos son nuestros
 * y están declarados como extensión, no disfrazados de estándar.
 *
 * Regla que hace que esto sirva de algo, y que viene textual de la spec:
 * "Any unknown Constraints MUST be treated as failing evaluation". Un
 * verificador que no entiende un límite NO lo puede ignorar. Si pudiera,
 * agregar basura al mandato sería una forma de ampliarlo.
 */
export type Constraint =
  | AllowedMerchantsConstraint
  | AllowedCategoriesConstraint
  | AllowedPaymentInstrumentsConstraint
  | MaxAmountConstraint
  | MaxDeliveryDaysConstraint;

export interface MerchantRef {
  id: string;
  name: string;
  website?: string;
}

/** AP2 `checkout.allowed_merchants`. Lista vacía = cualquiera. */
export interface AllowedMerchantsConstraint {
  type: "checkout.allowed_merchants";
  allowed: MerchantRef[];
}

/** Extensión nuestra: el rubro de lo que se compra. */
export interface AllowedCategoriesConstraint {
  type: "checkout.allowed_categories";
  allowed: string[];
}

/**
 * Los dos techos de plata, en la unidad mínima de la moneda (centavos para ARS).
 *
 * Enteros y no floats porque este número tiene que dar EXACTAMENTE igual del
 * lado del contrato, donde es un uint128. Un redondeo distinto entre las dos
 * puntas rompe la verificación sin que nadie entienda por qué.
 */
export interface MaxAmountConstraint {
  type: "checkout.max_amount";
  currency: string;
  maxPerOperation: number;
  maxTotal: number;
}

/** Extensión nuestra: plazo de entrega tolerado. */
export interface MaxDeliveryDaysConstraint {
  type: "checkout.max_delivery_days";
  days: number;
}

/**
 * Con qué se puede pagar.
 *
 * **`ref` es un token del proveedor de pagos, nunca un número de tarjeta.** Eso
 * es exactamente lo que quiere decir autorizar a un agente "sin entregarle la
 * tarjeta": el humano registra el medio de pago una sola vez, contra el
 * proveedor, y lo que existe de ahí en adelante es una referencia opaca que no
 * sirve para nada fuera de este circuito. El agente nunca ve el PAN, y nosotros
 * tampoco — es la diferencia entre delegar el gasto y entregar la billetera.
 *
 * `brand` y `last4` viajan porque el humano tiene que poder ver QUÉ tarjeta
 * está autorizando antes de firmar. "Visa ····4242" es identificable para el
 * dueño y no le sirve a nadie más.
 *
 * Va como constraint y no como campo suelto del mandato para que entre al
 * `policyHash`: cambiar la tarjeta autorizada cambia el compromiso, y por lo
 * tanto exige una firma nueva.
 */
export interface AllowedPaymentInstrumentsConstraint {
  type: "checkout.allowed_payment_instruments";
  allowed: PaymentInstrumentRef[];
}

export interface PaymentInstrumentRef {
  /** Token del proveedor (`pm_...` en Stripe). Nunca un PAN. */
  ref: string;
  /** "visa", "mastercard", "amex"… */
  brand: string;
  /** Los últimos cuatro dígitos. Lo que muestra cualquier recibo. */
  last4: string;
}

// ---------------------------------------------------------------------------
// Datos del comprador
// ---------------------------------------------------------------------------

/**
 * Quién compra, en términos que le sirven a un vendedor real.
 *
 * Hace falta porque una compra de verdad termina en una factura y en una
 * entrega, y para eso el merchant necesita razón social, CUIT y dirección. Pero
 * NO necesita todos los campos en todas las compras, y ahí entra la divulgación
 * selectiva: cada campo viaja hasheado con su propia sal dentro del mandato
 * firmado, y el agente revela sólo los que esa compra justifica. Los demás
 * quedan comprometidos —el merchant sabe que hay algo y no lo puede cambiar—
 * pero no revelados.
 */
export interface BuyerProfile {
  razonSocial: string;
  cuit: string;
  direccionEntrega: string;
  contactoNombre: string;
  contactoEmail: string;
  contactoTelefono: string;
}

export type BuyerProfileField = keyof BuyerProfile;

/**
 * Un campo revelado: la sal, el nombre y el valor.
 *
 * El verificador recomputa el hash de esta terna y lo busca en `_sd`. Si está,
 * el dato es auténtico. La sal existe para que no se puedan adivinar valores
 * por fuerza bruta: sin ella, hashear "20-12345678-9" contra todos los CUIT
 * posibles es cuestión de minutos.
 */
export interface Disclosure {
  salt: Base64Url;
  claim: BuyerProfileField;
  value: string;
}

// ---------------------------------------------------------------------------
// Checkout Mandate
// ---------------------------------------------------------------------------

/** La clave que el humano endosa. AP2 lo llama `cnf` (confirmation). */
export interface ConfirmationKey {
  /** Clave pública del agente, en SPKI DER codificado base64url. */
  jwk: { kty: "EC"; crv: "P-256"; x: Base64Url; y: Base64Url };
}

/**
 * Open Checkout Mandate — el mandato que firma el humano.
 *
 * Es la autoridad de gasto y la única cosa en todo el sistema que la crea. El
 * agente puede redactarlo (`MandateDraft`), pero redactar no es firmar: hasta
 * que el humano no pone su clave acá, no hay nada.
 *
 * `mandateId` apunta al mismo mandato en el contrato. Los dos anclajes cumplen
 * roles distintos y complementarios: esta credencial es lo que VIAJA —el
 * merchant la verifica sin tocar la chain— y el contrato es el ESTADO —si sigue
 * viva, cuánto queda—. `policyHash` es la junta: el mismo valor está acá y en
 * `Terms.policyHash` on-chain, así que el merchant puede comprobar que los
 * límites que le mostraron son los que el humano firmó de verdad.
 */
export interface OpenCheckoutMandate {
  vct: "mandate.checkout.open.1";
  mandateId: string;
  /** Quién compra. Dirección del dueño del mandato en el contrato. */
  owner: string;
  constraints: Constraint[];
  /** Hash canónico de `constraints`. Debe coincidir con el del contrato. */
  policyHash: Base64Url;
  /**
   * La clave del agente, endosada por el humano. Es lo que le permite firmar
   * compras dentro de este mandato.
   */
  cnf: ConfirmationKey;
  /**
   * La dirección on-chain del agente.
   *
   * Va además del `cnf` porque son dos identidades del mismo actor en dos
   * planos distintos: la clave firma credenciales, la dirección aparece en
   * `terms.agent` del contrato. El contrato compara contra la dirección, así
   * que tiene que estar comprometida por la firma del humano — si saliera de la
   * configuración local, saldría de algo que el agente puede editar.
   */
  agent: string;
  /** Quién puede consumir la autorización de pago. */
  paymentDelegate: string;
  /** Hashes de los campos del comprador. Sin sal no se pueden revertir. */
  _sd: Base64Url[];
  _sd_alg: "sha-256";
  /** Unix epoch en segundos, como manda la spec (no ISO). */
  iat: number;
  exp: number;
}

/**
 * Closed Checkout Mandate — la compra concreta, firmada por el agente.
 *
 * Dos ataduras, y ninguna de las dos es opcional:
 *
 *   `checkout_hash` → al carrito que el merchant firmó. El agente no puede
 *                     presentar un carrito y cobrar otro.
 *   `sd_hash`       → al open del que cuelga. El agente no puede tomar la
 *                     autorización de un mandato y usarla con otro.
 *
 * Sin la primera, el agente cambia el monto. Sin la segunda, el agente combina
 * el carrito caro de un mandato con los límites amplios de otro.
 */
export interface ClosedCheckoutMandate {
  vct: "mandate.checkout.1";
  /** El carrito cerrado, firmado por el merchant. JWT compacto. */
  checkout_jwt: string;
  checkout_hash: Base64Url;
  /** Hash del open del que cuelga este closed. */
  sd_hash: Base64Url;
  /** Para quién es esta presentación. Fuera de acá no vale. */
  aud: string;
  /** Contra repetición: el merchant no acepta dos veces el mismo. */
  nonce: string;
  iat: number;
  exp: number;
}

/**
 * El carrito cerrado que firma el merchant.
 *
 * Lo firma él y no nosotros a propósito: es su precio y su stock. Que el
 * agente no pueda emitirlo es lo que hace que `checkout_hash` signifique algo.
 */
export interface CheckoutObject {
  checkoutId: string;
  merchant: MerchantRef;
  currency: string;
  /** Unidad mínima de la moneda, entero. */
  amount: number;
  items: CheckoutItem[];
  deliveryDays: number;
  createdAt: ISODateTime;
  expiresAt: ISODateTime;
}

export interface CheckoutItem {
  sku: string;
  title: string;
  category: string;
  supplierId: string;
  quantity: number;
  /** Unidad mínima de la moneda, entero. */
  unitAmount: number;
  lineAmount: number;
}

/** Lo que el agente le pide al merchant que cierre y firme. */
export interface CheckoutRequest {
  merchantId: string;
  currency: string;
  items: CheckoutItem[];
  deliveryDays: number;
}

/**
 * La respuesta del merchant al pedido de cierre.
 *
 * El `nonce` lo emite el merchant, no el agente. Es lo que hace que la
 * protección contra repetición signifique algo: si el agente eligiera el nonce,
 * podría reusar una presentación entera cambiándolo, y el merchant no tendría
 * contra qué comparar.
 */
export interface IssuedCheckout {
  checkout: SignedCredential<CheckoutObject>;
  nonce: string;
}

/** Cómo el agente le habla al merchant para cerrar un carrito. */
export interface CheckoutPort {
  close(request: CheckoutRequest): Promise<IssuedCheckout>;
}

// ---------------------------------------------------------------------------
// Presentación y recibo
// ---------------------------------------------------------------------------

/**
 * Lo que el agente le entrega al merchant. Todo lo que el merchant recibe.
 *
 * Vale la pena leer esto como la lista de lo que el merchant NO recibe: no ve
 * el presupuesto total del comprador, ni cuánto lleva gastado, ni a qué otros
 * proveedores le compra, ni el prompt original. Nada de eso hace falta para
 * vender, y todo eso es información comercial del comprador.
 */
export interface MerchantPresentation {
  open: SignedCredential<OpenCheckoutMandate>;
  closed: SignedCredential<ClosedCheckoutMandate>;
  /** Prueba de posesión: el agente tiene la clave que el humano endosó. */
  kbJwt: string;
  /** Sólo los campos del comprador que esta compra justifica. */
  disclosures: Disclosure[];
  /**
   * La reserva on-chain. Acotada en monto y vencimiento y de un solo uso —es
   * la misma idea que el token delegado de ACP, con el contrato de registro.
   */
  authorizationId: string;
  /**
   * Con qué se va a pagar. El agente lo DECLARA acá y el vendedor comprueba
   * que sea uno de los que el mandato autoriza, antes de aceptar. Después el
   * cobro queda atado a este mismo instrumento.
   *
   * Declararlo antes y no después no es un detalle: si el vendedor se enterara
   * del medio de pago recién al cobrar, ya habría aceptado la compra.
   */
  paymentInstrument: PaymentInstrumentRef;
}

/**
 * Todo lo que se evalúa contra los límites del mandato.
 *
 * Existe porque un límite no restringe sólo el carrito: `max_amount` mira el
 * carrito, pero `allowed_payment_instruments` mira con qué se paga, y mañana
 * otro mirará otra cosa. Pasar un contexto en vez de un `CheckoutObject` deja
 * que el evaluador crezca sin cambiarle la firma a todos los que ya existen.
 */
export interface PurchaseContext {
  checkout: CheckoutObject;
  paymentInstrument: PaymentInstrumentRef;
}

/** Un credencial firmado en formato JWT compacto, con el payload ya parseado. */
export interface SignedCredential<T> {
  /** `header.payload.signature`, todo base64url. */
  jwt: string;
  payload: T;
}

/** Por qué el merchant rechazó. Un código por chequeo, para que se pueda auditar. */
export type VerificationFailure =
  | "open_signature_invalid"
  | "open_expired"
  | "closed_signature_invalid"
  | "closed_expired"
  | "key_binding_invalid"
  | "sd_hash_mismatch"
  | "checkout_hash_mismatch"
  | "checkout_signature_invalid"
  | "checkout_expired"
  | "audience_mismatch"
  | "nonce_replayed"
  | "constraint_unknown"
  | "constraint_violated"
  | "disclosure_invalid"
  | "policy_hash_mismatch"
  | "mandate_not_usable"
  | "authorization_invalid";

export interface VerificationCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export type VerificationResult =
  | {
      ok: true;
      checks: VerificationCheck[];
      buyer: Partial<BuyerProfile>;
      /**
       * El recibo FIRMADO, no sólo su contenido.
       *
       * La firma es lo único que lo convierte en evidencia: sin ella, el recibo
       * es un objeto que cualquiera pudo escribir. Es exactamente lo que hay que
       * presentar cuando el titular desconoce la compra.
       */
      receipt: SignedCredential<CheckoutReceipt>;
    }
  | { ok: false; failure: VerificationFailure; detail: string; checks: VerificationCheck[] };

/**
 * Lo que el merchant firma cuando acepta.
 *
 * `reference` es el hash del closed mandate, como pide la spec. Es lo que
 * cierra el rastro: cualquiera con el recibo y el mandato puede comprobar
 * después que el merchant aceptó exactamente esa compra y no otra.
 */
export interface CheckoutReceipt {
  vct: "receipt.checkout.1";
  reference: Base64Url;
  merchant: MerchantRef;
  authorizationId: string;
  currency: string;
  amount: number;
  acceptedAt: ISODateTime;
}
