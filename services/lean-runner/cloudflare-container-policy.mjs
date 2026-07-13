/**
 * The closed-alpha Container policy is deliberately minimal. The trusted
 * Runner Worker transfers only an already-validated bundle into a fresh
 * per-Run instance; the Container has neither egress nor credentials.
 */
export const cloudflareLeanContainerPolicy = Object.freeze({
  enableInternet: false,
  sleepAfter: "30s",
  instanceType: "standard-1",
  maxInstances: 1,
});

export function assertPinnedRunnerImage(imageReference) {
  if (typeof imageReference !== "string" || !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(imageReference)) {
    throw new TypeError("Lean Runner Container image must be an immutable image reference with a sha256 digest.");
  }
  return imageReference;
}
