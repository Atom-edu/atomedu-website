import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('contest begins with the winner and explains graph export, schedule, consent, and archive', () => {
  const page = read('art-contest.html');
  assert.ok(page.indexOf('class="winner-section') < page.indexOf('class="contest-hero'), 'winner banner precedes the intro');
  assert.match(page, /id="winner-image"/);
  assert.match(page, /id="winner-name"/);
  assert.match(page, /Save PNG/);
  assert.match(page, /Desmos graphs, art from other software/);
  assert.match(page, /id="terms-accepted"/);
  assert.match(page, /id="display-consent"/);
  assert.match(page, /Confirm and submit/);
  assert.match(page, /id="archive-grid"/);
  assert.match(page, /01:00 next day/);
  assert.match(page, /02:30 next day/);
  assert.match(page, /03:30 next day/);
  assert.doesNotMatch(page + read('art-contest.js'), /[—–·]/);
  assert.ok(page.indexOf('contest-config.js') < page.indexOf('art-contest.js'));
});

test('judging stays server-backed and neither public page embeds an admin password', () => {
  const page = read('judging.html');
  const publicScript = read('art-contest.js');
  const judgeScript = read('judging.js');
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /id="judge-password"/);
  assert.match(page, /id="contest-date"/);
  assert.ok(page.indexOf('contest-config.js') < page.indexOf('judging.js'));
  assert.match(judgeScript, /Bearer/);
  assert.match(judgeScript, /createObjectURL/);
  assert.match(judgeScript, /permanently deletes ALL other submissions/);
  assert.doesNotMatch(page + judgeScript, /[—–·]/);
  assert.doesNotMatch(publicScript + judgeScript + page, /(?:password\s*[:=]\s*['"]admin['"]|Basic\s+YWRtaW4)/i);
  assert.match(read('contest-config.js'), /ATOM_CONTEST_API_BASE = ''/);
});
