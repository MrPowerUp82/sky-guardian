import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTarget, attackHits, scaledBossHealth } from '../game/net/rules.js';

const T = (id, x, z, y = 0) => ({ id, x, y, z });

test('chooseTarget picks the nearest horizontally; none -> null', () => {
  assert.equal(chooseTarget([], { x: 0, z: 0 }), null);
  assert.equal(chooseTarget(null, { x: 0, z: 0 }), null);
  const targets = [T('local', 10, 0), T('p1', 3, 1), T('p2', -5, 0)];
  assert.equal(chooseTarget(targets, { x: 0, z: 0 }).id, 'p1');
});

test('chooseTarget ties keep the earlier target and ignores height', () => {
  const targets = [T('local', 5, 0, 50), T('p1', 0, 5, 0)];
  assert.equal(chooseTarget(targets, { x: 0, z: 0 }).id, 'local');
});

test('attackHits applies range, height and facing like the single-player rule', () => {
  const opts = { origin: { x: 0, y: 1, z: 1 }, dir: { x: 0, y: 0, z: 1 }, range: 3.45, baseY: 0 };
  const hits = attackHits([T('front', 0, 3), T('far', 0, 9), T('behind', 0, -1), T('high', 0, 3, 10)], opts);
  assert.deepEqual(hits.map(t => t.id), ['front']);
  assert.deepEqual(attackHits([], opts), []);
});

test('scaledBossHealth adds 50% per extra player', () => {
  assert.equal(scaledBossHealth(180, 1), 180);
  assert.equal(scaledBossHealth(180, 2), 270);
  assert.equal(scaledBossHealth(180, 4), 450);
  assert.equal(scaledBossHealth(180, 0), 180);
});
