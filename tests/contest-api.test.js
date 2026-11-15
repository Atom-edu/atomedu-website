import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { contestSchedule, handleRequest, runMaintenance } from '../contest-api/src/index.js';

const BASE = 'https://api.example.test/api/art-contest';
const ORIGIN = 'https://atom-edu.org';
const GIF = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0]);
const OPEN = new Date('2026-07-10T23:00:00Z'); // 18:00 CDT
const JUDGING = new Date('2026-07-11T00:15:00Z'); // 19:15 CDT
const DELAY = new Date('2026-07-11T01:31:00Z'); // 20:31 CDT

function makeEnv() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../contest-api/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() { return { meta: { changes: sqlite.prepare(sql).run(...this.values).changes } }; },
        runSync() { return { meta: { changes: sqlite.prepare(sql).run(...this.values).changes } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.runSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const objects = new Map();
  const IMAGES = {
    async put(key, bytes) { objects.set(key, new Uint8Array(bytes)); },
    async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
    async delete(key) { objects.delete(key); },
  };
  const env = { DB, IMAGES, ALLOWED_ORIGIN: ORIGIN,
    JUDGING_PASSWORD: crypto.randomUUID(), SESSION_SECRET: crypto.randomUUID() };
  return { env, sqlite, objects };
}

function request(path, { method = 'GET', body, token, origin = ORIGIN, ip = '203.0.113.10' } = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  return new Request(`${BASE}${path}`, { method, headers, body });
}

function form(image = new File([GIF], 'art.gif', { type: 'image/gif' })) {
  const data = new FormData();
  data.set('name', 'A painter');
  data.set('image', image);
  data.set('termsAccepted', 'true');
  data.set('displayConsent', 'true');
  return data;
}

async function call(env, path, options, now = OPEN) {
  return handleRequest(request(path, options), env, now, () => now);
}

async function login(env, now = JUDGING) {
  const res = await call(env, '/judging/login', { method: 'POST', body: { password: env.JUDGING_PASSWORD } }, now);
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

test('Central schedule honors DST and phase boundaries', () => {
  assert.deepEqual(contestSchedule(new Date('2026-03-08T23:59:00Z')), {
    phase: 'open', contestDate: '2026-03-08',
    deadlineUtc: '2026-03-09T00:00:00.000Z', nextOpenUtc: '2026-03-09T02:30:00.000Z',
  });
  assert.equal(contestSchedule(new Date('2026-03-09T00:00:00Z')).phase, 'judging');
  assert.equal(contestSchedule(new Date('2026-03-09T01:30:00Z')).phase, 'results_pending');
  assert.equal(contestSchedule(new Date('2026-03-09T02:30:00Z')).contestDate, '2026-03-09');
  assert.equal(contestSchedule(new Date('2026-11-02T00:59:00Z')).deadlineUtc, '2026-11-02T01:00:00.000Z');
  assert.equal(contestSchedule(new Date('2026-11-02T03:30:00Z')).contestDate, '2026-11-02');
});

test('login uses signed expiring bearer tokens, explicit CORS, and rate limits', async () => {
  const { env } = makeEnv();
  const rejected = await call(env, '/judging/login', { method: 'POST', body: { password: 'wrong' } }, JUDGING);
  assert.equal(rejected.status, 401);
  const token = await login(env);
  const listed = await call(env, '/judging/submissions', { token }, JUDGING);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await listed.json(), { submissions: [], winnerId: null, winnerName: null });
  assert.equal((await call(env, '/judging/submissions', { token: `${token}x` }, JUDGING)).status, 401);
  assert.equal((await call(env, '/judging/submissions', { token }, new Date(JUDGING.getTime() + 8 * 3600_000))).status, 401);
  assert.equal((await call(env, '/judging/submissions', {}, JUDGING)).status, 401);
  assert.equal((await call(env, '/judging/login', { method: 'POST', origin: 'https://evil.test',
    body: { password: env.JUDGING_PASSWORD } }, JUDGING)).status, 403);
  let last;
  for (let i = 0; i < 9; i++) last = await call(env, '/judging/login', { method: 'POST', body: { password: 'wrong' } }, JUDGING);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('Retry-After')) > 0);
});

test('uploads enforce consent, magic bytes, size, and private entrant images', async () => {
  const { env, sqlite, objects } = makeEnv();
  const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'image.svg', { type: 'image/svg+xml' });
  assert.equal((await call(env, '/submissions', { method: 'POST', body: form(svg) })).status, 415);
  const spoofed = new File([GIF], 'art.png', { type: 'image/png' });
  assert.equal((await call(env, '/submissions', { method: 'POST', body: form(spoofed) })).status, 415);
  const tooLarge = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.gif', { type: 'image/gif' });
  assert.equal((await call(env, '/submissions', { method: 'POST', body: form(tooLarge) })).status, 400);
  const missingConsent = form();
  missingConsent.set('displayConsent', 'false');
  assert.equal((await call(env, '/submissions', { method: 'POST', body: missingConsent })).status, 400);
  const oversizedRequest = new Request(`${BASE}/submissions`, { method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.10',
      'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(9 * 1024 * 1024 + 1) },
    body: 'x' });
  assert.equal((await handleRequest(oversizedRequest, env, OPEN, () => OPEN)).status, 413);
  const submitted = await call(env, '/submissions', { method: 'POST', body: form() });
  assert.equal(submitted.status, 201);
  const { id, contestDate } = await submitted.json();
  assert.equal(contestDate, '2026-07-10');
  const consent = sqlite.prepare('SELECT terms_version, terms_accepted_at, display_consent FROM submissions WHERE id = ?').get(id);
  assert.equal(consent.terms_version, '2026-11-14');
  assert.equal(consent.terms_accepted_at, OPEN.toISOString());
  assert.equal(consent.display_consent, 1);
  assert.equal(objects.size, 1);
  assert.equal((await call(env, `/judging/images/${id}`, {}, OPEN)).status, 401);
  assert.equal((await call(env, `/images/${id}`, {}, OPEN)).status, 404);
  const token = await login(env);
  const listing = await (await call(env, '/judging/submissions', { token }, OPEN)).json();
  assert.equal(listing.submissions[0].imageUrl, `${BASE}/judging/images/${id}`);
  const privateImage = await call(env, `/judging/images/${id}`, { token }, OPEN);
  assert.equal(privateImage.status, 200);
  assert.deepEqual(new Uint8Array(await privateImage.arrayBuffer()), GIF);
  assert.equal((await call(env, '/submissions', { method: 'POST', body: form() }, JUDGING)).status, 409);
});

test('failed submission queues an orphaned private image when immediate deletion fails', async () => {
  const { env, sqlite, objects } = makeEnv();
  const prepare = env.DB.prepare;
  const deleteImage = env.IMAGES.delete;
  env.DB.prepare = (sql) => /^INSERT INTO submissions\b/.test(sql.trim())
    ? { bind() { return { async run() { throw new Error('test D1 write failure'); } }; } }
    : prepare(sql);
  env.IMAGES.delete = async () => { throw new Error('test R2 delete failure'); };
  const result = await call(env, '/submissions', { method: 'POST', body: form() });
  assert.equal(result.status, 500);
  assert.equal(objects.size, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM image_cleanup').get().count, 1);
  env.DB.prepare = prepare;
  env.IMAGES.delete = deleteImage;
  await runMaintenance(env, JUDGING);
  assert.equal(objects.size, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM image_cleanup').get().count, 0);
});

test('judge confirms one winner in delay window; archive is immediate and losers are removed', async () => {
  const { env, sqlite, objects } = makeEnv();
  const first = await (await call(env, '/submissions', { method: 'POST', body: form() })).json();
  const second = await (await call(env, '/submissions', { method: 'POST', body: form() })).json();
  const token = await login(env, DELAY);
  const before = await (await call(env, '/state', {}, DELAY)).json();
  assert.equal(before.phase, 'results_pending');
  assert.equal(before.latestWinner, null);
  const chosen = await call(env, '/judging/winners', {
    method: 'POST', token, body: { id: first.id, date: first.contestDate },
  }, DELAY);
  assert.equal(chosen.status, 201);
  const { winner } = await chosen.json();
  assert.equal(winner.id, first.id);
  assert.equal(winner.imageUrl, `${BASE}/images/${first.id}`);
  const after = await (await call(env, '/state', {}, DELAY)).json();
  assert.deepEqual(after.latestWinner, winner);
  assert.deepEqual(after.archive, [winner]);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
  assert.equal(sqlite.prepare('SELECT display_consent FROM winners').get().display_consent, 1);
  assert.equal(sqlite.prepare('SELECT terms_version FROM winners').get().terms_version, '2026-11-14');
  const judged = await (await call(env, '/judging/submissions', { token }, DELAY)).json();
  assert.deepEqual(judged, { submissions: [], winnerId: first.id, winnerName: 'A painter' });
  assert.equal(objects.size, 1);
  const publicImage = await call(env, `/images/${first.id}`, {}, DELAY);
  assert.equal(publicImage.status, 200);
  assert.deepEqual(new Uint8Array(await publicImage.arrayBuffer()), GIF);
  assert.equal((await call(env, `/judging/images/${first.id}`, { token }, DELAY)).status, 200);
  assert.equal((await call(env, `/images/${second.id}`, {}, DELAY)).status, 404);
  assert.equal((await call(env, '/judging/winners', {
    method: 'POST', token, body: { id: second.id, date: second.contestDate },
  }, DELAY)).status, 409);
  assert.equal((await call(env, '/judging/winners', {
    method: 'POST', token, body: { id: second.id, date: second.contestDate },
  }, new Date('2026-07-11T02:30:00Z'))).status, 409);
});

test('judge deletion removes the private image and D1 row', async () => {
  const { env, sqlite, objects } = makeEnv();
  const { id } = await (await call(env, '/submissions', { method: 'POST', body: form() })).json();
  const token = await login(env);
  const result = await call(env, `/judging/submissions/${id}`, { method: 'DELETE', token }, JUDGING);
  assert.equal(result.status, 200);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
  assert.equal(objects.size, 0);
  assert.equal((await call(env, `/judging/images/${id}`, { token }, JUDGING)).status, 404);
  await worker.scheduled(null, env);
});

test('cleanup retries failed R2 deletion and expires entries with no winner', async () => {
  const { env, sqlite, objects } = makeEnv();
  const first = await (await call(env, '/submissions', { method: 'POST', body: form() })).json();
  await call(env, '/submissions', { method: 'POST', body: form() });
  const token = await login(env);
  const originalDelete = env.IMAGES.delete;
  let failOnce = true;
  env.IMAGES.delete = async key => {
    if (failOnce) { failOnce = false; throw new Error('temporary R2 failure'); }
    await originalDelete(key);
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const chosen = await call(env, '/judging/winners', {
      method: 'POST', token, body: { id: first.id, date: first.contestDate },
    }, JUDGING);
    assert.equal(chosen.status, 201);
  } finally {
    console.error = originalError;
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM image_cleanup').get().n, 1);
  assert.equal(objects.size, 2);
  await runMaintenance(env, DELAY);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM image_cleanup').get().n, 0);
  assert.equal(objects.size, 1);

  const noWinner = await (await call(env, '/submissions', { method: 'POST', body: form() },
    new Date('2026-07-11T03:00:00Z'))).json();
  assert.equal(noWinner.contestDate, '2026-07-11');
  await runMaintenance(env, new Date('2026-07-12T03:00:00Z'));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
  assert.equal(objects.size, 1);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM winners').get().n, 1);
});

test('submission protection limits bursts without an hourly or daily entry cap', async () => {
  const { env } = makeEnv();
  for (let i = 0; i < 10; i++) {
    assert.equal((await call(env, '/submissions', { method: 'POST', body: form() }, OPEN)).status, 201);
  }
  const burst = await call(env, '/submissions', { method: 'POST', body: form() }, OPEN);
  assert.equal(burst.status, 429);
  assert.ok(Number(burst.headers.get('Retry-After')) > 0);
  assert.equal((await call(env, '/submissions', { method: 'POST', body: form() },
    new Date(OPEN.getTime() + 60_000))).status, 201);
  assert.equal((await call(env, '/submissions', { method: 'POST', body: form() },
    new Date(OPEN.getTime() + 59 * 60_000))).status, 201);
});
