const BASE = '/api/contact';
const MAX_JSON_BYTES = 8 * 1024;
const TOKEN_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

class ApiError extends Error {
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function response(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function allowedOrigin(origin, env) {
  if (!origin) return null;
  if (origin === env.ALLOWED_ORIGIN) return origin;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request.headers.get('Origin'), env);
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
}

function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!allowedOrigin(origin, env)) throw new ApiError(403, 'origin_forbidden', 'Origin is not allowed');
}

async function boundedBody(request, maxBytes) {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > maxBytes) throw new ApiError(413, 'request_too_large', 'Request is too large');
  if (!request.body) throw new ApiError(400, 'empty_body', 'Request body is required');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'request_too_large', 'Request is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new ApiError(415, 'content_type', 'Expected JSON');
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(await boundedBody(request, MAX_JSON_BYTES)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json', 'Invalid JSON object');
  }
}

function exactFields(value, fields) {
  const expected = [...fields].sort();
  const received = Object.keys(value).sort();
  return expected.length === received.length && expected.every((field, index) => field === received[index]);
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function equalBytes(a, b) {
  if (a.length === b.length && typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function requireSecrets(env) {
  if (!env.MANAGER_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32
    || !env.IP_HASH_SECRET || env.IP_HASH_SECRET.length < 32) {
    throw new ApiError(503, 'not_configured', 'Contact service secrets are not configured');
  }
}

async function rateLimit(request, env, now, kind, windowSeconds, maximum) {
  requireSecrets(env);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `${kind}:${base64url(await hmac(env.IP_HASH_SECRET, ip))}`;
  const seconds = Math.floor(now.getTime() / 1000);
  const bucket = Math.floor(seconds / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(`INSERT INTO rate_limits (key, bucket, attempts) VALUES (?1, ?2, 1)
    ON CONFLICT(key) DO UPDATE SET bucket = excluded.bucket,
    attempts = CASE WHEN rate_limits.bucket = excluded.bucket THEN rate_limits.attempts + 1 ELSE 1 END
    RETURNING attempts`).bind(key, bucket).first();
  if (row.attempts > maximum) {
    throw new ApiError(429, 'rate_limited', 'Too many requests', bucket + windowSeconds - seconds);
  }
}

async function login(request, env, now) {
  requireSecrets(env);
  await rateLimit(request, env, now, 'login', 15 * 60, 10);
  const value = await jsonBody(request);
  if (!exactFields(value, ['password']) || typeof value.password !== 'string' || value.password.length > 1024) {
    throw new ApiError(400, 'invalid_password', 'Invalid password');
  }
  const [provided, expected] = await Promise.all([digest(value.password), digest(env.MANAGER_PASSWORD)]);
  if (!equalBytes(provided, expected)) throw new ApiError(401, 'invalid_credentials', 'Invalid credentials');
  const expiration = Math.floor(now.getTime() / 1000) + TOKEN_SECONDS;
  const payload = base64url(encoder.encode(JSON.stringify({ v: 1, exp: expiration, nonce: crypto.randomUUID() })));
  const signature = base64url(await hmac(env.SESSION_SECRET, payload));
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiration * 1000).toISOString() };
}

async function requireManager(request, env, now) {
  requireSecrets(env);
  const match = /^Bearer ([A-Za-z0-9_-]{1,700}\.[A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') || '');
  if (!match) throw new ApiError(401, 'unauthorized', 'Bearer token required');
  const [payload, signature] = match[1].split('.');
  try {
    if (!equalBytes(fromBase64url(signature), await hmac(env.SESSION_SECRET, payload))) throw new Error('signature');
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (claims.v !== 1 || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(now.getTime() / 1000)) {
      throw new Error('expired');
    }
  } catch {
    throw new ApiError(401, 'unauthorized', 'Invalid or expired token');
  }
}

function publicMessage(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    acknowledged: row.acknowledged === 1,
    acknowledgedAt: row.acknowledged_at,
  };
}

async function submitMessage(request, env, now) {
  await rateLimit(request, env, now, 'message', 60 * 60, 5);
  const value = await jsonBody(request);
  if (!exactFields(value, ['title', 'body'])) throw new ApiError(400, 'invalid_fields', 'Expected title and body');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const body = typeof value.body === 'string' ? value.body.trim() : '';
  if (!title || title.length > 120 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title)) {
    throw new ApiError(400, 'invalid_title', 'Title must be 1 to 120 characters');
  }
  if (!body || body.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
    throw new ApiError(400, 'invalid_body', 'Message must be 1 to 5000 characters');
  }
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  await env.DB.prepare(`INSERT INTO contact_messages (id, title, body, created_at)
    VALUES (?1, ?2, ?3, ?4)`).bind(id, title, body, createdAt).run();
  return { id, createdAt };
}

async function listMessages(env) {
  const { results } = await env.DB.prepare(`SELECT id, title, body, created_at, acknowledged, acknowledged_at
    FROM contact_messages ORDER BY created_at DESC, id DESC`).all();
  return results.map(publicMessage);
}

async function setAcknowledged(request, env, now, id) {
  const value = await jsonBody(request);
  if (!exactFields(value, ['acknowledged']) || typeof value.acknowledged !== 'boolean') {
    throw new ApiError(400, 'invalid_acknowledgement', 'Acknowledged must be true or false');
  }
  const acknowledgedAt = value.acknowledged ? now.toISOString() : null;
  const result = await env.DB.prepare(`UPDATE contact_messages
    SET acknowledged = ?1, acknowledged_at = ?2 WHERE id = ?3`)
    .bind(value.acknowledged ? 1 : 0, acknowledgedAt, id).run();
  if (!result.meta.changes) throw new ApiError(404, 'not_found', 'Message not found');
  return { id, acknowledged: value.acknowledged, acknowledgedAt };
}

export async function handleRequest(request, env, currentTime = () => new Date()) {
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);
  if (!url.pathname.startsWith(BASE)) return response({ error: 'Not found' }, 404, cors);
  try {
    if (request.method === 'OPTIONS') {
      checkOrigin(request, env);
      return new Response(null, { status: 204, headers: {
        ...cors,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Max-Age': '86400',
      } });
    }
    checkOrigin(request, env);
    const now = currentTime();
    if (url.pathname === `${BASE}/status` && request.method === 'GET') return response({ ok: true }, 200, cors);
    if (url.pathname === `${BASE}/messages` && request.method === 'POST') {
      return response(await submitMessage(request, env, now), 201, cors);
    }
    if (url.pathname === `${BASE}/login` && request.method === 'POST') {
      return response(await login(request, env, now), 200, cors);
    }
    if (url.pathname === `${BASE}/messages` && request.method === 'GET') {
      await requireManager(request, env, now);
      return response({ messages: await listMessages(env) }, 200, cors);
    }
    const acknowledgement = new RegExp(`^${BASE}/messages/([0-9a-f-]{36})/acknowledged$`).exec(url.pathname);
    if (acknowledgement && request.method === 'PUT') {
      await requireManager(request, env, now);
      return response(await setAcknowledged(request, env, now, acknowledgement[1]), 200, cors);
    }
    throw new ApiError(404, 'not_found', 'Not found');
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error(JSON.stringify({ message: 'contact request failed', error: error instanceof Error ? error.message : String(error), path: url.pathname }));
    }
    const handled = error instanceof ApiError ? error : new ApiError(500, 'internal_error', 'Internal server error');
    const headers = { ...cors };
    if (handled.retryAfter) headers['Retry-After'] = String(handled.retryAfter);
    return response({ error: handled.code, message: handled.message }, handled.status, headers);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
