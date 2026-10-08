import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readGlbJson(path) {
  const buf = fs.readFileSync(path);
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4E4F534A) return JSON.parse(buf.subarray(off, off + len).toString('utf8').replace(/[\0\s]+$/g, ''));
    off += len;
  }
  throw new Error('GLB JSON chunk not found');
}

const expected = {
  iceBreathGroundStart: ['C003_IceBreath', false],
  iceBreathGroundLoop: ['C003_IceBreath_Loop', true],
  iceBreathGroundExit: ['C003_IceBreath_IntoIdle', false],
  iceBreathAirStart: ['C003_Air_IceBreath', false],
  iceBreathAirLoop: ['C003_Air_IceBreath_Loop', true],
  iceBreathAirExit: ['C003_Air_IceBreath_IntoIdle', false],
};

test('runtime Superman GLB inclui apenas os seis clips Ice Breath necessários', () => {
  const path = new URL('../assets/superman/Superman-game.glb', import.meta.url);
  const json = readGlbJson(path);
  const names = new Set((json.animations || []).map(a => a.name));
  for (const [clip] of Object.values(expected)) assert.ok(names.has(clip), `clip ausente: ${clip}`);
  assert.ok(fs.statSync(path).size < 18 * 1024 * 1024, 'runtime GLB deve permanecer abaixo de 18 MiB');
});

test('configuração V16 mapeia os seis slots e somente loops realmente repetem', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/superman-animation-config.json', import.meta.url), 'utf8'));
  for (const [slot, [clip, loop]] of Object.entries(expected)) {
    assert.equal(cfg.slots[slot]?.clip, clip, `${slot}.clip`);
    assert.equal(cfg.slots[slot]?.loop, loop, `${slot}.loop`);
  }
});

test('fallback e configurador expõem todos os slots Ice Breath', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const configurator = fs.readFileSync(new URL('../animation-configurator.js', import.meta.url), 'utf8');
  for (const slot of Object.keys(expected)) {
    assert.match(main, new RegExp(`${slot}\\s*:`), `fallback ausente: ${slot}`);
    assert.match(configurator, new RegExp(`['\"]${slot}['\"]`), `configurador ausente: ${slot}`);
  }
});
