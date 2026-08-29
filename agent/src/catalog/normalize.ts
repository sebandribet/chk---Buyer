/**
 * Normalización de términos de búsqueda.
 *
 * El agente extraía "café" y el catálogo decía "cafe": cero resultados. Lo mismo
 * con "azúcar"/"azucar" y con "servilleta"/"servilletas" — este último
 * autoinfligido, porque el system prompt le pide al modelo que use singular y el
 * catálogo estaba en plural.
 *
 * Ninguno de esos es un problema de catálogo chico, y por eso no se arreglan
 * agregando productos: se arreglan comparando los términos de forma canónica.
 * La normalización se aplica de los dos lados —consulta y catálogo— para que no
 * exista un "lado correcto" que alguien tenga que recordar.
 */

/** Quita tildes y diacríticos: "café" → "cafe". */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Singulariza una palabra en castellano, con las dos reglas que cubren casi todo.
 *
 * Los guardas de longitud existen para no romper palabras cortas que terminan en
 * "s" sin ser plurales: "gas", "mes", "arroz" (que ni siquiera termina en s pero
 * conviene tenerlo presente). No pretende ser un lematizador — solo tiene que
 * hacer que "servilletas" y "servilleta" caigan en la misma clave.
 */
function singularize(word: string): string {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * Clave canónica de un término. Dos términos que designan lo mismo tienen que
 * producir la misma clave.
 *
 *   "Café"            → "cafe"
 *   "AZÚCAR"          → "azucar"
 *   "Servilletas"     → "servilleta"
 *   "bolsas de residuo" → "bolsa de residuo"
 */
export function normalizeTerm(term: string): string {
  return stripAccents(term)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(singularize)
    .join(" ");
}

/** Compara dos términos por su forma canónica. */
export function sameTerm(a: string, b: string): boolean {
  return normalizeTerm(a) === normalizeTerm(b);
}
