import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { createRemoteLibsqlD1Database } from "@/services/database/libsql-d1-adapter.mjs";
import * as schema from "./schema";

let remoteDatabase: AnyD1Database | null = null;

export class MissingDatabaseBindingError extends Error {
  constructor() {
    super(
      "Cloudflare D1 binding `DB` is unavailable. Apply the catalog migrations and run this route with the Proofweave D1 binding.",
    );
    this.name = "MissingDatabaseBindingError";
  }
}

export function getD1(): AnyD1Database {
  if (env.DB) {
    return env.DB;
  }
  const values = env as unknown as Record<string, string | undefined>;
  if (values.TURSO_DATABASE_URL && values.TURSO_AUTH_TOKEN) {
    remoteDatabase ??= createRemoteLibsqlD1Database({
      url: values.TURSO_DATABASE_URL,
      authToken: values.TURSO_AUTH_TOKEN,
    }) as unknown as AnyD1Database;
    return remoteDatabase;
  }
  throw new MissingDatabaseBindingError();
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
