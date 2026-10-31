import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Cache entries are scoped to the repository and exact revision they came from. */
export function leanSourceCachePath({ cacheDir, repository, revision, path }) {
  const scope = (value, prefix) => `${prefix}${encodeURIComponent(String(value)).replaceAll("%2F", "__")}`;
  return join(
    cacheDir,
    scope(repository, "repo-"),
    scope(revision, "rev-"),
    String(path).replaceAll("/", "__"),
  );
}

/**
 * Create a cached fetcher for Lean source files pinned to one repository
 * revision. Legacy cache entries keyed only by relative path are intentionally
 * ignored, so cached bytes can never outlive the revision they were fetched
 * from.
 */
export function createLeanSourceFetcher({
  cacheDir,
  rawBase,
  repository,
  revision,
  fetchImpl = fetch,
  retryDelayMs = 350,
}) {
  if (!cacheDir || !rawBase || !repository || !revision) {
    throw new Error("Lean source cache requires cacheDir, rawBase, repository, and revision.");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function.");

  return async function fetchText(path) {
    const cachePath = leanSourceCachePath({ cacheDir, repository, revision, path });
    try {
      const info = await stat(cachePath);
      if (info.isFile()) return { status: 200, text: await readFile(cachePath, "utf8"), cached: true };
    } catch {}
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchImpl(rawBase + path, { headers: { "user-agent": "proofweave-proof-map-lean-index" } });
        if (response.status === 404) return { status: 404, text: "", cached: false };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, text);
        return { status: 200, text, cached: false };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    return { status: 0, text: "", error: String(lastError), cached: false };
  };
}
