/**
 * El paso que convierte una propuesta del agente en una decisión del humano.
 *
 * Es la decisión #01 del equipo hecha código: el flujo no es un chat donde el
 * humano dice "dale". El agente redacta un primer borrador —eso es lo que
 * ahorra tiempo— y el humano lo ve en un formulario, lo edita si quiere, y
 * recién ahí firma.
 *
 * La frase de la decisión es "mandate creation is a responsibility of the user
 * and should be treated as such", y tratarla como tal significa dos cosas
 * concretas:
 *
 * 1. **No se puede firmar un borrador sin revisar.** No por disciplina: por
 *    tipos. `confirmMandate` sólo acepta un `ConfirmedMandateForm`, y la única
 *    manera de conseguir uno es pasar por `openForReview` → `confirmForm`. No
 *    hay atajo, ni en la demo ni en los tests.
 *
 * 2. **Queda registrado qué cambió el humano.** El mandato firmado lleva el
 *    hash de lo que el agente había propuesto y la lista de campos que el
 *    humano tocó. Eso convierte "el usuario aprobó" en algo verificable: no que
 *    apretó un botón, sino que bajó el presupuesto de $500.000 a $300.000 y
 *    firmó eso.
 *
 * Lo segundo importa además fuera de la UX. Cuando alguien desconoce una compra,
 * la diferencia entre "aceptó lo que le pusieron adelante" y "editó los límites
 * y firmó" es exactamente la diferencia entre un consentimiento discutible y uno
 * que no se puede discutir.
 *
 * Un humano que lee el borrador y no cambia nada también revisó. La lista de
 * campos editados queda vacía y eso es honesto: lo que se registra es que hubo
 * revisión, no que hubo desacuerdo.
 */

import type { MandateDraft } from "@/contracts/index.js";
import type { MandateReview } from "../../../shared/ap2.js";
import { canonicalJson, hashObject } from "./sdjwt.js";

/** Los campos del borrador que el humano puede tocar en el formulario. */
export type EditableField = Exclude<keyof MandateDraft, "naturalLanguageDescription">;

const EDITABLES: readonly EditableField[] = [
  "allowedCategories",
  "suggestedBudgetArs",
  "suggestedMaxPerPurchaseArs",
  "allowedSuppliers",
  "maxDeliveryDays",
  "expiresAt",
  "userCartConfirmationRequired",
];

/**
 * El formulario, mientras el humano lo mira.
 *
 * `proposed` no se modifica nunca: es la referencia contra la que se compara
 * para saber qué cambió. Sin guardarlo, "el usuario editó el presupuesto" sería
 * una afirmación sin respaldo.
 */
export interface MandateForm {
  readonly proposed: MandateDraft;
  readonly current: MandateDraft;
  readonly editedFields: readonly EditableField[];
}

/**
 * Marca de tipo. No existe en runtime; existe para que no se pueda construir un
 * formulario confirmado a mano y saltearse la revisión.
 */
declare const CONFIRMADO: unique symbol;

/** Lo único que `confirmMandate` acepta. Sólo sale de `confirmForm`. */
export interface ConfirmedMandateForm {
  readonly [CONFIRMADO]: true;
  readonly draft: MandateDraft;
  readonly review: MandateReview;
}

/**
 * El agente propone. Acá empieza la revisión.
 *
 * Lo que devuelve todavía no autoriza nada: es un formulario, no un mandato.
 */
export function openForReview(proposed: MandateDraft): MandateForm {
  return { proposed, current: proposed, editedFields: [] };
}

/**
 * El humano cambia algo.
 *
 * Los campos se comparan por su forma canónica, no por identidad: reordenar las
 * categorías no es editarlas, y contarlo como edición ensuciaría el registro
 * con cambios que el humano no hizo.
 */
export function editForm(form: MandateForm, changes: Partial<Pick<MandateDraft, EditableField>>): MandateForm {
  const current = { ...form.current, ...changes };

  const editedFields = EDITABLES.filter(
    (field) => canonicalJson(current[field]) !== canonicalJson(form.proposed[field]),
  );

  return { proposed: form.proposed, current, editedFields };
}

/**
 * El humano confirma. Es el acto que habilita la firma.
 *
 * Todavía no firma nada —eso lo hace `confirmMandate` con su clave— pero es la
 * puerta: sin pasar por acá no hay forma de llegar a la firma.
 */
export function confirmForm(form: MandateForm, at: Date): ConfirmedMandateForm {
  return {
    draft: form.current,
    review: {
      draftedBy: "agent",
      // El hash de lo que el agente propuso. Prueba qué se le puso adelante al
      // humano, y por lo tanto que lo firmado es lo que él decidió y no otra
      // cosa que apareció después.
      proposedHash: hashObject(form.proposed),
      editedFields: [...form.editedFields],
      confirmedAt: Math.floor(at.getTime() / 1000),
    },
  } as ConfirmedMandateForm;
}

/**
 * Comprueba que un mandato firmado corresponde al borrador que dice.
 *
 * Sirve en una disputa: con el borrador original en la mano, cualquiera puede
 * confirmar que el `proposedHash` del mandato es el de ese borrador y no el de
 * otro.
 */
export function matchesProposal(review: MandateReview, proposed: MandateDraft): boolean {
  return review.proposedHash === hashObject(proposed);
}

/** Para imprimir el formulario. Devuelve cada campo con su origen. */
export function reviewSummary(form: MandateForm): { field: EditableField; value: unknown; edited: boolean }[] {
  return EDITABLES.map((field) => ({
    field,
    value: form.current[field],
    edited: form.editedFields.includes(field),
  }));
}
