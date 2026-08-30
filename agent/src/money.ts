/**
 * Cómo se escribe la plata, en un solo lugar.
 *
 * Vivía duplicado en cuatro archivos (`brief`, `decide`, `reply`, la UI), cada
 * uno con su propio `toLocaleString`. Eso es un problema real y no cosmético:
 * la guarda contra cifras inventadas de `reply.ts` PARSEA el mismo formato que
 * estas funciones ESCRIBEN. Si el que muestra y el que verifica usan separadores
 * distintos, la guarda deja de reconocer las cifras legítimas y —peor— deja
 * pasar las inventadas.
 *
 * La moneda sigue siendo el peso argentino: los precios son reales, scrapeados
 * de supermercados argentinos. Lo que cambió es el formato de miles, para que
 * acompañe a una interfaz en inglés.
 */

/** Separador de miles con coma: 36000 -> "36,000". */
export function formatAmount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Monto con signo, para prosa y UI: 36000 -> "$36,000". */
export function ars(n: number): string {
  return `$${formatAmount(n)}`;
}

/**
 * Monto con la moneda explícita: 36000 -> "ARS 36,000".
 *
 * Para donde un "$" suelto se podría leer como dólares — encabezados, totales
 * de carrito, cualquier cifra que alguien pueda sacar de contexto.
 */
export function arsExplicit(n: number): string {
  return `ARS ${formatAmount(n)}`;
}
