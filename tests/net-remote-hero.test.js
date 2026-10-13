import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolveClipName, clipPlaysOnce } from '../game/net/remote-clips.js';
import { CHARACTERS, getCharacter } from '../game/characters/registry.js';

test('resolveClipName keeps a known clip, else the fallback, else anything, else empty', () => {
  const clips = new Map([['stand', 1], ['run', 2]]);
  assert.equal(resolveClipName(clips, 'run', 'stand'), 'run');
  assert.equal(resolveClipName(clips, 'C003_Flying', 'stand'), 'stand');
  assert.equal(resolveClipName(clips, '', 'stand'), 'stand');
  assert.equal(resolveClipName(clips, 'nope', 'missing'), 'stand');
  assert.equal(resolveClipName(new Map(), 'run', 'stand'), '');
  assert.equal(resolveClipName(new Set(['a']), 'x', 'y'), 'a');
});

test('one-shot actions are recognised by name, loops are not', () => {
  for (const name of ['C003_Punch_01', 'C003_N_Attack_01', 'C003_Land', 'C003_Flying_Intro', 'C003_LeapAttack', 'punch', 'jumpUp', 'jumpDown']) assert.equal(clipPlaysOnce(name), true, name);
  for (const name of ['C003_Idle_01', 'C003_Run_01', 'C003_Flying', 'run', 'stand', 'walk', '']) assert.equal(clipPlaysOnce(name), false, name);
});

test('every character declares the model height and yaw the remote copy needs', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.model.height > 1 && c.model.height < 3, c.id);
    assert.equal(typeof c.model.yaw, 'number');
  }
  assert.equal(getCharacter('superman').model.yaw, -Math.PI / 2);   // MultiVersus rig faces +X
  assert.equal(getCharacter('flash').model.yaw, 0);                  // Mixamo rigs face +Z
});

test('the remote model is measured only after its matrices are up to date (a stale clone measured ~3 mm and was scaled 700x)', () => {
  const src = fs.readFileSync(new URL('../game/net/remote-hero.js', import.meta.url), 'utf8');
  const clone = src.indexOf('cloneSkeleton(gltf.scene)');
  const update = src.indexOf('root.updateMatrixWorld(true)');
  const measure = src.indexOf('new THREE.Box3().setFromObject(root)');
  assert.ok(clone > 0 && update > clone, 'updateMatrixWorld comes after the clone');
  assert.ok(measure > update, 'and before the bounding box is measured');
});
