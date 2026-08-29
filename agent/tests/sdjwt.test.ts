/**
 * Tests de las primitivas. Todo lo de arriba se apoya en que esto sea cierto.
 *
 * Los casos que importan no son los del camino feliz: son los cuatro que
 * prueban que una firma ajena, un payload editado, un hash que no está en `_sd`
 * y una presentación reusada se rechazan. Si alguno de esos pasara, el
 * verificador del merchant sería decorativo aunque tuviera cien chequeos.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  digestDisclosure,
  fromConfirmationKey,
  hashObject,
  makeDisclosures,
  signJwt,
  signKeyBinding,
  toConfirmationKey,
  verifyDisclosures,
  verifyJwt,
  verifyKeyBinding,
  b64uEncode,
} from "@/mandate/sdjwt.js";
import { agente, impostor, usuario } from "@/mandate/keys.js";
import type { BuyerProfile } from "../../shared/ap2.js";

const perfil: BuyerProfile = {
  razonSocial: "Café del Sur S.R.L.",
  cuit: "30-71234567-4",
  direccionEntrega: "Av. Corrientes 1234, CABA",
  contactoNombre: "Marina Ferreyra",
  contactoEmail: "compras@cafedelsur.ar",
  contactoTelefono: "+54 11 4567-8901",
};

describe("JSON canónico", () => {
  it("ordena las claves, así que el hash no depende de cómo se escribió el objeto", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(hashObject({ b: 2, a: 1 })).toBe(hashObject({ a: 1, b: 2 }));
  });

  it("ordena también dentro de objetos anidados y respeta el orden de los arrays", () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
    // En un array el orden ES el valor: [1,2] y [2,1] son listas distintas.
    expect(hashObject([1, 2])).not.toBe(hashObject([2, 1]));
  });

  it("ignora undefined, que no sobrevive a un round-trip por JSON", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("firma ES256", () => {
  it("verifica un JWT propio y devuelve el payload intacto", () => {
    const { jwt } = signJwt({ hola: "mundo", n: 42 }, usuario.privateKey);
    expect(verifyJwt<{ hola: string; n: number }>(jwt, usuario.publicKey)).toEqual({
      hola: "mundo",
      n: 42,
    });
  });

  it("rechaza una firma hecha con otra clave", () => {
    const { jwt } = signJwt({ monto: 100 }, impostor.privateKey);
    expect(verifyJwt(jwt, usuario.publicKey)).toBeNull();
  });

  it("rechaza un payload editado después de firmar", () => {
    const { jwt } = signJwt({ monto: 100 }, usuario.privateKey);
    const [header, , signature] = jwt.split(".") as [string, string, string];
    const adulterado = `${header}.${b64uEncode(canonicalJson({ monto: 999_999 }))}.${signature}`;

    expect(verifyJwt(adulterado, usuario.publicKey)).toBeNull();
  });

  it("rechaza cualquier cosa que no tenga las tres partes", () => {
    expect(verifyJwt("no-soy-un-jwt", usuario.publicKey)).toBeNull();
    expect(verifyJwt("a.b", usuario.publicKey)).toBeNull();
  });
});

describe("clave de confirmación (cnf)", () => {
  it("hace round-trip: la clave que sale del cnf verifica lo que firmó el agente", () => {
    const cnf = toConfirmationKey(agente.publicKey);
    const reconstruida = fromConfirmationKey(cnf);
    const { jwt } = signJwt({ a: 1 }, agente.privateKey);

    expect(cnf.jwk.kty).toBe("EC");
    expect(cnf.jwk.crv).toBe("P-256");
    expect(verifyJwt(jwt, reconstruida)).toEqual({ a: 1 });
  });

  it("la clave del cnf no verifica lo que firmó otro", () => {
    const reconstruida = fromConfirmationKey(toConfirmationKey(agente.publicKey));
    const { jwt } = signJwt({ a: 1 }, impostor.privateKey);

    expect(verifyJwt(jwt, reconstruida)).toBeNull();
  });
});

describe("divulgación selectiva", () => {
  it("acepta un subconjunto y devuelve sólo esos campos", () => {
    const { _sd, disclosures } = makeDisclosures(perfil);
    const parcial = disclosures.filter((d) => d.claim === "razonSocial" || d.claim === "cuit");

    expect(verifyDisclosures(_sd, parcial)).toEqual({
      razonSocial: "Café del Sur S.R.L.",
      cuit: "30-71234567-4",
    });
  });

  it("el _sd no filtra qué campo es cada hash: viene ordenado, no en orden de campo", () => {
    const { _sd, disclosures } = makeDisclosures(perfil);

    expect(_sd).toHaveLength(6);
    expect(_sd).toEqual([..._sd].sort());
    // El hash del primer campo del perfil no tiene por qué ser el primero de _sd.
    expect(new Set(_sd)).toEqual(new Set(disclosures.map(digestDisclosure)));
  });

  it("rechaza el lote entero si un solo valor fue adulterado", () => {
    const { _sd, disclosures } = makeDisclosures(perfil);
    const adulterado = disclosures.map((d) =>
      d.claim === "cuit" ? { ...d, value: "30-99999999-9" } : d,
    );

    // No devuelve los cinco campos buenos: no hay tal cosa como una
    // presentación casi correcta.
    expect(verifyDisclosures(_sd, adulterado)).toBeNull();
  });

  it("rechaza una divulgación inventada que no está en el mandato", () => {
    const { _sd } = makeDisclosures(perfil);
    const inventada = { salt: b64uEncode("sal"), claim: "cuit" as const, value: "30-00000000-0" };

    expect(verifyDisclosures(_sd, [inventada])).toBeNull();
  });

  it("rechaza dos valores para el mismo campo", () => {
    const { _sd, disclosures } = makeDisclosures(perfil);
    const cuit = disclosures.find((d) => d.claim === "cuit")!;

    expect(verifyDisclosures(_sd, [cuit, cuit])).toBeNull();
  });

  it("dos perfiles idénticos dan hashes distintos, porque la sal es distinta", () => {
    // Sin esto, un merchant podría reconocer al mismo comprador entre mandatos
    // distintos comparando hashes, o adivinar un CUIT por fuerza bruta.
    expect(makeDisclosures(perfil)._sd).not.toEqual(makeDisclosures(perfil)._sd);
  });
});

describe("prueba de posesión", () => {
  const esperado = { sd_hash: "abc123", aud: "merchant:acme", nonce: "n-1" };

  it("acepta la prueba del agente endosado", () => {
    const kb = signKeyBinding({ ...esperado, iat: 1_700_000_000 }, agente.privateKey);
    expect(verifyKeyBinding(kb, agente.publicKey, esperado)).toBe(true);
  });

  it("rechaza la prueba firmada por otro", () => {
    const kb = signKeyBinding({ ...esperado, iat: 1_700_000_000 }, impostor.privateKey);
    expect(verifyKeyBinding(kb, agente.publicKey, esperado)).toBe(false);
  });

  it("rechaza una prueba válida reusada contra otro merchant", () => {
    const kb = signKeyBinding({ ...esperado, iat: 1_700_000_000 }, agente.privateKey);
    expect(verifyKeyBinding(kb, agente.publicKey, { ...esperado, aud: "merchant:otro" })).toBe(false);
  });

  it("rechaza una prueba válida reusada para otro mandato", () => {
    const kb = signKeyBinding({ ...esperado, iat: 1_700_000_000 }, agente.privateKey);
    expect(verifyKeyBinding(kb, agente.publicKey, { ...esperado, sd_hash: "otro" })).toBe(false);
  });

  it("rechaza el replay: mismo kb-JWT, nonce que el merchant ya no espera", () => {
    const kb = signKeyBinding({ ...esperado, iat: 1_700_000_000 }, agente.privateKey);
    expect(verifyKeyBinding(kb, agente.publicKey, { ...esperado, nonce: "n-2" })).toBe(false);
  });
});
