import { D1InlineArtifactBucket, maxInlineArtifactObjectBytes } from "../artifacts/d1-inline-artifact-store.mjs";
import {
  D1R2RunnerOutputStore,
  RunnerOutputStoreValidationError,
} from "./d1-r2-runner-output-store.mjs";

/** Store bounded Runner stdout/stderr in immutable D1 BLOB rows for alpha. */
export class D1InlineRunnerOutputStore extends D1R2RunnerOutputStore {
  constructor({ database } = {}) {
    super({ database, bucket: new D1InlineArtifactBucket(database) });
  }

  async put(input) {
    if (toBytes(input?.bytes).byteLength > maxInlineArtifactObjectBytes) {
      throw new RunnerOutputStoreValidationError(
        `Runner output exceeds the ${maxInlineArtifactObjectBytes} byte D1 inline-alpha limit.`,
      );
    }
    return super.put(input);
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new RunnerOutputStoreValidationError("Runner output bytes must be a byte array.");
}
