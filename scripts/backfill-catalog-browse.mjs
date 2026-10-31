import { fileURLToPath } from "node:url";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { loadEnvironmentFile } from "./lib/environment-file.mjs";
import { backfillCatalogBrowseBatch } from "../services/catalog/backfill.ts";

export async function verifyCatalogBrowse(database) {
  const missing = await database.prepare(`SELECT count(*) AS total FROM catalog_browse_source AS source
    LEFT JOIN catalog_browse AS browse ON browse.id = source.id WHERE browse.id IS NULL`).first("total");
  const counters = (await database.prepare(`SELECT kind, total, bounded, advance, formalize, verified
    FROM catalog_browse_counts WHERE total > 0 ORDER BY kind`).all()).results;
  const expected = (await database.prepare(`SELECT kind, count(*) AS total, sum(scope = 'bounded') AS bounded,
    sum(opportunity = 'advance') AS advance, sum(opportunity = 'formalize') AS formalize,
    sum(opportunity = 'verified') AS verified FROM catalog_browse_source GROUP BY kind ORDER BY kind`).all()).results;
  const rows = await database.prepare("SELECT count(*) AS total FROM catalog_browse").first("total");
  const documents = await database.prepare("SELECT count(*) AS total FROM catalog_browse_fts").first("total");
  if (missing !== 0 || rows !== documents || JSON.stringify(counters) !== JSON.stringify(expected)) {
    throw new Error("Catalog browse verification failed: index, counters, or source coverage differ.");
  }
  return { state: "verified", records: rows, searchDocuments: documents, counts: counters };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "apply" && mode !== "verify") throw new Error("Usage: node scripts/backfill-catalog-browse.mjs <apply|verify>");
  await loadEnvironmentFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error("The existing Turso database settings are required.");
  const database = createRemoteLibsqlD1Database({ url, authToken: token });
  try {
    if (mode === "apply") {
      let afterId = "", scanned = 0, batches = 0;
      for (;;) {
        const batch = await backfillCatalogBrowseBatch(database, afterId);
        scanned += batch.scanned;
        if (!batch.nextId) break;
        afterId = batch.nextId;
        batches++;
      }
      console.log(JSON.stringify({ state: "backfilled", scanned, batches }));
    }
    console.log(JSON.stringify(await verifyCatalogBrowse(database)));
  } catch (error) {
    const message = String(error?.message ?? "Catalog backfill failed").split(url).join("[redacted]").split(token).join("[redacted]");
    throw new Error(message);
  } finally {
    database.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
