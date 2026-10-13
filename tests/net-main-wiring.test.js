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

import { encode, decode, NET_TUNING } from '../game/net/protocol.js';

test('events: the host announces spawns and ships fire positions with the impact command', () => {
  assert.match(main, /meteor: \(\.\.\.args\) => announceSpawn\(createMeteorEvent\(\.\.\.args\)\)/);
  assert.match(main, /buildingFire: \(\.\.\.args\) => announceSpawn\(createBuildingFireEvent\(\.\.\.args\)\)/);
  assert.match(fn('handleEventCommand'), /function handleEventCommand\(command, \{ mirrored = false \} = \{\}\)/);
  assert.match(fn('handleEventCommand'), /mirrored \? \(command\.descriptors \|\| \[\]\) : buildMeteorImpactFireDescriptors/);
  assert.match(fn('handleEventCommand'), /command\.descriptors = descriptors/);
  assert.match(fn('emitEventCommand'), /if \(netSession\?\.isGuest\) return;/);
  assert.match(fn('emitEventCommand'), /broadcastEvent\('command', command\)/);
  assert.match(fn('updateDynamicEvents'), /emitEventCommand\(command\)/);
  assert.doesNotMatch(fn('updateDynamicEvents'), /handleEventCommand\(command\)/);
  assert.match(fn('tryInterceptActiveMeteor'), /emitEventCommand\(\{ \.\.\.command, method \}\)/);
  assert.match(fn('tryInterceptActiveMeteor'), /netSession\?\.isGuest[\s\S]*sendIntercept\(/);
});

test('events: a guest rebuilds meteors and building fires from the host descriptors', () => {
  const adopt = fn('adoptWorldEvent');
  for (const kind of ['command', 'fires', 'spawn-meteor', 'spawn-fire']) assert.match(adopt, new RegExp(`'${kind}'`));
  assert.match(adopt, /dynamicEventSystem\.adopt\(event\)/);
  assert.match(adopt, /handleEventCommand\(data, \{ mirrored: true \}\)/);
});

test('fire: cooling is applied locally and forwarded; the host applies requests without occlusion', () => {
  assert.match(fn('coolFireCone'), /fireSystem\.applyCoolingCone\(args\)/);
  assert.match(fn('coolFireCone'), /netSession\?\.sendCool\(/);
  assert.match(fn('coolFireSphere'), /fireSystem\.applyCoolingSphere\(args\)/);
  assert.match(main, /const affected = coolFireCone\(\{/);
  assert.match(main, /coolCone: \(origin, dir, range, halfAngle, dt, rate\) => coolFireCone\(/);
  assert.match(main, /coolRadius: \(point, radius, dt, rate\) => coolFireSphere\(/);
  assert.match(fn('applyCoolRequest'), /applyCoolingCone|applyCoolingSphere/);
});

test('the host keeps the world ticking for everyone while it is busy; solo keeps its old pauses', () => {
  const update = fn('updateDynamicEvents');
  assert.match(update, /const controlLocked = netSession \? \(!heroReady \|\| helpVisible\)/);
  assert.match(update, /playerDead \|\| actionLocked \|\| flightMachine\.busy \|\| leapAttack\.active \|\| helpVisible/);
});

test('the protocol can carry the largest event payloads within the message limit', () => {
  const spot = i => ({ id: `meteor-12:impact-fire:${i}`, eventId: 'meteor-12', source: 'meteor-impact', position: { x: -123.456789, y: 0.08, z: 210.123456 }, normal: { x: 0, y: 1, z: 0 }, radius: 2.35, intensity: 1 });
  const six = Array.from({ length: 6 }, (_, i) => spot(i + 1));
  const impact = { t: 'event', kind: 'command', data: { type: 'meteor-impact', eventId: 'meteor-12', point: { x: -123.4, y: 0.08, z: 210.1 }, requestedFireCount: 6, descriptors: six } };
  assert.ok(encode(impact).length < NET_TUNING.maxMessageChars);
  assert.deepEqual(decode(encode(impact)).data.descriptors.length, 6);
  const fires = { t: 'event', kind: 'fires', data: { descriptors: six.slice(0, 4).map(s => ({ ...s, buildingId: 'b-123' })) } };
  assert.ok(decode(encode(fires)));
  const meteorSpawn = { t: 'event', kind: 'spawn-meteor', data: { id: 'meteor-12', impactPoint: { x: 1, y: 2, z: 3 }, startPosition: { x: 1, y: 360, z: 3 }, warningSeconds: 1.5, fallSeconds: 12, fireCount: 6, state: 'falling', warningElapsed: 1.5, fallElapsed: 3.25, fireIds: [] } };
  assert.ok(decode(encode(meteorSpawn)));
});

const section = main.slice(main.indexOf('V21 ONLINE CO-OP — session lifecycle'));

test('online: the session section creates rooms, wires every NetSession callback and ends cleanly', () => {
  assert.ok(main.includes('V21 ONLINE CO-OP — session lifecycle'));
  assert.match(main, /import \{ Room \} from '\.\/game\/net\/room\.js';/);
  assert.match(main, /import \{ createPeerNetwork \} from '\.\/game\/net\/transport\.js';/);
  const game = fn('createNetGame');
  for (const key of ['getLocalPose', 'getBossState', 'getFireSnapshot', 'applyRemoteDamage', 'applyCool', 'applyIntercept',
    'applyBossState', 'applyFireSnapshot', 'handleWorldEvent', 'applyHit', 'resetMission', 'onPlayers', 'onPlayerJoined', 'onClosed']) {
    assert.match(game, new RegExp(`\\b${key}\\b`), key);
  }
  assert.match(game, /resetMission: \(\) => resetGame\(\{ fromNet: true \}\)/);
  assert.match(fn('beginOnlineSession'), /dynamicEventSystem\.setMirror\(netSession\.isGuest\)/);
  assert.match(fn('endOnlineSession'), /dynamicEventSystem\.setMirror\(false\)/);
  assert.match(fn('endOnlineSession'), /remoteHeroes\.clear\(\)/);
  assert.match(fn('startOnline'), /describeNetError\(err\?\.code\)/);
  assert.match(fn('sendWorldBootstrap'), /sendEventTo\(id, 'fires'/);
  assert.match(fn('netLocalPose'), /clampWorld/);
});

test('online: the frame loop keeps the net alive while paused and never runs the boss AI on guests', () => {
  const animate = fn('animate');
  assert.match(animate, /if \(paused\) \{\s*if \(netSession\) netTick\(\);/);
  assert.match(animate, /if \(netSession\?\.isGuest\) \{ \/\* mirrored in netTick \*\/ \} else updateEnemy\(/);
  assert.match(animate, /netTick\(\)/);
  assert.match(fn('netTick'), /updateBossMirror\(dt\)/);
  assert.match(fn('buildMapState'), /peers: remoteHeroes\.positions\(\)/);
});

test('online: dying only respawns you; only the host restarts the whole mission', () => {
  const reset = fn('resetGame');
  assert.match(reset, /function resetGame\(\{ scope = 'all', fromNet = false \} = \{\}\)/);
  assert.match(reset, /if \(netSession\?\.isGuest && !fromNet\) scope = 'player';/);
  assert.match(reset, /if \(all && netSession\?\.isHost && !fromNet\) netSession\?\.broadcastReset\(\);/);
  assert.match(fn('damagePlayer'), /everyoneDown/);
  assert.match(fn('damagePlayer'), /resetGame\(netSession && !everyoneDown \? \{ scope: 'player' \} : \{\}\)/);
  assert.match(fn('selectCharacter'), /resetGame\(netSession \? \{ scope: 'player' \} : \{\}\)/);
});

test('solo safety: before the online section netSession is only used with ?., and leaving restores solo', () => {
  const solo = main.slice(0, main.indexOf('V21 ONLINE CO-OP — session lifecycle'));
  assert.doesNotMatch(solo, /\bnetSession\.[a-zA-Z]/);
  assert.match(fn('endOnlineSession'), /netSession = null/);
  assert.match(main, /addEventListener\('pagehide', \(\) => netSession\?\.leave\(\)\)/);
});

// --- fix pass after the whole-branch review -------------------------------------------
test('review fix: the host settles residual fire before every snapshot', () => {
  assert.match(fn('createNetGame'), /getFireSnapshot: \(\) => \{ fireSystem\.settle\(\); return fireSystem\.getSnapshot\(\); \}/);
});

test('review fix: guest hits do not trigger hitstop, shake or banners on the host, and do not share one invulnerability window', () => {
  assert.match(fn('applyRemoteDamage'), /\{ remote: true \}/);
  const damage = fn('damageEnemy');
  assert.match(damage, /enemyHitInvuln > 0 && !opts\.remote/);
  assert.match(damage, /if \(!opts\.remote\) enemyHitInvuln = \.10;/);
  assert.match(damage, /if \(!opts\.remote\) requestHitStop\(/);
  assert.match(damage, /if \(!opts\.remote\) cameraShake = /);
  assert.match(damage, /label && !enragedNow && !opts\.remote/);
});

test('review fix: a player in space or re-entry is absent from the city for everyone else', () => {
  assert.match(fn('netLocalPose'), /dead: playerDead \|\| spaceState\.active \|\| reentryState\.active/);
  assert.match(fn('bossTargets'), /!spaceState\.active && !reentryState\.active/);
  // Jason and the events keep running for the guests while the host is up there.
  const update = fn('updateEnemy');
  assert.match(update, /if \(!netSession\?\.isHost\) return;/);
  assert.match(fn('updateDynamicEvents'), /\['space', !netSession && spaceState\.active\]/);
  assert.match(fn('updateDynamicEvents'), /\['reentry', !netSession && reentryState\.active\]/);
  assert.match(fn('updateBossMirror'), /spaceState\.active \|\| reentryState\.active/);
  assert.match(fn('netTick'), /remoteHeroes\.setHidden\(/);
});

test('review fix: meteors on a guest are re-synced from the host world snapshot', () => {
  assert.match(fn('createNetGame'), /getMeteorSnapshot: \(\) => dynamicEventSystem\.getMeteorSnapshot\(\)/);
  assert.match(fn('createNetGame'), /applyMeteorSync: list => dynamicEventSystem\.syncMeteors\(list\)/);
});

test('review fix: a hidden tab keeps the room alive with a timer', () => {
  assert.match(fn('beginOnlineSession'), /netKeepAlive = setInterval\(/);
  assert.match(fn('beginOnlineSession'), /document\.hidden/);
  assert.match(fn('endOnlineSession'), /clearInterval\(netKeepAlive\)/);
});
