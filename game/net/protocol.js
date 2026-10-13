import { isCharacterId, getSkin } from '../characters/registry.js';

// Wire format for the online co-op. Pure: no three.js, no DOM, no network.
// Every incoming message goes through decode(), which sanitises it field by field,
// so game code only ever sees well-formed, clamped values.

export const PROTOCOL_VERSION = 1;
// Bump by hand whenever the protocol or the shared game rules change; peers on
// different builds are refused at the handshake.
export const NET_BUILD = 'sky-net-1';

export const NET_TUNING = Object.freeze({
  poseHz: 15,
  worldHz: 10,
  interpDelayMs: 100,
  timeoutMs: 5000,
  pingMs: 1500,
  maxPlayers: 4,
  bossHealthPerExtraPlayer: .5,
  roomCodeLength: 4,
  maxDamagePerRequest: 60,
  maxNameLength: 16,
  maxMessageChars: 4096,
  maxMessagesPerSecond: 120,
  worldLimit: 5000
});

// No I, L, O, 0 or 1: easy to read out loud and to type.
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(rand = Math.random, length = NET_TUNING.roomCodeLength) {
  let out = '';
  for (let i = 0; i < length; i++) out += ROOM_ALPHABET[Math.min(ROOM_ALPHABET.length - 1, Math.floor(rand() * ROOM_ALPHABET.length))];
  return out;
}

export function normalizeRoomCode(text, length = NET_TUNING.roomCodeLength) {
  const code = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === length && [...code].every(ch => ROOM_ALPHABET.includes(ch)) ? code : '';
}

export const peerIdForRoom = code => `skyguardian-${String(code).toLowerCase()}`;

// --- field sanitisers (throw on anything unacceptable) ---------------------------
const bad = () => { throw new Error('bad message'); };
const LIMIT = NET_TUNING.worldLimit;
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : bad());
const clampNum = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : bad());
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : bad());
const bool = v => (typeof v === 'boolean' ? v : bad());
const oneOf = (v, list) => (list.includes(v) ? v : bad());
const str = (v, max) => {
  if (typeof v !== 'string') bad();
  return v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
};
const arr = (v, max, fn) => (Array.isArray(v) && v.length <= max ? v.map(fn) : bad());
const vec3 = v => (Array.isArray(v) && v.length === 3 ? v.map(n => num(n, -LIMIT, LIMIT)) : bad());
const quat = v => {
  if (!Array.isArray(v) || v.length !== 4) bad();
  const q = v.map(n => clampNum(n, -1, 1));
  const len = Math.hypot(...q);
  return len > .5 ? q.map(n => n / len) : bad();
};
const clipName = v => (typeof v === 'string' && /^[\w .:-]{0,64}$/.test(v) ? v : bad());
const cleanName = v => str(v, NET_TUNING.maxNameLength).trim() || 'Herói';

// Deep copy of plain JSON data (event payloads), bounded in depth, size and key set.
function plain(v, depth = 0) {
  if (depth > 5) bad();
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : bad();
  if (typeof v === 'string') return v.slice(0, 96);
  if (Array.isArray(v)) return v.length <= 24 ? v.map(x => plain(x, depth + 1)) : bad();
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter(k => k !== '__proto__' && v[k] !== undefined);
    if (keys.length > 40) bad();
    return Object.fromEntries(keys.map(k => [k, plain(v[k], depth + 1)]));
  }
  return bad();
}

const skinFor = (char, skin) => (getSkin(char, skin).id === skin ? skin : bad());
const look = m => {
  const char = isCharacterId(m.char) ? m.char : bad();
  return { char, skin: skinFor(char, str(m.skin, 24)) };
};
const profile = m => ({ name: cleanName(m.name), ...look(m) });
const player = m => ({ id: str(m?.id, 8), ...profile(m) });

const bossState = b => ({
  p: vec3(b.p), y: clampNum(b.y, -100, 100), clip: clipName(b.clip), rate: clampNum(b.rate, 0, 8), tok: int(b.tok, 0, 1e9),
  hp: clampNum(b.hp, 0, 1e6), max: clampNum(b.max, 1, 1e6), rage: bool(b.rage), lvl: int(b.lvl, 1, 9999), alive: bool(b.alive), lock: bool(b.lock)
});

const EVENT_KINDS = ['spawn-meteor', 'spawn-fire', 'fires', 'command'];

const SANITIZERS = {
  hello: m => ({ t: 'hello', proto: int(m.proto, 0, 1000), build: str(m.build, 32), ...profile(m) }),
  welcome: m => ({ t: 'welcome', id: str(m.id, 8), players: arr(m.players, 8, player), seed: int(m.seed, 0, 2 ** 31) }),
  reject: m => ({ t: 'reject', reason: oneOf(m.reason, ['full', 'version', 'closed']) }),
  join: m => ({ t: 'join', player: player(m.player) }),
  leave: m => ({ t: 'leave', id: str(m.id, 8) }),
  pose: m => ({
    t: 'pose', id: str(m.id, 8), ...look(m), p: vec3(m.p), q: quat(m.q), clip: clipName(m.clip),
    hp: clampNum(m.hp, 0, 10000), dead: bool(m.dead)
  }),
  world: m => ({
    t: 'world', boss: bossState(m.boss ?? bad()),
    fires: arr(m.fires, 16, f => (Array.isArray(f) && f.length === 2 ? [str(f[0], 64), clampNum(f[1], 0, 1)] : bad()))
  }),
  event: m => ({ t: 'event', kind: oneOf(m.kind, EVENT_KINDS), data: plain(m.data) }),
  dmg: m => ({
    t: 'dmg', amount: clampNum(m.amount, 0, NET_TUNING.maxDamagePerRequest), label: str(m.label ?? '', 24),
    kb: clampNum(m.kb ?? 0, 0, 20), src: vec3(m.src)
  }),
  cool: m => ({
    t: 'cool', shape: oneOf(m.shape, ['cone', 'sphere']), origin: vec3(m.origin), dir: m.dir ? vec3(m.dir) : [0, 0, 1],
    range: clampNum(m.range ?? 0, 0, 120), half: clampNum(m.half ?? 0, 0, 90), dt: clampNum(m.dt, 0, .5),
    rate: clampNum(m.rate ?? .42, 0, 2), radius: clampNum(m.radius ?? 0, 0, 60)
  }),
  intercept: m => ({
    t: 'intercept', method: oneOf(m.method, ['superPunch', 'supersonic']), origin: vec3(m.origin),
    radius: clampNum(m.radius ?? 0, 0, 30), speed: clampNum(m.speed ?? 0, 0, 3000)
  }),
  hit: m => ({ t: 'hit', amount: clampNum(m.amount, 0, 100), dir: vec3(m.dir) }),
  reset: () => ({ t: 'reset' }),
  ping: m => ({ t: 'ping', ts: clampNum(m.ts, 0, 1e15) }),
  pong: m => ({ t: 'pong', ts: clampNum(m.ts, 0, 1e15) })
};

function sanitize(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') bad();
  const fn = Object.hasOwn(SANITIZERS, msg.t) ? SANITIZERS[msg.t] : null;
  return fn ? fn(msg) : bad();
}

export function encode(msg) {
  const text = JSON.stringify(sanitize(msg));
  if (text.length > NET_TUNING.maxMessageChars) throw new Error('message too large');
  return text;
}

export function decode(raw) {
  if (typeof raw !== 'string' || raw.length > NET_TUNING.maxMessageChars) return null;
  try { return sanitize(JSON.parse(raw)); }
  catch { return null; }
}
