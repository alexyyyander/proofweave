import assert from "node:assert/strict";
import test from "node:test";
import { verifyAlphaControlPlaneKeys } from "../scripts/verify-alpha-control-plane-keys.mjs";

async function fixture() {
  const [controlPlane, runnerResult, receiptIssuer] = await Promise.all([
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
  ]);
  const [controlPlanePrivateKeyJwk, runnerResultPrivateKeyJwk, receiptIssuerPrivateKeyJwk, controlPlanePublicKey, runnerResultPublicKey, receiptIssuerPublicKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", controlPlane.privateKey),
    crypto.subtle.exportKey("jwk", runnerResult.privateKey),
    crypto.subtle.exportKey("jwk", receiptIssuer.privateKey),
    crypto.subtle.exportKey("raw", controlPlane.publicKey),
    crypto.subtle.exportKey("raw", runnerResult.publicKey),
    crypto.subtle.exportKey("raw", receiptIssuer.publicKey),
  ]);
  const mcpManifest = {
    control_plane: {
      d1_database_name: "proofweave-control-alpha",
      d1_database_id: "ce75f2fb-40a9-4d14-9393-6cdb6a6f6069",
      artifact_storage: "d1_inline",
    },
    gateway: { worker_name: "proofweave-mcp-gateway-alpha", resource_url: "https://mcp.proofweave.test/mcp" },
    identity: { issuer_url: "https://auth.proofweave.test/" },
    receipt_issuer: {
      key_id: "receipt-issuer:closed-alpha",
      public_key: base64Url(receiptIssuerPublicKey),
      activated_at: "2026-07-17T00:00:00.000Z",
    },
    runner: {
      queue_name: "proofweave-runner-jobs-alpha",
      approved_images: [{
        image_digest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
        lean_toolchain: "leanprover/lean4:v4.30.0",
        mathlib_revision: "fixture-mathlib-revision",
      }],
      control_plane_key_id: "control-plane:closed-alpha",
      default_limits: { cpu_seconds: 60, wall_seconds: 120, memory_mib: 2_048, disk_mib: 2_048, output_bytes: 1_000_000 },
    },
  };
  const runnerManifest = {
    control_plane: { ...mcpManifest.control_plane },
    queue: {
      name: "proofweave-runner-jobs-alpha",
      dead_letter_queue: "proofweave-runner-jobs-alpha-dlq",
      max_batch_size: 1,
      max_batch_timeout_seconds: 5,
      max_retries: 5,
      max_concurrency: 1,
    },
    runner: {
      worker_name: "proofweave-lean-runner-alpha",
      container_class: "LeanRunnerContainer",
      image: {
        image_digest: mcpManifest.runner.approved_images[0].image_digest,
        lean_toolchain: mcpManifest.runner.approved_images[0].lean_toolchain,
        mathlib_revision: mcpManifest.runner.approved_images[0].mathlib_revision,
      },
      retry_delay_seconds: 30,
    },
    keys: {
      control_plane_issuer: { id: mcpManifest.runner.control_plane_key_id, public_key: base64Url(controlPlanePublicKey) },
      runner_result: { id: "runner:closed-alpha", public_key: base64Url(runnerResultPublicKey) },
    },
  };
  return { mcpManifest, runnerManifest, controlPlanePrivateKeyJwk, runnerResultPrivateKeyJwk, receiptIssuerPrivateKeyJwk };
}

test("deployment key verifier proves secret JWKs match reviewed manifest public keys", async () => {
  const values = await fixture();
  assert.deepEqual(await verifyAlphaControlPlaneKeys(values), {
    controlPlaneKeyId: "control-plane:closed-alpha",
    runnerResultKeyId: "runner:closed-alpha",
    receiptIssuerKeyId: "receipt-issuer:closed-alpha",
  });
});

test("deployment key verifier rejects a mismatched Receipt issuer secret", async () => {
  const values = await fixture();
  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const otherPrivateKeyJwk = await crypto.subtle.exportKey("jwk", other.privateKey);
  await assert.rejects(
    () => verifyAlphaControlPlaneKeys({ ...values, receiptIssuerPrivateKeyJwk: otherPrivateKeyJwk }),
    /Contribution Receipt signing private key does not match/,
  );
});

test("deployment key verifier rejects a secret from another key pair", async () => {
  const values = await fixture();
  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const otherPrivateKeyJwk = await crypto.subtle.exportKey("jwk", other.privateKey);
  await assert.rejects(
    () => verifyAlphaControlPlaneKeys({ ...values, runnerResultPrivateKeyJwk: otherPrivateKeyJwk }),
    /Runner result signing private key does not match/,
  );
});

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}
