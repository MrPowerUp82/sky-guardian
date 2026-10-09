import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readGlb, framePlan, blend, sampleTrack } from '../tools/bake-subclips.mjs';

const EXPECTED = {
  heatVisionGroundStart: ['C003_Laser_Ground_Start', false],
  heatVisionGroundLoop: ['C003_Laser_Ground_Loop', true],
  heatVisionGroundExit: ['C003_Laser_Ground_Exit', false],
  heatVisionAirStart: ['C003_Laser_Air_Start', false],
  heatVisionAirLoop: ['C003_Laser_Air_Loop', true],
  heatVisionAirExit: ['C003_Laser_Air_Exit', false]
};

test('framePlan: plain slice keeps start..end inclusive', () => {
  const plan = framePlan({ start: 3, end: 6 });
  assert.deepEqual(plan.map(p => p.a), [3, 4, 5, 6]);
});

test('framePlan: loop cross-fades the tail into the head and closes on itself', () => {
  const plan = framePlan({ start: 10, end: 24, loop: true, blend: 4 });
  assert.equal(plan.length, 10 + 1); // L = 14 - 4 = 10 frames + closing key
  // first key is the frame that would have followed the last one
  assert.deepEqual(plan[0], { a: 20, b: 10, k: 0 });
  assert.equal(plan[4].b, undefined);
  assert.deepEqual(plan.at(-1), { a: 20 }); // closing key equals the first key
  assert.throws(() => framePlan({ start: 0, end: 4, loop: true, blend: 3 }));
  assert.throws(() => framePlan({ start: 5, end: 5 }));
});

test('blend and sampleTrack interpolate linear and rotation tracks', () => {
  assert.deepEqual(blend([0, 0, 0], [2, 4, 6], .5, 'translation'), [1, 2, 3]);
  const q = blend([0, 0, 0, 1], [0, 1, 0, 0], .5, 'rotation');
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9);
  const times = new Float32Array([0, 1]);
  assert.deepEqual(sampleTrack(times, new Float32Array([0, 0, 0, 10, 10, 10]), 3, .25, 'translation'), [2.5, 2.5, 2.5]);
  assert.deepEqual(sampleTrack(times, new Float32Array([0, 0, 0, 10, 10, 10]), 3, 5, 'translation'), [10, 10, 10]);
  // duplicated keys must not produce NaN
  const dup = sampleTrack(new Float32Array([0, 1, 1, 2]), new Float32Array([0, 1, 2, 3]), 1, 1, 'translation');
  assert.ok(Number.isFinite(dup[0]));
});

test('runtime GLB has the six baked laser clips, all finite, loops closed', () => {
  const glb = readGlb(new URL('../assets/superman/Superman-game.glb', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const byName = new Map(glb.json.animations.map(a => [a.name, a]));
  for (const [clip, loop] of Object.values(EXPECTED)) {
    const anim = byName.get(clip);
    assert.ok(anim, `clip ausente: ${clip}`);
    let maxLoopGap = 0;
    for (const sampler of anim.samplers) {
      for (const idx of [sampler.input, sampler.output]) {
        const acc = glb.json.accessors[idx];
        const view = glb.json.bufferViews[acc.bufferView];
        const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type];
        for (let i = 0; i < acc.count * comps; i++) assert.ok(Number.isFinite(glb.bin.readFloatLE(view.byteOffset + i * 4)), `${clip}: valor não finito`);
      }
      if (loop) {
        const acc = glb.json.accessors[sampler.output];
        const view = glb.json.bufferViews[acc.bufferView];
        const comps = { VEC3: 3, VEC4: 4 }[acc.type];
        for (let c = 0; c < comps; c++) {
          const first = glb.bin.readFloatLE(view.byteOffset + c * 4);
          const last = glb.bin.readFloatLE(view.byteOffset + ((acc.count - 1) * comps + c) * 4);
          maxLoopGap = Math.max(maxLoopGap, Math.abs(first - last));
        }
      }
    }
    if (loop) assert.ok(maxLoopGap < 1e-5, `${clip}: loop não fecha (${maxLoopGap})`);
  }
  assert.ok(byName.has('C003_Laser_Air') && byName.has('C003_Laser_Ground'), 'clips originais devem permanecer');
});

test('configuração, fallback e configurador expõem os seis slots de visão de calor', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/superman-animation-config.json', import.meta.url), 'utf8'));
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const configurator = fs.readFileSync(new URL('../animation-configurator.js', import.meta.url), 'utf8');
  const motion = fs.readFileSync(new URL('../hero-motion.js', import.meta.url), 'utf8');
  for (const [slot, [clip, loop]] of Object.entries(EXPECTED)) {
    assert.equal(cfg.slots[slot]?.clip, clip, `${slot}.clip`);
    assert.equal(cfg.slots[slot]?.loop, loop, `${slot}.loop`);
    assert.match(main, new RegExp(`${slot}\s*:`), `fallback ausente: ${slot}`);
    assert.match(configurator, new RegExp(`['"]${slot}['"]`), `configurador ausente: ${slot}`);
  }
  for (const clip of ['C003_Laser_Ground_Start', 'C003_Laser_Ground_Loop', 'C003_Laser_Ground_Exit']) {
    assert.ok(motion.includes(`'${clip}'`), `${clip} deve manter a altura autoral no chão`);
  }
});

test('visão de calor entra no Loop segurando Q e sai pelo Exit ao soltar', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /function beginHeatVisionExit\s*\(/);
  const stop = main.match(/function stopHeatVision[\s\S]*?\n\}/)?.[0] || '';
  assert.match(stop, /heatVisionAnimPhase === 'loop'\) beginHeatVisionExit\(\)/);
  const start = main.match(/function startHeatVision\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(start, /startHeatVisionHoldLoop\(\)[\s\S]*beginHeatVisionExit\(\)/);
});
