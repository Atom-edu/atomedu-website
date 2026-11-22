import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('public contact form collects title and body without a name', () => {
  const html = read('contact.html');
  assert.match(html, /<form class="form contact-form" id="contact-form">/);
  assert.match(html, /name="title"/);
  assert.match(html, /name="body"/);
  assert.match(html, /type="submit">Submit message/);
  assert.doesNotMatch(html, /name="name"/);
  assert.match(html, /contact-config\.js/);
  assert.match(html, /contact\.js/);
});

test('contact manager is private and contains acknowledgement only', () => {
  const html = read('contact-manage.html');
  const script = read('contact-manage.js');
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /id="contact-password"/);
  assert.match(html, /All messages/);
  assert.match(script, /Acknowledged/);
  assert.match(script, /\/acknowledged/);
  assert.doesNotMatch(`${html}\n${script}`, /reply|respond|recipient|email address/i);
  assert.doesNotMatch(html, /name="name"/);
  assert.match(script, /sessionStorage/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('contact service URL exposes no secret', () => {
  const config = read('contact-config.js');
  assert.match(config, /https:\/\/atom-contact-api\.archimedes-api1\.workers\.dev\/api\/contact/);
  assert.doesNotMatch(config, /password\s*=|session_secret|ip_hash_secret/i);
});

test('privacy copy explains contact storage and no identity collection', () => {
  const legal = read('legal.html');
  assert.match(legal, /contact form, the title and message you enter are sent to atomEDU and stored/);
  assert.match(legal, /does not ask for your name or email address/);
  assert.match(legal, /keyed hash derived from the source IP address/);
});
