# Co-op online contra o Jason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que 2 a 4 jogadores joguem juntos na mesma cidade, cada um com seu herói e skin, contra o mesmo Jason e os mesmos meteoros e incêndios, via sala P2P com código de 4 letras, publicável no GitHub Pages.

**Architecture:** Topologia em estrela WebRTC (PeerJS) em que o **anfitrião** simula o Jason, os eventos e o fogo e os convidados espelham esse estado; cada jogador manda no próprio herói e envia a pose cerca de 15 vezes por segundo. A rede vive em módulos novos e puros em `game/net/` (protocolo, interpolação, regras, transporte, sala, sessão) testados com um transporte em memória; `main.js` ganha só ganchos finos condicionados a `netSession?.…`, então o modo solo continua idêntico.

**Tech Stack:** JavaScript ES modules (sem build), three.js 0.186 já embarcado, PeerJS 1.5.4 embarcado em `vendor/peerjs/`, `node --test` para testes, GitHub Actions para publicar no Pages.

**Spec:** `docs/superpowers/specs/2026-10-13-online-coop-design.md`

## Deviations from the spec (decididas ao planejar, depois de ler o código)

1. **Build do handshake:** o `build` é a constante `NET_BUILD` em `game/net/protocol.js`, que se incrementa à mão quando o protocolo muda. O hash do pré-cache do PWA só é conhecido depois que o service worker responde, tarde demais para o `hello`.
2. **Pose com quaternion:** o `pose` leva `q` (quaternion) em vez de só `y` (yaw), porque o Superman voa com inclinação e rolagem (`hero.quaternion`). O Jason continua com yaw.
3. **Pausa online:** o jogo congela o mundo ao pausar. Online, o loop de rede e o espelho continuam rodando durante a pausa; só o mundo simulado do **anfitrião** congela enquanto ele está no menu (limitação documentada na Task 13).
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

1. **Mensagem hostil ou gigante** (JSON inválido, `__proto__`, números `NaN`/`Infinity`, string de 1 MB, dano 1e9) e **convidado que inunda o anfitrião**: nunca lança, nunca chega ao jogo, dano é limitado e o excesso de mensagens por segundo é descartado → Tasks 1 e 4.
2. **Pacotes atrasados, duplicados ou fora de ordem** e buracos longos sem pose: a interpolação não pula para trás e a extrapolação é limitada → Task 2.
3. **Quinto jogador, código digitado errado (minúsculas, espaços, letras ambíguas) e sala inexistente**: mensagens claras, nenhum estado preso em "conectando" → Tasks 1, 4 e 8.
4. **Convidado sai (ou cai) enquanto o Jason o persegue**: o Jason escolhe outro alvo ou fica parado, nunca persegue um jogador que não existe mais → Tasks 2, 5 e 10.
5. **Anfitrião sai com o menu aberto / convidado entra no meio de um meteoro e de incêndios**: a sala volta ao solo sem travar e o recém-chegado recebe o mundo atual → Tasks 4, 11 e 12.
6. **Solo intacto:** com `netSession === null` todos os ganchos são no-ops → Task 12 (teste de contrato em `main.js`).

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
| `main.js` | modificar | Ganchos finos e a seção `V21 ONLINE CO-OP` (Tasks 10–12) |
| `index.html`, `style.css` | modificar | Script do PeerJS, estilos da aba Online |
| `tools/vendor-peerjs.mjs`, `package.json` | criar/modificar | Embarcar o PeerJS, scripts de checagem |
| `tools/build-site.mjs`, `.github/workflows/pages.yml` | criar | Montar `_site/` e publicar no GitHub Pages (Task 13) |
| `tests/net-*.test.js`, `tests/build-site.test.js` | criar | Um arquivo de teste por módulo; `net-main-wiring.test.js` fixa os ganchos do `main.js` |

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
          const wrapped = wrapConn(conn);            // listen for data right away: nothing is lost before 'open'
          conn.on('open', () => { if (handler) handler(wrapped); else pending.push(wrapped); });
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
          const wrapped = wrapConn(conn);            // listen for data right away: nothing is lost before 'open'
          const close = wrapped.close;
          wrapped.close = () => { close(); peer.destroy(); };
          conn.on('open', () => {
            if (settled) return;
            settled = true; clearTimeout(timer);
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
    const entry = { conn, id: null, lastSeen: this.now(), windowAt: this.now(), count: 0 };
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
    // A guest cannot flood the host: whatever exceeds the per-second budget is dropped.
    const now = this.now();
    if (now - entry.windowAt >= 1000) { entry.windowAt = now; entry.count = 0; }
    if (++entry.count > this.tuning.maxMessagesPerSecond) return;
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

---

### Task 7: Embarcar o PeerJS

**Files:**
- Create: `tools/vendor-peerjs.mjs`, `vendor/peerjs/peerjs.min.js`, `vendor/peerjs/LICENSE`, `vendor/peerjs/VERSION` (gerados pelo script)
- Modify: `index.html`, `package.json`, `pwa-manifest.json` e `sw.js` (regenerados por `npm run pwa`)
- Test: `tests/net-vendor.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: o global `window.Peer` (carregado por script clássico antes do `main.js`), usado por `createPeerNetwork()` (Task 3); script `npm run vendor:peerjs`.

- [ ] **Step 1: Write the failing test**

Create `tests/net-vendor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildManifest } from '../tools/build-pwa.mjs';

const file = rel => new URL(`../${rel}`, import.meta.url);
const read = rel => fs.readFileSync(file(rel), 'utf8');

test('PeerJS is vendored, loaded before main.js and precached for offline play', async () => {
  assert.ok(fs.existsSync(file('vendor/peerjs/peerjs.min.js')), 'run npm run vendor:peerjs');
  assert.ok(fs.statSync(file('vendor/peerjs/peerjs.min.js')).size > 50_000);
  assert.match(read('vendor/peerjs/VERSION'), /^\d+\.\d+\.\d+/);
  assert.ok(fs.existsSync(file('vendor/peerjs/LICENSE')));
  const html = read('index.html');
  const peerAt = html.indexOf('./vendor/peerjs/peerjs.min.js');
  const mainAt = html.indexOf('./main.js');
  assert.ok(peerAt > 0 && peerAt < mainAt, 'index.html loads peerjs.min.js before main.js');
  assert.ok(!/<script[^>]+peerjs\.min\.js[^>]+type="module"/.test(html), 'it is a classic script (it defines the global Peer)');
  const { core } = await buildManifest();
  assert.ok(core.includes('./vendor/peerjs/peerjs.min.js'), 'service worker precaches it');
});

test('the vendor script targets a pinned version', () => {
  const script = read('tools/vendor-peerjs.mjs');
  assert.match(script, /process\.argv\[2\] \|\| '\d+\.\d+\.\d+'/);
  assert.match(read('package.json'), /"vendor:peerjs": "node tools\/vendor-peerjs\.mjs"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-vendor.test.js`
Expected: FAIL — `run npm run vendor:peerjs`.

- [ ] **Step 3: Write minimal implementation**

Create `tools/vendor-peerjs.mjs`:

```js
#!/usr/bin/env node
// Copies the PeerJS browser bundle from jsDelivr into vendor/peerjs/ so the game (and
// its offline cache) never depends on a CDN at play time.
//   node tools/vendor-peerjs.mjs            # pinned version below
//   node tools/vendor-peerjs.mjs 1.5.4
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv[2] || '1.5.4';
const BASE = `https://cdn.jsdelivr.net/npm/peerjs@${VERSION}/`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'peerjs');
const FILES = [['dist/peerjs.min.js', 'peerjs.min.js'], ['LICENSE', 'LICENSE']];

await fs.mkdir(OUT, { recursive: true });
for (const [remote, local] of FILES) {
  const res = await fetch(BASE + remote);
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`);
  await fs.writeFile(path.join(OUT, local), Buffer.from(await res.arrayBuffer()));
}
await fs.writeFile(path.join(OUT, 'VERSION'), `${VERSION}\n`);
console.log(`peerjs ${VERSION} -> vendor/peerjs/`);
```

In `package.json`, add to `"scripts"` the line `"vendor:peerjs": "node tools/vendor-peerjs.mjs",` (next to `"vendor"`), and extend `"check"` so it also runs, appended before `&& node --check sw.js`:
`node --check tools/vendor-peerjs.mjs && node --check game/net/protocol.js && node --check game/net/interpolation.js && node --check game/net/rules.js && node --check game/net/transport.js && node --check game/net/room.js && node --check game/net/net-session.js && node --check game/net/remote-clips.js && node --check game/net/remote-hero.js && node --check game/ui/online-panel.js`

In `index.html`, add immediately before `<script src="./pwa.js" defer></script>`:
```html
  <script src="./vendor/peerjs/peerjs.min.js"></script>
```

Then run (needs network once):
```bash
npm run vendor:peerjs
npm run pwa
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-vendor.test.js tests/pwa.test.js`
Expected: PASS (the PWA staleness test passes because `npm run pwa` regenerated the manifest and `sw.js`).

- [ ] **Step 5: Commit**

```bash
git add tools/vendor-peerjs.mjs vendor/peerjs index.html package.json pwa-manifest.json sw.js tests/net-vendor.test.js
git commit -m "feat(net): vendor PeerJS and precache it for offline play"
```

---

### Task 8: Aba Online, minimapa e textos de erro

**Files:**
- Create: `game/ui/online-panel.js`
- Modify: `game/ui/pause-menu.js`, `game/ui/game-map.js`, `style.css`
- Test: `tests/net-online-ui.test.js`

**Interfaces:**
- Consumes: `normalizeRoomCode`, `NET_TUNING` (Task 1); `getCharacter`, `getSkin` do registry.
- Produces:
  - `ERROR_TEXT`, `describeNetError(code) -> string` (qualquer código desconhecido cai na mensagem de rede)
  - `cleanPlayerName(text) -> string` (sem controles, aparado, no máximo 16 caracteres; pode ser `''`)
  - `validateJoinInput(text) -> { ok: boolean, code: string, error: string }`
  - `describePlayer(player) -> string` (`"Ana · Superman (Armadura (MultiVersus))"`)
  - `createOnlinePanel({ getState, getName, setName, onCreate, onJoin, onLeave }) -> { element, sync() }`, onde `getState() -> { status: 'idle'|'busy'|'connected', code, isHost, players:[{ id, name, char, skin, self, isHost }], error }`; `onCreate()`, `onJoin(code)`, `onLeave()`
  - `createPauseMenu({ …, onlinePanel })`: com `onlinePanel` presente, aparece a aba **Online** (`'online'`)
  - `state.peers: [{ x, z, name }]` aceito por `GameMap` (ponto verde no minimapa e no mapa grande)

- [ ] **Step 1: Write the failing test**

Create `tests/net-online-ui.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describeNetError, ERROR_TEXT, cleanPlayerName, validateJoinInput, describePlayer } from '../game/ui/online-panel.js';
import { GameMap } from '../game/ui/game-map.js';

test('every failure the net layer can raise has a Portuguese message', () => {
  for (const code of ['full', 'version', 'closed', 'taken', 'not-found', 'network', 'timeout', 'lost', 'host-left']) {
    assert.ok(ERROR_TEXT[code] && /[a-zà-ú]/i.test(ERROR_TEXT[code]), code);
  }
  assert.equal(describeNetError('something-new'), ERROR_TEXT.network);
  assert.equal(describeNetError(undefined), ERROR_TEXT.network);
});

test('player names are cleaned and capped', () => {
  assert.equal(cleanPlayerName('  Ana  '), 'Ana');
  assert.equal(cleanPlayerName('A\u0007b\u0000c'), 'Abc');
  assert.equal(cleanPlayerName('x'.repeat(40)).length, 16);
  assert.equal(cleanPlayerName(null), '');
});

test('join input accepts messy codes and explains bad ones', () => {
  assert.deepEqual(validateJoinInput(' ab cd '), { ok: true, code: 'ABCD', error: '' });
  for (const text of ['', 'abc', 'abcde', 'ab0d', 'ab-']) {
    const r = validateJoinInput(text);
    assert.equal(r.ok, false, text);
    assert.match(r.error, /código/i);
  }
});

test('describePlayer names the hero and the skin', () => {
  assert.equal(describePlayer({ name: 'Ana', char: 'superman', skin: 'armor' }), 'Ana · Superman (Armadura (MultiVersus))');
  assert.equal(describePlayer({ name: 'Bia', char: 'flash', skin: 'classic' }), 'Bia · The Flash (Clássico)');
});

test('the pause menu shows the Online tab only when a panel is supplied', () => {
  const menu = fs.readFileSync(new URL('../game/ui/pause-menu.js', import.meta.url), 'utf8');
  assert.match(menu, /\['online', 'Online'\]/);
  assert.match(menu, /onlinePanel = null/);
  assert.match(menu, /onlinePanel \? TABS : TABS\.filter/);
});

test('the map draws other players as green dots with names on the big map', () => {
  const calls = { arc: 0, fills: [], texts: [] };
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'arc') return () => { calls.arc++; };
      if (k === 'fillText' || k === 'strokeText') return (text) => { calls.texts.push(text); };
      return k in t ? t[k] : () => {};
    },
    set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') calls.fills.push(v); return true; }
  });
  const state = { rings: [], fires: [], meteors: [], enemy: null, peers: [{ x: 10, z: 20, name: 'Bia' }, { x: -5, z: 3, name: 'Caio' }] };
  const place = (x, z) => ({ x, y: z, clamped: false, angle: 0 });
  GameMap.prototype._markers.call({}, ctx, state, place, 6, true);
  assert.equal(calls.arc, 2);
  assert.ok(calls.fills.includes('#3ee08a'));
  assert.ok(calls.texts.includes('Bia') && calls.texts.includes('Caio'));
  calls.arc = 0;
  GameMap.prototype._markers.call({}, ctx, { ...state, peers: undefined }, place, 6, true);   // solo state has no peers
  assert.equal(calls.arc, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-online-ui.test.js`
Expected: FAIL — module `online-panel.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `game/ui/online-panel.js`:

```js
import { normalizeRoomCode, NET_TUNING } from '../net/protocol.js';
import { getCharacter, getSkin } from '../characters/registry.js';

// The "Online" tab of the pause menu: pure DOM, no game logic. The game supplies the
// current state and the callbacks.

export const ERROR_TEXT = {
  full: 'A sala está cheia (máximo de 4 jogadores).',
  version: 'Esta sala usa outra versão do jogo. Recarregue a página e tente de novo.',
  closed: 'A sala foi encerrada.',
  taken: 'Esse código já está em uso. Tente criar a sala de novo.',
  'not-found': 'Sala não encontrada. Confira o código.',
  network: 'Não foi possível conectar. Sua rede pode bloquear conexões diretas entre jogadores.',
  timeout: 'A sala não respondeu a tempo.',
  lost: 'A conexão com a sala foi perdida.',
  'host-left': 'O anfitrião saiu: a sala foi encerrada.'
};
export const describeNetError = code => ERROR_TEXT[code] || ERROR_TEXT.network;

export function cleanPlayerName(text) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NET_TUNING.maxNameLength);
}

export function validateJoinInput(text) {
  const code = normalizeRoomCode(text);
  return code
    ? { ok: true, code, error: '' }
    : { ok: false, code: '', error: `Código inválido: são ${NET_TUNING.roomCodeLength} letras ou números (sem I, L, O, 0 e 1).` };
}

export function describePlayer(player) {
  return `${player.name} · ${getCharacter(player.char).name} (${getSkin(player.char, player.skin).name})`;
}

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

export function createOnlinePanel({ getState, getName, setName, onCreate, onJoin, onLeave }) {
  const nameInput = h('input', { type: 'text', class: 'pm-input', maxlength: String(NET_TUNING.maxNameLength), placeholder: 'Seu nome', 'aria-label': 'Seu nome', autocomplete: 'off' });
  nameInput.addEventListener('change', () => { setName(cleanPlayerName(nameInput.value)); sync(); });
  const codeInput = h('input', { type: 'text', class: 'pm-input pm-code-input', maxlength: '8', placeholder: 'CÓDIGO', 'aria-label': 'Código da sala', autocomplete: 'off', autocapitalize: 'characters' });
  const message = h('p', { class: 'pm-hint' });
  const body = h('div', { class: 'pm-online-body' });
  const element = h('div', { class: 'pm-panel', 'data-tab': 'online' }, [
    h('div', { class: 'pm-online-name' }, [h('label', { text: 'Seu nome' }), nameInput]), body, message
  ]);
  let localError = '';

  function join() {
    const result = validateJoinInput(codeInput.value);
    localError = result.error;
    if (!result.ok) return sync();
    onJoin(result.code);
  }

  function sync() {
    const state = getState();
    if (document.activeElement !== nameInput) nameInput.value = getName();
    const connected = state.status === 'connected';
    const busy = state.status === 'busy';
    nameInput.disabled = connected || busy;
    if (connected) {
      const copy = h('button', { type: 'button', class: 'pm-secondary', text: 'Copiar código' });
      copy.addEventListener('click', () => { navigator.clipboard?.writeText(state.code).catch(() => {}); copy.textContent = 'Copiado!'; });
      body.replaceChildren(
        h('div', { class: 'pm-room' }, [
          h('small', { text: state.isHost ? 'Você é o anfitrião · passe o código aos amigos' : 'Conectado à sala' }),
          h('strong', { class: 'pm-room-code', text: state.code }),
          copy
        ]),
        h('ul', { class: 'pm-players' }, state.players.map(p => h('li', { class: p.self ? 'self' : '' }, [
          h('span', { text: describePlayer(p) }),
          p.isHost ? h('em', { text: 'anfitrião' }) : null,
          p.self ? h('em', { text: 'você' }) : null
        ]))),
        h('button', { type: 'button', class: 'pm-secondary', text: 'Sair da sala', onclick: () => onLeave() })
      );
      message.textContent = state.isHost ? 'Se você sair, a sala é encerrada para todos.' : 'Se o anfitrião sair, a sala é encerrada.';
      message.classList.remove('pm-error');
      return;
    }
    const create = h('button', { type: 'button', class: 'pm-primary', text: busy ? 'Conectando…' : 'Criar sala', onclick: () => { localError = ''; onCreate(); } });
    const enter = h('button', { type: 'button', class: 'pm-secondary', text: 'Entrar', onclick: join });
    create.disabled = enter.disabled = codeInput.disabled = busy;
    body.replaceChildren(
      h('div', { class: 'pm-online-row' }, [create]),
      h('div', { class: 'pm-online-row' }, [codeInput, enter])
    );
    const error = localError || state.error;
    message.textContent = error || 'Jogue com até 3 amigos contra o mesmo Jason. Um de vocês cria a sala e passa o código.';
    message.classList.toggle('pm-error', !!error);
  }

  codeInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') join(); });
  nameInput.addEventListener('keydown', e => e.stopPropagation());
  return { element, sync };
}
```

In `game/ui/pause-menu.js`:
1. Replace the `TABS` line with
```js
const TABS = [['game', 'Jogo'], ['character', 'Personagem'], ['online', 'Online'], ['graphics', 'Gráficos'], ['map', 'Mapa'], ['controls', 'Controles']];
```
2. In the `createPauseMenu({ … })` destructuring, after `getSkinIds = () => ({}), onSelectSkin = () => {}` add `, onlinePanel = null`.
3. In the "shell" section, replace `for (const [id, text] of TABS) {` with
```js
  const tabs = onlinePanel ? TABS : TABS.filter(([id]) => id !== 'online');
  for (const [id, text] of tabs) {
```
and replace `for (const panel of [gamePanel, characterPanel, graphicsPanel, mapPanel, controlsPanel]) panels.set(panel.dataset.tab, panel);` with
```js
  for (const panel of [gamePanel, characterPanel, onlinePanel?.element, graphicsPanel, mapPanel, controlsPanel]) if (panel) panels.set(panel.dataset.tab, panel);
```
4. In `show(id)` add `if (id === 'online') onlinePanel?.sync();` after the `controls` line. In the returned object: in `tick()` add before the closing brace
```js
      if (tab === 'online' && onlinePanel && performance.now() - lastOnline > 400) { lastOnline = performance.now(); onlinePanel.sync(); }
```
and declare `let lastOnline = 0;` next to `let lastStatus = 0;`. In `refresh()` add `if (tab === 'online') onlinePanel?.sync();`.

In `game/ui/game-map.js`: add `peer: '#3ee08a'` to `COLORS`, update the `state = {…}` comment to mention `peers:[{x,z,name}]`, and at the end of `_markers` (after the `if (state.enemy) { … }` block, inside the method) add:
```js
    for (const peer of state.peers || []) {
      const p = place(peer.x, peer.z);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.05, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.peer; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      if (labelled) label(ctx, p.x, p.y - r * 2, peer.name);
    }
```
(The test imports `GameMap`; if the class is not exported by that name, export it — `grep -n "class GameMap" game/ui/game-map.js` shows the declaration.)

Append to `style.css`:
```css
/* Online tab */
.pm-online-name { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.pm-online-name label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #7f93b5; }
.pm-input { flex: 1; min-width: 0; padding: 10px 12px; font: 600 14px/1.2 Inter, system-ui, sans-serif; color: #fff; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.2); border-radius: 10px; }
.pm-code-input { text-transform: uppercase; letter-spacing: .3em; text-align: center; font-size: 18px; }
.pm-online-body { display: grid; gap: 12px; }
.pm-online-row { display: flex; gap: 10px; }
.pm-online-row button { flex: none; padding: 10px 18px; }
.pm-room { display: grid; gap: 6px; justify-items: center; padding: 16px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14); }
.pm-room small { color: #9fb3d8; font-size: 12px; }
.pm-room-code { font-size: 44px; letter-spacing: .35em; padding-left: .35em; color: #fff; text-shadow: 0 0 22px rgba(80,160,255,.55); }
.pm-players { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pm-players li { display: flex; gap: 8px; align-items: baseline; padding: 8px 12px; border-radius: 10px; background: rgba(255,255,255,.05); font-size: 13px; }
.pm-players li.self { border: 1px solid rgba(80,160,255,.55); }
.pm-players em { margin-left: auto; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #7f93b5; font-style: normal; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-online-ui.test.js tests/settings-and-map.test.js tests/flash-character.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/ui/online-panel.js game/ui/pause-menu.js game/ui/game-map.js style.css tests/net-online-ui.test.js
git commit -m "feat(net): Online tab, error messages and peers on the minimap"
```

---

### Task 9: Heróis remotos (`remote-hero.js`)

**Files:**
- Create: `game/net/remote-clips.js` (puro, sem three.js, para poder ser testado em Node), `game/net/remote-hero.js`
- Modify: `game/characters/registry.js`
- Test: `tests/net-remote-hero.test.js`

**Interfaces:**
- Consumes: `getCharacter`, `getSkin` do registry (agora com `model: { height, yaw }`); `prepareFlashClips` de `game/characters/flash-controller.js`; `remapVerticalTracks`, `heroClipVerticalMode` de `hero-motion.js`; `SkeletonUtils.clone`.
- Produces:
  - Em `remote-clips.js` (puro): `FALLBACK_CLIP`, `resolveClipName(available: Map|Set, wanted, fallback) -> string`, `clipPlaysOnce(name) -> boolean`
  - `class RemoteHeroes({ scene, loadGltf })`, onde `loadGltf(url) -> Promise<gltf>` devolve um glTF já preparado para a cena (sombras, etc.), com cache feito por quem chama
    - `update(dt, remotes)` (`remotes` = saída de `NetSession#remotes()`), `positions() -> [{ x, z, name }]`, `clear()`, `count`

- [ ] **Step 1: Write the failing test**

Create `tests/net-remote-hero.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClipName, clipPlaysOnce } from '../game/net/remote-clips.js';
import { CHARACTERS, getCharacter } from '../game/characters/registry.js';

test('resolveClipName keeps a known clip, else the fallback, else anything, else empty', () => {
  const clips = new Map([['stand', 1], ['run', 2]]);
  assert.equal(resolveClipName(clips, 'run', 'stand'), 'run');
  assert.equal(resolveClipName(clips, 'C003_Flying', 'stand'), 'stand');
  assert.equal(resolveClipName(clips, '', 'stand'), 'stand');
  assert.equal(resolveClipName(clips, 'nope', 'missing'), 'stand');
  assert.equal(resolveClipName(new Map(), 'run', 'stand'), '');
  assert.equal(resolveClipName(new Set(['a']), 'x', 'y'), 'a');
});

test('one-shot actions are recognised by name, loops are not', () => {
  for (const name of ['C003_Punch_01', 'C003_N_Attack_01', 'C003_Land', 'C003_Flying_Intro', 'C003_LeapAttack', 'punch', 'jumpUp', 'jumpDown']) assert.equal(clipPlaysOnce(name), true, name);
  for (const name of ['C003_Idle_01', 'C003_Run_01', 'C003_Flying', 'run', 'stand', 'walk', '']) assert.equal(clipPlaysOnce(name), false, name);
});

test('every character declares the model height and yaw the remote copy needs', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.model.height > 1 && c.model.height < 3, c.id);
    assert.equal(typeof c.model.yaw, 'number');
  }
  assert.equal(getCharacter('superman').model.yaw, -Math.PI / 2);   // MultiVersus rig faces +X
  assert.equal(getCharacter('flash').model.yaw, 0);                  // Mixamo rigs face +Z
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-remote-hero.test.js`
Expected: FAIL — module `remote-clips.js` not found.

- [ ] **Step 3: Write minimal implementation**

In `game/characters/registry.js`, add one line to each character object, right after its `modelUrl:` line:
- Superman: `model: { height: 2.05, yaw: -Math.PI / 2 },`
- The Flash: `model: { height: 1.9, yaw: 0 },`

Create `game/net/remote-clips.js`:

```js
// Clip selection for remote heroes. No three.js here, so it is unit-tested in Node.

export const FALLBACK_CLIP = { superman: 'C003_Idle_01', flash: 'stand' };
const ONCE = /punch|attack|land|intro|leap|jumpup|jumpdown|stop|exit|start/i;

/** The clip to play: the one requested if the model has it, else the idle fallback, else any. */
export function resolveClipName(available, wanted, fallback) {
  if (wanted && available.has(wanted)) return wanted;
  if (available.has(fallback)) return fallback;
  return available.keys().next().value ?? '';
}

/** One-shot actions play once and hold their last frame; everything else loops. */
export const clipPlaysOnce = name => !!name && ONCE.test(name);
```

Create `game/net/remote-hero.js`:

```js
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { getCharacter, getSkin } from '../characters/registry.js';
import { prepareFlashClips } from '../characters/flash-controller.js';
import { remapVerticalTracks, heroClipVerticalMode } from '../../hero-motion.js';
import { FALLBACK_CLIP, resolveClipName, clipPlaysOnce } from './remote-clips.js';

// The other players' heroes: a cloned skinned model, a mixer, a name tag, and the pose
// stream from NetSession#remotes(). Heavy effects (lightning, heat vision) are not
// mirrored: only pose, model and skin.

function nameSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(text, 128, 34);
  ctx.fillStyle = color; ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.8, .45, 1);
  sprite.renderOrder = 8;
  return sprite;
}

function supermanClips(animations) {
  const clips = new Map();
  for (const clip of animations) {
    const mapped = remapVerticalTracks(clip.tracks, heroClipVerticalMode(clip.name, 'air'));
    const tracks = mapped.map((t, i) => (t !== clip.tracks[i] ? new THREE.VectorKeyframeTrack(t.name, clip.tracks[i].times, t.values) : t));
    clips.set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return clips;
}

export class RemoteHeroes {
  constructor({ scene, loadGltf }) {
    this.scene = scene;
    this.loadGltf = loadGltf;
    this.entries = new Map();
    this._quat = new THREE.Quaternion();
  }

  get count() { return this.entries.size; }

  positions() {
    return [...this.entries.values()].filter(e => e.shown).map(e => ({ x: e.group.position.x, z: e.group.position.z, name: e.name }));
  }

  update(dt, remotes) {
    const seen = new Set();
    for (const remote of remotes) {
      seen.add(remote.id);
      let entry = this.entries.get(remote.id);
      if (entry && (entry.char !== remote.char || entry.skin !== remote.skin || entry.name !== remote.name)) { this._dispose(entry); entry = null; }
      if (!entry) entry = this._create(remote);
      this._applyPose(entry, remote);
      entry.mixer?.update(dt);
    }
    for (const [id, entry] of [...this.entries]) if (!seen.has(id)) { this._dispose(entry); this.entries.delete(id); }
  }

  clear() {
    for (const entry of this.entries.values()) this._dispose(entry);
    this.entries.clear();
  }

  // --- internals ------------------------------------------------------------------
  _create(remote) {
    const def = getCharacter(remote.char);
    const skin = getSkin(remote.char, remote.skin);
    const group = new THREE.Group();
    group.name = `remote-${remote.id}`;
    const orientation = new THREE.Group();
    orientation.rotation.y = def.model.yaw;
    group.add(orientation);
    // Stand-in until the real model has loaded: a coloured pillar.
    const marker = new THREE.Mesh(new THREE.CapsuleGeometry(.3, def.model.height - .6, 4, 8), new THREE.MeshStandardMaterial({ color: def.accent, roughness: .6 }));
    marker.position.y = def.model.height / 2;
    group.add(marker);
    const label = nameSprite(remote.name, '#ffffff');
    label.position.y = def.model.height + .45;
    group.add(label);
    this.scene.add(group);

    const entry = {
      id: remote.id, char: remote.char, skin: remote.skin, name: remote.name, def, group, orientation, marker, label,
      mixer: null, clips: null, action: null, clipName: '', shown: true, disposed: false
    };
    this.entries.set(remote.id, entry);
    this.loadGltf(skin.modelUrl).then(gltf => {
      if (entry.disposed) return;
      const root = cloneSkeleton(gltf.scene);
      root.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = size.y > 0 ? def.model.height / size.y : 1;
      root.scale.setScalar(scale);
      root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      orientation.add(root);
      group.remove(marker);
      entry.mixer = new THREE.AnimationMixer(root);
      entry.clips = remote.char === 'flash' ? prepareFlashClips(gltf.animations) : supermanClips(gltf.animations);
      entry.model = root;
    }).catch(err => console.warn('[net] modelo remoto não carregou:', skin.modelUrl, err));
    return entry;
  }

  _applyPose(entry, remote) {
    const { pose } = remote;
    entry.group.position.set(pose.x, pose.y, pose.z);
    entry.group.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    entry.shown = !remote.dead;
    entry.group.visible = entry.shown;
    if (entry.clips && remote.clip) this._play(entry, resolveClipName(entry.clips, remote.clip, FALLBACK_CLIP[remote.char]));
  }

  _play(entry, name) {
    if (!name || name === entry.clipName) return;
    const clip = entry.clips.get(name);
    if (!clip) return;
    const next = entry.mixer.clipAction(clip);
    next.reset();
    const once = clipPlaysOnce(name);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    if (entry.action) { entry.action.fadeOut(.15); next.fadeIn(.15); } else next.setEffectiveWeight(1);
    next.play();
    entry.action = next;
    entry.clipName = name;
  }

  _dispose(entry) {
    entry.disposed = true;
    this.scene.remove(entry.group);
    entry.mixer?.stopAllAction();
    entry.label.material.map?.dispose();
    entry.label.material.dispose();
    entry.marker.geometry.dispose();
    entry.marker.material.dispose();
  }
}
```

The superman clips reuse `remapVerticalTracks` exactly as `main.js` does for the local hero, so a remote Superman has the same pelvis handling and does not sink or float while flying.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/net-remote-hero.test.js tests/flash-character.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/net/remote-clips.js game/net/remote-hero.js game/characters/registry.js tests/net-remote-hero.test.js
git commit -m "feat(net): remote hero models with pose playback and name tags"
```

---

### Task 10: Jason com anfitrião autoritativo (`main.js`)

**Files:**
- Modify: `main.js`
- Test: `tests/net-main-wiring.test.js` (criado aqui; as Tasks 11 e 12 acrescentam testes)

**Interfaces:**
- Consumes: `chooseTarget`, `attackHits`, `scaledBossHealth` (Task 2); `SnapshotBuffer`, `yawToQuat`, `quatToYaw` (Task 2).
- Produces (funções de `main.js` usadas pelas Tasks 11 e 12; nenhuma delas altera o jogo solo):
  - `let netSession = null` (a Task 12 o preenche; **todo** uso antes da Task 12 é `netSession?.…`)
  - `bossTargets() -> [{ id, x, y, z }]`, `applyBossHit(victim, amount, dir)`
  - `bossStateForNet() -> boss` (host), `applyBossMirror(boss)`, `updateBossMirror(dt)`, `resetBossMirrorVisuals()` (convidado)
  - `guestDamageEnemy(...)`, `guestHeatDamage(amount, kind)`, `flushGuestHeat()`; `damageEnemy` e `damageEnemyHeat` redirecionam quando `netSession?.isGuest`
  - `applyRemoteDamage({ amount, label, kb, src, from })` (host)
  - `rescaleBossForPlayers()`; `applyEnemyLevel` passa a escalar a vida

- [ ] **Step 1: Write the failing test**

Create `tests/net-main-wiring.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-main-wiring.test.js`
Expected: FAIL — `let netSession = null;` not found.

- [ ] **Step 3: Write minimal implementation**

All edits are in `main.js`.

**3a. Imports.** After the line `import { EnemyPoise, enemyLevelStats } from './game/combat/enemy-poise.js';` add:
```js
import { SnapshotBuffer, yawToQuat, quatToYaw } from './game/net/interpolation.js';
import { chooseTarget, attackHits, scaledBossHealth } from './game/net/rules.js';
```

**3b. State.** After `let enemyStats = enemyLevelStats(1);` add:
```js
// V21 online: filled in by the session code further down; null while playing solo.
let netSession = null;
```

**3c. Scaling.** Replace `applyEnemyLevel`:
```js
function applyEnemyLevel(level) {
  enemyLevel = Math.max(1, level);
  enemyStats = enemyLevelStats(enemyLevel);
  enemyMaxHealth = enemyStats.maxHealth;
}
```
with
```js
function applyEnemyLevel(level) {
  enemyLevel = Math.max(1, level);
  enemyStats = enemyLevelStats(enemyLevel);
  enemyMaxHealth = scaledBossHealth(enemyStats.maxHealth, netSession?.isHost ? netSession?.playerCount : 1);
}

// A player joined or left mid-fight: keep Jason at the same fraction of the new maximum.
function rescaleBossForPlayers() {
  const max = scaledBossHealth(enemyStats.maxHealth, netSession?.isHost ? netSession?.playerCount : 1);
  if (max === enemyMaxHealth) return;
  const ratio = enemyMaxHealth > 0 ? enemyHealth / enemyMaxHealth : 1;
  enemyMaxHealth = max;
  enemyHealth = enemyAlive ? Math.max(1, Math.round(max * ratio)) : 0;
  updateCombatHUD();
}
```

**3d. Targets and victims.** Add right after the `enemyUnderAim` function:
```js
// Everyone the boss may chase or hit. Solo: just the hero. Online host: the hero plus
// every remote player that is alive. Guests never run the boss AI.
function bossTargets() {
  const targets = [];
  if (!playerDead) targets.push({ id: 'local', x: hero.position.x, y: hero.position.y, z: hero.position.z });
  const remotes = netSession?.isHost ? netSession?.remoteLatest() ?? [] : [];
  for (const remote of remotes) if (!remote.dead) targets.push(remote);
  return targets;
}

function applyBossHit(victim, amount, dir) {
  if (victim.id === 'local') damagePlayer(amount, dir);
  else netSession?.sendHit(victim.id, amount, [dir.x, dir.y, dir.z]);
}
```

**3e. Boss swings.** Replace `dispatchEnemyEvent`:
```js
function dispatchEnemyEvent(event) {
  if (!event || event.type !== 'damage' || !enemyAlive || playerDead) return;
  const hitbox = hitboxById(enemyAnimConfig, event.hitboxId);
  const origin = boneWorldPoint(enemyBoneMap, hitbox, enemyRoot, 1.05);
  const heroCenter = hero.position.clone().add(new THREE.Vector3(0, 1.0, 0));
  const radius = Number(event.radius) || Number(hitbox?.radius) || 2.2;
  if (origin.distanceTo(heroCenter) > radius + .85) return;
  const dir = heroCenter.clone().sub(origin); dir.y = 0;
  if (dir.lengthSq() < .001) dir.set(0,0,1).applyQuaternion(enemyRoot.quaternion);
  dir.normalize();
  damagePlayer(Number(event.damage)||1, dir);
}
```
with
```js
function dispatchEnemyEvent(event) {
  if (!event || event.type !== 'damage' || !enemyAlive) return;
  const hitbox = hitboxById(enemyAnimConfig, event.hitboxId);
  const origin = boneWorldPoint(enemyBoneMap, hitbox, enemyRoot, 1.05);
  const radius = Number(event.radius) || Number(hitbox?.radius) || 2.2;
  for (const target of bossTargets()) {
    const center = new THREE.Vector3(target.x, target.y + 1.0, target.z);
    if (origin.distanceTo(center) > radius + .85) continue;
    const dir = center.clone().sub(origin); dir.y = 0;
    if (dir.lengthSq() < .001) dir.set(0,0,1).applyQuaternion(enemyRoot.quaternion);
    dir.normalize();
    applyBossHit(target, Number(event.damage)||1, dir);
  }
}
```
In `beginEnemyAttack`, change the first line from
`if (!enemyAlive || enemyActionLocked || enemyAttackCooldown > 0 || playerDead) return;`
to
`if (!enemyAlive || enemyActionLocked || enemyAttackCooldown > 0 || !bossTargets().length) return;`

Replace `triggerEnemyAttackImpact`:
```js
function triggerEnemyAttackImpact() {
  if (!enemyAlive || playerDead) return;
  const dir = new THREE.Vector3(0,0,1).applyQuaternion(enemyRoot.quaternion).normalize();
  const origin = enemyRoot.position.clone().add(new THREE.Vector3(0,1.0,0)).addScaledVector(dir, 1.05);
  const target = hero.position.clone().add(new THREE.Vector3(0,1.0,0));
  const delta = target.sub(origin);
  const dist = delta.length();
  if (dist > enemyAttackRange || Math.abs(hero.position.y - enemyRoot.position.y) > 3.2) return;
  const n = delta.normalize();
  if (n.dot(dir) < .08) return;
  damagePlayer(enemyAttackDamage, dir);
}
```
with
```js
function triggerEnemyAttackImpact() {
  if (!enemyAlive) return;
  const dir = new THREE.Vector3(0,0,1).applyQuaternion(enemyRoot.quaternion).normalize();
  const origin = enemyRoot.position.clone().add(new THREE.Vector3(0,1.0,0)).addScaledVector(dir, 1.05);
  const victims = attackHits(bossTargets(), { origin, dir, range: enemyAttackRange, baseY: enemyRoot.position.y });
  for (const victim of victims) applyBossHit(victim, enemyAttackDamage, dir);
}
```
(`attackHits` reproduces the old checks: range to the chest point, ±3.2 m of height, and `dot >= .08`.)

In `updateEnemyAttackWarning`, change `|| !enemyAlive || playerDead) warning.active = false;` to `|| !enemyAlive || !bossTargets().length) warning.active = false;`.

In `updateEnemy`, replace
```js
  if (playerDead) { enemyIdle(); return; }

  const toHero = hero.position.clone().sub(enemyRoot.position);
```
with
```js
  const target = chooseTarget(bossTargets(), enemyRoot.position);
  if (!target) { enemyIdle(); return; }

  const toHero = new THREE.Vector3(target.x, target.y, target.z).sub(enemyRoot.position);
```

**3f. Guest redirects.** At the very top of `damageEnemy`, before `if (!enemyReady || !enemyAlive || enemyHitInvuln > 0) return false;`, add:
```js
  if (netSession?.isGuest) return guestDamageEnemy(amount, source, knockback, label);
```
At the very top of `damageEnemyHeat(amount)` add a `kind` parameter and the redirect, so it reads:
```js
function damageEnemyHeat(amount, kind = 'heat') {
  if (netSession?.isGuest) { guestHeatDamage(amount, kind); return; }
  if (!enemyReady || !enemyAlive) return;
```
In `applyIceBreathDamage`, change `damageEnemyHeat(amount);` to `damageEnemyHeat(amount, 'ice');`.

**3g. Host and guest helpers.** Add this block right after `damageEnemyHeat` (so the whole online-boss logic sits next to the code it mirrors):
```js
// ---------------------------------------------------------------------------
// V21 online boss: the host simulates Jason, guests mirror him
// ---------------------------------------------------------------------------
function applyRemoteDamage({ amount, label, kb, src, from }) {
  // Heat vision and ice breath arrive as small accumulated ticks: no stagger, no hitstop.
  if (label === '~heat') { damageEnemyHeat(amount); return; }
  if (label === '~ice') { enemyChill = 1; damageEnemyHeat(amount, 'ice'); return; }
  const who = netSession?.players.find(p => p.id === from)?.name || 'Aliado';
  damageEnemy(amount, new THREE.Vector3(src[0], src[1], src[2]), kb, label ? `${label} · ${who}` : '');
}

function bossStateForNet() {
  return {
    p: [enemyRoot.position.x, enemyRoot.position.y, enemyRoot.position.z], y: enemyRoot.rotation.y,
    clip: enemyCurrentAction?.getClip?.().name || '', rate: enemyCurrentAction?.timeScale ?? 1, tok: enemyActionToken,
    hp: enemyHealth, max: enemyMaxHealth, rage: enemyEnraged, lvl: enemyLevel, alive: enemyAlive, lock: enemyActionLocked
  };
}

const bossMirror = new SnapshotBuffer({ delayMs: 120 });
const ONE_SHOT_BOSS_CLIP = /attack|_hr_|flyback|deflect/i;
let mirroredBoss = null;
let mirrorClip = '';
let mirrorToken = -1;
let guestHitCooldown = 0;
const guestHeat = { amount: 0, kind: 'heat', clock: 0 };

function resetBossMirrorVisuals() {
  enemyDeathFall = 0;
  enemyVisual.rotation.set(0, 0, 0);
  enemyMarker.material.opacity = .78;
  enemyMarker.material.color.set(mirroredBoss?.rage ? 0xff6a1a : 0xff263e);
  enemyActionLocked = false;
  if (enemyMixer) enemyMixer.stopAllAction();
  enemyCurrentAction = null;
  enemyCurrentAnimName = '';
  mirrorClip = '';
  mirrorToken = -1;
}

// Guest: a world snapshot from the host (about 10 per second).
function applyBossMirror(b) {
  mirroredBoss = b;
  bossMirror.push(performance.now(), { x: b.p[0], y: b.p[1], z: b.p[2], q: yawToQuat(b.y) });
  if (b.lvl !== enemyLevel) { enemyLevel = b.lvl; enemyStats = enemyLevelStats(b.lvl); }
  enemyHealth = b.hp;
  enemyMaxHealth = b.max;
  if (b.rage !== enemyEnraged) { enemyEnraged = b.rage; enemyMarker.material.color.set(b.rage ? 0xff6a1a : 0xff263e); }
  if (b.alive !== enemyAlive) {
    enemyAlive = b.alive;
    if (b.alive) resetBossMirrorVisuals();
    else { enemyDeathFall = 0; enemyMarker.material.opacity = .18; showMessage('JASON DERROTADO!', 2200); }
  }
  updateCombatHUD();
}

// Guest, every frame: place Jason where the host says he is and play the host's clip.
function updateBossMirror(dt) {
  guestHitCooldown = Math.max(0, guestHitCooldown - dt);
  guestHeat.clock += dt;
  if (guestHeat.amount > 0 && guestHeat.clock > .25) flushGuestHeat();
  if (!enemyReady || !mirroredBoss) return;
  const b = mirroredBoss;
  enemyMarker.visible = enemyAlive;
  enemyMarker.rotation.z += dt * (enemyEnraged ? 2.2 : .75);
  updateEnemyFlash(dt);
  const pose = bossMirror.sample(performance.now());
  if (pose) {
    enemyRoot.position.set(pose.x, pose.y, pose.z);
    enemyRoot.rotation.y = quatToYaw(pose.q);
  }
  if (!enemyAlive) {
    enemyDeathFall = Math.min(1, enemyDeathFall + dt / .6);
    const fall = enemyDeathFall * enemyDeathFall * (3 - 2 * enemyDeathFall);
    enemyVisual.rotation.x = -1.3 * fall;
  }
  if (b.clip && (b.clip !== mirrorClip || b.tok !== mirrorToken)) {
    mirrorClip = b.clip;
    mirrorToken = b.tok;
    const clip = enemyFindClip([b.clip]);
    if (clip) enemyPlayClip(clip, .12, ONE_SHOT_BOSS_CLIP.test(b.clip), b.rate || 1);
  } else if (enemyCurrentAction) {
    enemyCurrentAction.timeScale = b.rate || 1;
  }
}

// Guest: a hit lands visually right away; the host decides the damage.
function guestDamageEnemy(amount, source, knockback, label) {
  if (!enemyReady || !enemyAlive || guestHitCooldown > 0) return false;
  guestHitCooldown = .1;
  const from = source || hero.position;
  const hitPoint = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  const away = hitPoint.clone().sub(from).setY(0);
  if (away.lengthSq() < .001) away.set(0, 0, 1);
  away.normalize();
  const heavy = amount >= 40;
  bursts.sparks(hitPoint, { count: heavy ? 38 : 16, power: heavy ? 1.3 : .8, dir: away, cone: 1 });
  requestHitStop(heavy ? .11 : .065);
  spawnDamageNumber(enemyRoot.position.clone().add(new THREE.Vector3(0, 2.5, 0)), amount, heavy ? 'heavy' : 'hit');
  cameraShake = Math.max(cameraShake, Math.min(.58, .14 + amount / 110));
  netSession?.sendDamage({ amount, label: label || '', kb: knockback || 0, src: [from.x, from.y, from.z] });
  return true;
}

// Guest: heat vision / ice breath tick every frame; send them as one request per ~250 ms.
function guestHeatDamage(amount, kind) {
  if (!enemyReady || !enemyAlive) return;
  guestHeat.amount += amount;
  guestHeat.kind = kind;
  if (guestHeat.amount >= 3) flushGuestHeat();
}
function flushGuestHeat() {
  if (guestHeat.amount <= 0) return;
  netSession?.sendDamage({ amount: guestHeat.amount, label: `~${guestHeat.kind}`, kb: 0, src: [hero.position.x, hero.position.y, hero.position.z] });
  guestHeat.amount = 0;
  guestHeat.clock = 0;
}
```

- [ ] **Step 4: Run tests, then smoke-test solo play**

Run:
```bash
node --check main.js && node --test tests/net-main-wiring.test.js tests/v16-dynamic-events-integration.test.js tests/v17-animation-fixes.test.js tests/flash-character.test.js
```
Expected: PASS, except the one `scheduler é atualizado uma vez por frame…` test, which fails on a Windows checkout only because it matches `\n` while the file has CRLF (Task 13 makes it tolerant; on Linux/CI it passes).

Smoke test in the browser (solo must be unchanged): start the preview (`preview_start` with the `sky-guardian` configuration), open `http://localhost:8080/?debug`, click **JOGAR**, then in the console run `window.__sky.state` and confirm `enemyAlive: true`. Walk toward Jason (or run `window.__sky.enemyRoot.position.copy(window.__sky.hero.position).add(new window.__sky.THREE.Vector3(0, 0, 8))`), wait a few seconds: he must chase and hit Superman (HUD health drops), and punching him (`E`) must lower the boss bar. No errors in the console.

- [ ] **Step 5: Commit**

```bash
git add main.js tests/net-main-wiring.test.js
git commit -m "feat(net): boss targets every player; guest boss mirror and damage requests"
```

---

### Task 11: Eventos, fogo e interceptação no co-op (`main.js`)

**Files:**
- Modify: `main.js`
- Test: `tests/net-main-wiring.test.js` (acrescenta testes)

**Interfaces:**
- Consumes: `netSession?.broadcastEvent`, `sendCool`, `sendIntercept` (Task 5); `DynamicEventSystem#adopt`, `FireSystem` (Task 6); `MeteorEvent`, `BuildingFireEvent` (já importados em `main.js`).
- Produces:
  - `describeEvent(event)`, `fireDescriptor(spot)`, `announceSpawn(event)`
  - `handleEventCommand(command, { mirrored })` (o comando `meteor-impact` ganha `descriptors` e o `meteor-intercepted` ganha `method`)
  - `emitEventCommand(command)`
  - `adoptWorldEvent(kind, data)` (convidado)
  - `coolFireCone(args)`, `coolFireSphere(args)`, `applyCoolRequest(msg)` (host), `applyInterceptRequest(msg)` (host)

- [ ] **Step 1: Write the failing test**

Append to `tests/net-main-wiring.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-main-wiring.test.js`
Expected: FAIL — `announceSpawn(createMeteorEvent` not found.

- [ ] **Step 3: Write minimal implementation**

All edits are in `main.js`.

**3a. Announce spawns.** Replace
```js
const dynamicEventSystem = new DynamicEventSystem({
  rng: eventRng,
  factories: {
    meteor: createMeteorEvent,
    buildingFire: createBuildingFireEvent
  }
});
```
with
```js
// What the host tells guests about an event: enough to rebuild it (also for late joiners).
const fireDescriptor = spot => spot && ({
  id: spot.id, eventId: spot.eventId, buildingId: spot.buildingId, source: spot.source,
  position: spot.position, normal: spot.normal, radius: spot.radius, intensity: spot.intensity
});
function describeEvent(event) {
  if (event.type === 'meteor') {
    return {
      id: event.id, impactPoint: event.impactPoint, startPosition: event.startPosition, warningSeconds: event.warningSeconds,
      fallSeconds: event.fallSeconds, fireCount: event.fireCount, state: event.state, warningElapsed: event.warningElapsed,
      fallElapsed: event.fallElapsed, fireIds: [...event.fireIds]
    };
  }
  return { id: event.id, buildingId: event.buildingId, descriptors: event.fireIds.map(id => fireDescriptor(fireSystem.getSpot(id))).filter(Boolean) };
}
function announceSpawn(event) {
  if (event) netSession?.broadcastEvent(event.type === 'meteor' ? 'spawn-meteor' : 'spawn-fire', describeEvent(event));
  return event;
}

const dynamicEventSystem = new DynamicEventSystem({
  rng: eventRng,
  factories: {
    meteor: (...args) => announceSpawn(createMeteorEvent(...args)),
    buildingFire: (...args) => announceSpawn(createBuildingFireEvent(...args))
  }
});
```

**3b. Commands carry the fire positions.** Change the signature `function handleEventCommand(command) {` to
```js
function handleEventCommand(command, { mirrored = false } = {}) {
```
In its `meteor-impact` branch replace
```js
    const descriptors = buildMeteorImpactFireDescriptors(command.eventId, point, requested);
    const fireIds = fireSystem.addSpots(descriptors);
```
with
```js
    // The host rolls the fire positions once and ships them with the command; guests use those.
    const descriptors = mirrored ? (command.descriptors || []) : buildMeteorImpactFireDescriptors(command.eventId, point, requested);
    command.descriptors = descriptors;
    const fireIds = fireSystem.addSpots(descriptors);
```
In its `meteor-intercepted` branch, add as the first line
```js
    meteorInterceptMethod = command.method || meteorInterceptMethod;
```
Immediately after `handleEventCommand`, add (and make sure `let meteorInterceptMethod = 'superPunch';`, which already follows, stays where it is):
```js
// Host: run the command here, then tell the guests. Guest: commands come only from the host.
function emitEventCommand(command) {
  if (netSession?.isGuest) return;
  handleEventCommand(command);
  netSession?.broadcastEvent('command', command);
}

// Guest: rebuild what the host announced.
function adoptWorldEvent(kind, data) {
  if (kind === 'command') { handleEventCommand(data, { mirrored: true }); return; }
  if (kind === 'fires') { fireSystem.addSpots(data.descriptors || []); return; }
  if (kind === 'spawn-meteor') {
    const event = new MeteorEvent({
      id: data.id, impactPoint: data.impactPoint, startPosition: data.startPosition,
      warningSeconds: data.warningSeconds, fallSeconds: data.fallSeconds, fireCount: data.fireCount
    });
    if (data.state) {                                   // late joiner: pick up mid-flight
      event.state = data.state;
      event.warningElapsed = data.warningElapsed || 0;
      event.fallElapsed = data.fallElapsed || 0;
      event._impactEmitted = data.state === 'impacted';
    }
    event.attachFireIds(data.fireIds || []);
    dynamicEventSystem.adopt(event);
    if (!data.state || data.state === 'warning') showMessage('ALERTA · METEORO DETECTADO', 1250);
    return;
  }
  if (kind === 'spawn-fire') {
    fireSystem.addSpots(data.descriptors || []);
    const event = new BuildingFireEvent({ id: data.id, buildingId: data.buildingId });
    event.attachFireIds((data.descriptors || []).map(d => d.id));
    dynamicEventSystem.adopt(event);
    showMessage('EMERGÊNCIA · INCÊNDIO EM PRÉDIO', 1100);
  }
}
```

**3c. Use `emitEventCommand`.** In `updateDynamicEvents` replace `for (const command of commands) handleEventCommand(command);` with `for (const command of commands) emitEventCommand(command);`. In `tryInterceptActiveMeteor` replace `for (const command of commands) handleEventCommand(command);` with `for (const command of commands) emitEventCommand({ ...command, method });`.

In `updateDynamicEvents`, replace the `controlLocked` definition
```js
  const controlLocked = !heroReady || playerDead || actionLocked || flightMachine.busy || leapAttack.active || helpVisible;
```
with
```js
  // Online, the shared world must not stop because one player is busy punching or dead.
  const controlLocked = netSession ? (!heroReady || helpVisible)
    : (!heroReady || playerDead || actionLocked || flightMachine.busy || leapAttack.active || helpVisible);
```

**3d. Guest interception.** In `tryInterceptActiveMeteor`, right after the line `if (origin.distanceTo(meteorPosition) > Math.max(0, radius) + METEOR_COLLISION_RADIUS) return false;` add:
```js
  if (netSession?.isGuest) {                    // the host decides; its commands come back as events
    if (method === 'supersonic' && speed < METEOR_SMASH_SPEED) return false;
    netSession?.sendIntercept({ method, origin: [origin.x, origin.y, origin.z], radius, speed });
    return true;
  }
```
Add, after `trySupersonicMeteorSweep`:
```js
function applyInterceptRequest(msg) {
  tryInterceptActiveMeteor(msg.method, new THREE.Vector3(msg.origin[0], msg.origin[1], msg.origin[2]), msg.radius, msg.speed);
}
```

**3e. Cooling.** Add before `updateIceBreath` (anywhere above its first use):
```js
// Cooling is applied locally everywhere (instant feedback). A guest also asks the host to
// apply the same cooling to the authoritative fire, so the fire goes out for everyone.
function coolFireCone(args) {
  const affected = fireSystem.applyCoolingCone(args);
  netSession?.sendCool({
    shape: 'cone', origin: [args.origin.x, args.origin.y, args.origin.z], dir: [args.direction.x, args.direction.y, args.direction.z],
    range: args.range, half: args.halfAngleDeg, dt: args.dt, rate: args.rate, radius: 0
  });
  return affected;
}
function coolFireSphere(args) {
  const affected = fireSystem.applyCoolingSphere(args);
  netSession?.sendCool({
    shape: 'sphere', origin: [args.origin.x, args.origin.y, args.origin.z], dir: [0, 0, 1],
    range: 0, half: 0, dt: args.dt, rate: args.rate, radius: args.radius
  });
  return affected;
}
function applyCoolRequest(msg) {
  const origin = { x: msg.origin[0], y: msg.origin[1], z: msg.origin[2] };
  if (msg.shape === 'sphere') { fireSystem.applyCoolingSphere({ origin, radius: msg.radius, dt: msg.dt, rate: msg.rate }); return; }
  fireSystem.applyCoolingCone({
    origin, direction: { x: msg.dir[0], y: msg.dir[1], z: msg.dir[2] },
    range: msg.range, halfAngleDeg: msg.half, dt: msg.dt, rate: msg.rate
  });
}
```
In `updateIceBreath`, change `const affected = fireSystem.applyCoolingCone({` to `const affected = coolFireCone({`. In `createFlashApi`, replace the two cooling members with
```js
    coolCone: (origin, dir, range, halfAngle, dt, rate) => coolFireCone({
      origin, direction: dir, range, halfAngleDeg: halfAngle, dt, rate, occluded: spot => iceBreathOccluded(origin, spot)
    }),
    coolRadius: (point, radius, dt, rate) => coolFireSphere({ origin: point, radius, dt, rate }),
```

- [ ] **Step 4: Run tests, then smoke-test solo play**

Run:
```bash
node --check main.js && node --test tests/net-main-wiring.test.js tests/v16-dynamic-events-integration.test.js tests/dynamic-event-system.test.js tests/ice-breath.test.js
```
Expected: PASS (same single CRLF-only exception as Task 10).

Smoke test in the browser (solo): at `http://localhost:8080/?debug` force an event with
`window.__sky.dynamicEventSystem.spawn('meteor')` and `window.__sky.dynamicEventSystem.spawn('buildingFire')`, then watch the warning, the fall, the fires, and put the fires out with `G` (ice breath). Everything must behave as before; no console errors.

- [ ] **Step 5: Commit**

```bash
git add main.js tests/net-main-wiring.test.js
git commit -m "feat(net): mirror meteors and fires to guests; forward cooling and interception"
```

---

### Task 12: Ciclo da sessão, heróis remotos e morte online (`main.js`)

**Files:**
- Modify: `main.js`, `index.html` (nenhuma mudança além da Task 7)
- Test: `tests/net-main-wiring.test.js` (acrescenta testes)

**Interfaces:**
- Consumes: tudo das Tasks 1–11; `Room`, `NetSession`, `createPeerNetwork`, `RemoteHeroes`, `createOnlinePanel`, `describeNetError`, `cleanPlayerName`.
- Produces:
  - Seção `// V21 ONLINE CO-OP — session lifecycle` em `main.js` com `startOnline(role, code?)`, `beginOnlineSession(room)`, `leaveOnline()`, `endOnlineSession(message)`, `createNetGame()`, `sendWorldBootstrap(id)`, `netTick()`, `netLocalPose()`
  - `resetGame({ scope = 'all', fromNet = false } = {})`: `scope: 'player'` só renasce o herói local
  - Aba **Online** no menu, pontos dos jogadores no minimapa, `window.__sky.netSession` no modo debug

- [ ] **Step 1: Write the failing test**

Append to `tests/net-main-wiring.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/net-main-wiring.test.js`
Expected: FAIL — marker `V21 ONLINE CO-OP — session lifecycle` not found.

- [ ] **Step 3: Write minimal implementation**

All edits are in `main.js`.

**3a. Imports.** After the two net imports added in Task 10, add:
```js
import { Room } from './game/net/room.js';
import { NetSession } from './game/net/net-session.js';
import { createPeerNetwork } from './game/net/transport.js';
import { RemoteHeroes } from './game/net/remote-hero.js';
import { createOnlinePanel, describeNetError, cleanPlayerName } from './game/ui/online-panel.js';
```

**3b. `resetGame`.** Replace the declaration line `function resetGame() {` with
```js
function resetGame({ scope = 'all', fromNet = false } = {}) {
  // A guest never restarts the shared world: pressing R (or dying) only respawns the guest.
  if (netSession?.isGuest && !fromNet) scope = 'player';
  const all = scope === 'all';
```
Then wrap the world-only statements. Replace
```js
  dynamicEventSystem.reset();
  fireSystem.reset();
  emergencyPresentation.reset();
  recentBuildingFireIds.clear();
```
with
```js
  if (all) {
    dynamicEventSystem.reset();
    fireSystem.reset();
    emergencyPresentation.reset();
    recentBuildingFireIds.clear();
  }
```
Replace `velocity.set(0,0,0); score=0;` with `velocity.set(0,0,0); if (all) score = 0;`. Replace
```js
  applyEnemyLevel(1);
  resetEnemy();
  updateCombatHUD();
```
with
```js
  if (all) {
    applyEnemyLevel(1);
    resetEnemy();
  }
  updateCombatHUD();
```
Replace the last three statements of the function
```js
  for (const ring of rings) { ring.userData.collected=false; ring.visible=true; ring.scale.setScalar(ring.userData.baseScale ?? 1); }
  document.querySelector('#score').textContent = 0;
  showMessage('Missão reiniciada', 850);
}
```
with
```js
  if (all) {
    for (const ring of rings) { ring.userData.collected=false; ring.visible=true; ring.scale.setScalar(ring.userData.baseScale ?? 1); }
    document.querySelector('#score').textContent = 0;
  }
  showMessage(all ? 'Missão reiniciada' : 'RENASCEU', 850);
  if (all && netSession?.isHost && !fromNet) netSession?.broadcastReset();
}
```

**3c. Death and character switch.** In `damagePlayer`, replace
```js
    setTimeout(() => {
      if (playerDead && serial === enemyRespawnSerial) resetGame();
    }, 1700);
```
with
```js
    setTimeout(() => {
      if (!playerDead || serial !== enemyRespawnSerial) return;
      // Online: only restart the shared mission when every player is down (host decides).
      const everyoneDown = !!netSession?.isHost && !!netSession?.remoteLatest().every(r => r.dead);
      resetGame(netSession && !everyoneDown ? { scope: 'player' } : {});
    }, 1700);
```
In `selectCharacter`, replace its `resetGame();` call with `resetGame(netSession ? { scope: 'player' } : {});`.

**3d. Boss AI and the net frame.** In `animate`, replace `updateEnemy(worldDt * chillScale,time);` with
```js
  if (netSession?.isGuest) { /* mirrored in netTick */ } else updateEnemy(worldDt * chillScale,time);
```
At the very start of the `if (paused) {` block of `animate` add `if (netSession) netTick();` as its first statement. Immediately before the line `// Never step backwards: a negative delta would destabilise every damped lerp.` add `if (netSession) netTick();`.

**3e. Minimap and status.** In `buildMapState`, add `peers: remoteHeroes.positions(),` to the returned object (after `meteors`). In the `getStatus` list of `createPauseMenu`, add before `['Modo offline', …]`:
```js
    ...(netSession ? [['Sala online', `${netSession.code} · ${netSession.playerCount} jogador(es)`]] : []),
```
Pass the panel to the menu: add `onlinePanel,` to the `createPauseMenu({ … })` options (next to `getSkinIds`). In the debug handle `window.__sky = { … }` add `get netSession() { return netSession; },`.

**3f. The session section.** Insert this block immediately **before** the line `// --- pause ---` (so `onlinePanel` exists when `createPauseMenu` runs):
```js
// ---------------------------------------------------------------------------
// V21 ONLINE CO-OP — session lifecycle
// ---------------------------------------------------------------------------
const NAME_KEY = 'sky-guardian:player-name';
const modelCache = new Map();
let netStatus = 'idle';            // 'idle' | 'busy' | 'connected'
let netError = '';
let netNetwork = null;
let lastNetFrame = 0;

function loadRemoteGltf(url) {
  if (!modelCache.has(url)) {
    modelCache.set(url, new Promise((resolve, reject) => {
      gltfLoader.load(url, gltf => { prepScene(gltf.scene, { shadows: true }); resolve(gltf); }, undefined, reject);
    }).catch(err => { modelCache.delete(url); throw err; }));
  }
  return modelCache.get(url);
}
const remoteHeroes = new RemoteHeroes({ scene, loadGltf: loadRemoteGltf });

function playerName() {
  try { return cleanPlayerName(settingsStore?.getItem(NAME_KEY)) || 'Herói'; } catch { return 'Herói'; }
}
function savePlayerName(name) {
  try { settingsStore?.setItem(NAME_KEY, name); } catch { /* optional */ }
}
const localProfile = () => ({ name: playerName(), char: activeCharacterId, skin: skinIds[activeCharacterId] });

// The protocol caps coordinates at +-5000; space flight goes far beyond the city.
const clampWorld = v => Math.max(-4900, Math.min(4900, v));
function netLocalPose() {
  const q = hero.quaternion;
  return {
    char: activeCharacterId, skin: skinIds[activeCharacterId],
    p: [clampWorld(hero.position.x), clampWorld(hero.position.y), clampWorld(hero.position.z)], q: [q.x, q.y, q.z, q.w],
    clip: flashActive() ? (flash.currentName || '') : (currentAnimName || ''),
    hp: Math.max(0, playerHealth), dead: playerDead
  };
}

// A guest that joins mid-game gets the fires and the running events right away.
function sendWorldBootstrap(id) {
  if (!netSession?.isHost) return;
  const spots = fireSystem.getActiveSpots().map(fireDescriptor);
  for (let i = 0; i < spots.length; i += 4) netSession.sendEventTo(id, 'fires', { descriptors: spots.slice(i, i + 4) });
  for (const event of dynamicEventSystem.getActiveEvents()) {
    if (['intercepted', 'resolved'].includes(event.state)) continue;
    netSession.sendEventTo(id, event.type === 'meteor' ? 'spawn-meteor' : 'spawn-fire', describeEvent(event));
  }
}

function createNetGame() {
  return {
    getLocalPose: netLocalPose,
    getBossState: bossStateForNet,
    getFireSnapshot: () => fireSystem.getSnapshot(),
    applyRemoteDamage,
    applyCool: applyCoolRequest,
    applyIntercept: applyInterceptRequest,
    applyBossState: applyBossMirror,
    applyFireSnapshot: list => fireSystem.syncFromSnapshot(list),
    handleWorldEvent: adoptWorldEvent,
    applyHit: ({ amount, dir }) => damagePlayer(amount, new THREE.Vector3(dir[0], dir[1], dir[2])),
    resetMission: () => resetGame({ fromNet: true }),
    onPlayers: () => { rescaleBossForPlayers(); onlinePanel.sync(); pauseMenu.refresh(); },
    onPlayerJoined: id => { sendWorldBootstrap(id); showMessage('JOGADOR ENTROU NA SALA', 1200); },
    onClosed: reason => endOnlineSession(describeNetError(reason))
  };
}

async function startOnline(role, code = '') {
  if (netStatus !== 'idle') return;
  netStatus = 'busy';
  netError = '';
  onlinePanel.sync();
  try {
    netNetwork ||= createPeerNetwork();
    const options = { network: netNetwork, player: localProfile() };
    const room = role === 'host' ? await Room.host(options) : await Room.join({ ...options, code });
    beginOnlineSession(room);
  } catch (err) {
    console.warn('[net]', err);
    netStatus = 'idle';
    netError = describeNetError(err?.code);
  }
  onlinePanel.sync();
  pauseMenu.refresh();
}

function beginOnlineSession(room) {
  netSession = new NetSession({ room, game: createNetGame() });
  netStatus = 'connected';
  dynamicEventSystem.setMirror(netSession.isGuest);
  if (netSession.isGuest) {
    // The guest's own city state is replaced by the host's: start from a clean mirror.
    bossMirror.clear();
    mirroredBoss = null;
    resetGame({ fromNet: true });
  } else {
    rescaleBossForPlayers();
  }
  showMessage(netSession.isHost ? `SALA ${room.code} CRIADA` : `NA SALA ${room.code}`, 1800);
}

function leaveOnline() { endOnlineSession(''); }

function endOnlineSession(message = '') {
  const wasGuest = !!netSession?.isGuest;
  if (netSession?.active) netSession.leave();
  netSession = null;
  netStatus = 'idle';
  netError = message;
  dynamicEventSystem.setMirror(false);
  remoteHeroes.clear();
  bossMirror.clear();
  mirroredBoss = null;
  rescaleBossForPlayers();                       // back to the solo health scale
  if (wasGuest) resetGame();                     // the guest world was a mirror: start a clean solo mission
  if (message) showMessage(message, 2400);
  onlinePanel.sync();
  pauseMenu.refresh();
}

function netTick() {
  const now = performance.now();
  const dt = lastNetFrame ? Math.min(.05, (now - lastNetFrame) / 1000) : 0;
  lastNetFrame = now;
  netSession.update(now);
  if (!netSession?.active) return;               // update() may have closed the room
  remoteHeroes.update(dt, netSession.remotes(now));
  if (netSession.isGuest) updateBossMirror(dt);
}

addEventListener('pagehide', () => netSession?.leave());

const onlinePanel = createOnlinePanel({
  getState: () => ({
    status: netStatus, code: netSession?.code || '', isHost: !!netSession?.isHost, error: netError,
    players: (netSession?.players || []).map(p => ({ ...p, self: p.id === netSession.selfId, isHost: p.id === 'p0' }))
  }),
  getName: playerName,
  setName: savePlayerName,
  onCreate: () => startOnline('host'),
  onJoin: code => startOnline('guest', code),
  onLeave: leaveOnline
});

```

- [ ] **Step 4: Run tests, then verify with two tabs**

Run:
```bash
node --check main.js && npm test
```
Expected: PASS for everything except the single Windows-CRLF `scheduler` test described in Task 10 (fixed in Task 13).

Two-tab verification (WebRTC works between tabs of the same machine; keep both tabs visible, because a hidden tab throttles `requestAnimationFrame`). Start the preview server (`preview_start`, configuration `sky-guardian`) and open `http://localhost:8080/?debug` in **two** tabs (tab A and tab B). In each, click **JOGAR**, press `P`, open **Online**.

1. Tab A: type a name, click **Criar sala**. A 4-character code appears and the player list shows one player (you, anfitrião). If instead the message says the network cannot connect, check the console for the PeerJS error and confirm `window.Peer` exists.
2. Tab B: type the code (lower case and with spaces must work) and click **Entrar**. Both tabs list two players. Typing a wrong code shows "Sala não encontrada". Typing `abc` shows the invalid-code message.
3. Close the menu in both (`Esc`). In A you see B's hero (placeholder pillar, then the model) with a name tag; moving B moves it in A, and the other way round. Both tabs show the other player as a green dot on the minimap.
4. Jason is in the same place in both tabs and walks/attacks in sync. In tab B punch Jason (`E`): his bar drops in **both** tabs, and the damage number appears in B immediately.
5. In tab A run `window.__sky.dynamicEventSystem.spawn('meteor')`: tab B shows the same alert and the same falling meteor; after impact the same fires appear in both. Put them out with `G` in B: they disappear in both.
6. Make Jason hit B (stand next to him): B's health drops; A's does not. Let B die: B respawns by itself after about 2 s; Jason and the fires do not reset.
7. In tab A run `window.__sky.netSession.leave()` (or click **Sair da sala**): tab B shows "O anfitrião saiu: a sala foi encerrada." and returns to a normal solo game.
8. Re-create a room in A, let a meteor impact, then join from B: B must see the active fires and the boss at the current health.

- [ ] **Step 5: Commit**

```bash
git add main.js tests/net-main-wiring.test.js
git commit -m "feat(net): online sessions, remote heroes, online respawn and Online tab wiring"
```

---

### Task 13: Publicação no GitHub Pages, documentação e verificação final

**Files:**
- Create: `tools/build-site.mjs`, `.github/workflows/pages.yml`
- Modify: `package.json`, `README.md`, `ATTRIBUTION.md`, `tests/v16-dynamic-events-integration.test.js`, `docs/superpowers/specs/2026-10-13-online-coop-design.md`
- Test: `tests/build-site.test.js`

**Interfaces:**
- Consumes: `pwa-manifest.json` (gerado por `npm run pwa`).
- Produces: `buildSite(outDir) -> { files: number }` exportado por `tools/build-site.mjs`; script `npm run site`; workflow que testa, regenera o PWA, monta `_site/` e publica.

- [ ] **Step 1: Write the failing test**

Create `tests/build-site.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../tools/build-site.mjs';

test('the Pages artifact has everything the game needs and nothing it does not', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-site-'));
  try {
    const { files } = await buildSite(out);
    assert.ok(files > 50);
    for (const rel of ['index.html', 'main.js', 'sw.js', 'pwa-manifest.json', 'manifest.webmanifest', 'vendor/peerjs/peerjs.min.js',
      'vendor/three/build/three.module.js', 'game/net/room.js', 'assets/flash/reverse-flash.glb', 'assets/superman/Superman-armor.glb']) {
      assert.ok(fs.existsSync(path.join(out, rel)), rel);
    }
    for (const rel of ['tests', 'tools', 'docs', 'node_modules', 'graphify-out', 'main.js.bak', 'sky_guardian_threejs.zip']) {
      assert.ok(!fs.existsSync(path.join(out, rel)), `${rel} must not be published`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the workflow tests, rebuilds the PWA manifest and publishes the generated site', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  for (const needle of ['npm test', 'npm run pwa', 'npm run site', 'actions/upload-pages-artifact', 'actions/deploy-pages', 'pages: write', 'id-token: write']) {
    assert.ok(yml.includes(needle), needle);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-site.test.js`
Expected: FAIL — module `tools/build-site.mjs` not found.

- [ ] **Step 3: Write minimal implementation**

Create `tools/build-site.mjs`:

```js
#!/usr/bin/env node
// Assembles the static site for GitHub Pages in ./_site, from the same file list the
// service worker precaches (pwa-manifest.json) plus the worker itself. Run `npm run pwa`
// first so the list is current.
//   node tools/build-site.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRA = ['sw.js', 'pwa-manifest.json'];

export async function buildSite(outDir = path.join(ROOT, '_site')) {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'pwa-manifest.json'), 'utf8'));
  const wanted = new Set([...manifest.core, ...manifest.assets.map(a => a.url), ...EXTRA.map(f => `./${f}`)]);
  wanted.delete('./');
  await fs.rm(outDir, { recursive: true, force: true });
  let files = 0;
  for (const url of wanted) {
    const rel = url.replace(/^\.\//, '');
    const target = path.join(outDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(ROOT, rel), target);
    files++;
  }
  return { files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files } = await buildSite(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`site: ${files} files`);
}
```

In `package.json` add the script `"site": "node tools/build-site.mjs",` and append `&& node --check tools/build-site.mjs` to `"check"`.

Create `.github/workflows/pages.yml`:

```yaml
name: Publicar no GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Testes
        run: npm test
      - name: Atualizar o manifesto do PWA
        run: npm run pwa
      - name: Montar o site
        run: npm run site
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Make the one Windows-only test tolerant of CRLF: in `tests/v16-dynamic-events-integration.test.js` change `;\n\}/)?.[0]` in the `animate` regex of the test `scheduler é atualizado uma vez por frame…` to `;\r?\n\}/)?.[0]`.

Add `_site/` to `.gitignore` (create the file if it does not exist, with the single line `_site/`).

Documentation:
- `README.md`: add a section **Co-op online** after the Skins section: how to create and join a room (Pausa → Online), up to 4 players, the host runs Jason and the events, limits (host leaving ends the room, STUN only so some networks do not connect, the host pausing freezes the shared world, effects of other heroes are not mirrored, the boss telegraph is not shown to guests), how the site is published (`.github/workflows/pages.yml`, enable **Settings → Pages → Source: GitHub Actions**; the repository must be public on the free plan), and `npm run vendor:peerjs`, `npm run site`.
- `ATTRIBUTION.md`: add a **PeerJS** entry (MIT, https://peerjs.com, vendored at `vendor/peerjs/`, version in `vendor/peerjs/VERSION`).
- `docs/superpowers/specs/2026-10-13-online-coop-design.md`: add a final section `## 12. Mudanças feitas ao planejar` listing the five items under "Deviations from the spec" at the top of `docs/superpowers/plans/2026-10-13-online-coop.md`.

- [ ] **Step 4: Run the whole suite and the final manual checks**

Run:
```bash
npm run pwa && npm run check && npm test && npm run site
```
Expected: all tests PASS (including the former CRLF failure), `site: N files`.

Serve the built site from a **sub-path** to prove the relative paths work the way GitHub Pages serves it (`https://user.github.io/repo/`):
```bash
node -e "const fs=require('fs');fs.rmSync('_pages-check',{recursive:true,force:true});fs.mkdirSync('_pages-check');fs.cpSync('_site','_pages-check/repo',{recursive:true})"
python -m http.server 8090 --directory _pages-check
```
Open `http://localhost:8090/repo/` in the browser: the game must load (city, Superman, Jason), the Online tab must be present, and the console must show no 404s. Then delete `_pages-check`.

After pushing to `main` with Pages enabled, repeat the two-player test of Task 12 using two devices on different networks (or one device on mobile data) to find out which networks cannot connect with STUN only.

- [ ] **Step 5: Commit**

```bash
git add tools/build-site.mjs .github/workflows/pages.yml package.json .gitignore README.md ATTRIBUTION.md docs/superpowers/specs/2026-10-13-online-coop-design.md tests/build-site.test.js tests/v16-dynamic-events-integration.test.js
git commit -m "feat(net): publish to GitHub Pages and document the online co-op"
```
