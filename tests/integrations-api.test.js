import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../integrations-api/index.js';

const API = 'https://integrations.atom-edu.org';
const SITE = 'https://atom-edu.org';
const ENV = { API_ORIGIN: API, ALLOWED_ORIGIN: SITE, SESSION_SECRET: 'a-secret-longer-than-thirty-two-characters-for-tests',
  GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret' };
const graph = { v: 1, expressions: [{ expression: 'y=x^2', color: '#123456', visible: true }],
  viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 } };
const req = (path, options = {}) => new Request(`${API}/api/integrations${path}`, options);
const invoke = (path, options = {}, env = ENV) => worker.fetch(req(path, options), env);
const cookieValue = (response, name) => response.headers.getSetCookie().find(c => c.startsWith(`${name}=`))?.split(';')[0];

async function connect(t) {
  const start = await invoke('/oauth/drive/start');
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('Location'));
  assert.equal(auth.origin, 'https://accounts.google.com');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  const pending = cookieValue(start, '__Host-atom_drive_pending');
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(init.body.get('client_secret'), ENV.GOOGLE_CLIENT_SECRET);
    assert.ok(init.body.get('code_verifier'));
    return Response.json({ access_token: 'user-token', token_type: 'Bearer', expires_in: 3600 });
  };
  t.after(() => { globalThis.fetch = previous; });
  const callback = await invoke(`/oauth/drive/callback?code=abc&state=${auth.searchParams.get('state')}`,
    { headers: { Cookie: pending } });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('Location'), `${SITE}/proof-lab#graph`);
  assert.doesNotMatch(callback.headers.get('Location'), /token|code=/);
  return cookieValue(callback, '__Host-atom_drive');
}

test('status enumerates providers and distinguishes config from connection', async () => {
  const response = await invoke('/status', { headers: { Origin: SITE } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.providers.drive, { available: true, connected: false });
  for (const name of ['notion', 'github', 'dropbox', 'zapier'])
    assert.deepEqual(body.providers[name], { available: false, connected: false, reason: 'unsupported' });
  assert.equal(body.csrfToken, undefined);
  const absent = await (await invoke('/status', { headers: { Origin: SITE } }, { ...ENV, GOOGLE_CLIENT_SECRET: undefined })).json();
  assert.deepEqual(absent.providers.drive, { available: false, connected: false, reason: 'missing_config' });
});

test('missing config cannot start OAuth or export; unsupported providers are explicit', async () => {
  const missing = { ...ENV, GOOGLE_CLIENT_SECRET: undefined };
  assert.deepEqual(await (await invoke('/oauth/drive/start', {}, missing)).json(),
    { error: 'provider_unavailable', reason: 'missing_config' });
  const post = provider => ({ method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, graph }) });
  const drive = await invoke('/exports', post('drive'), missing);
  assert.equal(drive.status, 503);
  const notion = await invoke('/exports', post('notion'));
  assert.equal(notion.status, 501);
  assert.deepEqual(await notion.json(), { error: 'provider_unsupported', reason: 'unsupported' });
});

test('state mismatch rejects callback without exchanging a code', async () => {
  const start = await invoke('/oauth/drive/start');
  const previous = globalThis.fetch; globalThis.fetch = () => { throw Error('unexpected upstream call'); };
  try {
    const response = await invoke('/oauth/drive/callback?code=abc&state=wrong',
      { headers: { Cookie: cookieValue(start, '__Host-atom_drive_pending') } });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'oauth_invalid', reason: 'oauth_invalid' });
  } finally { globalThis.fetch = previous; }
});

test('connected export requires exact origin and CSRF, then uploads to fixed Drive API', async t => {
  const sessionCookie = await connect(t);
  const get = await invoke('/status', { headers: { Origin: SITE, Cookie: sessionCookie } });
  const status = await get.json();
  assert.equal(status.providers.drive.connected, true);
  assert.ok(status.csrfToken);
  assert.equal(get.headers.get('Access-Control-Allow-Origin'), SITE);
  const post = (origin, csrf) => ({ method: 'POST', headers: { Origin: origin, Cookie: sessionCookie,
    'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ provider: 'drive', graph }) });
  assert.equal((await invoke('/exports', post('https://evil.example', status.csrfToken))).status, 403);
  assert.equal((await invoke('/exports', post(SITE, 'wrong'))).status, 403);
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink');
    assert.equal(init.headers.Authorization, 'Bearer user-token');
    assert.match(init.body, /y=x\^2/);
    return Response.json({ id: 'file_123' });
  };
  t.after(() => { globalThis.fetch = previous; });
  const exported = await invoke('/exports', post(SITE, status.csrfToken));
  assert.equal(exported.status, 201);
  assert.deepEqual(await exported.json(), { provider: 'drive', id: 'file_123', url: 'https://drive.google.com/file/d/file_123/view' });
});

test('rejects oversized, malformed, and unauthenticated requests before provider calls', async () => {
  const base = { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' } };
  assert.equal((await invoke('/exports', { ...base, body: 'x'.repeat(16385) })).status, 413);
  assert.equal((await invoke('/exports', { ...base, body: '{' })).status, 400);
  assert.equal((await invoke('/exports', { ...base, body: JSON.stringify({ provider: 'drive', graph }) })).status, 401);
  const preflight = await invoke('/exports', { method: 'OPTIONS', headers: { Origin: SITE } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type, X-CSRF-Token');
  assert.equal((await invoke('/exports', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('disconnect clears only the user cookie and requires CSRF', async t => {
  const sessionCookie = await connect(t);
  const status = await (await invoke('/status', { headers: { Origin: SITE, Cookie: sessionCookie } })).json();
  const headers = { Origin: SITE, Cookie: sessionCookie, 'X-CSRF-Token': status.csrfToken };
  assert.equal((await invoke('/oauth/drive/disconnect', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'bad' } })).status, 403);
  const response = await invoke('/oauth/drive/disconnect', { method: 'POST', headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { provider: 'drive', connected: false });
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('valid session still rejects graph fields outside bounded schema', async t => {
  const sessionCookie = await connect(t);
  const status = await (await invoke('/status', { headers: { Origin: SITE, Cookie: sessionCookie } })).json();
  const response = await invoke('/exports', { method: 'POST', headers: { Origin: SITE, Cookie: sessionCookie,
    'Content-Type': 'application/json', 'X-CSRF-Token': status.csrfToken },
    body: JSON.stringify({ provider: 'drive', graph: { ...graph, destinationUrl: 'https://evil.example' } }) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_graph', reason: 'invalid_graph' });
});

test('public download returns bounded JSON with attachment headers and exact CORS', async () => {
  const env = { ...ENV, DOWNLOAD_LIMITER: { async limit({ key }) { assert.equal(key, '203.0.113.4'); return { success: true }; } },
    DOWNLOAD_BUDGET: { async limit({ key }) { assert.equal(key, 'public-download'); return { success: true }; } } };
  const path = `/download?graph=${encodeURIComponent(JSON.stringify(graph))}`;
  const response = await invoke(path, { headers: { Origin: SITE, 'CF-Connecting-IP': '203.0.113.4' } }, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), graph);
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="atom-graph.json"');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE);
  const providerFetch = await invoke(path, {}, { ...env, DOWNLOAD_LIMITER: { async limit() { return { success: true }; } } });
  assert.equal(providerFetch.status, 200);
  assert.equal(providerFetch.headers.get('Access-Control-Allow-Origin'), null);
  const status = await (await invoke('/status', {}, env)).json();
  assert.deepEqual(status.download, { available: true });
});

test('download fails closed without limiter and enforces query, payload, and rate limits', async () => {
  const path = `/download?graph=${encodeURIComponent(JSON.stringify(graph))}`;
  const unavailable = await invoke(path);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'download_unavailable', reason: 'missing_config' });
  const limited = { ...ENV, DOWNLOAD_LIMITER: { async limit() { return { success: false }; } }, DOWNLOAD_BUDGET: { async limit() { return { success: true }; } } };
  assert.equal((await invoke(path, {}, limited)).status, 429);
  const budgetLimited = { ...limited, DOWNLOAD_LIMITER: { async limit() { return { success: true }; } },
    DOWNLOAD_BUDGET: { async limit() { return { success: false }; } } };
  assert.equal((await invoke(path, {}, budgetLimited)).status, 429);
  const env = { ...ENV, DOWNLOAD_LIMITER: { async limit() { return { success: true }; } }, DOWNLOAD_BUDGET: { async limit() { return { success: true }; } } };
  assert.equal((await invoke(`${path}&url=https://evil.example`, {}, env)).status, 400);
  assert.equal((await invoke('/download?graph=%7B', {}, env)).status, 400);
  assert.equal((await invoke(`/download?graph=${encodeURIComponent(JSON.stringify({ ...graph, destinationUrl: 'https://evil.example' }))}`, {}, env)).status, 400);
  assert.equal((await invoke(`/download?graph=${'x'.repeat(8200)}`, {}, env)).status, 414);
  assert.equal((await invoke(`/download?graph=${encodeURIComponent(JSON.stringify({ v: 1, expressions: [{ expression: 'x'.repeat(257) }] }))}`, {}, env)).status, 400);
});

test('read-only download and CORS work without OAuth configuration', async () => {
  const env = { ALLOWED_ORIGIN: SITE,
    DOWNLOAD_LIMITER: { async limit() { return { success: true }; } },
    DOWNLOAD_BUDGET: { async limit() { return { success: true }; } } };
  const path = `/download?graph=${encodeURIComponent(JSON.stringify(graph))}`;
  const statusResponse = await invoke('/status', { headers: { Origin: SITE } }, env);
  const status = await statusResponse.json();
  assert.deepEqual(status.download, { available: true });
  assert.deepEqual(status.providers.drive, { available: false, connected: false, reason: 'missing_config' });
  assert.equal(statusResponse.headers.get('Access-Control-Allow-Origin'), SITE);
  const response = await invoke(path, { headers: { Origin: SITE } }, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), graph);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE);
  const other = await invoke(path, { headers: { Origin: 'https://evil.example' } }, env);
  assert.equal(other.status, 200);
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await invoke('/oauth/drive/start', {}, env)).status, 503);
});

test('download requires a valid exact HTTPS frontend origin', async () => {
  const env = { ALLOWED_ORIGIN: 'https://atom-edu.org/other',
    DOWNLOAD_LIMITER: { async limit() { throw Error('must not use limiter'); } },
    DOWNLOAD_BUDGET: { async limit() { throw Error('must not use budget'); } } };
  const status = await (await invoke('/status', { headers: { Origin: SITE } }, env)).json();
  assert.deepEqual(status.download, { available: false, reason: 'missing_config' });
  const response = await invoke(`/download?graph=${encodeURIComponent(JSON.stringify(graph))}`, {}, env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('download preserves graph drawing metadata without private fields', async () => {
  const env = { ALLOWED_ORIGIN: SITE,
    DOWNLOAD_LIMITER: { async limit() { return { success: true }; } },
    DOWNLOAD_BUDGET: { async limit() { return { success: true }; } } };
  const styled = { ...graph, expressions: [{ expression: 'y=x', imported: true, strokeWidth: 2.2, color: '#abcdef' }] };
  const response = await invoke(`/download?graph=${encodeURIComponent(JSON.stringify(styled))}`, {}, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), styled);
  const injected = { ...styled, expressions: [{ ...styled.expressions[0], privateToken: 'secret' }] };
  assert.equal((await invoke(`/download?graph=${encodeURIComponent(JSON.stringify(injected))}`, {}, env)).status, 400);
});
