#!/usr/bin/env node
// Assembles the static site for GitHub Pages in ./_site, from the same file list the
// service worker precaches (pwa-manifest.json) plus the worker itself. Run `npm run pwa`
// first so the list is current.
//   node tools/build-site.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRA = ['sw.js', 'pwa-manifest.json'];

export async function buildSite(outDir = path.join(ROOT, '_site')) {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'pwa-manifest.json'), 'utf8'));
  const wanted = new Set([...manifest.core, ...manifest.assets.map(a => a.url), ...EXTRA.map(f => `./${f}`)]);
  wanted.delete('./');
  await fs.rm(outDir, { recursive: true, force: true });
  let files = 0;
  for (const url of wanted) {
    const rel = url.replace(/^\.\//, '');
    const target = path.join(outDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(ROOT, rel), target);
    files++;
  }
  return { files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files } = await buildSite(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`site: ${files} files`);
}
