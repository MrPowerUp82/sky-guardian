// Pure rules for The Flash (speed, energy, animation timing, lightning geometry).
// Nothing here touches three.js, so it is unit-tested in Node.

export const FLASH_TUNING = Object.freeze({
  baseSpeed: 13,          // m/s, normal run
  sprintMax: 72,          // m/s with the Speed Force
  sprintAccel: 46,        // m/s^2 toward the sprint target
  decel: 60,              // m/s^2 when no input
  gravity: 30,
  jumpSpeed: 13.5,
  doubleJumpSpeed: 11.5,
  airControl: .45,        // fraction of ground acceleration available in the air
  dashDistance: 17,
  dashDuration: .2,
  dashCooldown: .8,
  wallSpeed: 27,          // m/s climbing a facade
  wallMinSpeed: 22,       // sprint speed needed to start a wall run
  energyMax: 100,
  energyRegen: 15,
  exhaustedUntil: 22,     // after hitting 0, sprint stays locked until this much is back
  costs: { flurry: 25, bolt: 18, tornado: 30, dash: 8 },
  drains: { sprint: 7, slow: 20, wind: 15, wall: 9 },
  slowScale: .22          // world time scale while Tempo Lento is active
});

// Move `current` toward `target` by at most `rate * dt`.
export function approach(current, target, rate, dt) {
  const step = Math.max(0, rate) * Math.max(0, dt);
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

// Speed the Flash is trying to reach on the ground.
export function targetSpeed({ hasInput, sprinting, exhausted }, tuning = FLASH_TUNING) {
  if (!hasInput) return 0;
  return sprinting && !exhausted ? tuning.sprintMax : tuning.baseSpeed;
}

/**
 * One energy step. `usage` = { sprint, slow, wind, wall } booleans. Returns the
 * new energy and exhausted flag; regeneration only happens while nothing drains.
 */
export function stepEnergy({ energy, exhausted }, usage, dt, tuning = FLASH_TUNING) {
  let drain = 0;
  for (const [name, rate] of Object.entries(tuning.drains)) if (usage[name]) drain += rate;
  let next = drain > 0 ? energy - drain * dt : energy + tuning.energyRegen * dt;
  next = Math.min(tuning.energyMax, Math.max(0, next));
  let nowExhausted = exhausted;
  if (next <= 0) nowExhausted = true;
  else if (exhausted && next >= tuning.exhaustedUntil) nowExhausted = false;
  return { energy: next, exhausted: nowExhausted };
}

export function canAfford(energy, cost) {
  return energy >= cost;
}

// 0..1 sprint intensity used by camera, blur and lightning.
export function sprintLevel(speed, tuning = FLASH_TUNING) {
  const t = (speed - tuning.baseSpeed * 1.2) / (tuning.sprintMax - tuning.baseSpeed * 1.2);
  return Math.min(1, Math.max(0, t));
}

export function pickLocomotion(speed) {
  if (speed < .6) return 'stand';
  if (speed < 6.5) return 'walk';
  return 'run';
}

// Playback rate of the run/walk clips so the feet keep up with the ground.
export function locomotionScale(clip, speed) {
  if (clip === 'walk') return Math.min(1.8, Math.max(.6, speed / 3.4));
  if (clip === 'run') return Math.min(3.4, Math.max(.8, speed / 7.2));
  return 1;
}

// Seconds (from the start of the action) at which a punch lands, for a given
// playback rate. The authored `punch` clip is an 8-hit boxing combo.
export const PUNCH_HIT_TIMES = Object.freeze([.36, .66, .95, 1.25, 1.65, 1.91, 2.18, 2.4]);
export function flurrySchedule(rate = 1.8, start = .16) {
  return PUNCH_HIT_TIMES.map(t => Math.max(0, (t - start) / rate));
}

// Point where the Flash should stop in front of a target he is running to.
export function approachPoint(from, target, standOff = 1.7) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: target.x, z: target.z };
  const k = Math.max(0, d - standOff) / d;
  return { x: from.x + dx * k, z: from.z + dz * k };
}

// Closest approach between a ray (origin + t*dir, t in [0, maxT]) and a point.
export function rayPointClosest(origin, dir, point, maxT = Infinity) {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const v = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
  const t = Math.min(maxT, Math.max(0, v.x * d.x + v.y * d.y + v.z * d.z));
  const c = { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t };
  return { t, distance: Math.hypot(point.x - c.x, point.y - c.y, point.z - c.z) };
}

/**
 * Jagged lightning polyline from `a` to `b`. Returns [x,y,z,...] with
 * `segments + 1` points; endpoints are exact, inner points are displaced
 * perpendicular to the line by up to `jitter` (largest in the middle).
 */
export function jaggedPath(a, b, segments, jitter, rand = Math.random) {
  const out = new Float32Array((segments + 1) * 3);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  // Two axes perpendicular to the segment.
  let ux = -dz, uy = 0, uz = dx;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  const vx = (dy * uz - dz * uy) / len, vy = (dz * ux - dx * uz) / len, vz = (dx * uy - dy * ux) / len;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const envelope = i === 0 || i === segments ? 0 : Math.sin(t * Math.PI);
    const ju = (rand() * 2 - 1) * jitter * envelope;
    const jv = (rand() * 2 - 1) * jitter * envelope;
    out[i * 3] = a.x + dx * t + ux * ju + vx * jv;
    out[i * 3 + 1] = a.y + dy * t + uy * ju + vy * jv;
    out[i * 3 + 2] = a.z + dz * t + uz * ju + vz * jv;
  }
  return out;
}
