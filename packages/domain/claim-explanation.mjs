/**
 * Draft explanation artifacts for publication result families.
 *
 * An explanation describes a family's assumptions, conclusion, explicit
 * non-claims, scope gap, proof outline, Lean annotations, glossary, and
 * sources. Every artifact is a draft until a person reviews it. This module
 * validates shape and honesty guardrails only; it never upgrades an
 * explanation, a manuscript, or a Lean excerpt to a platform verification.
 */

export const CLAIM_EXPLANATION_SCHEMA_VERSION = "pw-claim-explanation-v1";

export const claimExplanationLevels = Object.freeze(["plain", "undergraduate", "expert"]);

const leanStatementStatuses = Object.freeze(["recorded", "unknown", "not_in_snapshot"]);

export class ClaimExplanationValidationError extends Error {
  constructor(problems) {
    super(`Invalid claim explanation: ${problems.join(" ")}`);
    this.name = "ClaimExplanationValidationError";
    this.problems = Object.freeze([...problems]);
  }
}

/**
 * Validate one explanation artifact and return it unchanged when valid.
 *
 * Missing notProven, an unknown level, or an empty sources list is rejected.
 * Any status other than "draft" is rejected so an unreviewed artifact cannot
 * present itself as reviewed. The function is pure: it fills no defaults,
 * mutates no input, and stamps no review state.
 */
export function validateClaimExplanation(value) {
  if (!isRecord(value)) throw new ClaimExplanationValidationError(["The explanation must be a JSON object."]);
  const problems = [];

  if (value.schemaVersion !== CLAIM_EXPLANATION_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be "${CLAIM_EXPLANATION_SCHEMA_VERSION}".`);
  }
  if (typeof value.familyNumber !== "string" || !/^\d{3}$/.test(value.familyNumber)) {
    problems.push("familyNumber must be a three-digit string.");
  }
  if (!claimExplanationLevels.includes(value.level)) {
    problems.push(`level must be one of ${claimExplanationLevels.join(", ")}.`);
  }
  if (value.status !== "draft") {
    problems.push('status must be "draft"; an unreviewed explanation cannot claim another status.');
  }
  if (value.reviewStatus !== undefined && value.reviewStatus !== "unreviewed") {
    problems.push('reviewStatus must be "unreviewed" when present.');
  }
  if (value.sourceRevision !== undefined && !isSha1(value.sourceRevision)) {
    problems.push("sourceRevision must be a 40-character lowercase hex revision when present.");
  }

  checkOptionalString(value.title, "title", problems);
  checkStringArray(value.assumptions, "assumptions", problems);
  checkNonEmptyString(value.conclusion, "conclusion", problems);
  checkStringArray(value.notProven, "notProven", problems,
    "notProven is required and must list what the explanation does not prove.");
  checkNonEmptyString(value.scopeNote, "scopeNote", problems);
  checkScopeDiff(value.scopeDiff, problems);
  checkProofSteps(value.proofSteps, problems);
  checkLeanAnnotations(value.leanAnnotations, problems);
  checkGlossary(value.glossary, problems);
  checkSources(value.sources, problems);

  if (problems.length > 0) throw new ClaimExplanationValidationError(problems);
  return value;
}

function checkScopeDiff(value, problems) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    problems.push("scopeDiff must be an object when present.");
    return;
  }
  checkNonEmptyString(value.paperStatement, "scopeDiff.paperStatement", problems);
  if (value.leanStatement !== null) checkNonEmptyString(value.leanStatement, "scopeDiff.leanStatement", problems);
  if (!leanStatementStatuses.includes(value.leanStatementStatus)) {
    problems.push(`scopeDiff.leanStatementStatus must be one of ${leanStatementStatuses.join(", ")}.`);
  }
  checkNonEmptyString(value.platformStatus, "scopeDiff.platformStatus", problems);
  checkOptionalString(value.gapNote, "scopeDiff.gapNote", problems);
  if (typeof value.needsReview !== "boolean") {
    problems.push("scopeDiff.needsReview must be a boolean.");
  } else if (value.leanStatement === null && value.needsReview !== true) {
    problems.push("scopeDiff without a Lean statement must be marked needsReview: true.");
  }
}

function checkProofSteps(value, problems) {
  if (value === undefined) {
    problems.push("proofSteps is required and must be an array.");
    return;
  }
  if (!Array.isArray(value)) {
    problems.push("proofSteps must be an array.");
    return;
  }
  const ids = new Set();
  const dependencies = [];
  value.forEach((step, index) => {
    const path = `proofSteps[${index}]`;
    if (!isRecord(step)) {
      problems.push(`${path} must be an object.`);
      return;
    }
    if (typeof step.id !== "string" || step.id.trim() === "") {
      problems.push(`${path}.id must be a non-empty string.`);
    } else if (ids.has(step.id)) {
      problems.push(`${path}.id must be unique.`);
    } else {
      ids.add(step.id);
    }
    checkNonEmptyString(step.label, `${path}.label`, problems);
    checkNonEmptyString(step.detail, `${path}.detail`, problems);
    checkOptionalString(step.basis, `${path}.basis`, problems);
    if (step.needsReview !== undefined && typeof step.needsReview !== "boolean") {
      problems.push(`${path}.needsReview must be a boolean when present.`);
    }
    if (step.dependsOn !== undefined) {
      if (!Array.isArray(step.dependsOn)) {
        problems.push(`${path}.dependsOn must be an array when present.`);
      } else {
        for (const dependency of step.dependsOn) {
          if (typeof dependency !== "string" || dependency.trim() === "") {
            problems.push(`${path}.dependsOn entries must be non-empty strings.`);
            continue;
          }
          if (dependency === step.id) problems.push(`${path}.dependsOn must not reference itself.`);
          dependencies.push({ path, id: dependency });
        }
      }
    }
  });
  // Report dangling edges after all ids are known so forward references work.
  for (const { path, id } of dependencies) {
    if (!ids.has(id)) problems.push(`${path}.dependsOn references unknown step id "${id}".`);
  }
}

function checkLeanAnnotations(value, problems) {
  if (value === undefined) {
    problems.push("leanAnnotations is required and must be an array.");
    return;
  }
  if (!Array.isArray(value)) {
    problems.push("leanAnnotations must be an array.");
    return;
  }
  const ids = new Set();
  value.forEach((annotation, index) => {
    const path = `leanAnnotations[${index}]`;
    if (!isRecord(annotation)) {
      problems.push(`${path} must be an object.`);
      return;
    }
    if (typeof annotation.id !== "string" || annotation.id.trim() === "") {
      problems.push(`${path}.id must be a non-empty string.`);
    } else if (ids.has(annotation.id)) {
      problems.push(`${path}.id must be unique.`);
    } else {
      ids.add(annotation.id);
    }
    checkNullableString(annotation.file, `${path}.file`, problems);
    checkNullableString(annotation.url, `${path}.url`, problems, true);
    const hasExcerpt = annotation.excerpt !== undefined && annotation.excerpt !== null;
    if (hasExcerpt) checkNonEmptyString(annotation.excerpt, `${path}.excerpt`, problems);
    if (annotation.needsReview !== undefined && typeof annotation.needsReview !== "boolean") {
      problems.push(`${path}.needsReview must be a boolean when present.`);
    }
    if (!hasExcerpt && annotation.needsReview !== true) {
      problems.push(`${path} without a Lean excerpt must be marked needsReview: true.`);
    }
    checkNonEmptyString(annotation.annotation, `${path}.annotation`, problems);
  });
}

function checkGlossary(value, problems) {
  if (value === undefined) {
    problems.push("glossary is required and must be an array.");
    return;
  }
  if (!Array.isArray(value)) {
    problems.push("glossary must be an array.");
    return;
  }
  value.forEach((entry, index) => {
    const path = `glossary[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${path} must be an object.`);
      return;
    }
    checkNonEmptyString(entry.term, `${path}.term`, problems);
    checkNonEmptyString(entry.definition, `${path}.definition`, problems);
  });
}

function checkSources(value, problems) {
  if (value === undefined) {
    problems.push("sources is required and must not be empty.");
    return;
  }
  if (!Array.isArray(value)) {
    problems.push("sources must be an array.");
    return;
  }
  if (value.length === 0) problems.push("sources must not be empty.");
  value.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!isRecord(source)) {
      problems.push(`${path} must be an object.`);
      return;
    }
    checkNonEmptyString(source.label, `${path}.label`, problems);
    if (typeof source.url !== "string" || !isHttpUrl(source.url)) {
      problems.push(`${path}.url must be an absolute http(s) URL.`);
    }
    checkOptionalString(source.kind, `${path}.kind`, problems);
  });
}

function checkStringArray(value, label, problems, requiredMessage) {
  if (value === undefined) {
    problems.push(requiredMessage ?? `${label} is required and must be an array.`);
    return;
  }
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array.`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      problems.push(`${label}[${index}] must be a non-empty string.`);
    }
  });
}

function checkNonEmptyString(value, label, problems) {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${label} must be a non-empty string.`);
  }
}

function checkOptionalString(value, label, problems) {
  if (value === undefined) return;
  checkNonEmptyString(value, label, problems);
}

function checkNullableString(value, label, problems, requireHttpUrl = false) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${label} must be a non-empty string or null.`);
    return;
  }
  if (requireHttpUrl && !isHttpUrl(value)) {
    problems.push(`${label} must be an absolute http(s) URL.`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha1(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
