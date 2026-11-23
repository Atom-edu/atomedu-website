import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const taggedPages = [
  '404.html', 'about.html', 'art-contest.html', 'contact.html', 'features.html', 'index.html',
  'learn.html', 'legal.html', 'live.html', 'product-video.html', 'proof-lab.html', 'teachers.html',
];
const privatePages = [
  'contact-manage.html', 'judging.html', 'live-manage.html', 'students/join.html',
  'students/quiz.html', 'students/room.html', 'teachers-orbit-host.html', 'teachers-quiz-console.html',
];

test('public and product pages load the requested Tag Manager container exactly once', () => {
  for (const page of taggedPages) {
    const html = read(page);
    assert.equal((html.match(/<script async src="https:\/\/www\.googletagmanager\.com\/gtm\.js\?id=GTM-NTPC3T2K"><\/script>/g) || []).length, 1, `${page} has one loader`);
    assert.match(html, /<head>[\s\S]*?<script async src="https:\/\/www\.googletagmanager\.com\/gtm\.js\?id=GTM-NTPC3T2K"><\/script>/);
    assert.match(html, /window\.dataLayer = window\.dataLayer \|\| \[\];/);
    assert.match(html, /function gtag\(\)\{dataLayer\.push\(arguments\);\}/);
    assert.match(html, /gtag\('js', new Date\(\)\);/);
  }
});

test('private operational pages do not send their URLs to analytics', () => {
  for (const page of privatePages) assert.doesNotMatch(read(page), /googletagmanager|GTM-NTPC3T2K/);
});
