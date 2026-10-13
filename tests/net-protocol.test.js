import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION, NET_BUILD, NET_TUNING, ROOM_ALPHABET, makeRoomCode, normalizeRoomCode, peerIdForRoom, encode, decode
} from '../game/net/protocol.js';

const profile = { name: 'Ana', char: 'superman', skin: 'classic' };
const boss = { p: [1, 0, 2], y: 1.5, clip: 'Jason_Walk', rate: 1, tok: 3, hp: 120, max: 180, rage: false, lvl: 1, alive: true, lock: false };
const samples = {
  hello: { t: 'hello', proto: PROTOCOL_VERSION, build: NET_BUILD, ...profile },
  welcome: { t: 'welcome', id: 'p1', players: [{ id: 'p0', ...profile }, { id: 'p1', name: 'Bia', char: 'flash', skin: 'reverse' }], seed: 12345 },
  reject: { t: 'reject', reason: 'full' },
  join: { t: 'join', player: { id: 'p2', ...profile } },
  leave: { t: 'leave', id: 'p2' },
  pose: { t: 'pose', id: 'p1', char: 'flash', skin: 'classic', p: [1, 2, 3], q: [0, 0, 0, 1], clip: 'run', hp: 80, dead: false },
  world: { t: 'world', boss, fires: [['building-fire-1:fire:1', .5], ['meteor-2:impact-fire:1', 1]] },
  event: { t: 'event', kind: 'spawn-meteor', data: { id: 'meteor-1', impactPoint: { x: 1, y: 2, z: 3 }, fireCount: 4 } },
  dmg: { t: 'dmg', amount: 22, label: 'SOCO', kb: 1.25, src: [0, 1, 0] },
  cool: { t: 'cool', shape: 'cone', origin: [0, 1, 0], dir: [0, 0, 1], range: 24, half: 22, dt: .1, rate: .42, radius: 0 },
  intercept: { t: 'intercept', method: 'superPunch', origin: [0, 1, 0], radius: 2, speed: 0 },
  hit: { t: 'hit', amount: 14, dir: [0, 0, 1] },
  reset: { t: 'reset' },
  ping: { t: 'ping', ts: 1000 },
  pong: { t: 'pong', ts: 1000 }
};

test('every message type survives encode -> decode unchanged', () => {
  for (const [type, msg] of Object.entries(samples)) {
    assert.equal(msg.t, type);
    assert.deepEqual(decode(encode(msg)), msg, type);
  }
});

test('room codes: 4 unambiguous characters, normalised from messy input', () => {
  assert.equal(NET_TUNING.roomCodeLength, 4);
  const code = makeRoomCode(() => 0);
  assert.equal(code, ROOM_ALPHABET[0].repeat(4));
  assert.ok(!/[ILO01]/.test(ROOM_ALPHABET));
  assert.equal(normalizeRoomCode(' ab-cd '), 'ABCD');
  assert.equal(normalizeRoomCode('abc'), '');
  assert.equal(normalizeRoomCode('ABCDE'), '');
  assert.equal(normalizeRoomCode('ABC0'), '');      // 0 is not in the alphabet
  assert.equal(normalizeRoomCode(null), '');
  assert.equal(peerIdForRoom('ABCD'), 'skyguardian-abcd');
});

test('hostile or malformed input never throws and decodes to null', () => {
  const bad = [
    undefined, null, 42, {}, '', 'not json', '[]', 'null', '{"t":"nope"}', '{"t":"pose"}',
    JSON.stringify({ ...samples.pose, p: [NaN, 0, 0] }),
    JSON.stringify({ ...samples.pose, p: [1e9, 0, 0] }),
    JSON.stringify({ ...samples.pose, q: [0, 0, 0, 0] }),
    JSON.stringify({ ...samples.pose, clip: '<script>' }),
    JSON.stringify({ ...samples.pose, char: 'batman' }),
    JSON.stringify({ ...samples.pose, skin: 'nope' }),
    JSON.stringify({ ...samples.hello, char: 'flash', skin: 'armor' }),   // armor belongs to Superman
    JSON.stringify({ ...samples.reject, reason: 'because' }),
    JSON.stringify({ ...samples.world, fires: Array(40).fill(['a', 1]) }),
    'x'.repeat(NET_TUNING.maxMessageChars + 1),
    '{"t":"event","kind":"spawn-meteor","data":' + '['.repeat(50) + ']'.repeat(50) + '}'
  ];
  for (const raw of bad) assert.doesNotThrow(() => decode(raw));
  for (const raw of bad) assert.equal(decode(raw), null, String(raw).slice(0, 40));
  assert.throws(() => encode({ t: 'pose' }));
  assert.throws(() => encode(null));
});

test('values are clamped, names cleaned, prototype keys dropped', () => {
  const dmg = decode(JSON.stringify({ ...samples.dmg, amount: 1e9, kb: 99, label: 'A'.repeat(100) }));
  assert.equal(dmg.amount, NET_TUNING.maxDamagePerRequest);
  assert.equal(dmg.kb, 20);
  assert.equal(dmg.label.length, 24);
  const hello = decode(JSON.stringify({ ...samples.hello, name: '  \u0007Zé\u0000  '.padEnd(40, 'x') }));
  assert.ok(hello.name.length <= NET_TUNING.maxNameLength);
  assert.ok(!/[\u0000-\u001f]/.test(hello.name));
  assert.equal(decode(JSON.stringify({ ...samples.hello, name: '   ' })).name, 'Herói');
  const ev = decode('{"t":"event","kind":"command","data":{"__proto__":{"x":1},"type":"meteor-impact","skip":null}}');
  assert.equal(ev.data.type, 'meteor-impact');
  assert.equal(Object.getPrototypeOf(ev.data), Object.prototype);
  assert.equal(ev.data.x, undefined);
  const pose = decode(JSON.stringify({ ...samples.pose, q: [0, 0, 0, 2] }));
  assert.ok(Math.abs(Math.hypot(...pose.q) - 1) < 1e-9);
});
