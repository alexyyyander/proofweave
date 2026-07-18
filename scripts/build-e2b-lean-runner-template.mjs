import { Template, waitForProcess } from "e2b";
import { assertPinnedRunnerImage } from "../services/lean-runner/cloudflare-container-policy.mjs";

const environment = process.env;
const apiKey = requireSecret(environment.E2B_API_KEY, "E2B_API_KEY");
const imageReference = assertPinnedRunnerImage(environment.PROOFWEAVE_E2B_RUNNER_IMAGE);
const templateName = requireTemplateName(environment.PROOFWEAVE_E2B_TEMPLATE_NAME);
const cpuCount = integerSetting(environment.PROOFWEAVE_E2B_CPU, "PROOFWEAVE_E2B_CPU", 2, 1, 8);
const memoryMB = integerSetting(environment.PROOFWEAVE_E2B_MEMORY_MB, "PROOFWEAVE_E2B_MEMORY_MB", 2_048, 512, 8_192);
const registryCredentials = optionalRegistryCredentials(environment);

// The source image is already the independently reviewed, digest-pinned
// Proofweave Runner image. E2B receives no application secrets while building
// this immutable template. The actual HTTP service starts only after the
// runtime adapter has confirmed no egress and private inbound traffic.
const template = Template()
  .fromImage(imageReference, registryCredentials)
  .setStartCmd("tail -f /dev/null", waitForProcess("tail"));

const built = await Template.build(template, templateName, {
  apiKey,
  cpuCount,
  memoryMB,
  onBuildLogs(entry) {
    const level = typeof entry?.level === "string" ? entry.level : "info";
    const message = typeof entry?.message === "string" ? entry.message : "E2B template build event";
    process.stderr.write(`[e2b:${level}] ${message}\n`);
  },
});
const templateTag = templateName.includes(":") ? templateName.slice(templateName.indexOf(":") + 1) : null;

process.stdout.write(`${JSON.stringify({
  schemaVersion: "pw-e2b-template-build-v1",
  templateId: built.templateId,
  templateReference: templateTag ? `${built.templateId}:${templateTag}` : built.templateId,
  buildId: built.buildId,
  name: built.name,
  imageReference,
  privateRegistry: Boolean(registryCredentials),
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
