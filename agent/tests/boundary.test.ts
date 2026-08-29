/**
 * Los límites entre módulos, verificados en vez de comentados.
 *
 * Las dos reglas que sostienen el diseño son negativas —"el verificador no
 * comparte código con el agente", "el agente no alcanza el lado de escritura"—
 * y las reglas negativas se pudren solas: alguien agrega un import de buena fe,
 * compila, los tests pasan, y la garantía se fue sin que nadie se entere.
 *
 * Estos tests son feos a propósito. Leen los fuentes como texto porque lo que
 * hay que comprobar no es qué hace el código sino de dónde viene.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

async function sourcesIn(dir: string): Promise<{ path: string; code: string }[]> {
  const entries = await readdir(join(SRC, dir), { withFileTypes: true, recursive: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".ts"));

  return Promise.all(
    files.map(async (e) => {
      const path = join(e.parentPath ?? join(SRC, dir), e.name);
      return { path: path.slice(SRC.length + 1), code: await readFile(path, "utf8") };
    }),
  );
}

/** Los `from "..."` de un archivo, sin los de tipo puro ni los comentarios. */
function importsOf(code: string): string[] {
  const sinComentarios = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...sinComentarios.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("el verificador del merchant es otro dominio de confianza", () => {
  it("no importa nada de @/agent/**", async () => {
    const archivos = await sourcesIn("merchant");
    expect(archivos.length).toBeGreaterThan(0);

    const violaciones = archivos.flatMap(({ path, code }) =>
      importsOf(code)
        .filter((i) => i.startsWith("@/agent/"))
        .map((i) => `${path} → ${i}`),
    );

    // Si esto falla, la pregunta no es cómo silenciarlo: es si el verificador
    // sigue verificando algo. Un merchant que corre la lógica de decisión del
    // agente no está comprobando al agente, está repitiéndolo — y un error del
    // agente se replica idéntico en quien tenía que atraparlo.
    expect(violaciones).toEqual([]);
  });

  it("comparte, y sólo comparte, el formato de credenciales y el vocabulario", async () => {
    const archivos = await sourcesIn("merchant");
    const internos = archivos
      .flatMap(({ code }) => importsOf(code))
      .filter((i) => i.startsWith("@/"));

    // Lo que sí comparte es la definición de QUÉ significan las cosas: cómo se
    // firma un JWT, qué quiere decir cada constraint. Eso tienen que compartirlo
    // las dos partes o no hay verificación posible, igual que las dos usan el
    // mismo JSON. Lo que no puede compartir es cómo el agente DECIDE.
    const permitidos = ["@/mandate/", "@/contracts/"];
    const inesperados = internos.filter((i) => !permitidos.some((p) => i.startsWith(p)));

    expect(inesperados).toEqual([]);
  });

  it("tampoco toca el cobro: verificar y cobrar son momentos distintos", async () => {
    const archivos = await sourcesIn("merchant");

    // El vendedor verifica que la compra está autorizada; el delegado de pago
    // mueve la plata. Que sean dos pasos separados es lo que crea la ventana
    // entre retener y cobrar, y esa ventana es donde la revocación en vivo
    // todavía sirve. Un verificador que además cobrara la cerraría.
    const violaciones = archivos.flatMap(({ path, code }) =>
      importsOf(code)
        .filter((i) => i.startsWith("@/payments/") || i.startsWith("@/settlement/"))
        .map((i) => `${path} → ${i}`),
    );

    expect(violaciones).toEqual([]);
  });
});

describe("el agente no cobra", () => {
  it("nada de agent/ toca el puerto de pagos", async () => {
    const archivos = await sourcesIn("agent");

    // El agente descubre, compara y propone. Reservar presupuesto ya es de otro
    // (`authorize.ts`, el policy engine) y mover plata es de un tercero (el
    // delegado de pago). Tres actores, tres capacidades, y ninguna se le
    // concede al que razona con un modelo de lenguaje.
    const violaciones = archivos.flatMap(({ path, code }) =>
      importsOf(code)
        .filter((i) => i.startsWith("@/payments/") || i.startsWith("@/settlement/"))
        .map((i) => `${path} → ${i}`),
    );

    expect(violaciones).toEqual([]);
  });
});

describe("el agente no alcanza el lado de escritura", () => {
  it("ni decide.ts ni policy.ts tocan los puertos que gastan plata", async () => {
    const archivos = await sourcesIn("agent");
    const prohibidos = ["AuthorizationPort", "MandateRegistryPort"];

    const violaciones = archivos
      // `authorize.ts` ES el policy engine: es el único que puede tocarlos, y
      // el agente no puede llegar a él porque nadie le pasa sus dependencias.
      .filter(({ path }) => !path.endsWith("authorize.ts"))
      .flatMap(({ path, code }) =>
        prohibidos.filter((p) => code.includes(p)).map((p) => `${path} usa ${p}`),
      );

    expect(violaciones).toEqual([]);
  });

  it("el modo sugerencia no tiene forma de llegar a un mandato", async () => {
    const decide = await readFile(join(SRC, "agent/decide.ts"), "utf8");

    // `DiscoveryDeps` es lo que recibe `suggest()`. Que no incluya `MandatePort`
    // es lo que hace que su incapacidad de gastar sea estructural en vez de una
    // bandera que alguien pueda poner en true.
    const bloque = decide.slice(
      decide.indexOf("export interface DiscoveryDeps"),
      decide.indexOf("export interface DecideDeps"),
    );

    expect(bloque).not.toContain("MandatePort");
    expect(bloque).not.toContain("AuthorizationPort");
  });
});
