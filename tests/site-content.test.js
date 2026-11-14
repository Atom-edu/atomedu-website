import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pages = ['index.html', 'features.html', 'learn.html', 'about.html', 'contact.html', 'legal.html', 'proof-lab.html'];
const expectedNav = [
  ['Home', '/'],
  ['Features', '/features'],
  ['Learn', '/learn'],
  ['About', '/about'],
  ['Contact', '/contact'],
  ['Start math', '/proof-lab'],
];
const pageRoutes = new Map([
  ['index.html', '/'], ['features.html', '/features'], ['learn.html', '/learn'],
  ['about.html', '/about'], ['contact.html', '/contact'],
]);

function read(page) { return readFileSync(resolve(root, page), 'utf8'); }
function links(markup) {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, label]) => [
    label.replace(/<[^>]*>/g, '').trim(),
    attrs.match(/\bhref="([^"]+)"/)?.[1],
  ]);
}

for (const page of pages) {
  test(`${page} shares the complete Proof Lab navigation and honest product copy`, () => {
    const html = read(page);
    const desktop = html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)?.[1];
    const mobile = html.match(/<div class="mobile-nav"[^>]*>\s*<div class="inner">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(desktop, 'desktop navigation exists');
    assert.ok(mobile, 'mobile navigation exists');
    assert.deepEqual(links(desktop), expectedNav);
    assert.deepEqual(links(mobile), expectedNav);
    if (pageRoutes.has(page)) {
      const route = pageRoutes.get(page).replace('/', '\\/');
      assert.match(desktop, new RegExp(`data-nav="${route}"`));
      assert.match(mobile, new RegExp(`data-nav="${route}"`));
    }
    assert.match(html, /<footer class="site-footer">/);
    assert.match(html, /Bring the math\. Show the proof\./);
    assert.match(html, /<a class="btn btn-accent" href="\/proof-lab">Start math<\/a>/);
    assert.doesNotMatch(html, /<a\b[^>]*href="[^"]+\.html(?:[#?"])/, 'public links use clean routes');
    assert.doesNotMatch(html, /[—–·]/, 'public copy avoids dash and dot separators');
    assert.doesNotMatch(html, /\bphysics\b|five modes|math lab/i);
  });
}

test('all local public-page links point to real pages and valid anchors', () => {
  for (const page of pages) {
    for (const [, target] of read(page).matchAll(/\bhref="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:)/.test(target)) continue;
      const [pathname, fragment] = target.split('#');
      const cleanPath = pathname.split('?')[0];
      const destination = cleanPath === '' ? page : cleanPath === '/' ? 'index.html'
        : cleanPath.startsWith('/') ? `${cleanPath.slice(1)}.html` : cleanPath;
      assert.ok(existsSync(resolve(root, destination)), `${page}: missing ${target}`);
      if (fragment) assert.match(read(destination), new RegExp(`\\bid="${fragment}"`), `${page}: missing #${fragment}`);
    }
  }
});

test('the former Math Lab URL forwards to Proof Lab', () => {
  const old = read('math-lab.html');
  assert.match(old, /http-equiv="refresh" content="0; url=\/proof-lab"/);
  assert.match(old, /href="\/proof-lab"/);
});

test('legacy demos forward into the current proof tool', () => {
  assert.match(read('demo-stepgrader.html'), /http-equiv="refresh" content="0;url=\/proof-lab#check"/);
  assert.match(read('lab-projectile.html'), /http-equiv="refresh" content="0;url=\/proof-lab"/);
});

test('home carousel uses three distinct backgrounds', () => {
  const home = read('index.html');
  assert.match(home, /images\/bg1\.png/);
  assert.match(home, /images\/bg2\.jpg/);
  assert.match(home, /images\/bg3\.jpg/);
  assert.doesNotMatch(home, /images\/bg[23]\.svg/);
});

test('home presents both corporate partners and the official VC Boom link', () => {
  const home = read('index.html');
  assert.match(home, /Our featured partners/i);
  assert.match(home, /images\/vc-boom-partner-logo\.svg/);
  assert.match(home, /images\/medaestheticsos-partner-badge\.svg/);
  assert.match(home, /https:\/\/vcboom\.com\/\?promo=PARTNER-ATOMEDU/);
  assert.match(home, /Official VC Boom partner/);
});

test('about page shows all four owners with their photos', () => {
  const about = read('about.html');
  for (const [name, image] of [
    ['Rahul Awasthi', 'awasthi.jpeg'], ['Pritam Avuthu', 'avuthu.jpeg'],
    ['Akshaj Sanikommu', 'sanikommu.jpeg'], ['Aryan Patel', 'patel.jpeg'],
  ]) {
    assert.match(about, new RegExp(name));
    assert.match(about, new RegExp(`images/${image.replace('.', '\\.')}`));
  }
});

test('Proof Lab keeps the entry surface concise and the keypad viewport-fixed', () => {
  const lab = read('proof-lab.html');
  const css = read('math-lab.css');
  assert.doesNotMatch(lab, /Runs locally in your browser|No account\. No API keys\.|Local engine ready|Write naturally in LaTeX|A visual expression, with room to think/);
  assert.match(css, /\.math-keypad \{ position: fixed;/);
  assert.match(css, /\.math-keypad\.is-open/);
  assert.match(css, /difficulty-slider::\-webkit-slider-runnable-track/);
});
