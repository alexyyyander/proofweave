/** Proofweave-owned identity bridge. Never exposes OpenAI tokens or identity in redirect URLs. */
const FLOW = '__Host-pw_sites_bridge';
const CONSENT = '__Host-pw_bridge_consent';
const CALLBACK = '/auth/sites-bridge/callback';
const START = '/auth/sites-bridge/start';
const ATTEST = '/auth/sites-bridge/attest';
const ISSUER = '/login-bridge';
const opaque = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const headers = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
export const bridgePaths = Object.freeze({ START, CALLBACK, ATTEST, ISSUER });
export function receiverConfigured(env) {
  try { receiverConfig(env); return true; } catch { return false; }
}
function origin(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.origin !== value || u.username || u.password) throw Error('configuration');
  return value;
}
function common(env) {
  if (typeof env.SITES_BRIDGE_SECRET !== 'string' || env.SITES_BRIDGE_SECRET.length < 43 ||
      !env.SITES_BRIDGE_SITE_ID) throw Error('configuration');
  return { site: origin(env.SITES_BRIDGE_SITE_ORIGIN), siteId: env.SITES_BRIDGE_SITE_ID, secret: env.SITES_BRIDGE_SECRET };
}
function receiverConfig(env) {
  const c = common(env);
  if (env.SITES_BRIDGE_ROLE !== 'receiver' || !env.SITES_BRIDGE_TRANSACTIONS || !env.SITES_BRIDGE_CLIENT_ID) throw Error('configuration');
  const receiver = origin(env.SITES_BRIDGE_RECEIVER_ORIGIN);
  return { ...c, receiver, client: env.SITES_BRIDGE_CLIENT_ID, callback: receiver + CALLBACK };
}
function issuerClient(env, client) {
  const c = common(env);
  if (env.SITES_BRIDGE_ROLE !== 'issuer' || env.PROOFWEAVE_HOSTING_PLATFORM === 'cloudflare') throw Error('configuration');
  const clients = JSON.parse(env.SITES_BRIDGE_CLIENTS_JSON ?? '[]');
  const match = clients.find(v => v.clientId === client);
  if (!match) throw Error('client');
  const receiver = origin(match.origin);
  return { ...c, client, receiver, callback: receiver + CALLBACK };
}
/** @param {Request} request @param {any} env @param {{sessions?: {create: (identity: any) => Promise<any>}, fetcher?: typeof fetch}} dependencies */
export async function handleSitesBridge(request, env, { sessions, fetcher = fetch } = {}) {
  const u = new URL(request.url);
  if (![START, CALLBACK, ATTEST, ISSUER].includes(u.pathname)) return null;
  try {
    if (u.pathname === ISSUER) {
      try { return await issuer(request, env, fetcher); }
      catch (error) {
        // Log only bounded failure categories, never identity, cookies, assertions or URLs.
        const reason = ['configuration', 'client', 'origin', 'identity', 'csrf', 'consent_missing', 'expiry', 'signature', 'token', 'exchange', 'code', 'size'].includes(error?.message) ? error.message : 'internal';
        console.warn(JSON.stringify({ event: 'sites_bridge_rejected', reason }));
        const c = issuerClient(env, u.searchParams.get('client_id'));
        if (u.origin !== c.site) throw error;
        return restartPage(c.receiver, ['consent_missing', 'expiry'].includes(reason));
      }
    }
    const c = receiverConfig(env);
    if (u.origin !== c.receiver) return failure('Wrong login origin.', 400);
    if (u.pathname === START && request.method === 'GET') {
      const state = random(); const verifier = random();
      const result = await transaction(env, state, { action: 'start', challenge: await digest(verifier),
        client: c.client, callback: c.callback, returnTo: relative(u.searchParams.get('return_to')) });
      if (!result.ok) throw Error('start');
      const target = new URL(ISSUER, c.site);
      target.searchParams.set('state', state); target.searchParams.set('client_id', c.client);
      return redirect(target.href, cookie(FLOW, pack({ state, verifier }), 600));
    }
    if (u.pathname === ATTEST && request.method === 'POST') {
      const assertion = await limitedText(request);
      const claims = await verify(assertion, c.secret, 'identity');
      if (claims.site !== c.site || claims.siteId !== c.siteId || claims.client !== c.client ||
          claims.audience !== c.receiver || !opaque.test(claims.state) || !validIdentity(claims)) throw Error('claims');
      const code = random();
      const result = await transaction(env, claims.state, { action: 'attest', codeHash: await digest(code),
        client: c.client, callback: c.callback,
        identity: { siteId: c.siteId, userId: claims.userId, email: claims.email, displayName: claims.displayName } });
      if (!result.ok) throw Error('expired');
      return Response.json({ code }, { headers });
    }
    if (u.pathname === CALLBACK && request.method === 'GET') {
      try {
        const flow = unpack(readCookie(request, FLOW));
        const state = u.searchParams.get('state'); const code = u.searchParams.get('code');
        if (!opaque.test(state ?? '') || !opaque.test(code ?? '') || state !== flow.state || !opaque.test(flow.verifier)) throw Error('state');
        const result = await transaction(env, state, { action: 'consume', codeHash: await digest(code),
          challenge: await digest(flow.verifier), client: c.client, callback: c.callback });
        if (!result.ok) throw Error('expired');
        const { token } = await sessions.create(result.identity);
        const response = redirect(new URL(result.returnTo, c.receiver).href, cookie(FLOW, '', 0));
        response.headers.append('Set-Cookie', cookie('__Host-pw_session', token, 2592000));
        return response;
      } catch {
        return redirect(c.receiver + '/sign-in?error=sites_bridge_failed', cookie(FLOW, '', 0));
      }
    }
    return failure('Method not allowed.', 405);
  } catch {
    return failure('Login bridge unavailable or request invalid. Restart sign-in from Proofweave.', 400);
  }
}
async function issuer(request, env, fetcher) {
  const u = new URL(request.url);
  const client = u.searchParams.get('client_id'); const state = u.searchParams.get('state');
  const c = issuerClient(env, client);
  if (u.origin !== c.site || !opaque.test(state ?? '')) throw Error('origin');
  // Only Sites dispatch may supply these headers. The direct Worker strips all oai-* headers.
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  let displayName = email;
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { displayName = decodeURIComponent(request.headers.get('oai-authenticated-user-full-name') ?? '') || email; } catch { /* use email */ }
  }
  const identity = { userId, email, displayName };
  if (!validIdentity(identity)) {
    if (request.method !== 'GET') throw Error('identity');
    const login = new URL('/signin-with-chatgpt', c.site);
    login.searchParams.set('return_to', u.pathname + u.search);
    return redirect(login.href);
  }
  if (request.method === 'GET') {
    const csrf = random();
    const consent = await sign({ type: 'consent', state, client, userId, csrf }, c.secret, 600);
    const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue to Proofweave</title><style>body{font:17px system-ui;background:#f6f7f9;color:#172033;max-width:560px;margin:10vh auto;padding:28px}main{background:white;padding:32px;border:1px solid #dce1e8;border-radius:18px}button{font:inherit;background:#253d78;color:white;border:0;border-radius:9px;padding:14px 20px;cursor:pointer}small{overflow-wrap:anywhere;color:#526078}</style><main><h1>Continue to Proofweave</h1><p>Signed in with ChatGPT as <strong>${escape(email)}</strong>.</p><p>Continue to share your Sites account identifier, name and email with your Proofweave account. An existing profile for this same Sites sign-in will be retained.</p><p><small>Destination: ${escape(c.receiver)}</small></p><form method="post" action="${escape(u.pathname + u.search)}"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Continue to Proofweave</button></form><p><a href="${escape(c.receiver + '/sign-in')}">Cancel</a></p></main></html>`;
    // A no-referrer form document makes browsers send Origin: null on POST.
    // Keep same-origin Origin/Referer for CSRF validation; redirects still use no-referrer.
    return new Response(body, { headers: { ...headers, 'Content-Security-Policy': issuerFormPolicy(c.receiver), 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie(CONSENT, consent, 600) } });
  }
  if (request.method !== 'POST' || request.headers.get('Origin') !== c.site) throw Error('csrf');
  const consentCookie = readCookie(request, CONSENT);
  if (!consentCookie) throw Error('consent_missing');
  const consent = await verify(consentCookie, c.secret, 'consent');
  const form = new URLSearchParams(await limitedText(request));
  if (consent.state !== state || consent.client !== client || consent.userId !== userId || consent.csrf !== form.get('csrf')) throw Error('csrf');
  const assertion = await sign({ type: 'identity', site: c.site, siteId: c.siteId, audience: c.receiver,
    client, state, ...identity }, c.secret, 90);
  // Workers supports manual/follow only. Never follow a redirect with an identity assertion.
  const reply = await fetcher(c.receiver + ATTEST, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: assertion,
    signal: AbortSignal.timeout(15000) });
  if (!reply.ok) throw Error('exchange');
  const { code } = await reply.json();
  if (!opaque.test(code ?? '')) throw Error('code');
  const target = new URL(c.callback); target.searchParams.set('state', state); target.searchParams.set('code', code);
  const response = redirect(target.href, cookie(CONSENT, '', 0));
  response.headers.set('Content-Security-Policy', issuerFormPolicy(c.receiver));
  return response;
}
function issuerFormPolicy(receiver) {
  // Chromium applies form-action to the redirect chain, including the receiver's final profile.
  // Admit only the registered receiver origin; the form still submits to this Site.
  return headers['Content-Security-Policy'].replace("form-action 'self'", `form-action 'self' ${receiver}`);
}
function validIdentity(v) {
  return typeof v.userId === 'string' && v.userId.length > 0 && v.userId.length <= 256 &&
    typeof v.email === 'string' && v.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) &&
    typeof v.displayName === 'string' && v.displayName.length > 0 && v.displayName.length <= 160;
}
export async function transaction(env, state, input) {
  if (!opaque.test(state)) throw Error('state');
  const ns = env.SITES_BRIDGE_TRANSACTIONS;
  const reply = await ns.get(ns.idFromName(state)).fetch('https://bridge.internal/', { method: 'POST', body: JSON.stringify(input) });
  if (!reply.ok) return { ok: false };
  return reply.json();
}
/** One object per random transaction; storage transaction makes redemption single-use across requests. */
export class SitesBridgeTransaction {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    const input = await request.json(); const now = Date.now();
    const result = await this.storage.transaction(async tx => {
      const record = await tx.get('flow');
      if (input.action === 'start') {
        if (record) return { ok: false };
        await tx.put('flow', { client: input.client, callback: input.callback, challenge: input.challenge,
          returnTo: relative(input.returnTo), expires: now + 600000, status: 'pending' });
        await tx.setAlarm(now + 600000);
        return { ok: true };
      }
      if (!record || record.expires <= now || input.client !== record.client || input.callback !== record.callback) return { ok: false };
      if (input.action === 'attest' && record.status === 'pending') {
        await tx.put('flow', { ...record, status: 'issued', codeHash: input.codeHash, identity: input.identity,
          expires: Math.min(record.expires, now + 90000) });
        return { ok: true };
      }
      if (input.action === 'consume' && record.status === 'issued' && input.codeHash === record.codeHash && input.challenge === record.challenge) {
        await tx.put('flow', { status: 'consumed', expires: record.expires });
        return { ok: true, identity: record.identity, returnTo: record.returnTo };
      }
      return { ok: false };
    });
    return Response.json(result);
  }
  async alarm() { await this.storage.deleteAll(); }
}
function cookie(name, value, seconds) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`; }
function readCookie(request, name) {
  return (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
function redirect(location, setCookie) {
  return new Response(null, { status: 302, headers: { ...headers, Location: location, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });
}
function failure(message, status) { return new Response(message, { status, headers }); }
function restartPage(receiver, expired) {
  const title = expired ? 'Sign-in confirmation expired' : 'Sign-in could not be completed';
  const detail = expired ? 'This confirmation is valid for 10 minutes. Start a new sign-in from Proofweave.' : 'This request could not be verified. Start a new sign-in from Proofweave; do not reload or resubmit this page.';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:17px system-ui;color:#172033;background:#f6f7f9;max-width:560px;margin:10vh auto;padding:28px}main{background:white;padding:32px;border:1px solid #dce1e8;border-radius:18px}a{display:inline-block;background:#253d78;color:white;border-radius:9px;padding:14px 20px}</style><main><h1>${title}</h1><p>${detail}</p><a href="${escape(receiver + START)}">Restart sign-in</a></main></html>`, { status: 400, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cookie(CONSENT, '', 0) } });
}
function escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function relative(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/profile';
  const u = new URL(value, 'https://local.invalid');
  if (u.origin !== 'https://local.invalid' || /^\/(auth(?:\/|$)|sign-in|signin-with-chatgpt|signout-with-chatgpt|login-bridge|callback)/.test(u.pathname)) return '/profile';
  return u.pathname + u.search;
}
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function unbase64(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
function pack(value) { return base64(encoder.encode(JSON.stringify(value))); }
function unpack(value) { return JSON.parse(new TextDecoder().decode(unbase64(value))); }
function random() { return base64(crypto.getRandomValues(new Uint8Array(32))); }
export async function digest(value) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function key(secret) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function sign(payload, secret, lifetime) {
  const data = pack({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + lifetime });
  return data + '.' + base64(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(data))));
}
async function verify(token, secret, type) {
  if (typeof token !== 'string' || token.length > 6000) throw Error('token');
  const parts = token.split('.');
  if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(secret), unbase64(parts[1]), encoder.encode(parts[0]))) throw Error('signature');
  const p = unpack(parts[0]); const now = Math.floor(Date.now() / 1000); const max = type === 'identity' ? 90 : 600;
  if (p.type !== type || !Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.iat > now + 5 || p.exp <= now || p.exp - p.iat > max || p.exp <= p.iat) throw Error('expiry');
  return p;
}
async function limitedText(request) {
  if (Number(request.headers.get('content-length') ?? 0) > 8192) throw Error('size');
  const reader = request.body?.getReader(); if (!reader) throw Error('body');
  const chunks = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 8192) throw Error('size'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const body = new Uint8Array(length); let offset = 0; for (const part of chunks) { body.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(body);
}
