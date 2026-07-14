import { D1InlineArtifactBucket } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1R2VerificationReplayEvidenceStore } from "./d1-r2-verification-replay-evidence-store.mjs";

/** Persist compact fresh-replay evidence through the D1-only alpha store. */
export class D1InlineVerificationReplayEvidenceStore extends D1R2VerificationReplayEvidenceStore {
  constructor({ database } = {}) {
    super({ database, bucket: new D1InlineArtifactBucket(database) });
  }
}
