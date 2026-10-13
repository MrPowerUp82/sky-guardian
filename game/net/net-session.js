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
      this.room.send({ t: 'world', boss: this.game.getBossState(), fires: this.game.getFireSnapshot(), meteors: this.game.getMeteorSnapshot() });
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
      case 'world': if (this.isGuest) { game.applyBossState(msg.boss); game.applyFireSnapshot(msg.fires); game.applyMeteorSync(msg.meteors); } break;
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
    else {
      if (this.cool) this.room.send({ t: 'cool', ...this.cool });     // never discard a request that was waiting
      this.cool = { ...params };
    }
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
