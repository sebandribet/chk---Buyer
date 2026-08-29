/**
 * Grabado y reproducción de respuestas del modelo.
 *
 * La clave del fixture es (op, hash del mensaje de usuario) y deja afuera el
 * system prompt a propósito: durante la hackathon vamos a reescribir el system
 * prompt muchas veces, y no queremos re-grabar todo el set cada vez que
 * cambiamos una coma. La contracara honesta es que un cambio de system prompt
 * NO invalida los fixtures — si tocás el system y querés ver su efecto real,
 * hay que volver a grabar a mano (`npm run record`).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(HERE, "..", "..", "fixtures");

export function fixtureKey(op: string, user: string): string {
  const hash = createHash("sha1").update(user).digest("hex").slice(0, 12);
  return `${op}/${hash}`;
}

export function fixturePath(op: string, user: string): string {
  return join(FIXTURES_DIR, `${fixtureKey(op, user)}.json`);
}

export interface FixtureFile {
  op: string;
  /** El prompt grabado, en claro, para poder revisar a mano qué se le preguntó al modelo. */
  user: string;
  recordedAt: string;
  response: unknown;
}

export function readFixture(op: string, user: string): FixtureFile | null {
  const path = fixturePath(op, user);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
}

export function writeFixture(op: string, user: string, response: unknown): void {
  const path = fixturePath(op, user);
  mkdirSync(dirname(path), { recursive: true });
  const file: FixtureFile = { op, user, recordedAt: new Date().toISOString(), response };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}
