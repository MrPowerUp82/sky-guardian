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
