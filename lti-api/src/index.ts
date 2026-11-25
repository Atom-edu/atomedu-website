import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

interface Env {
  DB: D1Database;
  SITE_ORIGIN: string;
  LTI_KEY_ID: string;
  LTI_PRIVATE_KEY: string;
  LTI_PUBLIC_JWK: string;
}

type Platform = {
  issuer: string; client_id: string; auth_url: string; token_url: string;
  jwks_url: string; service_origin: string; active: number;
};
type Deployment = { active: number };
type LaunchState = {
  nonce: string; issuer: string; client_id: string; target_uri: string; expires_at: number;
};
type Session = {
  issuer: string; client_id: string; deployment_id: string; subject: string;
  roles: string; context_id: string; resource_link_id: string;
  services_json: string; deep_link_json: string; expires_at: number;
};
type LtiClaims = {
  nonce?: string;
  [key: string]: unknown;
};

const LTI = 'https://purl.imsglobal.org/spec/lti/claim/';
const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/';
const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
const NRPS = 'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice';
const COOKIE = 'atom_lti_session';
const MAX_FORM = 64_000;
const SESSION_SECONDS = 2 * 60 * 60;
const STATE_SECONDS = 10 * 60;

function fail(message: string, status = 400): Response {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function claim<T>(payload: LtiClaims, name: string): T | undefined { return payload[name] as T | undefined; }
function cookie(request: Request, name: string): string {
  return request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
function cookieHeader(name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=None`;
}
function sameOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
async function form(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) throw new Error('Expected form submission');
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_FORM) throw new Error('Form is too large');
  const body = await request.text();
  if (body.length > MAX_FORM) throw new Error('Form is too large');
  return new URLSearchParams(body);
}
function exactHttps(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid HTTPS URL');
  return url;
}
function validTarget(value: string, origin: string): boolean {
  try {
    const url = exactHttps(value);
    return url.origin === origin && /^\/lti\/(launch|resource)$/.test(url.pathname) && !url.search;
  } catch { return false; }
}
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
function framePolicy(origin: string): string {
  return `default-src 'none'; form-action 'self' ${origin}; frame-ancestors ${origin}; base-uri 'none'; style-src 'unsafe-inline'`;
}
async function privateKey(env: Env): Promise<CryptoKey> {
  if (!env.LTI_PRIVATE_KEY) throw new Error('Signing key is not configured');
  return importPKCS8(env.LTI_PRIVATE_KEY, 'RS256');
}

async function login(request: Request, env: Env): Promise<Response> {
  const params = request.method === 'POST' ? await form(request) : new URL(request.url).searchParams;
  const issuer = params.get('iss') ?? '';
  const clientId = params.get('client_id') ?? '';
  const loginHint = params.get('login_hint') ?? '';
  const target = params.get('target_link_uri') ?? '';
  if (!issuer || !clientId || !loginHint || !validTarget(target, new URL(request.url).origin)) return fail('Invalid LTI login');
  const platform = await env.DB.prepare('SELECT * FROM platforms WHERE issuer = ? AND client_id = ? AND active = 1').bind(issuer, clientId).first<Platform>();
  if (!platform) return fail('Canvas installation is not registered', 403);
  exactHttps(platform.auth_url);
  const state = token();
  const nonce = token();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO launch_states (state_hash, nonce, issuer, client_id, target_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await hash(state), nonce, issuer, clientId, target, now + STATE_SECONDS).run();
  const destination = new URL(platform.auth_url);
  destination.searchParams.set('scope', 'openid');
  destination.searchParams.set('response_type', 'id_token');
  destination.searchParams.set('response_mode', 'form_post');
  destination.searchParams.set('prompt', 'none');
  destination.searchParams.set('client_id', clientId);
  destination.searchParams.set('redirect_uri', new URL('/lti/launch', request.url).href);
  destination.searchParams.set('login_hint', loginHint);
  destination.searchParams.set('state', state);
  destination.searchParams.set('nonce', nonce);
  const hint = params.get('lti_message_hint');
  if (hint) destination.searchParams.set('lti_message_hint', hint);
  return new Response(null, {
    status: 302,
    headers: { Location: destination.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  });
}

async function launch(request: Request, env: Env): Promise<Response> {
  const params = await form(request);
  const state = params.get('state') ?? '';
  const jwt = params.get('id_token') ?? '';
  if (!state || !jwt) return fail('Invalid LTI state', 403);
  const stateHash = await hash(state);
  const pending = await env.DB.prepare('DELETE FROM launch_states WHERE state_hash = ? AND expires_at > ? RETURNING nonce, issuer, client_id, target_uri, expires_at')
    .bind(stateHash, Math.floor(Date.now() / 1000)).first<LaunchState>();
  if (!pending) return fail('Expired or repeated LTI launch', 403);
  const platform = await env.DB.prepare('SELECT * FROM platforms WHERE issuer = ? AND client_id = ? AND active = 1')
    .bind(pending.issuer, pending.client_id).first<Platform>();
  if (!platform) return fail('Canvas installation is disabled', 403);
  const jwksUrl = exactHttps(platform.jwks_url);
  // The URL comes only from an administrator controlled registration.
  const jwks = createRemoteJWKSet(jwksUrl);
  let payload: LtiClaims;
  try {
    const verified = await jwtVerify(jwt, jwks, {
      issuer: platform.issuer, audience: platform.client_id, algorithms: ['RS256'],
      clockTolerance: '60s', maxTokenAge: '10m'
    });
    payload = verified.payload as LtiClaims;
  } catch { return fail('Canvas signature or claims were invalid', 403); }
  if (payload.nonce !== pending.nonce || (payload.azp && payload.azp !== platform.client_id)) return fail('Invalid LTI nonce or audience', 403);
  if (Array.isArray(payload.aud) && (payload.aud.length !== 1 || payload.aud[0] !== platform.client_id)) return fail('Unexpected LTI audience', 403);
  if (claim<string>(payload, LTI + 'version') !== '1.3.0') return fail('Unsupported LTI version', 403);
  const messageType = claim<string>(payload, LTI + 'message_type');
  if (messageType !== 'LtiResourceLinkRequest' && messageType !== 'LtiDeepLinkingRequest') return fail('Unsupported LTI message', 403);
  if (claim<string>(payload, LTI + 'target_link_uri') !== pending.target_uri) return fail('LTI target mismatch', 403);
  const deploymentId = claim<string>(payload, LTI + 'deployment_id');
  const roles = claim<string[]>(payload, LTI + 'roles');
  if (!deploymentId || !Array.isArray(roles) || !roles.every(role => typeof role === 'string') || !payload.sub) return fail('Missing required LTI claims', 403);
  const deployment = await env.DB.prepare('SELECT active FROM deployments WHERE issuer = ? AND client_id = ? AND deployment_id = ?')
    .bind(platform.issuer, platform.client_id, deploymentId).first<Deployment>();
  if (!deployment?.active) return fail('Canvas deployment is not registered', 403);
  const context = claim<{ id?: string }>(payload, LTI + 'context');
  const resource = claim<{ id?: string }>(payload, LTI + 'resource_link');
  const deepLink = claim<Record<string, unknown>>(payload, DL + 'deep_linking_settings');
  if (messageType === 'LtiResourceLinkRequest' && !resource?.id) return fail('Resource link is missing', 403);
  if (messageType === 'LtiDeepLinkingRequest' && (!roles.some(role => /#(Instructor|Administrator)$/.test(role)) || !deepLink?.deep_link_return_url)) return fail('Deep Linking requires an instructor', 403);
  const session = token();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions (session_hash, issuer, client_id, deployment_id, subject, roles, context_id, resource_link_id, services_json, deep_link_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(await hash(session), platform.issuer, platform.client_id, deploymentId, payload.sub, JSON.stringify(roles), context?.id ?? '', resource?.id ?? '',
      JSON.stringify({ ags: claim(payload, AGS) ?? null, nrps: claim(payload, NRPS) ?? null }), JSON.stringify(messageType === 'LtiDeepLinkingRequest' ? deepLink : null), now + SESSION_SECONDS).run();
  // Canvas often opens assignment selection in an iframe where third-party
  // cookies are blocked. Render the launch response directly and carry the
  // opaque session only in the same-origin Deep Linking form.
  const rendered = messageType === 'LtiDeepLinkingRequest'
    ? await selectPage(session, env)
    : await resourcePage(session, env);
  rendered.headers.append('Set-Cookie', cookieHeader(COOKIE, session, SESSION_SECONDS));
  return rendered;
}

async function sessionFor(request: Request, env: Env): Promise<Session | null> {
  return sessionForToken(cookie(request, COOKIE), env);
}
async function sessionForToken(value: string, env: Env): Promise<Session | null> {
  if (!value) return null;
  return env.DB.prepare('SELECT * FROM sessions WHERE session_hash = ? AND expires_at > ?')
    .bind(await hash(value), Math.floor(Date.now() / 1000)).first<Session>();
}
function instructor(session: Session): boolean {
  return (JSON.parse(session.roles) as string[]).some(role => /#(Instructor|Administrator)$/.test(role));
}
function page(content: string, platformOrigin: string): Response {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>atomEDU in Canvas</title><style>body{font:16px system-ui;background:#fbfaf7;color:#20242b;margin:0;padding:clamp(24px,5vw,70px)}main{max-width:750px;margin:auto}h1{font-size:clamp(32px,5vw,54px)}a,button{color:#175d9b}button{padding:14px 20px;background:#fff;border:1px solid #aaa;border-radius:4px;cursor:pointer}p{line-height:1.6}</style><main>${content}</main></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': framePolicy(platformOrigin), 'X-Content-Type-Options': 'nosniff' } });
}
async function platformFor(session: Session, env: Env): Promise<Platform> {
  const platform = await env.DB.prepare('SELECT * FROM platforms WHERE issuer = ? AND client_id = ? AND active = 1')
    .bind(session.issuer, session.client_id).first<Platform>();
  if (!platform) throw new Error('Platform is unavailable');
  return platform;
}
async function resourcePage(sessionToken: string, env: Env): Promise<Response> {
  const session = await sessionForToken(sessionToken, env);
  if (!session) return fail('Launch atomEDU from Canvas first', 401);
  const prefix = instructor(session) ? '/teachers' : '/proof-lab';
  const platform = await platformFor(session, env);
  return page(`<h1>atomEDU</h1><p>Canvas launch verified.</p><p><a href="${env.SITE_ORIGIN}${prefix}" target="_blank" rel="noopener">Open atomEDU</a></p>`, platform.service_origin);
}
async function resource(request: Request, env: Env): Promise<Response> {
  const token = cookie(request, COOKIE);
  return resourcePage(token, env);
}
async function selectPage(sessionToken: string, env: Env): Promise<Response> {
  const session = await sessionForToken(sessionToken, env);
  if (!session || !instructor(session) || session.deep_link_json === 'null') return fail('Instructor launch required', 403);
  const platform = await platformFor(session, env);
  return page(`<h1>Choose an atomEDU activity</h1><form method="post" action="/lti/select"><input type="hidden" name="session" value="${htmlEscape(sessionToken)}"><button name="resource" value="proof-lab">Proof Lab</button><button name="resource" value="teachers">atomEDU for Teachers</button></form>`, platform.service_origin);
}
async function select(request: Request, env: Env): Promise<Response> {
  return selectPage(cookie(request, COOKIE), env);
}
async function choose(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return fail('Invalid request origin', 403);
  const data = await form(request);
  const session = await sessionForToken(data.get('session') ?? cookie(request, COOKIE), env);
  if (!session || !instructor(session) || session.deep_link_json === 'null') return fail('Instructor launch required', 403);
  const kind = data.get('resource');
  if (kind !== 'proof-lab' && kind !== 'teachers') return fail('Unknown activity');
  const settings = JSON.parse(session.deep_link_json) as { deep_link_return_url?: string; data?: string; accept_types?: string[] };
  if (!settings.deep_link_return_url || !settings.accept_types?.includes('ltiResourceLink')) return fail('Canvas cannot accept this link');
  const returnUrl = exactHttps(settings.deep_link_return_url);
  const platform = await platformFor(session, env);
  if (returnUrl.origin !== platform.service_origin) return fail('Invalid Canvas return URL', 403);
  const now = Math.floor(Date.now() / 1000);
  const signed = await new SignJWT({
    [LTI + 'message_type']: 'LtiDeepLinkingResponse',
    [LTI + 'version']: '1.3.0',
    [LTI + 'deployment_id']: session.deployment_id,
    [DL + 'content_items']: [{
      type: 'ltiResourceLink', title: kind === 'proof-lab' ? 'atomEDU Proof Lab' : 'atomEDU for Teachers',
      url: new URL('/lti/resource', request.url).href,
      custom: { atom_resource: kind }
    }],
    ...(settings.data ? { [DL + 'data']: settings.data } : {})
  }).setProtectedHeader({ alg: 'RS256', kid: env.LTI_KEY_ID, typ: 'JWT' })
    .setIssuer(session.client_id).setAudience(session.issuer).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(await privateKey(env));
  return page(`<h1>Returning to Canvas</h1><p>Your activity is ready. Select the button to add it to Canvas.</p><form method="post" action="${htmlEscape(returnUrl.href)}"><input type="hidden" name="JWT" value="${htmlEscape(signed)}"><button type="submit">Finish adding activity</button></form>`, platform.service_origin);
}
async function serviceToken(session: Session, platform: Platform, scope: string, env: Env): Promise<string> {
  const endpoint = exactHttps(platform.token_url);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: env.LTI_KEY_ID, typ: 'JWT' })
    .setIssuer(session.client_id).setSubject(session.client_id).setAudience(endpoint.href)
    .setIssuedAt(now).setExpirationTime(now + 300).setJti(crypto.randomUUID())
    .sign(await privateKey(env));
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope
  });
  const response = await fetch(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error' });
  if (!response.ok) throw new Error('Canvas rejected service authorization');
  if (Number(response.headers.get('Content-Length') ?? 0) > 8192) throw new Error('Canvas token response too large');
  const result = await response.json() as { access_token?: string; token_type?: string; scope?: string };
  if (!result.access_token || result.token_type?.toLowerCase() !== 'bearer' || !result.scope?.split(' ').includes(scope)) throw new Error('Invalid Canvas service token');
  return result.access_token;
}
function serviceUrl(raw: unknown, platform: Platform): URL {
  if (typeof raw !== 'string') throw new Error('LTI service URL is missing');
  const url = exactHttps(raw);
  if (url.origin !== platform.service_origin) throw new Error('LTI service origin mismatch');
  return url;
}
async function roster(request: Request, env: Env): Promise<Response> {
  const session = await sessionFor(request, env);
  if (!session || !instructor(session)) return fail('Instructor launch required', 403);
  const platform = await platformFor(session, env);
  const services = JSON.parse(session.services_json) as { nrps?: { context_memberships_url?: string } };
  const url = serviceUrl(services.nrps?.context_memberships_url, platform);
  const scope = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';
  const access = await serviceToken(session, platform, scope, env);
  const response = await fetch(url.href, {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json' },
    redirect: 'error'
  });
  if (!response.ok) throw new Error('Canvas roster request failed');
  if (Number(response.headers.get('Content-Length') ?? 0) > 1_000_000) throw new Error('Canvas roster is too large');
  const data = await response.json();
  return json(data);
}
async function grade(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return fail('Invalid request origin', 403);
  const session = await sessionFor(request, env);
  if (!session || !instructor(session) || !session.resource_link_id) return fail('Instructor assignment launch required', 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return fail('Expected JSON');
  if (Number(request.headers.get('Content-Length') ?? 0) > 8192) return fail('Request is too large', 413);
  const body = await request.text();
  if (body.length > 8192) return fail('Request is too large', 413);
  const input = JSON.parse(body) as { userId?: unknown; scoreGiven?: unknown; scoreMaximum?: unknown };
  if (typeof input.userId !== 'string' || !input.userId || input.userId.length > 255 ||
    typeof input.scoreGiven !== 'number' || typeof input.scoreMaximum !== 'number' ||
    !Number.isFinite(input.scoreGiven) || !Number.isFinite(input.scoreMaximum) ||
    input.scoreMaximum <= 0 || input.scoreMaximum > 10000 || input.scoreGiven < 0 || input.scoreGiven > input.scoreMaximum) return fail('Invalid grade');
  const platform = await platformFor(session, env);
  const services = JSON.parse(session.services_json) as { ags?: { lineitem?: string; lineitems?: string; scope?: string[] } };
  if (!services.ags?.scope?.includes('https://purl.imsglobal.org/spec/lti-ags/scope/score')) return fail('Canvas did not grant score access', 403);
  const lineitem = serviceUrl(services.ags.lineitem, platform);
  const scoreUrl = new URL(lineitem.href.replace(/\/$/, '') + '/scores');
  const scope = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
  const access = await serviceToken(session, platform, scope, env);
  const response = await fetch(scoreUrl.href, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/vnd.ims.lis.v1.score+json' },
    body: JSON.stringify({
      userId: input.userId,
      scoreGiven: input.scoreGiven,
      scoreMaximum: input.scoreMaximum,
      activityProgress: 'Completed',
      gradingProgress: 'FullyGraded',
      timestamp: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error('Canvas grade update failed');
  return json({ ok: true });
}

function canvasConfig(request: Request): Response {
  const origin = new URL(request.url).origin;
  return json({
    title: 'atomEDU',
    description: 'Proof Lab and classroom learning activities',
    oidc_initiation_url: origin + '/lti/login',
    target_link_uri: origin + '/lti/resource',
    public_jwk_url: origin + '/lti/jwks',
    scopes: [
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
      'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly'
    ],
    extensions: [{
      domain: new URL(origin).hostname,
      tool_id: 'atomedu',
      platform: 'canvas.instructure.com',
      privacy_level: 'name_only',
      settings: {
        text: 'atomEDU',
        placements: [
          { placement: 'course_navigation', message_type: 'LtiResourceLinkRequest', target_link_uri: origin + '/lti/resource', text: 'atomEDU', default: 'disabled', windowTarget: '_blank' },
          { placement: 'assignment_selection', message_type: 'LtiDeepLinkingRequest', target_link_uri: origin + '/lti/resource', text: 'Choose atomEDU activity' }
        ]
      }
    }]
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/lti/health' && request.method === 'GET') return json({ ok: true, service: 'atom-lti-api' });
      if (url.pathname === '/lti/config/canvas' && request.method === 'GET') return canvasConfig(request);
      if (url.pathname === '/lti/jwks' && request.method === 'GET') {
        const jwk = JSON.parse(env.LTI_PUBLIC_JWK) as Record<string, unknown>;
        return json({ keys: [{ ...jwk, kid: env.LTI_KEY_ID, alg: 'RS256', use: 'sig' }] });
      }
      if (url.pathname === '/lti/login' && (request.method === 'POST' || request.method === 'GET')) return login(request, env);
      if (url.pathname === '/lti/launch' && request.method === 'POST') return launch(request, env);
      if (url.pathname === '/lti/resource' && request.method === 'GET') return resource(request, env);
      if (url.pathname === '/lti/select' && request.method === 'GET') return select(request, env);
      if (url.pathname === '/lti/select' && request.method === 'POST') return choose(request, env);
      if (url.pathname === '/lti/roster' && request.method === 'GET') return roster(request, env);
      if (url.pathname === '/lti/grade' && request.method === 'POST') return grade(request, env);
      return fail('Not found', 404);
    } catch (error) {
      console.error(JSON.stringify({ event: 'lti_request_failed', path: url.pathname, error: error instanceof Error ? error.name : 'unknown' }));
      return fail('LTI request failed', 400);
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM launch_states WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now)
    ]);
  }
};
