import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { getCharacter, getSkin } from '../characters/registry.js';
import { prepareFlashClips } from '../characters/flash-controller.js';
import { remapVerticalTracks, heroClipVerticalMode } from '../../hero-motion.js';
import { FALLBACK_CLIP, resolveClipName, clipPlaysOnce } from './remote-clips.js';

// The other players' heroes: a cloned skinned model, a mixer, a name tag, and the pose
// stream from NetSession#remotes(). Heavy effects (lightning, heat vision) are not
// mirrored: only pose, model and skin.

function nameSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(text, 128, 34);
  ctx.fillStyle = color; ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.8, .45, 1);
  sprite.renderOrder = 8;
  return sprite;
}

function supermanClips(animations) {
  const clips = new Map();
  for (const clip of animations) {
    const mapped = remapVerticalTracks(clip.tracks, heroClipVerticalMode(clip.name, 'air'));
    const tracks = mapped.map((t, i) => (t !== clip.tracks[i] ? new THREE.VectorKeyframeTrack(t.name, clip.tracks[i].times, t.values) : t));
    clips.set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return clips;
}

export class RemoteHeroes {
  constructor({ scene, loadGltf }) {
    this.scene = scene;
    this.loadGltf = loadGltf;
    this.entries = new Map();
    this._quat = new THREE.Quaternion();
  }

  get count() { return this.entries.size; }

  positions() {
    return [...this.entries.values()].filter(e => e.shown).map(e => ({ x: e.group.position.x, z: e.group.position.z, name: e.name }));
  }

  update(dt, remotes) {
    const seen = new Set();
    for (const remote of remotes) {
      seen.add(remote.id);
      let entry = this.entries.get(remote.id);
      if (entry && (entry.char !== remote.char || entry.skin !== remote.skin || entry.name !== remote.name)) { this._dispose(entry); entry = null; }
      if (!entry) entry = this._create(remote);
      this._applyPose(entry, remote);
      entry.mixer?.update(dt);
    }
    for (const [id, entry] of [...this.entries]) if (!seen.has(id)) { this._dispose(entry); this.entries.delete(id); }
  }

  clear() {
    for (const entry of this.entries.values()) this._dispose(entry);
    this.entries.clear();
  }

  // --- internals ------------------------------------------------------------------
  _create(remote) {
    const def = getCharacter(remote.char);
    const skin = getSkin(remote.char, remote.skin);
    const group = new THREE.Group();
    group.name = `remote-${remote.id}`;
    const orientation = new THREE.Group();
    orientation.rotation.y = def.model.yaw;
    group.add(orientation);
    // Stand-in until the real model has loaded: a coloured pillar.
    const marker = new THREE.Mesh(new THREE.CapsuleGeometry(.3, def.model.height - .6, 4, 8), new THREE.MeshStandardMaterial({ color: def.accent, roughness: .6 }));
    marker.position.y = def.model.height / 2;
    group.add(marker);
    const label = nameSprite(remote.name, '#ffffff');
    label.position.y = def.model.height + .45;
    group.add(label);
    this.scene.add(group);

    const entry = {
      id: remote.id, char: remote.char, skin: remote.skin, name: remote.name, def, group, orientation, marker, label,
      mixer: null, clips: null, action: null, clipName: '', shown: true, disposed: false
    };
    this.entries.set(remote.id, entry);
    this.loadGltf(skin.modelUrl).then(gltf => {
      if (entry.disposed) return;
      const root = cloneSkeleton(gltf.scene);
      root.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = size.y > 0 ? def.model.height / size.y : 1;
      root.scale.setScalar(scale);
      root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      orientation.add(root);
      group.remove(marker);
      entry.mixer = new THREE.AnimationMixer(root);
      entry.clips = remote.char === 'flash' ? prepareFlashClips(gltf.animations) : supermanClips(gltf.animations);
      entry.model = root;
    }).catch(err => console.warn('[net] modelo remoto não carregou:', skin.modelUrl, err));
    return entry;
  }

  _applyPose(entry, remote) {
    const { pose } = remote;
    entry.group.position.set(pose.x, pose.y, pose.z);
    entry.group.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    entry.shown = !remote.dead;
    entry.group.visible = entry.shown;
    if (entry.clips && remote.clip) this._play(entry, resolveClipName(entry.clips, remote.clip, FALLBACK_CLIP[remote.char]));
  }

  _play(entry, name) {
    if (!name || name === entry.clipName) return;
    const clip = entry.clips.get(name);
    if (!clip) return;
    const next = entry.mixer.clipAction(clip);
    next.reset();
    const once = clipPlaysOnce(name);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    if (entry.action) { entry.action.fadeOut(.15); next.fadeIn(.15); } else next.setEffectiveWeight(1);
    next.play();
    entry.action = next;
    entry.clipName = name;
  }

  _dispose(entry) {
    entry.disposed = true;
    this.scene.remove(entry.group);
    entry.mixer?.stopAllAction();
    entry.label.material.map?.dispose();
    entry.label.material.dispose();
    entry.marker.geometry.dispose();
    entry.marker.material.dispose();
  }
}
