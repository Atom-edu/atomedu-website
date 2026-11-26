import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import worker from '../src/index.ts';

const ORIGIN = 'https://lti.atom-edu.org';
const ISSUER = 'https://canvas.instructure.com';
const CLIENT = 'canvas-client-123';
const DEPLOYMENT = 'canvas-deployment-456';
const JWKS = 'https://sso.canvaslms.com/api/lti/security/jwks';
const stateRows = new Map();
const sessionRows = new Map();

function db() {
  return {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async run() {
          if (sql.startsWith('INSERT INTO launch_states')) stateRows.set(args[0], { nonce: args[1], issuer: args[2], client_id: args[3], target_uri: args[4], expires_at: args[5] });
          else if (sql.startsWith('INSERT INTO sessions')) sessionRows.set(args[0], {
            issuer: args[1], client_id: args[2], deployment_id: args[3], subject: args[4],
            roles: args[5], context_id: args[6], resource_link_id: args[7],
            services_json: args[8], deep_link_json: args[9], expires_at: args[10]
          });
          return { success: true };
        },
        async first() {
          if (sql.startsWith('SELECT * FROM platforms')) return {
            issuer: ISSUER, client_id: CLIENT, auth_url: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
            token_url: 'https://school.instructure.com/login/oauth2/token', jwks_url: JWKS,
            service_origin: 'https://school.instructure.com', active: 1
          };
          if (sql.startsWith('SELECT active FROM deployments')) return args[2] === DEPLOYMENT ? { active: 1 } : null;
          if (sql.startsWith('SELECT * FROM sessions')) return sessionRows.get(args[0]) ?? null;
          if (sql.startsWith('DELETE FROM launch_states')) {
            const row = stateRows.get(args[0]);
            stateRows.delete(args[0]);
            return row && row.expires_at > args[1] ? row : null;
          }
          return null;
        }
      };
      return statement;
    }
  };
}
function request(path, params, cookie = '') {
  return new Request(ORIGIN + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(params)
  });
}

test('Canvas launch verifies signature, claims, deployment, state, and replay', async () => {
  stateRows.clear();
  const keys = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(keys.publicKey);
  publicJwk.kid = 'canvas-test';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url) === JWKS) return Response.json({ keys: [publicJwk] });
    throw new Error('Unexpected network request');
  };
  const env = { DB: db(), SITE_ORIGIN: 'https://atom-edu.org', LTI_KEY_ID: 'atom-test' };
  try {
    const login = await worker.fetch(request('/lti/login', {
      iss: ISSUER, client_id: CLIENT, login_hint: 'opaque',
      target_link_uri: ORIGIN + '/lti/resource'
    }), env);
    assert.equal(login.status, 302);
    const auth = new URL(login.headers.get('Location'));
    assert.equal(auth.searchParams.get('response_mode'), 'form_post');
    const state = auth.searchParams.get('state');
    const nonce = auth.searchParams.get('nonce');
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      nonce,
      ['https://purl.imsglobal.org/spec/lti/claim/version']: '1.3.0',
      ['https://purl.imsglobal.org/spec/lti/claim/message_type']: 'LtiResourceLinkRequest',
      ['https://purl.imsglobal.org/spec/lti/claim/deployment_id']: DEPLOYMENT,
      ['https://purl.imsglobal.org/spec/lti/claim/target_link_uri']: ORIGIN + '/lti/resource',
      ['https://purl.imsglobal.org/spec/lti/claim/roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
      ['https://purl.imsglobal.org/spec/lti/claim/resource_link']: { id: 'link-1' }
    };
    const sign = extras => new SignJWT({ ...claims, ...extras })
      .setProtectedHeader({ alg: 'RS256', kid: 'canvas-test' }).setIssuer(ISSUER).setAudience(CLIENT)
      .setSubject('student-1').setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey);
    const wrongNonce = await worker.fetch(request('/lti/launch', { state, id_token: await sign({ nonce: 'wrong' }) }), env);
    assert.equal(wrongNonce.status, 403);
    const replay = await worker.fetch(request('/lti/launch', { state, id_token: await sign({}) }), env);
    assert.equal(replay.status, 403);
    const freshLogin = await worker.fetch(request('/lti/login', {
      iss: ISSUER, client_id: CLIENT, login_hint: 'opaque', target_link_uri: ORIGIN + '/lti/resource'
    }), env);
    const fresh = new URL(freshLogin.headers.get('Location'));
    const good = await worker.fetch(request('/lti/launch', {
      state: fresh.searchParams.get('state'), id_token: await sign({ nonce: fresh.searchParams.get('nonce') })
    }), env);
    assert.equal(good.status, 200);
    assert.match(await good.text(), /Canvas launch verified/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Canvas config exposes the tool registration endpoints', async () => {
  const response = await worker.fetch(new Request(ORIGIN + '/lti/config/canvas'), { DB: db() });
  const config = await response.json();
  assert.equal(config.oidc_initiation_url, ORIGIN + '/lti/login');
  assert.equal(config.public_jwk_url, ORIGIN + '/lti/jwks');
  assert.deepEqual(config.redirect_uris, [ORIGIN + '/lti/launch']);
});

test('Canvas Deep Linking works in an iframe without cookies', async () => {
  stateRows.clear();
  sessionRows.clear();
  const canvasKeys = await generateKeyPair('RS256', { extractable: true });
  const toolKeys = await generateKeyPair('RS256', { extractable: true });
  const canvasJwk = { ...await exportJWK(canvasKeys.publicKey), kid: 'canvas-test', alg: 'RS256', use: 'sig' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url) === JWKS) return Response.json({ keys: [canvasJwk] });
    throw new Error('Unexpected network request');
  };
  const env = {
    DB: db(), SITE_ORIGIN: 'https://atom-edu.org', LTI_KEY_ID: 'atom-test',
    LTI_PRIVATE_KEY: await exportPKCS8(toolKeys.privateKey)
  };
  try {
    const login = await worker.fetch(request('/lti/login', {
      iss: ISSUER, client_id: CLIENT, login_hint: 'opaque', target_link_uri: ORIGIN + '/lti/resource'
    }), env);
    const auth = new URL(login.headers.get('Location'));
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      nonce: auth.searchParams.get('nonce'),
      ['https://purl.imsglobal.org/spec/lti/claim/version']: '1.3.0',
      ['https://purl.imsglobal.org/spec/lti/claim/message_type']: 'LtiDeepLinkingRequest',
      ['https://purl.imsglobal.org/spec/lti/claim/deployment_id']: DEPLOYMENT,
      ['https://purl.imsglobal.org/spec/lti/claim/target_link_uri']: ORIGIN + '/lti/resource',
      ['https://purl.imsglobal.org/spec/lti/claim/roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
      ['https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings']: {
        deep_link_return_url: 'https://school.instructure.com/api/lti/deep_linking/return',
        accept_types: ['ltiResourceLink'], data: 'canvas-opaque-data'
      }
    };
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'canvas-test' }).setIssuer(ISSUER).setAudience(CLIENT)
      .setSubject('teacher-1').setIssuedAt(now).setExpirationTime(now + 300).sign(canvasKeys.privateKey);
    const launch = await worker.fetch(request('/lti/launch', {
      state: auth.searchParams.get('state'), id_token: idToken
    }), env);
    assert.equal(launch.status, 200);
    const picker = await launch.text();
    const session = picker.match(/name="session" value="([^"]+)"/)?.[1];
    assert.ok(session);
    const choice = await worker.fetch(new Request(ORIGIN + '/lti/select', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ session, resource: 'proof-lab' })
    }), env);
    assert.equal(choice.status, 200);
    const html = await choice.text();
    const jwt = html.match(/name="JWT" value="([^"]+)"/)?.[1];
    assert.ok(jwt);
    const verified = await jwtVerify(jwt, toolKeys.publicKey, { issuer: CLIENT, audience: ISSUER });
    assert.equal(verified.payload['https://purl.imsglobal.org/spec/lti/claim/message_type'], 'LtiDeepLinkingResponse');
    assert.equal(verified.payload['https://purl.imsglobal.org/spec/lti-dl/claim/data'], 'canvas-opaque-data');
  } finally { globalThis.fetch = originalFetch; }
});
