import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = path => readFileSync(resolve(root, path), 'utf8');

test('the product video deck has 11 working slides and real local image assets', () => {
  const html = read('product-video.html');
  const script = read('product-video.js');
  assert.equal((html.match(/<section class="slide /g) || []).length, 11);
  assert.match(html, /id="slide-11"/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /ArrowLeft/);
  const images = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
  assert(images.length >= 9);
  for (const image of images) assert(existsSync(resolve(root, image)), `Missing ${image}`);
  assert.match(html, /atomEDU is not affiliated with Google/);
  assert.doesNotMatch(html, /Official Google partner|All of Algebra|All of Geometry/i);
});

test('the five-minute script covers two speakers and all product views', () => {
  const script = read('docs/product-video-script.md');
  assert.match(script, /Target length: 5 minutes/);
  assert.equal((script.match(/^## \d:\d\d to \d:\d\d \| Slide \d+/gm) || []).length, 11);
  assert.match(script, /\*\*Rahul:\*\*/);
  assert.match(script, /\*\*Pritam:\*\*/);
  for (const topic of ['Solve', 'Check work', 'Ghost steps', 'Generate', 'Graph', 'Share']) {
    assert.match(script, new RegExp(topic, 'i'));
  }
});

test('the opportunity memo separates controllable actions from approvals', () => {
  const memo = read('docs/education-opportunities-30-days.md');
  for (const [heading, minimum] of [['Today, November 15', 3], ['Within 3 days', 3], ['Within 7 days', 3], ['Within 14 days', 5], ['Within 21 days', 5], ['Within 30 days', 5]]) {
    const section = memo.split(`## ${heading}`)[1]?.split('\n## ')[0];
    assert(section, `Missing ${heading}`);
    assert((section.match(/^\| \[/gm) || []).length >= minimum, `Too few options in ${heading}`);
  }
  assert.match(memo, /not promises of approval/i);
  assert.match(memo, /does not certify a standalone math tool/i);
});
