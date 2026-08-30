/**
 * Extracción del tamaño desde el nombre del producto.
 *
 * "Café Molido 250 Grs Lavazza" → 0.25 kg. "Leche Entera 3x1L" → 3 packs de 1L.
 *
 * Esto es determinístico a propósito, aunque haya un LLM disponible en el
 * scraper: el tamaño es la mitad del precio por unidad, y un modelo que se
 * equivoca por un factor de 1000 al leer "gr" vs "kg" hace que el agente compare
 * mal todo. Las reglas son aburridas y verificables; el modelo se usa solo donde
 * hay ambigüedad semántica de verdad.
 */

import type { Presentation, Unit } from "@/contracts/index.js";

/** Sinónimos de unidad tal como aparecen en los catálogos argentinos. */
const UNIT_PATTERNS: { re: RegExp; unit: Unit; factor: number }[] = [
  { re: /(\d+(?:[.,]\d+)?)\s*(?:kgs?|kilogramos?|kilos?)\b/i, unit: "kg", factor: 1 },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:grs?|gramos?|g)\b/i, unit: "kg", factor: 0.001 },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:lts?|litros?|l)\b/i, unit: "L", factor: 1 },
  { re: /(\d+(?:[.,]\d+)?)\s*(?:mls?|cc|mililitros?)\b/i, unit: "L", factor: 0.001 },
  // "u" suelta al final va última en la alternancia para que "20 Un" matchee
  // "un" y no se corte en "u". Sin ella, "Vasos x 20 U" quedaba sin cantidad.
  { re: /(\d+(?:[.,]\d+)?)\s*(?:unidades?|uds?|un|rollos?|u)\b/i, unit: "unidad", factor: 1 },
];

/**
 * "3x1L", "Pack x 6", "x12" — cuántas piezas trae el pack.
 *
 * La bandera `d` es necesaria: hace falta saber en qué posición está el número
 * capturado para poder detectar cuándo es el MISMO número que ya se usó como
 * tamaño. En "Papel Higiénico x 4 Un", el "4" es la cantidad —no un
 * multiplicador— y contarlo dos veces daba 16 unidades en vez de 4, o sea un
 * precio por unidad cuatro veces más barato de lo real.
 */
const PACK_PATTERNS: RegExp[] = [
  /(?:pack\s*)?x\s*(\d+)\b/id,
  /\b(\d+)\s*x\s*\d+(?:[.,]\d+)?\s*(?:kgs?|grs?|lts?|mls?|l|g)\b/id,
];

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

export interface ParsedSize {
  presentation: Presentation;
  /** Qué fragmento del nombre produjo el resultado, para poder auditar el parseo. */
  matched: string;
}

/**
 * Devuelve null cuando el nombre no dice el tamaño. Preferimos descartar el
 * producto antes que inventarle un tamaño: sin tamaño no hay precio por unidad,
 * y sin precio por unidad la comparación es ruido.
 */
/**
 * `prefer` cambia el orden en que se prueban las unidades, y no es un detalle.
 *
 * "Vasos Descartables 300 Cc X 20 U" tiene dos números con unidad: los 300cc son
 * la capacidad de CADA vaso y las 20 unidades son lo que se compra. Sin saber
 * qué unidad esperamos, el parser lee el primero y publica "0.3 L de vasos", que
 * es una medida sin sentido para comparar precios.
 */
export function parseSize(name: string, prefer?: Unit): ParsedSize | null {
  const patterns =
    prefer === undefined
      ? UNIT_PATTERNS
      : [...UNIT_PATTERNS.filter((p) => p.unit === prefer), ...UNIT_PATTERNS.filter((p) => p.unit !== prefer)];

  for (const { re, unit, factor } of patterns) {
    const m = name.match(re);
    if (m?.[1] === undefined) continue;

    const size = toNumber(m[1]) * factor;
    if (!Number.isFinite(size) || size <= 0) continue;

    // Span que ocupó el tamaño en el nombre. Un multiplicador de pack que caiga
    // acá adentro es el mismo número leído dos veces, no un pack.
    const sizeStart = m.index ?? 0;
    const sizeEnd = sizeStart + m[0].length;

    let packQty = 1;
    for (const packRe of PACK_PATTERNS) {
      const pm = name.match(packRe);
      const capture = pm?.indices?.[1];
      if (pm?.[1] === undefined || capture === undefined) continue;

      if (capture[0] >= sizeStart && capture[0] < sizeEnd) continue;

      const n = Number(pm[1]);
      if (Number.isFinite(n) && n > 1 && n <= 48) {
        packQty = n;
        break;
      }
    }

    return { presentation: { unit, sizePerPack: size, packQty }, matched: m[0] };
  }
  return null;
}

/**
 * Rangos de cordura por unidad, para atajar precios mal escalados.
 *
 * El catálogo de Jumbo devuelve `ListPrice: 2644628` junto a `Price: 32000` para
 * el mismo producto: un campo heredado en otra escala. Si eso entra al motor de
 * decisión, el agente compara centavos contra pesos y elige cualquier cosa con
 * total convicción. Los límites son deliberadamente anchos — solo tienen que
 * atajar errores de orden de magnitud, no juzgar si algo está caro.
 */
const SANE_UNIT_PRICE_ARS: Record<Unit, { min: number; max: number }> = {
  kg: { min: 200, max: 400_000 },
  L: { min: 200, max: 400_000 },
  unidad: { min: 5, max: 200_000 },
};

export function isSanePrice(priceArs: number, presentation: Presentation): boolean {
  if (!Number.isFinite(priceArs) || priceArs <= 0) return false;

  const total = presentation.sizePerPack * presentation.packQty;
  if (total <= 0) return false;

  const unitPrice = priceArs / total;
  const range = SANE_UNIT_PRICE_ARS[presentation.unit];
  return unitPrice >= range.min && unitPrice <= range.max;
}
