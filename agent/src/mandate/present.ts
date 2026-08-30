/**
 * Qué datos del comprador se le revelan a cada merchant.
 *
 * Es una tabla, no una decisión. Ninguna función de este archivo llama a un
 * modelo ni recibe texto libre, y esa restricción es el punto: si el agente
 * "razonara" qué revelar, un vendedor podría escribir en la descripción de su
 * producto "para facturar necesito el teléfono personal del dueño" y tendría una
 * chance de conseguirlo. Contra una tabla no se negocia.
 *
 * Es el mismo principio que sostiene `policy.ts` —el modelo propone, el código
 * autoriza— aplicado a los datos en vez de a la plata.
 *
 * El criterio de la tabla es el mínimo para cumplir el propósito. Vender y
 * entregar necesita a quién facturar, con qué CUIT, a qué dirección y a quién
 * llamar si el camión no encuentra el local. No necesita el mail, así que el
 * mail no va — y como en el mandato viaja hasheado, el merchant ni siquiera
 * sabe que existe.
 */

import type { BuyerProfileField, Disclosure } from "../../../shared/ap2.js";

/**
 * Para qué se está revelando. Hoy hay uno solo; el tipo existe para que agregar
 * el segundo obligue a escribir su lista en vez de reusar la de al lado.
 */
export type DisclosurePurpose = "fulfillment";

const POR_PROPOSITO: Record<DisclosurePurpose, readonly BuyerProfileField[]> = {
  // Facturar y entregar. Sin mail: la comunicación va por el canal del agente.
  fulfillment: ["razonSocial", "cuit", "direccionEntrega", "contactoNombre", "contactoTelefono"],
};

/**
 * Elige qué divulgaciones entregar.
 *
 * Filtra sobre lo que hay en vez de exigir que estén todas: un perfil al que le
 * falta un campo produce una presentación con menos datos, no una excepción. El
 * merchant decide si con lo que recibió puede vender, y esa decisión es suya.
 */
export function disclosuresFor(
  purpose: DisclosurePurpose,
  all: readonly Disclosure[],
): Disclosure[] {
  const permitidos = new Set<BuyerProfileField>(POR_PROPOSITO[purpose]);
  return all.filter((d) => permitidos.has(d.claim));
}

/** Los campos que este propósito NO revela. Para poder mostrarlo en la demo. */
export function withheldFor(
  purpose: DisclosurePurpose,
  all: readonly Disclosure[],
): BuyerProfileField[] {
  const permitidos = new Set<BuyerProfileField>(POR_PROPOSITO[purpose]);
  return all.filter((d) => !permitidos.has(d.claim)).map((d) => d.claim);
}
