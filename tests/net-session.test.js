import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../game/net/room.js';
import { NetSession } from '../game/net/net-session.js';
import { MemoryNetwork } from '../game/net/transport.js';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
const clock = () => { const c = { t: 1000, now: () => c.t }; return c; };
const who = (name, char = 'superman') => ({ name, char, skin: 'classic' });
const BOSS = { p: [5, 0, 6], y: 1, clip: 'Jason_Walk', rate: 1, tok: 1, hp: 100, max: 180, rage: false, lvl: 1, alive: true, lock: false };

function fakeGame(name) {
  const calls = [];
  const rec = key => (...args) => { calls.push([key, ...args]); };
  return {
    name, calls,
    pose: { char: 'superman', skin: 'classic', p: [0, 0, 0], q: [0, 0, 0, 1], clip: 'C003_Idle_01', hp: 100, dead: false },
    getLocalPose() { return this.pose; },
    getBossState: () => BOSS,
    getFireSnapshot: () => [['f1', .5]],
    getMeteorSnapshot: () => [{ id: 'meteor-1', st: 'falling', w: 1.5, f: 3 }],
    applyMeteorSync: rec('meteors'),
    applyRemoteDamage: rec('damage'), applyCool: rec('cool'), applyIntercept: rec('intercept'),
    applyBossState: rec('boss'), applyFireSnapshot: rec('fires'), handleWorldEvent: rec('event'),
    applyHit: rec('hit'), resetMission: rec('reset'),
    onPlayers: rec('players'), onPlayerJoined: rec('joined'), onClosed: rec('closed')
  };
}

async function pair() {
  const c = clock();
  const net = new MemoryNetwork();
  const hostRoom = await Room.host({ network: net, player: who('Host'), now: c.now, rand: () => .2 });
  const hostGame = fakeGame('host'), guestGame = fakeGame('guest');
  const host = new NetSession({ room: hostRoom, game: hostGame, now: c.now });
  const guestRoom = await Room.join({ network: net, code: hostRoom.code, player: who('Guest', 'flash'), now: c.now });
  const guest = new NetSession({ room: guestRoom, game: guestGame, now: c.now });
  await flush();
  return { c, host, guest, hostGame, guestGame };
}
const names = game => game.calls.map(c => c[0]);
const step = async (c, ms, ...sessions) => { c.t += ms; for (const s of sessions) s.update(c.t); await flush(); };

test('the host game is told when a newcomer joins (to send them the current world)', async () => {
  const { hostGame } = await pair();
  assert.deepEqual(hostGame.calls.filter(c => c[0] === 'joined').map(c => c[1]), ['p1']);
});

test('the host sends world state to guests at ~10 Hz, never the other way round', async () => {
  const { c, host, guest, guestGame, hostGame } = await pair();
  await step(c, 100, host, guest);
  assert.deepEqual(guestGame.calls.filter(x => x[0] === 'boss').map(x => x[1].hp), [100]);
  assert.deepEqual(guestGame.calls.find(x => x[0] === 'fires')[1], [['f1', .5]]);
  assert.equal(names(hostGame).includes('boss'), false);
  const before = guestGame.calls.length;
  await step(c, 10, host, guest);                                     // too soon for another world tick
  assert.equal(guestGame.calls.length, before);
});

test('poses flow both ways and show up in remotes() after the interpolation delay', async () => {
  const { c, host, guest, hostGame, guestGame } = await pair();
  hostGame.pose = { ...hostGame.pose, p: [10, 0, 0], clip: 'C003_Flying' };
  guestGame.pose = { ...guestGame.pose, char: 'flash', p: [0, 0, 20], clip: 'run' };
  for (let i = 0; i < 4; i++) await step(c, 70, host, guest);
  const seenByHost = host.remotes(c.t);
  assert.equal(seenByHost.length, 1);
  assert.equal(seenByHost[0].id, 'p1');
  assert.equal(seenByHost[0].name, 'Guest');
  assert.equal(seenByHost[0].char, 'flash');
  assert.equal(seenByHost[0].clip, 'run');
  assert.ok(Math.abs(seenByHost[0].pose.z - 20) < 1e-6);
  const seenByGuest = guest.remotes(c.t);
  assert.equal(seenByGuest[0].id, 'p0');
  assert.equal(seenByGuest[0].clip, 'C003_Flying');
  assert.deepEqual(host.remoteLatest().map(r => r.id), ['p1']);
});

test('guest requests reach the host game: damage, cooling (throttled and merged), intercept', async () => {
  const { c, host, guest, hostGame } = await pair();
  guest.sendDamage({ amount: 22, label: 'SOCO', kb: 1.25, src: [1, 2, 3] });
  guest.sendIntercept({ method: 'superPunch', origin: [0, 1, 0], radius: 2, speed: 0 });
  guest.sendCool({ shape: 'cone', origin: [0, 1, 0], dir: [0, 0, 1], range: 24, half: 22, dt: .05, rate: .42, radius: 0 });
  guest.sendCool({ shape: 'cone', origin: [0, 1, 1], dir: [0, 0, 1], range: 24, half: 22, dt: .05, rate: .42, radius: 0 });
  await step(c, 120, host, guest);
  const dmg = hostGame.calls.find(x => x[0] === 'damage')[1];
  assert.equal(dmg.amount, 22); assert.equal(dmg.from, 'p1');
  assert.ok(names(hostGame).includes('intercept'));
  const cools = hostGame.calls.filter(x => x[0] === 'cool');
  assert.equal(cools.length, 1);
  assert.ok(Math.abs(cools[0][1].dt - .1) < 1e-9, 'two 50 ms bursts merged into one 100 ms request');
  const sent = hostGame.calls.length;
  host.sendDamage({ amount: 1, src: [0, 0, 0] });                      // the host never sends damage requests
  await step(c, 5, host, guest);
  assert.equal(hostGame.calls.length, sent);
});

test('host messages reach the guest game: hit, event, reset', async () => {
  const { c, host, guest, guestGame } = await pair();
  host.sendHit('p1', 14, [0, 0, 1]);
  host.broadcastEvent('spawn-meteor', { id: 'meteor-1', fireCount: 3 });
  host.broadcastReset();
  await step(c, 5, guest);
  assert.deepEqual(guestGame.calls.filter(x => ['hit', 'event', 'reset'].includes(x[0])).map(x => x[0]), ['hit', 'event', 'reset']);
  assert.equal(guestGame.calls.find(x => x[0] === 'hit')[1].amount, 14);
  assert.deepEqual(guestGame.calls.find(x => x[0] === 'event').slice(1), ['spawn-meteor', { id: 'meteor-1', fireCount: 3 }]);
});

test('guests cannot reset the mission', async () => {
  const { c, host, guest, hostGame, guestGame } = await pair();
  guest.room.send({ t: 'reset' });
  await step(c, 5, host, guest);
  assert.equal(names(hostGame).includes('reset'), false);
  assert.equal(names(guestGame).includes('reset'), false);
});

test('a leaver disappears from remotes and the host game is told', async () => {
  const { c, host, guest, hostGame } = await pair();
  for (let i = 0; i < 3; i++) await step(c, 70, host, guest);
  assert.equal(host.remotes(c.t).length, 1);
  guest.leave();
  await flush();
  assert.equal(host.remotes(c.t).length, 0);
  assert.deepEqual(host.remoteLatest(), []);
  assert.ok(hostGame.calls.some(x => x[0] === 'players' && x[1].length === 1));
});

test('when the host leaves the guest session goes inactive and reports why', async () => {
  const { host, guest, guestGame } = await pair();
  host.leave();
  await flush();
  assert.equal(guest.active, false);
  assert.equal(guest.closeReason, 'host-left');
  assert.deepEqual(guestGame.calls.find(x => x[0] === 'closed').slice(1), ['host-left']);
  guest.update(5e6);                                                    // must not throw once closed
});

test('cooling of a different shape does not discard the request that was waiting', async () => {
  const { c, host, guest, hostGame } = await pair();
  guest.sendCool({ shape: 'cone', origin: [0, 1, 0], dir: [0, 0, 1], range: 24, half: 22, dt: .05, rate: .42, radius: 0 });
  guest.sendCool({ shape: 'sphere', origin: [0, 1, 0], dir: [0, 0, 1], range: 0, half: 0, dt: .05, rate: .42, radius: 10 });
  await step(c, 120, host, guest);
  assert.deepEqual(hostGame.calls.filter(x => x[0] === 'cool').map(x => x[1].shape).sort(), ['cone', 'sphere']);
});

test('the host sends the meteor clock with every world snapshot and the guest applies it', async () => {
  const { c, host, guest, guestGame } = await pair();
  await step(c, 100, host, guest);
  const sync = guestGame.calls.find(x => x[0] === 'meteors');
  assert.deepEqual(sync[1], [{ id: 'meteor-1', st: 'falling', w: 1.5, f: 3 }]);
});
