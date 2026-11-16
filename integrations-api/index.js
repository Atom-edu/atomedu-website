const BASE = '/api/integrations';
const PROVIDERS = ['drive', 'notion', 'github', 'dropbox', 'zapier'];
const MAX_BODY = 16 * 1024;
const MAX_DOWNLOAD_URL = 8192;
const MAX_DOWNLOAD_BYTES = 4096;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class ApiError extends Error {
  constructor(status, code, reason) { super(reason); Object.assign(this, { status, code, reason }); }
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers },
});
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const random = size => b64(crypto.getRandomValues(new Uint8Array(size)));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

function originConfig(env) {
  try {
    const origin = new URL(env.ALLOWED_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== origin.href.replace(/\/$/, '')
      || origin.username || origin.password || origin.search || origin.hash) return null;
    return origin.origin;
  } catch { return null; }
}
function oauthConfig(env) {
  const origin = originConfig(env);
  if (!origin || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return null;
  try {
    const api = new URL(env.API_ORIGIN);
    if (api.protocol !== 'https:' || api.origin !== api.href.replace(/\/$/, '')
      || api.username || api.password || api.search || api.hash) return null;
    return { origin, api: api.origin };
  } catch { return null; }
}
function driveConfigured(env) { return Boolean(oauthConfig(env) && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET); }
function downloadConfigured(env) {
  return Boolean(originConfig(env) && typeof env.DOWNLOAD_LIMITER?.limit === 'function'
    && typeof env.DOWNLOAD_BUDGET?.limit === 'function');
}
function cors(request, env) {
  const origin = originConfig(env);
  return request.headers.get('Origin') === origin && origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin' }
    : { Vary: 'Origin' };
}
// The download URL contains its complete, intentionally public graph payload.
// Provider widgets may fetch it from a different browser origin; no credentials are sent.
const publicDownloadCors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Cache-Control, Content-Encoding, Content-Range' };
function requireOrigin(request, env) {
  const origin = originConfig(env);
  if (!origin) throw new ApiError(503, 'service_unavailable', 'missing_config');
  if (request.headers.get('Origin') !== origin) throw new ApiError(403, 'origin_forbidden', 'origin_forbidden');
  return origin;
}
function cookie(request, name) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] || null;
}
function cookieHeader(name, value, age) {
  return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
}
async function key(secret) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(JSON.stringify(value))));
  return `${b64(iv)}.${b64(ciphertext)}`;
}
async function open(value, secret) {
  try {
    if (!value || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
    const [nonce, data] = value.split('.');
    return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(nonce) }, await key(secret), unb64(data))));
  } catch { return null; }
}
async function session(request, env) {
  if (!oauthConfig(env)) return null;
  const data = await open(cookie(request, '__Host-atom_drive'), env.SESSION_SECRET);
  return data?.v === 1 && data.exp > Date.now() && typeof data.token === 'string' && typeof data.csrf === 'string' ? data : null;
}
function validateGraph(graph) {
  if (!record(graph) || !exactKeys(graph, ['v', 'expressions', 'viewport', 'parameters', 'equalAspect', 'xScale', 'yScale', 'gridMode']) || graph.v !== 1
    || !Array.isArray(graph.expressions) || graph.expressions.length > 24) throw new ApiError(400, 'invalid_graph', 'invalid_graph');
  const expressions = graph.expressions.map(row => {
    if (!record(row) || !exactKeys(row, ['expression', 'color', 'visible', 'imported', 'strokeWidth']) || typeof row.expression !== 'string'
      || !row.expression.trim() || row.expression.length > 256 || /[\u0000-\u001f\u007f]/.test(row.expression)
      || (row.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(row.color))
      || (row.visible !== undefined && typeof row.visible !== 'boolean')
      || (row.imported !== undefined && typeof row.imported !== 'boolean')
      || (row.strokeWidth !== undefined && (!Number.isFinite(row.strokeWidth) || row.strokeWidth < 1 || row.strokeWidth > 16)))
      throw new ApiError(400, 'invalid_graph', 'invalid_graph');
    return { expression: row.expression, ...(row.color === undefined ? {} : { color: row.color }),
      ...(row.visible === undefined ? {} : { visible: row.visible }),
      ...(row.imported === undefined ? {} : { imported: row.imported }),
      ...(row.strokeWidth === undefined ? {} : { strokeWidth: row.strokeWidth }) };
  });
  const result = { v: 1, expressions };
  if (graph.viewport !== undefined) {
    if (!record(graph.viewport) || !exactKeys(graph.viewport, ['xMin', 'xMax', 'yMin', 'yMax'])
      || !['xMin', 'xMax', 'yMin', 'yMax'].every(k => Number.isFinite(graph.viewport[k]) && Math.abs(graph.viewport[k]) <= 1e12)
      || graph.viewport.xMin >= graph.viewport.xMax || graph.viewport.yMin >= graph.viewport.yMax) throw new ApiError(400, 'invalid_graph', 'invalid_graph');
    result.viewport = graph.viewport;
  }
  if (graph.parameters !== undefined) {
    if (!record(graph.parameters) || !exactKeys(graph.parameters, ['a', 'b', 'c'])
      || !Object.values(graph.parameters).every(v => Number.isFinite(v) && Math.abs(v) <= 100)) throw new ApiError(400, 'invalid_graph', 'invalid_graph');
    result.parameters = graph.parameters;
  }
  for (const k of ['equalAspect', 'xScale', 'yScale', 'gridMode']) if (graph[k] !== undefined) {
    if (k === 'equalAspect' ? typeof graph[k] !== 'boolean'
      : k === 'gridMode' ? !['cartesian', 'polar'].includes(graph[k])
        : !['linear', 'log'].includes(graph[k])) throw new ApiError(400, 'invalid_graph', 'invalid_graph');
    result[k] = graph[k];
  }
  if (result.gridMode === 'polar' && (result.xScale === 'log' || result.yScale === 'log' || result.equalAspect === false)) throw new ApiError(400, 'invalid_graph', 'invalid_graph');
  return result;
}
async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'content_type', 'application_json_required');
  const length = Number(request.headers.get('Content-Length'));
  if (length > MAX_BODY) throw new ApiError(413, 'request_too_large', 'request_too_large');
  if (!request.body) throw new ApiError(400, 'invalid_json', 'invalid_json');
  const reader = request.body.getReader();
  let size = 0; const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new ApiError(413, 'request_too_large', 'request_too_large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { const value = JSON.parse(decoder.decode(bytes)); if (!record(value)) throw Error(); return value; }
  catch { throw new ApiError(400, 'invalid_json', 'invalid_json'); }
}
async function boundedProviderJson(response, max = 8192) {
  if (!response.ok) throw new ApiError(502, 'provider_error', 'provider_error');
  const reader = response.body?.getReader(); if (!reader) throw new ApiError(502, 'provider_error', 'provider_error');
  let size = 0; const parts = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new ApiError(502, 'provider_error', 'provider_error'); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(decoder.decode(bytes)); } catch { throw new ApiError(502, 'provider_error', 'provider_error'); }
}
function status(request, env, connected, csrf) {
  const providers = Object.fromEntries(PROVIDERS.map(name => [name, name === 'drive'
    ? { available: driveConfigured(env), connected, ...(!driveConfigured(env) ? { reason: 'missing_config' } : {}) }
    : { available: false, connected: false, reason: 'unsupported' }]));
  return json({ providers, download: { available: downloadConfigured(env), ...(!downloadConfigured(env) ? { reason: 'missing_config' } : {}) },
    ...(csrf ? { csrfToken: csrf } : {}) }, 200, cors(request, env));
}
async function download(request, env) {
  if (!downloadConfigured(env))
    throw new ApiError(503, 'download_unavailable', 'missing_config');
  if (request.url.length > MAX_DOWNLOAD_URL) throw new ApiError(414, 'url_too_long', 'url_too_long');
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].length !== 1 || !url.searchParams.has('graph'))
    throw new ApiError(400, 'invalid_request', 'invalid_request');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.DOWNLOAD_LIMITER.limit({ key: ip });
  if (!success) throw new ApiError(429, 'rate_limited', 'rate_limited');
  const budget = await env.DOWNLOAD_BUDGET.limit({ key: 'public-download' });
  if (!budget.success) throw new ApiError(429, 'rate_limited', 'rate_limited');
  const raw = url.searchParams.get('graph');
  if (encoder.encode(raw).byteLength > MAX_DOWNLOAD_BYTES) throw new ApiError(413, 'graph_too_large', 'graph_too_large');
  let value;
  try { value = JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_graph', 'invalid_graph'); }
  const graph = validateGraph(value);
  const content = JSON.stringify(graph);
  if (encoder.encode(content).byteLength > MAX_DOWNLOAD_BYTES) throw new ApiError(413, 'graph_too_large', 'graph_too_large');
  return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="atom-graph.json"', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
    ...publicDownloadCors } });
}
async function start(request, env) {
  if (!driveConfigured(env)) throw new ApiError(503, 'provider_unavailable', 'missing_config');
  const c = oauthConfig(env); const state = random(32), verifier = random(32);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${c.api}${BASE}/oauth/drive/callback`, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'online',
    state, code_challenge: b64(digest), code_challenge_method: 'S256' });
  const pending = await seal({ state, verifier, exp: Date.now() + 600000 }, env.SESSION_SECRET);
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    'Set-Cookie': cookieHeader('__Host-atom_drive_pending', pending, 600), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
async function callback(request, env) {
  if (!driveConfigured(env)) throw new ApiError(503, 'provider_unavailable', 'missing_config');
  const url = new URL(request.url); const pending = await open(cookie(request, '__Host-atom_drive_pending'), env.SESSION_SECRET);
  if (!pending || pending.exp < Date.now() || !url.searchParams.get('state') || url.searchParams.get('state') !== pending.state
    || !url.searchParams.get('code') || url.searchParams.has('error')) throw new ApiError(400, 'oauth_invalid', 'oauth_invalid');
  const c = oauthConfig(env);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${c.api}${BASE}/oauth/drive/callback`,
      grant_type: 'authorization_code', code_verifier: pending.verifier }), redirect: 'error' });
  const token = await boundedProviderJson(tokenResponse);
  if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer'
    || !Number.isFinite(token.expires_in) || token.expires_in < 60 || token.expires_in > 86400)
    throw new ApiError(502, 'provider_error', 'provider_error');
  const ttl = Math.min(token.expires_in - 30, 3600);
  const sealed = await seal({ v: 1, token: token.access_token, csrf: random(32), exp: Date.now() + ttl * 1000 }, env.SESSION_SECRET);
  const headers = new Headers({ Location: `${c.origin}/proof-lab#graph`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', cookieHeader('__Host-atom_drive_pending', '', 0));
  headers.append('Set-Cookie', cookieHeader('__Host-atom_drive', sealed, ttl));
  return new Response(null, { status: 302, headers });
}
async function disconnect(request, env) {
  requireOrigin(request, env);
  const auth = await session(request, env);
  if (!auth) throw new ApiError(401, 'not_connected', 'oauth_required');
  if (request.headers.get('X-CSRF-Token') !== auth.csrf) throw new ApiError(403, 'csrf_invalid', 'csrf_invalid');
  return json({ provider: 'drive', connected: false }, 200, { ...cors(request, env),
    'Set-Cookie': cookieHeader('__Host-atom_drive', '', 0) });
}
async function exportGraph(request, env) {
  requireOrigin(request, env);
  const body = await boundedJson(request);
  if (!exactKeys(body, ['provider', 'graph']) || !PROVIDERS.includes(body.provider)) throw new ApiError(400, 'invalid_request', 'invalid_request');
  if (body.provider !== 'drive') throw new ApiError(501, 'provider_unsupported', 'unsupported');
  if (!driveConfigured(env)) throw new ApiError(503, 'provider_unavailable', 'missing_config');
  const auth = await session(request, env);
  if (!auth) throw new ApiError(401, 'not_connected', 'oauth_required');
  if (request.headers.get('X-CSRF-Token') !== auth.csrf) throw new ApiError(403, 'csrf_invalid', 'csrf_invalid');
  const graph = validateGraph(body.graph);
  const boundary = `atom_${random(16)}`;
  const content = JSON.stringify(graph);
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: `atom-graph-${new Date().toISOString().slice(0, 10)}.json`, mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const upstream = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart, redirect: 'error' });
  const result = await boundedProviderJson(upstream);
  if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(result.id)) throw new ApiError(502, 'provider_error', 'provider_error');
  return json({ provider: 'drive', id: result.id, url: `https://drive.google.com/file/d/${result.id}/view` }, 201, cors(request, env));
}
export default { async fetch(request, env) {
  try {
    const url = new URL(request.url); const path = url.pathname;
    if (path === `${BASE}/status` && request.method === 'GET') {
      const allowed = request.headers.get('Origin') === originConfig(env);
      const auth = allowed ? await session(request, env) : null;
      return status(request, env, Boolean(auth && driveConfigured(env)), driveConfigured(env) ? auth?.csrf : null);
    }
    if (path === `${BASE}/download` && request.method === 'GET') return await download(request, env);
    if (path === `${BASE}/download` && request.method === 'OPTIONS') {
      if (!downloadConfigured(env)) throw new ApiError(503, 'download_unavailable', 'missing_config');
      return new Response(null, { status: 204, headers: { ...publicDownloadCors,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '600' } });
    }
    if (path === `${BASE}/oauth/drive/start` && request.method === 'GET') return await start(request, env);
    if (path === `${BASE}/oauth/drive/callback` && request.method === 'GET') return await callback(request, env);
    if ((path === `${BASE}/exports` || path === `${BASE}/oauth/drive/disconnect`) && request.method === 'OPTIONS') {
      requireOrigin(request, env);
      return new Response(null, { status: 204, headers: { ...cors(request, env),
        'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
        'Access-Control-Max-Age': '600' } });
    }
    if (path === `${BASE}/oauth/drive/disconnect` && request.method === 'POST') return await disconnect(request, env);
    if (path === `${BASE}/exports` && request.method === 'POST') return await exportGraph(request, env);
    return json({ error: 'not_found' }, 404, cors(request, env));
  } catch (error) {
    return error instanceof ApiError ? json({ error: error.code, reason: error.reason }, error.status, cors(request, env))
      : json({ error: 'internal_error' }, 500, cors(request, env));
  }
} };
