import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Cinematic grade applied in linear HDR space, right before tone mapping:
// radial speed blur, chromatic aberration on impacts, vignette and a gentle
// contrast/saturation lift. All motion-driven terms are 0 at rest, so a calm
// scene only pays for the vignette and grade.
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uAberration: { value: 0 },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uHeat: { value: 0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uSpeed, uAberration, uVignette, uSaturation, uContrast, uHeat;

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;

      // Radial blur toward the screen edges; the centre stays sharp.
      float blur = uSpeed * smoothstep(0.02, 0.32, r2) * 0.06;
      if (blur > 0.0004) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float k = float(i) / 7.0;
          acc += texture2D(tDiffuse, 0.5 + c * (1.0 - blur * k)).rgb;
        }
        col = acc / 8.0;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }

      // Chromatic aberration, stronger toward the edges.
      float ab = uAberration * (0.4 + r2 * 4.0);
      if (ab > 0.00005) {
        col.r = texture2D(tDiffuse, 0.5 + c * (1.0 + ab * 6.0)).r;
        col.b = texture2D(tDiffuse, 0.5 + c * (1.0 - ab * 6.0)).b;
      }

      // Colour grade.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;
      col = mix(col, col * vec3(1.18, 0.82, 0.7), uHeat * smoothstep(0.05, 0.4, r2));

      // Vignette.
      col *= 1.0 - uVignette * smoothstep(0.1, 0.62, r2 * 1.9);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `
};

/**
 * Wraps the EffectComposer. `quality` is 'high' | 'low' | 'mobile' | 'off'
 * ('mobile' = no MSAA and no bloom, for phones/tablets). In 'off' mode
 * render() falls through to the plain renderer so the game still runs on
 * machines where post-processing is too slow.
 */
export class PostFx {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.enabled = quality !== 'off';
    this.speed = 0;
    this.aberration = 0;
    this.heat = 0;
    if (!this.enabled) return;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: quality === 'high' ? 4 : 0
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));
    // Threshold sits above sunlit surfaces (the scene is HDR: sun 4.0 + hemisphere 2.15) so only the sun, lasers, fire, plasma
    // and other emissive effects glow.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), quality === 'high' ? .4 : .3, .6, 1.7);
    this.bloom.enabled = quality !== 'mobile';
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(CinematicShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setBloom(enabled) {
    if (this.bloom) this.bloom.enabled = enabled;
  }

  setSize(width, height, pixelRatio) {
    if (!this.enabled) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  // speed01: 0..1 flight speed; impact01: 0..1 camera shake; heat01: 0..1 reentry heat.
  setState({ speed01 = 0, impact01 = 0, heat01 = 0 }, dt) {
    const k = 1 - Math.exp(-6 * dt);
    this.speed += (speed01 - this.speed) * k;
    this.aberration += (impact01 * .0025 - this.aberration) * (1 - Math.exp(-14 * dt));
    this.heat += (heat01 - this.heat) * k;
    if (!this.enabled) return;
    const u = this.grade.uniforms;
    u.uSpeed.value = this.speed;
    u.uAberration.value = this.aberration;
    u.uHeat.value = this.heat;
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

export function postFxQualityFromUrl(search, fallback = 'high') {
  const value = new URLSearchParams(search).get('fx');
  return ['off', 'low', 'mobile', 'high'].includes(value) ? value : fallback;
}
