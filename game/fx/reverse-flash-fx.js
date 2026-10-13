import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Reverse Flash skin: the whole body vibrates at Speed Force frequency. Three
// layers sell it, all driven by one `level` (0..1):
//   1. a vertex shake inside the skinned mesh (the silhouette really shivers),
//   2. translucent "double vision" copies of the pose that jitter around it
//      (a cheap per-object blur), and
//   3. red glowing eyes painted onto the eyeball / socket UV islands.
// The caller adds the screen-space blur (PostFx.setVibrate) around the character.

// UV islands (0..1, v measured from the top, matching glTF) of reverse-flash.glb:
// the eyeball patch and the two sockets of the mask in the 1024x1024 base colour.
const EYE_RECTS = [
  [.176, .612, .290, .712],   // eyeball piece
  [.030, .560, .130, .630],   // left socket
  [.220, .560, .330, .630]    // right socket
];

const IDLE_LEVEL = .42;       // standing still still hums
const SHAKE_METERS = .02;     // peak vertex displacement at level 1

function patchMaterial(material, uniforms, shakeLocal, phasePerUnit) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uVibeTime; uniform float uVibeAmp;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        {
          // Phase follows height (about 5 rad per metre) so the body ripples instead of
          // moving as one block, without turning the legs into noise.
          float ph = transformed.y * ${phasePerUnit.toFixed(6)};
          vec3 shake = vec3(
            sin(uVibeTime * 173.0 + ph),
            sin(uVibeTime * 211.0 + ph * 1.7) * 0.6,
            sin(uVibeTime * 149.0 + ph * 0.8)
          );
          transformed += shake * uVibeAmp * ${shakeLocal.toFixed(6)};
        }`);
    const rects = EYE_RECTS.map(r => `vec4(${r.map(v => v.toFixed(4)).join(',')})`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uEye;
        float eyeMask(vec2 uv) {
          float m = 0.0;
          vec4 r[3];
          r[0] = ${rects[0]}; r[1] = ${rects[1]}; r[2] = ${rects[2]};
          for (int i = 0; i < 3; i++) {
            vec2 c = (r[i].xy + r[i].zw) * 0.5;
            vec2 h = (r[i].zw - r[i].xy) * 0.5;
            vec2 d = abs(uv - c) / h;
            m = max(m, 1.0 - smoothstep(0.55, 1.0, max(d.x, d.y)));
          }
          return m;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float eye = eyeMask(vMapUv) * uEye;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.0, 0.0), eye);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.5, 0.0, 0.01) * eye;`);
  };
  material.customProgramCacheKey = () => 'reverse-flash-vibe';
  material.needsUpdate = true;
}

export class ReverseFlashFx {
  /**
   * @param {{scene:THREE.Scene, model:THREE.Object3D, ghosts?:number}} opts
   * `model` is the live skinned Reverse Flash; it is cloned for the blur copies.
   */
  constructor({ scene, model, ghosts = 3 }) {
    this.scene = scene;
    this.model = model;
    this.level = IDLE_LEVEL;
    this.active = false;
    this.uniforms = { uVibeTime: { value: 0 }, uVibeAmp: { value: 0 }, uEye: { value: 1 } };

    // The vertex shake works in mesh space; convert metres to that space once.
    model.updateWorldMatrix(true, true);
    const worldScale = new THREE.Vector3();
    model.getWorldScale(worldScale);
    const toLocal = 1 / (worldScale.x || 1);
    const shakeLocal = SHAKE_METERS * toLocal;
    const phasePerUnit = 5 / toLocal;
    model.traverse(o => {
      if (!o.isMesh) return;
      for (const material of [].concat(o.material)) patchMaterial(material, this.uniforms, shakeLocal, phasePerUnit);
    });

    this.root = new THREE.Group();
    this.root.name = 'reverse-flash-vibration';
    scene.add(this.root);
    this.liveBones = [];
    model.traverse(o => { if (o.isBone) this.liveBones.push(o); });
    this.copies = Array.from({ length: ghosts }, () => this._buildCopy());
    this._offset = new THREE.Matrix4();
    this._world = new THREE.Matrix4();
    this.setActive(false);
  }

  _buildCopy() {
    const root = cloneSkeleton(this.model);
    const bones = [];
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .22, depthWrite: false, color: new THREE.Color().setRGB(1.5, .55, .5) });
    root.traverse(o => {
      if (o.isBone) bones.push(o);
      if (o.isMesh) {
        const source = [].concat(o.material)[0];
        material.map = source.map;
        o.material = material; o.castShadow = o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 5;
      }
    });
    root.matrixAutoUpdate = false;
    this.root.add(root);
    return { root, bones, material };
  }

  setActive(active) {
    this.active = active;
    this.root.visible = active;
    this.uniforms.uVibeAmp.value = active ? this.level : 0;
  }

  /** 0..1 vibration used by the screen blur as well. */
  get strength() { return this.active ? this.level : 0; }

  /** Call after the mixer ran, so the copies follow this frame's pose. */
  update(dt, time, sprint01 = 0) {
    if (!this.active) return;
    const target = THREE.MathUtils.lerp(IDLE_LEVEL, 1, THREE.MathUtils.clamp(sprint01 * 1.4, 0, 1));
    this.level += (target - this.level) * (1 - Math.exp(-8 * dt));
    this.uniforms.uVibeTime.value = time;
    this.uniforms.uVibeAmp.value = this.level;

    this.model.updateWorldMatrix(true, false);
    this._world.copy(this.model.matrixWorld);
    const spread = .018 + .085 * this.level;
    for (const copy of this.copies) {
      for (let i = 0; i < this.liveBones.length; i++) {
        const live = this.liveBones[i], twin = copy.bones[i];
        if (!twin) break;
        twin.position.copy(live.position); twin.quaternion.copy(live.quaternion); twin.scale.copy(live.scale);
      }
      // Fresh random offset every frame: the eye reads it as a smear, not a pose.
      this._offset.makeTranslation((Math.random() - .5) * 2 * spread, (Math.random() - .5) * spread * .6, (Math.random() - .5) * 2 * spread);
      copy.root.matrix.multiplyMatrices(this._offset, this._world);
      copy.root.matrixWorldNeedsUpdate = true;
      copy.material.opacity = .12 + .18 * this.level;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    for (const copy of this.copies) copy.material.dispose();
  }
}
