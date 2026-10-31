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

export const LEAN_COVERAGE_SCHEMA_VERSION = "pw-lean-coverage-v1";

function validateHttps(value, label) {
  if (typeof value !== "string" || !/^https:\/\//.test(value)) fail(`${label} must be an https URL`);
}

export function validateLeanCoverage(data, collection) {
  if (!isObject(data)) fail("leanCoverage must be an object");
  if (data.schemaVersion !== LEAN_COVERAGE_SCHEMA_VERSION) fail(`leanCoverage.schemaVersion must be ${LEAN_COVERAGE_SCHEMA_VERSION}`);
  if (data.status !== "draft") fail('leanCoverage.status must be "draft"');
  if (data.reviewStatus !== "unreviewed") fail('leanCoverage.reviewStatus must be "unreviewed"');
  if (typeof data.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.generatedAt)) fail("leanCoverage.generatedAt must be YYYY-MM-DD");
  if (typeof data.commit !== "string" || data.commit.length < 8) fail("leanCoverage.commit must be a pinned revision");
  if (data.commit !== collection.source?.revision) fail("leanCoverage.commit must match the catalog source revision");
  if (typeof data.sourceNote !== "string" || data.sourceNote.trim() === "") fail("leanCoverage.sourceNote must not be empty");
  if (!isObject(collection) || !Array.isArray(collection.families)) fail("collection must contain families");

  if (!isObject(data.summary)) fail("leanCoverage.summary must be an object");
  for (const field of ["familiesWithComparators", "comparatorLinks", "jsonFetched", "challengeFetched", "solutionFetched", "solutionMissing", "theoremNames", "textualSorry", "textualAxioms"]) {
    if (!Number.isInteger(data.summary[field]) || data.summary[field] < 0) fail(`leanCoverage.summary.${field} must be a non-negative integer`);
  }

  const families = Array.isArray(data.families) ? data.families : fail("leanCoverage.families must be an array");
  const familyNumbers = new Set();
  const comparatorUrls = new Set();
  const allComparators = [];
  for (const [index, family] of families.entries()) {
    const label = `leanCoverage.families[${index}]`;
    if (!isObject(family)) fail(`${label} must be an object`);
    if (!isFamilyNumber(family.familyNumber)) fail(`${label}.familyNumber must be three digits`);
    if (familyNumbers.has(family.familyNumber)) fail(`duplicate leanCoverage family ${family.familyNumber}`);
    familyNumbers.add(family.familyNumber);
    if (!Array.isArray(family.comparators) || family.comparators.length === 0) fail(`${label}.comparators must not be empty`);
    if (family.comparatorCount !== family.comparators.length) fail(`${label}.comparatorCount must match comparators.length`);
    if (!Number.isInteger(family.solutionFetched) || !Number.isInteger(family.jsonFetched) || !Number.isInteger(family.challengeFetched) || !Number.isInteger(family.solutionMissing)) fail(`${label} counts must be integers`);
    if (family.solutionFetched + family.solutionMissing !== family.comparatorCount) fail(`${label} solution counts do not sum to comparatorCount`);
    if (!["extracted", "partial", "missing"].includes(family.leanStructureStatus)) fail(`${label}.leanStructureStatus is invalid`);
    const expectedStatus = family.solutionFetched === family.comparatorCount ? "extracted" : family.solutionFetched > 0 ? "partial" : "missing";
    if (family.leanStructureStatus !== expectedStatus) fail(`${label}.leanStructureStatus does not match solutionFetched`);
    for (const [cIndex, comparator] of family.comparators.entries()) {
      const cLabel = `${label}.comparators[${cIndex}]`;
      if (!isObject(comparator)) fail(`${cLabel} must be an object`);
      if (comparator.familyNumber !== family.familyNumber) fail(`${cLabel}.familyNumber mismatch`);
      if (typeof comparator.label !== "string" || comparator.label.trim() === "") fail(`${cLabel}.label must not be empty`);
      validateHttps(comparator.challengeUrl, `${cLabel}.challengeUrl`);
      validateHttps(comparator.jsonUrl, `${cLabel}.jsonUrl`);
      if (comparator.solutionUrl !== null) validateHttps(comparator.solutionUrl, `${cLabel}.solutionUrl`);
      if (!Array.isArray(comparator.theoremNames)) fail(`${cLabel}.theoremNames must be an array`);
      for (const theorem of comparator.theoremNames) if (typeof theorem !== "string" || theorem.trim() === "") fail(`${cLabel}.theoremNames contains an empty name`);
      if (!Array.isArray(comparator.permittedAxioms)) fail(`${cLabel}.permittedAxioms must be an array`);
      if (!Array.isArray(comparator.solutionImports)) fail(`${cLabel}.solutionImports must be an array`);
      for (const imported of comparator.solutionImports) if (typeof imported !== "string" || imported.trim() === "") fail(`${cLabel}.solutionImports contains an empty module`);
      if (!Number.isInteger(comparator.solutionStatus) || comparator.solutionStatus < 0) fail(`${cLabel}.solutionStatus must be a non-negative integer`);
      if (!Number.isInteger(comparator.solutionSorry) || comparator.solutionSorry < 0) fail(`${cLabel}.solutionSorry must be a non-negative integer`);
      if (!Number.isInteger(comparator.solutionAxioms) || comparator.solutionAxioms < 0) fail(`${cLabel}.solutionAxioms must be a non-negative integer`);
      if (comparator.solutionStatus === 200) {
        if (typeof comparator.solutionModule !== "string" || comparator.solutionModule.trim() === "") fail(`${cLabel}.solutionModule is required when fetched`);
        if (typeof comparator.solutionPath !== "string" || comparator.solutionPath.trim() === "") fail(`${cLabel}.solutionPath is required when fetched`);
        validateHttps(comparator.solutionUrl, `${cLabel}.solutionUrl`);
      }
      allComparators.push(comparator);
      comparatorUrls.add(comparator.challengeUrl);
    }
  }

  const expectedFamilies = collection.families.filter((family) => (family.scope?.comparatorLinks?.length ?? 0) > 0);
  if (families.length !== expectedFamilies.length) fail(`leanCoverage must contain ${expectedFamilies.length} comparator families, found ${families.length}`);
  for (const family of expectedFamilies) {
    if (!familyNumbers.has(family.number)) fail(`leanCoverage is missing comparator family ${family.number}`);
    for (const link of family.scope.comparatorLinks) {
      if (!comparatorUrls.has(link.url)) fail(`leanCoverage is missing comparator ${link.url}`);
    }
  }

  const recomputed = {
    familiesWithComparators: families.length,
    comparatorLinks: allComparators.length,
    jsonFetched: allComparators.filter((entry) => entry.jsonStatus === 200).length,
    challengeFetched: allComparators.filter((entry) => entry.challengeStatus === 200).length,
    solutionFetched: allComparators.filter((entry) => entry.solutionStatus === 200).length,
    solutionMissing: allComparators.filter((entry) => entry.solutionStatus !== 200).length,
    theoremNames: new Set(allComparators.flatMap((entry) => entry.theoremNames)).size,
    textualSorry: allComparators.reduce((total, entry) => total + entry.solutionSorry, 0),
    textualAxioms: allComparators.reduce((total, entry) => total + entry.solutionAxioms, 0),
  };
  for (const [field, value] of Object.entries(recomputed)) {
    if (data.summary[field] !== value) fail(`leanCoverage.summary.${field} should be ${value}`);
  }
  return data;
}

/**
 * @param {any} collection
 * @param {any} manifest
 * @param {any} [leanCoverage]
 * @returns {any}
 */
export function buildProofMapIndex(collection, manifest, leanCoverage = null) {
  validateProofMapManifest(manifest, collection);
  if (leanCoverage) validateLeanCoverage(leanCoverage, collection);
  const leanByFamily = new Map((leanCoverage?.families ?? []).map((family) => [family.familyNumber, family]));
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
    const leanFamily = leanByFamily.get(family.number);
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
      lean: leanFamily ? {
        comparators: leanFamily.comparatorCount,
        solutions: leanFamily.solutionFetched,
        theoremNames: leanFamily.theoremNames.length,
        status: leanFamily.leanStructureStatus,
        textualSorry: leanFamily.textualSorry,
        textualAxioms: leanFamily.textualAxioms,
      } : { comparators: 0, solutions: 0, theoremNames: 0, status: "none", textualSorry: 0, textualAxioms: 0 },
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
    leanFamilies: entries.filter((entry) => entry.lean.status === "extracted" || entry.lean.status === "partial").length,
    leanSolutionModules: entries.reduce((total, entry) => total + entry.lean.solutions, 0),
    leanTheoremNames: entries.reduce((total, entry) => total + entry.lean.theoremNames, 0),
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
