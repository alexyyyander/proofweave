import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The two home doors and the receipt verification panel cannot be checked in a
 * real browser in this environment, so their small-screen contract is pinned
 * here: one column where the content stops fitting, long identifiers that wrap
 * instead of overflowing, and label colours that clear WCAG AA for small text.
 */
const homeCss = await readFile(new URL("../../app/home.css", import.meta.url), "utf8");
const receiptCss = await readFile(new URL("../../app/styles/receipt.css", import.meta.url), "utf8");

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

function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media (${query})`);
  assert.ok(start >= 0, `missing @media (${query})`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated @media (${query})`);
}

function hex(value: string): string {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.ok(match, `expected a literal colour, received ${value}`);
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

test("the home doors collapse to one column before they get too narrow", () => {
  assert.match(declaration(rule(homeCss, ".home-doors"), "grid-template-columns"), /repeat\(2, minmax\(0, 1fr\)\)/);
  const narrow = mediaBlock(homeCss, "max-width: 760px").match(/\.home-doors\s*\{([^}]*)\}/);
  assert.ok(narrow, "the home door grid needs a narrow-screen rule");
  assert.match(declaration(narrow[1], "grid-template-columns"), /1fr/);
});

test("the receipt panels stack before their second column starves", () => {
  const narrow = mediaBlock(receiptCss, "max-width: 1020px");
  const verify = narrow.match(/\.receipt-verify\s*\{([^}]*)\}/);
  assert.ok(verify, "the verification panel needs a narrow-screen rule");
  assert.match(declaration(verify[1], "grid-template-columns"), /1fr/);
  const boundary = narrow.match(/\.receipt-boundary-grid\s*\{([^}]*)\}/);
  assert.ok(boundary, "the claim boundary needs a narrow-screen rule");
  assert.match(declaration(boundary[1], "grid-template-columns"), /1fr/);
});

test("the gate state chip drops below its label on phones", () => {
  const phone = mediaBlock(receiptCss, "max-width: 620px");
  const row = phone.match(/\.receipt-verify-gates li\s*\{([^}]*)\}/);
  assert.ok(row, "the gate row needs a phone rule");
  assert.match(declaration(row[1], "grid-template-columns"), /^22px minmax\(0, 1fr\)$/);
  const chip = phone.match(/\.receipt-verify-state\s*\{([^}]*)\}/);
  assert.ok(chip, "the state chip needs a phone rule");
  assert.match(declaration(chip[1], "grid-column"), /^2$/);
});

test("long identifiers wrap instead of widening the page", () => {
  for (const [css, selector] of [
    [receiptCss, ".receipt-boundary-column li"],
    [receiptCss, ".receipt-claim-label"],
    [receiptCss, ".receipt-verify-verdict code"],
  ] as const) {
    assert.match(declaration(rule(css, selector), "overflow-wrap"), /anywhere/);
  }
});

test("small labels keep WCAG AA contrast on their own backgrounds", () => {
  const pairs = [
    [homeCss, "home door body", ".home-door p", ".home-door"],
    [homeCss, "home door note", ".home-door__note", ".home-door"],
    [homeCss, "home door action", ".home-door__action", ".home-door"],
    [receiptCss, "receipt gate copy", ".receipt-verify-gate-copy p", ".receipt-verify-panel"],
    [receiptCss, "receipt gate state", ".receipt-verify-state", ".receipt-verify-panel"],
    [receiptCss, "receipt boundary heading", ".receipt-boundary-column .receipt-boundary-column-title", ".receipt-boundary"],
    [receiptCss, "receipt claim note", ".receipt-claim-coverage-copy p:not(.eyebrow)", ".receipt-boundary"],
    [receiptCss, "receipt claim requirement", ".receipt-claim-coverage small", ".receipt-boundary"],
  ] as const;
  for (const [css, label, textSelector, surfaceSelector] of pairs) {
    const text = hex(declaration(rule(css, textSelector), "color"));
    const surface = hex(declaration(rule(css, surfaceSelector), "background"));
    const ratio = contrast(text, surface);
    assert.ok(ratio >= 4.5, `${label}: ${text} on ${surface} is ${ratio.toFixed(2)}:1`);
  }
  const missing = rule(receiptCss, ".receipt-claim-coverage li.is-missing .receipt-claim-state");
  const ratio = contrast(hex(declaration(missing, "color")), hex(declaration(missing, "background")));
  assert.ok(ratio >= 4.5, `missing claim state is ${ratio.toFixed(2)}:1`);
});
