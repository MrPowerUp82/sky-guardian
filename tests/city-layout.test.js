import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRoadCenters, classifyDistrict, lotFacingRotation, chunkKey, snapToStep, snapFocusToLightTexels
} from '../game/world/city-layout.js';

test('road centres are symmetric around the origin', () => {
  const roads = makeRoadCenters(15, 96);
  assert.equal(roads.length, 15);
  assert.equal(roads[0], -672);
  assert.equal(roads[14], 672);
  assert.equal(roads[7], 0);
  for (let i = 0; i < roads.length; i++) assert.equal(roads[i] + roads[roads.length - 1 - i], 0);
});

test('districts grow outward from the downtown core', () => {
  const half = 672;
  assert.equal(classifyDistrict(0, half), 'core');
  assert.equal(classifyDistrict(half * .4, half), 'mid');
  assert.equal(classifyDistrict(half * .7, half), 'residential');
  assert.equal(classifyDistrict(half * .95, half), 'suburb');
});

test('lots face the nearest street', () => {
  assert.equal(lotFacingRotation(0, 20), 0);
  assert.equal(lotFacingRotation(0, -20), Math.PI);
  assert.equal(lotFacingRotation(20, 4), Math.PI / 2);
  assert.equal(lotFacingRotation(-20, 4), -Math.PI / 2);
  assert.equal(lotFacingRotation(0, 0, 1.25), 1.25);
});

test('chunk keys group nearby positions and split distant ones', () => {
  assert.equal(chunkKey(10, 10, 160), chunkKey(150, 150, 160));
  assert.notEqual(chunkKey(10, 10, 160), chunkKey(170, 10, 160));
  assert.equal(chunkKey(-1, -1, 160), '-1,-1');
});

test('snapToStep rounds to the grid and ignores invalid steps', () => {
  assert.equal(snapToStep(7.4, 2), 8);
  assert.equal(snapToStep(7.4, 0), 7.4);
});

test('light texel snapping is idempotent and stays within half a texel', () => {
  const light = { x: -120, y: 210, z: 90 };
  const focus = { x: 13.37, y: 0, z: -48.9 };
  const snapped = snapFocusToLightTexels(focus, light, 0.5);
  const again = snapFocusToLightTexels(snapped, light, 0.5);
  assert.ok(Math.hypot(snapped.x - focus.x, snapped.y - focus.y, snapped.z - focus.z) <= 0.5 * Math.SQRT2);
  assert.ok(Math.abs(again.x - snapped.x) < 1e-9 && Math.abs(again.z - snapped.z) < 1e-9);
});
