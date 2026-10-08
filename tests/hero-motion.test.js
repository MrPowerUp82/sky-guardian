import test from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeVerticalTracks, STAND_PELVIS_Y } from '../hero-motion.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !== ${b}`);

test('neutralizeVerticalTracks fixa Y da pelvis em STAND_PELVIS_Y', () => {
  const tracks = [{ name: 'fml_un_C_pelvis_att.position', values: new Float32Array([0, -0.234, 0.1, 0.2, 2.031, 0.3]) }];
  const [out] = neutralizeVerticalTracks(tracks);
  close(STAND_PELVIS_Y, 1.994);
  [0, STAND_PELVIS_Y, 0.1, 0.2, STAND_PELVIS_Y, 0.3].forEach((v, i) => close(out.values[i], v));
});

test('neutralizeVerticalTracks não altera outras tracks', () => {
  const root = { name: 'Root.position', values: new Float32Array([1, 2, 3]) };
  const quat = { name: 'fml_un_C_pelvis_att.quaternion', values: new Float32Array([0, 0, 0, 1]) };
  const [r, q] = neutralizeVerticalTracks([root, quat]);
  assert.deepEqual([...r.values], [1, 2, 3]);
  assert.deepEqual([...q.values], [0, 0, 0, 1]);
});

test('neutralizeVerticalTracks não muta a entrada', () => {
  const values = new Float32Array([0, -0.234, 0.1]);
  neutralizeVerticalTracks([{ name: 'fml_un_C_pelvis_att.position', values }]);
  close(values[1], -0.234);
});

test('neutralizeVerticalTracks aceita constantY customizado', () => {
  const [out] = neutralizeVerticalTracks([{ name: 'fml_un_C_pelvis_att.position', values: new Float32Array([0, 5, 0]) }], 1.5);
  close(out.values[1], 1.5);
});

import { remapVerticalTracks, heroClipVerticalMode } from '../hero-motion.js';

const pelvis = values => ({ name: 'fml_un_C_pelvis_att.position', values: new Float32Array(values) });

test('clips de solo mantêm a altura autoral da pélvis no chão e são achatados no ar', () => {
  assert.equal(heroClipVerticalMode('C003_Punch_01', 'ground'), 'authored');
  assert.equal(heroClipVerticalMode('C003_Punch_01', 'air'), 'neutral');
  assert.equal(heroClipVerticalMode('C003_Flying', 'ground'), 'neutral');
  const track = pelvis([0, 1.18, 0]);
  assert.equal(remapVerticalTracks([track], 'authored')[0], track);
});

test('modo híbrido só fixa as chaves na referência aérea (C003_Land)', () => {
  assert.equal(heroClipVerticalMode('C003_Land', 'ground'), 'hybrid');
  const [out] = remapVerticalTracks([pelvis([0, -0.23, 0, 0, 1.18, 0, 0, 1.99, 0])], 'hybrid');
  close(out.values[1], STAND_PELVIS_Y);
  close(out.values[4], 1.18);
  close(out.values[7], 1.99);
});

test('modo centralizado preserva o balanço do hover em torno da altura em pé', () => {
  const [out] = remapVerticalTracks([pelvis([0, 2.37, 0, 0, 2.49, 0])], 'centered');
  close((out.values[1] + out.values[4]) / 2, STAND_PELVIS_Y);
  close(out.values[4] - out.values[1], 0.12);
});
