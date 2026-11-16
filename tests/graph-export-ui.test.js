import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Graph presents a truthful provider handoff below Copy graph link', () => {
  const app = readFileSync(new URL('../math-lab.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../math-lab.css', import.meta.url), 'utf8');
  const copy = app.indexOf("node('button', 'graph-share-copy', 'Copy graph link')");
  const menu = app.indexOf("node('details', 'graph-share-export')");
  assert(copy >= 0 && menu > copy);
  for (const name of ['Google Drive', 'Notion', 'Zapier', 'Dropbox', 'GitHub']) assert(app.includes(`'${name}'`));
  assert.match(app, /Dropbox saves directly after you approve it in the popup/);
  assert.match(app, /window\.Dropbox\.save\(url, 'atom-graph\.json'/);
  assert.doesNotMatch(app, /gapi\.savetodrive|loadDriveSaver/);
  assert.match(app, /buildPublicGraphDownloadUrl\(graph\.getState\(\)\)/);
  assert.match(app, /Download graph JSON/);
  assert.match(app, /prepareGraphExport\(provider, graph\.getState\(\)\)/);
  assert.match(app, /selectPreparedContent\(prepared\.content\)/);
  assert.match(css, /\.graph-share-export-list/);
});
