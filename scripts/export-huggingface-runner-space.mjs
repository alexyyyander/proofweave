import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const destination = resolve(process.argv[2] ?? "");

if (!process.argv[2]) fail("Usage: npm run runner:huggingface:export -- <empty-directory>");
if (destination === repositoryRoot || !relative(repositoryRoot, destination)) {
  fail("The Space export directory must not replace the repository root.");
}

await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length > 0) fail("The Space export directory must be empty.");

const sources = [
  ["deploy/huggingface-runner/Dockerfile", "Dockerfile"],
  ["deploy/huggingface-runner/README.space.md", "README.md"],
  ["deploy/huggingface-runner/.dockerignore", ".dockerignore"],
  ["deploy/huggingface-runner/render.yaml", "render.yaml"],
  ["deploy/huggingface-runner/package.json", "package.json"],
  ["deploy/huggingface-runner/package-lock.json", "package-lock.json"],
  ["packages", "packages"],
  ["services/artifacts", "services/artifacts"],
  ["services/database", "services/database"],
  ["services/lean-runner", "services/lean-runner"],
  ["services/verification", "services/verification"],
];

for (const [source, target] of sources) {
  const sourcePath = join(repositoryRoot, source);
  await stat(sourcePath).catch(() => fail(`Missing export source: ${source}`));
  await mkdir(resolve(destination, target, ".."), { recursive: true });
  await cp(sourcePath, join(destination, target), { recursive: true, force: false });
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "pw-huggingface-space-export-v1",
  destination,
  files: sources.map(([, target]) => target),
})}\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
