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
function makeFakePeer({ failWith = null, hosts = new Map(), made = [] } = {}) {
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
      made.push(conn);
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

test('peer network: a non-fatal connection error does not end the room, a real close does', async () => {
  const hosts = new Map(), made = [];
  const Peer = makeFakePeer({ hosts, made });
  const net = createPeerNetwork({ Peer });
  const host = await net.host('ABCD');
  let hostSide;
  host.onConnection(conn => { hostSide = conn; });
  const guest = await net.join('ABCD');
  await flush();
  let closes = 0;
  guest.onClose(() => closes++);
  assert.ok(hostSide, 'host got the connection');
  const underlying = made[0];                     // the guest's PeerJS-level connection
  underlying.emit('error', new Error('transient data channel error'));
  assert.equal(closes, 0, 'an error on an open connection is not a close');
  underlying.open = false;
  underlying.emit('error', new Error('connection is gone'));
  assert.equal(closes, 1, 'an error on a connection that is no longer open ends it');
});
