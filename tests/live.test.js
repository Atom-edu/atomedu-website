import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public live page has a full video stage and viewer count", async () => {
  const html = await read("live.html");
  assert.match(html, /id="live-video"/);
  assert.match(html, /id="viewer-count"/);
  assert.match(html, /live-viewer\.js/);
  assert.match(html, /canonical[^>]+\/live/);
});

test("live manager supports screen audio, local recording, titles, and a hidden authenticated override", async () => {
  const [html, script] = await Promise.all([
    read("live-manage.html"),
    read("live-manage.js"),
  ]);
  assert.match(html, /Stream title/);
  assert.match(html, /Start local recording/);
  assert.match(script, /getDisplayMedia/);
  assert.match(script, /audio:\s*true/);
  assert.match(script, /new MediaRecorder/);
  assert.match(script, /event\.key === "\\\\"/);
  assert.match(script, /viewerOverride/);
  assert.doesNotMatch(script.match(/document\.addEventListener\("keydown"[\s\S]*?\n\}\);/)?.[0] || "", /\blocal\b/);
  assert.doesNotMatch(html, /Local viewer-count test|This control only appears|press \\\\|backslash/i);
  assert.match(html, /live-manage\.js\?v=3/);
  assert.match(script, /new RTCPeerConnection/);
  assert.match(script, /type: "offer"/);
});

test("deployed signaling keeps broadcast authority server-side and media peer-to-peer", async () => {
  const [worker, config, viewer] = await Promise.all([
    read("live-signal-worker/src/index.js"),
    read("live-config.js"),
    read("live-viewer.js"),
  ]);
  assert.match(worker, /timingSafeEqual/);
  assert.match(worker, /env\.LIVE_STREAM_KEY/);
  assert.match(worker, /issueHostTicket/);
  assert.match(worker, /HOST_AUTH_LIMITER/);
  assert.match(worker, /acceptWebSocket/);
  assert.doesNotMatch(worker, /MediaStream|RTCPeerConnection|video\//);
  assert.match(config, /atom-live-signal\.archimedes-api1\.workers\.dev/);
  assert.match(viewer, /new RTCPeerConnection/);
  assert.match(viewer, /new MediaStream/);
});

test("global navigation adds Live before the primary call to action", async () => {
  const script = await read("site.js");
  assert.match(script, /link\.dataset\.nav = '\/live'/);
  assert.match(script, /insertBefore\(link, cta/);
});
