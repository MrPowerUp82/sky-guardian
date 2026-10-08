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
    if (type === 0x4E4F534A) {
      return JSON.parse(buf.subarray(off, off + len).toString('utf8').replace(/[\0\s]+$/g, ''));
    }
    off += len;
  }
  throw new Error('GLB JSON chunk not found');
}

test('runtime Superman GLB inclui os clips V12 solicitados', () => {
  const json = readGlbJson(new URL('../assets/superman/Superman-game.glb', import.meta.url));
  const names = new Set((json.animations || []).map(a => a.name));
  assert.ok(names.has('C003_Laser_Air'));
  assert.ok(names.has('C003_Laser_Ground'));
  assert.ok(names.has('C003_Flying_Stop'));
  assert.ok(names.has('C003_S08_Emote_CharacterSelect_Loop'));
});

test('configuração V12 mapeia airIdle e laser de solo', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/superman-animation-config.json', import.meta.url), 'utf8'));
  assert.equal(cfg.slots.airIdle.clip, 'C003_S08_Emote_CharacterSelect_Loop');
  assert.equal(cfg.slots.flyStop.clip, 'C003_Flying_Stop');
  assert.equal(cfg.slots.heatVision.clip, 'C003_Laser_Air');
  assert.equal(cfg.slots.heatVisionGround.clip, 'C003_Laser_Ground');
});
