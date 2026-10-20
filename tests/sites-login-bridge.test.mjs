import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import ts from 'typescript';
import { handleSitesBridge, transaction, sign, SitesBridgeTransaction } from '../services/auth/sites-login-bridge.mjs';
import { directCloudflareRequest } from '../services/hosting/cloudflare-boundary.mjs';
const site = 'https://original.chatgpt.site'; const receiver = 'https://new.example.test';
const secret = 'test-only-bridge-secret-'.repeat(3); const client = 'preview';
let mf, ns, db, Repository;
const base = { SITES_BRIDGE_SECRET: secret, SITES_BRIDGE_SITE_ID: 'site:original', SITES_BRIDGE_SITE_ORIGIN: site };
const receiverEnv = () => ({ ...base, SITES_BRIDGE_ROLE: 'receiver', SITES_BRIDGE_RECEIVER_ORIGIN: receiver,
  SITES_BRIDGE_CLIENT_ID: client, SITES_BRIDGE_TRANSACTIONS: ns });
const issuerEnv = { ...base, SITES_BRIDGE_ROLE: 'issuer', SITES_BRIDGE_CLIENTS_JSON: JSON.stringify([{ clientId: client, origin: receiver }]) };
const identityHeaders = { 'oai-authenticated-user-id': 'CaseSensitive-User', 'oai-authenticated-user-email': 'owner@example.test' };
const cookie = r => r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
before(async () => {
  const source = await readFile(new URL('../services/auth/sites-login-bridge.mjs', import.meta.url), 'utf8');
  mf = new Miniflare({ modules: true, script: source + '\nexport default {fetch(){return new Response("ok")}};',
    compatibilityDate: '2026-07-16', durableObjects: { BRIDGE: { className: 'SitesBridgeTransaction', useSQLite: true } }, d1Databases: ['DB'] });
  ns = await mf.getDurableObjectNamespace('BRIDGE'); db = await mf.getD1Database('DB');
  await db.exec('CREATE TABLE persons (id TEXT PRIMARY KEY, identity_provider TEXT, provider_subject TEXT, display_name TEXT, updated_at TEXT);');
  await db.exec('CREATE TABLE person_identities (id TEXT PRIMARY KEY, person_id TEXT, provider TEXT, provider_subject TEXT, display_name TEXT, email TEXT, email_normalized TEXT, email_verified_at TEXT, updated_at TEXT, UNIQUE(provider,provider_subject));');
  globalThis.__bridgeTestDB = db;
  const repositorySource = (await readFile(new URL('../db/repositories/account-auth.ts', import.meta.url), 'utf8'))
    .replace('import { getAccountAuthD1 as getD1 } from "@/db";', 'const getD1 = () => globalThis.__bridgeTestDB;');
  const compiled = ts.transpileModule(repositorySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  Repository = (await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))).AccountAuthRepository;
});
after(async () => { await mf?.dispose(); delete globalThis.__bridgeTestDB; });
async function start(returnTo = '/profile') {
  const response = await handleSitesBridge(new Request(receiver + '/auth/sites-bridge/start?return_to=' + encodeURIComponent(returnTo)), receiverEnv());
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('location'));
  return { response, url, state: url.searchParams.get('state'), flowCookie: cookie(response) };
}
async function consent(flow, identity = identityHeaders) {
  const response = await handleSitesBridge(new Request(flow.url, { headers: identity }), issuerEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  const policy = response.headers.get('Content-Security-Policy');
  assert.equal(policy.split(';').map(v => v.trim()).find(v => v.startsWith('form-action ')), "form-action 'self' " + receiver);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  const html = await response.text();
  return { csrf: html.match(/name="csrf" value="([^"]+)"/)[1], consentCookie: cookie(response), html };
}
async function authorize(flow, confirmation, overrides = {}) {
  return handleSitesBridge(new Request(flow.url, { method: 'POST', headers: { ...identityHeaders, Origin: site,
    Cookie: confirmation.consentCookie, ...overrides }, body: 'csrf=' + confirmation.csrf }), issuerEnv, {
    fetcher: (url, init) => handleSitesBridge(new Request(url, init), receiverEnv()),
  });
}
async function callback(url, flowCookie, onCreate = async () => ({ token: 'test-session' })) {
  return handleSitesBridge(new Request(url, { headers: { Cookie: flowCookie } }), receiverEnv(), { sessions: { create: onCreate } });
}
test('full bridge: native login returns same-origin, confirmation, backchannel, opaque redirect, session', async () => {
  const flow = await start('/workbench');
  const anonymous = await handleSitesBridge(new Request(flow.url), issuerEnv);
  const login = new URL(anonymous.headers.get('location'));
  assert.equal(login.origin, site); assert.equal(login.pathname, '/signin-with-chatgpt');
  assert.equal(login.searchParams.get('return_to'), flow.url.pathname + flow.url.search);
  const confirmation = await consent(flow);
  assert.match(confirmation.html, /new.example.test/);
  const authorized = await authorize(flow, confirmation);
  assert.equal(authorized.status, 302);
  assert.ok(authorized.headers.get('Content-Security-Policy').includes("form-action 'self' " + receiver + ';'));
  const target = authorized.headers.get('location');
  assert.ok(!target.includes('owner') && !target.includes('CaseSensitive'));
  let claims;
  const result = await callback(target, flow.flowCookie, async value => { claims = value; return { token: 'new-session' }; });
  assert.equal(result.headers.get('location'), receiver + '/workbench');
  assert.equal(claims.userId, 'CaseSensitive-User');
  assert.match(result.headers.getSetCookie().join(';'), /__Host-pw_session=new-session/);
  assert.match(result.headers.getSetCookie().join(';'), /HttpOnly; Secure; SameSite=Lax/);
  assert.match((await callback(target, flow.flowCookie)).headers.get('location'), /sites_bridge_failed/);
});
test('consent CSRF, switched identity, forged identity headers, and unregistered clients fail closed', async () => {
  const flow = await start(); const confirmation = await consent(flow);
  assert.equal((await authorize(flow, confirmation, { Origin: 'https://evil.test' })).status, 400);
  assert.equal((await authorize(flow, confirmation, { Origin: 'null' })).status, 400);
  assert.equal((await authorize(flow, confirmation, { 'oai-authenticated-user-id': 'another-user' })).status, 400);
  assert.equal((await authorize(flow, { ...confirmation, csrf: 'invalid' })).status, 400);
  const forged = directCloudflareRequest(new Request(receiver + '/login-bridge?client_id=preview&state=' + flow.state, { headers: identityHeaders }));
  assert.equal((await handleSitesBridge(forged, receiverEnv())).status, 400);
  assert.equal((await handleSitesBridge(new Request(site + '/login-bridge?client_id=evil&state=' + flow.state), issuerEnv)).status, 400);
});
test('callback binds browser, PKCE, code and state; wrong attempts cannot consume valid code', async () => {
  const a = await start(); const b = await start(); const authorized = await authorize(a, await consent(a));
  const target = authorized.headers.get('location');
  assert.match((await callback(target, b.flowCookie)).headers.get('location'), /sites_bridge_failed/);
  const wrong = new URL(target); wrong.searchParams.set('code', 'x'.repeat(43));
  assert.match((await callback(wrong, a.flowCookie)).headers.get('location'), /sites_bridge_failed/);
  const forgedCookie = '__Host-pw_sites_bridge=' + Buffer.from(JSON.stringify({ state: a.state, verifier: 'x'.repeat(43) })).toString('base64url');
  assert.match((await callback(target, forgedCookie)).headers.get('location'), /sites_bridge_failed/);
  assert.equal((await callback(target, a.flowCookie)).headers.get('location'), receiver + '/profile');
});
test('expired or missing confirmation cannot attest and offers a fixed fresh-start link', async () => {
  const flow = await start(); const confirmation = await consent(flow);
  const expired = await sign({ type: 'consent', state: flow.state, client, userId: identityHeaders['oai-authenticated-user-id'], csrf: confirmation.csrf }, secret, -1);
  for (const consentCookie of ['', '__Host-pw_bridge_consent=' + expired]) {
    let exchanges = 0;
    const result = await handleSitesBridge(new Request(flow.url, { method: 'POST', headers: { ...identityHeaders, Origin: site, Cookie: consentCookie }, body: 'csrf=' + confirmation.csrf }), issuerEnv, { fetcher: async () => { exchanges++; throw Error('must not exchange'); } });
    assert.equal(result.status, 400); assert.equal(exchanges, 0);
    const html = await result.text(); assert.match(html, /Sign-in confirmation expired/);
    assert.ok(html.includes('href="' + receiver + '/auth/sites-bridge/start"'));
    assert.ok(!html.includes(flow.state) && !html.includes(confirmation.csrf));
    assert.match(result.headers.get('Set-Cookie'), /Max-Age=0/);
  }
});
test('issuer exchanges inside the Workers runtime and refuses backchannel redirects', async () => {
  const source = await readFile(new URL('../services/auth/sites-login-bridge.mjs', import.meta.url), 'utf8');
  let responseStatus = 200; const destinations = [];
  const worker = new Miniflare({ modules: true, compatibilityDate: '2026-07-16', bindings: issuerEnv,
    script: source + '\nexport default {fetch(request, env) { return handleSitesBridge(request, env); }};',
    outboundService: async request => {
      destinations.push(request.url);
      return responseStatus === 200 ? Response.json({ code: 'c'.repeat(43) }) : new Response(null, { status: responseStatus, headers: { Location: 'https://untrusted.example.test/' } });
    },
  });
  try {
    const url = site + '/login-bridge?client_id=' + client + '&state=' + 's'.repeat(43);
    for (const status of [200, 302, 307]) {
      responseStatus = status;
      const get = await worker.dispatchFetch(url, { headers: identityHeaders });
      const csrf = (await get.text()).match(/name="csrf" value="([^"]+)"/)[1];
      const post = await worker.dispatchFetch(url, { method: 'POST', redirect: 'manual', headers: { ...identityHeaders, Origin: site, Cookie: cookie(get) }, body: 'csrf=' + csrf });
      assert.equal(post.status, status === 200 ? 302 : 400);
      if (status === 200) assert.ok(post.headers.get('Location').startsWith(receiver + '/auth/sites-bridge/callback?'));
    }
    assert.deepEqual(destinations, Array(3).fill(receiver + '/auth/sites-bridge/attest'));
  } finally { await worker.dispose(); }
});
test('parallel callback redemption creates at most one session across real Durable Object requests', async () => {
  const flow = await start(); const authorized = await authorize(flow, await consent(flow)); let sessions = 0;
  const create = async () => { sessions++; return { token: 'once' }; };
  await Promise.all(Array.from({ length: 8 }, () => callback(authorized.headers.get('location'), flow.flowCookie, create)));
  assert.equal(sessions, 1);
});
test('assertions reject invalid signature, issuer, audience, expiry and reuse', async () => {
  const flow = await start();
  const claims = { type: 'identity', site, siteId: base.SITES_BRIDGE_SITE_ID, audience: receiver, client,
    state: flow.state, userId: 'test-user', email: 'test@example.test', displayName: 'Test' };
  const send = token => handleSitesBridge(new Request(receiver + '/auth/sites-bridge/attest', { method: 'POST', body: token }), receiverEnv());
  for (const token of [await sign(claims, 'wrong', 90), await sign({ ...claims, site: 'https://evil.test' }, secret, 90),
    await sign({ ...claims, audience: 'https://evil.test' }, secret, 90), await sign(claims, secret, -1), await sign(claims, secret, 1000)]) {
    assert.equal((await send(token)).status, 400);
  }
  const token = await sign(claims, secret, 90);
  assert.equal((await send(token)).status, 200); assert.equal((await send(token)).status, 400);
});
test('disabled config, wrong host and unsafe return paths cannot redirect outside the allowlist', async () => {
  assert.equal((await handleSitesBridge(new Request(receiver + '/auth/sites-bridge/start'), {})).status, 400);
  assert.equal((await handleSitesBridge(new Request('https://evil.test/auth/sites-bridge/start'), receiverEnv())).status, 400);
  const flow = await start('//evil.test'); const authorized = await authorize(flow, await consent(flow));
  assert.equal((await callback(authorized.headers.get('location'), flow.flowCookie)).headers.get('location'), receiver + '/profile');
});
test('transaction expiry and wrong client prevent consumption', async () => {
  const flow = await start();
  assert.equal((await transaction(receiverEnv(), flow.state, { action: 'attest', client: 'wrong-client', callback: receiver + '/auth/sites-bridge/callback' })).ok, false);
  const expired = new SitesBridgeTransaction({ storage: { transaction: fn => fn({
    get: async () => ({ expires: Date.now() - 1, client, callback: receiver + '/auth/sites-bridge/callback', status: 'pending' }),
    put: async () => { throw Error('Expired record must not be changed'); },
  }) } });
  const result = await expired.fetch(new Request('https://internal/', { method: 'POST', body: JSON.stringify({ action: 'attest', client, callback: receiver + '/auth/sites-bridge/callback' }) }));
  assert.equal((await result.json()).ok, false);
});
test('legacy same-Site ChatGPT identity retains Person; Google-only email is never auto-merged', async () => {
  await db.prepare('INSERT INTO persons VALUES (?,?,?,?,?)').bind('person:legacy', 'chatgpt', 'legacy@example.test', 'Legacy', 'now').run();
  const repo = new Repository();
  const input = { siteId: 'site:original', userId: 'User-A', email: 'legacy@example.test', displayName: 'Legacy' };
  const identity = await repo.resolveSitesBridgeIdentity(input);
  assert.equal(identity.personId, 'person:legacy'); assert.match(identity.subject, /^sites:/);
  const changedEmail = await repo.resolveSitesBridgeIdentity({ ...input, email: 'changed@example.test' });
  assert.equal(changedEmail.personId, identity.personId);
  const google = await repo.resolveIdentity({ provider: 'google', subject: 'Google-B', email: 'google@example.test', displayName: 'G', emailVerified: true });
  const bridge = await repo.resolveSitesBridgeIdentity({ ...input, userId: 'User-B', email: 'google@example.test' });
  assert.notEqual(bridge.personId, google.personId);
  const caseVariant = await repo.resolveSitesBridgeIdentity({ ...input, userId: 'user-b', email: 'other@example.test' });
  assert.notEqual(bridge.subject, caseVariant.subject);
});
