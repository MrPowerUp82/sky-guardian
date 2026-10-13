#!/usr/bin/env node
// Copies the PeerJS browser bundle from jsDelivr into vendor/peerjs/ so the game (and
// its offline cache) never depends on a CDN at play time.
//   node tools/vendor-peerjs.mjs            # pinned version below
//   node tools/vendor-peerjs.mjs 1.5.4
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv[2] || '1.5.4';
const BASE = `https://cdn.jsdelivr.net/npm/peerjs@${VERSION}/`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'peerjs');
const FILES = [['dist/peerjs.min.js', 'peerjs.min.js'], ['LICENSE', 'LICENSE']];

await fs.mkdir(OUT, { recursive: true });
for (const [remote, local] of FILES) {
  const res = await fetch(BASE + remote);
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`);
  await fs.writeFile(path.join(OUT, local), Buffer.from(await res.arrayBuffer()));
}
await fs.writeFile(path.join(OUT, 'VERSION'), `${VERSION}\n`);
console.log(`peerjs ${VERSION} -> vendor/peerjs/`);
