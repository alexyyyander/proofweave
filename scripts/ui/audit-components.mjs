import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const allPaths = await walk(path.join(root, "app"));
const paths = allPaths.filter(file => /\.(tsx|ts)$/.test(file));
const graph = new Map();
const inventory = [];
const failures = [];
const primaryEntries = new Set(["app/page.tsx", "app/explore/page.tsx", "app/about/page.tsx", "app/history/page.tsx", "app/workbench/page.tsx", "app/workbench/MyWorkOverview.tsx"]);
const nativeControls = new Set(["button", "input", "select", "textarea", "dl", "pre", "h1", "h2", "h3"]);
for (const file of allPaths.filter(file => file.endsWith(".css"))) {
  const source = await readFile(file, "utf8");
  if (!file.endsWith("/styles/tokens.css") && /font-family:\s*(?:Georgia|var\(--font-geist-)/.test(source)) failures.push(`${path.relative(root, file)}: font families must use shared editorial/ui/code tokens`);
}
for (const file of allPaths.filter(file => file.includes("/components/") && file.endsWith(".css"))) {
  const css = await readFile(file, "utf8");
  if (/var\(--home-|\.home-showcase-shell/.test(css)) failures.push(`${path.relative(root, file)}: shared styles depend on homepage composition`);
}
for (const file of paths) {
  const relative = path.relative(root, file);
  const source = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const shared = relative.startsWith("app/components/");
  const base = relative.startsWith("app/components/ui/");
  const names = [];
  const uses = new Map();
  const dependencies = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) names.push(node.name.text);
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const name = node.tagName.getText(ast);
      if (/^[A-Z]/.test(name)) uses.set(name, (uses.get(name) ?? 0) + 1);
      if (primaryEntries.has(relative) && name === "h1") failures.push(`${relative}: primary page headings must use PageIntro`);
      if (nativeControls.has(name) && !base) failures.push(`${relative}: native <${name}> bypasses shared UI`);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const typeOnly = ts.isImportDeclaration(node) && (node.importClause?.isTypeOnly || (!node.importClause?.name && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every(item => item.isTypeOnly)));
      const target = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
      const resolved = target && [target, target + ".tsx", target + ".ts", path.join(target, "index.ts")].find(candidate => paths.includes(candidate));
      if (resolved && !typeOnly) dependencies.push(resolved);
      if (shared && target && !typeOnly) {
        const allowed = base ? ["app/components/ui/"] : ["app/components/", "app/hooks/"];
        const targetRelative = path.relative(root, target);
        const shell = relative.startsWith("app/components/shell/");
        if (!shell && !allowed.some(prefix => targetRelative.startsWith(prefix))) failures.push(`${relative}: runtime dependency outside component layer: ${specifier}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (primaryEntries.has(relative) && !uses.has("PageIntro")) failures.push(`${relative}: primary page entry is missing PageIntro`);
  graph.set(file, dependencies);
  if (file.endsWith("tsx")) inventory.push({ file: relative, layer: relative.includes("/dev/") ? "workshop" : shared ? relative.split("/")[2] : /\/(page|layout)\.tsx$/.test(relative) ? "route" : "feature", client: /^\s*["']use client["']/.test(source), components: names, uses: Object.fromEntries(uses) });
}
const visited = new Set();
const pending = new Set();
function checkCycles(file) {
  if (pending.has(file)) { failures.push(`Runtime import cycle at ${path.relative(root, file)}`); return; }
  if (visited.has(file)) return;
  pending.add(file);
  for (const child of graph.get(file) ?? []) checkCycles(child);
  pending.delete(file); visited.add(file);
}
for (const file of graph.keys()) checkCycles(file);
if (process.argv.includes("--json")) console.log(JSON.stringify(inventory, null, 2));
else if (process.argv.includes("--markdown")) {
  console.log("| 文件 | 层级 | 边界 | 组件 |\n| --- | --- | --- | --- |");
  for (const item of inventory.sort((a,b) => a.file.localeCompare(b.file))) console.log(`| [${item.file}](../${item.file}) | ${item.layer} | ${item.client ? "client" : "server-compatible"} | ${item.components.join(", ") || "re-export / composition"} |`);
} else {
  const uses = {};
  for (const item of inventory) for (const [name, count] of Object.entries(item.uses)) uses[name] = (uses[name] ?? 0) + count;
  console.log(JSON.stringify({ files: inventory.length, sharedFiles: inventory.filter(item => ["ui", "navigation", "evidence", "research", "shell"].includes(item.layer)).length, uses, failures }, null, 2));
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
