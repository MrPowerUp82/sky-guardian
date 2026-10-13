import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHARACTERS, getSkin, loadSkinIds, saveSkinId, SKIN_STORAGE_KEY
} from '../game/characters/registry.js';
import { readGlb } from '../tools/bake-subclips.mjs';

const asset = rel => new URL(`../${rel}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
};

test('every character has a default skin first; Superman and Flash each have two', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.skins.length >= 1);
    assert.equal(c.skins[0].modelUrl, c.modelUrl, `${c.id}: first skin is the default model`);
    assert.equal(new Set(c.skins.map(s => s.id)).size, c.skins.length);
    for (const skin of c.skins) {
      assert.ok(skin.id && skin.name && skin.credit && skin.swatch?.length === 2);
      assert.ok(fs.existsSync(asset(skin.modelUrl)), `${skin.modelUrl} exists`);
    }
  }
  assert.deepEqual(CHARACTERS.find(c => c.id === 'superman').skins.map(s => s.id), ['classic', 'armor']);
  assert.deepEqual(CHARACTERS.find(c => c.id === 'flash').skins.map(s => s.id), ['classic', 'reverse']);
  assert.equal(getSkin('flash', 'reverse').fx, 'reverse-flash');
});

test('skin choice persists per character and falls back on bad data', () => {
  const store = memoryStorage();
  assert.deepEqual(loadSkinIds(store), { superman: 'classic', flash: 'classic' });
  assert.equal(saveSkinId(store, 'flash', 'reverse'), true);
  assert.equal(saveSkinId(store, 'superman', 'armor'), true);
  assert.deepEqual(loadSkinIds(store), { superman: 'armor', flash: 'reverse' });
  assert.equal(saveSkinId(store, 'flash', 'nope'), false);
  assert.equal(saveSkinId(store, 'nobody', 'classic'), false);
  assert.deepEqual(loadSkinIds(memoryStorage({ [SKIN_STORAGE_KEY]: '{bad json' })), { superman: 'classic', flash: 'classic' });
  assert.deepEqual(loadSkinIds(memoryStorage({ [SKIN_STORAGE_KEY]: '{"flash":"deleted-skin"}' })), { superman: 'classic', flash: 'classic' });
  assert.deepEqual(loadSkinIds(null), { superman: 'classic', flash: 'classic' });
});

test('Superman skins share the clip names and bone names the game looks up', () => {
  const classic = readGlb(asset('assets/superman/Superman-game.glb')).json;
  const armor = readGlb(asset('assets/superman/Superman-armor.glb')).json;
  const clips = new Set(armor.animations.map(a => a.name));
  for (const a of classic.animations) assert.ok(clips.has(a.name), `armor lacks ${a.name}`);
  const bones = new Set(armor.nodes.map(n => n.name));
  for (const j of classic.skins[0].joints) {
    const name = classic.nodes[j].name;
    if (!/sharkHat/.test(name)) assert.ok(bones.has(name), `armor lacks bone ${name}`);
  }
  assert.equal(armor.skins.length, 1);
  assert.ok(fs.statSync(asset('assets/superman/Superman-armor.glb')).size < 16 * 1024 * 1024);
});

test('Reverse Flash GLB is rig- and clip-compatible with The Flash', () => {
  const flash = readGlb(asset('assets/flash/the-flash.glb')).json;
  const reverse = readGlb(asset('assets/flash/reverse-flash.glb')).json;
  const clips = new Set(reverse.animations.map(a => a.name));
  for (const a of flash.animations) assert.ok(clips.has(a.name), `reverse lacks ${a.name}`);
  // Exporters number the bones differently (_00 vs _059); the game matches by prefix.
  const joints = g => g.skins[0].joints.map(j => g.nodes[j].name.replace(/_\d+$/, ''));
  // The reverse rig may carry extra bones (toes); every bone The Flash animates must exist.
  const reverseJoints = new Set(joints(reverse));
  for (const name of joints(flash)) assert.ok(reverseJoints.has(name), `reverse lacks bone ${name}`);
  assert.match(reverse.asset.extras.license, /CC-BY/);
});

test('main.js and ATTRIBUTION wire up the skins', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  for (const needle of ['loadSkinIds', 'selectSkin', 'ReverseFlashFx', "palette: reverse ? 'crimson'", 'setVibrate']) assert.ok(main.includes(needle), needle);
  const credits = fs.readFileSync(new URL('../ATTRIBUTION.md', import.meta.url), 'utf8');
  assert.match(credits, /Reverse Flash/i);
  assert.match(credits, /Superman-armor\.glb/);
});
