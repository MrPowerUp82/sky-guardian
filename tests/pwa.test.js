import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../tools/build-pwa.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${rel} is not a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('web manifest is installable: name, scope, display and real icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.start_url.startsWith('./'), true);
  assert.equal(manifest.scope, './');
  assert.ok(['standalone', 'fullscreen'].includes(manifest.display));
  const purposes = new Map();
  for (const icon of manifest.icons) {
    const rel = icon.src.replace(/^\.\//, '');
    assert.ok(exists(rel), `missing icon ${rel}`);
    const [w, h] = pngSize(rel);
    assert.equal(`${w}x${h}`, icon.sizes, `${rel} real size`);
    purposes.set(`${icon.sizes}:${icon.purpose}`, true);
  }
  assert.ok(purposes.has('192x192:any') && purposes.has('512x512:any') && purposes.has('512x512:maskable'));
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
});

test('pwa-manifest.json and sw.js are up to date (run `npm run pwa` after adding or removing files)', async () => {
  const built = await buildManifest();
  const saved = JSON.parse(read('pwa-manifest.json'));
  assert.equal(saved.version, built.version, 'pwa-manifest.json is stale: run npm run pwa');
  assert.deepEqual(saved.core, built.core);
  assert.deepEqual(saved.assets.map(a => [a.url, a.hash]), built.assets.map(a => [a.url, a.hash]));
  assert.match(read('sw.js'), new RegExp(`const VERSION = '${built.version}';`), 'sw.js VERSION is stale');
});

test('every pre-cached file exists and the boot files are included', async () => {
  const manifest = JSON.parse(read('pwa-manifest.json'));
  for (const url of manifest.core.filter(u => u !== './')) assert.ok(exists(url.slice(2)), `missing ${url}`);
  for (const url of ['./', './index.html', './main.js', './style.css', './pwa.js', './manifest.webmanifest', './vendor/three/build/three.module.js', './vendor/three/build/three.core.js']) {
    assert.ok(manifest.core.includes(url), `core lacks ${url}`);
  }
  for (const asset of manifest.assets) assert.ok(exists(asset.url.slice(2)), asset.url);
  for (const model of ['assets/superman/Superman-game.glb', 'assets/jason/Jason-game.glb', 'assets/flash/the-flash.glb']) {
    assert.ok(manifest.assets.some(a => a.url === `./${model}`), `${model} not pre-cached`);
  }
  assert.ok(!manifest.core.some(u => /tests\/|\.bak|\.zip|graphify|docs\//.test(u)), 'dev files must not be cached');
});

test('the game no longer depends on a CDN: import maps point at vendor/three', () => {
  for (const page of ['index.html', 'animation-configurator.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg|cdnjs/, `${page} still loads from a CDN`);
    assert.match(html, /"three": "\.\/vendor\/three\/build\/three\.module\.js"/);
    assert.match(html, /"three\/addons\/": "\.\/vendor\/three\/examples\/jsm\/"/);
  }
});

test('every three/addons import resolves to a vendored file, with its own relative imports', () => {
  const sources = ['main.js', 'animation-configurator.js'];
  const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []);
  const files = [...sources, ...walk('game')];
  const addons = new Set();
  for (const file of files) for (const m of read(file).matchAll(/from ['"]three\/addons\/([^'"]+)['"]/g)) addons.add(m[1]);
  assert.ok(addons.size >= 8);
  const queue = [...addons].map(a => `vendor/three/examples/jsm/${a}`);
  const seen = new Set();
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    assert.ok(exists(rel), `vendored file missing: ${rel}`);
    for (const m of read(rel).matchAll(/(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
  }
  assert.ok(exists('vendor/three/LICENSE'));
});

test('service worker: network-first core, cache-first models, hash-based model sync', () => {
  const sw = read('sw.js');
  for (const needle of ["addEventListener('install'", "addEventListener('activate'", "addEventListener('fetch'", 'cacheFirst', 'networkFirst', 'syncAssets', 'offline-progress', 'offline-ready']) {
    assert.ok(sw.includes(needle), needle);
  }
  assert.match(sw, /url\.origin !== self\.location\.origin/, 'must not intercept cross-origin requests');
  assert.match(sw, /request\.method !== 'GET'/);
});

test('index.html registers the PWA pieces', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /<script src="\.\/pwa\.js" defer>/);
  for (const id of ['install-app', 'offline-status', 'offline-badge']) assert.match(html, new RegExp(`id="${id}"`));
});
