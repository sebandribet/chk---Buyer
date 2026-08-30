/**
 * Perfiles de dominio del módulo de comprensión.
 *
 * El agente nació para insumos gastronómicos en pesos. La demo que operan los
 * jueces vende insumos de oficina en dólares. Son dos dominios distintos y la
 * tentación era tener dos agentes: uno "de verdad" con sus 245 tests, y otro
 * más chico atornillado al demo. Esa es exactamente la situación que teníamos
 * y la que hay que deshacer.
 *
 * Lo que cambia entre un dominio y otro es data, no lógica:
 *
 *   · qué categorías existen
 *   · en qué unidades se pide
 *   · en qué moneda se habla, y cómo la escribe un humano de ese lugar
 *
 * Lo que NO cambia es todo lo que hace que el agente sea defendible: que el
 * modelo traduzca y no elija, que el código gane cuando el modelo quiere ser
 * servicial, que un hueco se pregunte en vez de completarse, y que el nivel de
 * compromiso decida si se compra o se sugiere.
 *
 * Por eso el dominio es un parámetro y no un fork. `GASTRONOMIC_ARS` es el
 * default y reproduce exactamente el comportamiento anterior: los fixtures
 * grabados y los tests no se enteran de que esto existe.
 */

/** Cómo se llama el campo de plata en el JSON que devuelve el modelo. */
export interface CurrencyProfile {
  /** ISO 4217 en minúscula: "ars", "usd". */
  code: string;
  /** Campo del schema para el presupuesto total. Cambiarlo invalida fixtures. */
  totalField: string;
  /** Campo del schema para el presupuesto por ítem. */
  itemField: string;
  /** Cómo escribe montos un humano de este mercado. Va al system prompt. */
  guidance: string;
}

export interface DomainProfile {
  id: string;
  /** Idioma en el que el modelo redacta descripciones y preguntas. */
  language: "es" | "en";
  currency: CurrencyProfile;
  categories: readonly string[];
  units: readonly string[];
  /** Quién es el comprador. Primera línea del system prompt. */
  role: string;
  /** Reglas propias del dominio, agregadas a las reglas comunes. */
  rules: string;
}

/**
 * El dominio original: un comercio gastronómico argentino comprando insumos.
 *
 * Los montos en argentino no son color local: "20 lucas" es un monto que un
 * modelo sin la regla lee como veinte, y veinte pesos y veinte mil pesos son
 * mandatos muy distintos.
 */
export const GASTRONOMIC_ARS: DomainProfile = {
  id: "gastronomic_ars",
  language: "es",
  currency: {
    code: "ars",
    totalField: "budget_ars",
    itemField: "item_budget_ars",
    guidance: `PLATA EN ARGENTINO. Convertí a número antes de cargar cualquier monto:
- "20 lucas" = "20 mil" = "20k" — "luca" es mil pesos: 20 lucas = 20000
- "un palo" = 1000000 (un millón)
- "una gamba" = 100
- "20 mangos" = 20 pesos; "mango" es simplemente peso
- "$20.000" y "20.000 pesos" = 20000 (el punto es separador de miles, no decimal)`,
  },
  categories: ["alimentos", "limpieza", "descartables", "bebidas_alcoholicas", "equipamiento"],
  units: ["L", "kg", "unidad"],
  role: "Sos el módulo de comprensión de un agente de compras de insumos para un comercio gastronómico en Argentina.",
  rules: `"Un café" / "una yerba" NO es un kilo ni un litro: es UN envase. Si dice solo "un café" sin plata ni cantidad, preguntá cuánto necesita — no asumas 1 kg.`,
};

/**
 * El dominio de la demo: una empresa comprando insumos de oficina en dólares.
 *
 * Todo se pide por unidad —nadie compra "2 kg de sillas"— así que la unidad es
 * siempre `unit` y el anclaje en plata deja de tener sentido: si alguien dice
 * "sillas por 700 dólares" está dando un presupuesto, no una cantidad. Esa
 * distinción la hace el prompt, no el código de abajo.
 */
export const OFFICE_USD: DomainProfile = {
  id: "office_usd",
  language: "en",
  currency: {
    code: "usd",
    totalField: "budget_usd",
    itemField: "item_budget_usd",
    guidance: `MONEY IN US DOLLARS. Convert to a plain number before filling any amount:
- "$500", "500 dollars", "USD 500" all mean 500
- "1,200" means 1200 (the comma is a thousands separator, not a decimal point)
- "a couple hundred" is not a number: if the amount is vague, do not guess it — leave it null.`,
  },
  categories: ["furniture", "displays", "peripherals", "storage", "supplies", "appliances"],
  units: ["unit"],
  role: "You are the comprehension module of a purchasing agent buying office supplies for a company.",
  rules: `Office goods are always counted in whole units. Never express a need in weight or volume.

A phrase like "chairs for $700" states a BUDGET, not a quantity. A phrase like "three chairs" states a quantity. A request can state one, both, or neither.

canonical is the generic product name in English, singular and lowercase, with no brand and no packaging: "office chair", "monitor", "keyboard", "docking station". Distinguishing features belong in attrs: {"key":"type","value":"ergonomic"}.`,
};
