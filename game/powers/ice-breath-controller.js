// damagePerSecond / chill* apply to Jason while he stands in the cone: damage ticks
// and a slow that lingers for chillSeconds after the last frozen breath.
export const ICE_BREATH_TUNING = Object.freeze({
  range:24, halfAngleDeg:22, coolingRate:0.42,
  damagePerSecond:16, chillSeconds:1.8, chillSlow:.5
});

// Is `point` (a target with the given body `radius`) inside the breath cone?
export function iceConeContains(origin, direction, point, tuning = ICE_BREATH_TUNING, radius = 0) {
  const v = { x:point.x - origin.x, y:point.y - origin.y, z:point.z - origin.z };
  const dist = Math.hypot(v.x, v.y, v.z);
  const dl = Math.hypot(direction.x, direction.y, direction.z);
  if (!dl) return false;
  if (dist > tuning.range + radius) return false;
  if (dist <= radius) return true;
  const forward = (v.x * direction.x + v.y * direction.y + v.z * direction.z) / dl;
  if (forward <= 0) return false;
  const angle = Math.acos(Math.min(1, forward / dist));
  const slack = Math.asin(Math.min(1, radius / dist));
  return angle <= tuning.halfAngleDeg * Math.PI / 180 + slack;
}

export class IceBreathController {
  constructor() { this.reset(); }
  get active() { return this.phase !== 'idle'; }

  requestStart({ airborne = false, canUse = true } = {}) {
    if (!canUse || this.phase !== 'idle') return null;
    this.phase = 'starting';
    this.variant = airborne ? 'air' : 'ground';
    this.held = true;
    return { type:'play-start', variant:this.variant };
  }

  requestStop() {
    if (this.phase === 'idle') return null;
    this.held = false;
    if (this.phase === 'starting' || this.phase === 'exiting') return null;
    if (this.phase === 'looping') {
      this.phase = 'exiting';
      return { type:'play-exit', variant:this.variant };
    }
    return null;
  }

  onStartFinished() {
    if (this.phase !== 'starting') return null;
    if (this.held) {
      this.phase = 'looping';
      return { type:'play-loop', variant:this.variant };
    }
    this.phase = 'exiting';
    return { type:'play-exit', variant:this.variant };
  }

  setAirborne(airborne) {
    if (this.phase !== 'looping') return null;
    const next = airborne ? 'air' : 'ground';
    if (next === this.variant) return null;
    this.variant = next;
    return { type:'switch-loop', variant:next };
  }

  forceStop() {
    if (this.phase === 'idle') return null;
    this.reset();
    return { type:'cancel' };
  }

  onExitFinished() {
    if (this.phase !== 'exiting') return null;
    this.reset();
    return null;
  }

  reset() {
    this.phase = 'idle';
    this.variant = null;
    this.held = false;
  }
}
