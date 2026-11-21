import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public live page has a full video stage and viewer count', async () => {
  const html = await read('live.html');
  assert.match(html, /id="live-video"/);
  assert.match(html, /id="viewer-count"/);
  assert.match(html, /live-viewer\.js/);
  assert.match(html, /canonical[^>]+\/live/);
});

test('live manager supports screen audio, local recording, titles, and localhost override', async () => {
  const [html, script] = await Promise.all([read('live-manage.html'), read('live-manage.js')]);
  assert.match(html, /Stream title/);
  assert.match(html, /Start local recording/);
  assert.match(script, /getDisplayMedia/);
  assert.match(script, /audio:true/);
  assert.match(script, /new MediaRecorder/);
  assert.match(script, /event\.key==='\\\\'/);
  assert.match(script, /localhost\|127\\\.0\\\.0\\\.1/);
  assert.match(script, /viewerOverride/);
});

test('live service keeps broadcast authority server-side', async () => {
  const service = await read('live-service/server.mjs');
  assert.match(service, /required\(["']LIVE_STREAM_KEY["']\)/);
  assert.match(service, /timingSafeEqual/);
  assert.match(service, /canPublish:\s*host/);
  assert.match(service, /canSubscribe:\s*!host/);
  assert.match(service, /X-Stream-Key/i);
});

test('global navigation adds Live before the primary call to action', async () => {
  const script = await read('site.js');
  assert.match(script, /link\.dataset\.nav = '\/live'/);
  assert.match(script, /insertBefore\(link, cta/);
});
