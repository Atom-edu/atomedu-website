import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../contact-api/src/index.js';

const BASE = 'https://contact.example.test/api/contact';
const ORIGIN = 'https://atom-edu.org';
const NOW = new Date('2026-11-21T23:30:00.000Z');

function makeEnv() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../contact-api/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() { return { meta: { changes: sqlite.prepare(sql).run(...this.values).changes } }; },
      };
    },
  };
  return {
    sqlite,
    env: {
      DB,
      ALLOWED_ORIGIN: ORIGIN,
      MANAGER_PASSWORD: 'a-secure-contact-password',
      SESSION_SECRET: 'session-secret-that-is-longer-than-thirty-two-characters',
      IP_HASH_SECRET: 'ip-hash-secret-that-is-longer-than-thirty-two-characters',
    },
  };
}

function request(path, { method = 'GET', body, token, origin = ORIGIN, ip = '203.0.113.12' } = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  let requestBody;
  if (body !== undefined) {
    requestBody = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  return new Request(`${BASE}${path}`, { method, headers, body: requestBody });
}

async function call(env, path, options = {}) {
  return handleRequest(request(path, options), env, () => NOW);
}

async function json(response) {
  return response.json();
}

async function login(env) {
  const response = await call(env, '/login', { method: 'POST', body: { password: env.MANAGER_PASSWORD } });
  assert.equal(response.status, 200);
  return (await json(response)).token;
}

test('public contact submissions accept only a title and body', async () => {
  const { env, sqlite } = makeEnv();
  const response = await call(env, '/messages', { method: 'POST', body: { title: 'Graph issue', body: 'The curve disappears after zooming.' } });
  assert.equal(response.status, 201);
  const saved = sqlite.prepare('SELECT title, body, acknowledged FROM contact_messages').get();
  assert.deepEqual({ ...saved }, { title: 'Graph issue', body: 'The curve disappears after zooming.', acknowledged: 0 });

  const withName = await call(env, '/messages', { method: 'POST', body: { title: 'Hello', body: 'World', name: 'Not collected' }, ip: '203.0.113.13' });
  assert.equal(withName.status, 400);
  assert.equal((await json(withName)).error, 'invalid_fields');
});

test('manager authentication protects the complete inbox', async () => {
  const { env } = makeEnv();
  await call(env, '/messages', { method: 'POST', body: { title: 'First', body: 'One' }, ip: '203.0.113.21' });
  await call(env, '/messages', { method: 'POST', body: { title: 'Second', body: 'Two' }, ip: '203.0.113.22' });

  const unauthorized = await call(env, '/messages');
  assert.equal(unauthorized.status, 401);

  const token = await login(env);
  const response = await call(env, '/messages', { token });
  assert.equal(response.status, 200);
  const data = await json(response);
  assert.equal(data.messages.length, 2);
  assert.deepEqual(data.messages.map((message) => message.title).sort(), ['First', 'Second']);
  assert.ok(data.messages.every((message) => !Object.hasOwn(message, 'name')));
});

test('manager can acknowledge and reopen a message', async () => {
  const { env } = makeEnv();
  const submitted = await json(await call(env, '/messages', { method: 'POST', body: { title: 'Review this', body: 'Details' } }));
  const token = await login(env);
  const path = `/messages/${submitted.id}/acknowledged`;

  const acknowledged = await call(env, path, { method: 'PUT', token, body: { acknowledged: true } });
  assert.equal(acknowledged.status, 200);
  assert.equal((await json(acknowledged)).acknowledged, true);

  const reopened = await call(env, path, { method: 'PUT', token, body: { acknowledged: false } });
  assert.equal(reopened.status, 200);
  assert.equal((await json(reopened)).acknowledgedAt, null);
});

test('contact submissions are rate limited and reject foreign origins', async () => {
  const { env } = makeEnv();
  for (let index = 0; index < 5; index += 1) {
    const response = await call(env, '/messages', { method: 'POST', body: { title: `Message ${index}`, body: 'Details' } });
    assert.equal(response.status, 201);
  }
  const limited = await call(env, '/messages', { method: 'POST', body: { title: 'Sixth', body: 'Details' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);

  const foreign = await call(env, '/messages', { method: 'POST', body: { title: 'No', body: 'No' }, origin: 'https://example.com', ip: '203.0.113.99' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
});

test('contact API validates message lengths and acknowledgement payloads', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/messages', { method: 'POST', body: { title: '', body: 'Body' } })).status, 400);
  assert.equal((await call(env, '/messages', { method: 'POST', body: { title: 'Title', body: 'x'.repeat(5001) }, ip: '203.0.113.44' })).status, 400);
  const token = await login(env);
  const invalid = await call(env, '/messages/00000000-0000-0000-0000-000000000000/acknowledged', {
    method: 'PUT', token, body: { acknowledged: 'yes' },
  });
  assert.equal(invalid.status, 400);
});
