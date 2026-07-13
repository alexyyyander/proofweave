import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export class MissingDatabaseBindingError extends Error {
  constructor() {
    super(
      "Cloudflare D1 binding `DB` is unavailable. Apply the catalog migrations and run this route with the Proofweave D1 binding.",
    );
    this.name = "MissingDatabaseBindingError";
  }
}

export function getD1(): AnyD1Database {
  if (!env.DB) {
    throw new MissingDatabaseBindingError();
  }

  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
