import { readFile } from "node:fs/promises";
import { assertSecurityVersion, checkSecurityLockfile } from "./lib/security-baseline.mjs";
const root = new URL("../", import.meta.url);
assertSecurityVersion("node", process.versions.node);
assertSecurityVersion("node", (await readFile(new URL(".nvmrc", root), "utf8")).trim());
for (const path of ["package-lock.json", "deploy/huggingface-runner/package-lock.json"]) {
  checkSecurityLockfile(JSON.parse(await readFile(new URL(path, root), "utf8")));
}
const render = await readFile(new URL("deploy/huggingface-runner/render.yaml", root), "utf8");
assertSecurityVersion("node", /key: NODE_VERSION\s+value: ([^\s]+)/.exec(render)?.[1]);
const dockerfile = await readFile(new URL("deploy/huggingface-runner/Dockerfile", root), "utf8");
assertSecurityVersion("node", /^FROM node:([0-9.]+)-/.exec(dockerfile)?.[1]);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (new Set([manifest.dependencies.react, manifest.dependencies["react-dom"], manifest.devDependencies["react-server-dom-webpack"]]).size !== 1) {
  throw new Error("React client, DOM and server decoder releases must match");
}
console.log("October 2026 security baseline passed for Node, Next, RSC, sharp, body-parser, undici (including aliases) and Zod; no production access");
