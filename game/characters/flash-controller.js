import * as THREE from 'three';
import {
  FLASH_TUNING as T, approach, targetSpeed, stepEnergy, canAfford, sprintLevel, pickLocomotion, locomotionScale,
  flurrySchedule, approachPoint, rayPointClosest
} from './flash-math.js';

// The Flash: ground sprinting with the Speed Force, wall running, jumping and a
// kit of exclusive abilities. It owns hero.position / hero.rotation while active
// and talks to the rest of the game only through the `api` object that main.js
// passes in, so none of Superman's flight code is involved.

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Cleans the authored Mixamo clips: the Hips carry world-space drift in X/Z that
 * would slide the character and pop on loops, and `jumpUp` is a single pose with
 * zero duration. Returns a Map name -> clip.
 */
export function prepareFlashClips(animations) {
  const clips = new Map();
  for (const source of animations) {
    const tracks = source.tracks.map(track => {
      if (!/Hips.*\.position$/.test(track.name)) return track;
      const values = new Float32Array(track.values);
      for (let i = 0; i < values.length; i += 3) { values[i] = 0; values[i + 2] = 0; }
      return new THREE.VectorKeyframeTrack(track.name, track.times, values);
    });
    const duration = source.duration > 0 ? source.duration : 1;
    clips.set(source.name, new THREE.AnimationClip(source.name, duration, tracks));
  }
  return clips;
}

export class FlashController {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.hero root that is moved around the world
   * @param {THREE.Vector3} o.velocity shared with the rest of the game
   * @param {object} o.keys pressed-key map
   * @param {THREE.Object3D} o.pivot parent of the model; tilted/spun procedurally
   * @param {THREE.Object3D} o.model Flash scene graph
   * @param {THREE.AnimationMixer} o.mixer
   * @param {Map<string, THREE.AnimationClip>} o.clips prepared with prepareFlashClips
   * @param {Function} o.crossfade (mixer, root, clip, current, fade) => action
   * @param {object} o.fx SpeedForceFx
   * @param {object} o.bursts ParticleBursts
   * @param {object} o.api game callbacks (see main.js)
   */
  constructor({ hero, velocity, keys, pivot, model, mixer, clips, crossfade, fx, bursts, api }) {
    Object.assign(this, { hero, velocity, keys, pivot, model, mixer, clips, crossfade, fx, bursts, api });
    this.reset();
    this._wish = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._hit = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    // Dedicated scratch space for helpers that run while others hold _tmp/_tmp2.
    this._f1 = new THREE.Vector3();
    this._f2 = new THREE.Vector3();
    this._b = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  reset() {
    this.state = 'ground';       // 'ground' | 'air' | 'wall'
    this.energy = T.energyMax;
    this.exhausted = false;
    this.timeScale = 1;
    this.sprint01 = 0;
    this.speed = 0;
    this.action = null;          // { type, t, dur, ... }
    this.slow = false;
    this.wind = false;
    this.jumps = 0;
    this.wall = null;
    this.dashCooldown = 0;
    this.boltCooldown = 0;
    this.sprintAnnounced = false;
    this.fallTimer = 0;
    this.footClock = 0;
    this.current = null;
    this.currentName = '';
    this.spin = 0;
    this.lean = 0;
    this.landedFlash = 0;
    this.usage = {};
    this.fx?.clear?.();
    if (this.pivot) { this.pivot.rotation.set(0, 0, 0); }
    if (this.mixer) this.mixer.stopAllAction();
  }

  // ---- animation -----------------------------------------------------------------
  play(name, { fade = .14, rate = 1, loop = true, time = 0, clamp = !loop } = {}) {
    const clip = this.clips.get(name);
    if (!clip) return null;
    const next = this.crossfade(this.mixer, this.model, clip, this.current, fade);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = clamp;
    next.timeScale = rate;
    next.time = time;
    this.current = next;
    this.currentName = name;
    return next;
  }

  // Keeps a looping clip going, only retuning its speed when it is already playing.
  ensure(name, rate, opts = {}) {
    if (this.currentName === name && this.current && this.current.isRunning()) { this.current.timeScale = rate; return; }
    this.play(name, { ...opts, rate });
  }

  // ---- input ------------------------------------------------------------------------
  onKeyDown(e) {
    if (this.api.isDead() || e.repeat) return;
    switch (e.code) {
      case 'KeyF': this.jump(); break;
      case 'Space': this.dash(); break;
      case 'KeyE': this.flurry(); break;
      case 'KeyX': this.bolt(); break;
      case 'KeyC': this.tornado(); break;
      case 'KeyQ': this.slow = true; break;
      case 'KeyG': this.wind = true; break;
      default: break;
    }
  }

  onKeyUp(e) {
    if (e.code === 'KeyQ') this.slow = false;
    if (e.code === 'KeyG') this.wind = false;
  }

  get busy() { return !!this.action && this.action.type !== 'wind'; }

  // ---- abilities ----------------------------------------------------------------------
  jump() {
    if (this.busy || this.state === 'wall') { if (this.state === 'wall') this.leaveWall(true); return; }
    if (this.state === 'ground') {
      this.velocity.y = T.jumpSpeed * (1 + .3 * this.sprint01);
      this.state = 'air';
      this.jumps = 1;
      this.fallTimer = 0;
      this.fx.ring(this._tmp.set(this.hero.position.x, this.hero.position.y + .1, this.hero.position.z), { size: 5, life: .3 });
      this.api.dust(this.hero.position, 12, 2);
    } else if (this.jumps < 2 && canAfford(this.energy, 4)) {
      this.jumps = 2;
      this.energy -= 4;
      this.velocity.y = T.doubleJumpSpeed;
      this.fallTimer = 0;
      this.fx.ring(this._tmp.set(this.hero.position.x, this.hero.position.y + .4, this.hero.position.z), { size: 6, life: .35 });
      this.fx.bolt(this._tmp.set(this.hero.position.x - .8, this.hero.position.y + .3, this.hero.position.z), this._tmp2.set(this.hero.position.x + .8, this.hero.position.y + 2, this.hero.position.z), { life: .15, width: 2.6 });
      this.api.zap(.5);
    }
  }

  dash() {
    const dodge = this.api.dodge;
    if (dodge.active || dodge.cooldown > 0 || this.api.isDead() || !canAfford(this.energy, T.costs.dash)) return;
    if (this.state === 'wall') this.leaveWall(false);
    if (this.action) this.cancelAction();
    this.energy -= T.costs.dash;
    const dir = this._dir;
    this.inputDirection(dir);
    if (dir.lengthSq() < .01) dir.set(0, 0, 1).applyAxisAngle(UP, this.hero.rotation.y);
    dir.y = 0; dir.normalize();
    dodge.active = true; dodge.elapsed = 0; dodge.cooldown = T.dashCooldown;
    dodge.airborne = this.state !== 'ground'; dodge.backward = false; dodge.side = 0;
    dodge.direction.copy(dir);
    this.api.setInvuln(this.api.DODGE_DURATION + .14);
    this.dashSpeed = T.dashDistance / this.api.DODGE_DURATION;
    this.fx.ghost(.45);
    this.fx.ring(this._tmp.set(this.hero.position.x, this.hero.position.y + .1, this.hero.position.z), { size: 6, life: .3 });
    const end = this._tmp2.copy(this.hero.position).addScaledVector(dir, T.dashDistance);
    this.fx.bolt(this._tmp.set(this.hero.position.x, this.hero.position.y + 1, this.hero.position.z), end.setY(end.y + 1), { life: .22, width: 3.4, jitter: .5 });
    this.api.zap(.7);
    this.api.flashBody('dodge-flash', 160);
    this.api.message('ESQUIVA RELÂMPAGO', 450);
  }

  flurry() {
    if (this.busy || this.api.isDead() || this.state === 'wall') return;
    const enemy = this.api.enemy();
    const target = enemy.alive && enemy.pos.distanceTo(this.hero.position) < 55 ? enemy.pos : null;
    const cost = target ? T.costs.flurry : Math.ceil(T.costs.flurry / 3);
    if (!canAfford(this.energy, cost)) { this.api.message('SEM FORÇA DA VELOCIDADE', 500); return; }
    this.energy -= cost;
    this.api.cancelWind?.();
    const rate = 1.8, start = .16;
    if (target) {
      // Streak to the target in a flash, leaving an afterimage where he stood.
      this.fx.ghost(.5);
      const from = this._tmp.set(this.hero.position.x, this.hero.position.y + 1, this.hero.position.z);
      const stop = approachPoint(this.hero.position, target, 1.75);
      this.hero.position.x = stop.x; this.hero.position.z = stop.z;
      this.hero.position.y = this.api.surfaceAt(stop.x, stop.z) + this.api.groundEps;
      this.fx.bolt(from, this._tmp2.set(stop.x, this.hero.position.y + 1, stop.z), { life: .28, width: 4.2, jitter: .8 });
      this.fx.ring(this._tmp2.set(stop.x, this.hero.position.y + .1, stop.z), { size: 8, life: .35 });
      this.state = 'ground'; this.velocity.set(0, 0, 0);
    }
    const hits = flurrySchedule(rate, start);
    this.action = { type: 'flurry', t: 0, dur: hits[hits.length - 1] + .5, hits, next: 0, target: !!target };
    this.play('punch', { fade: .05, rate, loop: false, time: start });
    this.api.zap(1);
    this.api.message(target ? 'RAJADA DE SOCOS!' : 'RAJADA DE SOCOS · sem alvo', 700);
  }

  bolt() {
    if (this.busy || this.api.isDead() || this.boltCooldown > 0 || this.state === 'wall') return;
    if (!canAfford(this.energy, T.costs.bolt)) { this.api.message('SEM FORÇA DA VELOCIDADE', 500); return; }
    this.energy -= T.costs.bolt;
    this.boltCooldown = .55;
    this.action = { type: 'bolt', t: 0, dur: .5, fired: false };
    this.play('punch', { fade: .05, rate: 2.6, loop: false, time: .26 });
  }

  fireBolt() {
    const api = this.api;
    const [origin, end, probe, scratch, branch] = this._b;
    origin.copy(this.hero.position).add(scratch.set(0, 1.45, 0));
    const dir = api.aim(this._dir);
    const range = 170;
    end.copy(origin).addScaledVector(dir, range);
    let kind = 'miss';

    // Buildings stop the bolt.
    this._ray.set(origin, dir);
    let wallT = range;
    probe.copy(origin).addScaledVector(dir, range);
    for (const box of api.collidersAlong(origin, probe, 1)) {
      const p = this._ray.intersectBox(box, scratch);
      if (p) wallT = Math.min(wallT, p.distanceTo(origin));
    }
    end.copy(origin).addScaledVector(dir, wallT);
    if (wallT < range) kind = 'wall';

    // Meteors are the best target.
    const meteor = api.meteorPosition();
    if (meteor) {
      const miss = rayPointClosest(origin, dir, meteor, wallT);
      if (miss.distance < 7) { end.copy(meteor); kind = 'meteor'; }
    }
    if (kind !== 'meteor' && api.enemyUnderAim(wallT, 2.1)) {
      end.copy(api.enemy().pos).y += 1.2;
      kind = 'enemy';
    }

    this.fx.bolt(origin, end, { life: .28, width: 5, jitter: Math.min(1.6, .3 + origin.distanceTo(end) * .02), glow: 1.4 });
    for (let i = 0; i < 2; i++) {
      branch.copy(end).add(scratch.set((Math.random() - .5) * 8, (Math.random() - .2) * 6, (Math.random() - .5) * 8));
      this.fx.bolt(end, branch, { life: .2, width: 2.4, jitter: .6, red: i === 1 });
    }
    this.fx.ring(end, { size: 7, life: .35, vertical: dir.clone().negate() });
    this.bursts.sparks(end, { count: 26, power: 1.2, color: [1, .85, .3] });
    api.shake(.35);
    api.zap(1.2);
    if (kind === 'enemy') api.damageEnemy(34, this.hero.position, 3.2, 'RAIO');
    else if (kind === 'meteor') { api.interceptMeteor(); api.message('METEORO DESTRUÍDO!', 900); }
  }

  tornado() {
    if (this.busy || this.api.isDead() || this.state === 'wall') return;
    if (!canAfford(this.energy, T.costs.tornado)) { this.api.message('SEM FORÇA DA VELOCIDADE', 500); return; }
    this.energy -= T.costs.tornado;
    this.api.cancelWind?.();
    this.action = { type: 'tornado', t: 0, dur: 1.25, tick: 0 };
    this.velocity.multiplyScalar(.2);
    this.api.message('TORNADO RELÂMPAGO!', 700);
    this.api.zap(1);
  }

  cancelAction() {
    this.action = null;
    this.spin = 0;
    this.current?.fadeOut?.(.1);
    this.currentName = '';
  }

  // ---- movement helpers --------------------------------------------------------------
  inputDirection(out) {
    const yaw = this.api.yaw();
    this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this._right.crossVectors(this._fwd, UP).normalize();
    out.set(0, 0, 0);
    if (this.keys.KeyW) out.add(this._fwd);
    if (this.keys.KeyS) out.sub(this._fwd);
    if (this.keys.KeyD) out.add(this._right);
    if (this.keys.KeyA) out.sub(this._right);
    out.y = 0;
    if (out.lengthSq() > 0) out.normalize();
    return out;
  }

  // Looks for a tall facade directly ahead of a fast run.
  findWall(prev, dir, reach) {
    const from = this._f1.set(prev.x, prev.y + 1, prev.z);
    const to = this._f2.copy(from).addScaledVector(dir, reach);
    this._ray.set(from, dir);
    let best = null;
    for (const box of this.api.collidersAlong(from, to, 1)) {
      if (box.max.y < this.hero.position.y + 5) continue;
      const p = this._ray.intersectBox(box, this._b[0]);
      if (!p) continue;
      const d = p.distanceTo(from);
      if (d > reach || (best && d >= best.d)) continue;
      // Which face did we hit? Pick the closest side plane.
      const faces = [
        [Math.abs(p.x - box.min.x), -1, 0], [Math.abs(p.x - box.max.x), 1, 0],
        [Math.abs(p.z - box.min.z), 0, -1], [Math.abs(p.z - box.max.z), 0, 1]
      ].sort((a, b) => a[0] - b[0])[0];
      if (faces[0] > .3) continue; // hit the roof or an edge
      best = { d, box, nx: faces[1], nz: faces[2] };
    }
    return best;
  }

  startWall(found) {
    const { box, nx, nz } = found;
    this.state = 'wall';
    this.wall = { box, nx, nz, top: box.max.y };
    this.jumps = 0;
    this.velocity.set(0, 0, 0);
    // Stick to the facade, facing into it.
    if (nx) this.hero.position.x = nx > 0 ? box.max.x + .12 : box.min.x - .12;
    if (nz) this.hero.position.z = nz > 0 ? box.max.z + .12 : box.min.z - .12;
    this.hero.rotation.y = Math.atan2(-nx, -nz);
    this.fx.ring(this._tmp.set(this.hero.position.x, this.hero.position.y + 1, this.hero.position.z), { size: 6, life: .3, vertical: this._tmp2.set(nx, 0, nz) });
    this.api.message('CORRIDA NA PAREDE', 700);
    this.api.zap(.8);
  }

  leaveWall(jumpOff) {
    if (this.state !== 'wall') return;
    const { nx, nz } = this.wall;
    this.state = 'air';
    this.velocity.set(nx * (jumpOff ? 12 : 3), jumpOff ? 12 : 2, nz * (jumpOff ? 12 : 3));
    this.jumps = jumpOff ? 1 : 0;
    this.wall = null;
    this.fallTimer = 0;
  }

  // ---- per-frame update ---------------------------------------------------------------
  update(dt, time) {
    const api = this.api;
    const hero = this.hero, velocity = this.velocity;
    const dead = api.isDead();
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.boltCooldown = Math.max(0, this.boltCooldown - dt);
    this.landedFlash = Math.max(0, this.landedFlash - dt);

    const dodge = api.dodge;
    const wish = this.inputDirection(this._wish);
    const hasInput = !dead && wish.lengthSq() > 0;
    const sprintHeld = !dead && (this.keys.ShiftLeft || this.keys.ShiftRight);
    const sprinting = sprintHeld && hasInput && !this.exhausted && this.energy > 0 && !this.action;

    // --- ability timers ---
    let usage = { sprint: false, slow: false, wind: false, wall: false };
    this.updateAction(dt, time);
    const windOn = this.wind && !dead && !this.exhausted && this.energy > 0 && (!this.action || this.action.type === 'wind') && this.state === 'ground';
    if (windOn && !this.action) this.startWind();
    if (!windOn && this.action?.type === 'wind') this.action = null;
    if (windOn) { usage.wind = true; this.updateWind(dt, time); }
    const slowOn = this.slow && !dead && this.energy > 0 && !this.exhausted;
    usage.slow = slowOn;
    this.timeScale = approach(this.timeScale, slowOn ? T.slowScale : 1, 5, dt);
    if (slowOn && !this.slowAnnounced) { this.slowAnnounced = true; api.message('TEMPO LENTO', 600); api.zap(.4); }
    if (!slowOn) this.slowAnnounced = false;

    // --- movement ---
    const prev = this._prev.copy(hero.position);
    const frozen = this.action && (this.action.type === 'flurry' || this.action.type === 'bolt');
    if (dead) {
      velocity.x *= Math.exp(-6 * dt); velocity.z *= Math.exp(-6 * dt);
      hero.position.addScaledVector(velocity, dt);
      this.state = 'ground';
      hero.position.y = api.surfaceAt(hero.position.x, hero.position.z) + api.groundEps;
    } else if (dodge.active) {
      velocity.set(dodge.direction.x * this.dashSpeed, this.state === 'air' ? velocity.y * .3 : 0, dodge.direction.z * this.dashSpeed);
      this.afterDash(dt);
      this.integrate(dt, prev, true);
    } else if (this.state === 'wall') {
      usage.wall = true;
      this.updateWall(dt, wish, sprintHeld);
    } else if (this.state === 'ground') {
      this.updateGround(dt, wish, hasInput, sprinting, frozen);
      if (sprinting && this.speed > 8) usage.sprint = true;
    } else {
      this.updateAir(dt, wish, hasInput);
      if (sprinting && this.speed > 20) usage.sprint = true;
    }

    // --- bounds ---
    hero.position.x = THREE.MathUtils.clamp(hero.position.x, -api.worldLimit, api.worldLimit);
    hero.position.z = THREE.MathUtils.clamp(hero.position.z, -api.worldLimit, api.worldLimit);

    // --- energy ---
    const e = stepEnergy({ energy: this.energy, exhausted: this.exhausted }, usage, dt);
    const wasExhausted = this.exhausted;
    this.energy = e.energy; this.exhausted = e.exhausted;
    if (this.exhausted && !wasExhausted) api.message('FORÇA DA VELOCIDADE ESGOTADA', 900);
    if (!this.exhausted && wasExhausted) api.message('FORÇA DA VELOCIDADE PRONTA', 600);

    // --- visuals ---
    this.speed = Math.hypot(velocity.x, velocity.z);
    const target = this.state === 'wall' ? Math.max(.5, sprintLevel(this.speed)) : sprintLevel(this.speed);
    this.sprint01 = approach(this.sprint01, this.state === 'wall' ? .9 : target, 2.5, dt);
    this.animate(dt, hasInput);
    this.effects(dt, time, usage);
    this.hud();
  }

  afterDash(dt) {
    this.fx.afterimages(dt, 1);
    this.bursts.sparks(this._tmp.set(this.hero.position.x, this.hero.position.y + 1, this.hero.position.z), { count: 3, power: .7, color: [1, .8, .2] });
  }

  integrate(dt, prev, collide) {
    const hero = this.hero;
    hero.position.addScaledVector(this.velocity, dt);
    if (collide) this.api.resolveCollision(prev);
  }

  updateGround(dt, wish, hasInput, sprinting, frozen) {
    const hero = this.hero, velocity = this.velocity, api = this.api;
    if (frozen || this.action?.type === 'wind') {
      velocity.x *= Math.exp(-14 * dt); velocity.z *= Math.exp(-14 * dt); velocity.y = 0;
    } else {
      const spin = this.action?.type === 'tornado';
      const horizontal = this._tmp.set(velocity.x, 0, velocity.z);
      let speed = horizontal.length();
      const goal = spin ? 3 : targetSpeed({ hasInput, sprinting, exhausted: this.exhausted });
      if (hasInput && speed > 6) {
        // Steer the existing momentum toward the input direction (big arcs at top speed).
        const turn = THREE.MathUtils.lerp(7, 2.1, THREE.MathUtils.clamp(speed / T.sprintMax, 0, 1));
        const cur = Math.atan2(horizontal.x, horizontal.z), want = Math.atan2(wish.x, wish.z);
        let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
        const step = THREE.MathUtils.clamp(d, -turn * dt, turn * dt);
        const heading = cur + step;
        horizontal.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
      } else if (hasInput && speed <= 6) {
        horizontal.copy(wish).multiplyScalar(Math.max(speed, 2));
        speed = horizontal.length();
      }
      speed = approach(speed, goal, goal > speed ? T.sprintAccel * (sprinting ? 1 : 1.6) : T.decel, dt);
      if (horizontal.lengthSq() > 1e-6) horizontal.setLength(speed); else horizontal.set(0, 0, 0);
      velocity.set(horizontal.x, velocity.y > 1.5 ? velocity.y : 0, horizontal.z);
    }

    const prev = this._prev.copy(hero.position);
    // Running flat out into a tall building: climb it.
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed >= T.wallMinSpeed && this.keys.KeyW && !this.exhausted && !this.action) {
      const dir = this._dir.set(velocity.x, 0, velocity.z).normalize();
      const found = this.findWall(prev, dir, speed * dt + .9);
      if (found && -(found.nx * dir.x + found.nz * dir.z) > .55) { this.startWall(found); return; }
    }
    hero.position.addScaledVector(velocity, dt);
    api.resolveCollision(prev);

    const surface = api.surfaceAt(hero.position.x, hero.position.z);
    if (velocity.y > 1.5) { this.state = 'air'; this.jumps = 1; return; }
    if (hero.position.y - api.groundEps - surface > .7) {
      this.state = 'air'; this.jumps = 1; this.fallTimer = 0; velocity.y = Math.min(velocity.y, 0);
    } else {
      hero.position.y = surface + api.groundEps;
      velocity.y = 0;
    }

    // Face where we run (or the enemy while striking).
    if (this.action?.type === 'flurry' && this.action.target) {
      const e = api.enemy().pos;
      hero.rotation.y = Math.atan2(e.x - hero.position.x, e.z - hero.position.z);
    } else if (this.action?.type === 'bolt') {
      const aim = api.aim(this._dir);
      hero.rotation.y = Math.atan2(aim.x, aim.z);
    } else if (speed > .8 && !this.action) {
      hero.rotation.y = lerpAngle(hero.rotation.y, Math.atan2(velocity.x, velocity.z), 1 - Math.exp(-14 * dt));
    }
  }

  updateAir(dt, wish, hasInput) {
    const hero = this.hero, velocity = this.velocity, api = this.api;
    velocity.y -= T.gravity * dt;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (hasInput && !this.action) {
      const cap = Math.max(speed, T.baseSpeed);
      velocity.x += wish.x * T.sprintAccel * T.airControl * dt;
      velocity.z += wish.z * T.sprintAccel * T.airControl * dt;
      const now = Math.hypot(velocity.x, velocity.z);
      if (now > cap) { velocity.x *= cap / now; velocity.z *= cap / now; }
    } else {
      velocity.x *= Math.exp(-.35 * dt); velocity.z *= Math.exp(-.35 * dt);
    }
    const prev = this._prev.copy(hero.position);
    hero.position.addScaledVector(velocity, dt);
    api.resolveCollision(prev);
    this.fallTimer += dt;

    const surface = api.surfaceAt(hero.position.x, hero.position.z);
    if (velocity.y <= 0 && hero.position.y <= surface + api.groundEps) {
      const impact = -velocity.y;
      hero.position.y = surface + api.groundEps;
      velocity.y = 0;
      this.state = 'ground';
      this.jumps = 0;
      this.landedFlash = .2;
      if (impact > 14) {
        api.dust(hero.position, Math.round(10 + impact), 3.5);
        this.fx.ring(this._tmp.set(hero.position.x, hero.position.y + .1, hero.position.z), { size: 5 + impact * .2, life: .35 });
        api.shake(Math.min(.45, impact * .015));
      }
    }
    const sp = Math.hypot(velocity.x, velocity.z);
    if (sp > .8 && !this.action) hero.rotation.y = lerpAngle(hero.rotation.y, Math.atan2(velocity.x, velocity.z), 1 - Math.exp(-9 * dt));
  }

  updateWall(dt, wish, sprintHeld) {
    const hero = this.hero, velocity = this.velocity, api = this.api;
    const { box, nx, nz } = this.wall;
    const up = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? .6 : 0);
    if (up <= 0 || this.exhausted || !sprintHeld && this.energy <= 0) { this.leaveWall(false); return; }
    // Slide sideways along the facade with A/D.
    const side = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const yaw = api.yaw();
    // tangent perpendicular to the wall normal, oriented to the camera's right
    const tx = -nz, tz = nx;
    const camRight = Math.cos(yaw) * tx + (-Math.sin(yaw)) * tz;
    const lateral = side * Math.sign(camRight || 1) * 9;
    velocity.set(tx * lateral, T.wallSpeed * (sprintHeld ? 1.25 : 1), tz * lateral);
    hero.position.addScaledVector(velocity, dt);
    // Stay on the facade face and inside its width.
    if (nx) hero.position.x = nx > 0 ? box.max.x + .12 : box.min.x - .12;
    if (nz) hero.position.z = nz > 0 ? box.max.z + .12 : box.min.z - .12;
    if (nx) hero.position.z = THREE.MathUtils.clamp(hero.position.z, box.min.z + .5, box.max.z - .5);
    if (nz) hero.position.x = THREE.MathUtils.clamp(hero.position.x, box.min.x + .5, box.max.x - .5);
    hero.rotation.y = Math.atan2(-nx, -nz);
    if (hero.position.y >= this.wall.top) {
      // Over the edge: land on the roof carrying momentum.
      hero.position.x -= nx * 2.2; hero.position.z -= nz * 2.2;
      hero.position.y = this.wall.top + api.groundEps;
      this.state = 'ground'; this.wall = null;
      velocity.set(-nx * 16, 0, -nz * 16);
      this.fx.ring(this._tmp.set(hero.position.x, hero.position.y + .1, hero.position.z), { size: 7, life: .4 });
      api.dust(hero.position, 16, 3);
      api.message('NO TOPO!', 600);
    }
  }

  // ---- actions -------------------------------------------------------------------------
  updateAction(dt, time) {
    const a = this.action;
    if (!a) return;
    const api = this.api;
    if (a.type === 'wind') return;
    a.t += dt;
    const hero = this.hero;
    if (a.type === 'flurry') {
      const enemy = api.enemy();
      while (a.next < a.hits.length && a.t >= a.hits[a.next]) {
        const i = a.next++;
        const hand = this._tmp.set(hero.position.x, hero.position.y + 1.3, hero.position.z).addScaledVector(this._dir.set(Math.sin(hero.rotation.y), 0, Math.cos(hero.rotation.y)), .9);
        const chest = enemy.alive && a.target ? this._tmp2.copy(enemy.pos).setY(enemy.pos.y + 1.2 + (Math.random() - .5) * .5) : this._tmp2.copy(hand).addScaledVector(this._dir, 1.4);
        this.fx.bolt(hand, chest, { life: .1, width: 2.6, jitter: .22, red: i % 3 === 2 });
        this.bursts.sparks(chest, { count: 9, power: .9, color: [1, .85, .3] });
        const last = i === a.hits.length - 1;
        if (enemy.alive && a.target) api.damageEnemy(last ? 14 : 5, hero.position, last ? 6 : .5, last ? 'RAJADA FINAL' : '');
        if (last) { api.shake(.5); this.fx.ring(chest, { size: 9, life: .4 }); }
      }
      this.fx.bodyArcs(dt, 1, hero.position);
      this.fx.afterimages(dt, .6);
    } else if (a.type === 'bolt') {
      if (!a.fired && a.t >= .12) { a.fired = true; this.fireBolt(); }
    } else if (a.type === 'tornado') {
      this.spin += dt * 24;
      this.fx.tornado(this._tmp.copy(hero.position), 7, time);
      this.fx.bodyArcs(dt, 1, hero.position);
      if (Math.random() < dt * 40) this.bursts.dust(this._tmp.set(hero.position.x, hero.position.y + .1, hero.position.z), { count: 3, radius: 6, power: 1.5 });
      api.pushActors(hero.position, 11, 9 * dt * 4);
      api.coolRadius(hero.position, 11, dt, .9);
      a.tick -= dt;
      if (a.tick <= 0) {
        a.tick = .24;
        const enemy = api.enemy();
        if (enemy.alive && enemy.pos.distanceTo(hero.position) < 7.5) api.damageEnemy(7, hero.position, 2.2, 'TORNADO');
      }
      api.shake(.06);
    }
    if (a.t >= a.dur) {
      this.action = null;
      this.spin = 0;
      this.currentName = '';
      if (a.type === 'tornado') this.fx.ring(this._tmp.set(hero.position.x, hero.position.y + .1, hero.position.z), { size: 12, life: .45 });
    }
  }

  startWind() {
    this.action = { type: 'wind', t: 0 };
    this.api.message('VENDAVAL VELOZ', 500);
  }

  updateWind(dt, time) {
    const api = this.api, hero = this.hero;
    const origin = this._tmp.set(hero.position.x, hero.position.y + 1.3, hero.position.z);
    const dir = api.aim(this._dir);
    api.coolCone(origin, dir, 20, 30, dt, .6);
    hero.rotation.y = lerpAngle(hero.rotation.y, Math.atan2(dir.x, dir.z), 1 - Math.exp(-12 * dt));
    this.ensure('punch', 3.4, { fade: .12, time: .3 });
    this.fx.bodyArcs(dt, .8, hero.position);
    if (Math.random() < dt * 60) {
      this.bursts.sparks(origin.addScaledVector(dir, 1), { count: 6, power: 1.8, dir, cone: .7, color: [.7, .9, 1.2] });
      const end = this._tmp2.copy(origin).addScaledVector(dir, 9 + Math.random() * 10).add(this._right.set((Math.random() - .5) * 8, (Math.random() - .5) * 6, (Math.random() - .5) * 8));
      this.fx.bolt(origin, end, { life: .1, width: 1.8, jitter: .7 });
    }
  }

  // ---- animation, effects, HUD ----------------------------------------------------------
  animate(dt, hasInput) {
    const hero = this.hero;
    // Procedural body pose on the pivot.
    let targetLean = 0, targetTilt = 0;
    if (this.state === 'wall') targetTilt = -Math.PI / 2;
    else if (this.state === 'ground' && !this.action) targetLean = .3 * this.sprint01;
    else if (this.state === 'air') targetLean = .12;
    this.lean = approach(this.lean, targetLean, 3, dt);
    this.pivot.rotation.x = this.state === 'wall'
      ? approach(this.pivot.rotation.x, targetTilt, 9, dt)
      : approach(this.pivot.rotation.x, this.lean, 9, dt);
    this.pivot.rotation.y = this.spin;

    if (this.action && this.action.type !== 'tornado') return;
    if (this.action?.type === 'tornado') { this.ensure('run', 3.2, { fade: .08 }); return; }
    if (this.api.isDead()) { this.ensure('stand', 1, { fade: .2 }); return; }

    if (this.state === 'wall') { this.ensure('run', 2.8, { fade: .1 }); return; }
    if (this.state === 'air') {
      if (this.velocity.y > 1) { this.ensure('jumpUp', 1, { fade: .08 }); return; }
      if (this.currentName !== 'jumpDown') this.play('jumpDown', { fade: .12, rate: 1.2, loop: false });
      return;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const clip = pickLocomotion(speed);
    this.ensure(clip, locomotionScale(clip, speed), { fade: clip === 'stand' ? .2 : .12 });
  }

  effects(dt, time, usage) {
    const level = this.state === 'wall' ? Math.max(.7, this.sprint01) : this.sprint01;
    const hero = this.hero;
    const dir = this._dir.set(this.velocity.x, 0, this.velocity.z);
    if (dir.lengthSq() < .01) dir.set(Math.sin(hero.rotation.y), 0, Math.cos(hero.rotation.y)); else dir.normalize();
    this.fx.intensity = level;
    this.fx.bodyArcs(dt, Math.max(level, usage.slow ? .25 : 0), hero.position);
    this.fx.trail(dt, level, hero.position, dir);
    this.fx.afterimages(dt, level);
    this.fx.glow(hero.position, Math.max(level, usage.slow ? .15 : 0, this.action ? .5 : 0), time);
    this.fx.update(dt);

    // Announce the Speed Force the moment it kicks in.
    if (level > .5 && !this.sprintAnnounced) {
      this.sprintAnnounced = true;
      this.fx.ring(this._tmp.set(hero.position.x, hero.position.y + .1, hero.position.z), { size: 10, life: .45 });
      this.api.message('FORÇA DA VELOCIDADE', 700);
      this.api.zap(.9);
    } else if (level < .25) this.sprintAnnounced = false;

    // Dust and sparks kicked up by the feet.
    this.footClock -= dt;
    if (this.state === 'ground' && this.speed > 9 && this.footClock <= 0) {
      this.footClock = .05;
      const p = this._tmp.set(hero.position.x, hero.position.y + .08, hero.position.z);
      this.bursts.dust(p, { count: Math.round(1 + level * 3), radius: 1.2, power: .8 });
      this.bursts.sparks(p, { count: Math.round(1 + level * 3), power: .6 + level, dir: this._tmp2.copy(dir).negate().setY(.4), cone: .8, color: [1, .75, .2] });
    }
    if (this.state === 'wall') {
      this.bursts.sparks(this._tmp.copy(hero.position), { count: 2, power: 1, dir: this._tmp2.set(this.wall.nx, -.2, this.wall.nz), cone: .8, color: [1, .75, .2] });
    }
    if (level > .8) this.api.shake(.025 * level);
  }

  hud() {
    const ui = this.api.ui;
    const modes = { ground: this.action ? 'EM AÇÃO' : this.sprint01 > .5 ? 'FORÇA DA VELOCIDADE' : 'NO SOLO', air: 'NO AR', wall: 'CORRIDA NA PAREDE' };
    ui.mode(`Modo: ${this.slow ? 'TEMPO LENTO · ' : ''}${modes[this.state]}`);
    ui.speed(`Velocidade: ${Math.round(Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) * 3.6)} km/h`);
    ui.extra(`Energia: ${Math.round(this.energy)}%${this.exhausted ? ' · ESGOTADA' : ''}`);
    ui.energy(this.energy, this.exhausted ? 'ESGOTADA' : this.slow ? 'TEMPO LENTO' : this.sprint01 > .5 ? 'ATIVA' : 'PRONTA', this.exhausted);
  }

  // How strongly the feet are pinned to the surface (0 while airborne / climbing).
  footLockWeight() {
    return this.state === 'ground' && !this.api.isDead() ? 1 : 0;
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
