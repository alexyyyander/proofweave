import { stripLocalePrefix } from "./config";
import type { Dictionary } from "./translate";

/**
 * Client components receive a filtered dictionary. Server-only copy must not
 * leak into the RSC payload, and absence checks in rendered-html tests rely on
 * that separation. Add a prefix here when a new client component starts using
 * a namespace, and to the matching route group below.
 */
export const clientDictionaryPrefixes = [
  "agentConnections.",
  "attemptPresentation.",
  "common.breadcrumb",
  "connect.",
  "controlPlane.",
  "delegationSetup.",
  "delegationSummary.",
  "demo.",
  "event.",
  "explore.",
  "firstPath.",
  "focus.",
  "gate.",
  "handoff.",
  "history.timeline.",
  "integrations.",
  "journey.",
  "leanGate.",
  "ledger.",
  "localAgent.",
  "marketBoard.",
  "myWork.",
  "proofMaps.",
  "propose.",
  "publicationDetail.copy.",
  "receiptVerify.",
  "researchCard.",
  "researchLauncher.",
  "review.",
  "reviewCard.",
  "reviewQueue.",
  "reviewWorkspace.",
  "runnerWorkflow.",
  "settingsPrompt.",
  "showcase.",
  "sourceDiff.",
  "submission.",
  "window.",
  "workbenchClient.",
  "workbenchHero.",
  "workspace.chooseResearch",
  "workspace.nav",
  "workspacePath.",
  "workspaceShell.",
  "workstation.",
] as const;

/** Copy every page's client components may need, whatever the route. */
export const clientDictionaryCorePrefixes = ["common."] as const;

/**
 * Route sections get only the namespaces their client components use, so the
 * public pages no longer ship the workbench's ~900 strings. An unknown section
 * falls back to the core set; the rendered tests assert each listed section.
 */
export const clientDictionaryGroups: Readonly<Record<string, readonly string[]>> = {
  "": ["demo.", "showcase."],
  connect: ["connect.", "controlPlane.", "journey."],
  demo: ["demo."],
  evidence: ["handoff.", "sourceDiff.", "workspace.nav"],
  explore: ["explore.", "researchCard."],
  history: ["history.timeline."],
  integrations: ["integrations."],
  profile: ["workspace.nav"],
  "proof-evolution": ["proofMaps."],
  propose: ["propose."],
  publications: ["publicationDetail.copy."],
  receipt: ["receiptVerify."],
  reviews: ["marketBoard.", "review.", "reviewCard.", "reviewQueue.", "reviewWorkspace.", "workspace.nav"],
  settings: ["agentConnections.", "controlPlane.", "delegationSetup.", "journey.", "workspace.nav"],
  workbench: [
    "attemptPresentation.",
    "common.breadcrumb",
    "controlPlane.",
    "delegationSummary.",
    "event.",
    "explore.",
    "firstPath.",
    "focus.",
    "gate.",
    "journey.",
    "leanGate.",
    "ledger.",
    "localAgent.",
    "myWork.",
    "researchLauncher.",
    "runnerWorkflow.",
    "settingsPrompt.",
    "submission.",
    "window.",
    "workbenchClient.",
    "workspace.chooseResearch",
    "workspace.nav",
    "workspaceShell.",
    "workstation.",
  ],
};

const filteredDictionaries = new WeakMap<Dictionary, Map<string, Dictionary>>();

function filterDictionary(
  dictionary: Dictionary,
  cacheKey: string,
  prefixes: readonly string[],
): Dictionary {
  let cache = filteredDictionaries.get(dictionary);
  if (!cache) {
    cache = new Map();
    filteredDictionaries.set(dictionary, cache);
  }
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const filtered = Object.fromEntries(
    Object.entries(dictionary).filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix))),
  ) as Dictionary;
  cache.set(cacheKey, filtered);
  return filtered;
}

export function clientDictionary(dictionary: Dictionary): Dictionary {
  return filterDictionary(dictionary, "all", clientDictionaryPrefixes);
}

export function clientDictionaryCore(dictionary: Dictionary): Dictionary {
  return filterDictionary(dictionary, "core", clientDictionaryCorePrefixes);
}

export function clientDictionaryForPath(dictionary: Dictionary, pathname: string): Dictionary {
  const section = stripLocalePrefix(pathname).split("/").filter(Boolean)[0] ?? "";
  const prefixes = clientDictionaryGroups[section] ?? clientDictionaryCorePrefixes;
  return filterDictionary(dictionary, `path:${section}`, prefixes);
}
