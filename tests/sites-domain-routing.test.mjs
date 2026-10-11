import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalPublicRedirect, resolveSitesOAuthAuthority } from "../services/proofweave-identity/sites-authority.mjs";
import { isProductionDomainMigration, productionOrigin, legacyProductionOrigin } from "../plugins/proofweave-research/mcp/deployment-origin.mjs";

const settings = {
  OAUTH_ISSUER_URL: productionOrigin,
  MCP_RESOURCE_URL: `${productionOrigin}/api/mcp`,
  OAUTH_LEGACY_ISSUER_URL: legacyProductionOrigin,
};

test("canonical and transition OAuth origins retain separate token audiences", () => {
  for (const origin of [productionOrigin, legacyProductionOrigin]) {
    assert.deepEqual(resolveSitesOAuthAuthority(`${origin}/token`, settings), {
      issuer: origin, resource: `${origin}/api/mcp`,
    });
  }
  assert.equal(resolveSitesOAuthAuthority(`${legacyProductionOrigin}/token`, {
    ...settings, OAUTH_LEGACY_ISSUER_URL: undefined,
  }), null);
});

test("OAuth authority fails closed on an unknown host or invalid resource configuration", () => {
  for (const origin of ["https://attacker.example", "https://proofweave.org.attacker.example", "http://proofweave.org"]) {
    assert.equal(resolveSitesOAuthAuthority(`${origin}/token`, settings), null);
  }
  for (const resource of ["https://attacker.example/api/mcp", `${productionOrigin}/api/mcp?audience=other`, `${productionOrigin}/api/mcp#fragment`, "https://user:password@proofweave.org/api/mcp"]) {
    assert.equal(resolveSitesOAuthAuthority(`${productionOrigin}/token`, {...settings, MCP_RESOURCE_URL: resource}), null);
  }
});

test("public links redirect to the canonical domain without redirecting credentials or legacy updates", () => {
  const path="/explore/erdos-865-k2?source=bookmark";
  assert.equal(canonicalPublicRedirect(new Request(`${legacyProductionOrigin}${path}`), settings), `${productionOrigin}${path}`);
  assert.equal(canonicalPublicRedirect(new Request(`${productionOrigin}${path}`), settings), null);
  for (const pathname of ["/token", "/authorize", "/register", "/.well-known/oauth-authorization-server", "/api/mcp", "/api/connect/sessions", "/connect/codex", "/sign-in", "/signin-with-chatgpt", "/callback", "/workbench", "/downloads/proofweave-research-marketplace.json", "/downloads/proofweave-research-marketplace.tar"]) {
    assert.equal(canonicalPublicRedirect(new Request(`${legacyProductionOrigin}${pathname}`), settings), null, pathname);
  }
  assert.equal(canonicalPublicRedirect(new Request(`${legacyProductionOrigin}/`, {method:"POST",body:"private"}), settings), null);
  assert.equal(canonicalPublicRedirect(new Request("https://attacker.example/"), settings), null);
});

test("only the exact production domain migration may reuse an Agent identity", () => {
  assert.equal(isProductionDomainMigration(legacyProductionOrigin, productionOrigin), true);
  for (const [from,to] of [[productionOrigin, legacyProductionOrigin], ["https://attacker.example", productionOrigin], [legacyProductionOrigin, "https://attacker.example"], [`${legacyProductionOrigin}.attacker.example`, productionOrigin], [legacyProductionOrigin, `${productionOrigin}.attacker.example`]]) {
    assert.equal(isProductionDomainMigration(from,to), false);
  }
});
