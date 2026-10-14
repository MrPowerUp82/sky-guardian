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
    tBloom: { value: null },
    uBloom: { value: 0 },
    uSpeed: { value: 0 },
    uAberration: { value: 0 },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uHeat: { value: 0 },
    uSlow: { value: 0 },
    // Localised vibration blur: xy = centre in uv, z = strength 0..1, w = time.
    uVibe: { value: new THREE.Vector4(.5, .5, 0, 0) },
    uAspect: { value: 1 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uBloom;
    uniform float uSpeed, uAberration, uVignette, uSaturation, uContrast, uHeat, uSlow, uAspect;
    uniform vec4 uVibe;

    // The scene plus its bloom. Adding the bloom here (instead of blending it into
    // the multisampled scene target) gives the same sum for a fraction of the cost.
    vec3 sceneAt(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (uBloom > 0.5) c += texture2D(tBloom, uv).rgb;
      return c;
    }

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
          acc += sceneAt(0.5 + c * (1.0 - blur * k));
        }
        col = acc / 8.0;
      } else {
        col = sceneAt(vUv);
      }

      // Vibration smear around a point (the Reverse Flash): a handful of taps along a
      // direction that changes every frame, fading out with distance from the centre.
      if (uVibe.z > 0.002) {
        vec2 d = (vUv - uVibe.xy) * vec2(uAspect, 1.0);
        float m = (1.0 - smoothstep(0.06, 0.3, length(d))) * uVibe.z;
        if (m > 0.002) {
          float a = fract(sin(uVibe.w * 91.7) * 43758.5) * 6.2831;
          vec2 dir = vec2(cos(a) / uAspect, sin(a));
          vec3 acc = col;
          for (int i = 1; i < 7; i++) {
            float k = (float(i) - 3.5) / 3.5;
            acc += sceneAt(vUv + dir * k * 0.016 * m);
          }
          col = mix(col, acc / 7.0, clamp(m * 1.1, 0.0, 0.9));
        }
      }

      // Chromatic aberration, stronger toward the edges.
      float ab = uAberration * (0.4 + r2 * 4.0);
      if (ab > 0.00005) {
        col.r = sceneAt(0.5 + c * (1.0 + ab * 6.0)).r;
        col.b = sceneAt(0.5 + c * (1.0 - ab * 6.0)).b;
      }

      // Colour grade.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;
      col = mix(col, col * vec3(1.18, 0.82, 0.7), uHeat * smoothstep(0.05, 0.4, r2));

      // Time-slow look: cold, desaturated, darker edges.
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lum) * vec3(0.78, 0.92, 1.25), uSlow * 0.55);

      // Vignette.
      col *= 1.0 - (uVignette + uSlow * 0.35) * smoothstep(0.1, 0.62, r2 * 1.9);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `
};

// UnrealBloomPass minus its last step. The stock pass blends the bloom additively
// back into the scene target, which here is the 4x multisampled one: a full-screen
// draw at 4x bandwidth plus a second MSAA resolve (~3 ms on an integrated GPU).
// This pass stops after building the bloom texture; the grade shader reads it as
// `tBloom` and adds it itself, which gives the same sum without that cost.
class BloomSource extends UnrealBloomPass {
  get texture() {
    return this.renderTargetsHorizontal[0].texture;
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    // 1. Extract bright areas.
    this.highPassUniforms['tDiffuse'].value = readBuffer.texture;
    this.highPassUniforms['luminosityThreshold'].value = this.threshold;
    this._fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this._fsQuad.render(renderer);

    // 2. Blur every mip progressively.
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      this._fsQuad.material = blur;
      blur.uniforms['colorTexture'].value = input.texture;
      blur.uniforms['direction'].value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this._fsQuad.render(renderer);

      blur.uniforms['colorTexture'].value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms['direction'].value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // 3. Composite the mips into renderTargetsHorizontal[0] (= this.texture).
    this._fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms['bloomStrength'].value = this.strength;
    this.compositeMaterial.uniforms['bloomRadius'].value = this.radius;
    this.compositeMaterial.uniforms['bloomTintColors'].value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this._fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

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
    this.slow = 0;
    this.vibe = { x: .5, y: .5, strength: 0, time: 0 };
    this.cameraFx = true;
    if (!this.enabled) return;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 0
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(size.x, size.y);
    // The scene is drawn into renderTarget2 (the composer's read buffer; the two
    // swaps per frame keep it there) and only renderTarget2 needs MSAA. The grade
    // pass writes a full-screen quad into renderTarget1, where multisampling
    // changes nothing but costs bandwidth and a resolve.
    this.sceneTarget = this.composer.renderTarget2;
    this.sceneTarget.samples = quality === 'high' ? 4 : 0;
    // Nothing samples this target's depth, so skip the MSAA depth resolve.
    this.sceneTarget.resolveDepthBuffer = false;

    this.composer.addPass(new RenderPass(scene, camera));
    // Threshold sits above sunlit surfaces (the scene is HDR: sun 4.0 + hemisphere 2.15) so only the sun, lasers, fire, plasma
    // and other emissive effects glow.
    this.bloom = new BloomSource(new THREE.Vector2(size.x, size.y), quality === 'high' ? .4 : .3, .6, 1.7);
    this.bloom.enabled = quality !== 'mobile';
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(CinematicShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  // Speed blur and impact aberration (the vignette/grade always stay on).
  setCameraFx(enabled) {
    this.cameraFx = enabled;
  }

  // Changes MSAA at runtime by reallocating the scene target.
  setMsaa(samples) {
    if (!this.enabled) return;
    if (this.sceneTarget.samples !== samples) {
      this.sceneTarget.samples = samples;
      this.sceneTarget.dispose();
    }
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
  setState({ speed01 = 0, impact01 = 0, heat01 = 0, slow01 = 0 }, dt) {
    if (!this.cameraFx) { speed01 = 0; impact01 = 0; }
    const k = 1 - Math.exp(-6 * dt);
    this.speed += (speed01 - this.speed) * k;
    this.aberration += (impact01 * .0025 - this.aberration) * (1 - Math.exp(-14 * dt));
    this.heat += (heat01 - this.heat) * k;
    this.slow += (slow01 - this.slow) * (1 - Math.exp(-8 * dt));
    if (!this.enabled) return;
    const u = this.grade.uniforms;
    u.uSpeed.value = this.speed;
    u.uAberration.value = this.aberration;
    u.uHeat.value = this.heat;
    u.uSlow.value = this.slow;
  }

  /** Screen-space vibration blur around uv (0..1, origin bottom-left). Strength 0 turns it off. */
  setVibrate(x, y, strength, time) {
    const on = this.cameraFx ? strength : 0;
    Object.assign(this.vibe, { x, y, strength: on, time });
    if (!this.enabled) return;
    const u = this.grade.uniforms;
    u.uVibe.value.set(x, y, on, time);
    u.uAspect.value = this.camera?.aspect || 1;
  }

  render() {
    if (this.enabled) {
      const u = this.grade.uniforms;
      u.uBloom.value = this.bloom.enabled ? 1 : 0;
      u.tBloom.value = this.bloom.texture;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

export function postFxQualityFromUrl(search, fallback = 'high') {
  const value = new URLSearchParams(search).get('fx');
  return ['off', 'low', 'mobile', 'high'].includes(value) ? value : fallback;
}
