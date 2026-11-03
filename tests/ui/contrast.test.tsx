import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Contrast is a site-wide contract, not a per-page choice: semantic text tokens
 * must clear WCAG AA on every light surface, no rule may paint text on a
 * background it fails — whether either side is a token or a literal — and the
 * dark panels whose text colour is inherited from an ancestor are pinned by
 * name, because a stylesheet alone cannot resolve their background.
 */
const appRoot = fileURLToPath(new URL("../../app", import.meta.url));

const textTokens = ["--ink", "--ink-soft", "--ink-faint", "--indigo", "--sage", "--amber"] as const;
const surfaceTokens = ["--surface", "--paper", "--paper-deep", "--indigo-soft", "--sage-soft", "--amber-soft"] as const;

async function cssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  }));
  return nested.flat();
}

function normalizeHex(value: string): string | null {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toLowerCase()}`;
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function escapeSelector(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rule(css: string, selector: string): string {
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escapeSelector(selector)}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} must stay defined`);
  return match[1];
}

function declaration(block: string, property: string): string {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(match, `missing ${property} in: ${block.trim()}`);
  return match[1].trim();
}

function literalColour(value: string): string {
  const hex = normalizeHex(value);
  assert.ok(hex, `expected a literal colour, received ${value}`);
  return hex;
}

const tokenSource = await readFile(join(appRoot, "styles/tokens.css"), "utf8");
const rawTokens = new Map<string, string>();
for (const match of tokenSource.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) rawTokens.set(match[1], match[2].trim());

function blockScope(declarations: string): Map<string, string> {
  const local = new Map<string, string>();
  for (const match of declarations.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) local.set(match[1], match[2].trim());
  return local;
}

function resolveColor(value: string, scope = new Map<string, string>(), seen = new Set<string>()): string | null {
  const hex = normalizeHex(value);
  if (hex) return hex;
  const reference = value.trim().match(/^var\((--[a-z0-9-]+)\)$/i);
  if (!reference || seen.has(reference[1])) return null;
  const name = reference[1];
  seen.add(name);
  const token = scope.get(name) ?? rawTokens.get(name);
  return token ? resolveColor(token, scope, seen) : null;
}

const tokens = new Map<string, string>();
for (const [name, value] of rawTokens) {
  const resolved = resolveColor(value);
  if (resolved) tokens.set(name, resolved);
}

test("semantic text tokens clear AA on every light surface token", () => {
  for (const text of textTokens) {
    const foreground = tokens.get(text);
    assert.ok(foreground, `${text} must resolve to a literal colour`);
    for (const surface of surfaceTokens) {
      const background = tokens.get(surface);
      assert.ok(background, `${surface} must resolve to a literal colour`);
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= 4.5, `${text} (${foreground}) on ${surface} (${background}) is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("no rule paints text on a background it fails", async () => {
  const offenders: string[] = [];
  let checked = 0;
  let faintChecked = 0;
  for (const file of await cssFiles(appRoot)) {
    const source = await readFile(file, "utf8");
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = rule[2];
      const color = declarations.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1];
      const background = declarations.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/)?.[1];
      if (!color || !background) continue;
      const selector = rule[1].trim().split("\n").pop()?.trim() ?? "";
      // WCAG 1.4.3 exempts inactive controls; their muting carries the state.
      if (selector.includes(":disabled")) continue;
      const scope = blockScope(declarations);
      const foreground = resolveColor(color, scope);
      const surface = resolveColor(background, scope);
      if (!foreground || !surface) continue;
      checked += 1;
      if (color.includes("var(--ink-faint)")) faintChecked += 1;
      const ratio = contrast(foreground, surface);
      if (ratio < 4.5) {
        offenders.push(`${file.slice(appRoot.length + 1)} | ${selector} | ${foreground} on ${surface} = ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(checked >= 100, `expected the sweep to inspect real rules, inspected ${checked}`);
  assert.ok(faintChecked >= 3, `expected faint-label rules to be swept, inspected ${faintChecked}`);
});

/**
 * A stylesheet cannot tell which ancestor paints a paragraph, so the dark
 * panels that rely on inheritance are listed: surface selector first, then the
 * text rules that sit inside it.
 */
const inheritedSurfaces = [
  {
    path: "home.css",
    surface: ".home-door",
    texts: [".home-door p", ".home-door__note", ".home-door__action", ".home-door__index"],
  },
  {
    path: "styles/receipt.css",
    surface: ".receipt-verify-panel",
    texts: [
      ".receipt-verify-gate-copy strong",
      ".receipt-verify-gate-copy p",
      ".receipt-verify-index",
      ".receipt-verify-state",
      ".receipt-verify-verdict p",
      ".receipt-verify-verdict small",
    ],
  },
  {
    path: "styles/receipt.css",
    surface: ".receipt-verify",
    texts: [".receipt-verify h2", ".receipt-verify .eyebrow", ".receipt-verify-copy > p:not(.eyebrow)", ".receipt-verify-actions a"],
  },
] as const;

test("dark panels keep their inherited text readable", async () => {
  for (const { path, surface, texts } of inheritedSurfaces) {
    const css = await readFile(join(appRoot, path), "utf8");
    const background = literalColour(declaration(rule(css, surface), "background"));
    for (const selector of texts) {
      const foreground = literalColour(declaration(rule(css, selector), "color"));
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= 4.5, `${path} ${selector} on ${surface}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1`);
    }
  }
});
