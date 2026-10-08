import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const fn = name => main.match(new RegExp(String.raw`function\s+${name}\s*\([^)]*\)\s*\{[\s\S]*?\n\}`))?.[0] || '';

test('one-shots seguram o último quadro e nunca expõem a pose de bind', () => {
  const transition = fn('transitionTo');
  assert.match(transition, /clampWhenFinished\s*=\s*once/);
  assert.doesNotMatch(transition, /clampWhenFinished\s*=\s*false/);
  assert.match(transition, /crossfadeAction\(/);
  assert.doesNotMatch(fn('cancelCurrentOneShot'), /fadeOut/);
});

test('crossfade reinicia o mesmo clip por um clone alternado', () => {
  const crossfade = fn('crossfadeAction');
  assert.match(crossfade, /next === current/);
  assert.match(crossfade, /clip\.clone\(\)/);
  assert.match(crossfade, /setEffectiveWeight\(1\)/);
});

test('Jason não deixa golpes terminados com peso total', () => {
  const play = fn('enemyPlayOneShot');
  assert.doesNotMatch(play, /enemyCurrentAction\s*=\s*null/);
  assert.match(fn('enemyPlayClip'), /crossfadeAction\(/);
  assert.doesNotMatch(fn('interruptEnemy'), /fadeOut/);
});

test('regex de root motion do Jason remove de fato Root.position', () => {
  const source = fn('sanitizeEnemyClip').match(/!(\/\^Root.*?\/i)\.test/)?.[1];
  assert.ok(source, 'regex não encontrada');
  const regex = eval(source);
  assert.ok(regex.test('Root.position'));
  assert.ok(!regex.test('Root.quaternion'));
});

test('altura da pista vem do tile real e o pouso toca o chão no clip Land', () => {
  assert.match(main, /function\s+measureRoadProfile\s*\(/);
  assert.match(fn('getBaseSurfaceHeightAt'), /roadSurfaceAt\(/);
  assert.match(main, /LAND_CLIP_TOUCHDOWN/);
  assert.match(fn('heroFootLockWeight'), /takingOff/);
});
