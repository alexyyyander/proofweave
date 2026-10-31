export const PROOF_MAP_MANIFEST_SCHEMA_VERSION = "pw-proof-map-manifest-v1";
export const PROOF_MAP_INDEX_SCHEMA_VERSION = "pw-proof-map-index-v1";
export const PROOF_MAP_STATUSES = ["deep", "draft", "scaffold"];

function fail(message) {
  throw new Error(`Proof map index: ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFamilyNumber(value) {
  return typeof value === "string" && /^\d{3}$/.test(value);
}

function isRoute(value) {
  return typeof value === "string" && /^\/proof-evolution\/[a-z0-9/_-]+$/i.test(value);
}

/** Store a compact, searchable plain-text version of source prose. */
export function publicationPlainText(value) {
  return String(value ?? "")
    .replace(/\$`([\s\S]*?)`\$/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#]/g, "")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(value, length = 240) {
  const text = publicationPlainText(value);
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  return `${cut.replace(/\s+\S*$/, "")}…`;
}

export function validateProofMapManifest(manifest, collection) {
  if (!isObject(manifest)) fail("manifest must be an object");
  if (manifest.schemaVersion !== PROOF_MAP_MANIFEST_SCHEMA_VERSION) fail(`manifest.schemaVersion must be ${PROOF_MAP_MANIFEST_SCHEMA_VERSION}`);
  if (!Array.isArray(manifest.deep)) fail("manifest.deep must be an array");
  if (!Array.isArray(manifest.draft)) fail("manifest.draft must be an array");
  if (!Array.isArray(manifest.stages)) fail("manifest.stages must be an array");
  if (!isObject(collection) || !Array.isArray(collection.families)) fail("collection must contain families");

  const familyNumbers = new Set(collection.families.map((family) => family.number));
  const seen = new Set();
  const routes = new Set();
  for (const [status, entries] of [["deep", manifest.deep], ["draft", manifest.draft]]) {
    for (const [index, entry] of entries.entries()) {
      const label = `manifest.${status}[${index}]`;
      if (!isObject(entry)) fail(`${label} must be an object`);
      if (!isFamilyNumber(entry.familyNumber)) fail(`${label}.familyNumber must be three digits`);
      if (!familyNumbers.has(entry.familyNumber)) fail(`${label}.familyNumber references unknown family ${entry.familyNumber}`);
      if (seen.has(entry.familyNumber)) fail(`family ${entry.familyNumber} appears in more than one curated status`);
      seen.add(entry.familyNumber);
      if (!isRoute(entry.route)) fail(`${label}.route must be a /proof-evolution/... route`);
      if (routes.has(entry.route)) fail(`duplicate proof-map route ${entry.route}`);
      routes.add(entry.route);
      if (typeof entry.label !== "string" || entry.label.trim() === "") fail(`${label}.label must be a non-empty string`);
    }
  }

  const stageIds = new Set();
  for (const [index, stage] of manifest.stages.entries()) {
    const label = `manifest.stages[${index}]`;
    if (!isObject(stage)) fail(`${label} must be an object`);
    if (typeof stage.id !== "string" || !PROOF_MAP_STATUSES.includes(stage.id)) fail(`${label}.id must be one of ${PROOF_MAP_STATUSES.join(", ")}`);
    if (stageIds.has(stage.id)) fail(`duplicate proof-map stage ${stage.id}`);
    stageIds.add(stage.id);
    if (typeof stage.label !== "string" || stage.label.trim() === "") fail(`${label}.label must be a non-empty string`);
    if (typeof stage.description !== "string" || stage.description.trim() === "") fail(`${label}.description must be a non-empty string`);
  }
  return manifest;
}

function nextStepFor(status) {
  if (status === "deep") return "Extend version coverage, Lean declaration alignment, and independent review.";
  if (status === "draft") return "Promote the draft chain to a theorem-level argument map; verify dependencies and add Lean alignment.";
  return "Extract theorem/lemma statements, build the argument map, align Lean declarations, then open independent review.";
}

export function buildProofMapIndex(collection, manifest) {
  validateProofMapManifest(manifest, collection);
  const deep = new Map(manifest.deep.map((entry) => [entry.familyNumber, entry]));
  const draft = new Map(manifest.draft.map((entry) => [entry.familyNumber, entry]));
  const stageLabels = new Map(manifest.stages.map((stage) => [stage.id, stage.label]));

  const entries = collection.families.map((family) => {
    const deepEntry = deep.get(family.number);
    const draftEntry = draft.get(family.number);
    const status = deepEntry ? "deep" : draftEntry ? "draft" : "scaffold";
    const curated = deepEntry ?? draftEntry;
    const claimText = publicationPlainText(family.claim);
    const titleText = publicationPlainText(family.title);
    const scopeDocument = Boolean(family.scope);
    const comparatorCount = family.scope?.comparatorLinks?.length ?? 0;
    const formalizedManuscripts = family.manuscripts.filter((manuscript) => manuscript.citedByScopeDocument || manuscript.listedInFormalizationIndex).length;
    const manuscriptCount = family.manuscripts.length;
    return {
      familyNumber: family.number,
      title: titleText,
      subject: family.subject,
      claimSnippet: snippet(family.claim),
      manuscriptCount,
      scopeDocument,
      comparatorCount,
      formalizedManuscripts,
      status,
      statusLabel: stageLabels.get(status) ?? status,
      reviewStatus: status === "scaffold" ? "not_started" : "unreviewed",
      proofweaveReplay: "not_run",
      route: curated?.route ?? `/proof-evolution/openai-math/${family.number}`,
      publicationRoute: `/publications/openai-math/${family.number}`,
      manifestLabel: curated?.label ?? null,
      nextStep: nextStepFor(status),
      searchText: `${family.number} ${titleText} ${claimText} ${family.subject}`.toLowerCase(),
    };
  });

  const statusCounts = Object.fromEntries(PROOF_MAP_STATUSES.map((status) => [status, entries.filter((entry) => entry.status === status).length]));
  const summary = {
    families: entries.length,
    manuscripts: entries.reduce((total, entry) => total + entry.manuscriptCount, 0),
    subjects: collection.subjects?.length ?? new Set(entries.map((entry) => entry.subject)).size,
    scopeDocuments: collection.statistics?.scopeDocuments ?? entries.filter((entry) => entry.scopeDocument).length,
    scopeFamilies: entries.filter((entry) => entry.scopeDocument).length,
    comparatorLinks: entries.reduce((total, entry) => total + entry.comparatorCount, 0),
    formalizedManuscripts: entries.reduce((total, entry) => total + entry.formalizedManuscripts, 0),
    deep: statusCounts.deep,
    draft: statusCounts.draft,
    scaffold: statusCounts.scaffold,
    proofweaveReplays: 0,
  };

  return {
    schemaVersion: PROOF_MAP_INDEX_SCHEMA_VERSION,
    status: "draft",
    generatedFrom: {
      collection: collection.id,
      releaseDate: collection.releaseDate,
      indexedAt: collection.indexedAt,
      revision: collection.source?.revision ?? null,
    },
    summary,
    statusCounts,
    subjects: (collection.subjects ?? []).map((subject) => ({
      name: subject.name,
      families: subject.families,
      deep: entries.filter((entry) => entry.subject === subject.name && entry.status === "deep").length,
      draft: entries.filter((entry) => entry.subject === subject.name && entry.status === "draft").length,
      scaffold: entries.filter((entry) => entry.subject === subject.name && entry.status === "scaffold").length,
    })),
    entries,
  };
}
