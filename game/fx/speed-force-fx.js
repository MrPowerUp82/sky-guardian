import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { jaggedPath } from '../characters/flash-math.js';

// Speed Force visuals for The Flash: lightning that crackles around the body,
// streaks left behind, additive "afterimages" of past poses, shock rings and a
// moving glow. Everything is pooled; nothing is allocated per frame.

const SEGMENTS = 10;
const BOLT_POOL = 26;
const GHOST_POOL = 6;
const RING_POOL = 4;

// HDR values (>1) so the bloom pass picks the bolts up when it is enabled.
const CORE = new THREE.Color().setRGB(4.2, 4.0, 3.2);
const GLOW = new THREE.Color().setRGB(2.6, 1.5, .16);
const GLOW_RED = new THREE.Color().setRGB(2.4, .35, .12);

const ANCHOR_PATTERNS = ['Head_', 'LeftHand_', 'RightHand_', 'LeftForeArm_', 'RightForeArm_', 'LeftLeg_', 'RightLeg_', 'LeftFoot_', 'RightFoot_', 'Hips_', 'Spine2_'];

class Bolt {
  constructor(parent, resolution) {
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(new Float32Array(SEGMENTS * 6));
    this.glowMat = new LineMaterial({ color: GLOW, linewidth: 6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, worldUnits: false });
    this.coreMat = new LineMaterial({ color: CORE, linewidth: 2.2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, worldUnits: false });
    this.glowMat.resolution.copy(resolution);
    this.coreMat.resolution.copy(resolution);
    this.glow = new LineSegments2(this.geometry, this.glowMat);
    this.core = new LineSegments2(this.geometry, this.coreMat);
    for (const line of [this.glow, this.core]) { line.frustumCulled = false; line.visible = false; line.renderOrder = 7; parent.add(line); }
    this.life = 0;
    this.maxLife = 1;
    this.glowBase = 1;
  }

  write(points) {
    const data = this.geometry.attributes.instanceStart.data;
    const arr = data.array;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 3, b = (i + 1) * 3, o = i * 6;
      arr[o] = points[a]; arr[o + 1] = points[a + 1]; arr[o + 2] = points[a + 2];
      arr[o + 3] = points[b]; arr[o + 4] = points[b + 1]; arr[o + 5] = points[b + 2];
    }
    data.needsUpdate = true;
  }

  start({ life, width, red, glowScale }) {
    this.life = this.maxLife = life;
    this.coreMat.linewidth = width;
    this.glowMat.linewidth = width * 2.8;
    this.glowMat.color.copy(red ? GLOW_RED : GLOW);
    this.glowBase = glowScale;
    this.glow.visible = this.core.visible = true;
  }

  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) { this.glow.visible = this.core.visible = false; return; }
    const k = this.life / this.maxLife;
    // Bolts flicker as they die instead of fading smoothly.
    const flicker = .65 + .35 * Math.sin(this.life * 160);
    this.coreMat.opacity = Math.min(1, k * 1.6) * flicker;
    this.glowMat.opacity = k * .55 * this.glowBase * flicker;
  }
}

export class SpeedForceFx {
  /**
   * @param {{scene:THREE.Scene, model:THREE.Object3D, bursts:object, resolution:THREE.Vector2}} opts
   * `model` is the live Flash scene graph; it is cloned once for the afterimages.
   */
  constructor({ scene, model, bursts, resolution }) {
    this.scene = scene;
    this.model = model;
    this.bursts = bursts;
    this.resolution = resolution.clone();
    this.root = new THREE.Group();
    this.root.name = 'speed-force-fx';
    scene.add(this.root);

    this.bolts = Array.from({ length: BOLT_POOL }, () => new Bolt(this.root, this.resolution));
    this.boltCursor = 0;

    this.anchors = [];
    model.traverse(o => {
      if (!o.isBone) return;
      const short = o.name.replace(/^mixamorig:?/, '');
      if (ANCHOR_PATTERNS.some(p => short.startsWith(p))) this.anchors.push(o);
    });

    this.light = new THREE.PointLight(0xffc24a, 0, 22, 2);
    this.root.add(this.light);

    this._buildGhosts();
    this._buildRings();

    this.bodyClock = 0;
    this.trailClock = 0;
    this.ghostClock = 0;
    this.intensity = 0;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._rand = Math.random;
  }

  // ---- pools -----------------------------------------------------------------
  _buildGhosts() {
    this.ghosts = [];
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(1.8, .75, .12), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (let i = 0; i < GHOST_POOL; i++) {
      const root = cloneSkeleton(this.model);
      const mat = material.clone();
      const bones = [];
      root.traverse(o => {
        if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 6; }
        if (o.isBone) bones.push(o);
      });
      root.matrixAutoUpdate = false;
      root.visible = false;
      this.root.add(root);
      this.ghosts.push({ root, mat, bones, life: 0, maxLife: .4 });
    }
    this.liveBones = [];
    this.model.traverse(o => { if (o.isBone) this.liveBones.push(o); });
    this.ghostCursor = 0;
  }

  _buildRings() {
    const geo = new THREE.RingGeometry(.82, 1, 40);
    this.rings = Array.from({ length: RING_POOL }, () => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(2.4, 1.6, .3), transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.root.add(mesh);
      return { mesh, life: 0, maxLife: .4, size: 6 };
    });
    this.ringCursor = 0;
  }

  setResolution(width, height) {
    this.resolution.set(width, height);
    for (const bolt of this.bolts) { bolt.glowMat.resolution.set(width, height); bolt.coreMat.resolution.set(width, height); }
  }

  // ---- spawning --------------------------------------------------------------
  /** One lightning bolt between two world points. */
  bolt(a, b, { life = .12, width = 2.2, jitter = .35, red = false, glow = 1 } = {}) {
    const entry = this.bolts[this.boltCursor];
    this.boltCursor = (this.boltCursor + 1) % this.bolts.length;
    entry.write(jaggedPath(a, b, SEGMENTS, jitter, this._rand));
    entry.start({ life, width, red, glowScale: glow });
    return entry;
  }

  ring(position, { size = 7, life = .4, vertical = null } = {}) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.life = r.maxLife = life; r.size = size;
    r.mesh.position.copy(position);
    if (vertical) r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vertical);
    else r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    r.mesh.visible = true;
  }

  /** Freezes the current pose as a fading afterimage. */
  ghost(life = .38) {
    const g = this.ghosts[this.ghostCursor];
    this.ghostCursor = (this.ghostCursor + 1) % this.ghosts.length;
    for (let i = 0; i < this.liveBones.length; i++) {
      const live = this.liveBones[i], copy = g.bones[i];
      if (!copy) break;
      copy.position.copy(live.position); copy.quaternion.copy(live.quaternion); copy.scale.copy(live.scale);
    }
    this.model.updateWorldMatrix(true, false);
    g.root.matrix.copy(this.model.matrixWorld);
    g.root.matrixWorldNeedsUpdate = true;
    g.life = g.maxLife = life;
    g.root.visible = true;
  }

  // ---- per-frame effects -------------------------------------------------------
  _anchorPosition(out) {
    const bone = this.anchors[Math.floor(this._rand() * this.anchors.length)];
    return bone ? bone.getWorldPosition(out) : out.set(0, 1, 0);
  }

  /** Electric arcs crackling over the body. `level` is 0..1. */
  bodyArcs(dt, level, hero) {
    this.bodyClock -= dt;
    if (level <= .02 || this.bodyClock > 0 || !this.anchors.length) return;
    this.bodyClock = .05 - level * .02;
    const count = 1 + Math.round(level * 4);
    for (let i = 0; i < count; i++) {
      this._anchorPosition(this._a);
      if (this._rand() < .55) {
        this._anchorPosition(this._b);
      } else {
        // An arc leaping off the body.
        this._b.copy(this._a).add(this._c.set(this._rand() - .5, this._rand() - .3, this._rand() - .5).multiplyScalar(1.8 + level * 1.6));
      }
      this.bolt(this._a, this._b, { life: .07 + this._rand() * .06, width: 1.6 + level * 1.4, jitter: .18 + level * .12, red: this._rand() < .25 });
    }
    if (hero) this.light.position.copy(hero).y += 1.2;
  }

  /** Long streaks and ground arcs left behind a running Flash. */
  trail(dt, level, position, direction) {
    this.trailClock -= dt;
    if (level <= .1 || this.trailClock > 0) return;
    this.trailClock = .06 - level * .03;
    const count = 1 + Math.round(level * 2);
    for (let i = 0; i < count; i++) {
      const side = (this._rand() - .5) * 2.4;
      const height = .2 + this._rand() * 1.9;
      const back = 1.5 + this._rand() * 3 * (1 + level);
      this._a.set(position.x - direction.x * back - direction.z * side, position.y + height, position.z - direction.z * back + direction.x * side);
      const length = 6 + level * 22 * (.4 + this._rand());
      this._b.copy(this._a).addScaledVector(direction, -length);
      this.bolt(this._a, this._b, { life: .16 + this._rand() * .12, width: 1.8 + level, jitter: .35, red: this._rand() < .3, glow: .8 });
    }
    // Arcs hopping along the road.
    this._a.set(position.x - direction.x * (1 + this._rand() * 2), position.y + .05, position.z - direction.z * (1 + this._rand() * 2));
    this._b.set(this._a.x + (this._rand() - .5) * 6, position.y + .05, this._a.z + (this._rand() - .5) * 6);
    this.bolt(this._a, this._b, { life: .1, width: 1.6, jitter: .4 });
  }

  /** Afterimages at a rate that grows with speed. */
  afterimages(dt, level) {
    this.ghostClock -= dt;
    if (level <= .25 || this.ghostClock > 0) return;
    this.ghostClock = .085 - level * .04;
    this.ghost(.34);
  }

  /** Glow that follows the Flash. */
  glow(position, level, time) {
    this.light.position.set(position.x, position.y + 1.4, position.z);
    this.light.intensity = level * (7 + 3 * Math.sin(time * 70));
  }

  /** Spiral of bolts around `center` (tornado). */
  tornado(center, radius, time) {
    for (let i = 0; i < 3; i++) {
      const a = time * 14 + i * 2.1 + this._rand() * .4;
      const h0 = this._rand() * 2.2;
      this._a.set(center.x + Math.cos(a) * radius * .45, center.y + h0, center.z + Math.sin(a) * radius * .45);
      this._b.set(center.x + Math.cos(a + 1.1) * radius, center.y + h0 + .5 + this._rand(), center.z + Math.sin(a + 1.1) * radius);
      this.bolt(this._a, this._b, { life: .09, width: 2, jitter: .5, red: i === 1 });
    }
  }

  update(dt) {
    for (const b of this.bolts) b.update(dt);
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) { g.root.visible = false; continue; }
      g.mat.opacity = (g.life / g.maxLife) * .42;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const t = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(r.size * (.15 + t * .85));
      r.mesh.material.opacity = (1 - t) * .9;
    }
    if (this.light.intensity > 0 && this.intensity <= 0) this.light.intensity = Math.max(0, this.light.intensity - dt * 30);
  }

  clear() {
    for (const b of this.bolts) { b.life = 0; b.glow.visible = b.core.visible = false; }
    for (const g of this.ghosts) { g.life = 0; g.root.visible = false; }
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    this.light.intensity = 0;
  }
}
