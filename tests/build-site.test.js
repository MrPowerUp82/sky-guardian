import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../tools/build-site.mjs';

test('the Pages artifact has everything the game needs and nothing it does not', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-site-'));
  try {
    const { files } = await buildSite(out);
    assert.ok(files > 50);
    for (const rel of ['index.html', 'main.js', 'sw.js', 'pwa-manifest.json', 'manifest.webmanifest', 'vendor/peerjs/peerjs.min.js',
      'vendor/three/build/three.module.js', 'game/net/room.js', 'assets/flash/reverse-flash.glb', 'assets/superman/Superman-armor.glb']) {
      assert.ok(fs.existsSync(path.join(out, rel)), rel);
    }
    for (const rel of ['tests', 'tools', 'docs', 'node_modules', 'graphify-out', 'main.js.bak', 'sky_guardian_threejs.zip']) {
      assert.ok(!fs.existsSync(path.join(out, rel)), `${rel} must not be published`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the workflow tests, rebuilds the PWA manifest and publishes the generated site', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  for (const needle of ['npm test', 'npm run pwa', 'npm run site', 'actions/upload-pages-artifact', 'actions/deploy-pages', 'pages: write', 'id-token: write']) {
    assert.ok(yml.includes(needle), needle);
  }
});
