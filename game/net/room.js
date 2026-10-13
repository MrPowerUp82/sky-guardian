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
    setTimeout(() => entry.conn.close(), this.tuning.closeGraceMs);
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
      const entries = [...this.peers.values()];
      this.peers.clear();
      // Closing right after sending can drop the 'leave' on real WebRTC links: give it time to arrive.
      setTimeout(() => { for (const entry of entries) entry.conn.close(); this.handle?.close(); }, this.tuning.closeGraceMs);
    } else {
      this.closed = true;
      this.conn?.close();
    }
  }
}
