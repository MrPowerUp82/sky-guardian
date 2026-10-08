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

test('runtime Superman GLB inclui LeapAttack e LeapAttackLand', () => {
  const json = readGlbJson(new URL('../assets/superman/Superman-game.glb', import.meta.url));
  const names = new Set((json.animations || []).map(a => a.name));
  assert.ok(names.has('C003_LeapAttack'));
  assert.ok(names.has('C003_LeapAttackLand'));
});

test('configuração V13 expõe os slots autorais do Leap Attack', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/superman-animation-config.json', import.meta.url), 'utf8'));
  assert.equal(cfg.slots.leapAttack.clip, 'C003_LeapAttack');
  assert.equal(cfg.slots.leapAttackLand.clip, 'C003_LeapAttackLand');
  assert.equal(cfg.slots.leapAttack.loop, false);
  assert.equal(cfg.slots.leapAttackLand.loop, false);
});

test('main liga o Leap Attack à tecla C e ao touchdown', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /e\.code === 'KeyC'\) startLeapAttack\(\)/);
  assert.match(main, /C003_LeapAttackLand/);
  assert.match(main, /triggerLeapImpact\(\)/);
});
