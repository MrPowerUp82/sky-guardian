// Scratch: inspects translation tracks of animations in a GLB.
import fs from 'node:fs';
const file = process.argv[2];
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.slice(binStart);
function readAcc(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let k = 0; k < a.count * comps; k++) out.push(bin.readFloatLE(off + k * 4));
  return { data: out, comps, count: a.count };
}
console.log('nodes', json.nodes.length, 'anims', json.animations.length);
for (const anim of json.animations) {
  const rows = [];
  let dur = 0;
  for (const ch of anim.channels) {
    const node = json.nodes[ch.target.node];
    const s = anim.samplers[ch.sampler];
    const t = readAcc(s.input);
    dur = Math.max(dur, t.data[t.count - 1]);
    if (ch.target.path !== 'translation') continue;
    const v = readAcc(s.output);
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < v.count; k++) { const y = v.data[k * 3 + 1]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const parent = json.nodes.findIndex(n => (n.children || []).includes(ch.target.node));
    if (/root|hip|pelvis|trans|rig|scene/i.test(node.name) || parent < 0)
      rows.push(`${node.name}: Y ${minY.toFixed(3)}..${maxY.toFixed(3)} (d ${(maxY - minY).toFixed(3)})`);
  }
  console.log(anim.name, 'dur', dur.toFixed(2), '|', rows.slice(0, 3).join(' ; '));
}
