// Poise decides when a hit interrupts the boss. Light hits wear poise down and
// only stagger once it breaks; heavy hits stagger at once. After a stagger the
// boss gets a short immunity window, so neither punch spam nor chained super
// punches can keep him in hit reactions forever. Hits during his own attack
// wind-up are absorbed by super armor unless they are heavy.
export const ENEMY_POISE_TUNING = Object.freeze({
  max: 40,
  regenDelay: 1.4,
  regenRate: 24,
  staggerImmunity: 1.25
});

export class EnemyPoise {
  constructor(tuning = ENEMY_POISE_TUNING) {
    this.tuning = { ...ENEMY_POISE_TUNING, ...tuning };
    this.reset();
  }

  reset() {
    this.value = this.tuning.max;
    this.immunity = 0;
    this.sinceHit = Infinity;
  }

  // Returns 'stagger' when the hit should interrupt, otherwise 'absorbed'.
  registerHit(damage, { heavy = false, armored = false } = {}) {
    this.sinceHit = 0;
    this.value = Math.max(0, this.value - Math.max(0, Number(damage) || 0));
    if (this.immunity > 0) return 'absorbed';
    if (armored && !heavy) return 'absorbed';
    if (!heavy && this.value > 0) return 'absorbed';
    this.value = this.tuning.max;
    this.immunity = this.tuning.staggerImmunity;
    return 'stagger';
  }

  update(dt) {
    const step = Math.max(0, Number(dt) || 0);
    this.immunity = Math.max(0, this.immunity - step);
    this.sinceHit += step;
    if (this.sinceHit >= this.tuning.regenDelay) {
      this.value = Math.min(this.tuning.max, this.value + this.tuning.regenRate * step);
    }
  }
}

// Boss scaling per round: more health, harder hits and a faster pace.
export function enemyLevelStats(level = 1) {
  const n = Math.max(1, Math.floor(Number(level) || 1)) - 1;
  return {
    maxHealth: 180 + n * 45,
    damageScale: 1 + n * 0.15,
    speedScale: Math.min(1.45, 1 + n * 0.06)
  };
}
