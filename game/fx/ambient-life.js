import * as THREE from 'three';

// Soft billboard cloud puff painted once on a canvas: white top lit by the sun,
// blue-grey underside.
function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const blobs = [
    [.5, .55, .30], [.33, .6, .22], [.68, .6, .23], [.45, .4, .2], [.6, .42, .18], [.22, .66, .14], [.78, .66, .14]
  ];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Shade the underside.
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, size * .25, 0, size * .85);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(120,145,185,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Drifting cloud layer made of camera-facing sprites. `material` is exposed so
 * the space transition can fade the whole layer through one opacity value.
 */
export class CloudLayer {
  constructor(scene, rng, { count = 46, extent = 1250, minY = 150, maxY = 380, baseOpacity = .82 } = {}) {
    this.extent = extent;
    this.baseOpacity = baseOpacity;
    this.material = new THREE.SpriteMaterial({
      map: makeCloudTexture(), transparent: true, opacity: baseOpacity, depthWrite: false, color: 0xffffff
    });
    this.clouds = [];
    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const puffs = 5 + Math.floor(rng() * 4);
      const width = 70 + rng() * 80;
      for (let j = 0; j < puffs; j++) {
        const sprite = new THREE.Sprite(this.material);
        const s = width * (.5 + rng() * .6);
        sprite.scale.set(s, s * (.55 + rng() * .2), 1);
        sprite.position.set((j / (puffs - 1) - .5) * width * 1.3, (rng() - .5) * 14, (rng() - .5) * 40);
        group.add(sprite);
      }
      group.position.set((rng() - .5) * extent * 2, minY + rng() * (maxY - minY), (rng() - .5) * extent * 2);
      group.userData.drift = 1.2 + rng() * 2.2;
      scene.add(group);
      this.clouds.push(group);
    }
  }

  setVisible(visible) {
    for (const cloud of this.clouds) cloud.visible = visible;
  }

  update(dt) {
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.drift * dt;
      if (cloud.position.x > this.extent) cloud.position.x -= this.extent * 2;
    }
  }
}

const birdVertex = /* glsl */`
  attribute float aPhase;
  attribute float aWing;
  uniform float uTime;
  varying float vShade;
  void main() {
    vec3 p = position;
    float flap = sin(uTime * 9.0 + aPhase * 6.2831);
    p.y += aWing * flap * 0.55;
    vShade = 0.35 + 0.25 * flap * aWing;
    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const birdFragment = /* glsl */`
  varying float vShade;
  void main() { gl_FragColor = vec4(vec3(0.07, 0.08, 0.1) + vShade * 0.12, 1.0); }
`;

/** Small flocks circling above the city with flapping wings (one draw call). */
export class BirdFlocks {
  constructor(scene, rng, { flocks = 7, perFlock = 9, extent = 560 } = {}) {
    const count = flocks * perFlock;
    // Body + two wings as a single triangle fan: nose, left tip, right tip, tail.
    const verts = new Float32Array([
      0, 0, 0.7,  -1.0, 0, -0.2,  0, 0, -0.1,
      0, 0, 0.7,   0, 0, -0.1,    1.0, 0, -0.2,
      0, 0, -0.1, -0.35, 0, -0.65, 0.35, 0, -0.65
    ]);
    const wing = new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geometry.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) phases[i] = rng();
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.uniforms = { uTime: { value: 0 } };
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: birdVertex, fragmentShader: birdFragment, side: THREE.DoubleSide
    }), count);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.birds = [];
    for (let f = 0; f < flocks; f++) {
      const cx = (rng() - .5) * extent * 2, cz = (rng() - .5) * extent * 2;
      const radius = 50 + rng() * 90, height = 70 + rng() * 150, speed = (.12 + rng() * .1) * (rng() > .5 ? 1 : -1);
      for (let b = 0; b < perFlock; b++) {
        this.birds.push({
          cx, cz, radius: radius + (rng() - .5) * 26, height: height + (rng() - .5) * 22,
          angle: rng() * Math.PI * 2, speed, bank: 0, scale: 1.6 + rng() * .8
        });
      }
    }
    this.dummy = new THREE.Object3D();
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    if (!this.mesh.visible) return;
    const d = this.dummy;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.angle += b.speed * dt;
      const x = b.cx + Math.cos(b.angle) * b.radius;
      const z = b.cz + Math.sin(b.angle) * b.radius;
      const y = b.height + Math.sin(time * .6 + i) * 2.2;
      d.position.set(x, y, z);
      // Face along the tangent of the circle and bank into the turn.
      const tangent = b.speed > 0 ? b.angle + Math.PI / 2 : b.angle - Math.PI / 2;
      d.rotation.set(0, Math.PI / 2 - tangent, Math.sign(b.speed) * -.25);
      d.scale.setScalar(b.scale);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
