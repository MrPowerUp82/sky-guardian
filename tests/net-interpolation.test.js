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

test('late and out-of-order packets are ignored; a packet in the same millisecond replaces the last one', () => {
  const buf = new SnapshotBuffer({ delayMs: 0 });
  buf.push(1000, S(0)); buf.push(1100, S(10));
  buf.push(1100, S(99));                              // same stamp (coarse timers): the newer data wins
  buf.push(1050, S(55)); buf.push(900, S(-5));        // older than the newest: dropped
  assert.equal(buf.length, 2);
  near(buf.latest().x, 99);
  near(buf.sample(1050).x, 49.5);
});

test('packets delivered back to back do not blow up the extrapolated distance', () => {
  const buf = new SnapshotBuffer({ delayMs: 0, maxExtrapolateMs: 150, minSpanMs: 50 });
  buf.push(1000, S(0)); buf.push(1000.1, S(5));       // two packets that arrived together
  const s = buf.sample(1150);
  assert.ok(s.x <= 5 + 5 * (150 / 50) + 1e-9, `extrapolated to ${s.x}`);
  assert.ok(s.x >= 5);
});

test('capacity drops the oldest sample; clear empties', () => {
  const buf = new SnapshotBuffer({ capacity: 3 });
  for (let i = 0; i < 6; i++) buf.push(1000 + i * 100, S(i));
  assert.equal(buf.length, 3);
  buf.clear();
  assert.equal(buf.length, 0);
});
