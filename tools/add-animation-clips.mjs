#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  if (buf.readUInt32LE(4) !== 2) throw new Error(`${file}: only GLB 2.0 is supported`);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    off += 8;
    const chunk = buf.subarray(off, off + len);
    if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8').replace(/[\0\s]+$/g, ''));
    else if (type === 0x004E4942) bin = Buffer.from(chunk);
    off += len;
  }
  if (!json) throw new Error(`${file}: JSON chunk missing`);
  if ((json.buffers?.length || 0) !== 1) throw new Error(`${file}: expected exactly one buffer`);
  return { json, bin };
}

function pad4(buf, byte = 0) {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, byte)]) : buf;
}

function writeGlbAtomic(file, json, bin) {
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBuf = pad4(bin, 0x00);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  const out = Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
}

function main() {
  const [targetFile, sourceFile, ...clipNames] = process.argv.slice(2);
  if (!targetFile || !sourceFile || !clipNames.length) {
    throw new Error('usage: add-animation-clips.mjs <target.glb> <source.glb> <clip...>');
  }
  const requested = new Set(clipNames);
  if (requested.size !== clipNames.length) throw new Error('duplicate requested clip name');

  const target = readGlb(targetFile);
  const source = readGlb(sourceFile);
  target.json.animations ||= [];
  target.json.accessors ||= [];
  target.json.bufferViews ||= [];

  const sourceByName = new Map((source.json.animations || []).map(a => [a.name, a]));
  const targetNames = new Set(target.json.animations.map(a => a.name));
  for (const name of clipNames) {
    if (!sourceByName.has(name)) throw new Error(`source clip missing: ${name}`);
    if (targetNames.has(name)) throw new Error(`target already contains clip: ${name}`);
  }

  const targetNodeByName = new Map();
  (target.json.nodes || []).forEach((node, index) => {
    if (node.name) {
      if (targetNodeByName.has(node.name)) throw new Error(`target has duplicate node name: ${node.name}`);
      targetNodeByName.set(node.name, index);
    }
  });

  let targetBin = Buffer.from(target.bin);
  const accessorMap = new Map();
  const viewMap = new Map();

  function copyBufferView(sourceIndex) {
    if (viewMap.has(sourceIndex)) return viewMap.get(sourceIndex);
    const src = source.json.bufferViews?.[sourceIndex];
    if (!src) throw new Error(`source bufferView missing: ${sourceIndex}`);
    const start = src.byteOffset || 0;
    const end = start + src.byteLength;
    const slice = source.bin.subarray(start, end);
    targetBin = pad4(targetBin, 0);
    const byteOffset = targetBin.length;
    targetBin = Buffer.concat([targetBin, slice]);
    const next = { ...src, buffer: 0, byteOffset };
    const newIndex = target.json.bufferViews.push(next) - 1;
    viewMap.set(sourceIndex, newIndex);
    return newIndex;
  }

  function copyAccessor(sourceIndex) {
    if (accessorMap.has(sourceIndex)) return accessorMap.get(sourceIndex);
    const src = source.json.accessors?.[sourceIndex];
    if (!src) throw new Error(`source accessor missing: ${sourceIndex}`);
    const next = structuredClone(src);
    if (next.bufferView != null) next.bufferView = copyBufferView(next.bufferView);
    if (next.sparse) {
      next.sparse.indices.bufferView = copyBufferView(next.sparse.indices.bufferView);
      next.sparse.values.bufferView = copyBufferView(next.sparse.values.bufferView);
    }
    const newIndex = target.json.accessors.push(next) - 1;
    accessorMap.set(sourceIndex, newIndex);
    return newIndex;
  }

  for (const name of clipNames) {
    const srcAnim = sourceByName.get(name);
    const anim = structuredClone(srcAnim);
    anim.samplers = (srcAnim.samplers || []).map(s => ({
      ...s,
      input: copyAccessor(s.input),
      output: copyAccessor(s.output),
    }));
    anim.channels = (srcAnim.channels || []).map(ch => {
      const sourceNode = source.json.nodes?.[ch.target.node];
      const nodeName = sourceNode?.name;
      if (!nodeName || !targetNodeByName.has(nodeName)) throw new Error(`${name}: target node missing for ${nodeName || ch.target.node}`);
      return { ...structuredClone(ch), target: { ...ch.target, node: targetNodeByName.get(nodeName) } };
    });
    target.json.animations.push(anim);
  }

  targetBin = pad4(targetBin, 0);
  target.json.buffers[0].byteLength = targetBin.length;
  writeGlbAtomic(targetFile, target.json, targetBin);
  console.log(`Added ${clipNames.length} animation clips to ${path.basename(targetFile)}`);
}

try { main(); }
catch (err) { console.error(err?.stack || err); process.exit(1); }
