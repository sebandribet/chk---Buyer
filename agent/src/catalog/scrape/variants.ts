/**
 * Extracción de la variante desde el nombre del producto.
 *
 * "Leche Descremada Larga Vida 1L" → { tipo: "descremada" }.
 *
 * Esto lo hacía un modelo de NVIDIA y se cambió por reglas después de medirlo:
 * de los dos modelos que la key puede invocar, uno se colgaba con este prompt
 * (>90s, sin respuesta) y el otro tardaba 48 segundos para cuatro productos y
 * clasificaba mal —marcaba una cafetera y un filtro de papel como "café"— además
 * de inventar atributos de peso y presión que se le habían prohibido.
 *
 * Las reglas son instantáneas, gratis, y para nombres de góndola argentinos
 * aciertan más: los supermercados escriben la variante literalmente en el
 * título. Cuando aparezca un producto que no matchea, se agrega la palabra acá
 * y queda arreglado para siempre, que es más de lo que se puede decir de
 * reintentar un prompt.
 */

import { normalizeTerm } from "../normalize.js";

/**
 * Variantes por canonical, en orden de prioridad: la primera que aparece en el
 * nombre gana. El orden importa — "parcialmente descremada" tiene que probarse
 * antes que "descremada", o toda leche parcialmente descremada se etiqueta mal.
 */
const VARIANTS: Record<string, string[]> = {
  leche: ["parcialmente descremada", "descremada", "entera", "sin lactosa", "chocolatada"],
  cafe: ["descafeinado", "instantaneo", "en grano", "molido", "torrado"],
  yerba: ["sin palo", "con palo", "despalada", "suave", "organica"],
  azucar: ["impalpable", "rubia", "organica", "comun", "refinada"],
  harina: ["leudante", "integral", "0000", "000"],
  arroz: ["doble carolina", "largo fino", "integral", "yamani", "parboil", "carnaroli"],
  avena: ["instantanea", "arrollada", "tradicional", "integral"],
  aceite: ["oliva", "girasol", "maiz", "mezcla", "canola"],
  fideos: ["spaghetti", "tirabuzon", "mostachol", "codito", "tallarin", "integral"],
  sal: ["entrefina", "gruesa", "fina", "marina"],
  detergente: ["concentrado", "limon", "ultra"],
  lavandina: ["perfumada", "concentrada", "gel", "comun"],
  "jabon liquido": ["antibacterial", "glicerina", "neutro"],
  "papel higienico": ["triple hoja", "doble hoja", "simple hoja"],
  "rollo de cocina": ["doble hoja", "simple hoja"],
  servilletas: ["blancas", "descartables"],
  "bolsas de residuo": ["reforzada", "biodegradable", "comun"],

  // Rubros donde la variante cambia si el producto sirve o no para lo pedido.
  // Los que no están acá devuelven {} y quedan disponibles para cualquier
  // pedido que no especifique variante, que es el comportamiento correcto.
  te: ["manzanilla", "boldo", "tilo", "verde", "negro", "rojo", "frutos rojos"],
  cacao: ["amargo", "dulce", "instantaneo"],
  mermelada: ["frutilla", "durazno", "damasco", "ciruela", "naranja", "light"],
  miel: ["pura", "organica", "cremosa"],
  manteca: ["sin sal", "con sal"],
  "crema de leche": ["doble", "liviana", "chantilly"],
  "queso crema": ["light", "untable", "entero", "descremado"],
  galletitas: ["integrales", "saladas", "dulces", "de agua", "salvado", "sin sal"],
  aceitunas: ["descarozadas", "rellenas", "verdes", "negras"],
  vinagre: ["de alcohol", "de manzana", "de vino", "blanco", "balsamico"],
  mayonesa: ["light", "clasica"],
  atun: ["al natural", "en aceite", "lomitos", "desmenuzado"],
  "tomate triturado": ["cubeteado", "triturado", "entero", "pure"],
  "agua mineral": ["sin gas", "con gas"],
  gaseosa: ["lima limon", "cola", "naranja", "pomelo", "zero", "light"],
  jugo: ["naranja", "multifruta", "manzana", "pomelo"],
  lentejas: ["secas", "en lata"],
  polenta: ["instantanea", "rapida"],
  "queso rallado": ["reggianito", "sardo", "parmesano"],
  esponja: ["multiuso", "antiadherente"],
  guantes: ["latex", "vinilo", "nitrilo"],
  "vasos descartables": ["termicos", "plasticos"],
};

/**
 * Marcas propias de las cadenas. Son el escalón económico declarado del
 * supermercado, y es la única señal de "gama" que el catálogo nos da de verdad:
 * no hay puntaje de calidad, hay marca y precio.
 */
const STORE_BRANDS = [
  "dia", "carrefour", "jumbo", "vea", "disco", "cuisine & co", "cuisine and co",
  "bell", "great value", "simple", "krea", "mia casa",
];

/** Si el producto es marca propia del supermercado. */
export function isStoreBrand(brand: string, title: string): boolean {
  const b = normalizeTerm(brand);
  if (b.length > 0 && STORE_BRANDS.some((s) => b === normalizeTerm(s))) return true;
  const t = normalizeTerm(title);
  return STORE_BRANDS.some((s) => t.includes(` ${normalizeTerm(s)}`));
}

/**
 * Devuelve `{}` cuando ninguna variante conocida aparece en el nombre. Un
 * atributo vacío es honesto: significa "el nombre no lo dice", y hace que el
 * producto sirva para cualquier pedido que no especifique variante. Inventar
 * una variante lo excluiría de pedidos que sí podría cubrir.
 */
export function extractVariant(canonical: string, productName: string): Record<string, string> {
  const variantes = VARIANTS[normalizeTerm(canonical)];
  if (variantes === undefined) return {};

  const nombre = normalizeTerm(productName);
  for (const v of variantes) {
    if (nombre.includes(normalizeTerm(v))) return { tipo: v };
  }
  return {};
}
