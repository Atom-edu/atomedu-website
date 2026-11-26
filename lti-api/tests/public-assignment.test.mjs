import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.ts';

const ORIGIN = 'https://atom-lti-api.example.test';
function database() {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0001_initial.sql', '0002_activities.sql', '0003_public_assignments.sql']) {
    sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  }
  return {
    sql,
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { const result = sql.prepare(query).run(...args); return { meta: { changes: result.changes } }; }
      };
    }
  };
}
function post(path, data, origin = ORIGIN) {
  return new Request(ORIGIN + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.7' },
    body: new URLSearchParams(data)
  });
}
test('link assignment supports student submission, teacher review, receipt, and safe CSV', async () => {
  const DB = database();
  const env = { DB, SITE_ORIGIN: 'https://atom-edu.org', PUBLIC_RATE_SECRET: 'a'.repeat(64) };
  try {
    const editor = await worker.fetch(new Request(ORIGIN + '/public/assignments/new'), env);
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /Create an assignment/);
    const questions = [
      { type: 'multiple-choice', prompt: 'Two plus two?', options: ['3', '4'], correct: ['4'], points: 2 },
      { type: 'free-response', prompt: 'Explain why.', correct: [], options: [], points: 3 }
    ];
    const created = await worker.fetch(post('/public/assignments', { title: 'Math homework', questions: JSON.stringify(questions) }), env);
    assert.equal(created.status, 200);
    const page = await created.text();
    const studentUrl = page.match(/https:\/\/atom-edu\.org\/students-assignment\?code=([0-9a-f-]{36})/)?.[1];
    const teacherToken = page.match(/\/public\/manage\/([A-Za-z0-9_-]{40,50})/)?.[1];
    assert.ok(studentUrl);
    assert.ok(teacherToken);
    assert.equal(created.headers.get('X-Robots-Tag'), 'noindex');
    const student = await worker.fetch(new Request(ORIGIN + '/public/assignments/' + studentUrl), env);
    assert.equal(student.status, 200);
    const studentHtml = await student.text();
    assert.match(studentHtml, /Two plus two/);
    assert.doesNotMatch(studentHtml, /correct.*\["4"\]/);
    const stored = JSON.parse(DB.sql.prepare('SELECT questions_json FROM public_assignments').get().questions_json);
    const answer = { student_name: '=Test Learner', ['answer:' + stored[0].id]: '4', ['answer:' + stored[1].id]: 'Two pairs add to four.' };
    const submitted = await worker.fetch(post('/public/assignments/' + studentUrl + '/submit', answer), env);
    assert.equal(submitted.status, 200);
    const receiptPage = await submitted.text();
    assert.match(receiptPage, /Completion receipt/);
    assert.match(receiptPage, /teacher will grade/);
    const repeated = await worker.fetch(post('/public/assignments/' + studentUrl + '/submit', answer), env);
    assert.equal(repeated.status, 409);
    const report = await worker.fetch(new Request(ORIGIN + '/public/manage/' + teacherToken), env);
    assert.equal(report.status, 200);
    const reportHtml = await report.text();
    assert.match(reportHtml, /awaiting_review/);
    assert.match(reportHtml, /Two pairs add to four/);
    const submissionId = DB.sql.prepare('SELECT id FROM public_submissions').get().id;
    const graded = await worker.fetch(post('/public/manage/' + teacherToken + '/grade', {
      submission_id: submissionId, ['points:' + stored[0].id]: '2', ['points:' + stored[1].id]: '2'
    }), env);
    assert.equal(graded.status, 200);
    assert.match(await graded.text(), /4 \/ 5/);
    const csv = await worker.fetch(new Request(ORIGIN + '/public/manage/' + teacherToken + '/grades.csv'), env);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('Content-Type'), /text\/csv/);
    const body = await csv.text();
    assert.match(body, /4","5/);
    assert.match(body, /'=Test Learner/);
    const invalid = await worker.fetch(new Request(ORIGIN + '/public/manage/' + 'x'.repeat(43)), env);
    assert.equal(invalid.status, 404);
  } finally { DB.sql.close(); }
});
