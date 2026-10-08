import * as THREE from 'three';

// Gradient sky with a sun disc, warm halo and drifting high-altitude cloud
// streaks. It follows the camera and is drawn first, so the horizon colour only
// has to match the scene fog for the city to dissolve seamlessly into the haze.
const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSpace;
  uniform vec3 uSunDir;
  uniform float uSpaceBlend;
  uniform float uTime;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float up = clamp(h, 0.0, 1.0);

    // Three-stop gradient: haze at the horizon -> mid blue -> deep zenith.
    vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.22, up));
    sky = mix(sky, uZenith, smoothstep(0.18, 0.85, up));
    // Anything below the horizon is pure haze so the ground fades into it.
    sky = mix(uHorizon, sky, step(0.0, h));

    // High cirrus/stratus streaks projected on a flat layer.
    if (h > 0.02) {
      vec2 uv = dir.xz / (h + 0.18) * 1.7 + vec2(uTime * 0.004, 0.0);
      float c = fbm(uv * vec2(1.0, 2.4));
      c = smoothstep(0.52, 0.86, c) * smoothstep(0.02, 0.22, h) * 0.55;
      sky = mix(sky, vec3(1.0, 0.99, 0.97) * 1.05, c);
    }

    // Sun disc and halo.
    float s = max(dot(dir, normalize(uSunDir)), 0.0);
    vec3 sunCol = vec3(1.0, 0.86, 0.6);
    sky += sunCol * pow(s, 8.0) * 0.18;
    sky += sunCol * pow(s, 64.0) * 0.55;
    sky += vec3(1.0, 0.96, 0.85) * smoothstep(0.9993, 0.9999, s) * 14.0;

    gl_FragColor = vec4(mix(sky, uSpace, uSpaceBlend), 1.0);
  }
`;

export class SkyDome {
  constructor({ sunDirection, horizon, zenith, mid, space }) {
    this.uniforms = {
      uZenith: { value: zenith.clone() },
      uMid: { value: mid.clone() },
      uHorizon: { value: horizon.clone() },
      uSpace: { value: space.clone() },
      uSunDir: { value: sunDirection.clone().normalize() },
      uSpaceBlend: { value: 0 },
      uTime: { value: 0 }
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 20),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader, fragmentShader,
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky-dome';
  }

  // Keeps the dome centred on the camera, sized inside its far plane.
  follow(camera) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(Math.max(100, camera.far * .5));
  }

  update(time, spaceBlend) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSpaceBlend.value = spaceBlend;
  }
}
