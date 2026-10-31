// Minimum fixed releases from the October 2026 runtime and dependency advisories.
const nodeFloors = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
const rscFloors = { 0: [19, 0, 9], 1: [19, 1, 10], 2: [19, 2, 9], 3: [19, 3, 1] };
const dependencyFloors = {
  "body-parser": { 1: [1, 20, 9], 2: [2, 4, 0] },
  undici: { 6: [6, 29, 1], 7: [7, 30, 1], 8: [8, 12, 2] },
  zod: { 4: [4, 6, 6] },
};
const rscNames = new Set(["react-server-dom-webpack", "react-server-dom-turbopack", "react-server-dom-parcel"]);
function atLeast(actual, minimum) {
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  }
  return true;
}
export function assertSecurityVersion(name, version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? "");
  const parts = match?.slice(1).map(Number);
  let minimum;
  if (parts) {
    if (name === "node") minimum = nodeFloors[parts[0]];
    else if (name === "next") minimum = { 15: [15, 5, 28], 16: [16, 4, 1] }[parts[0]];
    else if (rscNames.has(name) && parts[0] === 19) minimum = rscFloors[parts[1]];
    else if (name === "sharp" && parts[0] === 0) minimum = [0, 35, 5];
    else minimum = dependencyFloors[name]?.[parts[0]];
  }
  if (!minimum || !atLeast(parts, minimum)) throw new Error(`Security baseline rejected ${name}@${version}`);
}
export function checkSecurityLockfile(lock) {
  if (!lock?.packages || lock.lockfileVersion !== 3) throw new Error("Security baseline requires a complete v3 lockfile");
  for (const [path, entry] of Object.entries(lock.packages)) {
    const name = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path)?.[1];
    if (!name) continue;
    // npm aliases retain their actual package name in lockfile entries. Inspect
    // both names so optional/dev-labelled or nested aliases cannot hide a floor.
    for (const candidate of new Set([name === "undici8" ? "undici" : name, entry.name])) {
      if (candidate === "next" || candidate === "sharp" || rscNames.has(candidate) || Object.hasOwn(dependencyFloors, candidate)) {
        assertSecurityVersion(candidate, entry.version);
      }
    }
  }
}
