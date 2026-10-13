import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildManifest } from '../tools/build-pwa.mjs';

const file = rel => new URL(`../${rel}`, import.meta.url);
const read = rel => fs.readFileSync(file(rel), 'utf8');

test('PeerJS is vendored, loaded before main.js and precached for offline play', async () => {
  assert.ok(fs.existsSync(file('vendor/peerjs/peerjs.min.js')), 'run npm run vendor:peerjs');
  assert.ok(fs.statSync(file('vendor/peerjs/peerjs.min.js')).size > 50_000);
  assert.match(read('vendor/peerjs/VERSION'), /^\d+\.\d+\.\d+/);
  assert.ok(fs.existsSync(file('vendor/peerjs/LICENSE')));
  const html = read('index.html');
  const peerAt = html.indexOf('./vendor/peerjs/peerjs.min.js');
  const mainAt = html.indexOf('./main.js');
  assert.ok(peerAt > 0 && peerAt < mainAt, 'index.html loads peerjs.min.js before main.js');
  assert.ok(!/<script[^>]+peerjs\.min\.js[^>]+type="module"/.test(html), 'it is a classic script (it defines the global Peer)');
  const { core } = await buildManifest();
  assert.ok(core.includes('./vendor/peerjs/peerjs.min.js'), 'service worker precaches it');
});

test('the vendor script targets a pinned version', () => {
  const script = read('tools/vendor-peerjs.mjs');
  assert.match(script, /process\.argv\[2\] \|\| '\d+\.\d+\.\d+'/);
  assert.match(read('package.json'), /"vendor:peerjs": "node tools\/vendor-peerjs\.mjs"/);
});
