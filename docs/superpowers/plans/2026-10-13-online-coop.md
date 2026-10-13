# Co-op online contra o Jason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que 2 a 4 jogadores joguem juntos na mesma cidade, cada um com seu herói e skin, contra o mesmo Jason e os mesmos meteoros e incêndios, via sala P2P com código de 4 letras, publicável no GitHub Pages.

**Architecture:** Topologia em estrela WebRTC (PeerJS) em que o **anfitrião** simula o Jason, os eventos e o fogo e os convidados espelham esse estado; cada jogador manda no próprio herói e envia a pose cerca de 15 vezes por segundo. A rede vive em módulos novos e puros em `game/net/` (protocolo, interpolação, regras, transporte, sala, sessão) testados com um transporte em memória; `main.js` ganha só ganchos finos condicionados a `netSession?.…`, então o modo solo continua idêntico.

**Tech Stack:** JavaScript ES modules (sem build), three.js 0.186 já embarcado, PeerJS 1.5.4 embarcado em `vendor/peerjs/`, `node --test` para testes, GitHub Actions para publicar no Pages.

**Spec:** `docs/superpowers/specs/2026-10-13-online-coop-design.md`

## Deviations from the spec (decididas ao planejar, depois de ler o código)

1. **Build do handshake:** o `build` é a constante `NET_BUILD` em `game/net/protocol.js`, que se incrementa à mão quando o protocolo muda. O hash do pré-cache do PWA só é conhecido depois que o service worker responde, tarde demais para o `hello`.
2. **Pose com quaternion:** o `pose` leva `q` (quaternion) em vez de só `y` (yaw), porque o Superman voa com inclinação e rolagem (`hero.quaternion`). O Jason continua com yaw.
3. **Pausa online:** o jogo congela o mundo ao pausar. Online, o loop de rede e o espelho continuam rodando durante a pausa; só o mundo simulado do **anfitrião** congela enquanto ele está no menu (limitação documentada, ver Task 13).
4. **Módulo extra `game/net/rules.js`:** funções puras de regra (escolha de alvo, acerto do Jason, escala de vida) que o spec citava dentro de `main.js`; ficam fora para serem testadas.
5. **Pose inclui `char` e `skin`:** assim o remoto troca de modelo se o outro jogador mudar de personagem, sem mensagem extra.

## Global Constraints

- Salas de **2 a 4 jogadores** (`maxPlayers: 4`), código de **4** caracteres (`roomCodeLength: 4`), sem PvP, sem dano entre jogadores.
- `poseHz: 15`, `worldHz: 10`, `interpDelayMs: 100`, `timeoutMs: 5000`, vida do Jason **+50%** por jogador extra (`bossHealthPerExtraPlayer: .5`).
- Só **STUN** público na v1 (sem TURN); lista de servidores ICE em configuração.
- Sem servidor próprio: tudo estático, publicável no **GitHub Pages**; caminhos relativos (`./`).
- PeerJS **embarcado** em `vendor/peerjs/` e incluído no pré-cache do PWA (`npm run pwa`).
- Todo texto de interface em **português**.
- Modo solo **inalterado**: nenhum gancho muda o comportamento quando `netSession` é `null`.
- Mensagens da rede nunca lançam exceção para fora de `decode`; mensagem inválida é descartada.
- Sem commits automáticos fora dos passos de commit do plano; um commit por tarefa, mensagens em inglês no estilo do repositório (`feat:`, `test:`, `docs:`).

## Review Focus

Entradas e falhas que a spec implica mas nenhuma tarefa exercitaria sem pedido explícito. Cada linha tem o teste na tarefa dona do código.

1. **Mensagem hostil ou gigante** (JSON inválido, `__proto__`, números `NaN`/`Infinity`, string de 1 MB, dano 1e9): nunca lança, nunca chega ao jogo, dano é limitado → Task 1.
2. **Pacotes atrasados, duplicados ou fora de ordem** e buracos longos sem pose: a interpolação não pula para trás e a extrapolação é limitada → Task 2.
3. **Quinto jogador, código digitado errado (minúsculas, espaços, letras ambíguas) e sala inexistente**: mensagens claras, nenhum estado preso em "conectando" → Tasks 1, 4 e 8.
4. **Convidado sai (ou cai) enquanto o Jason o persegue**: o Jason escolhe outro alvo ou fica parado, nunca persegue um jogador que não existe mais → Tasks 2 e 12.
5. **Anfitrião sai com o menu aberto / convidado entra no meio de um meteoro e de incêndios**: a sala volta ao solo sem travar e o recém-chegado recebe o mundo atual → Tasks 4, 11 e 13.
6. **Solo intacto:** com `netSession === null` todos os ganchos são no-ops → Task 14 (teste de contrato em `main.js`).

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `game/net/protocol.js` | criar | Constantes, tipos de mensagem, `encode`/`decode` com sanitização, códigos de sala |
| `game/net/interpolation.js` | criar | `SnapshotBuffer` (interpolação de pose com atraso fixo) |
| `game/net/rules.js` | criar | `chooseTarget`, `attackHits`, `scaledBossHealth` |
| `game/net/transport.js` | criar | `NetError`, `MemoryNetwork` (testes), `createPeerNetwork` (PeerJS) |
| `game/net/room.js` | criar | `Room`: criar/entrar, handshake, jogadores, relé de pose, tempo limite |
| `game/net/net-session.js` | criar | `NetSession`: envio de pose/mundo, roteamento de mensagens, API de pedidos |
| `game/net/remote-hero.js` | criar | `RemoteHeroes`: bonecos dos outros jogadores |
| `game/ui/online-panel.js` | criar | Aba **Online** (DOM) e textos de erro |
| `game/events/dynamic-event-system.js` | modificar | `setMirror`, `adopt` |
| `game/fire/fire-system.js` | modificar | `getSnapshot`, `syncFromSnapshot` |
| `game/ui/pause-menu.js` | modificar | Aba Online opcional |
| `game/ui/game-map.js` | modificar | Pontos dos outros jogadores no mapa |
| `game/characters/registry.js` | modificar | `model: { height, yaw }` por personagem |
| `main.js` | modificar | Ganchos finos (Tasks 10–13) |
| `index.html`, `style.css` | modificar | Script do PeerJS, estilos da aba Online |
| `tools/vendor-peerjs.mjs`, `package.json` | criar/modificar | Embarcar o PeerJS, scripts de checagem |
| `.github/workflows/pages.yml` | criar | Publicação no GitHub Pages |
| `tests/net-*.test.js` | criar | Um arquivo de teste por módulo |

---

### Task 1: Protocolo (`protocol.js`)

**Files:**
- Create: `game/net/protocol.js`
- Test: `tests/net-protocol.test.js`

**Interfaces:**
- Consumes: `isCharacterId`, `getSkin` de `game/characters/registry.js`.
- Produces:
  - `PROTOCOL_VERSION = 1`, `NET_BUILD = 'sky-net-1'`
  - `NET_TUNING` (objeto congelado, chaves exatas abaixo)
  - `ROOM_ALPHABET`, `makeRoomCode(rand?, length?) -> string`, `normalizeRoomCode(text, length?) -> string` (`''` se inválido), `peerIdForRoom(code) -> string`
  - `encode(msg) -> string` (lança `Error` se inválida), `decode(raw) -> msg | null`
  - Mensagens (`t`): `hello welcome reject join leave pose world event dmg cool intercept hit reset ping pong`

- [ ] **Step 1: Write the failing test**

Create `tests/net-protocol.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-protocol.test.js`
Expected: FAIL — `Cannot find module '../game/net/protocol.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `game/net/protocol.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-protocol.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add game/net/protocol.js tests/net-protocol.test.js
git commit -m "feat(net): wire protocol with sanitising encode/decode and room codes"
```

---

### Task 2: Interpolação e regras (`interpolation.js`, `rules.js`)

**Files:**
- Create: `game/net/interpolation.js`, `game/net/rules.js`
- Test: `tests/net-interpolation.test.js`, `tests/net-rules.test.js`

**Interfaces:**
- Consumes: `NET_TUNING` de `game/net/protocol.js`.
- Produces:
  - `quatNlerp(a, b, t) -> [x,y,z,w]`, `yawToQuat(yaw) -> [x,y,z,w]`, `quatToYaw(q) -> number`
  - `class SnapshotBuffer({ delayMs?, maxExtrapolateMs?, capacity? })` com `push(atMs, { x, y, z, q })`, `sample(nowMs) -> { x, y, z, q } | null`, `latest() -> { x, y, z, q } | null`, `clear()`, `length`
  - `chooseTarget(targets, from) -> target | null` (alvos `{ id, x, y, z }`, `from` `{ x, z }`; o mais próximo no plano horizontal, empate fica com o primeiro)
  - `attackHits(targets, { origin, dir, range, baseY, maxDy = 3.2 }) -> target[]`
  - `scaledBossHealth(base, players) -> number`

- [ ] **Step 1: Write the failing tests**

Create `tests/net-interpolation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer, quatNlerp, yawToQuat, quatToYaw } from '../game/net/interpolation.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const S = (x, yaw = 0) => ({ x, y: 0, z: 0, q: yawToQuat(yaw) });

test('yaw <-> quaternion round trip, including the wrap-around', () => {
  for (const yaw of [0, .5, -.5, 3, -3]) near(quatToYaw(yawToQuat(yaw)), yaw);
});

test('nlerp takes the short way round', () => {
  const mid = quatNlerp(yawToQuat(3.0), yawToQuat(-3.0), .5);
  assert.ok(Math.abs(quatToYaw(mid)) > 3.0, 'passes through +-PI, not through 0');
  near(Math.hypot(...mid), 1);
});

test('interpolates between samples, rendering 100 ms in the past', () => {
  const buf = new SnapshotBuffer({ delayMs: 100 });
  buf.push(1000, S(0)); buf.push(1100, S(10)); buf.push(1200, S(20));
  near(buf.sample(1200).x, 10);   // render time 1100
  near(buf.sample(1150).x, 5);    // render time 1050
  near(buf.sample(1250).x, 15);   // render time 1150
});

test('before the first sample it holds the first one; empty buffer gives null', () => {
  const buf = new SnapshotBuffer();
  assert.equal(buf.sample(0), null);
  assert.equal(buf.latest(), null);
  buf.push(1000, S(7));
  near(buf.sample(0).x, 7);
  near(buf.sample(1000).x, 7);
});

test('past the newest sample it extrapolates a little, then holds', () => {
  const buf = new SnapshotBuffer({ delayMs: 0, maxExtrapolateMs: 100 });
  buf.push(1000, S(0)); buf.push(1100, S(10));
  near(buf.sample(1150).x, 15);                 // 50 ms of extrapolation
  near(buf.sample(5000).x, 20);                 // capped at 100 ms -> +10, never runs away
});

test('late, duplicate and out-of-order packets are ignored', () => {
  const buf = new SnapshotBuffer({ delayMs: 0 });
  buf.push(1000, S(0)); buf.push(1100, S(10));
  buf.push(1100, S(99)); buf.push(1050, S(55)); buf.push(900, S(-5));
  assert.equal(buf.length, 2);
  near(buf.latest().x, 10);
  near(buf.sample(1050).x, 5);
});

test('capacity drops the oldest sample; clear empties', () => {
  const buf = new SnapshotBuffer({ capacity: 3 });
  for (let i = 0; i < 6; i++) buf.push(1000 + i * 100, S(i));
  assert.equal(buf.length, 3);
  buf.clear();
  assert.equal(buf.length, 0);
});
```

Create `tests/net-rules.test.js`:

```js
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
```


- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/net-interpolation.test.js tests/net-rules.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

Create `game/net/interpolation.js`:

```js
import { NET_TUNING } from './protocol.js';

// Pose smoothing for remote players and the mirrored boss. Samples are stamped
// with the *local arrival time*, so sender clocks never matter; rendering runs
// `delayMs` behind to hide network jitter.

export const yawToQuat = yaw => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
export const quatToYaw = q => Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));

/** Normalised lerp on the short arc; t outside 0..1 extrapolates. */
export function quatNlerp(a, b, t) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const out = a.map((v, i) => v + (b[i] * s - v) * t);
  const len = Math.hypot(...out) || 1;
  return out.map(v => v / len);
}

const copy = s => ({ x: s.x, y: s.y, z: s.z, q: [...s.q] });
const mix = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, q: quatNlerp(a.q, b.q, t)
});

export class SnapshotBuffer {
  constructor({ delayMs = NET_TUNING.interpDelayMs, maxExtrapolateMs = 150, capacity = 32 } = {}) {
    this.delayMs = delayMs;
    this.maxExtrapolateMs = maxExtrapolateMs;
    this.capacity = capacity;
    this.samples = [];
  }

  get length() { return this.samples.length; }

  push(atMs, state) {
    const last = this.samples[this.samples.length - 1];
    if (last && atMs <= last.at) return;           // late, duplicate or out of order
    this.samples.push({ at: atMs, ...copy(state) });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  latest() {
    const last = this.samples[this.samples.length - 1];
    return last ? copy(last) : null;
  }

  sample(nowMs) {
    const n = this.samples.length;
    if (!n) return null;
    const t = nowMs - this.delayMs;
    const first = this.samples[0], last = this.samples[n - 1];
    if (t <= first.at) return copy(first);
    if (t >= last.at) {
      if (n < 2) return copy(last);
      const prev = this.samples[n - 2];
      const span = last.at - prev.at;
      const k = span > 0 ? Math.min(t - last.at, this.maxExtrapolateMs) / span : 0;
      return mix(prev, last, 1 + k);
    }
    let i = 0;
    while (this.samples[i + 1].at <= t) i++;
    const a = this.samples[i], b = this.samples[i + 1];
    return mix(a, b, (t - a.at) / (b.at - a.at));
  }

  clear() { this.samples.length = 0; }
}
```

Create `game/net/rules.js`:

```js
import { NET_TUNING } from './protocol.js';

// Rules the host applies to the shared boss. Pure, so they are tested without a browser.

/** Nearest target on the ground plane; ties keep the earlier entry. `null` when nobody is left. */
export function chooseTarget(targets, from) {
  let best = null, bestDist = Infinity;
  for (const t of targets || []) {
    const d = Math.hypot(t.x - from.x, t.z - from.z);
    if (d < bestDist) { best = t; bestDist = d; }
  }
  return best;
}

/**
 * Who a boss swing connects with. Same geometry as the single-player rule:
 * within `range` of the strike point (aimed at chest height), no more than `maxDy`
 * above or below the boss, and in front of him (dot >= .08).
 */
export function attackHits(targets, { origin, dir, range, baseY, maxDy = 3.2 }) {
  const out = [];
  for (const t of targets || []) {
    if (Math.abs(t.y - baseY) > maxDy) continue;
    const dx = t.x - origin.x, dy = t.y + 1 - origin.y, dz = t.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > range || dist < 1e-6) continue;
    if ((dx * dir.x + dy * dir.y + dz * dir.z) / dist < .08) continue;
    out.push(t);
  }
  return out;
}

export function scaledBossHealth(base, players) {
  return Math.round(base * (1 + NET_TUNING.bossHealthPerExtraPlayer * Math.max(0, players - 1)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/net-interpolation.test.js tests/net-rules.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/net/interpolation.js game/net/rules.js tests/net-interpolation.test.js tests/net-rules.test.js
git commit -m "feat(net): snapshot interpolation and boss targeting rules"
```

---

### Task 3: Transporte (`transport.js`)

**Files:**
- Create: `game/net/transport.js`
- Test: `tests/net-transport.test.js`

**Interfaces:**
- Consumes: `peerIdForRoom` de `protocol.js`.
- Produces:
  - `class NetError extends Error { code }` com `code` em `'taken' | 'not-found' | 'network' | 'timeout'`
  - Interface de **rede**: `network.host(code) -> Promise<Host>` (`Host`: `onConnection(fn)`, `close()`); `network.join(code) -> Promise<Conn>`
  - Interface de **conexão** (`Conn`): `send(text)`, `close()`, `onMessage(fn)`, `onClose(fn)`; mensagens que chegam antes de `onMessage` ficam em fila
  - `class MemoryNetwork` (testes, mesma interface; `host`/`join` assíncronos)
  - `DEFAULT_ICE_SERVERS`, `createPeerNetwork({ Peer?, iceServers?, connectTimeoutMs? })`

- [ ] **Step 1: Write the failing test**

Create `tests/net-transport.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryNetwork, NetError, createPeerNetwork, DEFAULT_ICE_SERVERS } from '../game/net/transport.js';

const flush = () => new Promise(r => setTimeout(r, 0));

test('memory network: host accepts, both sides exchange text in order', async () => {
  const net = new MemoryNetwork();
  const host = await net.host('ABCD');
  const seen = [];
  let hostSide;
  host.onConnection(conn => { hostSide = conn; conn.onMessage(t => seen.push(['host', t])); });
  const guest = await net.join('ABCD');
  guest.onMessage(t => seen.push(['guest', t]));
  guest.send('one'); guest.send('two');
  await flush();
  hostSide.send('three');
  await flush();
  assert.deepEqual(seen, [['host', 'one'], ['host', 'two'], ['guest', 'three']]);
});

test('memory network: messages sent before a handler exists are queued, not lost', async () => {
  const net = new MemoryNetwork();
  const host = await net.host('ABCD');
  let hostSide;
  host.onConnection(conn => { hostSide = conn; });
  const guest = await net.join('ABCD');
  hostSide.send('early');
  await flush();
  const got = [];
  guest.onMessage(t => got.push(t));
  assert.deepEqual(got, ['early']);
});

test('memory network: duplicate code, unknown code, closing notifies the other side', async () => {
  const net = new MemoryNetwork();
  const host = await net.host('ABCD');
  await assert.rejects(net.host('ABCD'), e => e instanceof NetError && e.code === 'taken');
  await assert.rejects(net.join('ZZZZ'), e => e instanceof NetError && e.code === 'not-found');
  let hostSide;
  host.onConnection(conn => { hostSide = conn; });
  const guest = await net.join('ABCD');
  let closed = 0;
  hostSide.onClose(() => closed++);
  guest.close();
  await flush();
  assert.equal(closed, 1);
  guest.send('ignored after close');          // must not throw
  host.close();
  await assert.rejects(net.join('ABCD'), e => e.code === 'not-found');
  await net.host('ABCD');                      // code is free again
});

// --- PeerJS adapter, against a fake Peer --------------------------------------------
class FakeEmitter {
  constructor() { this.h = {}; }
  on(name, fn) { (this.h[name] ||= []).push(fn); return this; }
  emit(name, ...args) { (this.h[name] || []).forEach(fn => fn(...args)); }
}
function makeFakePeer({ failWith = null, hosts = new Map() } = {}) {
  return class FakePeer extends FakeEmitter {
    constructor(id, options) {
      super();
      this.id = id; this.options = options; this.destroyed = false;
      queueMicrotask(() => {
        if (failWith) return this.emit('error', { type: failWith });
        if (id) hosts.set(id, this);
        this.emit('open', id || 'anon');
      });
    }
    connect(target) {
      const conn = new FakeConn(target);
      const host = hosts.get(target);
      queueMicrotask(() => {
        if (!host) return this.emit('error', { type: 'peer-unavailable' });
        const remote = new FakeConn(this.id || 'anon'); conn.remote = remote; remote.remote = conn;
        host.emit('connection', remote);
        conn.emit('open'); remote.emit('open');
      });
      return conn;
    }
    destroy() { this.destroyed = true; }
  };
}
class FakeConn extends FakeEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = true; }
  send(data) { const r = this.remote; queueMicrotask(() => r.emit('data', data)); }
  close() { this.open = false; this.emit('close'); queueMicrotask(() => this.remote?.emit('close')); }
}

test('peer network: host + join exchange strings and use the ICE list', async () => {
  const hosts = new Map();
  const Peer = makeFakePeer({ hosts });
  const net = createPeerNetwork({ Peer });
  const host = await net.host('ABCD');
  assert.ok(hosts.has('skyguardian-abcd'));
  assert.deepEqual(hosts.get('skyguardian-abcd').options.config.iceServers, DEFAULT_ICE_SERVERS);
  const got = [];
  host.onConnection(conn => conn.onMessage(t => got.push(t)));
  const guest = await net.join('ABCD');
  guest.send('hello there');
  await flush();
  assert.deepEqual(got, ['hello there']);
});

test('peer network: broker errors map to NetError codes', async () => {
  const cases = [['unavailable-id', 'taken'], ['peer-unavailable', 'not-found'], ['network', 'network'], ['server-error', 'network'], ['weird', 'network']];
  for (const [type, code] of cases) {
    const net = createPeerNetwork({ Peer: makeFakePeer({ failWith: type }) });
    await assert.rejects(net.host('ABCD'), e => e instanceof NetError && e.code === code, type);
  }
  const net = createPeerNetwork({ Peer: makeFakePeer() });
  await assert.rejects(net.join('NOPE'), e => e.code === 'not-found');
});

test('peer network: missing PeerJS or a silent broker fail cleanly', async () => {
  assert.throws(() => createPeerNetwork({ Peer: null }), e => e instanceof NetError && e.code === 'network');
  class Silent { constructor() {} on() { return this; } destroy() {} }
  const net = createPeerNetwork({ Peer: Silent, connectTimeoutMs: 20 });
  await assert.rejects(net.host('ABCD'), e => e.code === 'timeout');
});
```

Remove the unused-looking line `const S = ...` if present (none in this file). The file above is the complete test.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-transport.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `game/net/transport.js`:

```js
import { peerIdForRoom } from './protocol.js';

// Transport layer: the only part of the net code that knows about PeerJS.
//   Network: host(code) -> Promise<Host>, join(code) -> Promise<Conn>
//   Host:    onConnection(fn(conn)), close()
//   Conn:    send(text), close(), onMessage(fn(text)), onClose(fn())
// Messages that arrive before onMessage() is called are queued.

export class NetError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/** Shared by every Conn: queues inbound text until a handler is attached. */
class Inbox {
  constructor() { this.handler = null; this.queue = []; }
  push(text) { if (this.handler) this.handler(text); else this.queue.push(text); }
  attach(fn) { this.handler = fn; for (const text of this.queue.splice(0)) fn(text); }
}

// --- in-memory network (tests) -----------------------------------------------------
class MemoryConn {
  constructor() { this.inbox = new Inbox(); this.closeHandlers = []; this.closed = false; this.peer = null; }
  send(text) {
    if (this.closed || !this.peer) return;
    const peer = this.peer;
    queueMicrotask(() => { if (!peer.closed) peer.inbox.push(text); });
  }
  onMessage(fn) { this.inbox.attach(fn); }
  onClose(fn) { this.closeHandlers.push(fn); }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closeHandlers) fn();
    const peer = this.peer;
    if (peer && !peer.closed) queueMicrotask(() => peer._remoteClosed());
  }
  _remoteClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closeHandlers) fn();
  }
}

class MemoryHost {
  constructor(network, id) { this.network = network; this.id = id; this.handler = null; this.queue = []; this.closed = false; }
  onConnection(fn) { this.handler = fn; for (const c of this.queue.splice(0)) fn(c); }
  _accept(conn) { if (this.handler) this.handler(conn); else this.queue.push(conn); }
  close() { this.closed = true; this.network.hosts.delete(this.id); }
}

export class MemoryNetwork {
  constructor() { this.hosts = new Map(); }
  async host(code) {
    const id = peerIdForRoom(code);
    if (this.hosts.has(id)) throw new NetError('taken');
    const host = new MemoryHost(this, id);
    this.hosts.set(id, host);
    return host;
  }
  async join(code) {
    const host = this.hosts.get(peerIdForRoom(code));
    if (!host || host.closed) throw new NetError('not-found');
    const guestSide = new MemoryConn(), hostSide = new MemoryConn();
    guestSide.peer = hostSide; hostSide.peer = guestSide;
    queueMicrotask(() => host._accept(hostSide));
    return guestSide;
  }
}

// --- PeerJS (WebRTC) ---------------------------------------------------------------
// STUN only on purpose: some networks (CGNAT, certain mobile carriers) will not connect
// without a TURN relay. Add one here when needed; nothing else changes.
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const ERROR_CODES = { 'unavailable-id': 'taken', 'peer-unavailable': 'not-found' };
const mapError = err => new NetError(ERROR_CODES[err?.type] || 'network', err?.message || err?.type);

function wrapConn(conn) {
  const inbox = new Inbox();
  conn.on('data', data => { if (typeof data === 'string') inbox.push(data); });
  return {
    id: conn.peer,
    send(text) { if (conn.open) conn.send(text); },
    close() { try { conn.close(); } catch { /* already closed */ } },
    onMessage(fn) { inbox.attach(fn); },
    onClose(fn) { conn.on('close', fn); conn.on('error', fn); }
  };
}

export function createPeerNetwork({ Peer = globalThis.Peer, iceServers = DEFAULT_ICE_SERVERS, connectTimeoutMs = 10000 } = {}) {
  if (!Peer) throw new NetError('network', 'PeerJS não carregou');
  const options = { config: { iceServers }, debug: 0 };

  return {
    host(code) {
      return new Promise((resolve, reject) => {
        const peer = new Peer(peerIdForRoom(code), options);
        let opened = false;
        const timer = setTimeout(() => { peer.destroy(); reject(new NetError('timeout')); }, connectTimeoutMs);
        let handler = null;
        const pending = [];
        peer.on('open', () => {
          opened = true; clearTimeout(timer);
          resolve({
            onConnection(fn) { handler = fn; for (const c of pending.splice(0)) fn(c); },
            close() { peer.destroy(); }
          });
        });
        peer.on('error', err => { if (!opened) { clearTimeout(timer); peer.destroy(); reject(mapError(err)); } });
        peer.on('connection', conn => {
          conn.on('open', () => { const wrapped = wrapConn(conn); if (handler) handler(wrapped); else pending.push(wrapped); });
        });
      });
    },

    join(code) {
      return new Promise((resolve, reject) => {
        const peer = new Peer(undefined, options);
        let settled = false;
        const fail = err => { if (settled) return; settled = true; clearTimeout(timer); peer.destroy(); reject(err); };
        const timer = setTimeout(() => fail(new NetError('timeout')), connectTimeoutMs);
        peer.on('error', err => fail(mapError(err)));
        peer.on('open', () => {
          const conn = peer.connect(peerIdForRoom(code), { serialization: 'json', reliable: true });
          conn.on('open', () => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            const wrapped = wrapConn(conn);
            const close = wrapped.close;
            wrapped.close = () => { close(); peer.destroy(); };
            resolve(wrapped);
          });
          conn.on('error', err => fail(mapError(err)));
        });
      });
    }
  };
}
```

Note on the test fakes: `FakePeer.connect` emits `peer-unavailable` on the *peer* (as real PeerJS does), which `join` maps to `not-found`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-transport.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add game/net/transport.js tests/net-transport.test.js
git commit -m "feat(net): transport interface with in-memory and PeerJS implementations"
```

---

### Task 4: Sala (`room.js`)

**Files:**
- Create: `game/net/room.js`
- Test: `tests/net-room.test.js`

**Interfaces:**
- Consumes: `encode`, `decode`, `NET_TUNING`, `PROTOCOL_VERSION`, `NET_BUILD`, `makeRoomCode` (Task 1); `NetError` (Task 3); uma `network` (`host`/`join`).
- Produces:
  - `class RoomError extends Error { code }` com `code` em `'full' | 'version' | 'closed' | 'taken' | 'not-found' | 'network' | 'timeout'`
  - `Room.host({ network, player, now?, rand?, tuning? }) -> Promise<Room>`; `Room.join({ network, code, player, now?, joinTimeoutMs?, tuning? }) -> Promise<Room>`; `player` é `{ name, char, skin }`
  - Propriedades: `role`, `isHost`, `code`, `selfId`, `hostId` (`'p0'`), `seed`, `players` (`Map id -> { id, name, char, skin }`), `playerList`, `closed`
  - Métodos: `send(msg)` (anfitrião: todos; convidado: o anfitrião), `sendTo(id, msg)` (anfitrião), `tick(nowMs)`, `close()`, `on(name, fn) -> unsubscribe`
  - Eventos: `'players'(list)`, `'message'(msg, fromId)`, `'left'(id, reason)` (anfitrião), `'closed'(reason)` com `reason` em `'host-left' | 'lost' | 'timeout'`

- [ ] **Step 1: Write the failing test**

Create `tests/net-room.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomError } from '../game/net/room.js';
import { MemoryNetwork } from '../game/net/transport.js';
import { encode, decode, NET_TUNING, PROTOCOL_VERSION } from '../game/net/protocol.js';

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

test('silence past the timeout drops a guest (host side) and the host (guest side)', async () => {
  const c = clock();
  const net = new MemoryNetwork();
  const host = await Room.host({ network: net, player: who('Host'), now: c.now, rand: () => .1 });
  const g1 = await Room.join({ network: net, code: host.code, player: who('G1'), now: c.now });
  await flush();
  const left = [];
  host.on('left', (id, why) => left.push([id, why]));
  const closed = [];
  g1.on('closed', why => closed.push(why));
  c.t = NET_TUNING.timeoutMs + 1;
  host.tick(c.t);
  g1.tick(c.t);
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

test('a dropped connection closes the guest with "lost"', async () => {
  const { host, guests: [g1] } = await lobby();
  const reasons = [];
  g1.on('closed', r => reasons.push(r));
  host.peers.get('p1').conn.close();
  await flush();
  assert.deepEqual(reasons, ['lost']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-room.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `game/net/room.js`:

```js
import { encode, decode, NET_TUNING, PROTOCOL_VERSION, NET_BUILD, makeRoomCode } from './protocol.js';
import { NetError } from './transport.js';

// A room is the handshake, the player list and the star topology: guests talk to the
// host, and the host relays poses between guests. It owns no timers (the game calls
// tick() every frame), so it is deterministic under test.

export class RoomError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
const toRoomError = err => (err instanceof RoomError ? err : new RoomError(err instanceof NetError ? err.code : 'network', err?.message));

class Emitter {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    const set = this.handlers.get(name) || new Set();
    set.add(fn); this.handlers.set(name, set);
    return () => set.delete(fn);
  }
  emit(name, ...args) { for (const fn of [...(this.handlers.get(name) || [])]) fn(...args); }
}

const HOST_ID = 'p0';
// What each side is allowed to send. Anything else is dropped on arrival.
const FROM_GUEST = new Set(['pose', 'dmg', 'cool', 'intercept', 'ping', 'pong']);
const FROM_HOST = new Set(['pose', 'world', 'event', 'hit', 'reset', 'join', 'leave', 'ping', 'pong']);

export class Room extends Emitter {
  constructor({ role, code, now, tuning }) {
    super();
    this.role = role; this.code = code; this.now = now; this.tuning = tuning;
    this.selfId = HOST_ID; this.hostId = HOST_ID; this.seed = 0;
    this.players = new Map();
    this.peers = new Map();       // host only: id -> { conn, id, lastSeen }
    this.conn = null;             // guest only: connection to the host
    this.handle = null;           // host only: what network.host() returned
    this.closed = false;
    this.lastSeen = now(); this.lastPing = now();
    this._nextId = 1;
  }

  get isHost() { return this.role === 'host'; }
  get playerList() { return [...this.players.values()]; }

  // --- creating / joining ---------------------------------------------------------
  static async host({ network, player, now = () => performance.now(), rand = Math.random, tuning = NET_TUNING }) {
    let handle = null, code = '';
    for (let attempt = 0; attempt < 6 && !handle; attempt++) {
      code = makeRoomCode(rand, tuning.roomCodeLength);
      try { handle = await network.host(code); }
      catch (err) { if (!(err instanceof NetError && err.code === 'taken')) throw toRoomError(err); }
    }
    if (!handle) throw new RoomError('network', 'Não foi possível reservar um código de sala');
    const room = new Room({ role: 'host', code, now, tuning });
    room.seed = Math.floor(rand() * 2 ** 31);
    room.players.set(HOST_ID, { id: HOST_ID, ...player });
    room.handle = handle;
    handle.onConnection(conn => room._hostAccept(conn));
    return room;
  }

  static async join({ network, code, player, now = () => performance.now(), joinTimeoutMs = 8000, tuning = NET_TUNING }) {
    let conn;
    try { conn = await network.join(code); } catch (err) { throw toRoomError(err); }
    const room = new Room({ role: 'guest', code, now, tuning });
    room.conn = conn;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
      const timer = setTimeout(() => { finish(reject, new RoomError('timeout', 'A sala não respondeu')); conn.close(); }, joinTimeoutMs);
      conn.onMessage(text => {
        const msg = decode(text);
        if (!msg) return;
        room.lastSeen = room.now();
        if (settled) return room._guestReceive(msg);
        if (msg.t === 'reject') { finish(reject, new RoomError(msg.reason)); conn.close(); return; }
        if (msg.t !== 'welcome') return;
        room.selfId = msg.id; room.seed = msg.seed;
        room.players = new Map(msg.players.map(p => [p.id, p]));
        finish(resolve, room);
      });
      conn.onClose(() => { if (!settled) finish(reject, new RoomError('closed')); else room._closeLocal('lost'); });
      room._sendRaw(conn, { t: 'hello', proto: PROTOCOL_VERSION, build: NET_BUILD, ...player });
    });
  }

  // --- host side ------------------------------------------------------------------
  _hostAccept(conn) {
    const entry = { conn, id: null, lastSeen: this.now() };
    conn.onMessage(text => this._hostReceive(entry, text));
    conn.onClose(() => { if (entry.id) this._dropPeer(entry.id, 'lost'); });
  }

  _hostReceive(entry, text) {
    const msg = decode(text);
    if (!msg || this.closed) return;
    entry.lastSeen = this.now();
    if (!entry.id) {
      if (msg.t !== 'hello') return;
      if (msg.proto !== PROTOCOL_VERSION || msg.build !== NET_BUILD) return this._refuse(entry, 'version');
      if (this.players.size >= this.tuning.maxPlayers) return this._refuse(entry, 'full');
      entry.id = `p${this._nextId++}`;
      const player = { id: entry.id, name: msg.name, char: msg.char, skin: msg.skin };
      this.players.set(entry.id, player);
      this.peers.set(entry.id, entry);
      this._sendRaw(entry.conn, { t: 'welcome', id: entry.id, players: this.playerList, seed: this.seed });
      this._broadcast({ t: 'join', player }, entry.id);
      this.emit('players', this.playerList);
      return;
    }
    if (!FROM_GUEST.has(msg.t)) return;
    if (msg.t === 'ping') return this._sendRaw(entry.conn, { t: 'pong', ts: msg.ts });
    if (msg.t === 'pong') return;
    if (msg.t === 'pose') { msg.id = entry.id; this._broadcast(msg, entry.id); }
    this.emit('message', msg, entry.id);
  }

  _refuse(entry, reason) {
    this._sendRaw(entry.conn, { t: 'reject', reason });
    queueMicrotask(() => entry.conn.close());
  }

  _dropPeer(id, reason) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    this.players.delete(id);
    try { entry.conn.close(); } catch { /* already gone */ }
    this._broadcast({ t: 'leave', id });
    this.emit('players', this.playerList);
    this.emit('left', id, reason);
  }

  // --- guest side -----------------------------------------------------------------
  _guestReceive(msg) {
    if (!FROM_HOST.has(msg.t)) return;
    if (msg.t === 'ping') return this._sendRaw(this.conn, { t: 'pong', ts: msg.ts });
    if (msg.t === 'pong') return;
    if (msg.t === 'join') { this.players.set(msg.player.id, msg.player); this.emit('players', this.playerList); return; }
    if (msg.t === 'leave') {
      if (msg.id === this.hostId) return this._closeLocal('host-left');
      this.players.delete(msg.id);
      this.emit('players', this.playerList);
      return;
    }
    this.emit('message', msg, msg.t === 'pose' ? msg.id : this.hostId);
  }

  _closeLocal(reason) {
    if (this.closed) return;
    this.closed = true;
    try { this.conn?.close(); } catch { /* already gone */ }
    this.emit('closed', reason);
  }

  // --- shared ---------------------------------------------------------------------
  _sendRaw(conn, msg) {
    try { conn.send(encode(msg)); }
    catch (err) { console.warn('[net] mensagem descartada:', msg?.t, err?.message); }
  }

  _broadcast(msg, exceptId = null) {
    for (const [id, entry] of this.peers) if (id !== exceptId) this._sendRaw(entry.conn, msg);
  }

  send(msg) {
    if (this.closed) return;
    if (this.isHost) this._broadcast(msg);
    else this._sendRaw(this.conn, msg);
  }

  sendTo(id, msg) {
    if (this.closed || !this.isHost) return;
    const entry = this.peers.get(id);
    if (entry) this._sendRaw(entry.conn, msg);
  }

  tick(now = this.now()) {
    if (this.closed) return;
    const t = this.tuning;
    if (this.isHost) {
      for (const [id, entry] of [...this.peers]) if (now - entry.lastSeen > t.timeoutMs) this._dropPeer(id, 'timeout');
      if (now - this.lastPing >= t.pingMs) { this.lastPing = now; this._broadcast({ t: 'ping', ts: now }); }
    } else {
      if (now - this.lastSeen > t.timeoutMs) return this._closeLocal('timeout');
      if (now - this.lastPing >= t.pingMs) { this.lastPing = now; this._sendRaw(this.conn, { t: 'ping', ts: now }); }
    }
  }

  close() {
    if (this.closed) return;
    if (this.isHost) {
      this._broadcast({ t: 'leave', id: HOST_ID });
      this.closed = true;
      for (const entry of this.peers.values()) queueMicrotask(() => entry.conn.close());
      this.peers.clear();
      this.handle?.close();
    } else {
      this.closed = true;
      this.conn?.close();
    }
  }
}
```

In the "silence" test the guest's pings are sent from `tick`, so after `c.t = timeoutMs + 1` neither side has heard anything since time 0 and both drop.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-room.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add game/net/room.js tests/net-room.test.js
git commit -m "feat(net): room handshake, player list, pose relay and timeouts"
```

---

### Task 5: Sessão de rede (`net-session.js`)

**Files:**
- Create: `game/net/net-session.js`
- Test: `tests/net-session.test.js`

**Interfaces:**
- Consumes: `Room` (Task 4), `SnapshotBuffer` (Task 2), `NET_TUNING` (Task 1). Um objeto `game` com estes callbacks (os que não se aplicam ao papel nunca são chamados):
  - Sempre: `getLocalPose() -> { char, skin, p:[x,y,z], q:[x,y,z,w], clip, hp, dead }`
  - Anfitrião: `getBossState() -> boss` (formato `bossState` do protocolo), `getFireSnapshot() -> [[id, intensity]]`, `applyRemoteDamage({ amount, label, kb, src, from })`, `applyCool(msg)`, `applyIntercept(msg)`
  - Convidado: `applyBossState(boss)`, `applyFireSnapshot(list)`, `handleWorldEvent(kind, data)`, `applyHit({ amount, dir })`, `resetMission()`
  - Opcionais: `onPlayers(list)`, `onPlayerJoined(id)` (anfitrião), `onClosed(reason)`
- Produces: `class NetSession({ room, game, now? })` com
  - `isHost`, `isGuest`, `active`, `closeReason`, `selfId`, `code`, `playerCount`, `players`
  - `update(nowMs?)`
  - `remotes(nowMs?) -> [{ id, name, char, skin, pose:{x,y,z,q}, clip, hp, dead }]`, `remoteLatest() -> [{ id, x, y, z, dead }]`
  - Convidado → anfitrião: `sendDamage({ amount, label, kb, src:[x,y,z] })`, `sendCool(params)` (junta e limita a 10 por segundo), `sendIntercept(params)`
  - Anfitrião → convidados: `broadcastEvent(kind, data)`, `sendEventTo(id, kind, data)`, `sendHit(id, amount, dir:[x,y,z])`, `broadcastReset()`
  - `leave()`

- [ ] **Step 1: Write the failing test**

Create `tests/net-session.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-session.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `game/net/net-session.js`:

```js
import { SnapshotBuffer } from './interpolation.js';
import { NET_TUNING } from './protocol.js';

// Game-facing half of the net layer. It decides *when* to send, routes what arrives
// to the `game` callbacks, and keeps interpolation buffers for the other players.
// It never touches three.js or the DOM.

const COOL_EVERY_MS = 100;

export class NetSession {
  constructor({ room, game, now = () => performance.now() }) {
    this.room = room; this.game = game; this.now = now;
    this.buffers = new Map();     // player id -> SnapshotBuffer
    this.meta = new Map();        // player id -> { char, skin, clip, hp, dead }
    this.lastPose = -Infinity; this.lastWorld = -Infinity; this.lastCool = -Infinity;
    this.cool = null;
    this.active = true; this.closeReason = '';
    this._known = new Set(room.players.keys());
    room.on('message', (msg, from) => this._onMessage(msg, from));
    room.on('players', list => this._onPlayers(list));
    room.on('closed', reason => { this.active = false; this.closeReason = reason; this.game.onClosed?.(reason); });
    if (this.isHost) for (const id of this._known) if (id !== room.selfId) this.game.onPlayerJoined?.(id);
  }

  get isHost() { return this.room.isHost; }
  get isGuest() { return !this.room.isHost; }
  get selfId() { return this.room.selfId; }
  get code() { return this.room.code; }
  get players() { return this.room.playerList; }
  get playerCount() { return this.room.players.size; }

  update(now = this.now()) {
    if (!this.active) return;
    this.room.tick(now);
    if (!this.active) return;
    if (now - this.lastPose >= 1000 / NET_TUNING.poseHz) {
      this.lastPose = now;
      this.room.send({ t: 'pose', id: this.room.selfId, ...this.game.getLocalPose() });
    }
    if (this.isHost && now - this.lastWorld >= 1000 / NET_TUNING.worldHz) {
      this.lastWorld = now;
      this.room.send({ t: 'world', boss: this.game.getBossState(), fires: this.game.getFireSnapshot() });
    }
    if (this.isGuest && this.cool && now - this.lastCool >= COOL_EVERY_MS) {
      this.lastCool = now;
      this.room.send({ t: 'cool', ...this.cool });
      this.cool = null;
    }
  }

  // --- incoming -------------------------------------------------------------------
  _onMessage(msg, from) {
    const game = this.game;
    switch (msg.t) {
      case 'pose': this._onPose(msg); break;
      case 'world': if (this.isGuest) { game.applyBossState(msg.boss); game.applyFireSnapshot(msg.fires); } break;
      case 'event': if (this.isGuest) game.handleWorldEvent(msg.kind, msg.data); break;
      case 'hit': if (this.isGuest) game.applyHit(msg); break;
      case 'reset': if (this.isGuest) game.resetMission(); break;
      case 'dmg': if (this.isHost) game.applyRemoteDamage({ ...msg, from }); break;
      case 'cool': if (this.isHost) game.applyCool(msg); break;
      case 'intercept': if (this.isHost) game.applyIntercept(msg); break;
      default: break;
    }
  }

  _onPose(msg) {
    if (msg.id === this.room.selfId) return;
    let buffer = this.buffers.get(msg.id);
    if (!buffer) this.buffers.set(msg.id, buffer = new SnapshotBuffer());
    buffer.push(this.now(), { x: msg.p[0], y: msg.p[1], z: msg.p[2], q: msg.q });
    this.meta.set(msg.id, { char: msg.char, skin: msg.skin, clip: msg.clip, hp: msg.hp, dead: msg.dead });
  }

  _onPlayers(list) {
    const ids = new Set(list.map(p => p.id));
    for (const id of this._known) if (!ids.has(id)) { this.buffers.delete(id); this.meta.delete(id); }
    for (const id of ids) if (!this._known.has(id) && this.isHost && id !== this.room.selfId) this.game.onPlayerJoined?.(id);
    this._known = ids;
    this.game.onPlayers?.(list);
  }

  // --- what the game reads each frame ------------------------------------------------
  remotes(now = this.now()) {
    const out = [];
    for (const player of this.room.playerList) {
      if (player.id === this.room.selfId) continue;
      const pose = this.buffers.get(player.id)?.sample(now);
      if (!pose) continue;
      const meta = this.meta.get(player.id) || {};
      out.push({
        id: player.id, name: player.name, char: meta.char || player.char, skin: meta.skin || player.skin,
        pose, clip: meta.clip || '', hp: meta.hp ?? 100, dead: !!meta.dead
      });
    }
    return out;
  }

  /** Newest known position of each remote player (no interpolation delay): used for AI targeting. */
  remoteLatest() {
    const out = [];
    for (const player of this.room.playerList) {
      if (player.id === this.room.selfId) continue;
      const s = this.buffers.get(player.id)?.latest();
      if (s) out.push({ id: player.id, x: s.x, y: s.y, z: s.z, dead: !!this.meta.get(player.id)?.dead });
    }
    return out;
  }

  // --- guest -> host ----------------------------------------------------------------
  sendDamage({ amount, label = '', kb = 0, src }) {
    if (this.isGuest) this.room.send({ t: 'dmg', amount, label, kb, src });
  }

  /** Cooling happens every frame; merge it into one request per 100 ms with the summed dt. */
  sendCool(params) {
    if (!this.isGuest) return;
    if (this.cool && this.cool.shape === params.shape) this.cool = { ...params, dt: Math.min(.5, this.cool.dt + params.dt) };
    else this.cool = { ...params };
  }

  sendIntercept(params) {
    if (this.isGuest) this.room.send({ t: 'intercept', ...params });
  }

  // --- host -> guests ---------------------------------------------------------------
  broadcastEvent(kind, data) { if (this.isHost) this.room.send({ t: 'event', kind, data }); }
  sendEventTo(id, kind, data) { if (this.isHost) this.room.sendTo(id, { t: 'event', kind, data }); }
  sendHit(id, amount, dir) { if (this.isHost) this.room.sendTo(id, { t: 'hit', amount, dir }); }
  broadcastReset() { if (this.isHost) this.room.send({ t: 'reset' }); }

  leave() { this.room.close(); this.active = false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-session.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add game/net/net-session.js tests/net-session.test.js
git commit -m "feat(net): net session routing, throttled requests and remote pose buffers"
```

---

### Task 6: Suporte a espelho nos eventos e no fogo

**Files:**
- Modify: `game/events/dynamic-event-system.js`
- Modify: `game/fire/fire-system.js`
- Test: `tests/net-mirror-support.test.js`

**Interfaces:**
- Consumes: `DynamicEventSystem`, `MeteorEvent`, `FireSystem` existentes.
- Produces:
  - `DynamicEventSystem#setMirror(on: boolean)`: com `true`, `update()` continua avançando os eventos adotados mas **nunca** sorteia eventos automáticos; `DynamicEventSystem#mirror` guarda o modo
  - `DynamicEventSystem#adopt(event) -> event`: insere um evento criado de fora (descritor do anfitrião), sem duplicar
  - `FireSystem#getSnapshot() -> [[id, intensity]]` dos focos ativos (intensidade com 2 casas)
  - `FireSystem#syncFromSnapshot(list)`: no convidado, apaga focos ativos que o anfitrião não lista e baixa a intensidade para o valor do anfitrião quando for menor (nunca sobe)

- [ ] **Step 1: Write the failing test**

Create `tests/net-mirror-support.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicEventSystem } from '../game/events/dynamic-event-system.js';
import { MeteorEvent } from '../game/events/meteor-event.js';
import { FireSystem } from '../game/fire/fire-system.js';

const meteor = (id = 'meteor-1') => new MeteorEvent({
  id, impactPoint: { x: 0, y: 0, z: 0 }, startPosition: { x: 0, y: 100, z: 0 }, warningSeconds: 1, fallSeconds: 2, fireCount: 3
});

test('mirror mode never auto-spawns, but adopted events keep advancing and emitting commands', () => {
  let spawned = 0;
  const sys = new DynamicEventSystem({
    rng: () => 0, tuning: { initialCalm: [0, 0], buildingFireWindow: [0, 0], meteorWindow: [0, 0] },
    factories: { meteor: () => { spawned++; return null; }, buildingFire: () => { spawned++; return null; } }
  });
  sys.setMirror(true);
  sys.adopt(meteor());
  const commands = [];
  for (let i = 0; i < 40; i++) commands.push(...sys.update(.1, { remainingFires: () => 0 }));
  assert.equal(spawned, 0);
  assert.deepEqual(commands.map(c => c.type), ['meteor-impact', 'meteor-resolved']);
  sys.setMirror(false);
  sys.update(1, {});
  assert.ok(spawned > 0, 'normal scheduling resumes when mirror mode is off');
});

test('adopt ignores duplicates and survives reset()', () => {
  const sys = new DynamicEventSystem({ factories: {} });
  const m = meteor();
  assert.equal(sys.adopt(m), m);
  sys.adopt(m);
  assert.equal(sys.getActiveEvents().length, 1);
  sys.setMirror(true);
  sys.reset();
  assert.equal(sys.getActiveEvents().length, 0);
  assert.equal(sys.mirror, true, 'mirror flag is a mode, not part of the world state');
});

const spot = (id, intensity = 1, eventId = 'e1') => ({ id, eventId, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, radius: 2, intensity });

test('getSnapshot lists active spots with rounded intensity', () => {
  const fire = new FireSystem();
  fire.addSpots([spot('a', .456), spot('b', 1)]);
  assert.deepEqual(fire.getSnapshot(), [['a', .46], ['b', 1]]);
});

test('syncFromSnapshot follows the host: extinguishes missing spots, only ever lowers intensity', () => {
  const fire = new FireSystem();
  fire.addSpots([spot('a', 1), spot('b', .4), spot('c', 1)]);
  fire.syncFromSnapshot([['a', .6], ['b', .9]]);          // c is gone; b host value is higher -> keep local .4
  assert.equal(fire.getSpot('a').intensity, .6);
  assert.equal(fire.getSpot('a').state, 'cooling');
  assert.equal(fire.getSpot('b').intensity, .4);
  assert.equal(fire.getSpot('c').state, 'extinguished');
  assert.equal(fire.countByEvent('e1'), 2);
  fire.syncFromSnapshot([['a', 0]]);
  assert.equal(fire.getSpot('a').state, 'extinguished');
  assert.equal(fire.getSpot('b').state, 'extinguished');
  fire.syncFromSnapshot([['ghost', .5]]);                  // unknown ids are ignored, not created
  assert.equal(fire.getSpot('ghost'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-mirror-support.test.js`
Expected: FAIL — `sys.setMirror is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `game/events/dynamic-event-system.js`:

Constructor — replace
```js
    this.events=[];
    this.pauseReasons=new Set();
    this._resetClocks();
```
with
```js
    this.events=[];
    this.pauseReasons=new Set();
    this.mirror=false;
    this._resetClocks();
```

Add after `getSnapshots(){...}`:
```js
  // Online guests: the host decides what happens. Mirror mode keeps adopted events
  // advancing but never rolls new ones.
  setMirror(on){this.mirror=!!on;}
  adopt(event){
    if(event && !this.events.includes(event)) this.events.push(event);
    return event;
  }
```

In `update`, immediately before `if(this.calmRemaining>0) {`, insert:
```js
    if(this.mirror) return commands;
```

In `game/fire/fire-system.js`, add after `remainingCapacity() { ... }`:
```js
  // Active spots as [id, intensity]: what the online host broadcasts.
  getSnapshot() {
    return this.getActiveSpots().map(s => [s.id, Math.round(s.intensity * 100) / 100]);
  }

  // Online guest: follow the host. Spots the host no longer lists are out; intensity
  // only ever goes down (a local cooling that is ahead of the host stays ahead).
  syncFromSnapshot(list = []) {
    const host = new Map(list.map(([id, value]) => [String(id), clamp01(value)]));
    for (const spot of this.getActiveSpots()) {
      const value = host.get(spot.id);
      if (value === undefined || value <= 1e-6) {
        spot.intensity = 0; spot.state = 'extinguished'; spot.coolingTimer = 0;
      } else if (value < spot.intensity) {
        spot.intensity = value; spot.state = 'cooling'; spot.coolingTimer = this.tuning.coolingStateSeconds;
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/net-mirror-support.test.js tests/dynamic-event-system.test.js tests/fire-system.test.js`
Expected: PASS (new and existing).

- [ ] **Step 5: Commit**

```bash
git add game/events/dynamic-event-system.js game/fire/fire-system.js tests/net-mirror-support.test.js
git commit -m "feat(net): mirror mode for events and fire snapshot sync"
```
