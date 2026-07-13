import assert from "node:assert/strict";
import test from "node:test";
import { verifyLeanRunnerResultSignature } from "../packages/protocol/lean-runner.mjs";
import {
  RunnerExecutionResultSigner,
  RunnerExecutionResultSignerError,
} from "../services/lean-runner/runner-execution-result-signer.mjs";

test("trusted Worker signer re-hashes Container output before producing a signed Runner result", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const execution = await fixtureExecution();
  const run = fixtureRun();
  const signer = new RunnerExecutionResultSigner({ runnerKeyId: "runner-key:trusted", runnerPrivateKey: pair.privateKey });

  const signed = await signer.sign({ execution, run });
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));

  assert.equal(signed.runnerKeyId, "runner-key:trusted");
  assert.equal(await verifyLeanRunnerResultSignature({ result: signed, runnerPublicKey: publicKey }), true);
});

test("trusted Worker signer rejects output and Run substitutions from a Container", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signer = new RunnerExecutionResultSigner({ runnerKeyId: "runner-key:trusted", runnerPrivateKey: pair.privateKey });
  const execution = await fixtureExecution();

  await assert.rejects(
    signer.sign({ execution: { ...execution, stdout: new TextEncoder().encode("substituted") }, run: fixtureRun() }),
    RunnerExecutionResultSignerError,
  );
  await assert.rejects(
    signer.sign({ execution, run: { ...fixtureRun(), requestHash: sha("f") } }),
    RunnerExecutionResultSignerError,
  );
  await assert.rejects(
    signer.sign({ execution: { ...execution, outputTruncated: true }, run: fixtureRun() }),
    RunnerExecutionResultSignerError,
  );
});

async function fixtureExecution() {
  const stdout = new TextEncoder().encode("Lean completed\n");
  const stderr = new Uint8Array();
  return {
    result: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: "run:signer",
      attemptId: "attempt:signer",
      requestHash: sha("a"),
      status: "succeeded",
      exitCode: 0,
      startedAt: "2026-07-13T00:00:00Z",
      finishedAt: "2026-07-13T00:00:01Z",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
      artifacts: {
        manifestHash: sha("b"),
        stdoutHash: await sha256(stdout),
        stderrHash: await sha256(stderr),
      },
    },
    stdout,
    stderr,
    outputTruncated: false,
    workspaceTreeHash: sha("c"),
  };
}

function fixtureRun() {
  return {
    id: "run:signer",
    attemptId: "attempt:signer",
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    state: "running",
  };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
