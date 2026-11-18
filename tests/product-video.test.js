import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = path => readFileSync(resolve(root, path), 'utf8');

test('the product video deck has 20 working slides, three portraits, and real product assets', () => {
  const html = read('product-video.html');
  const script = read('product-video.js');
  assert.equal((html.match(/<section class="slide /g) || []).length, 20);
  assert.match(html, /id="slide-20"/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /ArrowLeft/);
  const images = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
  assert(images.length >= 9);
  for (const image of images) assert(existsSync(resolve(root, image)), `Missing ${image}`);
  assert.doesNotMatch(html, /Aryan Patel|images\/patel\.jpeg/);
  assert.equal((html.match(/<figure><img src="images\/(?:awasthi|avuthu|sanikommu)\.jpeg"/g) || []).length, 3);
  assert.match(html, /images\/logo\.svg/);
  assert.match(html, /atomEDU is not affiliated with Google/);
  assert.doesNotMatch(html, /image.import|image.import.screen/i);
  assert.doesNotMatch(html, /Official Google partner|All of Algebra|All of Geometry/i);
});

test('the 20-minute script opens with Rahul and uses the two demo speakers', () => {
  const script = read('docs/product-video-script.md');
  assert.match(script, /Target length: 20 minutes/);
  assert.equal((script.match(/^## \d+:\d\d to \d+:\d\d \| Slide \d+/gm) || []).length, 20);
  assert.match(script, /^## 0:00 to 1:00 \| Slide 1 \| Rahul opens/m);
  assert.match(script, /^## 19:00 to 20:00 \| Slide 20/m);
  assert.match(script, /\*\*Rahul:\*\*/);
  assert.match(script, /\*\*Pritam:\*\*/);
  assert.doesNotMatch(script, /Aryan|Patel/);
  const speakerWords = name => [...script.matchAll(new RegExp(`^\\*\\*${name}:\\*\\* (.+)$`, 'gm'))].reduce((count, match) => count + match[1].split(/\s+/).length, 0);
  const counts = ['Rahul', 'Pritam'].map(speakerWords);
  assert(Math.max(...counts) - Math.min(...counts) <= 120, `Unbalanced narration: ${counts.join(', ')}`);
  assert.doesNotMatch(script, /image import|image.upload/i);
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
