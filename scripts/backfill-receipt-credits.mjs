import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1ReceiptCreditSettlement } from "../services/credits/d1-receipt-credit-settlement.mjs";

const url = required(process.env.TURSO_DATABASE_URL, "TURSO_DATABASE_URL");
const authToken = required(process.env.TURSO_AUTH_TOKEN, "TURSO_AUTH_TOKEN");
const client = createClient({ url, authToken });
const database = new LibsqlD1Database(client);
const store = new D1ReceiptCreditSettlement(database);

try {
  const rows = await database.prepare(
    "SELECT id FROM contribution_receipts ORDER BY issued_at ASC, id ASC LIMIT 1000",
  ).all();
  let created = 0;
  let existing = 0;
  let units = 0;
  for (const row of rows.results ?? []) {
    const settlement = await store.settleReceipt(row.id);
    if (settlement.created) created += 1;
    else existing += 1;
    units += settlement.totalUnits;
  }
  console.log(JSON.stringify({ receipts: rows.results?.length ?? 0, created, existing, projectedUnits: units }));
} finally {
  await client.close();
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}
