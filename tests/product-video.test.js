import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = path => readFileSync(resolve(root, path), 'utf8');

test('the product video deck has 15 working slides, four portraits, and real product assets', () => {
  const html = read('product-video.html');
  const script = read('product-video.js');
  assert.equal((html.match(/<section class="slide /g) || []).length, 15);
  assert.match(html, /id="slide-15"/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /ArrowLeft/);
  const images = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
  assert(images.length >= 9);
  for (const image of images) assert(existsSync(resolve(root, image)), `Missing ${image}`);
  assert.match(html, /images\/patel\.jpeg/);
  assert.equal((html.match(/<figure><img src="images\/(?:awasthi|avuthu|sanikommu|patel)\.jpeg"/g) || []).length, 4);
  assert.match(html, /images\/logo\.svg/);
  assert.match(html, /atomEDU is not affiliated with Google/);
  assert.doesNotMatch(html, /Official Google partner|All of Algebra|All of Geometry/i);
});

test('the 12-minute script opens with Rahul and gives Aryan most of the dialogue', () => {
  const script = read('docs/product-video-script.md');
  assert.match(script, /Target length: about 12 minutes/);
  assert.equal((script.match(/^## \d+:\d\d to \d+:\d\d \| Slide \d+/gm) || []).length, 15);
  assert.match(script, /^## 0:00 to 0:40 \| Slide 1 \| Rahul opens/m);
  assert.match(script, /\*\*Rahul:\*\*/);
  assert.match(script, /\*\*Pritam:\*\*/);
  assert.match(script, /\*\*Aryan:\*\*/);
  const speakerWords = name => [...script.matchAll(new RegExp(`^\\*\\*${name}:\\*\\* (.+)$`, 'gm'))].reduce((count, match) => count + match[1].split(/\s+/).length, 0);
  assert(speakerWords('Aryan') > speakerWords('Rahul') + speakerWords('Pritam'));
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
