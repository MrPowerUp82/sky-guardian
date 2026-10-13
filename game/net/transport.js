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
    onClose(fn) {
      conn.on('close', fn);
      // PeerJS also emits 'error' for hiccups on a link that is still open; only a link that is gone ends the room.
      conn.on('error', err => {
        if (conn.open) console.warn('[net] erro de conexão ignorado:', err?.message || err);
        else fn();
      });
    }
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
