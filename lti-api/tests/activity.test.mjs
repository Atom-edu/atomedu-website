import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import worker from '../src/index.ts';

const ORIGIN = 'https://lti.atom-edu.org';
const CANVAS = 'https://canvas.example.edu';
const CLIENT = 'canvas-client-test';
const DEPLOYMENT = 'canvas-deployment-test';
const ISSUER = 'https://canvas.instructure.com';
const JWKS = CANVAS + '/api/lti/security/jwks';
const LTI = 'https://purl.imsglobal.org/spec/lti/claim/';
const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/';

function database() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0001_initial.sql', '0002_activities.sql']) {
    sql.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  sql.prepare('INSERT INTO platforms (issuer,client_id,auth_url,token_url,jwks_url,service_origin,active) VALUES (?,?,?,?,?,?,1)')
    .run(ISSUER, CLIENT, CANVAS + '/api/lti/authorize_redirect', CANVAS + '/login/oauth2/token', JWKS, CANVAS);
  sql.prepare('INSERT INTO deployments (issuer,client_id,deployment_id,active) VALUES (?,?,?,1)').run(ISSUER, CLIENT, DEPLOYMENT);
  return {
    sql,
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { sql.prepare(query).run(...args); return { success: true }; }
      };
    }
  };
}
function post(path, data, origin = '') {
  return new Request(ORIGIN + path, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}) },
    body: new URLSearchParams(data)
  });
}
function hidden(html, name) {
  return html.match(new RegExp('name="' + name + '" value="([^"]+)"'))?.[1] ?? '';
}

test('real SQL assessment lifecycle signs Deep Linking, grades student, and allows teacher override', async () => {
  const db = database();
  const canvasKeys = await generateKeyPair('RS256', { extractable: true });
  const toolKeys = await generateKeyPair('RS256', { extractable: true });
  const canvasJwk = { ...await exportJWK(canvasKeys.publicKey), kid: 'canvas-test', alg: 'RS256', use: 'sig' };
  const env = { DB: db, SITE_ORIGIN: 'https://atom-edu.org', LTI_KEY_ID: 'atom-test', LTI_PRIVATE_KEY: await exportPKCS8(toolKeys.privateKey) };
  const scores = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === JWKS) return Response.json({ keys: [canvasJwk] });
    if (String(url) === CANVAS + '/login/oauth2/token') {
      const assertion = new URLSearchParams(init.body).get('client_assertion');
      const verified = await jwtVerify(assertion, toolKeys.publicKey, { issuer: CLIENT, audience: String(url) });
      assert.equal(verified.payload.sub, CLIENT);
      assert.equal(new URLSearchParams(init.body).get('grant_type'), 'client_credentials');
      return Response.json({ access_token: 'service-token', token_type: 'Bearer', scope: new URLSearchParams(init.body).get('scope') });
    }
    if (String(url) === CANVAS + '/api/lti/lineitems/1/scores') {
      assert.equal(init.headers.Authorization, 'Bearer service-token');
      scores.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected network request: ' + url);
  };
  async function launch(role, messageType, subject, custom = null, resourceId = '') {
    const login = await worker.fetch(post('/lti/login', { iss: ISSUER, client_id: CLIENT, login_hint: 'opaque', target_link_uri: ORIGIN + '/lti/resource' }), env);
    assert.equal(login.status, 302);
    const auth = new URL(login.headers.get('Location'));
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      nonce: auth.searchParams.get('nonce'),
      [LTI + 'version']: '1.3.0', [LTI + 'message_type']: messageType,
      [LTI + 'deployment_id']: DEPLOYMENT, [LTI + 'target_link_uri']: ORIGIN + '/lti/resource',
      [LTI + 'roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#' + role],
      [LTI + 'context']: { id: 'course-1' },
      ...(resourceId ? { [LTI + 'resource_link']: { id: resourceId } } : {}),
      ...(custom ? { [LTI + 'custom']: custom } : {}),
      ...(messageType === 'LtiDeepLinkingRequest' ? { [DL + 'deep_linking_settings']: { deep_link_return_url: CANVAS + '/courses/1/deep_linking_response', accept_types: ['ltiResourceLink'] } } : {}),
      ['https://purl.imsglobal.org/spec/lti-ags/claim/endpoint']: {
        lineitem: CANVAS + '/api/lti/lineitems/1',
        scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score']
      },
      name: role === 'Learner' ? 'Test Learner' : 'Test Teacher'
    };
    const jwt = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'canvas-test' })
      .setIssuer(ISSUER).setAudience(CLIENT).setSubject(subject).setIssuedAt(now).setExpirationTime(now + 300).sign(canvasKeys.privateKey);
    return worker.fetch(post('/lti/launch', { state: auth.searchParams.get('state'), id_token: jwt }), env);
  }
  try {
    const picker = await launch('Instructor', 'LtiDeepLinkingRequest', 'teacher-1');
    assert.equal(picker.status, 200);
    const pickerHtml = await picker.text();
    const session = hidden(pickerHtml, 'session');
    const question = [{ type: 'multiple-choice', prompt: 'Two plus two?', options: ['3', '4'], correct: ['4'], points: 5 },
      { type: 'free-response', prompt: 'Explain your work.', options: [], correct: [], points: 5 }];
    const created = await worker.fetch(post('/lti/activity/create', { session, title: 'Math check', questions: JSON.stringify(question) }, ORIGIN), env);
    assert.equal(created.status, 200);
    const createdHtml = await created.text();
    const signed = hidden(createdHtml, 'JWT');
    const deepLink = await jwtVerify(signed, toolKeys.publicKey, { issuer: CLIENT, audience: ISSUER });
    const item = deepLink.payload[DL + 'content_items'][0];
    assert.equal(item.title, 'Math check');
    assert.deepEqual(item.lineItem, { label: 'Math check', scoreMaximum: 10 });
    const activityId = item.custom.atom_activity_id;
    const student = await launch('Learner', 'LtiResourceLinkRequest', 'learner-1', { atom_activity_id: activityId }, 'link-1');
    assert.equal(student.status, 200);
    const studentHtml = await student.text();
    assert.match(studentHtml, /Two plus two/);
    assert.doesNotMatch(studentHtml, /name="correct"/);
    const studentSession = hidden(studentHtml, 'session');
    const questions = JSON.parse(db.sql.prepare('SELECT questions_json FROM activities WHERE id = ?').get(activityId).questions_json);
    const submitted = await worker.fetch(post('/lti/activity/submit', {
      session: studentSession, ['answer:' + questions[0].id]: '4', ['answer:' + questions[1].id]: 'Because 2 + 2 = 4.'
    }, ORIGIN), env);
    assert.equal(submitted.status, 200);
    assert.match(await submitted.text(), /teacher will grade/);
    assert.equal(scores.length, 0);
    const teacher = await launch('Instructor', 'LtiResourceLinkRequest', 'teacher-1', { atom_activity_id: activityId }, 'link-1');
    assert.equal(teacher.status, 200);
    const report = await teacher.text();
    assert.match(report, /Because 2 \+ 2 = 4/);
    const teacherSession = hidden(report, 'session');
    const graded = await worker.fetch(post('/lti/activity/grade', {
      session: teacherSession, subject: 'learner-1', ['points:' + questions[0].id]: '5', ['points:' + questions[1].id]: '4'
    }, ORIGIN), env);
    assert.equal(graded.status, 200);
    assert.equal(scores.length, 1);
    assert.equal(scores[0].scoreGiven, 9);
    assert.equal(scores[0].userId, 'learner-1');
    assert.equal(db.sql.prepare('SELECT grade_status FROM submissions').get().grade_status, 'posted');
    const invalidGrade = await worker.fetch(post('/lti/activity/grade', {
      session: teacherSession, subject: 'learner-1', ['points:' + questions[0].id]: '500', ['points:' + questions[1].id]: '5'
    }, ORIGIN), env);
    assert.equal(invalidGrade.status, 400);
    assert.equal(scores.length, 1);
    const autoCreated = await worker.fetch(post('/lti/activity/create', {
      session, title: 'Auto check', questions: JSON.stringify([{ type: 'true-false', prompt: 'The sky is blue.', correct: ['True'], points: 3 }])
    }, ORIGIN), env);
    assert.equal(autoCreated.status, 200);
    const autoJwt = hidden(await autoCreated.text(), 'JWT');
    const autoLink = await jwtVerify(autoJwt, toolKeys.publicKey, { issuer: CLIENT, audience: ISSUER });
    const autoId = autoLink.payload[DL + 'content_items'][0].custom.atom_activity_id;
    const autoLaunch = await launch('Learner', 'LtiResourceLinkRequest', 'learner-1', { atom_activity_id: autoId }, 'link-2');
    const autoHtml = await autoLaunch.text();
    const autoSession = hidden(autoHtml, 'session');
    const autoQuestion = JSON.parse(db.sql.prepare('SELECT questions_json FROM activities WHERE id = ?').get(autoId).questions_json)[0];
    const autoRequest = () => post('/lti/activity/submit', { session: autoSession, ['answer:' + autoQuestion.id]: 'True' }, ORIGIN);
    const autoResult = await worker.fetch(autoRequest(), env);
    assert.equal(autoResult.status, 200);
    assert.match(await autoResult.text(), /3 \/ 3/);
    assert.equal(scores.at(-1).scoreGiven, 3);
    await worker.fetch(autoRequest(), env);
    assert.equal(scores.length, 2);
    const otherCourse = await launch('Learner', 'LtiResourceLinkRequest', 'learner-2', { atom_activity_id: 'nonexistent' }, 'link-2');
    assert.equal(otherCourse.status, 403);
  } finally { globalThis.fetch = originalFetch; db.sql.close(); }
});
