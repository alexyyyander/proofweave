declare module "cloudflare:workers" {
  import type { AnyD1Database } from "drizzle-orm/d1";

  type ArtifactObject = {
    body: ReadableStream<Uint8Array> | null;
    size: number;
    customMetadata?: Record<string, string | undefined>;
  };

  type ArtifactBucket = {
    get(key: string): Promise<ArtifactObject | null>;
  };

  export const env: {
    DB?: AnyD1Database;
    ARTIFACTS?: ArtifactBucket;
  };
}
