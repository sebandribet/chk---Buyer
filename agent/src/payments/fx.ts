/**
 * La conversión de moneda. Un solo lugar, y declarado.
 *
 * Hace falta por una razón aburrida y concreta: **Stripe no opera en pesos
 * argentinos**, y todo nuestro dominio —el catálogo scrapeado, el mandato que
 * firma el humano, los techos del contrato— está en ARS.
 *
 * La decisión, que es lo que hay que poder defender: **el dominio no se toca.**
 * El mandato sigue en pesos, los límites se siguen evaluando en pesos, y el
 * humano sigue firmando pesos. La conversión ocurre en un único punto, al
 * cruzar hacia el proveedor, y las dos cifras viajan juntas a partir de ahí.
 *
 * La alternativa era pasar el proyecto entero a dólares. Se descartó porque
 * mueve el problema en vez de resolverlo: el comercio argentino que compra café
 * razona en pesos, y un mandato que dice "hasta USD 500" no es el mandato que
 * esa persona quiso firmar. Convertir en la frontera es lo que hace cualquier
 * orquestador de pagos de verdad.
 *
 * ---
 *
 * **La tasa es fija y está acá escrita.** No se consulta a ninguna API. En un
 * sistema real sería una tasa con timestamp de un proveedor, y la diferencia
 * importa: una tasa que se mueve entre que se autoriza y que se cobra produce
 * un cobro distinto del autorizado. Fijarla elimina esa clase de error de la
 * demo y deja el punto explícito para discutirlo, que es mejor que esconderlo
 * detrás de una llamada de red que nadie mira.
 */

import type { Money } from "../../../shared/payments.js";

/**
 * Pesos por dólar.
 *
 * Es un número inventado para la demo y hay que decirlo así. Lo que NO es
 * inventado es dónde vive: en una constante, en un archivo, citada en el trail
 * de cada cobro. Un jurado que pregunte "¿a qué tasa convertís?" tiene una
 * respuesta con nombre y apellido.
 */
export const ARS_POR_USD = 1_450;

export interface Conversion {
  from: Money;
  to: Money;
  rate: number;
}

/**
 * Convierte a la moneda del proveedor.
 *
 * Redondea **hacia arriba**, y la elección tiene consecuencia. El redondeo
 * siempre favorece al límite: se cobra a lo sumo un centavo de más en dólares,
 * nunca un centavo menos que lo que cuesta la compra. Redondear hacia abajo
 * dejaría al comercio cobrando de menos, y hacia el más cercano dejaría el
 * resultado dependiendo del importe, que es peor que cualquiera de las dos.
 */
export function toProviderCurrency(amount: Money, providerCurrency: string): Conversion {
  const from = providerCurrency.toLowerCase();

  if (amount.currency.toLowerCase() === from) {
    return { from: amount, to: amount, rate: 1 };
  }

  if (amount.currency.toLowerCase() !== "ars" || from !== "usd") {
    throw new Error(
      `No hay tasa definida para ${amount.currency} → ${providerCurrency}. ` +
        `Agregar una tasa es una decisión, no un default: si esto se cae, es porque nadie la tomó.`,
    );
  }

  return {
    from: amount,
    to: { minor: Math.ceil(amount.minor / ARS_POR_USD), currency: "usd" },
    rate: ARS_POR_USD,
  };
}

/** Para imprimir. `{minor: 3_700_000, currency: "ars"}` → `"ARS $37.000"`. */
export function formatMoney(m: Money): string {
  return `${m.currency.toUpperCase()} $${(m.minor / 100).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
