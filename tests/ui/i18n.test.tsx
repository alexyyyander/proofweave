import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocale, localeCookieName, negotiateLocale, parseLocaleCookie, pathForLocale, stripLocalePrefix } from "../../app/i18n/config";
import { en } from "../../app/i18n/dictionaries/en";
import { zhCN } from "../../app/i18n/dictionaries/zh-CN";
import { createTranslator, translate } from "../../app/i18n/translate";

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

test("every locale supplies exactly the English translation keys", () => {
  assert.deepEqual(Object.keys(zhCN).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries(zhCN)) {
    assert.equal(typeof value, "string", key);
    assert.ok(value.trim().length > 0, `${key} must not be empty`);
  }
});

test("localized templates keep every interpolation placeholder", () => {
  for (const [key, value] of Object.entries(en)) {
    assert.deepEqual(placeholders(zhCN[key as keyof typeof zhCN]), placeholders(value), key);
  }
});

test("translator interpolates named values and keeps unknown placeholders visible", () => {
  const t = createTranslator(zhCN);
  assert.equal(t("locale.menuSummary", { language: "简体中文" }), "语言：简体中文");
  assert.equal(translate(en, "header.accountMenuAria", { name: "Ada" }), "Open account menu for Ada");
  assert.equal(translate(en, "header.accountMenuAria"), "Open account menu for {name}");
  assert.equal(translate({} as typeof en, "header.accountMenuAria"), "header.accountMenuAria");
  assert.equal(translate({} as typeof en, "header.accountMenuAria", { name: "Ada" }), "header.accountMenuAria");
});

test("canonical paths add and remove the Chinese prefix", () => {
  assert.equal(pathForLocale("/", "en"), "/");
  assert.equal(pathForLocale("/", "zh-CN"), "/zh-CN");
  assert.equal(pathForLocale("/about", "zh-CN"), "/zh-CN/about");
  assert.equal(pathForLocale("about", "zh-CN"), "/zh-CN/about");
  assert.equal(stripLocalePrefix("/zh-CN"), "/");
  assert.equal(stripLocalePrefix("/zh-CN/about"), "/about");
  assert.equal(stripLocalePrefix("/about"), "/about");
});

test("locale cookies and Accept-Language negotiation resolve supported locales", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(parseLocaleCookie(`${localeCookieName}=zh-CN; other=value`), "zh-CN");
  assert.equal(parseLocaleCookie(`${localeCookieName}=fr`), null);
  assert.equal(parseLocaleCookie("other=value"), null);
  assert.equal(parseLocaleCookie("pw_locale=%E0%A4%A"), null);
  assert.equal(parseLocaleCookie("pw_locale=%E0%A4%A; pw_locale=zh-CN"), "zh-CN");
  assert.equal(negotiateLocale("en-US,en;q=0.9"), "en");
  assert.equal(negotiateLocale("zh"), "zh-CN");
  assert.equal(negotiateLocale("zh-TW;q=0.8,en;q=0.7"), "zh-CN");
  assert.equal(negotiateLocale("fr-FR,zh;q=0.5"), "zh-CN");
  assert.equal(negotiateLocale("fr-FR"), "en");
  assert.equal(negotiateLocale(null), "en");
});

async function walk(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) =>
    entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]));
  return nested.flat();
}

test("client components only use namespaces supplied to the client dictionary", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join, resolve } = await import("node:path");
  const { clientDictionaryPrefixes } = await import("../../app/i18n/client-dictionary");
  const { en } = await import("../../app/i18n/dictionaries/en");
  const appRoot = fileURLToPath(new URL("../../app", import.meta.url));
  const sources = new Map<string, string>();
  for (const file of await walk(appRoot)) {
    if (/\.(ts|tsx)$/.test(file)) sources.set(file, await readFile(file, "utf8"));
  }

  const resolveImport = (from: string, specifier: string): string[] => {
    const base = specifier.startsWith("@/app/")
      ? join(appRoot, specifier.slice("@/app/".length))
      : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null;
    if (!base) return [];
    return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
      .filter((candidate) => sources.has(candidate));
  };

  // Client components, plus the modules they import directly, because helpers
  // receive `t` and can look up keys the component file never names.
  const scope = new Set<string>();
  for (const [file, source] of sources) {
    if (!/^\s*["']use client["']/.test(source)) continue;
    if (!source.includes('from "@/app/i18n/client"')) continue;
    scope.add(file);
  }
  for (const file of [...scope]) {
    for (const match of sources.get(file)!.matchAll(/from\s+["']([^"']+)["']/g)) {
      for (const dependency of resolveImport(file, match[1])) scope.add(dependency);
    }
  }

  const allowed = (key: string) => clientDictionaryPrefixes.some((prefix) => key.startsWith(prefix));
  const missing: string[] = [];
  for (const file of scope) {
    const source = sources.get(file)!;
    for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
      const key = match[1];
      if (!allowed(key)) missing.push(`${file.slice(appRoot.length + 1)}: ${key}`);
    }
    // Dynamic lookups such as t(statusKeys[status]) hide their key from the
    // regex above; every key-shaped literal in a client module is checked.
    for (const match of source.matchAll(/["']([A-Za-z][\w-]*(?:\.[\w-]+)+)["']/g)) {
      const key = match[1];
      if (key in en && !allowed(key)) missing.push(`${file.slice(appRoot.length + 1)}: ${key}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("route sections receive only their own client dictionary", async () => {
  const { clientDictionaryForPath, clientDictionaryGroups, clientDictionaryPrefixes } = await import("../../app/i18n/client-dictionary");
  const known = new Set<string>(clientDictionaryPrefixes);
  for (const [section, prefixes] of Object.entries(clientDictionaryGroups)) {
    for (const prefix of prefixes) {
      assert.equal(known.has(prefix), true, `${section} lists unknown prefix ${prefix}`);
    }
  }
  const has = (dictionary: Record<string, string>, prefix: string) =>
    Object.keys(dictionary).some((key) => key.startsWith(prefix));

  const home = clientDictionaryForPath(en, "/");
  assert.equal(has(home, "showcase."), true);
  assert.equal(has(home, "demo."), true);
  assert.equal(has(home, "myWork."), false);
  assert.equal(has(home, "workbenchClient."), false);

  const publications = clientDictionaryForPath(en, "/publications");
  assert.equal(has(publications, "publicationDetail.copy."), true);
  assert.equal(has(publications, "explore."), false);
  assert.equal(has(publications, "myWork."), false);

  const workbench = clientDictionaryForPath(en, "/zh-CN/workbench/attempts/abc");
  assert.equal(has(workbench, "workbenchClient."), true);
  assert.equal(has(workbench, "myWork."), true);
  assert.equal(has(workbench, "publicationDetail.copy."), false);
  assert.equal(Object.keys(workbench).length < Object.keys(clientDictionaryForPath(en, "/")).length + 1000, true);
});

test("middleware exclusions use segment boundaries and skip only real assets", async () => {
  const { isNonPagePath, middlewareMatcher } = await import("../../app/i18n/routing");
  const matcher = new RegExp(`^${middlewareMatcher}$`);
  const excluded = ["/api", "/api/me", "/auth/google", "/authorize", "/mcp", "/token", "/start", "/callback", "/_next/static/chunk.js", "/og.png", "/sitemap.xml", "/about.html", "/.well-known/oauth-authorization-server"];
  const handled = ["/", "/about", "/authors", "/zh-CN", "/zh-CN/about", "/publications/openai-math/1.0"];
  for (const pathname of excluded) {
    assert.equal(isNonPagePath(pathname), true, pathname);
    assert.doesNotMatch(pathname, matcher, pathname);
  }
  for (const pathname of handled) {
    assert.equal(isNonPagePath(pathname), false, pathname);
    assert.match(pathname, matcher, pathname);
  }
});
