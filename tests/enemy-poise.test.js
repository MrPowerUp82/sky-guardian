import test from 'node:test';
import assert from 'node:assert/strict';
import { EnemyPoise, enemyLevelStats } from '../game/combat/enemy-poise.js';

test('golpes leves só causam stagger quando o poise quebra', () => {
  const poise = new EnemyPoise({ max: 40 });
  assert.equal(poise.registerHit(22), 'absorbed');
  assert.equal(poise.registerHit(22), 'stagger');
  assert.equal(poise.value, 40, 'poise recarrega após o stagger');
});

test('golpe pesado causa stagger imediato', () => {
  const poise = new EnemyPoise();
  assert.equal(poise.registerHit(48, { heavy: true }), 'stagger');
});

test('imunidade após stagger impede stunlock, inclusive com golpes pesados', () => {
  const poise = new EnemyPoise({ staggerImmunity: 1.25 });
  assert.equal(poise.registerHit(48, { heavy: true }), 'stagger');
  poise.update(1.0);
  assert.equal(poise.registerHit(48, { heavy: true }), 'absorbed');
  poise.update(.3);
  assert.equal(poise.registerHit(48, { heavy: true }), 'stagger');
});

test('super armor absorve golpes leves durante o ataque do boss', () => {
  const poise = new EnemyPoise({ max: 10 });
  assert.equal(poise.registerHit(22, { armored: true }), 'absorbed');
  assert.equal(poise.registerHit(48, { armored: true, heavy: true }), 'stagger');
});

test('poise regenera depois de um tempo sem apanhar', () => {
  const poise = new EnemyPoise({ max: 40, regenDelay: 1, regenRate: 20 });
  poise.registerHit(30);
  poise.update(.5);
  assert.equal(poise.value, 10);
  poise.update(1);
  assert.ok(poise.value > 10 && poise.value <= 40);
  poise.update(10);
  assert.equal(poise.value, 40);
});

test('níveis do boss aumentam vida, dano e ritmo', () => {
  const one = enemyLevelStats(1);
  const three = enemyLevelStats(3);
  assert.deepEqual(one, { maxHealth: 180, damageScale: 1, speedScale: 1 });
  assert.ok(three.maxHealth > one.maxHealth);
  assert.ok(three.damageScale > one.damageScale);
  assert.ok(enemyLevelStats(50).speedScale <= 1.45);
});
