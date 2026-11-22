import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestPath } from "../scripts/serve.js";

test("local server resolves atomEDU clean URLs without exposing parent files", async () => {
  assert.match(await resolveRequestPath("/"), /index\.html$/);
  assert.match(await resolveRequestPath("/proof-lab"), /proof-lab\.html$/);
  assert.match(await resolveRequestPath("/proof-lab.html"), /proof-lab\.html$/);
  assert.equal(await resolveRequestPath("/%2e%2e/package.json"), null);
  assert.equal(await resolveRequestPath("/does-not-exist"), null);
});
