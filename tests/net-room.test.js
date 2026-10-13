import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomError } from '../game/net/room.js';
import { MemoryNetwork } from '../game/net/transport.js';
import { encode, decode, NET_TUNING, PROTOCOL_VERSION, NET_BUILD } from '../game/net/protocol.js';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
const clock = () => { const c = { t: 0, now: () => c.t }; return c; };
const who = (name, char = 'superman', skin = 'classic') => ({ name, char, skin });
const POSE = { t: 'pose', id: 'p9', char: 'flash', skin: 'classic', p: [1, 2, 3], q: [0, 0, 0, 1], clip: 'run', hp: 100, dead: false };

async function lobby(guests = 1) {
  const net = new MemoryNetwork();
  const host = await Room.host({ network: net, player: who('Host'), rand: () => .3 });
  const rooms = [];
  for (let i = 0; i < guests; i++) rooms.push(await Room.join({ network: net, code: host.code, player: who(`G${i + 1}`, 'flash') }));
  await flush();
  return { net, host, guests: rooms };
}

test('host creates a 4-letter room; a guest joins and both see the same players and seed', async () => {
  const { host, guests: [guest] } = await lobby();
  assert.equal(host.code.length, 4);
  assert.equal(host.selfId, 'p0');
  assert.equal(guest.selfId, 'p1');
  assert.equal(guest.seed, host.seed);
  assert.deepEqual(host.playerList.map(p => p.name), ['Host', 'G1']);
  assert.deepEqual(guest.playerList.map(p => p.name), ['Host', 'G1']);
});

test('existing guests hear about later joiners and leavers', async () => {
  const { net, host, guests: [g1] } = await lobby();
  const seen = [];
  g1.on('players', list => seen.push(list.map(p => p.name).join(',')));
  const g2 = await Room.join({ network: net, code: host.code, player: who('G2') });
  await flush();
  assert.equal(seen.at(-1), 'Host,G1,G2');
  g2.close();
  await flush();
  assert.equal(seen.at(-1), 'Host,G1');
  assert.equal(host.players.size, 2);
});

test('the fifth player is refused with "full"', async () => {
  const { net, host } = await lobby(3);                        // host + 3 = 4
  assert.equal(host.players.size, NET_TUNING.maxPlayers);
  await assert.rejects(Room.join({ network: net, code: host.code, player: who('Late') }), e => e instanceof RoomError && e.code === 'full');
  assert.equal(host.players.size, 4);
});

test('a guest on another protocol version is refused with "version"', async () => {
  const { net, host } = await lobby(0);
  const conn = await net.join(host.code);
  const replies = [];
  conn.onMessage(t => replies.push(decode(t)));
  conn.send(encode({ t: 'hello', proto: PROTOCOL_VERSION + 1, build: 'old', ...who('Old') }));
  await flush();
  assert.deepEqual(replies.map(m => m.t === 'reject' && m.reason), ['version']);
  assert.equal(host.players.size, 1);
});

test('unknown room and silent host fail with clear codes', async () => {
  const net = new MemoryNetwork();
  await assert.rejects(Room.join({ network: net, code: 'ZZZZ', player: who('X') }), e => e.code === 'not-found');
  const raw = await net.host('ABCD');
  raw.onConnection(() => {});                                  // accepts, never answers
  await assert.rejects(Room.join({ network: net, code: 'ABCD', player: who('X'), joinTimeoutMs: 20 }), e => e.code === 'timeout');
});

test('poses are relayed to the other guests with the id forced by the host', async () => {
  const { host, guests: [g1, g2] } = await lobby(2);
  const atHost = [], atG2 = [];
  host.on('message', (m, from) => atHost.push([m.t, m.id, from]));
  g2.on('message', (m, from) => atG2.push([m.t, m.id, from]));
  g1.send({ ...POSE, id: 'p3' });                              // tries to spoof another id
  await flush();
  assert.deepEqual(atHost, [['pose', 'p1', 'p1']]);
  assert.deepEqual(atG2, [['pose', 'p1', 'p1']]);
  host.send({ ...POSE, id: 'p0' });
  await flush();
  assert.equal(atG2.at(-1)[1], 'p0');
});

test('guests cannot send host-only message types', async () => {
  const { host, guests: [g1] } = await lobby();
  const atHost = [];
  host.on('message', m => atHost.push(m.t));
  g1.send({ t: 'reset' });
  g1.send({ t: 'hit', amount: 5, dir: [0, 0, 1] });
  g1.send({ t: 'dmg', amount: 5, label: '', kb: 0, src: [0, 0, 0] });
  await flush();
  assert.deepEqual(atHost, ['dmg']);
});

test('sendTo reaches only the target guest', async () => {
  const { host, guests: [g1, g2] } = await lobby(2);
  const got = { g1: [], g2: [] };
  g1.on('message', m => got.g1.push(m.t));
  g2.on('message', m => got.g2.push(m.t));
  host.sendTo('p2', { t: 'hit', amount: 10, dir: [0, 0, 1] });
  await flush();
  assert.deepEqual(got, { g1: [], g2: ['hit'] });
});

test('silence past the timeout drops a guest (host side) and the host (guest side), counted tick by tick', async () => {
  const c = clock();
  const net = new MemoryNetwork();
  const host = await Room.host({ network: net, player: who('Host'), now: c.now, rand: () => .1 });
  const g1 = await Room.join({ network: net, code: host.code, player: who('G1'), now: c.now });
  await flush();
  const left = [];
  host.on('left', (id, why) => left.push([id, why]));
  const closed = [];
  g1.on('closed', why => closed.push(why));
  for (let i = 0; i <= NET_TUNING.timeoutMs / 1000; i++) { c.t += 1000; host.tick(c.t); g1.tick(c.t); }   // the whole timeout in quiet seconds
  await flush();
  assert.deepEqual(left, [['p1', 'timeout']]);
  assert.equal(host.players.size, 1);
  assert.deepEqual(closed, ['timeout']);
  assert.equal(g1.closed, true);
});

test('pings keep a quiet but healthy connection alive', async () => {
  const c = clock();
  const net = new MemoryNetwork();
  const host = await Room.host({ network: net, player: who('Host'), now: c.now, rand: () => .1 });
  const g1 = await Room.join({ network: net, code: host.code, player: who('G1'), now: c.now });
  for (let i = 0; i < 12; i++) { c.t += 1000; host.tick(c.t); g1.tick(c.t); await flush(); }
  assert.equal(host.players.size, 2);
  assert.equal(g1.closed, false);
});

test('host closing ends the room for every guest', async () => {
  const { host, guests: [g1, g2] } = await lobby(2);
  const reasons = [];
  g1.on('closed', r => reasons.push(r)); g2.on('closed', r => reasons.push(r));
  host.close();
  await flush();
  assert.deepEqual(reasons, ['host-left', 'host-left']);
  assert.equal(g1.closed && g2.closed && host.closed, true);
});

test('a guest flooding the host is throttled to the per-second budget, and the budget refills', async () => {
  const c = clock();
  const net = new MemoryNetwork();
  const host = await Room.host({ network: net, player: who('Host'), now: c.now, rand: () => .1 });
  const g1 = await Room.join({ network: net, code: host.code, player: who('G1'), now: c.now });
  await flush();
  let got = 0;
  host.on('message', () => got++);
  for (let i = 0; i < 400; i++) g1.send({ t: 'dmg', amount: 1, label: '', kb: 0, src: [0, 0, 0] });
  await flush();
  assert.equal(got, NET_TUNING.maxMessagesPerSecond);
  c.t += 1000;
  for (let i = 0; i < 5; i++) g1.send({ t: 'dmg', amount: 1, label: '', kb: 0, src: [0, 0, 0] });
  await flush();
  assert.equal(got, NET_TUNING.maxMessagesPerSecond + 5);
});

test('a refusal leaves the connection open long enough for the reject to arrive', async () => {
  const net = new MemoryNetwork();
  const tuning = { ...NET_TUNING, closeGraceMs: 200, maxPlayers: 1 };
  const host = await Room.host({ network: net, player: who('Host'), rand: () => .3, tuning });
  const raw = await net.join(host.code);
  const replies = [];
  let rawClosed = false;
  raw.onMessage(t => replies.push(decode(t).reason));
  raw.onClose(() => { rawClosed = true; });
  raw.send(encode({ t: 'hello', proto: PROTOCOL_VERSION, build: NET_BUILD, ...who('Late') }));
  await flush();
  assert.deepEqual(replies, ['full']);
  assert.equal(rawClosed, false, 'still open right after the reject was sent');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(rawClosed, true);
});

test('a host shutdown leaves the connections open long enough for the leave message to arrive', async () => {
  const net = new MemoryNetwork();
  const tuning = { ...NET_TUNING, closeGraceMs: 200 };
  const host = await Room.host({ network: net, player: who('Host'), rand: () => .3, tuning });
  const raw = await net.join(host.code);
  const got = [];
  let rawClosed = false;
  raw.onMessage(t => got.push(decode(t).t));
  raw.onClose(() => { rawClosed = true; });
  raw.send(encode({ t: 'hello', proto: PROTOCOL_VERSION, build: NET_BUILD, ...who('G1') }));
  await flush();
  assert.ok(got.includes('welcome'));
  host.close();
  await flush();
  assert.ok(got.includes('leave'), 'the leave message was delivered');
  assert.equal(rawClosed, false, 'still open right after the leave message was sent');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(rawClosed, true);
});

test('a dropped connection closes the guest with "lost"', async () => {
  const { host, guests: [g1] } = await lobby();
  const reasons = [];
  g1.on('closed', r => reasons.push(r));
  host.peers.get('p1').conn.close();
  await flush();
  assert.deepEqual(reasons, ['lost']);
});

test('a long local freeze (model loading, GC) is not mistaken for the other side going silent', async () => {
  const c = clock();
  const net = new MemoryNetwork();
  const host = await Room.host({ network: net, player: who('Host'), now: c.now, rand: () => .1 });
  const g1 = await Room.join({ network: net, code: host.code, player: who('G1'), now: c.now });
  await flush();
  const closed = [];
  g1.on('closed', why => closed.push(why));
  c.t += 30_000;                      // the whole page was frozen for 30 s
  host.tick(c.t);
  g1.tick(c.t);
  await flush();
  assert.equal(host.players.size, 2, 'the host did not drop the guest');
  assert.deepEqual(closed, [], 'the guest did not give up on the host');
  assert.equal(g1.closed, false);
  // ...and real silence is still caught.
  for (let i = 0; i <= NET_TUNING.timeoutMs / 1000; i++) { c.t += 1000; host.tick(c.t); g1.tick(c.t); }
  await flush();
  assert.equal(host.players.size, 1);
  assert.deepEqual(closed, ['timeout']);
});
