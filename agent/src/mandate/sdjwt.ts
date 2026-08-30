/**
 * SD-JWT mínimo: firma ES256 y divulgación selectiva, sobre `node:crypto`.
 *
 * Está escrito a mano y no importado por dos razones. La primera es que son
 * ciento y pico de líneas y una dependencia más es una superficie más. La
 * segunda, y la que importa: si el argumento del proyecto es que el merchant
 * puede verificar por su cuenta, conviene que la verificación sea legible de
 * punta a punta y no una llamada opaca a algo que nadie del equipo leyó.
 *
 * Lo que NO es: una implementación completa de la spec SD-JWT. No hay
 * divulgación de estructuras anidadas, ni arrays con `...`, ni decoys. Hay
 * exactamente lo que hace falta para el caso: hashes por campo del comprador,
 * con sal, y una prueba de posesión de la clave del agente.
 *
 * Sobre el hash: usamos SHA-256, no keccak256, aunque `policyHash` termine en un
 * `bytes32` de Solidity. El contrato nunca recomputa ese hash —lo guarda y lo
 * compara— así que el algoritmo sólo tiene que ser el mismo de los dos lados
 * de NUESTRO código. Meter keccak sería traer una dependencia para nada.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";
import type { Base64Url, BuyerProfile, BuyerProfileField, ConfirmationKey, Disclosure, SignedCredential } from "../../../shared/ap2.js";

// ---------------------------------------------------------------------------
// base64url y JSON canónico
// ---------------------------------------------------------------------------

export function b64uEncode(input: Buffer | string): Base64Url {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input).toString("base64url");
}

export function b64uDecode(input: Base64Url): Buffer {
  return Buffer.from(input, "base64url");
}

/**
 * JSON con las claves ordenadas, recursivamente.
 *
 * Sin esto los hashes no sirven: `{"a":1,"b":2}` y `{"b":2,"a":1}` son el mismo
 * objeto y dan hashes distintos. Como el merchant recomputa hashes sobre
 * objetos que armó otro proceso —y a veces otro equipo—, la serialización tiene
 * que ser una función del valor y no del orden en que alguien escribió el
 * literal.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256b64u(input: Buffer | string): Base64Url {
  return createHash("sha256").update(input).digest("base64url");
}

/** Hash canónico de cualquier objeto. Es el que usamos para `policyHash` y `sd_hash`. */
export function hashObject(value: unknown): Base64Url {
  return sha256b64u(canonicalJson(value));
}

// ---------------------------------------------------------------------------
// Claves
// ---------------------------------------------------------------------------

export interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function generateP256(): KeyPair {
  return generateKeyPairSync("ec", { namedCurve: "P-256" });
}

export function privateKeyFromPem(pem: string): KeyObject {
  return createPrivateKey(pem);
}

export function publicKeyFromPem(pem: string): KeyObject {
  return createPublicKey(pem);
}

/** La clave pública en la forma que AP2 mete en `cnf`. */
export function toConfirmationKey(publicKey: KeyObject): ConfirmationKey {
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new Error(`Se esperaba una clave EC P-256 y vino ${jwk.kty}/${jwk.crv}.`);
  }
  return { jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } };
}

/** El camino inverso: reconstruir la clave que el humano endosó, para verificar contra ella. */
export function fromConfirmationKey(cnf: ConfirmationKey): KeyObject {
  return createPublicKey({ key: { ...cnf.jwk }, format: "jwk" });
}

// ---------------------------------------------------------------------------
// JWT compacto, ES256
// ---------------------------------------------------------------------------

const HEADER = b64uEncode(canonicalJson({ alg: "ES256", typ: "JWT" }));

/**
 * `dsaEncoding: "ieee-p1363"` no es un detalle: por defecto Node firma ECDSA en
 * DER, y JOSE espera r‖s crudo de 64 bytes. Con el default la firma es válida
 * pero ningún verificador de JWT del mundo la acepta.
 */
export function signJwt<T>(payload: T, privateKey: KeyObject): SignedCredential<T> {
  const body = b64uEncode(canonicalJson(payload));
  const signingInput = `${HEADER}.${body}`;
  const signature = nodeSign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return { jwt: `${signingInput}.${b64uEncode(signature)}`, payload };
}

/**
 * Verifica firma y devuelve el payload, o `null` si algo no cierra.
 *
 * Devuelve `null` y no lanza porque el que llama es el verificador del
 * merchant, que necesita convertir cada falla en un código auditable en vez de
 * en una excepción que se propague sin contexto.
 */
export function verifyJwt<T>(jwt: string, publicKey: KeyObject): T | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  try {
    const ok = nodeVerify(
      "sha256",
      Buffer.from(`${header}.${body}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      b64uDecode(signature),
    );
    if (!ok) return null;
    return JSON.parse(b64uDecode(body).toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** El payload sin verificar nada. Sólo para inspección y logs — nunca para decidir. */
export function peekJwt<T>(jwt: string): T | null {
  const body = jwt.split(".")[1];
  if (body === undefined) return null;
  try {
    return JSON.parse(b64uDecode(body).toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Divulgación selectiva
// ---------------------------------------------------------------------------

/**
 * La forma serializada de una divulgación, que es lo que se hashea.
 *
 * Se hashea la cadena base64url y no el objeto porque así lo hace la spec y
 * porque elimina toda ambigüedad de serialización: el que revela y el que
 * verifica hashean exactamente los mismos bytes.
 */
export function encodeDisclosure(d: Disclosure): string {
  return b64uEncode(canonicalJson([d.salt, d.claim, d.value]));
}

export function digestDisclosure(d: Disclosure): Base64Url {
  return sha256b64u(encodeDisclosure(d));
}

/**
 * Convierte el perfil del comprador en hashes + divulgaciones.
 *
 * El `_sd` que sale de acá va DENTRO del mandato firmado, así que queda
 * comprometido: el comprador no puede después cambiar su CUIT, y el agente
 * tampoco. Las divulgaciones quedan del lado del agente, que elige cuáles
 * entregar en cada compra.
 *
 * `_sd` se devuelve ordenado a propósito. Si conservara el orden de los campos,
 * la posición de cada hash filtraría qué campo es cada uno, que es justo lo que
 * la divulgación selectiva viene a evitar.
 */
export function makeDisclosures(profile: BuyerProfile): { _sd: Base64Url[]; disclosures: Disclosure[] } {
  const disclosures: Disclosure[] = (Object.keys(profile) as BuyerProfileField[]).map((claim) => ({
    salt: b64uEncode(randomBytes(16)),
    claim,
    value: profile[claim],
  }));

  return {
    _sd: disclosures.map(digestDisclosure).sort(),
    disclosures,
  };
}

/**
 * Comprueba que cada divulgación corresponde a un hash del mandato firmado.
 *
 * Es el chequeo que hace que un dato revelado valga: sin él, el agente podría
 * entregarle al merchant cualquier CUIT. Devuelve `null` si UNA sola no cierra
 * —no un resultado parcial— porque un lote de datos del comprador donde uno
 * está adulterado no es "casi correcto", es una presentación fraudulenta.
 *
 * También rechaza divulgaciones repetidas del mismo campo: dos valores para
 * `direccionEntrega` dejarían al merchant eligiendo cuál usar.
 */
export function verifyDisclosures(
  _sd: readonly Base64Url[],
  disclosures: readonly Disclosure[],
): Partial<BuyerProfile> | null {
  const known = new Set(_sd);
  const out: Partial<BuyerProfile> = {};

  for (const d of disclosures) {
    if (!known.has(digestDisclosure(d))) return null;
    if (out[d.claim] !== undefined) return null;
    out[d.claim] = d.value;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Prueba de posesión (key binding)
// ---------------------------------------------------------------------------

export interface KeyBindingClaims {
  sd_hash: Base64Url;
  aud: string;
  nonce: string;
  iat: number;
}

/**
 * El agente demuestra que tiene la clave que el humano endosó en `cnf`.
 *
 * Sin esto, cualquiera que intercepte una presentación puede reusarla: los dos
 * mandatos son públicos y verificables por definición. El kb-JWT es lo que ata
 * la presentación a quien la está haciendo, acá y ahora.
 */
export function signKeyBinding(claims: KeyBindingClaims, agentKey: KeyObject): string {
  return signJwt(claims, agentKey).jwt;
}

export function verifyKeyBinding(
  kbJwt: string,
  agentPublicKey: KeyObject,
  expected: { sd_hash: Base64Url; aud: string; nonce: string },
): boolean {
  const claims = verifyJwt<KeyBindingClaims>(kbJwt, agentPublicKey);
  if (claims === null) return false;
  return (
    claims.sd_hash === expected.sd_hash &&
    claims.aud === expected.aud &&
    claims.nonce === expected.nonce
  );
}

export function nowSeconds(clock: { now(): Date }): number {
  return Math.floor(clock.now().getTime() / 1000);
}
