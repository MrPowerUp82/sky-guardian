// Dynamic resolution scaling. Feed it the real frame time every frame; it returns
// a new pixel ratio when the average over a window is clearly too slow (step down
// quickly) or comfortably fast for several windows in a row (step up slowly).
export class AdaptiveResolution {
  constructor({ min = .7, max = 1.6, ratio = max, targetMs = 18, windowMs = 1200, step = .1, upWindows = 3, warmupMs = 3000 } = {}) {
    Object.assign(this, { min, max, targetMs, windowMs, step, upWindows, warmupMs });
    this.ratio = Math.min(max, Math.max(min, ratio));
    this.elapsed = 0;
    this.sumMs = 0;
    this.frames = 0;
    this.fastWindows = 0;
    this.age = 0;
    // Consecutive slow windows seen while already at the minimum ratio; the
    // caller uses it to decide when to cut other features.
    this.floorHits = 0;
  }

  // Returns the new ratio when it changed, otherwise null.
  sample(dtMs) {
    // Skip hitches that are not steady-state cost: tab switches, asset loading.
    if (!(dtMs > 0) || dtMs > 250) return null;
    this.age += dtMs;
    if (this.age < this.warmupMs) return null;
    this.elapsed += dtMs;
    this.sumMs += dtMs;
    this.frames++;
    if (this.elapsed < this.windowMs) return null;

    const avg = this.sumMs / this.frames;
    this.elapsed = this.sumMs = this.frames = 0;
    const before = this.ratio;
    if (avg > this.targetMs * 1.15) {
      this.fastWindows = 0;
      if (this.ratio <= this.min) this.floorHits++;
      // Bigger drop the further behind we are.
      const drops = avg > this.targetMs * 1.8 ? 2 : 1;
      this.ratio = Math.max(this.min, +(this.ratio - this.step * drops).toFixed(3));
    } else if (avg < this.targetMs * .75) {
      this.floorHits = 0;
      if (this.ratio >= this.max) return null;
      if (++this.fastWindows >= this.upWindows) {
        this.fastWindows = 0;
        this.ratio = Math.min(this.max, +(this.ratio + this.step).toFixed(3));
      }
    } else {
      this.fastWindows = 0;
      this.floorHits = 0;
    }
    return this.ratio !== before ? this.ratio : null;
  }
}
