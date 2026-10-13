#!/usr/bin/env node
// Builds a lean gameplay GLB for an alternate Superman skin from a full export.
//
//   node tools/build-skin-glb.mjs <source.glb> <out.glb> <reference.glb> [bake.json]
//
// - bakes the Start/Loop/Exit sub-clips described by bake.json (see bake-subclips.mjs)
// - keeps only the animation clips the reference GLB (the shipped Superman) uses,
//   so every skin answers to the same clip names
// - drops everything that is no longer referenced (accessors, buffer views) and
//   repacks the binary chunk
import fs from 'node:fs';
import { readGlb, writeGlb, bakeSubclip } from './bake-subclips.mjs';

function compact(glb) {
  const { json } = glb;
  const used = new Set();
  const markAccessor = i => { if (i != null) used.add(i); };
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      Object.values(prim.attributes).forEach(markAccessor);
      markAccessor(prim.indices);
      for (const target of prim.targets || []) Object.values(target).forEach(markAccessor);
    }
  }
  for (const skin of json.skins || []) markAccessor(skin.inverseBindMatrices);
  for (const anim of json.animations || []) for (const s of anim.samplers) { markAccessor(s.input); markAccessor(s.output); }

  const accessorMap = new Map();
  const accessors = [];
  const viewOrder = [];
  const viewMap = new Map();
  const useView = index => {
    if (!viewMap.has(index)) { viewMap.set(index, viewOrder.length); viewOrder.push(index); }
    return viewMap.get(index);
  };
  for (const i of [...used].sort((a, b) => a - b)) {
    const next = structuredClone(json.accessors[i]);
    if (next.bufferView != null) next.bufferView = useView(next.bufferView);
    if (next.sparse) throw new Error('sparse accessors are not supported');
    accessorMap.set(i, accessors.length);
    accessors.push(next);
  }
  for (const image of json.images || []) if (image.bufferView != null) image.bufferView = useView(image.bufferView);

  const chunks = [];
  let offset = 0;
  const views = viewOrder.map(old => {
    const src = json.bufferViews[old];
    const start = src.byteOffset || 0;
    const slice = glb.bin.subarray(start, start + src.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    chunks.push(slice);
    const view = { ...src, buffer: 0, byteOffset: offset };
    offset += slice.length;
    return view;
  });

  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      for (const k of Object.keys(prim.attributes)) prim.attributes[k] = accessorMap.get(prim.attributes[k]);
      if (prim.indices != null) prim.indices = accessorMap.get(prim.indices);
    }
  }
  for (const skin of json.skins || []) if (skin.inverseBindMatrices != null) skin.inverseBindMatrices = accessorMap.get(skin.inverseBindMatrices);
  for (const anim of json.animations || []) for (const s of anim.samplers) { s.input = accessorMap.get(s.input); s.output = accessorMap.get(s.output); }

  json.accessors = accessors;
  json.bufferViews = views;
  const bin = Buffer.concat(chunks);
  const padded = (4 - (bin.length % 4)) % 4 ? Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]) : bin;
  json.buffers = [{ byteLength: padded.length }];
  glb.bin = padded;
}

function main() {
  const [sourceFile, outFile, referenceFile, bakeFile] = process.argv.slice(2);
  if (!sourceFile || !outFile || !referenceFile) throw new Error('usage: build-skin-glb.mjs <source.glb> <out.glb> <reference.glb> [bake.json]');
  const glb = readGlb(sourceFile);
  const keep = new Set(readGlb(referenceFile).json.animations.map(a => a.name));
  if (bakeFile) for (const spec of JSON.parse(fs.readFileSync(bakeFile, 'utf8'))) bakeSubclip(glb, spec);
  const missing = [...keep].filter(name => !glb.json.animations.some(a => a.name === name));
  if (missing.length) throw new Error(`source lacks clips: ${missing.join(', ')}`);
  glb.json.animations = glb.json.animations.filter(a => keep.has(a.name));
  compact(glb);
  writeGlb(outFile, glb.json, glb.bin);
  console.log(`${outFile}: ${glb.json.animations.length} clips, ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB`);
}

try { main(); }
catch (err) { console.error(err?.stack || err); process.exit(1); }
