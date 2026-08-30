/**
 * Baja un catálogo real y lo congela a disco.
 *
 *   npm run scrape
 *
 * Se corre a mano, cuando queremos refrescar precios. El resultado queda en
 * `catalog.scraped.json` y el agente lo usa si existe. El demo NO scrapea en
 * vivo: los precios se miran una vez, se revisan, y recién ahí se usan.
 */

import { writeFileSync } from "node:fs";
import { NvidiaClient } from "@/llm/nvidia.js";
import { scrapeCatalog, SCRAPE_TARGETS } from "@/catalog/scrape/index.js";
import { SCRAPED_PATH } from "@/catalog/loader.js";

async function main(): Promise<void> {
  const llm = new NvidiaClient();
  console.log(`Bajando ${SCRAPE_TARGETS.length} rubros de 3 tiendas…\n`);

  const result = await scrapeCatalog(llm, SCRAPE_TARGETS, (t, n) => {
    console.log(`  ${t.canonical.padEnd(20)} ${String(n).padStart(3)} productos`);
  });

  writeFileSync(SCRAPED_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const descartados = result.stats.reduce(
    (acc, s) => acc + s.sinTamano + s.precioRaro + s.irrelevantes,
    0,
  );
  const crudos = result.stats.reduce((acc, s) => acc + s.crudos, 0);

  console.log(`\n${result.products.length} productos publicados de ${crudos} crudos.`);
  console.log(`${descartados} descartados:`);
  console.log(`  · ${result.stats.reduce((a, s) => a + s.sinTamano, 0)} sin tamaño legible en el nombre`);
  console.log(`  · ${result.stats.reduce((a, s) => a + s.precioRaro, 0)} con precio fuera de rango`);
  console.log(`  · ${result.stats.reduce((a, s) => a + s.irrelevantes, 0)} irrelevantes según el clasificador`);
  console.log(`\nEscrito en ${SCRAPED_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
