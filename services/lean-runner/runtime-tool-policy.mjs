import { existsSync } from "node:fs";
import { join } from "node:path";

export function assertSupportedExecutionDistro(osRelease) {
  if (!/^ID="?rocky"?$/m.test(osRelease) || !/^VERSION_ID="?9(?:[.][0-9]+)?"?$/m.test(osRelease)) {
    throw new Error("E2B execution image requires the reviewed Rocky 9 userland.");
  }
}

export function assertMinimalRuntimeTools(searchPath, exists = existsSync) {
  const directories = typeof searchPath === "string" ? searchPath.split(":").filter(Boolean) : [];
  if (!directories.length) throw new Error("Runner runtime PATH must be explicit.");
  // curl is an RPM dependency in Rocky; it remains visible to the full scan.
  const forbidden = ["npm", "npx", "yarn", "yarnpkg", "gcc", "g++", "make", "wget"];
  const present = forbidden.filter(name => directories.some(directory => exists(join(directory, name))));
  if (present.length) throw new Error(`Unexpected build tools in Runner runtime: ${present.join(", ")}.`);
}
