#!/usr/bin/env node
// Re-encodes the PNG textures inside a GLB as lossless WebP (EXT_texture_webp).
// Every pixel is identical to the PNG (checked below before anything is written);
// the file just gets smaller. Textures that would not shrink stay PNG. Only the
// image bytes change: meshes, skeletons, animations and accessors are copied as is.
//
//   npm i --no-save sharp
//   node tools/webp-textures.mjs in.glb [out.glb]
//
// Without `out.glb` the input file is replaced. Run `npm run pwa` afterwards so the
// service worker re-downloads the changed model.
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { readGlb, writeGlb } from './bake-subclips.mjs';

const EXTENSION = 'EXT_texture_webp';

async function pixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Returns the new { json, bin } and a report, or null when nothing shrank.
export async function convertGlb(glb, log = () => {}) {
  const { json, bin } = glb;
  const views = json.bufferViews || [];
  const replaced = new Map(); // bufferView index -> WebP bytes
  const converted = new Set(); // image index

  for (const [index, image] of (json.images || []).entries()) {
    if (image.bufferView == null || image.mimeType !== 'image/png') continue;
    const view = views[image.bufferView];
    const png = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    // `exact` keeps the RGB of fully transparent pixels; `effort: 6` is the slowest, smallest encode.
    const webp = await sharp(png).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
    const [a, b] = await Promise.all([pixels(png), pixels(webp)]);
    if (a.width !== b.width || a.height !== b.height || !a.data.equals(b.data)) {
      throw new Error(`image ${index}: the WebP does not match the PNG pixel for pixel; nothing written`);
    }
    const name = image.name || `image ${index}`;
    if (webp.byteLength >= png.byteLength) {
      log(`${name}: ${(png.byteLength / 1024) | 0} KB PNG kept (WebP ${(webp.byteLength / 1024) | 0} KB is not smaller)`);
      continue;
    }
    log(`${name}: ${(png.byteLength / 1024) | 0} KB -> ${(webp.byteLength / 1024) | 0} KB (identical pixels)`);
    replaced.set(image.bufferView, webp);
    converted.add(index);
  }
  if (!converted.size) return null;

  // Rebuild the BIN chunk: same bufferViews in the same order, 4-byte aligned.
  const parts = [];
  let offset = 0;
  const nextViews = views.map((view, index) => {
    const bytes = replaced.get(index) ?? bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const next = { ...view, byteOffset: offset, byteLength: bytes.byteLength };
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    parts.push(bytes, Buffer.alloc(pad));
    offset += bytes.byteLength + pad;
    return next;
  });

  const next = structuredClone(json);
  next.bufferViews = nextViews;
  next.buffers[0].byteLength = offset;
  for (const index of converted) next.images[index].mimeType = 'image/webp';
  for (const texture of next.textures || []) {
    if (!converted.has(texture.source)) continue;
    texture.extensions = { ...texture.extensions, [EXTENSION]: { source: texture.source } };
    delete texture.source;
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    next[key] = [...new Set([...(next[key] || []), EXTENSION])];
  }
  return { json: next, bin: Buffer.concat(parts), before: bin.length, after: offset };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output = input] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node tools/webp-textures.mjs in.glb [out.glb]');
    process.exit(1);
  }
  const result = await convertGlb(readGlb(input), console.log);
  if (!result) {
    console.log('nothing to convert');
  } else {
    writeGlb(output, result.json, result.bin);
    console.log(`${output}: binary data ${(result.before / 1048576).toFixed(2)} MB -> ${(result.after / 1048576).toFixed(2)} MB`);
  }
}
