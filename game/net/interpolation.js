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
