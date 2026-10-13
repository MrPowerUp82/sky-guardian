import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// main.js is a browser module with no test harness, so the wiring is pinned with
// contract tests (same approach as the other integration tests in this repo) and
// exercised for real by the two-tab checklist in the plan.
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const fn = name => main.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}`))?.[0] || '';

test('the boss chooses among every living player, and swings hit every player in range', () => {
  assert.match(main, /let netSession = null;/);
  const targets = fn('bossTargets');
  assert.match(targets, /netSession\?\.isHost/);
  assert.match(targets, /remoteLatest\(\)/);
  assert.match(targets, /!playerDead/);
  const update = fn('updateEnemy');
  assert.match(update, /chooseTarget\(bossTargets\(\), enemyRoot\.position\)/);
  assert.doesNotMatch(update, /hero\.position\.clone\(\)\.sub\(enemyRoot\.position\)/);
  assert.match(fn('triggerEnemyAttackImpact'), /attackHits\(bossTargets\(\)/);
  assert.match(fn('triggerEnemyAttackImpact'), /applyBossHit\(/);
  assert.match(fn('dispatchEnemyEvent'), /for \(const target of bossTargets\(\)\)/);
  assert.match(fn('beginEnemyAttack'), /!bossTargets\(\)\.length/);
  assert.match(fn('applyBossHit'), /netSession\?\.sendHit\(victim\.id/);
  assert.match(fn('applyBossHit'), /damagePlayer\(amount, dir\)/);
});

test('guests never run the boss AI: their hits become requests, the host applies them', () => {
  assert.match(fn('damageEnemy'), /^function damageEnemy\([^)]*\) \{\s*if \(netSession\?\.isGuest\) return guestDamageEnemy\(/);
  assert.match(fn('damageEnemyHeat'), /netSession\?\.isGuest/);
  assert.match(fn('guestDamageEnemy'), /netSession\?\.sendDamage\(/);
  assert.match(fn('applyRemoteDamage'), /damageEnemyHeat\(amount\)/);
  assert.match(fn('applyRemoteDamage'), /damageEnemy\(amount, new THREE\.Vector3\(src\[0\], src\[1\], src\[2\]\), kb,/);
  assert.match(fn('bossStateForNet'), /enemyActionToken/);
  assert.match(fn('applyBossMirror'), /enemyStats = enemyLevelStats\(b\.lvl\)/);
});

test('boss health scales with the number of players (host only)', () => {
  assert.match(fn('applyEnemyLevel'), /scaledBossHealth\(enemyStats\.maxHealth, netSession\?\.isHost \? netSession\?\.playerCount : 1\)/);
  assert.match(fn('rescaleBossForPlayers'), /scaledBossHealth\(/);
});

test('solo safety: before the online section, netSession is only ever touched with ?.', () => {
  const marker = main.indexOf('V21 ONLINE CO-OP — session lifecycle');
  const solo = marker > 0 ? main.slice(0, marker) : main;
  assert.doesNotMatch(solo, /\bnetSession\.[a-zA-Z]/);
});
