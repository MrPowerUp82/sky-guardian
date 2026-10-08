import * as THREE from 'three';

// Pooled GPU-point particles for impacts: dust clouds, debris chunks, sparks
// and fast-flight contrails. Two draw calls total (normal + additive blending).
const vertexShader = /* glsl */`
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vLife = aLife;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aLife > 0.0 ? clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 220.0) : 0.0;
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  uniform float uSoft;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float edge = mix(1.0 - step(0.55, d), 1.0 - smoothstep(0.0, 1.0, d), uSoft);
    gl_FragColor = vec4(vColor, edge * vLife);
  }
`;

class ParticlePool {
  constructor(scene, { capacity, additive, soft, renderOrder = 5 }) {
    this.capacity = capacity;
    this.cursor = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);      // 0..1 fade value sent to the GPU
    this.age = new Float32Array(capacity);
    this.maxAge = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.alphaScale = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));

    this.uniforms = { uScale: { value: 600 }, uSoft: { value: soft ? 1 : 0 } };
    this.points = new THREE.Points(this.geometry, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
    this.alive = 0;
  }

  emit(p) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const o = i * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
    this.vel[o] = p.vx; this.vel[o + 1] = p.vy; this.vel[o + 2] = p.vz;
    this.color[o] = p.r; this.color[o + 1] = p.g; this.color[o + 2] = p.b;
    this.baseSize[i] = p.size;
    this.size[i] = p.size;
    this.age[i] = 0;
    this.maxAge[i] = p.life;
    this.grow[i] = p.grow ?? 0;
    this.gravity[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 1;
    this.life[i] = p.alpha ?? 1;
    this.alphaScale[i] = p.alpha ?? 1;
  }

  update(dt, fovScale) {
    this.uniforms.uScale.value = fovScale;
    let alive = 0;
    const alpha = this.alphaScale;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.maxAge[i];
      if (t >= 1) { this.life[i] = 0; continue; }
      alive++;
      const o = i * 3;
      const damp = Math.pow(this.drag[i], dt * 60);
      this.vel[o] *= damp; this.vel[o + 1] = this.vel[o + 1] * damp - this.gravity[i] * dt; this.vel[o + 2] *= damp;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      // Quick fade-in, long fade-out.
      this.life[i] = alpha[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * .35);
    }
    this.alive = alive;
    if (alive || this.wasAlive) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aLife.needsUpdate = true;
    }
    this.wasAlive = alive > 0;
    this.points.visible = alive > 0 || this.wasAlive;
  }

  clear() {
    this.life.fill(0);
    this.alive = 0;
    this.points.visible = false;
    this.geometry.attributes.aLife.needsUpdate = true;
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

export class ParticleBursts {
  constructor(scene) {
    this.smokePool = new ParticlePool(scene, { capacity: 1400, additive: false, soft: true, renderOrder: 4 });
    this.chunkPool = new ParticlePool(scene, { capacity: 500, additive: false, soft: false, renderOrder: 5 });
    this.sparkPool = new ParticlePool(scene, { capacity: 900, additive: true, soft: true, renderOrder: 6 });
  }

  // Expanding ring of dust kicked up at ground level.
  dust(at, { count = 26, radius = 3, power = 1, tint = [.5, .46, .4] } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = rand(.35, 1) * radius * 1.8 * power;
      const shade = rand(.82, 1.08);
      this.smokePool.emit({
        x: at.x + Math.cos(a) * radius * .2, y: at.y + rand(.05, .35), z: at.z + Math.sin(a) * radius * .2,
        vx: Math.cos(a) * speed, vy: rand(.4, 2.2) * power, vz: Math.sin(a) * speed,
        r: tint[0] * shade, g: tint[1] * shade, b: tint[2] * shade,
        size: rand(1.2, 2.6) * Math.max(.5, radius * .3), grow: rand(1.2, 2), life: rand(.7, 1.4),
        drag: .94, gravity: -.5, alpha: .4
      });
    }
  }

  // Dark chunks thrown outward that fall back to the ground.
  debris(at, { count = 16, power = 1, spread = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = rand(3, 10) * power * spread;
      const shade = rand(.25, .5);
      this.chunkPool.emit({
        x: at.x, y: at.y + .2, z: at.z,
        vx: Math.cos(a) * speed, vy: rand(4, 11) * power, vz: Math.sin(a) * speed,
        r: shade, g: shade * .93, b: shade * .85,
        size: rand(.18, .45), life: rand(.7, 1.4), gravity: 22, drag: .985, alpha: 1
      });
    }
  }

  // Hot sparks; `dir` biases the spray (optional unit vector).
  sparks(at, { count = 30, power = 1, dir = null, cone = 1, color = [1, .72, .3] } = {}) {
    for (let i = 0; i < count; i++) {
      let vx = rand(-1, 1), vy = rand(-.2, 1), vz = rand(-1, 1);
      if (dir) { vx = dir.x + vx * cone * .7; vy = dir.y + vy * cone * .7; vz = dir.z + vz * cone * .7; }
      const len = Math.hypot(vx, vy, vz) || 1;
      const speed = rand(5, 16) * power;
      const heat = rand(.75, 1.25);
      this.sparkPool.emit({
        x: at.x, y: at.y, z: at.z,
        vx: vx / len * speed, vy: vy / len * speed, vz: vz / len * speed,
        r: color[0] * heat, g: color[1] * heat, b: color[2] * heat,
        size: rand(.16, .38), grow: -.7, life: rand(.25, .7), gravity: 14, drag: .975, alpha: 1
      });
    }
  }

  // Soft white puff for vapour trails behind a fast hero.
  contrail(at, { size = 1.4, alpha = .38 } = {}) {
    this.smokePool.emit({
      x: at.x + rand(-.15, .15), y: at.y + rand(-.15, .15), z: at.z + rand(-.15, .15),
      vx: rand(-.25, .25), vy: rand(-.1, .3), vz: rand(-.25, .25),
      r: 1, g: 1, b: 1, size, grow: 2.6, life: rand(.9, 1.5), drag: .985, alpha
    });
  }

  // Burning embers drifting upward (meteor craters, fires).
  embers(at, { count = 14, radius = 6 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.sparkPool.emit({
        x: at.x + Math.cos(a) * r, y: at.y + rand(.2, 1.5), z: at.z + Math.sin(a) * r,
        vx: rand(-1.2, 1.2), vy: rand(2, 6), vz: rand(-1.2, 1.2),
        r: 1.2, g: rand(.35, .6), b: .12, size: rand(.14, .3), grow: -.5, life: rand(.9, 2), gravity: -1, drag: .985, alpha: 1
      });
    }
  }

  update(dt, camera, viewportHeight) {
    // Converts world size to pixels: h / (2 tan(fov/2)).
    const scale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * .5));
    this.smokePool.update(dt, scale);
    this.chunkPool.update(dt, scale);
    this.sparkPool.update(dt, scale);
  }

  clear() {
    this.smokePool.clear();
    this.chunkPool.clear();
    this.sparkPool.clear();
  }
}
