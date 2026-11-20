import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('teacher hub names both accountless products and states browser boundaries honestly', () => {
  const html = read('teachers.html');
  assert.match(html, /Orbit Room/);
  assert.match(html, /Atom Lockdown Browser/);
  assert.match(html, /no account required/i);
  assert.match(html, /cannot close arbitrary tabs or disable operating-system shortcuts/i);
});

test('makers and live consoles expose required classroom controls', () => {
  const maker = read('teacher-maker.js');
  const host = read('teacher-host.js');
  const console = read('teacher-console.js');
  for (const type of ['multiple-choice', 'multi-select', 'true-false', 'free-response', 'fill-blank']) assert.match(maker, new RegExp(type));
  assert.match(host, /Show leaderboard/);
  assert.match(host, /Question analysis/);
  assert.match(console, /STUDENT REMOVED FOR CHEATING/);
  assert.match(console, /Allow back in/);
  assert.match(console, /Class question analysis/);
});

test('student flow has fullscreen integrity controls and nested routes', () => {
  const app = read('student-app.js');
  for (const behavior of ['requestFullscreen', 'fullscreenchange', 'visibilitychange', "'copy','cut','paste','contextmenu'", 'modifier-held']) assert.match(app, new RegExp(behavior));
  for (const path of ['students/join.html', 'students/room.html', 'students/quiz.html']) assert.doesNotThrow(() => read(path));
});

test('classroom service uses secure tokens, durable state, caps rooms, and never Math.random', () => {
  const worker = read('classroom-api/src/index.ts');
  assert.match(worker, /MAX_STUDENTS = 50/);
  assert.match(worker, /crypto\.getRandomValues/);
  assert.match(worker, /acceptWebSocket/);
  assert.match(worker, /Math\.min\(450/);
  assert.doesNotMatch(worker, /Math\.random/);
});
