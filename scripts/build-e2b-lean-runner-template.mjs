import { Template, waitForProcess } from "e2b";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPinnedRunnerImage } from "../services/lean-runner/cloudflare-container-policy.mjs";

const environment = process.env;
const apiKey = requireSecret(environment.E2B_API_KEY, "E2B_API_KEY");
const imageReference = assertPinnedRunnerImage(environment.PROOFWEAVE_E2B_RUNNER_IMAGE);
const templateName = requireTemplateName(environment.PROOFWEAVE_E2B_TEMPLATE_NAME);
const cpuCount = integerSetting(environment.PROOFWEAVE_E2B_CPU, "PROOFWEAVE_E2B_CPU", 2, 1, 8);
const memoryMB = integerSetting(environment.PROOFWEAVE_E2B_MEMORY_MB, "PROOFWEAVE_E2B_MEMORY_MB", 2_048, 512, 8_192);
const registryCredentials = optionalRegistryCredentials(environment);
const sourceOverlayEnabled = booleanSetting(
  environment.PROOFWEAVE_E2B_RUNNER_SOURCE_OVERLAY,
  "PROOFWEAVE_E2B_RUNNER_SOURCE_OVERLAY",
  false,
);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryParent = dirname(repositoryRoot);
const repositoryDirectory = basename(repositoryRoot);

// The source image is already the independently reviewed, digest-pinned
// Proofweave Runner image. E2B receives no application secrets while building
// this immutable template. The actual HTTP service starts only after the
// runtime adapter has confirmed no egress and private inbound traffic.
let template = Template({
  // E2B applies a context-root .dockerignore to all uploads. Use the repository
  // parent as context so the Docker image's intentionally restrictive ignore
  // policy cannot hide these two explicitly selected source directories.
  fileContextPath: repositoryParent,
}).fromImage(imageReference, registryCredentials);

if (sourceOverlayEnabled) {
  // Overlay only the reviewed Runner protocol/runtime source. Lean, Mathlib,
  // system packages, and the unprivileged runtime user remain supplied by the
  // digest-pinned image. Build-time credentials and local configuration files
  // are outside these two bounded source trees and are never copied.
  template = template
    .copy(`${repositoryDirectory}/packages`, "/opt/proofweave/", {
      forceUpload: true,
      user: "root",
      resolveSymlinks: false,
    })
    .copy(`${repositoryDirectory}/services/lean-runner`, "/opt/proofweave/services/", {
      forceUpload: true,
      user: "root",
      resolveSymlinks: false,
    })
    .runCmd([
      "chown -R root:root /opt/proofweave/packages /opt/proofweave/services/lean-runner",
      "find /opt/proofweave/packages /opt/proofweave/services/lean-runner -type d -exec chmod 0755 {} +",
      "find /opt/proofweave/packages /opt/proofweave/services/lean-runner -type f -exec chmod 0644 {} +",
      "node --check /opt/proofweave/services/lean-runner/container-http-server.mjs",
    ], { user: "root" });
}

template = template.setStartCmd("tail -f /dev/null", waitForProcess("tail"));

let built;
try {
  built = await Template.build(template, templateName, {
    apiKey,
    cpuCount,
    memoryMB,
    onBuildLogs(entry) {
      const level = typeof entry?.level === "string" ? entry.level : "info";
      const message = typeof entry?.message === "string" ? entry.message : "E2B template build event";
      process.stderr.write(`[e2b:${level}] ${message}\n`);
    },
  });
} catch (error) {
  throw new Error(`E2B template build failed: ${safeBuildError(error)}`);
}
const templateTag = templateName.includes(":") ? templateName.slice(templateName.indexOf(":") + 1) : null;

process.stdout.write(`${JSON.stringify({
  schemaVersion: "pw-e2b-template-build-v1",
  templateId: built.templateId,
  templateReference: templateTag ? `${built.templateId}:${templateTag}` : built.templateId,
  buildId: built.buildId,
  name: built.name,
  imageReference,
  privateRegistry: Boolean(registryCredentials),
  sourceOverlayEnabled,
  cpuCount,
  memoryMB,
}, null, 2)}\n`);

function requireSecret(value, label) {
  if (typeof value !== "string" || value.length < 16 || value.length > 2_048 || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be configured as a bounded secret.`);
  }
  return value;
}

function requireTemplateName(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{2,62}(?::[A-Za-z0-9._-]{1,64})?$/.test(value)) {
    throw new Error("PROOFWEAVE_E2B_TEMPLATE_NAME must be a bounded E2B template name with an optional immutable version tag.");
  }
  return value;
}

function optionalRegistryCredentials(values) {
  const username = values.PROOFWEAVE_E2B_REGISTRY_USERNAME;
  const password = values.PROOFWEAVE_E2B_REGISTRY_PASSWORD;
  if ((username === undefined || username === "") && (password === undefined || password === "")) return undefined;
  if (typeof username !== "string" || !/^[A-Za-z0-9_.@-]{1,160}$/.test(username)) {
    throw new Error("PROOFWEAVE_E2B_REGISTRY_USERNAME must be a bounded registry username when private registry access is enabled.");
  }
  return Object.freeze({
    username,
    password: requireSecret(password, "PROOFWEAVE_E2B_REGISTRY_PASSWORD"),
  });
}

function integerSetting(value, label, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function booleanSetting(value, label, fallback) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be either true or false.`);
}

function safeBuildError(error) {
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error.name)
    ? error.name
    : "UnknownError";
  const rawMessage = error instanceof Error && typeof error.message === "string"
    ? error.message
    : "";
  const message = rawMessage
    .replace(/https?:\/\/\S+/giu, "[redacted-url]")
    .replace(/[\0\r\n]+/gu, " ")
    .slice(0, 500);
  return message ? `${name}: ${message}` : name;
}
