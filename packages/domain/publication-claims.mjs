export const PUBLICATION_CLAIMS_SCHEMA_VERSION = "pw-publication-claims-v1";
export const PUBLICATION_CLAIMS_BOUNDARY = "Upstream claim mapped by Proofweave; not a platform replay.";

const LEAN_DECLARATION_STATUSES = new Set(["documented", "partial", "unknown"]);
const COVERAGE_STATUSES = new Set(["documented", "partial", "unmapped", "unknown"]);
const TARGET_STATUSES = new Set(["unmapped", "mapped"]);
const VERIFICATION_STATUSES = new Set(["not_run"]);
const SOURCE_LOCATION_KEYS = ["url", "manuscriptId", "section", "page", "locator"];

// A claims collection is a curated, source-pinned projection. Validation stays
// strict so a malformed or partially edited projection cannot be served as if
// it were a complete per-conclusion record.
export function validatePublicationClaims(collection, options = {}) {
  requireObject(collection, "claims collection");
  if (collection.schemaVersion !== PUBLICATION_CLAIMS_SCHEMA_VERSION) {
    fail(`schemaVersion must be "${PUBLICATION_CLAIMS_SCHEMA_VERSION}"; received ${JSON.stringify(collection.schemaVersion)}`);
  }
  if (collection.boundary !== PUBLICATION_CLAIMS_BOUNDARY) {
    fail(`boundary must be "${PUBLICATION_CLAIMS_BOUNDARY}"; received ${JSON.stringify(collection.boundary)}`);
  }
  if (!Array.isArray(collection.families) || collection.families.length === 0) {
    fail("families must be a non-empty array");
  }

  const sourceFamilies = sourceFamilyIndex(options?.sourceCollection);
  const familyNumbers = new Set();
  const claimIds = new Set();

  for (const [familyIndex, family] of collection.families.entries()) {
    const familyLabel = `families[${familyIndex}]`;
    requireObject(family, familyLabel);
    if (typeof family.familyNumber !== "string" || !/^\d{3}$/.test(family.familyNumber)) {
      fail(`${familyLabel}.familyNumber must be a three-digit string`);
    }
    if (familyNumbers.has(family.familyNumber)) {
      fail(`duplicate family number "${family.familyNumber}"`);
    }
    familyNumbers.add(family.familyNumber);
    requireNonEmptyString(family.familyTitle, `${familyLabel}.familyTitle`);
    if (!Array.isArray(family.claims) || family.claims.length === 0) {
      fail(`family ${family.familyNumber} must contain at least one claim`);
    }

    const sourceFamily = sourceFamilies?.get(family.familyNumber);
    if (sourceFamilies && !sourceFamily) {
      fail(`family ${family.familyNumber} does not exist in the source collection`);
    }
    if (sourceFamily && family.familyTitle !== sourceFamily.title) {
      fail(`family ${family.familyNumber} title does not match the source collection`);
    }
    const manuscriptIds = sourceFamily
      ? new Set(sourceFamily.manuscripts.map((manuscript) => manuscript.id))
      : undefined;

    for (const [claimIndex, claim] of family.claims.entries()) {
      validateClaim(claim, {
        label: `family ${family.familyNumber} claims[${claimIndex}]`,
        claimIds,
        familyNumber: family.familyNumber,
        manuscriptIds,
      });
    }
  }

  return collection;
}

export function lookupClaimsByFamily(collection, number) {
  if (!collection || !Array.isArray(collection.families)) return undefined;
  const familyNumber = typeof number === "number" ? String(number).padStart(3, "0") : String(number ?? "");
  if (!/^\d{3}$/.test(familyNumber)) return undefined;
  return collection.families.find((family) => family?.familyNumber === familyNumber);
}

function sourceFamilyIndex(sourceCollection) {
  if (sourceCollection === undefined) return undefined;
  requireObject(sourceCollection, "source collection");
  if (!Array.isArray(sourceCollection.families)) fail("source collection families must be an array");
  return new Map(sourceCollection.families.map((family) => [family.number, family]));
}

function validateClaim(claim, context) {
  requireObject(claim, context.label);
  const id = requireNonEmptyString(claim.id, `${context.label}.id`);
  if (context.claimIds.has(id)) fail(`duplicate claim id "${id}"`);
  context.claimIds.add(id);

  requireNonEmptyString(claim.statement, `claim "${id}" statement`);
  requireStringArray(claim.assumptions, `claim "${id}" assumptions`);
  requireNonEmptyString(claim.conclusion, `claim "${id}" conclusion`);
  requireStringArray(claim.sourceManuscriptIds, `claim "${id}" sourceManuscriptIds`);
  if (context.manuscriptIds) {
    for (const manuscriptId of claim.sourceManuscriptIds) {
      if (!context.manuscriptIds.has(manuscriptId)) {
        fail(`claim "${id}" references manuscript "${manuscriptId}" that does not exist in family ${context.familyNumber}`);
      }
    }
  }
  validateSourceLocation(claim.sourceLocation, `claim "${id}" sourceLocation`);
  validateLeanDeclaration(claim.leanDeclaration, `claim "${id}" leanDeclaration`);
  validateCoverage(claim.coverage, `claim "${id}" coverage`);
  validateTarget(claim.target, `claim "${id}" target`);
  validateVerification(claim.verification, `claim "${id}" verification`);
}

function validateSourceLocation(value, label) {
  if (value === "unknown") return;
  requireObject(value, label);
  const locator = SOURCE_LOCATION_KEYS.find((key) => value[key] !== undefined);
  if (!locator) fail(`${label} must be "unknown" or include a source locator`);
  for (const key of SOURCE_LOCATION_KEYS) {
    if (value[key] !== undefined) requireNonEmptyString(value[key], `${label}.${key}`);
  }
}

function validateLeanDeclaration(value, label) {
  requireObject(value, label);
  requireEnum(value.status, LEAN_DECLARATION_STATUSES, `${label}.status`);
  for (const key of ["name", "file", "statement"]) {
    if (value[key] !== undefined) requireNonEmptyString(value[key], `${label}.${key}`);
  }
  if (value.status === "documented" && value.name === undefined && value.file === undefined) {
    fail(`${label} with documented status must identify a declaration name or file`);
  }
}

function validateCoverage(value, label) {
  requireObject(value, label);
  requireEnum(value.status, COVERAGE_STATUSES, `${label}.status`);
  requireNonEmptyString(value.note, `${label}.note`);
  if (value.scopeExcerpt !== undefined) requireNonEmptyString(value.scopeExcerpt, `${label}.scopeExcerpt`);
}

function validateTarget(value, label) {
  requireObject(value, label);
  requireEnum(value.status, TARGET_STATUSES, `${label}.status`);
  if (value.status === "mapped") {
    requireNonEmptyString(value.problemSlug, `${label}.problemSlug`);
  } else if (value.problemSlug !== undefined) {
    fail(`${label}.problemSlug is only valid for a mapped target`);
  }
}

function validateVerification(value, label) {
  requireObject(value, label);
  requireEnum(value.status, VERIFICATION_STATUSES, `${label}.status`);
  requireNonEmptyString(value.note, `${label}.note`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  for (const entry of value) requireNonEmptyString(entry, `${label} entries`);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicate entries`);
  return value;
}

function requireEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    fail(`${label} must be one of ${[...allowed].join(", ")}; received ${JSON.stringify(value)}`);
  }
  return value;
}

function fail(message) {
  throw new Error(`Invalid publication claims: ${message}`);
}
