import { normalizeLeanRunnerRequest } from "../../packages/protocol/lean-runner.mjs";
import { assertPinnedRunnerImage } from "./cloudflare-container-policy.mjs";

export class RunnerImagePolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerImagePolicyError";
  }
}

/**
 * The Runner's deployment-owned allowlist binds an immutable Container image
 * to exactly one Lean and Mathlib environment. A request cannot select a
 * digest merely because it is syntactically pinned.
 */
export class PinnedRunnerImageRegistry {
  constructor({ images }) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new RunnerImagePolicyError("PinnedRunnerImageRegistry requires at least one approved image.");
    }
    this.images = new Map();
    this.environmentImages = new Map();
    for (const image of images) {
      const normalized = normalizeImage(image);
      if (this.images.has(normalized.imageDigest)) {
        throw new RunnerImagePolicyError("Runner image digests must be unique.");
      }
      const environmentKey = imageEnvironmentKey(normalized);
      if (this.environmentImages.has(environmentKey)) {
        throw new RunnerImagePolicyError("Only one approved Runner image may serve a Lean and Mathlib environment.");
      }
      this.images.set(normalized.imageDigest, normalized);
      this.environmentImages.set(environmentKey, normalized);
    }
  }

  resolve(request) {
    const normalizedRequest = normalizeLeanRunnerRequest(request);
    const image = this.images.get(normalizedRequest.environment.imageDigest);
    if (!image) {
      throw new RunnerImagePolicyError("Runner request image digest is not in the operator-approved allowlist.");
    }
    if (
      image.leanToolchain !== normalizedRequest.environment.leanToolchain ||
      image.mathlibRevision !== normalizedRequest.environment.mathlibRevision
    ) {
      throw new RunnerImagePolicyError("Runner request Lean environment does not match the approved image digest.");
    }
    return image;
  }

  /** Select the single operator-approved image for a Bundle's pinned environment. */
  resolveEnvironment({ leanToolchain, mathlibRevision } = {}) {
    const environment = {
      leanToolchain: boundedString(leanToolchain, "Runner Bundle Lean toolchain", 240),
      mathlibRevision: boundedString(mathlibRevision, "Runner Bundle Mathlib revision", 160),
    };
    const image = this.environmentImages.get(imageEnvironmentKey(environment));
    if (!image) {
      throw new RunnerImagePolicyError("Bundle Lean environment has no operator-approved Runner image.");
    }
    return image;
  }
}

function imageEnvironmentKey({ leanToolchain, mathlibRevision }) {
  return `${leanToolchain}\u0000${mathlibRevision}`;
}

function normalizeImage(image) {
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new RunnerImagePolicyError("Runner image definition must be an object.");
  }
  const extras = Object.keys(image).filter((key) => ![
    "imageDigest", "leanToolchain", "mathlibRevision",
  ].includes(key));
  if (extras.length > 0) {
    throw new RunnerImagePolicyError(`Runner image definition contains unsupported field ${extras[0]}.`);
  }
  const imageDigest = assertPinnedRunnerImage(image.imageDigest);
  const leanToolchain = boundedString(image.leanToolchain, "Runner image Lean toolchain", 240);
  const mathlibRevision = boundedString(image.mathlibRevision, "Runner image Mathlib revision", 160);
  return Object.freeze({ imageDigest, leanToolchain, mathlibRevision });
}

function boundedString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new RunnerImagePolicyError(`${label} must be a non-empty string.`);
  }
  return value;
}
