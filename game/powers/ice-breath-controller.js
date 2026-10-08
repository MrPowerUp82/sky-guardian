export const ICE_BREATH_TUNING = Object.freeze({ range:24, halfAngleDeg:22, coolingRate:0.42 });

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
