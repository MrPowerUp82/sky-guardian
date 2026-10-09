#!/usr/bin/env node
// Copies the exact three.js modules the game imports (and everything they import)
// from the jsDelivr CDN into vendor/three/, so the game needs no network to run.
//   node tools/vendor-three.mjs            # version below
//   node tools/vendor-three.mjs 0.186.0
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = process.argv[2] || '0.186.0';
const BASE = `https://cdn.jsdelivr.net/npm/three@${VERSION}/`;
const OUT = new URL('../vendor/three/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const ENTRIES = [
  'build/three.module.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/lines/LineMaterial.js',
  'examples/jsm/lines/LineSegments2.js',
  'examples/jsm/lines/LineSegmentsGeometry.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/ShaderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/utils/SkeletonUtils.js'
];

const IMPORT_RE = /(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;

const seen = new Set();
const queue = [...ENTRIES];
let bytes = 0;
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const res = await fetch(BASE + rel);
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  const text = await res.text();
  const file = path.join(OUT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  bytes += text.length;
  for (const m of text.matchAll(IMPORT_RE)) {
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
}
const license = await fetch(BASE + 'LICENSE');
if (license.ok) await fs.writeFile(path.join(OUT, 'LICENSE'), await license.text());
await fs.writeFile(path.join(OUT, 'VERSION'), `${VERSION}\n`);
console.log(`three@${VERSION}: ${seen.size} files, ${(bytes / 1024 / 1024).toFixed(2)} MB -> vendor/three`);
