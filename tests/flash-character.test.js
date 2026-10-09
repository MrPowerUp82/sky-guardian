import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTERS, getCharacter, isCharacterId, loadCharacterId, saveCharacterId, CHARACTER_STORAGE_KEY, DEFAULT_CHARACTER
} from '../game/characters/registry.js';
import {
  FLASH_TUNING as T, approach, targetSpeed, stepEnergy, canAfford, sprintLevel, pickLocomotion, locomotionScale,
  flurrySchedule, PUNCH_HIT_TIMES, approachPoint, rayPointClosest, jaggedPath
} from '../game/characters/flash-math.js';

test('registry has Superman and The Flash with complete data', () => {
  assert.deepEqual(CHARACTERS.map(c => c.id), ['superman', 'flash']);
  const touchIds = ['heat', 'ice', 'turbo', 'leap', 'super', 'dodge', 'punch', 'fly'];
  for (const c of CHARACTERS) {
    assert.ok(c.name && c.tagline && c.modelUrl && c.credit && c.energyLabel);
    assert.ok(c.abilities.length >= 5);
    for (const a of c.abilities) assert.ok(a.key && a.name && a.desc);
    for (const id of touchIds) assert.ok(c.touchLabels[id], `${c.id} touch label ${id}`);
  }
  assert.equal(getCharacter('flash').canFly, false);
  assert.equal(getCharacter('superman').canFly, true);
  assert.equal(getCharacter('nope').id, DEFAULT_CHARACTER);
});

test('flash abilities are exclusive: no flight, no heat vision, no ice breath', () => {
  const names = getCharacter('flash').abilities.map(a => a.name.toLowerCase()).join('|');
  for (const forbidden of ['voo', 'visão de calor', 'sopro congelante', 'leap']) assert.ok(!names.includes(forbidden), forbidden);
});

test('character selection persists and survives bad storage', () => {
  const data = new Map();
  const store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(loadCharacterId(store), 'superman');
  assert.equal(saveCharacterId(store, 'flash'), true);
  assert.equal(data.get(CHARACTER_STORAGE_KEY), 'flash');
  assert.equal(loadCharacterId(store), 'flash');
  assert.equal(saveCharacterId(store, 'batman'), false);
  data.set(CHARACTER_STORAGE_KEY, 'garbage');
  assert.equal(loadCharacterId(store), 'superman');
  assert.equal(loadCharacterId({ getItem() { throw new Error('x'); } }), 'superman');
  assert.equal(isCharacterId('flash'), true);
});

test('approach never overshoots', () => {
  assert.equal(approach(0, 10, 5, 1), 5);
  assert.equal(approach(8, 10, 5, 1), 10);
  assert.equal(approach(10, 0, 4, 1), 6);
  assert.equal(approach(1, 0, 4, 1), 0);
});

test('speed targets: idle, jog, sprint, exhausted', () => {
  assert.equal(targetSpeed({ hasInput: false, sprinting: true, exhausted: false }), 0);
  assert.equal(targetSpeed({ hasInput: true, sprinting: false, exhausted: false }), T.baseSpeed);
  assert.equal(targetSpeed({ hasInput: true, sprinting: true, exhausted: false }), T.sprintMax);
  assert.equal(targetSpeed({ hasInput: true, sprinting: true, exhausted: true }), T.baseSpeed);
});

test('energy drains while used, regenerates when idle, and locks sprint when empty', () => {
  let s = { energy: 100, exhausted: false };
  s = stepEnergy(s, { sprint: true }, 1);
  assert.equal(s.energy, 100 - T.drains.sprint);
  s = stepEnergy({ energy: 50, exhausted: false }, {}, 1);
  assert.equal(s.energy, 50 + T.energyRegen);
  s = stepEnergy({ energy: 3, exhausted: false }, { slow: true }, 1);
  assert.deepEqual(s, { energy: 0, exhausted: true });
  // stays exhausted until enough energy is back
  s = stepEnergy(s, {}, 1);
  assert.equal(s.exhausted, true);
  s = stepEnergy({ energy: 2, exhausted: true }, {}, 1);
  assert.equal(s.exhausted, true);   // 17 < 22
  s = stepEnergy({ energy: 10, exhausted: true }, {}, 1);
  assert.equal(s.exhausted, false);  // 25 >= 22
  // never above max
  assert.equal(stepEnergy({ energy: 99.9, exhausted: false }, {}, 5).energy, T.energyMax);
  assert.equal(canAfford(24, T.costs.flurry), false);
  assert.equal(canAfford(25, T.costs.flurry), true);
});

test('sprint level and animation scaling are monotonic and bounded', () => {
  assert.equal(sprintLevel(0), 0);
  assert.equal(sprintLevel(T.sprintMax), 1);
  assert.ok(sprintLevel(40) > sprintLevel(25));
  assert.equal(pickLocomotion(0), 'stand');
  assert.equal(pickLocomotion(3), 'walk');
  assert.equal(pickLocomotion(13), 'run');
  assert.ok(locomotionScale('run', 72) <= 3.4 && locomotionScale('run', 72) > locomotionScale('run', 13));
  assert.ok(locomotionScale('walk', .1) >= .6);
  assert.equal(locomotionScale('stand', 0), 1);
});

test('flurry schedule: 8 hits, increasing, spaced for the enemy hit-invulnerability window', () => {
  const times = flurrySchedule(1.8);
  assert.equal(times.length, PUNCH_HIT_TIMES.length);
  assert.equal(times.length, 8);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= .115, `gap ${i}`);
  assert.ok(times[0] >= 0);
});

test('approachPoint stops short of the target along the line', () => {
  const p = approachPoint({ x: 0, z: 0 }, { x: 10, z: 0 }, 2);
  assert.ok(Math.abs(p.x - 8) < 1e-9 && Math.abs(p.z) < 1e-9);
  assert.deepEqual(approachPoint({ x: 0, z: 0 }, { x: 1, z: 0 }, 2), { x: 0, z: 0 });
});

test('rayPointClosest measures the miss distance of a bolt', () => {
  const hit = rayPointClosest({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, { x: 0, y: 1, z: 20 });
  assert.ok(Math.abs(hit.t - 20) < 1e-9 && Math.abs(hit.distance - 1) < 1e-9);
  const behind = rayPointClosest({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -5 });
  assert.equal(behind.t, 0); assert.equal(behind.distance, 5);
  assert.equal(rayPointClosest({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 50 }, 10).t, 10);
});

test('jaggedPath keeps exact endpoints and bounded displacement', () => {
  let seed = 1; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 10 };
  const p = jaggedPath(a, b, 8, .5, rand);
  assert.equal(p.length, 27);
  assert.deepEqual([p[0], p[1], p[2]], [0, 0, 0]);
  assert.deepEqual([p[24], p[25], p[26]], [0, 0, 10]);
  for (let i = 1; i < 8; i++) assert.ok(Math.hypot(p[i * 3], p[i * 3 + 1]) <= .5 * Math.SQRT2 + 1e-9);
  // degenerate (a == b) must not produce NaN
  assert.ok(jaggedPath(a, a, 4, .3, rand).every(Number.isFinite));
  // vertical bolt still gets perpendicular offsets
  assert.ok(jaggedPath(a, { x: 0, y: 10, z: 0 }, 6, .4, rand).every(Number.isFinite));
});

// --- integration / assets ---------------------------------------------------------
import fs from 'node:fs';
import { FireSystem } from '../game/fire/fire-system.js';
import { readGlb } from '../tools/bake-subclips.mjs';

test('FireSystem.applyCoolingSphere cools every spot around the Flash, ignores far ones', () => {
  const fire = new FireSystem();
  const mk = (id, x, z) => ({ id, eventId: 'e', position: { x, y: 0, z }, normal: { x: 0, y: 1, z: 0 }, radius: 1.5, intensity: 1 });
  fire.addSpot(mk('near', 3, 0));
  fire.addSpot(mk('behind', -4, -2));
  fire.addSpot(mk('far', 60, 0));
  const affected = fire.applyCoolingSphere({ origin: { x: 0, y: 0, z: 0 }, radius: 10, dt: 1, rate: 0.5 });
  assert.deepEqual(affected.sort(), ['behind', 'near']);
  assert.ok(fire.getSpot('near').intensity < 1 && fire.getSpot('behind').intensity < 1);
  assert.equal(fire.getSpot('far').intensity, 1);
  // keeps cooling until extinguished
  for (let i = 0; i < 10; i++) fire.applyCoolingSphere({ origin: { x: 0, y: 0, z: 0 }, radius: 10, dt: 1, rate: 0.5 });
  assert.equal(fire.getSpot('near').state, 'extinguished');
  assert.deepEqual(fire.applyCoolingSphere({ origin: { x: 0, y: 0, z: 0 }, radius: 10, dt: 0 }), []);
});

test('The Flash GLB: expected Mixamo clips and rig, project-sized', () => {
  const file = new URL('../assets/flash/the-flash.glb', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const { json } = readGlb(file);
  const clips = new Set(json.animations.map(a => a.name));
  for (const name of ['stand', 'walk', 'run', 'jumpUp', 'jumpDown', 'punch']) assert.ok(clips.has(name), `clip ausente: ${name}`);
  assert.equal(json.skins.length, 1);
  assert.ok(json.skins[0].joints.length >= 60);
  assert.ok(fs.statSync(file).size < 4 * 1024 * 1024);
  assert.match(json.asset.extras.license, /CC-BY/);
});

test('main.js wires the character system and ATTRIBUTION credits the Flash model', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  for (const needle of ['FlashController', 'SpeedForceFx', 'selectCharacter', 'flashActive()', 'layoutRings', 'worldScale']) assert.ok(main.includes(needle), needle);
  // Superman's flight/heat/ice input must not run while the Flash is active.
  assert.match(main, /if \(flashActive\(\)\) \{\s*if \(e\.code === 'KeyR'\) resetGame\(\);\s*flash\.onKeyDown\(e\);\s*return;/);
  const credits = fs.readFileSync(new URL('../ATTRIBUTION.md', import.meta.url), 'utf8');
  assert.match(credits, /nitwit\.friends/);
});

test('the pause menu exposes the Personagem tab', () => {
  const menu = fs.readFileSync(new URL('../game/ui/pause-menu.js', import.meta.url), 'utf8');
  assert.match(menu, /\['character', 'Personagem'\]/);
});
