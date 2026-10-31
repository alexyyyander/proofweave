/**
 * Pure, deterministic text-overlap matching for the public research catalog.
 * This module never reads a database, clock, or network. Its labels describe
 * only textual similarity: "possible_duplicate" is a hygiene prompt, not a
 * finding about novelty or correctness.
 */

const MARK_PATTERN = /\p{Mark}+/gu;
const NON_WORD_PATTERN = /[^\p{Letter}\p{Number}]+/gu;

/**
 * Normalize text for comparison: NFKD, remove combining marks, lowercase,
 * replace punctuation with spaces, and collapse whitespace.
 * @param {unknown} value
 * @returns {string}
 */
export function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(MARK_PATTERN, "")
    .toLowerCase()
    .replace(NON_WORD_PATTERN, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Split normalized text into word tokens. Empty input yields an empty array.
 * @param {unknown} value
 * @returns {string[]}
 */
export function tokenize(value) {
  const normalized = normalize(value);
  return normalized ? normalized.split(" ") : [];
}

/**
 * Jaccard similarity over normalized token sets. Two empty inputs return 0 so
 * missing text is never treated as a duplicate.
 * @param {string | Iterable<string> | null | undefined} left
 * @param {string | Iterable<string> | null | undefined} right
 * @returns {number}
 */
export function jaccard(left, right) {
  const leftTokens = asTokenSet(left);
  const rightTokens = asTokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Rank other public targets by textual similarity to the current target.
 *
 * The score is the stronger of (a) title-to-title Jaccard similarity and
 * (b) Jaccard similarity over the combined title, informal statement, and
 * pinned Lean statement. A score at or above 0.55 becomes a
 * "possible_duplicate" prompt; lower scores that still clear the threshold
 * are "related".
 *
 * @param {{ id?: string, slug?: string, title?: string, informalStatement?: string, leanStatement?: string } | null | undefined} current
 * @param {ReadonlyArray<{ id?: string, slug?: string, title?: string, informalStatement?: string, leanStatement?: string }> | null | undefined} others
 * @param {{ limit?: number, threshold?: number }} [options]
 * @returns {Array<{ slug: string, title: string, score: number, label: "possible_duplicate" | "related" }>}
 */
export function findRelatedTargets(current, others, { limit = 5, threshold = 0.18 } = {}) {
  if (!current || typeof current !== "object" || !Array.isArray(others)) return [];

  const currentSlug = typeof current.slug === "string" ? normalize(current.slug) : "";
  const currentId = typeof current.id === "string" && current.id.length > 0 ? current.id : null;
  const currentTitle = typeof current.title === "string" ? current.title : "";
  const currentText = targetText(current);
  const safeThreshold = Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.18;
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  if (safeLimit === 0) return [];

  const matches = new Map();
  for (const other of others) {
    if (!other || typeof other !== "object") continue;
    if (typeof other.slug !== "string" || other.slug.length === 0) continue;
    if (typeof other.title !== "string" || other.title.length === 0) continue;
    if (currentSlug && normalize(other.slug) === currentSlug) continue;
    if (currentId && other.id === currentId) continue;

    const titleScore = jaccard(currentTitle, other.title);
    const textScore = jaccard(currentText, targetText(other));
    const rawScore = Math.max(titleScore, textScore);
    if (!Number.isFinite(rawScore) || rawScore < safeThreshold) continue;

    const score = Math.round(rawScore * 10000) / 10000;
    const existing = matches.get(other.slug);
    if (existing && existing.score >= score) continue;
    matches.set(other.slug, {
      slug: other.slug,
      title: other.title,
      score,
      label: score >= 0.55 ? "possible_duplicate" : "related",
    });
  }

  return [...matches.values()]
    .sort((left, right) => right.score - left.score
      || left.title.localeCompare(right.title)
      || left.slug.localeCompare(right.slug))
    .slice(0, safeLimit);
}

function asTokenSet(value) {
  if (value === null || value === undefined) return new Set();
  if (typeof value === "string") return new Set(tokenize(value));
  if (typeof value[Symbol.iterator] === "function") {
    const tokens = new Set();
    for (const part of value) {
      for (const token of tokenize(part)) tokens.add(token);
    }
    return tokens;
  }
  return new Set(tokenize(value));
}

function targetText(target) {
  if (!target || typeof target !== "object") return "";
  const parts = [];
  for (const key of ["title", "informalStatement", "leanStatement"]) {
    const value = target[key];
    if (typeof value === "string" && value.length > 0) parts.push(value);
  }
  return parts.join(" ");
}
