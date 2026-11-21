// Bundle only the browser assets we serve. This is a reproducible asset build,
// not a CDN dependency: all fonts, styles, renderers, and licenses stay local.
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [name, files] of [
  ['mathlive', ['mathlive.min.mjs', 'mathlive-static.css', 'mathlive-fonts.css', 'fonts', 'LICENSE.txt']],
  ['katex', ['dist/katex.mjs', 'dist/katex.min.css', 'dist/fonts', 'LICENSE']],
  ['livekit-client', ['dist/livekit-client.esm.mjs', 'LICENSE']],
]) {
  const destination = path.join(root, 'vendor', name);
  await mkdir(destination, { recursive: true });
  for (const source of files) await cp(path.join(root, 'node_modules', name, source), path.join(destination, path.basename(source)), { recursive: true });
}
const liveKitBundle = path.join(root, 'vendor', 'livekit-client', 'livekit-client.esm.mjs');
await writeFile(liveKitBundle, (await readFile(liveKitBundle, 'utf8')).replaceAll('\r\n', '\n'));
console.log('Local MathLive, KaTeX, and LiveKit browser assets and licenses are ready.');
