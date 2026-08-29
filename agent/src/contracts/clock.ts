/**
 * El reloj, inyectado.
 *
 * Vive en `contracts/` y no en `agent/` porque lo necesitan las tres partes:
 * el agente, el registro de mandatos y el verificador del merchant. Y el
 * verificador no puede importar nada de `agent/` —es otro dominio de
 * confianza—, así que un tipo compartido no puede estar del lado del agente.
 *
 * Que el tiempo entre por parámetro es lo que hace testeable todo lo que
 * vence: un mandato expirado, una reserva vieja, un carrito que ya no vale. Con
 * `Date.now()` esparcido, esos casos sólo se pueden probar esperando.
 */
export interface Clock {
  now(): Date;
}
