/**
 * Las claves de la demo. Cuatro pares, y que sean cuatro es el punto.
 *
 * Todo el diseño se apoya en que firmante y verificador son partes distintas.
 * Si el humano, el agente y el vendedor compartieran clave, el verificador del
 * merchant no probaría nada: estaría comprobando su propia firma. Tenerlas
 * separadas y explícitas hace que cada chequeo signifique algo concreto:
 *
 *   usuario  → firma el Open Mandate. Es la ÚNICA autoridad de gasto que existe.
 *   agente   → firma el Closed Mandate y la prueba de posesión. No puede firmar
 *              un open, y por eso no puede ampliarse a sí mismo el permiso.
 *   merchant → firma el carrito cerrado y el recibo. Que el agente no pueda
 *              emitir carritos es lo que hace que `checkout_hash` sirva.
 *   impostor → no participa de nada. Existe para que los tests puedan probar
 *              que una firma ajena se rechaza, en vez de asumirlo.
 *
 * Son fijas y están en el repo porque es una demo: así los fixtures se pueden
 * commitear y un test que corre mañana verifica la misma firma que hoy. En algo
 * real la del usuario vive en su dispositivo y nunca sale de ahí, la del agente
 * la custodia el proveedor del agente, y ninguna de las dos estaría acá.
 *
 * NO son secretos. Están publicadas. Nada que dependa de que estas claves sean
 * privadas debe existir fuera de la demo.
 */

import type { KeyObject } from "node:crypto";
import { privateKeyFromPem, publicKeyFromPem, type KeyPair } from "./sdjwt.js";

function pair(privatePem: string, publicPem: string): KeyPair {
  return { privateKey: privateKeyFromPem(privatePem), publicKey: publicKeyFromPem(publicPem) };
}

const USUARIO_SK = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg6Wt0nlIDdaKsDGot
/t6/QixR2DHdnQ5qdPboRomEPmOhRANCAAReTo2fgGOMX4GKf5kU1RrARIdsD03Y
meJK63RfuQHrv1ZBn1lscqssP24Pxv4wNsQAXKK6nkfNOVcctuVXBCjw
-----END PRIVATE KEY-----`;

const USUARIO_PK = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXk6Nn4BjjF+Bin+ZFNUawESHbA9N
2JniSut0X7kB679WQZ9ZbHKrLD9uD8b+MDbEAFyiup5HzTlXHLblVwQo8A==
-----END PUBLIC KEY-----`;

const AGENTE_SK = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgLlz7MhXZdEqXUptC
uaedlkySH1qRa6+3mgsWWdGx+YChRANCAAQXf2FrmoUmbobUNUUeXFeEUdZPFIFa
rDP1oXjh0RbALaIqWP+a+vHKo+JNB4f0f1decW6Zsbe0r/aIqvPDViyf
-----END PRIVATE KEY-----`;

const AGENTE_PK = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEF39ha5qFJm6G1DVFHlxXhFHWTxSB
Wqwz9aF44dEWwC2iKlj/mvrxyqPiTQeH9H9XXnFumbG3tK/2iKrzw1Ysnw==
-----END PUBLIC KEY-----`;

const MERCHANT_SK = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpqSlRQq8MWnVWUEn
Pz2TXL0Gw3LszAuwzpHBRY6LYCuhRANCAASHGXD4FIGtxd112nWcWTCtwO7dmn9R
o9D9JaYg6pq7cXt3tDeyJJHUijYT5p7yNWVBo3eERsP7x/ozocqRvdHX
-----END PRIVATE KEY-----`;

const MERCHANT_PK = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhxlw+BSBrcXdddp1nFkwrcDu3Zp/
UaPQ/SWmIOqau3F7d7Q3siSR1Io2E+ae8jVlQaN3hEbD+8f6M6HKkb3R1w==
-----END PUBLIC KEY-----`;

const IMPOSTOR_SK = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgkGIJ+YGpSgvw/PsY
D8zuoFP0bd7WywL6TdeuwKa60PyhRANCAATs+cQZLF05rYdtxRNEPGkEnBiXuk6c
N3irH96khUY7q60sp0CXw/VJ+iL6lgcK9LdOkrXZs9mxnO60+026jB4p
-----END PRIVATE KEY-----`;

const IMPOSTOR_PK = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7PnEGSxdOa2HbcUTRDxpBJwYl7pO
nDd4qx/epIVGO6utLKdAl8P1Sfoi+pYHCvS3TpK12bPZsZzutPtNuoweKQ==
-----END PUBLIC KEY-----`;

/** El humano. Su firma es lo único que crea autoridad de gasto. */
export const usuario: KeyPair = pair(USUARIO_SK, USUARIO_PK);

/** El agente. Firma compras concretas dentro de lo que el humano ya autorizó. */
export const agente: KeyPair = pair(AGENTE_SK, AGENTE_PK);

/** El vendedor. Firma el carrito y el recibo. */
export const merchant: KeyPair = pair(MERCHANT_SK, MERCHANT_PK);

/** No es parte del sistema. Sólo sirve para que los tests puedan atacarlo. */
export const impostor: KeyPair = pair(IMPOSTOR_SK, IMPOSTOR_PK);

/**
 * Las públicas que un verificador necesita conocer de antemano.
 *
 * En producción esto es un directorio consultable —es exactamente el problema
 * que resuelve el Trusted Agent Protocol de Visa— y no un objeto en un archivo.
 * Acá alcanza con que exista el concepto: el merchant verifica CONTRA algo que
 * ya conocía, no contra una clave que le mandaron junto con la firma.
 */
export const publicKeys: { usuario: KeyObject; agente: KeyObject; merchant: KeyObject } = {
  usuario: usuario.publicKey,
  agente: agente.publicKey,
  merchant: merchant.publicKey,
};
