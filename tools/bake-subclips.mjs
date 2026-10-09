#!/usr/bin/env node
// Bakes new animation clips into a GLB by slicing frames out of an existing clip
// of the same file. Used to build the Start / Loop / Exit pieces of one-shot
// performances (e.g. the heat-vision laser).
//
//   node tools/bake-subclips.mjs <file.glb> <spec.json>
//
// spec.json is an array of
//   { "source": "C003_Laser_Ground", "name": "C003_Laser_Ground_Loop",
//     "start": 16, "end": 26, "fps": 24, "loop": true, "blend": 3 }
//
// A plain slice keeps frames start..end. With "loop": true the slice is turned
// into a seamless loop: the last `blend` frames are cross-faded into the first
// ones, so the final key equals the first key and LoopRepeat has no visible seam.
import fs from 'node:fs';

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    off += 8;
    const chunk = buf.subarray(off, off + len);
    if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8').replace(/[\0\s]+$/g, ''));
    else if (type === 0x004E4942) bin = Buffer.from(chunk);
    off += len;
  }
  if (!json || (json.buffers?.length || 0) !== 1) throw new Error(`${file}: expected JSON chunk and exactly one buffer`);
  return { json, bin };
}

const pad4 = (buf, byte = 0) => {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, byte)]) : buf;
};

export function writeGlb(file, json, bin) {
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBuf = pad4(bin);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, Buffer.concat([header, jh, jsonBuf, bh, binBuf]));
  fs.renameSync(tmp, file);
}

const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };

function readAccessor(glb, index) {
  const a = glb.json.accessors[index];
  if (a.componentType !== 5126 || a.normalized || a.sparse) throw new Error(`accessor ${index}: only plain float accessors are supported`);
  const view = glb.json.bufferViews[a.bufferView];
  const comps = COMPONENTS[a.type];
  const stride = view.byteStride || comps * 4;
  const base = (view.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = glb.bin.readFloatLE(base + i * stride + c * 4);
  return { data: out, comps, count: a.count };
}

// Pose of one track at time t (linear / step interpolation, quaternions nlerp'd).
export function sampleTrack(times, values, comps, t, path, interpolation = 'LINEAR') {
  const n = times.length;
  const out = new Array(comps);
  if (n === 1 || t <= times[0]) { for (let c = 0; c < comps; c++) out[c] = values[c]; return out; }
  if (t >= times[n - 1]) { for (let c = 0; c < comps; c++) out[c] = values[(n - 1) * comps + c]; return out; }
  let i = 0;
  while (times[i + 1] < t) i++;
  const span = times[i + 1] - times[i];
  const k = span > 0 ? (t - times[i]) / span : 0;
  if (interpolation === 'STEP') { for (let c = 0; c < comps; c++) out[c] = values[i * comps + c]; return out; }
  return blend(values.subarray(i * comps, i * comps + comps), values.subarray((i + 1) * comps, (i + 2) * comps), k, path);
}

export function blend(a, b, k, path) {
  const out = new Array(a.length);
  if (path === 'rotation') {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = dot < 0 ? -1 : 1;
    let len = 0;
    for (let c = 0; c < 4; c++) { out[c] = a[c] * (1 - k) + b[c] * s * k; len += out[c] * out[c]; }
    len = Math.sqrt(len) || 1;
    for (let c = 0; c < 4; c++) out[c] /= len;
    return out;
  }
  for (let c = 0; c < a.length; c++) out[c] = a[c] * (1 - k) + b[c] * k;
  return out;
}

// Frame plan: for each output frame, which source frame(s) to blend.
export function framePlan({ start, end, loop = false, blend: n = 0 }) {
  if (!(end > start)) throw new Error('end must be greater than start');
  if (!loop) return Array.from({ length: end - start + 1 }, (_, i) => ({ a: start + i }));
  if (!(n >= 1) || end - start - n < 2) throw new Error('loop needs blend >= 1 and (end - start - blend) >= 2');
  const len = end - start - n;
  const plan = [];
  for (let i = 0; i <= len; i++) {
    if (i < n) plan.push({ a: start + len + i, b: start + i, k: i / n });
    else plan.push({ a: start + i });
  }
  return plan;
}

export function bakeSubclip(glb, spec) {
  const { json } = glb;
  const source = json.animations.find(a => a.name === spec.source);
  if (!source) throw new Error(`source clip missing: ${spec.source}`);
  if (json.animations.some(a => a.name === spec.name)) throw new Error(`clip already exists: ${spec.name}`);
  const fps = spec.fps || 24;
  const plan = framePlan(spec);
  const times = Float32Array.from(plan, (_, i) => i / fps);

  let bin = glb.bin;
  const addAccessor = (data, type, min, max) => {
    bin = pad4(bin);
    const byteOffset = bin.length;
    const bytes = Buffer.alloc(data.length * 4);
    data.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    bin = Buffer.concat([bin, bytes]);
    const view = json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length }) - 1;
    const accessor = { bufferView: view, componentType: 5126, count: data.length / COMPONENTS[type], type };
    if (min) { accessor.min = min; accessor.max = max; }
    return json.accessors.push(accessor) - 1;
  };
  const timeAccessor = addAccessor(times, 'SCALAR', [times[0]], [times[times.length - 1]]);

  const anim = { name: spec.name, samplers: [], channels: [] };
  for (const channel of source.channels) {
    const sampler = source.samplers[channel.sampler];
    const path = channel.target.path;
    const input = readAccessor(glb, sampler.input);
    const output = readAccessor(glb, sampler.output);
    const interpolation = sampler.interpolation || 'LINEAR';
    if (interpolation === 'CUBICSPLINE') throw new Error(`${spec.source}: CUBICSPLINE tracks are not supported`);
    const comps = output.comps;
    const values = new Float32Array(plan.length * comps);
    plan.forEach((step, i) => {
      const pa = sampleTrack(input.data, output.data, comps, step.a / fps, path, interpolation);
      const pose = step.b === undefined ? pa : blend(pa, sampleTrack(input.data, output.data, comps, step.b / fps, path, interpolation), step.k, path);
      values.set(pose, i * comps);
    });
    const valueAccessor = addAccessor(values, comps === 4 ? 'VEC4' : 'VEC3');
    anim.samplers.push({ input: timeAccessor, output: valueAccessor, interpolation: 'LINEAR' });
    anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: channel.target.node, path } });
  }
  json.animations.push(anim);
  json.buffers[0].byteLength = pad4(bin).length;
  glb.bin = pad4(bin);
  return anim;
}

function main() {
  const [file, specFile] = process.argv.slice(2);
  if (!file || !specFile) throw new Error('usage: bake-subclips.mjs <file.glb> <spec.json>');
  const glb = readGlb(file);
  const specs = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  for (const spec of specs) bakeSubclip(glb, spec);
  writeGlb(file, glb.json, glb.bin);
  console.log(`Baked ${specs.length} clips into ${file}: ${specs.map(s => s.name).join(', ')}`);
}

if (process.argv[1]?.endsWith('bake-subclips.mjs')) {
  try { main(); } catch (err) { console.error(err?.stack || err); process.exit(1); }
}
