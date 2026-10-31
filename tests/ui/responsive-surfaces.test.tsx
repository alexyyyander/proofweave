import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The two home doors and the receipt verification panel cannot be checked in a
 * real browser in this environment, so their small-screen layout contract is
 * pinned here. Colour is covered by contrast.test.tsx, which resolves tokens
 * and literals alike.
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
