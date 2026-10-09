#!/usr/bin/env node
// Builds pwa-manifest.json (what the service worker pre-caches) and stamps the
// matching VERSION into sw.js. Run it after adding/removing/changing game files:
//   npm run pwa
//
// core   = small files the game needs to boot; cached when the worker installs
//          and refreshed network-first, so code edits never need a rebuild.
// assets = the large .glb models; downloaded in the background with a content
//          hash each, so only changed models are fetched again.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOT_FILES = [
  'index.html', 'style.css', 'main.js', 'hero-motion.js', 'hero-state.js', 'animation-config-runtime.js',
  'animation-configurator.html', 'animation-configurator.css', 'animation-configurator.js',
  'favicon.svg', 'manifest.webmanifest', 'pwa.js'
];
const CORE_DIRS = [
  ['game', /\.js$/], ['config', /\.json$/], ['vendor', /\.(js|md)$|LICENSE$|VERSION$/], ['icons', /\.png$/]
];
const ASSET_DIR = ['assets', /\.glb$/];

async function walk(dir, pattern, out = []) {
  let entries;
  try { entries = await fs.readdir(path.join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(rel, pattern, out);
    else if (pattern.test(entry.name)) out.push(rel);
  }
  return out;
}

const hashFile = async rel => crypto.createHash('sha1').update(await fs.readFile(path.join(ROOT, rel))).digest('hex').slice(0, 16);

export async function buildManifest() {
  const core = ['./'];
  for (const file of ROOT_FILES) {
    await fs.access(path.join(ROOT, file));
    core.push(`./${file}`);
  }
  for (const [dir, pattern] of CORE_DIRS) for (const rel of await walk(dir, pattern)) core.push(`./${rel}`);

  const assets = [];
  for (const rel of await walk(...ASSET_DIR)) {
    const stat = await fs.stat(path.join(ROOT, rel));
    assets.push({ url: `./${rel}`, hash: await hashFile(rel), size: stat.size });
  }

  // The version changes when the *set* of files or any model changes. Core file
  // contents are fetched network-first, so editing code does not alter it.
  const version = crypto.createHash('sha1')
    .update(JSON.stringify({ core, assets: assets.map(a => [a.url, a.hash]) }))
    .digest('hex').slice(0, 10);
  return { version, core, assets, assetBytes: assets.reduce((sum, a) => sum + a.size, 0) };
}

async function main() {
  const manifest = await buildManifest();
  await fs.writeFile(path.join(ROOT, 'pwa-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const swPath = path.join(ROOT, 'sw.js');
  const sw = await fs.readFile(swPath, 'utf8');
  const next = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${manifest.version}';`);
  if (next === sw && !sw.includes(`'${manifest.version}'`)) throw new Error('sw.js has no VERSION line to update');
  await fs.writeFile(swPath, next);
  console.log(`pwa ${manifest.version}: ${manifest.core.length} core files, ${manifest.assets.length} models (${(manifest.assetBytes / 1048576).toFixed(1)} MB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
