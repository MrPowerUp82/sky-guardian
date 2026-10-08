import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { remapVerticalTracks, heroClipVerticalMode, HERO_GROUND_AUTHORED_CLIPS } from './hero-motion.js';
import { HeroFlightState } from './hero-state.js';
import { loadCharacterConfig, slotConfig, hitboxById, queueSlotEvents } from './animation-config-runtime.js';
import { EmergencyPresentation } from './game/events/emergency-presentation.js';
import { FireSystem } from './game/fire/fire-system.js';
import { IceBreathController, ICE_BREATH_TUNING } from './game/powers/ice-breath-controller.js';
import { MeteorEvent } from './game/events/meteor-event.js';
import { BuildingFireEvent, selectBuildingTarget, createBuildingFireSpots } from './game/events/building-fire-event.js';
import { DynamicEventSystem } from './game/events/dynamic-event-system.js';
import { EnemyPoise, enemyLevelStats } from './game/combat/enemy-poise.js';
import { makeRoadCenters, classifyDistrict, lotFacingRotation, chunkKey, snapFocusToLightTexels } from './game/world/city-layout.js';
import { SkyDome } from './game/fx/sky-dome.js';
import { PostFx, postFxQualityFromUrl } from './game/fx/post-fx.js';
import { ParticleBursts } from './game/fx/particle-bursts.js';
import { CloudLayer, BirdFlocks } from './game/fx/ambient-life.js';
import { InstancedTraffic } from './game/world/instanced-traffic.js';
import { AdaptiveResolution } from './game/fx/adaptive-quality.js';
import { isTouchDevice, qualityProfile } from './game/ui/device.js';
import { createTouchControls } from './game/ui/touch-controls.js';


// Phones and tablets get the touch UI plus a lighter profile (smaller map,
// fewer actors, no MSAA/bloom). `?touch=1` / `?touch=0` force the choice.
const IS_TOUCH = isTouchDevice({
  search: location.search,
  maxTouchPoints: navigator.maxTouchPoints,
  coarsePointer: matchMedia('(pointer: coarse)').matches,
  userAgent: navigator.userAgent
});
const PROFILE = qualityProfile(IS_TOUCH, devicePixelRatio);
document.body.classList.toggle('touch', IS_TOUCH);

// MSAA lives in the post-processing target; the canvas only needs it with ?fx=off.
const renderer = new THREE.WebGLRenderer({ antialias: new URLSearchParams(location.search).get('fx') === 'off', powerPreference: 'high-performance' });
renderer.setPixelRatio(PROFILE.startPixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const DAY_BACKGROUND = new THREE.Color(0x8fcfff);
const DAY_FOG_COLOR = new THREE.Color(0xb7ddf7);
const SPACE_BACKGROUND = new THREE.Color(0x020713);
const DAY_FOG_DENSITY = 0.00085;
const worldFog = new THREE.FogExp2(DAY_FOG_COLOR.clone(), DAY_FOG_DENSITY);
scene.background = DAY_BACKGROUND.clone();
scene.fog = worldFog;

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 40000);
const postFx = new PostFx(renderer, scene, camera, { quality: postFxQualityFromUrl(location.search, PROFILE.fx) });

const hemi = new THREE.HemisphereLight(0xd7efff, 0x43513b, 2.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d0, 4.0);
sun.castShadow = true;
// The shadow frustum follows the hero (see updateSunShadow), so a tight 2k map
// stays sharp no matter how large the city is.
const SUN_OFFSET = new THREE.Vector3(-120, 210, 90);
const SUN_SHADOW_RANGE = PROFILE.shadowRange;
sun.position.copy(SUN_OFFSET);
sun.shadow.mapSize.set(PROFILE.shadowMap, PROFILE.shadowMap);
sun.shadow.camera.left = -SUN_SHADOW_RANGE;
sun.shadow.camera.right = SUN_SHADOW_RANGE;
sun.shadow.camera.top = SUN_SHADOW_RANGE;
sun.shadow.camera.bottom = -SUN_SHADOW_RANGE;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 760;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);

// The sun's shadow map is re-rendered on a timer instead of every frame; the
// interval grows if the machine cannot keep up (see degradeQuality).
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
let shadowInterval = 1 / 40;
let shadowClock = 0;

function updateSunShadow() {
  const focus = snapFocusToLightTexels(
    { x: hero.position.x, y: 0, z: hero.position.z },
    SUN_OFFSET,
    SUN_SHADOW_RANGE * 2 / sun.shadow.mapSize.x
  );
  sun.target.position.set(focus.x, focus.y, focus.z);
  sun.position.set(focus.x + SUN_OFFSET.x, focus.y + SUN_OFFSET.y, focus.z + SUN_OFFSET.z);
  sun.target.updateMatrixWorld();
}

const rng = mulberry32(74329);
const gltfLoader = new GLTFLoader();
gltfLoader.setCrossOrigin('anonymous');

// V8 animation configuration. The game checks a config saved by the visual
// configurator in localStorage first and falls back to the JSON files in /config.
const HERO_CONFIG_FALLBACK = {
  schemaVersion: 2, characterId: 'superman',
  transform: { rotationDeg: { x:0, y:-90, z:0 }, mirror: { x:false,y:false,z:false }, targetHeight: 2.05 },
  slots: {
    idle:{clip:'C003_Idle_01',speed:1,loop:true,fade:.14,events:[]}, run:{clip:'C003_Run_01',speed:1,loop:true,fade:.12,events:[]},
    takeoff:{clip:'C003_Flying_Intro',speed:1.05,loop:false,fade:.07,events:[]}, hover:{clip:'C003_Flying_Hold',speed:1,loop:true,fade:.13,events:[]},
    airIdle:{clip:'C003_S08_Emote_CharacterSelect_Loop',speed:1,loop:true,fade:.16,events:[]},
    fly:{clip:'C003_Flying',speed:1,loop:true,fade:.13,events:[]}, flyStop:{clip:'C003_Flying_Stop',speed:1,loop:false,fade:.08,events:[]}, land:{clip:'C003_Land',speed:1,loop:false,fade:.07,events:[]},
    punch:{clip:'C003_Punch_01',speed:1.05,loop:false,fade:.07,events:[]}, superPunch:{clip:'C003_N_Attack_01',speed:1.16,loop:false,fade:.06,events:[]},
    leapAttack:{clip:'C003_LeapAttack',speed:1.0,loop:false,fade:.06,events:[]}, leapAttackLand:{clip:'C003_LeapAttackLand',speed:1.0,loop:false,fade:.055,events:[]},
    heatVision:{clip:'C003_Laser_Air',speed:1.05,loop:false,fade:.06,events:[]},
    heatVisionGround:{clip:'C003_Laser_Ground',speed:1.0,loop:false,fade:.06,events:[]}
    ,iceBreathGroundStart:{clip:'C003_IceBreath',speed:1,loop:false,fade:.06,events:[]}, iceBreathGroundLoop:{clip:'C003_IceBreath_Loop',speed:1,loop:true,fade:.08,events:[]}, iceBreathGroundExit:{clip:'C003_IceBreath_IntoIdle',speed:1,loop:false,fade:.08,events:[]}
    ,iceBreathAirStart:{clip:'C003_Air_IceBreath',speed:1,loop:false,fade:.06,events:[]}, iceBreathAirLoop:{clip:'C003_Air_IceBreath_Loop',speed:1,loop:true,fade:.08,events:[]}, iceBreathAirExit:{clip:'C003_Air_IceBreath_IntoIdle',speed:1,loop:false,fade:.08,events:[]}
  }, hitboxes: []
};
const ENEMY_CONFIG_FALLBACK = {
  schemaVersion: 2, characterId: 'jason',
  transform: { rotationDeg: { x:0, y:-90, z:0 }, mirror: { x:false,y:false,z:false }, targetHeight: 2.35 },
  slots: {
    idle:{clip:'Jason_Nav_Idle',speed:1,loop:true,fade:.16,events:[]}, walk:{clip:'Jason_Walk',speed:1.02,loop:true,fade:.14,events:[]}, run:{clip:'Jason_Walk',speed:1.28,loop:true,fade:.12,events:[]},
    attack1:{clip:'Jason_Attack_Combo_01',speed:1.22,loop:false,fade:.06,events:[]}, attack2:{clip:'Jason_Attack_Combo_02',speed:1.10,loop:false,fade:.06,events:[]},
    attack3:{clip:'Jason_Attack_Combo_03',speed:1.10,loop:false,fade:.06,events:[]}, specialAttack:{clip:'Jason_Attack_Dash_Shoulder_Bash',speed:1.08,loop:false,fade:.05,events:[]},
    hurt:{clip:'Jason_HR_Deflect',speed:1.15,loop:false,fade:.06,events:[]}, death:{clip:'Jason_HR_Flyback_B_Enter',speed:.86,loop:false,fade:.04,events:[]}
  }, hitboxes: []
};
let heroAnimConfig = HERO_CONFIG_FALLBACK;
let enemyAnimConfig = ENEMY_CONFIG_FALLBACK;
const heroConfigPromise = loadCharacterConfig('./config/superman-animation-config.json', HERO_CONFIG_FALLBACK, 'sky-guardian:anim:superman');
const enemyConfigPromise = loadCharacterConfig('./config/jason-animation-config.json', ENEMY_CONFIG_FALLBACK, 'sky-guardian:anim:jason');

function applyConfiguredOrientation(group, config) {
  const r = config?.transform?.rotationDeg || {x:0,y:-90,z:0};
  const m = config?.transform?.mirror || {x:false,y:false,z:false};
  group.rotation.set(THREE.MathUtils.degToRad(Number(r.x)||0), THREE.MathUtils.degToRad(Number(r.y)||0), THREE.MathUtils.degToRad(Number(r.z)||0));
  group.scale.set(m.x ? -1 : 1, m.y ? -1 : 1, m.z ? -1 : 1);
}

// ---------------------------------------------------------------------------
// WORLD / CC0 CITY
// ---------------------------------------------------------------------------
const world = new THREE.Group();
scene.add(world);

// V18: a 15 x 15 avenue grid (~1.4 km across). Everything that used to hard-code
// the old +-384 extent now derives from these constants.
const ROAD_SPACING = 96;
const ROAD_COUNT = PROFILE.roadCount;
const roadLaneCenters = makeRoadCenters(ROAD_COUNT, ROAD_SPACING);
const CITY_HALF = (ROAD_COUNT - 1) / 2 * ROAD_SPACING;
const WORLD_LIMIT = CITY_HALF + 46;
const CITY_EDGE = CITY_HALF + 32;
const TILE = 32;
// Instances are grouped per spatial chunk so each InstancedMesh gets a tight
// bounding sphere and the camera and sun-shadow frusta can cull whole districts.
const INSTANCE_CHUNK = 128;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry((CITY_HALF + 700) * 2, (CITY_HALF + 700) * 2),
  new THREE.MeshStandardMaterial({ color: 0x5d7b49, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
ground.receiveShadow = true;
world.add(ground);

// Kenney CC0 models ship inside the project (assets/kenney); the public mirror is
// only a fallback if a local file is missing.
const TGE = 'https://raw.githubusercontent.com/Hidencod/tge-assets/main/';
const LOCAL_KENNEY = './assets/kenney/';
const assetUrl = path => LOCAL_KENNEY + path.replace(/^packs\//, '');
const mirrorUrl = path => TGE + path;

const CITY_ASSETS = {
  // 'midrise' and 'tower' pools feed the downtown and mixed districts.
  midrise: ['a','b','c','d','e','f','g','h','i','j','k','l','n'].map(k => `packs/city-kit-commercial/building-${k}.glb`),
  towers: [
    'packs/city-kit-commercial/building-m.glb',
    ...['a','b','c','d','e'].map(k => `packs/city-kit-commercial/building-skyscraper-${k}.glb`)
  ],
  // Cheap silhouettes for the decorative horizon beyond the playable area.
  skyline: [
    ...['a','b','c','d','e','f'].map(k => `packs/city-kit-commercial/low-detail-building-${k}.glb`),
    'packs/city-kit-commercial/low-detail-building-wide-a.glb',
    'packs/city-kit-commercial/low-detail-building-wide-b.glb'
  ],
  houses: ['a','b','c','d','e','f','g','h','i','j','k','l'].map(k => `packs/city-kit-suburban/building-type-${k}.glb`),
  roadStraight: 'packs/city-kit-roads/road-straight.glb',
  roadCross: 'packs/city-kit-roads/road-crossroad.glb',
  streetLights: ['packs/city-kit-roads/light-curved.glb', 'packs/city-kit-roads/light-square.glb'],
  trafficLight: 'packs/city-kit-roads/traffic-light-hanging.glb',
  props: {
    cone: 'packs/city-kit-roads/construction-cone.glb',
    barrier: 'packs/city-kit-roads/construction-barrier.glb',
    dumpster: 'packs/city-kit-roads/dumpster.glb',
    streetSign: 'packs/city-kit-roads/road-sign-street.glb'
  },
  // `length` is the on-screen vehicle length in metres.
  cars: [
    { path: 'packs/car-kit/sedan.glb', length: 4.6 },
    { path: 'packs/car-kit/sedan-sports.glb', length: 4.7 },
    { path: 'packs/car-kit/suv.glb', length: 4.9 },
    { path: 'packs/car-kit/suv-luxury.glb', length: 5.0 },
    { path: 'packs/car-kit/taxi.glb', length: 4.6 },
    { path: 'packs/car-kit/police.glb', length: 4.8 },
    { path: 'packs/car-kit/hatchback-sports.glb', length: 4.4 },
    { path: 'packs/car-kit/van.glb', length: 5.4 },
    { path: 'packs/car-kit/delivery.glb', length: 6.2 },
    { path: 'packs/car-kit/truck.glb', length: 6.0 },
    { path: 'packs/car-kit/garbage-truck.glb', length: 7.0 },
    { path: 'packs/car-kit/ambulance.glb', length: 6.0 },
    { path: 'packs/car-kit/firetruck.glb', length: 7.4 }
  ],
  trees: [
    'packs/nature-kit/tree-oak.glb',
    'packs/nature-kit/tree-fat.glb',
    'packs/nature-kit/tree-pinedefaulta.glb',
    'packs/nature-kit/tree-detailed.glb',
    'packs/nature-kit/tree-tall.glb'
  ],
  suburbTrees: ['packs/city-kit-suburban/tree-large.glb', 'packs/city-kit-suburban/tree-small.glb'],
  plants: [
    'packs/nature-kit/plant-bush.glb',
    'packs/nature-kit/plant-bushlarge.glb',
    'packs/nature-kit/flower-reda.glb',
    'packs/nature-kit/flower-yellowa.glb',
    'packs/nature-kit/flower-purplea.glb',
    'packs/nature-kit/rock-largea.glb',
    'packs/nature-kit/rock-largeb.glb'
  ],
  npcs: ['a','b','c','d','e','f'].flatMap(k => [`female-${k}`, `male-${k}`]).map(k => `packs/mini-characters/character-${k}.glb`)
};

const TRAFFIC_COUNT = PROFILE.traffic;
const TRAFFIC_RENDER_RADIUS = PROFILE.trafficRadius;
const NPC_RENDER_RADIUS = PROFILE.npcRadius;
let carRenderer = null;
const CROWD_COUNT = PROFILE.crowd;
const trafficActors = [];
const npcActors = [];
const npcMixers = [];
// V11 ground-contact tuning. The road kit and procedural block pads sit a few
// centimetres above the old Y=0 gameplay plane, so characters must snap to the
// actual visible surface rather than an abstract zero-height floor.
const WORLD_GROUND_Y = -0.06;
const ROAD_SURFACE_Y = 0.085;
const BLOCK_PAD_SURFACE_Y = 0.06;
// V17: the CC0 road tiles are slabs (asphalt ≈0.32 m, raised sidewalks
// ≈0.64 m after scaling), so the real profile is measured from the tile
// template once it loads. Until then (and for the fallback city) roads are
// flat at ROAD_SURFACE_Y with no sidewalk band.
let roadAsphaltY = ROAD_SURFACE_Y;
let roadSidewalkY = ROAD_SURFACE_Y;
let roadCurbOffset = Infinity;
const CHARACTER_SOLE_CLEARANCE = 0.018;
const GROUND_EPS = 0.04;
const buildingColliders = [];
// Immutable gameplay descriptors survive the later InstancedMesh optimization.
// Dynamic building fires use these rather than references to render objects.
const buildingTargets = [];
let buildingTargetSerial = 0;
const colliderGrid = new Map();
const blockSurfaceRegions = [];
const surfaceGrid = new Map();

function getGridKey(x, z) {
  return Math.floor(x / 64) + ',' + Math.floor(z / 64);
}

const parkBlocks = [];
const plazaBlocks = [];

const statusEl = document.querySelector('#asset-status');
let cityLoaded = false;
let loadedAssetCount = 0;
let totalAssetCount = 1;
function setAssetStatus(text) {
  if (statusEl) statusEl.textContent = text;
}
function updateAssetStatus() {
  if (!statusEl) return;
  if (cityLoaded) return;
  statusEl.textContent = `Carregando cidade CC0... ${loadedAssetCount}/${totalAssetCount}`;
}

function loadGLTF(path) {
  return new Promise((resolve, reject) => {
    const onLoad = gltf => {
      loadedAssetCount++;
      updateAssetStatus();
      resolve(gltf);
    };
    // Local copy first; the public mirror only matters if a file is missing.
    gltfLoader.load(assetUrl(path), onLoad, undefined, () => gltfLoader.load(mirrorUrl(path), onLoad, undefined, reject));
  });
}

// `cast: false` keeps a prop receiving shadows without adding it to the sun's
// shadow pass; small street props are not worth the extra geometry there.
function prepScene(root, { shadows = true, cast = shadows } = {}) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = cast;
    obj.receiveShadow = shadows;
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if ('roughness' in mat) mat.roughness = Math.max(mat.roughness ?? 0.7, 0.45);
      }
    }
  });
  return root;
}

function normalizedInstance(template, target, axis = 'height', skinned = false) {
  const wrapper = new THREE.Group();
  const object = skinned ? cloneSkeleton(template) : template.clone(true);
  wrapper.add(object);

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const denom = axis === 'height' ? size.y : Math.max(size.x, size.z);
  const scale = denom > 0.0001 ? target / denom : 1;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(object);
  const center = box2.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box2.min.y;
  // Expose the normalized child so animated pedestrians can receive the same
  // foot-lock correction as the main characters without re-walking the scene.
  wrapper.userData.normalizedObject = object;
  wrapper.userData.normalizedBaseY = object.position.y;
  return wrapper;
}

const FOOT_BONE_PRIORITY = [
  'fml_un_L_heel', 'fml_un_R_heel',
  'fml_un_L_toe_end', 'fml_un_R_toe_end',
  'fml_un_L_foot', 'fml_un_R_foot'
];

function collectFootBones(root) {
  if (!root) return [];
  const byName = new Map();
  const fallback = [];
  root.traverse(obj => {
    if (!obj.isBone) return;
    byName.set(obj.name, obj);
    if (/(?:foot|heel|toe)/i.test(obj.name) && !/(?:marker|vfx)/i.test(obj.name)) fallback.push(obj);
  });
  const preferred = FOOT_BONE_PRIORITY.map(name => byName.get(name)).filter(Boolean);
  return preferred.length >= 2 ? preferred : fallback.slice(0, 8);
}

function minBoneWorldY(bones) {
  if (!bones?.length) return null;
  const p = new THREE.Vector3();
  let y = Infinity;
  for (const bone of bones) {
    bone.getWorldPosition(p);
    if (Number.isFinite(p.y)) y = Math.min(y, p.y);
  }
  return Number.isFinite(y) ? y : null;
}

function createFootGrounding(model, ownerRoot) {
  if (!model || !ownerRoot) return null;
  ownerRoot.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  const bones = collectFootBones(model);
  const footY = minBoneWorldY(bones);
  if (footY == null) return null;
  return {
    model, ownerRoot, bones,
    baseModelY: model.position.y,
    referenceFootOffset: footY - ownerRoot.getWorldPosition(new THREE.Vector3()).y,
    correction: 0
  };
}

// `standingRootY` is where the owner root sits when standing on the surface.
// `weight` blends the foot lock in/out (1 = feet pinned to the surface,
// 0 = free). Partial weights let take-off push off the ground progressively.
function updateFootGrounding(rig, standingRootY, dt, weight = 1) {
  if (!rig) return;
  const { model, ownerRoot, bones } = rig;
  weight = THREE.MathUtils.clamp(Number(weight) || 0, 0, 1);
  if (weight <= 0) {
    rig.correction = THREE.MathUtils.lerp(rig.correction, 0, 1 - Math.exp(-10 * dt));
    model.position.y = rig.baseModelY + rig.correction;
    return;
  }

  ownerRoot.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  const currentFootY = minBoneWorldY(bones);
  if (currentFootY == null) return;
  // Keep the animated foot landmarks at their calibrated offset above the
  // visible road/pad/roof. The surface (not the root) is the reference so the
  // lock still holds while take-off already lifts the gameplay root.
  const desiredFootY = standingRootY + rig.referenceFootOffset + CHARACTER_SOLE_CLEARANCE;
  const error = desiredFootY - currentFootY;
  const target = THREE.MathUtils.clamp(rig.correction + error, -1.25, 0.65) * weight;
  rig.correction = THREE.MathUtils.lerp(rig.correction, target, 1 - Math.exp(-28 * dt));
  model.position.y = rig.baseModelY + rig.correction;
  model.updateMatrixWorld(true);
}

function makeFallbackCity() {
  // Only visible if remote assets fail. The normal version uses real GLBs.
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x292d33, roughness: 1 });
  for (const v of roadLaneCenters) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(CITY_HALF * 2 + 60, 0.08, 18), roadMat);
    a.position.set(0, 0.02, v); a.receiveShadow = true; world.add(a);
    const b = a.clone(); b.rotation.y = Math.PI / 2; b.position.set(v, 0.02, 0); world.add(b);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xa8b0b8, roughness: .85 });
  for (let x = -CITY_HALF; x <= CITY_HALF; x += 48) {
    for (let z = -CITY_HALF; z <= CITY_HALF; z += 48) {
      if (roadLaneCenters.some(v => Math.abs(x - v) < 20 || Math.abs(z - v) < 20)) continue;
      const h = 18 + rng() * 60;
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(26, h, 26); m.position.set(x, h / 2, z); world.add(m);
      registerBuildingCollider(m);
    }
  }
}

async function buildCC0City() {
  const buildStart = performance.now();
  const A = CITY_ASSETS;
  const propPaths = Object.values(A.props);
  totalAssetCount = A.midrise.length + A.towers.length + A.skyline.length + A.houses.length + A.streetLights.length
    + A.cars.length + A.trees.length + A.suburbTrees.length + A.plants.length + A.npcs.length + propPaths.length + 3;
  updateAssetStatus();
  try {
    const all = list => Promise.all(list.map(p => loadGLTF(p)));
    const [midriseG, towerG, skylineG, houseG, roadStraightGLTF, roadCrossGLTF, lightGs, trafficLightGLTF, propGs, carGs, treeGs, suburbTreeGs, plantGs, npcGs] = await Promise.all([
      all(A.midrise), all(A.towers), all(A.skyline), all(A.houses),
      loadGLTF(A.roadStraight), loadGLTF(A.roadCross), all(A.streetLights), loadGLTF(A.trafficLight),
      all(propPaths), all(A.cars.map(c => c.path)), all(A.trees), all(A.suburbTrees), all(A.plants), all(A.npcs)
    ]);

    const shaded = list => list.map(g => prepScene(g.scene, { shadows: true }));
    const props = (list, castShadow = false) => list.map(g => prepScene(g.scene, { shadows: true, cast: castShadow }));
    const templates = {
      midrise: shaded(midriseG),
      towers: shaded(towerG),
      skyline: skylineG.map(g => prepScene(g.scene, { shadows: false })),
      houses: shaded(houseG),
      lights: props(lightGs),
      traffic: prepScene(trafficLightGLTF.scene, { shadows: true, cast: false }),
      props: Object.fromEntries(Object.keys(A.props).map((key, i) => [key, prepScene(propGs[i].scene, { shadows: true, cast: false })])),
      cars: carGs.map((g, i) => ({ scene: prepScene(g.scene, { shadows: true }), length: A.cars[i].length })),
      trees: shaded(treeGs),
      suburbTrees: shaded(suburbTreeGs),
      plants: props(plantGs)
    };
    const straightTemplate = prepScene(roadStraightGLTF.scene, { shadows: false });
    const crossTemplate = prepScene(roadCrossGLTF.scene, { shadows: false });
    const npcTemplates = npcGs.map((g, i) => ({ scene: prepScene(g.scene, { shadows: true }), animations: g.animations, i }));

    buildRoadGrid(straightTemplate, crossTemplate);
    buildRoadMarkings();
    buildBuildings(templates);
    buildStreetFurniture(templates);
    buildTraffic(templates.cars);
    buildCrowd(npcTemplates);
    optimizeWorldInstancing();

    cityLoaded = true;
    console.info(`[city] ${Math.round(performance.now() - buildStart)} ms · ${buildingColliders.length} buildings`);
    const cityLabel = 'Cidade V18 CC0 · 15×15 avenidas · centro, bairros e subúrbios · tráfego + NPCs';
    setAssetStatus(heroReady && enemyReady ? `${cityLabel} · Superman + Jason` : heroReady ? `${cityLabel} · Superman local` : cityLabel);
  } catch (err) {
    console.warn('Falha ao carregar cidade CC0; usando fallback:', err);
    makeFallbackCity();
    cityLoaded = true;
    setAssetStatus('Falha de rede · cidade fallback ativa');
  }
}

// Raycasts a normalized straight tile to find its asphalt height, curb
// distance from the road centre and sidewalk height.
function measureRoadProfile(straightTemplate) {
  const probe = normalizedInstance(straightTemplate, TILE, 'footprint');
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const heightAt = (x, z) => {
    ray.set(new THREE.Vector3(x, 50, z), down);
    return ray.intersectObject(probe, true)[0]?.point.y ?? null;
  };
  const asphalt = heightAt(0, 0);
  if (asphalt == null) return;
  // The unrotated straight tile runs along X, so the profile varies along Z;
  // fall back to X in case a different kit orientation is used.
  for (const axis of ['z', 'x']) {
    for (let across = .5; across < TILE * .5 - .2; across += .2) {
      const h = axis === 'z' ? heightAt(0, across) : heightAt(across, 0);
      if (h != null && h > asphalt + .05) {
        roadAsphaltY = asphalt;
        roadSidewalkY = h;
        roadCurbOffset = across - .1;
        return;
      }
    }
  }
  roadAsphaltY = asphalt;
  roadSidewalkY = asphalt;
}

// Height of the road tile at (x, z), or null when the point is off-road.
function roadSurfaceAt(x, z) {
  const half = TILE * .5 + .35;
  let dx = Infinity, dz = Infinity;
  for (const v of roadLaneCenters) {
    dx = Math.min(dx, Math.abs(x - v));
    dz = Math.min(dz, Math.abs(z - v));
  }
  const alongZ = dx <= half;
  const alongX = dz <= half;
  if (!alongZ && !alongX) return null;
  // Crossroads only keep sidewalks in their four corners.
  const sidewalk = alongZ && alongX
    ? dx > roadCurbOffset && dz > roadCurbOffset
    : (alongZ ? dx : dz) > roadCurbOffset;
  return sidewalk ? roadSidewalkY : roadAsphaltY;
}

function buildRoadGrid(straightTemplate, crossTemplate) {
  // V9: nine avenues + nine streets create a much denser, continuous city.
  // Roads are still assembled from authored CC0 tiles; the procedural layer
  // only decides where each real road asset goes.
  measureRoadProfile(straightTemplate);
  const roadSet = new Set(roadLaneCenters.map(v => Math.round(v / TILE)));
  const maxCell = Math.round(CITY_HALF / TILE), minCell = -maxCell;
  for (let gx = minCell; gx <= maxCell; gx++) {
    for (let gz = minCell; gz <= maxCell; gz++) {
      const xRoad = roadSet.has(gx);
      const zRoad = roadSet.has(gz);
      if (!xRoad && !zRoad) continue;
      const isCross = xRoad && zRoad;
      const tile = normalizedInstance(isCross ? crossTemplate : straightTemplate, TILE, 'footprint');
      tile.position.set(gx * TILE, 0, gz * TILE);
      if (!isCross && xRoad) tile.rotation.y = Math.PI / 2;
      world.add(tile);
    }
  }
}

function buildRoadMarkings() {
  // A lightweight instanced overlay gives long avenues readable lanes and
  // crosswalks without adding hundreds of individual draw calls.
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf3e7b2, roughness: .9 });
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: .95 });
  const dashGeo = new THREE.BoxGeometry(5.6, .018, .16);
  const dashTransforms = [];
  for (const road of roadLaneCenters) {
    for (let t = -CITY_HALF - 16; t <= CITY_HALF + 16; t += 14) {
      if (roadLaneCenters.some(v => Math.abs(t - v) < 18)) continue;
      dashTransforms.push({ x:t, z:road, rot:0 });
      dashTransforms.push({ x:road, z:t, rot:Math.PI / 2 });
    }
  }
  addChunkedInstances(dashGeo, lineMat, dashTransforms, roadAsphaltY + .01);

  const stripeGeo = new THREE.BoxGeometry(1.0, .022, 8.2);
  const stripes = [];
  for (const x of roadLaneCenters) {
    for (const z of roadLaneCenters) {
      for (let i = -3; i <= 3; i++) {
        const o = i * 1.7;
        stripes.push({x:x + o, z:z - 11.2, rot:0});
        stripes.push({x:x + o, z:z + 11.2, rot:0});
        stripes.push({x:x - 11.2, z:z + o, rot:Math.PI/2});
        stripes.push({x:x + 11.2, z:z + o, rot:Math.PI/2});
      }
    }
  }
  addChunkedInstances(stripeGeo, crossMat, stripes, roadAsphaltY + .012);
}

// One InstancedMesh per spatial chunk (instead of one for the whole city) so
// distant road paint is frustum-culled like everything else.
function addChunkedInstances(geometry, material, transforms, y) {
  const chunks = new Map();
  for (const t of transforms) {
    const key = chunkKey(t.x, t.z, INSTANCE_CHUNK);
    let list = chunks.get(key);
    if (!list) { list = []; chunks.set(key, list); }
    list.push(t);
  }
  const dummy = new THREE.Object3D();
  for (const list of chunks.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, y, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.matrixAutoUpdate = false;
    world.add(mesh);
  }
}

function registerBuildingCollider(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!box.isEmpty()) {
    // Slightly shrink the vertical range at street level so awnings and tiny
    // decorative pieces do not feel like invisible walls.
    box.min.x += 0.25; box.max.x -= 0.25;
    box.min.z += 0.25; box.max.z -= 0.25;
    buildingColliders.push(box);
    buildingTargets.push(Object.freeze({
      id: `building-${++buildingTargetSerial}`,
      min: Object.freeze({ x:box.min.x, y:box.min.y, z:box.min.z }),
      max: Object.freeze({ x:box.max.x, y:box.max.y, z:box.max.z })
    }));

    const minGX = Math.floor(box.min.x / 64);
    const maxGX = Math.floor(box.max.x / 64);
    const minGZ = Math.floor(box.min.z / 64);
    const maxGZ = Math.floor(box.max.z / 64);
    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gz = minGZ; gz <= maxGZ; gz++) {
        const key = gx + ',' + gz;
        let cell = colliderGrid.get(key);
        if (!cell) { cell = []; colliderGrid.set(key, cell); }
        cell.push(box);
      }
    }
  }
}

// Spots for yard trees/bushes next to suburban houses, filled while planning
// blocks and consumed by buildStreetFurniture.
const yardSpots = [];

// Colliders whose 64 m grid cells touch the segment a -> b. Scanning every
// building per ray no longer scales now that the city has hundreds of them.
function collidersAlong(a, b, pad = 2) {
  const out = new Set();
  const minGX = Math.floor((Math.min(a.x, b.x) - pad) / 64), maxGX = Math.floor((Math.max(a.x, b.x) + pad) / 64);
  const minGZ = Math.floor((Math.min(a.z, b.z) - pad) / 64), maxGZ = Math.floor((Math.max(a.z, b.z) + pad) / 64);
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      const cell = colliderGrid.get(gx + ',' + gz);
      if (cell) for (const box of cell) out.add(box);
    }
  }
  return out;
}

function buildBuildings(t) {
  // V18 district planner. Distance from the centre decides the character of a
  // block: a dense downtown core of towers, a mixed ring, residential blocks
  // with low-rise + houses, and suburbs of detached houses with yards. Parks and
  // plazas become more common the further out you go. Facades face the street.
  const blockCenters = [];
  for (let i = 0; i < roadLaneCenters.length - 1; i++) {
    blockCenters.push((roadLaneCenters[i] + roadLaneCenters[i + 1]) * .5);
  }
  const lowIdx = new Set([2, 4, 9, 10, 12]);
  const lowrise = t.midrise.filter((_, i) => lowIdx.has(i));
  const midrise = t.midrise.filter((_, i) => !lowIdx.has(i));
  const towers = t.towers;
  const houses = t.houses;
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb8babd, roughness: .96 });
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xc8c3b6, roughness: .93 });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x627f4c, roughness: 1 });
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x78a05a, roughness: 1 });
  const blockGeo = new THREE.BoxGeometry(65, .10, 65);
  let count = 0;

  const choose = pool => pool[(count++ + Math.floor(rng() * pool.length)) % pool.length];
  const placeBuilding = (scene, x, z, footprint, rot = 0) => {
    if (!scene) return null;
    const b = normalizedInstance(scene, footprint, 'footprint');
    b.position.set(x, 0, z);
    b.rotation.y = rot;
    world.add(b);
    registerBuildingCollider(b);
    return b;
  };
  const shuffled = list => list.map(v => [rng(), v]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
  const placeHouses = (bx, bz, wanted) => {
    const cols = [-21, 0, 21], rows = [-21, 21];
    const slots = shuffled(cols.flatMap(ox => rows.map(oz => [ox, oz])));
    for (let i = 0; i < Math.min(wanted, slots.length); i++) {
      const [ox, oz] = slots[i];
      const x = bx + ox + (rng() - .5) * 2.5, z = bz + oz + (rng() - .5) * 2.5;
      placeBuilding(choose(houses), x, z, 13 + rng() * 2.5, lotFacingRotation(ox, oz));
      // Yard tree behind the house, bush beside it.
      yardSpots.push({ x: x + (rng() - .5) * 8, z: z + Math.sign(oz) * (8 + rng() * 2), kind: 'tree' });
      if (rng() > .4) yardSpots.push({ x: x + (rng() > .5 ? 1 : -1) * 8, z: z + (rng() - .5) * 6, kind: 'bush' });
    }
  };

  for (const bx of blockCenters) {
    for (const bz of blockCenters) {
      const district = classifyDistrict(Math.hypot(bx, bz), CITY_HALF);
      const core = district === 'core';
      const mid = district === 'mid';
      const residential = district === 'residential';
      const suburb = district === 'suburb';
      const roll = rng();
      const parkChance = core ? .025 : mid ? .07 : residential ? .13 : .1;
      const plazaChance = core ? .14 : mid ? .07 : residential ? .04 : .02;
      const isPark = roll < parkChance;
      const isPlaza = !isPark && roll < parkChance + plazaChance;

      const padMat = isPark ? parkMat : isPlaza ? plazaMat : (residential || suburb) ? lawnMat : sidewalkMat;
      const pad = new THREE.Mesh(blockGeo, padMat);
      pad.position.set(bx, .01, bz);
      pad.receiveShadow = true;
      world.add(pad);
      const region = { minX: bx - 32.5, maxX: bx + 32.5, minZ: bz - 32.5, maxZ: bz + 32.5, y: BLOCK_PAD_SURFACE_Y };
      blockSurfaceRegions.push(region);
      const rMinGX = Math.floor(region.minX / 64), rMaxGX = Math.floor(region.maxX / 64);
      const rMinGZ = Math.floor(region.minZ / 64), rMaxGZ = Math.floor(region.maxZ / 64);
      for (let gx = rMinGX; gx <= rMaxGX; gx++) {
        for (let gz = rMinGZ; gz <= rMaxGZ; gz++) {
          const key = gx + ',' + gz;
          let cell = surfaceGrid.get(key);
          if (!cell) { cell = []; surfaceGrid.set(key, cell); }
          cell.push(region);
        }
      }

      if (isPark) {
        parkBlocks.push({ x: bx, z: bz });
        continue;
      }

      const quarter = Math.round(rng() * 3) * Math.PI / 2;
      if (isPlaza) {
        plazaBlocks.push({ x: bx, z: bz });
        const pool = core ? towers : (mid ? midrise : lowrise);
        placeBuilding(choose(pool), bx + (rng()-.5)*9, bz + (rng()-.5)*9, core ? 27 : 23, quarter);
        continue;
      }

      if (core) {
        // Downtown campus: one signature tower plus smaller street-wall massing.
        placeBuilding(choose(towers), bx + (rng()-.5)*4, bz + (rng()-.5)*4, 28 + rng()*4, quarter);
        if (rng() > .22) placeBuilding(choose(midrise), bx - 22, bz + 20, 17 + rng()*3, quarter + Math.PI/2);
        if (rng() > .35) placeBuilding(choose(midrise), bx + 21, bz - 20, 17 + rng()*3, quarter);
      } else if (mid && rng() < .43) {
        // Mixed-use blocks: tower set back from the corner, with one/two lower buildings.
        const sx = rng() > .5 ? 1 : -1;
        const sz = rng() > .5 ? 1 : -1;
        placeBuilding(choose(towers), bx + sx*10, bz + sz*10, 25 + rng()*4, quarter);
        placeBuilding(choose(midrise), bx - sx*20, bz + sz*18, 18 + rng()*4, quarter + Math.PI/2);
        if (rng() > .45) placeBuilding(choose(lowrise), bx + sx*18, bz - sz*21, 17 + rng()*3, quarter);
      } else if (mid) {
        const slots = [[-18,-18],[18,-18],[-18,18],[18,18]];
        const slotOffset = Math.floor(rng() * slots.length);
        const lotCount = rng() < .45 ? 4 : 3;
        for (let i = 0; i < lotCount; i++) {
          const [ox, oz] = slots[(slotOffset + i) % slots.length];
          placeBuilding(choose(rng() < .5 ? midrise : lowrise), bx + ox + (rng()-.5)*2, bz + oz + (rng()-.5)*2, 18 + rng()*4, quarter + (i%2)*Math.PI/2);
        }
      } else if (residential) {
        // Low-rise apartments on one or two corners, houses filling the rest.
        const slots = shuffled([[-19,-19],[19,-19],[-19,19],[19,19]]);
        const apartments = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < apartments; i++) {
          const [ox, oz] = slots[i];
          placeBuilding(choose(lowrise), bx + ox, bz + oz, 17 + rng()*3, lotFacingRotation(ox, oz));
        }
        for (let i = apartments; i < 4; i++) {
          const [ox, oz] = slots[i];
          const x = bx + ox, z = bz + oz;
          placeBuilding(choose(houses), x, z, 14 + rng()*2, lotFacingRotation(ox, oz));
          yardSpots.push({ x: x - Math.sign(ox) * 8, z: z - Math.sign(oz) * 8, kind: 'tree' });
        }
      } else if (suburb) {
        placeHouses(bx, bz, 4 + Math.floor(rng() * 3));
      }
    }
  }

  // Decorative horizon: two rings of cheap low-detail towers just outside the
  // playable area so the city keeps going beyond the edge instead of ending.
  for (let row = 0; row < 2; row++) {
    const offset = CITY_HALF + 78 + row * 52;
    for (let s = -offset; s <= offset; s += 34) {
      for (const [x, z] of [[s, offset], [s, -offset], [offset, s], [-offset, s]]) {
        if (rng() < .1) continue;
        const data = t.skyline[Math.floor(rng() * t.skyline.length)];
        const b = normalizedInstance(data, 15 + rng() * 10, 'footprint');
        b.position.set(x + (rng() - .5) * 8, 0, z + (rng() - .5) * 8);
        b.rotation.y = Math.round(rng() * 3) * Math.PI / 2;
        b.scale.y *= .55 + rng() * .75;
        world.add(b);
      }
    }
  }
}

// Props stand on the measured road/sidewalk/pad height instead of Y=0.
function placeOnSurface(object, x, z) {
  object.position.set(x, getBaseSurfaceHeightAt(x, z), z);
}

function buildStreetFurniture(t) {
  // Streetlights, trees and props follow the avenue grid. Intersections are left
  // clear for crosswalks, traffic lights and signs.
  const reach = Math.floor((CITY_HALF + 16) / 32) * 32;
  const treeChance = { core: .35, mid: .5, residential: .78, suburb: .9 };
  let lightIndex = 0;
  for (const avenue of roadLaneCenters) {
    for (let p = -reach; p <= reach; p += 32) {
      if (roadLaneCenters.some(v => Math.abs(p - v) < 14)) continue;
      const side = ((Math.round(p / 32)) & 1) ? 1 : -1;
      const lightTemplate = t.lights[(lightIndex++ >> 1) % t.lights.length];

      const lightA = normalizedInstance(lightTemplate, 6.3, 'height');
      placeOnSurface(lightA, p, avenue + side * 13.5);
      lightA.rotation.y = side > 0 ? Math.PI : 0;
      world.add(lightA);

      const lightB = normalizedInstance(lightTemplate, 6.3, 'height');
      placeOnSurface(lightB, avenue + side * 13.5, p);
      lightB.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      world.add(lightB);

      const district = classifyDistrict(Math.hypot(p, avenue), CITY_HALF);
      if (rng() < treeChance[district]) {
        const tree = normalizedInstance(t.trees[Math.floor(rng() * t.trees.length)], 5.2 + rng() * 3.2, 'height');
        placeOnSurface(tree, p + 9, avenue - side * 13.2);
        tree.rotation.y = rng() * Math.PI * 2;
        world.add(tree);
      }

      // Sidewalk dumpsters downtown, now and then.
      if ((district === 'core' || district === 'mid') && rng() < .05) {
        const dumpster = normalizedInstance(t.props.dumpster, 2.2, 'footprint');
        placeOnSurface(dumpster, p + 4, avenue + side * 14.6);
        dumpster.rotation.y = side > 0 ? 0 : Math.PI;
        world.add(dumpster);
      }
    }
  }

  // Roadworks: a few cone/barrier clusters along the kerb lane of random avenues.
  for (let i = 0; i < 26; i++) {
    const avenue = roadLaneCenters[Math.floor(rng() * roadLaneCenters.length)];
    const along = (rng() * 2 - 1) * (CITY_HALF - 30);
    if (roadLaneCenters.some(v => Math.abs(along - v) < 24)) continue;
    const alongX = rng() > .5;
    const lane = (rng() > .5 ? 1 : -1) * 9.4;
    const at = (a, l) => alongX ? [a, avenue + l] : [avenue + l, a];
    const barrier = normalizedInstance(t.props.barrier, 3.4, 'footprint');
    const [bx, bz] = at(along, lane);
    barrier.position.set(bx, roadAsphaltY, bz);
    barrier.rotation.y = alongX ? 0 : Math.PI / 2;
    world.add(barrier);
    for (let c = 1; c <= 3; c++) {
      const cone = normalizedInstance(t.props.cone, 1, 'height');
      const [cx, cz] = at(along - c * 3.2, lane - Math.sign(lane) * c * .7);
      cone.position.set(cx, roadAsphaltY, cz);
      world.add(cone);
    }
  }

  // Parks: tree clusters underplanted with bushes, flowers and rocks.
  for (const park of parkBlocks) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + rng() * .35;
      const r = 8 + rng() * 21;
      const tree = normalizedInstance(t.trees[Math.floor(rng() * t.trees.length)], 5.4 + rng() * 4.5, 'height');
      placeOnSurface(tree, park.x + Math.cos(a) * r, park.z + Math.sin(a) * r);
      tree.rotation.y = rng() * Math.PI * 2;
      world.add(tree);
    }
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = 3 + rng() * 26;
      const kind = Math.floor(rng() * t.plants.length);
      const height = kind < 2 ? 1.2 + rng() * 1.2 : kind < 5 ? .5 + rng() * .35 : 1 + rng() * 1.2;
      const plant = normalizedInstance(t.plants[kind], height, 'height');
      placeOnSurface(plant, park.x + Math.cos(a) * r, park.z + Math.sin(a) * r);
      plant.rotation.y = rng() * Math.PI * 2;
      world.add(plant);
    }
  }
  for (const plaza of plazaBlocks) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * .5 * i + Math.PI * .25;
      const tree = normalizedInstance(t.trees[Math.floor(rng() * t.trees.length)], 5.5 + rng() * 2, 'height');
      placeOnSurface(tree, plaza.x + Math.cos(a) * 25, plaza.z + Math.sin(a) * 25);
      world.add(tree);
    }
  }

  // House yards (collected by the block planner).
  for (const spot of yardSpots) {
    if (spot.kind === 'tree') {
      const tree = normalizedInstance(t.suburbTrees[Math.floor(rng() * t.suburbTrees.length)], 6 + rng() * 3, 'height');
      placeOnSurface(tree, spot.x, spot.z);
      tree.rotation.y = rng() * Math.PI * 2;
      world.add(tree);
    } else {
      const bush = normalizedInstance(t.plants[Math.floor(rng() * 2)], 1.1 + rng() * .8, 'height');
      placeOnSurface(bush, spot.x, spot.z);
      bush.rotation.y = rng() * Math.PI * 2;
      world.add(bush);
    }
  }

  // Intersections alternate between hanging traffic lights and street signs.
  for (const x of roadLaneCenters) {
    for (const z of roadLaneCenters) {
      if ((Math.round(x / ROAD_SPACING) + Math.round(z / ROAD_SPACING)) % 2 !== 0) {
        if (rng() < .5) {
          const sign = normalizedInstance(t.props.streetSign, 4.2, 'height');
          placeOnSurface(sign, x - 13.4, z + 13.4);
          sign.rotation.y = Math.PI * .25;
          world.add(sign);
        }
        continue;
      }
      const tl = normalizedInstance(t.traffic, 6.8, 'height');
      placeOnSurface(tl, x + 11.5, z + 11.5);
      tl.rotation.y = Math.PI * .25;
      world.add(tl);
    }
  }
}

function buildTraffic(carTemplates) {
  // Mostly everyday cars, some vans/trucks, the odd emergency vehicle.
  const everyday = carTemplates.slice(0, 7), heavy = carTemplates.slice(7, 11), emergency = carTemplates.slice(11);
  const pick = () => {
    const roll = rng();
    const pool = roll < .64 ? everyday : roll < .92 ? heavy : emergency;
    return pool[Math.floor(rng() * pool.length)];
  };

  // Plan first so each model's InstancedMesh gets an exact capacity.
  const plan = [];
  const perModel = new Array(carTemplates.length).fill(0);
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const template = pick();
    const modelIndex = carTemplates.indexOf(template);
    perModel[modelIndex]++;
    plan.push({
      modelIndex,
      axis: i % 2 === 0 ? 'x' : 'z',
      road: roadLaneCenters[Math.floor(rng() * roadLaneCenters.length)],
      direction: rng() > .5 ? 1 : -1,
      progress: (rng() * 2 - 1) * (CITY_HALF + 26),
      speed: 8 + rng() * 8
    });
  }
  const models = carTemplates
    .map((t, i) => ({ wrapper: normalizedInstance(t.scene, t.length, 'footprint'), capacity: perModel[i], i }))
    .filter(m => m.capacity > 0);
  const slot = new Map(models.map((m, index) => [m.i, index]));
  carRenderer = new InstancedTraffic(world, models);

  for (const car of plan) {
    // Cars are plain Object3Ds (never added to the scene): gameplay code moves
    // `.position`, and InstancedTraffic turns them into instance matrices.
    const object = new THREE.Object3D();
    const laneOffset = car.direction * 3.6;
    if (car.axis === 'x') {
      object.position.set(car.progress, roadAsphaltY, car.road + laneOffset);
      object.rotation.y = car.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      object.position.set(car.road - laneOffset, roadAsphaltY, car.progress);
      object.rotation.y = car.direction > 0 ? 0 : Math.PI;
    }
    carRenderer.register(slot.get(car.modelIndex), object);
    trafficActors.push({ object, axis: car.axis, direction: car.direction, road: car.road, speed: car.speed });
  }
  carRenderer.update(camera.position, TRAFFIC_RENDER_RADIUS);
}

function buildCrowd(templates) {
  for (let i = 0; i < CROWD_COUNT; i++) {
    const data = templates[i % templates.length];
    const npc = normalizedInstance(data.scene, 1.72, 'height', true);
    const axis = i % 2 === 0 ? 'x' : 'z';
    const road = roadLaneCenters[Math.floor(rng() * roadLaneCenters.length)];
    const direction = rng() > .5 ? 1 : -1;
    const sidewalkOffset = (rng() > .5 ? 1 : -1) * 13.2;
    const progress = (rng() * 2 - 1) * (CITY_HALF + 20);
    const startX = axis === 'x' ? progress : road + sidewalkOffset;
    const startZ = axis === 'x' ? road + sidewalkOffset : progress;
    const startSurface = getBaseSurfaceHeightAt(startX, startZ);
    if (axis === 'x') {
      npc.position.set(startX, startSurface, startZ);
      npc.rotation.y = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      npc.position.set(startX, startSurface, startZ);
      npc.rotation.y = direction > 0 ? 0 : Math.PI;
    }
    world.add(npc);

    let mixer = null;
    let grounding = null;
    if (data.animations?.length) {
      mixer = new THREE.AnimationMixer(npc);
      const preferred = data.animations.find(c => /walk|run/i.test(c.name)) || data.animations[0];
      mixer.clipAction(preferred).play();
      mixer.update(0);
      grounding = createFootGrounding(npc.userData.normalizedObject, npc);
      npcMixers.push(mixer);
    }
    npcActors.push({ object: npc, axis, direction, road, speed: 1.0 + rng() * .8, mixer, grounding, phase: rng() * Math.PI * 2 });
  }
}

const TRAFFIC_WRAP = CITY_HALF + 36;
const CROWD_WRAP = CITY_HALF + 30;

function updateCityLife(dt, time) {
  if (spaceState.active || reentryState.active) return;
  for (const car of trafficActors) {
    const p = car.object.position;
    if (car.axis === 'x') {
      p.x += car.direction * car.speed * dt;
      if (p.x > TRAFFIC_WRAP) p.x = -TRAFFIC_WRAP;
      if (p.x < -TRAFFIC_WRAP) p.x = TRAFFIC_WRAP;
    } else {
      p.z += car.direction * car.speed * dt;
      if (p.z > TRAFFIC_WRAP) p.z = -TRAFFIC_WRAP;
      if (p.z < -TRAFFIC_WRAP) p.z = TRAFFIC_WRAP;
    }
  }

  const camPos = camera.position;
  carRenderer?.update(camPos, TRAFFIC_RENDER_RADIUS);

  for (const npc of npcActors) {
    const p = npc.object.position;
    if (npc.axis === 'x') {
      p.x += npc.direction * npc.speed * dt;
      if (p.x > CROWD_WRAP) p.x = -CROWD_WRAP;
      if (p.x < -CROWD_WRAP) p.x = CROWD_WRAP;
    } else {
      p.z += npc.direction * npc.speed * dt;
      if (p.z > CROWD_WRAP) p.z = -CROWD_WRAP;
      if (p.z < -CROWD_WRAP) p.z = CROWD_WRAP;
    }

    // Distance culling: far pedestrians are hidden (skipping their skinned
    // draw + shadow) and skip height/IK work entirely.
    const distSq = (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2;
    const near = distSq <= NPC_RENDER_RADIUS * NPC_RENDER_RADIUS;
    if (npc.object.visible !== near) npc.object.visible = near;
    if (!near) continue;

    const surface = getBaseSurfaceHeightAt(p.x, p.z);
    const bob = npc.mixer ? 0 : Math.max(0, Math.sin(time * 7 + npc.phase) * .025);
    npc.object.position.y = surface + bob;

    if (npc.mixer) npc.mixer.update(dt);
    if (npc.grounding) {
      updateFootGrounding(npc.grounding, surface, dt, 1);
    }
  }
}

buildCC0City();

// ---------------------------------------------------------------------------
// SUPERMAN MODEL (local GLB supplied by the user)
// ---------------------------------------------------------------------------
// The original Sketchfab download contains 181 animation clips and is ~57 MB.
// This project ships a locally optimized GLB containing the mesh/textures plus
// 17 useful clips for gameplay, including leap attack/landing, S08 air-idle and ground laser, while staying ~11 MB.
const CHARACTER_URL = './assets/superman/Superman-game.glb';

const hero = new THREE.Group();
hero.position.set(0, getBaseSurfaceHeightAt(0, 130) + GROUND_EPS, 130);
scene.add(hero);

const heroVisual = new THREE.Group();
hero.add(heroVisual);

// Orientation adapter for the imported MultiVersus rig.
// Bone layout confirms this asset is authored with character forward on +X
// (the eye/face bones extend along +X and left/right is the Z axis), while
// gameplay in this project uses local +Z as the hero's forward direction.
// Therefore this is an AXIS conversion, not a mirror: rotate +X -> +Z by -90°.
// Keeping scale positive also avoids negative-scale/skinning/culling artifacts.
const modelOrientation = new THREE.Group();
modelOrientation.rotation.y = -Math.PI / 2;
heroVisual.add(modelOrientation);

let importedHero = null;
let mixer = null;
let currentAction = null;
let clipMap = new Map();
let heroGroundClipMap = new Map();
let currentAnimName = '';
let actionLocked = false;
let currentOnceAction = null;
let currentOnceListener = null;
let heroReady = false;
let heroGroundRig = null;
const heroBoneMap = new Map();
let heroEventQueue = [];
let heroActiveSlot = '';
let heatVisionHoldLoopAir = null;
let heatVisionHoldLoopGround = null;
let heatVisionAnimPhase = 'idle';
let heatVisionAnimSource = 'air';
let airStopState = 'moving';
const AIR_STOP_TRIGGER_SPEED = 4.2;
const AIR_IDLE_SPEED = 0.42;

// V13 authored leap attack. The source GLB contains a dedicated pair:
// C003_LeapAttack (wind-up + airborne strike) and C003_LeapAttackLand
// (impact recovery). World motion is driven here so the attack respects the
// city scale and never depends on animation root motion.
const leapAttack = {
  active: false,
  phase: 'idle',
  elapsed: 0,
  windup: .52,
  travel: .82,
  start: new THREE.Vector3(),
  end: new THREE.Vector3(),
  direction: new THREE.Vector3(0,0,1),
  arcHeight: 3.8,
  lockedEnemy: false,
  impacted: false
};
const LEAP_MAX_RANGE = 18.5;
const LEAP_MIN_RANGE = .75;
const LEAP_DAMAGE = 42;
const LEAP_IMPACT_RADIUS = 3.6;
const LEAP_KNOCKBACK = 5.2;

const TAKEOFF_CLEARANCE = 3.35;
const flightMachine = new HeroFlightState();
let transitionStartY = GROUND_EPS;
let transitionTargetY = GROUND_EPS;
let landingSurfaceY = 0;
let landingDuration = 1;
let landingTouchdownTime = .075;
let landingTouchedDown = false;
const LAND_CLIP_TOUCHDOWN = .075;
let superPunchImpactTimer = -1;
let cameraShake = 0;
const impactEffects = [];

// Lightweight fallback shown only if the local GLB cannot be loaded.
const fallback = new THREE.Group();
fallback.scale.setScalar(.48);
fallback.position.y = .50;
heroVisual.add(fallback);
const suit = new THREE.MeshStandardMaterial({ color: 0x174ea6, roughness: .62 });
const red = new THREE.MeshStandardMaterial({ color: 0xa61d2d, roughness: .7, side: THREE.DoubleSide });
const skin = new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: .85 });
const dark = new THREE.MeshStandardMaterial({ color: 0x15191f, roughness: .8 });
const gold = new THREE.MeshStandardMaterial({ color: 0xf2c84b, roughness: .55, metalness: .1 });
function fallbackMesh(geo, mat, x,y,z, rx=0,ry=0,rz=0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x,y,z); m.rotation.set(rx,ry,rz);
  m.castShadow = true; m.receiveShadow = true; fallback.add(m); return m;
}
const torso = fallbackMesh(new THREE.CapsuleGeometry(.52, 1.25, 6, 12), suit, 0, 1.25, 0);
torso.scale.set(1.05,1.1,.72);
fallbackMesh(new THREE.SphereGeometry(.42, 18, 14), skin, 0, 2.55, 0);
fallbackMesh(new THREE.SphereGeometry(.43, 16, 10, 0, Math.PI*2, 0, Math.PI*.47), dark, 0, 2.67, -.04, -0.08,0,0);
fallbackMesh(new THREE.CapsuleGeometry(.19,.9,5,10), suit, -.73,1.35,0, 0,0,.14);
fallbackMesh(new THREE.CapsuleGeometry(.19,.9,5,10), suit, .73,1.35,0, 0,0,-.14);
fallbackMesh(new THREE.CapsuleGeometry(.22,1.05,5,10), suit, -.33,-.05,0);
fallbackMesh(new THREE.CapsuleGeometry(.22,1.05,5,10), suit, .33,-.05,0);
fallbackMesh(new THREE.BoxGeometry(.48,.48,.74), red, -.33,-.8,.05);
fallbackMesh(new THREE.BoxGeometry(.48,.48,.74), red, .33,-.8,.05);
fallbackMesh(new THREE.BoxGeometry(1.1,.16,.55), gold, 0,.55,0);
fallbackMesh(new THREE.CircleGeometry(.29, 5), gold, 0,1.55,-.39, 0, Math.PI, 0);

function heroStatus(text) {
  if (!cityLoaded) return;
  setAssetStatus(text);
}

gltfLoader.load(CHARACTER_URL, async gltf => {
  heroAnimConfig = await heroConfigPromise;
  importedHero = gltf.scene;
  prepScene(importedHero, { shadows: true });

  // Normalize the authored model to a world-space superhero height.
  const box = new THREE.Box3().setFromObject(importedHero);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetHeight = Number(heroAnimConfig?.transform?.targetHeight) || 2.05;
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  importedHero.scale.setScalar(scale);
  importedHero.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  // Keep the imported scene itself unrotated. `modelOrientation` above performs
  // the source-rig +X -> gameplay +Z conversion once, so every animation uses
  // the same forward axis and the hero no longer flies sideways.
  importedHero.rotation.y = 0;
  applyConfiguredOrientation(modelOrientation, heroAnimConfig);
  modelOrientation.add(importedHero);
  heroBoneMap.clear();
  importedHero.traverse(obj => { if (obj.isBone) heroBoneMap.set(obj.name, obj); });
  heroGroundRig = createFootGrounding(importedHero, hero);
  fallback.visible = false;

  mixer = new THREE.AnimationMixer(importedHero);

  function sanitizeHeroClip(clip, variant) {
    const c = clip.clone();
    const newTracks = remapVerticalTracks(c.tracks, heroClipVerticalMode(clip.name, variant));
    c.tracks = newTracks.map((t, i) => {
      const orig = c.tracks[i];
      if (t !== orig) return new THREE.VectorKeyframeTrack(t.name, orig.times, t.values);
      return orig;
    });
    return c;
  }

  // `clipMap` holds the air-safe variants (pelvis pinned) that every lookup
  // uses; `heroGroundClipMap` holds authored-height variants that
  // transitionTo() swaps in while Superman is standing on a surface.
  clipMap = new Map(gltf.animations.map(c => {
    const clean = sanitizeHeroClip(c, 'air');
    return [clean.name, clean];
  }));
  heroGroundClipMap = new Map(gltf.animations
    .filter(c => HERO_GROUND_AUTHORED_CLIPS.has(c.name))
    .map(c => [c.name, sanitizeHeroClip(c, 'ground')]));
  prepareHeatVisionHoldLoops();
  heroReady = true;

  const idleCfg = slotConfig(heroAnimConfig, 'idle', { clip:'C003_Idle_01', speed:1, fade:.08, loop:true });
  const idle = findClip([idleCfg.clip, 'C003_Idle_01', 'C003_Flying_Hold']);
  if (idle) playClip(idle, idleCfg.fade, false, idleCfg.speed);
  heroStatus(`Superman local carregado · ${gltf.animations.length} animações de gameplay`);
}, progress => {
  if (!cityLoaded || !progress.total) return;
  const pct = Math.round(progress.loaded / progress.total * 100);
  setAssetStatus(`Cidade CC0 online · carregando Superman local... ${pct}%`);
}, err => {
  console.warn('Falha ao carregar Superman local, usando fallback:', err);
  heroStatus('Cidade CC0 online · falha no GLB local, personagem fallback ativo');
});

function findClip(candidates) {
  if (!clipMap.size) return null;
  for (const name of candidates) if (clipMap.has(name)) return clipMap.get(name);
  const lowerEntries = [...clipMap.entries()].map(([name, clip]) => [name.toLowerCase(), clip]);
  for (const candidate of candidates) {
    const q = candidate.toLowerCase();
    const exact = lowerEntries.find(([name]) => name === q);
    if (exact) return exact[1];
    const partial = lowerEntries.find(([name]) => name.includes(q));
    if (partial) return partial[1];
  }
  return null;
}


function buildTailPingPongLoop(sourceClip, name, tailFrames = 6, fps = 24) {
  if (!sourceClip) return null;
  const endFrame = Math.max(2, Math.ceil(sourceClip.duration * fps));
  const startFrame = Math.max(0, endFrame - tailFrames);
  const loop = THREE.AnimationUtils.subclip(sourceClip, name, startFrame, endFrame, fps);
  loop.optimize();
  return loop;
}

function prepareHeatVisionHoldLoops() {
  // The original MultiVersus GLB has C003_Laser_Air and C003_Laser_Ground,
  // but no separately named laser-loop clip. Build a stable hold loop from
  // the low-motion tail of each authored animation and ping-pong it to avoid
  // a visible seam when Q is held for several seconds.
  heatVisionHoldLoopAir = buildTailPingPongLoop(findClip(['C003_Laser_Air']), 'C003_Laser_Air_HoldLoop', 6, 24);
  // The ground loop is cut from the authored-height variant so the crouch stays planted.
  const groundLaser = findClip(['C003_Laser_Ground']);
  heatVisionHoldLoopGround = buildTailPingPongLoop(heroGroundClipMap.get(groundLaser?.name) || groundLaser, 'C003_Laser_Ground_HoldLoop', 7, 24);
}

function heroSlot(name, fallback = {}) {
  return slotConfig(heroAnimConfig, name, fallback);
}
function heroSlotClip(name, fallbacks = []) {
  const cfg = heroSlot(name, { clip: fallbacks[0] || '' });
  return { cfg, clip: findClip([cfg.clip, ...fallbacks].filter(Boolean)) };
}
function boneWorldPoint(boneMap, hitbox, fallbackRoot, fallbackYOffset = 1) {
  const fallback = fallbackRoot.position.clone().add(new THREE.Vector3(0, fallbackYOffset, 0));
  if (!hitbox?.bone) return fallback;
  const bone = boneMap.get(hitbox.bone);
  if (!bone) return fallback;
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  bone.getWorldPosition(p);
  bone.getWorldQuaternion(q);
  const off = new THREE.Vector3(Number(hitbox.offset?.x)||0, Number(hitbox.offset?.y)||0, Number(hitbox.offset?.z)||0).applyQuaternion(q);
  return p.add(off);
}
function scheduleHeroEvents(slotName, speed) {
  heroActiveSlot = slotName;
  heroEventQueue = queueSlotEvents(heroAnimConfig, slotName, speed);
  return heroEventQueue.length;
}
function dispatchHeroEvent(event) {
  if (!event) return;
  if (event.type === 'cameraShake') {
    cameraShake = Math.max(cameraShake, Number(event.strength) || .5);
    return;
  }
  if (event.type === 'heatVision') {
    if (enemyUnderAim(280, Number(event.radius) || 1.2)) {
      damageEnemy(Number(event.damage)||18, hero.position, Number(event.knockback)||0, event.label || 'VISÃO DE CALOR');
    }
    return;
  }
  if (event.type === 'leapAttackAOE') {
    triggerLeapAttackImpact();
    return;
  }
  if (event.type !== 'damage' || !enemyAlive) return;
  if (heroActiveSlot === 'superPunch') triggerSuperPunchImpact(false);
  const hitbox = hitboxById(heroAnimConfig, event.hitboxId);
  const origin = boneWorldPoint(heroBoneMap, hitbox, hero, 1.05);
  const enemyCenter = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  const radius = Number(event.radius) || Number(hitbox?.radius) || 1.8;
  if (origin.distanceTo(enemyCenter) <= radius + 1.0) {
    damageEnemy(Number(event.damage)||1, origin, Number(event.knockback)||0, event.label || heroActiveSlot.toUpperCase());
  }
}
function updateHeroEvents(dt) {
  if (!heroEventQueue.length) return;
  for (const item of heroEventQueue) item.remaining -= dt;
  const due = heroEventQueue.filter(item => item.remaining <= 0);
  heroEventQueue = heroEventQueue.filter(item => item.remaining > 0);
  for (const item of due) dispatchHeroEvent(item.event);
}

const activeListeners = new Set();

// Shared by Superman and Jason. Restarting the action that is currently
// visible (punch → punch) would reset its weight to zero and expose the bind
// pose, so the second request plays an alternate clone and cross-fades.
const alternateClips = new WeakMap();
function crossfadeAction(targetMixer, root, clip, current, fade) {
  let next = targetMixer.clipAction(clip, root);
  if (next === current) {
    let alternate = alternateClips.get(clip);
    if (!alternate) { alternate = clip.clone(); alternateClips.set(clip, alternate); }
    next = targetMixer.clipAction(alternate, root);
  }
  next.reset();
  if (current && current !== next) {
    // Equal fade durations keep the summed weight at 1 for the whole blend.
    current.fadeOut(fade);
    next.fadeIn(fade);
  } else {
    next.setEffectiveWeight(1);
  }
  return next.play();
}

// Superman stands on a surface: use the authored-height clip variants.
function heroUsesGroundVariants() {
  return flightMachine.state === 'grounded' || leapAttack.active;
}
function resolveHeroClip(clip) {
  if (!clip || !heroUsesGroundVariants()) return clip;
  return heroGroundClipMap.get(clip.name) || clip;
}

function clearHeroOnceListener() {
  if (mixer && currentOnceListener) {
    mixer.removeEventListener('finished', currentOnceListener);
    activeListeners.delete(currentOnceListener);
  }
  currentOnceAction = null;
  currentOnceListener = null;
}

function transitionTo(clip, opts = {}) {
  const { fade = 0.16, once = false, timeScale = 1, onFinished = null, loopMode = THREE.LoopRepeat } = opts;
  if (!mixer || !clip) return null;
  clip = resolveHeroClip(clip);

  if (!once && currentAction && currentAnimName === clip.name && currentAction.getClip().name === clip.name) {
    currentAction.timeScale = timeScale;
    return currentAction;
  }

  // A newer transition supersedes any pending one-shot completion callback.
  clearHeroOnceListener();
  const next = crossfadeAction(mixer, importedHero, clip, currentAction, fade);
  next.timeScale = timeScale;
  next.setLoop(once ? THREE.LoopOnce : loopMode, once ? 1 : Infinity);
  // One-shots hold their final pose until the next transition cross-fades
  // out of it. Disabling them on finish exposed the bind pose for a frame.
  next.clampWhenFinished = once;

  currentAction = next;
  currentAnimName = clip.name;

  if (once) {
    const listener = e => {
      if (e.action !== next) return;
      mixer.removeEventListener('finished', listener);
      activeListeners.delete(listener);
      if (currentOnceListener !== listener) return;
      currentOnceListener = null;
      currentOnceAction = null;
      actionLocked = false;
      // Keep currentAction (the held last frame) so the next clip blends from it.
      if (currentAction === next) currentAnimName = '';
      if (onFinished) onFinished();
    };
    currentOnceAction = next;
    currentOnceListener = listener;
    mixer.addEventListener('finished', listener);
    activeListeners.add(listener);
  }

  return next;
}

// Stops tracking the current one-shot without fading it out: the following
// transitionTo() cross-fades from its pose, which never exposes the bind pose.
function cancelCurrentOneShot() {
  clearHeroOnceListener();
  currentAnimName = '';
  actionLocked = false;
  heroEventQueue = [];
  heroActiveSlot = '';
}

function playClip(clip, fade=.16, once=false, timeScale=1) {
  if (actionLocked && !once) return currentAction;
  return transitionTo(clip, { fade, once, timeScale });
}

function playOneShot(candidates, message, timeScale=1, onComplete=null, slotName='') {
  if (actionLocked && heroActiveSlot === 'flyStop') {
    cancelCurrentOneShot(.06);
    airStopState = 'moving';
  } else if (actionLocked) return false;
  const cfg = slotName ? heroSlot(slotName, { clip:candidates[0], speed:timeScale, fade:.07, loop:false }) : null;
  const clip = findClip([cfg?.clip, ...candidates].filter(Boolean));
  if (!clip || !mixer) {
    if (message) showMessage(message, 350);
    if (onComplete) onComplete();
    return false;
  }
  const resolvedSpeed = cfg?.speed ?? timeScale;
  const resolvedFade = cfg?.fade ?? .07;
  actionLocked = true;
  const action = transitionTo(clip, { fade: resolvedFade, once: true, timeScale: resolvedSpeed, onFinished: onComplete });
  if (!action) { actionLocked = false; return false; }
  if (slotName) scheduleHeroEvents(slotName, resolvedSpeed);
  if (message) showMessage(message, 420);
  return true;
}

function updateAnimation(speed, boosted) {
  if (!mixer || !clipMap.size) return;

  const flightActive = flightMachine.state === 'flying';
  const flightLike = flightActive || flightMachine.state === 'landingApproach';
  const movementIntent = !!(keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD);

  // Flying_Stop is deliberately interruptible: pressing a movement key, using
  // an attack or starting heat vision should never make controls feel locked.
  if (actionLocked && heroActiveSlot === 'flyStop' && movementIntent) {
    cancelCurrentOneShot(.06);
    airStopState = 'moving';
  }
  if (actionLocked || heatVisionActive || iceBreathController.active) return;

  let slotName = 'idle';
  let fallbacks = ['C003_Idle_01', 'C003_Flying_Hold'];
  let dynamicScale = 1;

  if (flightMachine.state === 'grounded') {
    airStopState = 'moving';
    // Side/back dodges are a planted hop (procedural lean), not a run cycle.
    const plantedDodge = dodge.active && (dodge.backward || dodge.side);
    if (speed > .55 && !plantedDodge) {
      slotName = speed > 4.5 ? 'run' : 'walk';
      fallbacks = ['C003_Run_01', 'C003_Idle_01'];
      dynamicScale = THREE.MathUtils.clamp(speed / 5.8, .75, 1.55);
    }
  } else if (flightActive) {
    if (movementIntent || speed >= AIR_STOP_TRIGGER_SPEED) {
      airStopState = 'moving';
      slotName = 'fly';
      fallbacks = ['C003_Flying', 'C003_Flying_Hold'];
      dynamicScale = boosted ? 1.45 : THREE.MathUtils.lerp(.85, 1.18, THREE.MathUtils.clamp(speed / 50, 0, 1));
    } else if (airStopState === 'moving') {
      // As momentum falls away, play the authored stop animation exactly once.
      airStopState = 'stopping';
      const started = playOneShot(
        ['C003_Flying_Stop', 'C003_Flying_Hold'],
        '',
        1,
        () => { airStopState = 'idle'; },
        'flyStop'
      );
      if (!started) airStopState = 'idle';
      return;
    } else if (airStopState === 'stopping') {
      return;
    } else {
      // Fully stopped in mid-air: use the requested Character Select breathing
      // loop instead of the generic Flying_Hold pose.
      slotName = 'airIdle';
      fallbacks = ['C003_S08_Emote_CharacterSelect_Loop', 'C003_Flying_Hold', 'C003_Idle_01'];
      dynamicScale = speed <= AIR_IDLE_SPEED ? 1 : .92;
    }
  } else if (flightLike) {
    // Landing approach is a vertical descent: use the upright hover pose so
    // C003_Land starts from a matching silhouette instead of a dive.
    airStopState = 'moving';
    slotName = 'airIdle';
    fallbacks = ['C003_S08_Emote_CharacterSelect_Loop', 'C003_Flying_Hold'];
  }

  const { cfg, clip } = heroSlotClip(slotName, fallbacks);
  if (clip) playClip(clip, cfg.fade, false, cfg.speed * dynamicScale);
}



// ---------------------------------------------------------------------------
// JASON BOSS (local GLB supplied by the user)
// ---------------------------------------------------------------------------
// The uploaded Sketchfab GLB originally contains 129 clips and is ~44.8 MB.
// This build keeps the authored mesh/textures/rig plus 8 gameplay clips,
// reducing the runtime enemy file to ~11.5 MB without changing its appearance.
const ENEMY_URL = './assets/jason/Jason-game.glb';
const enemyRoot = new THREE.Group();
enemyRoot.position.set(0, getBaseSurfaceHeightAt(0, 185) + GROUND_EPS, 185);
scene.add(enemyRoot);

const enemyVisual = new THREE.Group();
enemyRoot.add(enemyVisual);

// Jason's MultiVersus rig uses the same +X-forward convention as the Superman
// asset. Gameplay uses +Z as forward, so apply the same -90° axis conversion.
const enemyOrientation = new THREE.Group();
enemyOrientation.rotation.y = -Math.PI / 2;
enemyVisual.add(enemyOrientation);

const enemyFallback = new THREE.Group();
enemyVisual.add(enemyFallback);
const enemyFallbackMat = new THREE.MeshStandardMaterial({ color: 0x29352f, roughness: .9 });
const enemyMaskMat = new THREE.MeshStandardMaterial({ color: 0xd8d2be, roughness: .75 });
const enemyBody = new THREE.Mesh(new THREE.CapsuleGeometry(.62, 1.28, 6, 12), enemyFallbackMat);
enemyBody.position.y = 1.23; enemyBody.scale.set(1.12, 1.0, .82); enemyBody.castShadow = true; enemyFallback.add(enemyBody);
const enemyHead = new THREE.Mesh(new THREE.SphereGeometry(.43, 16, 12), enemyFallbackMat);
enemyHead.position.y = 2.45; enemyHead.castShadow = true; enemyFallback.add(enemyHead);
const enemyMask = new THREE.Mesh(new THREE.SphereGeometry(.34, 16, 10, -Math.PI*.48, Math.PI*.96, .28, Math.PI*.62), enemyMaskMat);
enemyMask.position.set(.02, 2.43, .27); enemyMask.rotation.x = Math.PI/2; enemyMask.castShadow = true; enemyFallback.add(enemyMask);
enemyFallback.scale.setScalar(.86);

const enemyMarker = new THREE.Mesh(
  new THREE.RingGeometry(1.05, 1.22, 38),
  new THREE.MeshBasicMaterial({ color: 0xff263e, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false })
);
enemyMarker.rotation.x = -Math.PI / 2;
enemyMarker.position.y = .035;
enemyRoot.add(enemyMarker);

let importedEnemy = null;
let enemyMixer = null;
let enemyClipMap = new Map();
let enemyCurrentAction = null;
let enemyCurrentAnimName = '';
let enemyActionLocked = false;
let enemyReady = false;
let enemyGroundRig = null;
const enemyBoneMap = new Map();
let enemyEventQueue = [];
let enemyActiveSlot = '';
let enemyActionToken = 0;
let enemyAttackCooldown = .6;
let enemyAttackImpactTimer = -1;
let enemyAttackDamage = 0;
let enemyAttackRange = 0;
let enemyAttackKind = '';
let enemyHealth = 180;
let enemyMaxHealth = 180;
let enemyAlive = true;
let enemyHitInvuln = 0;
let enemyRespawnSerial = 0;
const ENEMY_SPAWN = new THREE.Vector3(0, GROUND_EPS, 185);
// V17 boss rounds: after each defeat Jason returns stronger.
const ENEMY_RESPAWN_DELAY = 7;
let enemyLevel = 1;
let enemyStats = enemyLevelStats(1);
let enemyRespawnTimer = -1;
let enemyEnraged = false;
let enemyFlash = 0;
let enemyDeathFall = 0;
const enemyPoise = new EnemyPoise();
const enemyFlashMaterials = [];
const ENEMY_FLASH_COLOR = new THREE.Color(0xfff1e0);
const ENEMY_ENRAGE_COLOR = new THREE.Color(0x5a0400);

let playerHealth = 100;
const playerMaxHealth = 100;
let playerInvuln = 0;
let playerDead = false;
let normalPunchImpactTimer = -1;

function updateCombatHUD() {
  const hpEl = document.querySelector('#player-health-value');
  if (hpEl) hpEl.textContent = Math.max(0, Math.ceil(playerHealth));
  const fill = document.querySelector('#boss-health-fill');
  const txt = document.querySelector('#boss-health-text');
  if (fill) fill.style.width = `${THREE.MathUtils.clamp(enemyHealth / enemyMaxHealth, 0, 1) * 100}%`;
  if (txt) txt.textContent = enemyAlive ? `${Math.max(0, Math.ceil(enemyHealth))} / ${enemyMaxHealth}`
    : enemyRespawnTimer > 0 ? `DERROTADO · VOLTA EM ${Math.ceil(enemyRespawnTimer)}s` : 'DERROTADO';
  const name = document.querySelector('#boss-name');
  if (name) name.textContent = `JASON · NÍVEL ${enemyLevel}${enemyEnraged && enemyAlive ? ' · FÚRIA' : ''}`;
  document.querySelector('#boss-hud')?.classList.toggle('enraged', enemyEnraged && enemyAlive);
}
updateCombatHUD();

function sanitizeEnemyClip(clip) {
  const c = clip.clone();
  c.name = clip.name + '_NoRoot';
  c.tracks = c.tracks.filter(track => !/^Root\.position$/i.test(track.name));
  return c;
}

function enemyFindClip(candidates, removeRootMotion = false) {
  if (!enemyClipMap.size) return null;

  function getClip(name) {
    let base = enemyClipMap.get(name);
    if (!base) {
      const q = name.toLowerCase();
      const entries = [...enemyClipMap.entries()];
      base = entries.find(e => e[0].toLowerCase() === q)?.[1];
      if (!base) base = entries.find(e => e[0].toLowerCase().includes(q))?.[1];
    }
    if (!base) return null;
    if (removeRootMotion) {
      const noRoot = enemyClipMap.get(base.name + '_NoRoot') || enemyClipMap.get(base.name.replace('_NoRoot', '') + '_NoRoot');
      if (noRoot) return noRoot;
    }
    return base;
  }

  for (const candidate of candidates) {
    const c = getClip(candidate);
    if (c) return c;
  }
  return null;
}

function enemyPlayClip(clip, fade=.14, once=false, timeScale=1, loopMode=THREE.LoopRepeat) {
  if (!enemyMixer || !clip) return null;
  if (!once && enemyActionLocked) return enemyCurrentAction;
  if (!once && enemyCurrentAnimName === clip.name && enemyCurrentAction) {
    enemyCurrentAction.timeScale = timeScale;
    return enemyCurrentAction;
  }
  const next = crossfadeAction(enemyMixer, importedEnemy, clip, enemyCurrentAction, fade);
  next.timeScale = timeScale;
  next.setLoop(once ? THREE.LoopOnce : loopMode, once ? 1 : Infinity);
  // Finished one-shots hold their last frame until the next clip cross-fades
  // them out; they must never linger at full weight under later clips.
  next.clampWhenFinished = once;
  enemyCurrentAction = next;
  enemyCurrentAnimName = clip.name;
  return next;
}

function enemySlot(name, fallback={}) {
  return slotConfig(enemyAnimConfig, name, fallback);
}
function scheduleEnemyEvents(slotName, speed) {
  enemyActiveSlot = slotName;
  enemyEventQueue = queueSlotEvents(enemyAnimConfig, slotName, speed);
  return enemyEventQueue.length;
}
function dispatchEnemyEvent(event) {
  if (!event || event.type !== 'damage' || !enemyAlive || playerDead) return;
  const hitbox = hitboxById(enemyAnimConfig, event.hitboxId);
  const origin = boneWorldPoint(enemyBoneMap, hitbox, enemyRoot, 1.05);
  const heroCenter = hero.position.clone().add(new THREE.Vector3(0, 1.0, 0));
  const radius = Number(event.radius) || Number(hitbox?.radius) || 2.2;
  if (origin.distanceTo(heroCenter) > radius + .85) return;
  const dir = heroCenter.clone().sub(origin); dir.y = 0;
  if (dir.lengthSq() < .001) dir.set(0,0,1).applyQuaternion(enemyRoot.quaternion);
  dir.normalize();
  damagePlayer(Number(event.damage)||1, dir);
}
function updateEnemyEvents(dt) {
  if (!enemyEventQueue.length) return;
  for (const item of enemyEventQueue) item.remaining -= dt;
  const due = enemyEventQueue.filter(item => item.remaining <= 0);
  enemyEventQueue = enemyEventQueue.filter(item => item.remaining > 0);
  for (const item of due) dispatchEnemyEvent(item.event);
}

function enemyPlayOneShot(candidates, timeScale=1, onComplete=null, slotName='', speedScale=1) {
  const cfg = slotName ? enemySlot(slotName, { clip:candidates[0], speed:timeScale, fade:.06, loop:false }) : null;
  const clip = enemyFindClip([cfg?.clip, ...candidates].filter(Boolean), cfg?.removeRootMotion);
  if (!clip || !enemyMixer) return false;
  enemyActionLocked = true;
  const token = ++enemyActionToken;
  const resolvedSpeed = (cfg?.speed ?? timeScale) * speedScale;
  const action = enemyPlayClip(clip, cfg?.fade ?? .06, true, resolvedSpeed);
  if (!action) { enemyActionLocked = false; return false; }
  if (slotName) scheduleEnemyEvents(slotName, resolvedSpeed);
  const onFinished = e => {
    if (e.action !== action) return;
    enemyMixer.removeEventListener('finished', onFinished);
    if (token !== enemyActionToken) return;
    enemyActionLocked = false;
    // Keep enemyCurrentAction: the next clip must fade this held pose out.
    enemyCurrentAnimName = '';
    if (onComplete) onComplete();
  };
  enemyMixer.addEventListener('finished', onFinished);
  return true;
}

function enemyIdle() {
  if (enemyActionLocked || !enemyAlive) return;
  const cfg = enemySlot('idle', {clip:'Jason_Nav_Idle',speed:1,fade:.16});
  const clip = enemyFindClip([cfg.clip, 'Jason_Nav_Idle'], cfg.removeRootMotion);
  if (clip) enemyPlayClip(clip, cfg.fade, false, cfg.speed);
}

function enemyWalk(run=false) {
  if (enemyActionLocked || !enemyAlive) return;
  const name = run ? 'run' : 'walk';
  const cfg = enemySlot(name, {clip:'Jason_Walk',speed:run?1.28:1.02,fade:.14});
  const clip = enemyFindClip([cfg.clip, 'Jason_Walk', 'Jason_Nav_Idle'], cfg.removeRootMotion);
  if (clip) enemyPlayClip(clip, cfg.fade, false, cfg.speed);
}

gltfLoader.load(ENEMY_URL, async gltf => {
  enemyAnimConfig = await enemyConfigPromise;
  importedEnemy = gltf.scene;
  prepScene(importedEnemy, { shadows: true });

  const box = new THREE.Box3().setFromObject(importedEnemy);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetHeight = Number(enemyAnimConfig?.transform?.targetHeight) || 2.35;
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  importedEnemy.scale.setScalar(scale);
  importedEnemy.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  importedEnemy.rotation.y = 0;
  applyConfiguredOrientation(enemyOrientation, enemyAnimConfig);
  enemyOrientation.add(importedEnemy);
  enemyBoneMap.clear();
  importedEnemy.traverse(obj => { if (obj.isBone) enemyBoneMap.set(obj.name, obj); });
  enemyGroundRig = createFootGrounding(importedEnemy, enemyRoot);
  enemyFallback.visible = false;
  enemyFlashMaterials.length = 0;
  importedEnemy.traverse(obj => {
    if (!obj.isMesh) return;
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (mat?.emissive && !enemyFlashMaterials.some(item => item.mat === mat)) {
        enemyFlashMaterials.push({ mat, base: mat.emissive.clone() });
      }
    }
  });

  enemyMixer = new THREE.AnimationMixer(importedEnemy);
  enemyClipMap = new Map();
  gltf.animations.forEach(c => {
    enemyClipMap.set(c.name, c);
    const clean = sanitizeEnemyClip(c);
    enemyClipMap.set(clean.name, clean);
  });
  enemyReady = true;
  enemyAlive = true;
  enemyRoot.position.copy(ENEMY_SPAWN);
  enemyRoot.position.y = getSurfaceHeightAt(enemyRoot.position.x, enemyRoot.position.z) + GROUND_EPS;
  enemyIdle();
  updateCombatHUD();
  if (cityLoaded && heroReady) setAssetStatus(`Cidade CC0 online · Superman + Jason locais · ${gltf.animations.length} animações do boss`);
}, progress => {
  if (!cityLoaded || !progress.total) return;
  const pct = Math.round(progress.loaded / progress.total * 100);
  setAssetStatus(`Cidade CC0 online · carregando Jason local... ${pct}%`);
}, err => {
  console.warn('Falha ao carregar Jason local; usando fallback:', err);
  enemyReady = true;
  enemyAlive = true;
  if (cityLoaded) setAssetStatus('Cidade CC0 online · Jason fallback ativo');
});

function resolveEnemyBuildingCollision(previousPosition) {
  const center = new THREE.Vector3(enemyRoot.position.x, enemyRoot.position.y + 1.15, enemyRoot.position.z);
  const cell = colliderGrid.get(getGridKey(center.x, center.z));
  if (cell) {
    for (const box of cell) {
      if (center.y < box.min.y - .2 || center.y > box.max.y + .2) continue;
      if (center.x > box.min.x - .72 && center.x < box.max.x + .72 &&
          center.z > box.min.z - .72 && center.z < box.max.z + .72) {
        enemyRoot.position.x = previousPosition.x;
        enemyRoot.position.z = previousPosition.z;
        return true;
      }
    }
  }
  return false;
}

function pushEnemyFrom(source, amount) {
  if (!enemyAlive) return;
  const dir = enemyRoot.position.clone().sub(source); dir.y = 0;
  if (dir.lengthSq() < .001) dir.set(0, 0, 1).applyQuaternion(hero.quaternion);
  dir.normalize();
  const prev = enemyRoot.position.clone();
  enemyRoot.position.addScaledVector(dir, amount);
  resolveEnemyBuildingCollision(prev);
  enemyRoot.position.y = getSurfaceHeightAt(enemyRoot.position.x, enemyRoot.position.z) + GROUND_EPS;
}

function interruptEnemy() {
  enemyActionToken++;
  enemyAttackImpactTimer = -1;
  enemyActionLocked = false;
  enemyEventQueue = [];
  enemyAttackWarning.active = false;
  // The reaction clip played next cross-fades from the interrupted pose.
  enemyCurrentAnimName = '';
}

function damageEnemy(amount, source=null, knockback=0, label='') {
  if (!enemyReady || !enemyAlive || enemyHitInvuln > 0) return false;
  enemyHealth = Math.max(0, enemyHealth - amount);
  enemyHitInvuln = .10;
  enemyFlash = 1;
  const heavy = amount >= 40;
  {
    const hitPoint = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const away = source ? hitPoint.clone().sub(source).setY(0) : new THREE.Vector3(0, 0, 1);
    if (away.lengthSq() < .001) away.set(0, 0, 1);
    away.normalize();
    bursts.sparks(hitPoint, { count: heavy ? 38 : 16, power: heavy ? 1.3 : .8, dir: away, cone: 1 });
    if (heavy) bursts.dust({ x: hitPoint.x, y: enemyRoot.position.y + .1, z: hitPoint.z }, { count: 14, radius: 2, power: .8 });
  }
  requestHitStop(heavy ? .11 : .065);
  spawnDamageNumber(enemyRoot.position.clone().add(new THREE.Vector3(0, 2.5, 0)), amount, heavy ? 'heavy' : 'hit');
  updateCombatHUD();

  cameraShake = Math.max(cameraShake, Math.min(.58, .14 + amount / 110));

  if (enemyHealth <= 0) {
    if (source && knockback > 0) pushEnemyFrom(source, knockback);
    defeatEnemy();
    return true;
  }
  const enragedNow = checkEnemyEnrage();

  // Poise: light hits only interrupt once it breaks, and Jason keeps super
  // armor while winding up his own attack. No more infinite stunlock.
  const reaction = enemyPoise.registerHit(amount, { heavy, armored: enemyAttackWarning.active });
  if (reaction === 'stagger') {
    if (source && knockback > 0) pushEnemyFrom(source, knockback);
    interruptEnemy();
    enemyPlayOneShot(['Jason_HR_Deflect'], 1.15, null, 'hurt');
  } else if (source && knockback > 0) {
    pushEnemyFrom(source, knockback * .3);
  }
  if (label && !enragedNow) showMessage(`${label} · JASON -${amount}${reaction === 'stagger' ? '' : ' · RESISTIU'}`, 520);
  return true;
}

function checkEnemyEnrage() {
  if (enemyEnraged || !enemyAlive || enemyHealth > enemyMaxHealth * .5) return false;
  enemyEnraged = true;
  enemyMarker.material.color.set(0xff6a1a);
  showMessage('JASON ENFURECIDO · ataques mais rápidos', 1300);
  updateCombatHUD();
  return true;
}

function defeatEnemy() {
  if (!enemyAlive) return;
  enemyAlive = false;
  enemyHealth = 0;
  enemyAttackImpactTimer = -1;
  enemyRespawnTimer = ENEMY_RESPAWN_DELAY;
  interruptEnemy();
  updateCombatHUD();
  const deathCfg = enemySlot('death', {clip:'Jason_HR_Flyback_B_Enter', speed:.86, fade:.04, loop:false});
  const clip = enemyFindClip([deathCfg.clip, 'Jason_HR_Flyback_B_Enter'], deathCfg.removeRootMotion);
  if (clip && enemyMixer) {
    enemyPlayClip(clip, deathCfg.fade, true, deathCfg.speed);
    enemyActionLocked = true;
  }
  enemyMarker.material.opacity = .18;
  requestHitStop(.18);
  showMessage(`JASON DERROTADO! · nível ${enemyLevel + 1} em ${ENEMY_RESPAWN_DELAY}s`, 2200);
}

function applyEnemyLevel(level) {
  enemyLevel = Math.max(1, level);
  enemyStats = enemyLevelStats(enemyLevel);
  enemyMaxHealth = enemyStats.maxHealth;
}

// A road crossing 45–110 m away from Superman, preferring the closest fit.
function pickEnemySpawnPoint() {
  let best = null;
  for (const x of roadLaneCenters) {
    for (const z of roadLaneCenters) {
      const d = Math.hypot(x - hero.position.x, z - hero.position.z);
      const score = d < 45 ? 1000 - d : d > 110 ? d : Math.abs(d - 70);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  return best ? new THREE.Vector3(best.x, 0, best.z) : ENEMY_SPAWN.clone();
}

function resetEnemy(spawnPoint = ENEMY_SPAWN) {
  enemyRespawnTimer = -1;
  enemyEnraged = false;
  enemyFlash = 0;
  enemyDeathFall = 0;
  enemyVisual.rotation.set(0, 0, 0);
  enemyPoise.reset();
  enemyHealth = enemyMaxHealth;
  enemyAlive = true;
  enemyHitInvuln = 0;
  enemyAttackCooldown = .75;
  enemyAttackImpactTimer = -1;
  enemyActionToken++;
  enemyActionLocked = false;
  enemyEventQueue = [];
  enemyAttackWarning.active = false;
  enemyRoot.position.copy(spawnPoint);
  enemyRoot.position.y = getSurfaceHeightAt(enemyRoot.position.x, enemyRoot.position.z) + GROUND_EPS;
  enemyRoot.rotation.set(0,0,0);
  enemyMarker.material.opacity = .78;
  enemyMarker.material.color.set(0xff263e);
  if (enemyMixer) enemyMixer.stopAllAction();
  enemyCurrentAction = null;
  enemyCurrentAnimName = '';
  enemyIdle();
  updateCombatHUD();
}

function respawnEnemyNextLevel() {
  applyEnemyLevel(enemyLevel + 1);
  resetEnemy(pickEnemySpawnPoint());
  showMessage(`JASON RETORNOU · NÍVEL ${enemyLevel}`, 1600);
}

function damagePlayer(amount, fromDirection) {
  if (playerDead) return;
  if (playerInvuln > 0) {
    if (dodge.active) showMessage('ESQUIVA PERFEITA!', 520);
    return;
  }
  amount = Math.round(amount * enemyStats.damageScale);
  playerHealth = Math.max(0, playerHealth - amount);
  playerInvuln = .62;
  playerHurtCooldown = 0;
  heroHurtKick = 1;
  flashBody('hero-hurt-flash', 220);
  updateCombatHUD();
  cameraShake = Math.max(cameraShake, .62);
  if (fromDirection) {
    const push = fromDirection.clone(); push.y = 0;
    if (push.lengthSq() > .001) {
      push.normalize();
      velocity.addScaledVector(push, 11);
      velocity.y = Math.max(velocity.y, 3.5);
    }
  }
  showMessage(`JASON ACERTOU! · -${amount} HP`, 620);
  if (playerHealth <= 0) {
    forceStopIceBreath();
    playerDead = true;
    actionLocked = true;
    velocity.set(0,0,0);
    showMessage('SUPERMAN DERROTADO · reiniciando...', 1800);
    const serial = ++enemyRespawnSerial;
    setTimeout(() => {
      if (playerDead && serial === enemyRespawnSerial) resetGame();
    }, 1700);
  }
}

function beginEnemyAttack(kind='combo') {
  if (!enemyAlive || enemyActionLocked || enemyAttackCooldown > 0 || playerDead) return;
  let candidates, timeScale, impact, damage, range, cooldown, slotName;
  if (kind === 'dash') {
    slotName = 'specialAttack';
    candidates = ['Jason_Attack_Dash_Shoulder_Bash'];
    timeScale = 1.08; impact = .46; damage = 20; range = 4.4; cooldown = 2.0;
  } else {
    const roll = Math.floor(Math.random() * 3);
    slotName = ['attack1','attack2','attack3'][roll];
    candidates = [[ 'Jason_Attack_Combo_01' ], [ 'Jason_Attack_Combo_02' ], [ 'Jason_Attack_Combo_03' ]][roll];
    timeScale = roll === 0 ? 1.22 : 1.10;
    impact = roll === 0 ? .46 : roll === 1 ? .34 : .30;
    damage = roll === 2 ? 18 : 14;
    range = 3.45;
    cooldown = 1.25 + roll * .18;
  }
  // Rage and higher rounds speed Jason up; his telegraph shortens with it.
  const pace = enemyStats.speedScale * (enemyEnraged ? 1.12 : 1);
  // No completion callback: once unlocked, updateEnemy() picks walk/idle/attack
  // and cross-fades straight from the held final frame.
  const started = enemyPlayOneShot(candidates, timeScale, null, slotName, pace);
  if (!started) return;
  enemyAttackKind = kind;
  const hasConfiguredEvents = (enemyAnimConfig?.slots?.[slotName]?.events || []).length > 0;
  enemyAttackImpactTimer = hasConfiguredEvents ? -1 : impact / pace;
  enemyAttackDamage = damage;
  enemyAttackRange = range;
  enemyAttackCooldown = cooldown * (enemyEnraged ? .7 : 1) / enemyStats.speedScale;
  const hitDelay = hasConfiguredEvents
    ? Math.min(...enemyEventQueue.filter(item => item.event.type === 'damage').map(item => item.remaining), 1.2)
    : enemyAttackImpactTimer;
  startEnemyAttackWarning(kind, hitDelay);
}

function triggerEnemyAttackImpact() {
  if (!enemyAlive || playerDead) return;
  const dir = new THREE.Vector3(0,0,1).applyQuaternion(enemyRoot.quaternion).normalize();
  const origin = enemyRoot.position.clone().add(new THREE.Vector3(0,1.0,0)).addScaledVector(dir, 1.05);
  const target = hero.position.clone().add(new THREE.Vector3(0,1.0,0));
  const delta = target.sub(origin);
  const dist = delta.length();
  if (dist > enemyAttackRange || Math.abs(hero.position.y - enemyRoot.position.y) > 3.2) return;
  const n = delta.normalize();
  if (n.dot(dir) < .08) return;
  damagePlayer(enemyAttackDamage, dir);
}

function updateEnemy(dt, time) {
  if (spaceState.active || reentryState.active) {
    if (typeof enemyRoot !== 'undefined') enemyRoot.visible = false;
    if (typeof enemyMarker !== 'undefined') enemyMarker.visible = false;
    return;
  }
  if (!enemyReady) return;
  enemyMarker.visible = enemyAlive;
  enemyMarker.rotation.z += dt * (enemyEnraged ? 2.2 : .75);
  updateEnemyFlash(dt);
  updateEnemyAttackWarning(dt);
  if (!enemyAlive) {
    // The flyback clip ends mid-air; tip the body back so he lies on the street.
    enemyDeathFall = Math.min(1, enemyDeathFall + dt / .6);
    const fall = enemyDeathFall * enemyDeathFall * (3 - 2 * enemyDeathFall);
    enemyVisual.rotation.x = -1.3 * fall;
    if (enemyRespawnTimer > 0) {
      const before = Math.ceil(enemyRespawnTimer);
      enemyRespawnTimer -= dt;
      if (enemyRespawnTimer <= 0) respawnEnemyNextLevel();
      else if (Math.ceil(enemyRespawnTimer) !== before) updateCombatHUD();
    }
    return;
  }

  enemyHitInvuln = Math.max(0, enemyHitInvuln - dt);
  enemyAttackCooldown = Math.max(0, enemyAttackCooldown - dt);
  enemyPoise.update(dt);
  if (enemyAttackImpactTimer >= 0) {
    enemyAttackImpactTimer -= dt;
    if (enemyAttackImpactTimer <= 0) {
      enemyAttackImpactTimer = -1;
      triggerEnemyAttackImpact();
    }
  }
  if (playerDead) { enemyIdle(); return; }

  const toHero = hero.position.clone().sub(enemyRoot.position);
  const verticalDelta = toHero.y;
  const horizontal = new THREE.Vector3(toHero.x, 0, toHero.z);
  const distance = horizontal.length();
  if (distance > .001) {
    const targetYaw = Math.atan2(horizontal.x, horizontal.z);
    // Once an attack is committed Jason barely re-aims, so sidestepping or a
    // dodge through the telegraph actually avoids the hit.
    const turnRate = enemyActionLocked ? 1.4 : 6.5;
    enemyRoot.rotation.y = lerpAngle(enemyRoot.rotation.y, targetYaw, 1 - Math.exp(-turnRate * dt));
  }

  // Jason is a ground boss. He follows Superman across streets but waits below
  // when the player climbs well above melee height.
  const canReachVertically = Math.abs(verticalDelta) < 3.5;
  if (!enemyActionLocked && canReachVertically && distance < 3.35 && enemyAttackCooldown <= 0) {
    beginEnemyAttack('combo');
  } else if (!enemyActionLocked && canReachVertically && distance >= 3.35 && distance < 6.2 && enemyAttackCooldown <= 0) {
    beginEnemyAttack('dash');
  } else if (!enemyActionLocked && distance < 110) {
    const dir = horizontal.lengthSq() > .001 ? horizontal.normalize() : new THREE.Vector3();
    const speed = (distance > 28 ? 5.5 : 4.25) * enemyStats.speedScale * (enemyEnraged ? 1.2 : 1);
    const prev = enemyRoot.position.clone();
    enemyRoot.position.addScaledVector(dir, speed * dt);
    resolveEnemyBuildingCollision(prev);
    enemyRoot.position.x = THREE.MathUtils.clamp(enemyRoot.position.x, -WORLD_LIMIT, WORLD_LIMIT);
    enemyRoot.position.z = THREE.MathUtils.clamp(enemyRoot.position.z, -WORLD_LIMIT, WORLD_LIMIT);
    enemyRoot.position.y = getSurfaceHeightAt(enemyRoot.position.x, enemyRoot.position.z) + GROUND_EPS;
    enemyWalk(distance > 28);
  } else if (!enemyActionLocked) {
    enemyIdle();
  }
}

function enemyUnderAim(maxDistance=280, radius=1.20) {
  if (spaceState.active || reentryState.active) return false;
  if (!enemyReady || !enemyAlive) return false;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const center = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.25, 0));
  const toCenter = center.sub(camera.position);
  const t = toCenter.dot(dir);
  if (t < 0 || t > maxDistance) return false;
  const closest = camera.position.clone().addScaledVector(dir, t);
  return closest.distanceTo(center) <= radius;
}

function triggerNormalPunchImpact() {
  if (!enemyAlive) return;
  const dir = new THREE.Vector3(0,0,1).applyQuaternion(hero.quaternion).normalize();
  const origin = hero.position.clone().add(new THREE.Vector3(0,1.05,0)).addScaledVector(dir, .95);
  const enemyCenter = enemyRoot.position.clone().add(new THREE.Vector3(0,1.2,0));
  const delta = enemyCenter.sub(origin);
  const dist = delta.length();
  if (dist > 3.25 || Math.abs(hero.position.y - enemyRoot.position.y) > 2.8) return;
  if (delta.normalize().dot(dir) < .05) return;
  damageEnemy(22, origin, 1.25, 'SOCO');
}

// ---------------------------------------------------------------------------
// V17 COMBAT FEEL: telegraphs, hit flash, hitstop, damage numbers, dodge,
// regeneration and attack buffering
// ---------------------------------------------------------------------------
// Ground telegraph shown while Jason winds up a hit. While it is active he
// also has super armor against light hits (see damageEnemy).
const enemyAttackWarning = (() => {
  const material = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const outline = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 48), material);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), material.clone());
  const group = new THREE.Group();
  outline.rotation.x = fill.rotation.x = -Math.PI / 2;
  group.add(outline, fill);
  group.visible = false;
  scene.add(group);
  return { active: false, elapsed: 0, duration: .4, reach: 1.5, radius: 1.9, group, outline, fill };
})();

function startEnemyAttackWarning(kind, hitDelay) {
  const warning = enemyAttackWarning;
  warning.active = true;
  warning.elapsed = 0;
  warning.duration = THREE.MathUtils.clamp(Number(hitDelay) || .4, .12, 1.4);
  warning.reach = kind === 'dash' ? 2.8 : 1.45;
  warning.radius = kind === 'dash' ? 2.4 : 1.85;
  updateEnemyAttackWarning(0);
}

function updateEnemyAttackWarning(dt) {
  const warning = enemyAttackWarning;
  if (warning.active) {
    warning.elapsed += dt;
    if (warning.elapsed >= warning.duration || !enemyAlive || playerDead) warning.active = false;
  }
  warning.group.visible = warning.active && enemyRoot.visible;
  if (!warning.group.visible) return;
  const progress = THREE.MathUtils.clamp(warning.elapsed / warning.duration, 0, 1);
  const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(enemyRoot.quaternion);
  forwardDir.y = 0;
  forwardDir.normalize();
  const x = enemyRoot.position.x + forwardDir.x * warning.reach;
  const z = enemyRoot.position.z + forwardDir.z * warning.reach;
  warning.group.position.set(x, getSurfaceHeightAt(x, z) + .07, z);
  warning.outline.scale.setScalar(warning.radius);
  warning.fill.scale.setScalar(Math.max(.01, warning.radius * progress));
  warning.outline.material.opacity = .55 + Math.sin(warning.elapsed * 30) * .2;
  warning.fill.material.opacity = .18 + progress * .32;
}

function updateEnemyFlash(dt) {
  enemyFlash = Math.max(0, enemyFlash - dt * 7);
  const rage = enemyEnraged && enemyAlive ? .5 + Math.sin(timer.getElapsed() * 6) * .15 : 0;
  for (const { mat, base } of enemyFlashMaterials) {
    mat.emissive.copy(base).lerp(ENEMY_ENRAGE_COLOR, rage).lerp(ENEMY_FLASH_COLOR, enemyFlash * .7);
  }
}

// Hitstop briefly slows the character animation mixers so impacts read.
let hitStopTimer = 0;
function requestHitStop(seconds) {
  hitStopTimer = Math.max(hitStopTimer, seconds);
}

const damageLayer = document.querySelector('#damage-layer');
function spawnDamageNumber(position, amount, kind = 'hit') {
  if (!damageLayer) return;
  const p = position.clone().project(camera);
  if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return;
  const el = document.createElement('div');
  el.className = `damage-number ${kind}`;
  el.textContent = `-${Math.round(amount)}`;
  el.style.left = `${(p.x * .5 + .5) * innerWidth + (Math.random() - .5) * 28}px`;
  el.style.top = `${(-p.y * .5 + .5) * innerHeight}px`;
  el.addEventListener('animationend', () => el.remove(), { once: true });
  damageLayer.appendChild(el);
}

function flashBody(className, ms) {
  document.body.classList.remove(className);
  void document.body.offsetWidth; // restart the CSS animation
  document.body.classList.add(className);
  setTimeout(() => document.body.classList.remove(className), ms);
}

// Superman regenerates (solar energy) after a few seconds without damage.
const PLAYER_REGEN_DELAY = 4.5;
const PLAYER_REGEN_RATE = 7;
let playerHurtCooldown = 0;
function updatePlayerRegen(dt) {
  playerHurtCooldown += dt;
  const regenerating = !playerDead && playerHealth < playerMaxHealth && playerHurtCooldown >= PLAYER_REGEN_DELAY;
  document.querySelector('#player-health')?.classList.toggle('regen', regenerating);
  if (!regenerating) return;
  const before = Math.ceil(playerHealth);
  playerHealth = Math.min(playerMaxHealth, playerHealth + PLAYER_REGEN_RATE * dt);
  if (Math.ceil(playerHealth) !== before) updateCombatHUD();
}

// Space: short dash with invulnerability frames. On the ground it is a quick
// step (default: hop back); in the air it is a burst with a barrel roll.
const DODGE_DURATION = .26;
const DODGE_COOLDOWN = .7;
const DODGE_GROUND_SPEED = 21;
const DODGE_AIR_IMPULSE = 38;
const dodge = { active: false, elapsed: 0, cooldown: 0, airborne: false, backward: false, side: 0, direction: new THREE.Vector3() };

function startDodge() {
  if (dodge.active || dodge.cooldown > 0 || playerDead || !heroReady || leapAttack.active || flightMachine.busy ||
      spaceState.active || reentryState.active) return;
  if (actionLocked) {
    // Punch recovery can be dodge-cancelled once its hit has resolved.
    const recovering = (heroActiveSlot === 'punch' || heroActiveSlot === 'superPunch') &&
      !heroEventQueue.length && normalPunchImpactTimer < 0 && superPunchImpactTimer < 0;
    if (heroActiveSlot !== 'flyStop' && !recovering) return;
    cancelCurrentOneShot();
  }
  if (heatVisionActive) stopHeatVision(false);
  if (iceBreathController.active) forceStopIceBreath();

  const aim = getAimDirection(new THREE.Vector3());
  const flat = new THREE.Vector3(aim.x, 0, aim.z);
  if (flat.lengthSq() < .001) flat.set(0, 0, 1).applyQuaternion(hero.quaternion).setY(0);
  flat.normalize();
  const side = new THREE.Vector3().crossVectors(flat, up).normalize();
  const airborne = flightMachine.state !== 'grounded';
  const dir = new THREE.Vector3();
  if (keys.KeyW) dir.add(airborne ? aim : flat);
  if (keys.KeyS) dir.sub(airborne ? aim : flat);
  if (keys.KeyD) dir.add(side);
  if (keys.KeyA) dir.sub(side);
  if (dir.lengthSq() < .001) dir.copy(flat).negate();
  dir.normalize();

  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(hero.quaternion);
  const leftAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(hero.quaternion);
  dodge.active = true;
  dodge.elapsed = 0;
  dodge.cooldown = DODGE_COOLDOWN;
  dodge.airborne = airborne;
  dodge.direction.copy(dir);
  dodge.backward = dir.dot(facing) < -.5;
  dodge.side = Math.abs(dir.dot(leftAxis)) > .35 ? Math.sign(dir.dot(leftAxis)) : 0;
  playerInvuln = Math.max(playerInvuln, DODGE_DURATION + .12);

  if (airborne) {
    velocity.addScaledVector(dir, DODGE_AIR_IMPULSE);
  } else {
    velocity.set(dir.x * DODGE_GROUND_SPEED, 0, dir.z * DODGE_GROUND_SPEED);
    const fx = getImpactEffect('leap');
    fx.object.rotation.set(-Math.PI / 2, 0, 0);
    fx.object.position.set(hero.position.x, hero.position.y + .05, hero.position.z);
    impactEffects.push({ object:fx.object, life:.24, maxLife:.24, poolItem:fx, scale:.3 });
  }
  flashBody('dodge-flash', 160);
}

function updateDodge(dt) {
  dodge.cooldown = Math.max(0, dodge.cooldown - dt);
  if (!dodge.active) return;
  dodge.elapsed += dt;
  if (dodge.elapsed >= DODGE_DURATION || playerDead) dodge.active = false;
}

// Procedural layer on heroVisual: hit flinch, dodge lean/barrel roll and the
// fall on defeat. The GLB has no hurt/death clips for Superman.
let heroHurtKick = 0;
let heroDeathFall = 0;
function updateHeroReactions(dt) {
  heroHurtKick = Math.max(0, heroHurtKick - dt * 4.5);
  heroDeathFall = playerDead ? Math.min(1, heroDeathFall + dt / .55) : 0;
  let pitchX = -heroHurtKick * heroHurtKick * .3;
  let roll = 0;
  if (dodge.active) {
    const p = Math.min(1, dodge.elapsed / DODGE_DURATION);
    const lean = Math.sin(p * Math.PI);
    if (dodge.airborne && dodge.side) {
      roll = -dodge.side * p * p * (3 - 2 * p) * Math.PI * 2;
    } else if (!dodge.airborne) {
      pitchX += dodge.backward ? -.32 * lean : .18 * lean;
      roll += dodge.side * .28 * lean;
    }
  }
  const fall = heroDeathFall * heroDeathFall * (3 - 2 * heroDeathFall);
  heroVisual.rotation.set(pitchX - fall * 1.32, 0, roll);
}

// E/X pressed during a punch is remembered briefly and fires on recovery.
let bufferedAttack = '';
let bufferedAttackTimer = 0;
function bufferAttack(kind) {
  bufferedAttack = kind;
  bufferedAttackTimer = .6;
}
function updateBufferedAttack(dt) {
  if (!bufferedAttack) return;
  bufferedAttackTimer -= dt;
  if (bufferedAttackTimer <= 0 || playerDead) { bufferedAttack = ''; return; }
  if (actionLocked) return;
  const kind = bufferedAttack;
  bufferedAttack = '';
  if (kind === 'super') superPunch();
  else punch();
}

// ---------------------------------------------------------------------------
// OBJECTIVE / SKY
// ---------------------------------------------------------------------------
const rings = [];
const ringPositions = [
  [0,70,35], [55,95,-45], [115,130,-120], [35,185,-230], [-90,135,-300],
  [-165,100,-210], [-150,65,-80], [-80,115,30], [15,150,110], [125,90,85],
  [220,120,15], [210,180,-125],
  [380,120,300], [-420,150,260], [520,95,-120], [-560,175,-340],
  [300,170,-520], [-300,125,480], [600,140,430], [20,230,-620]
];
const ringMat = new THREE.MeshStandardMaterial({ color: 0x3be8ff, emissive: 0x0b9fc0, emissiveIntensity: 4, roughness: .25, metalness: .15 });
// Rings that would fall outside a smaller (mobile) city are skipped.
for (const p of ringPositions.filter(r => Math.abs(r[0]) < CITY_HALF - 12 && Math.abs(r[2]) < CITY_HALF - 12)) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6, .75, 10, 28), ringMat.clone());
  ring.position.set(...p);
  ring.rotation.y = rng()*Math.PI;
  ring.rotation.x = (rng()-.5)*.7;
  ring.userData.collected = false;
  scene.add(ring); rings.push(ring);
}
document.querySelector('#total').textContent = rings.length;

// V18 atmosphere: a shader sky dome, soft sprite clouds, bird flocks and the
// pooled particle system used by impacts and contrails.
const skyDome = new SkyDome({
  sunDirection: SUN_OFFSET,
  horizon: DAY_FOG_COLOR,
  mid: new THREE.Color(0x6fb4ec),
  zenith: new THREE.Color(0x2d78d2),
  space: SPACE_BACKGROUND
});
scene.add(skyDome.mesh);
const cloudLayer = new CloudLayer(scene, rng, { extent: CITY_HALF + 520, count: PROFILE.clouds });
const cloudMat = cloudLayer.material;
const clouds = cloudLayer.clouds;
const birds = new BirdFlocks(scene, rng, { extent: CITY_HALF * .85, flocks: PROFILE.flocks });
const bursts = new ParticleBursts(scene);

// ---------------------------------------------------------------------------
// ORBIT / SPACE TRANSITION V14
// ---------------------------------------------------------------------------
const SPACE_TRANSITION_START = 3600;
const SPACE_ENTRY_ALTITUDE = 4800;
const SPACE_REENTRY_ALTITUDE = 3400;
const SPACE_REENTRY_CLEARANCE = 18;
const ORBITAL_EARTH_RADIUS = 170;
const ORBITAL_CLEARANCE = 92;
const ORBITAL_MAX_DISTANCE = 1400;
const ORBITAL_SUN_DISTANCE = 24000;
const ORBITAL_MOON_DISTANCE = 9800;
const bossHudEl = document.querySelector('#boss-hud');

const spaceState = {
  active: false,
  blend: 0,
  savedCity: new THREE.Vector3(0, SPACE_REENTRY_ALTITUDE, 130),
  earthCenter: new THREE.Vector3(0, -(ORBITAL_EARTH_RADIUS + ORBITAL_CLEARANCE), 0),
  moonAngle: 0
};

const reentryState = {
  active: false,
  elapsed: 0,
  duration: 6.4,
  cityPhase: false,
  startSpacePos: new THREE.Vector3(),
  targetSpacePos: new THREE.Vector3(),
  cityStartY: 6800,
  cityEndY: 620,
  lateralStart: new THREE.Vector2(),
  audio: null,
  intensity: 0
};

const spaceGroup = new THREE.Group();
spaceGroup.visible = false;
scene.add(spaceGroup);

function createCanvasTexture(size, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createEarthTexture(size = 1024) {
  return createCanvasTexture(size, (ctx, s) => {
    const grd = ctx.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, '#57a8ff');
    grd.addColorStop(1, '#0b4f9c');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, s, s);

    const land = ['#77bf5c', '#579944', '#8aca6a'];
    const blobs = [
      [0.18, 0.28, 0.17, 0.09, -0.2], [0.29, 0.53, 0.15, 0.10, 0.35],
      [0.58, 0.32, 0.22, 0.11, -0.15], [0.74, 0.55, 0.16, 0.12, 0.18],
      [0.47, 0.70, 0.24, 0.09, -0.08], [0.86, 0.30, 0.10, 0.07, 0.45]
    ];
    for (const [x, y, rx, ry, rot] of blobs) {
      ctx.save();
      ctx.translate(x * s, y * s);
      ctx.rotate(rot);
      ctx.fillStyle = land[Math.floor(Math.random() * land.length)];
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * s, ry * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = '#ffffff';
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 6 + Math.random() * 26;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillRect(0, 0, s, s * 0.09);
    ctx.fillRect(0, s * 0.91, s, s * 0.09);
  });
}

function createMoonTexture(size = 512) {
  return createCanvasTexture(size, (ctx, s) => {
    ctx.fillStyle = '#a9adb4';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 180; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 4 + Math.random() * 24;
      ctx.fillStyle = `rgba(120,125,132,${0.12 + Math.random() * 0.18})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.82, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

const earthTexture = createEarthTexture();
const moonTexture = createMoonTexture();

const starCount = 1800;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 7000 + Math.random() * 9000;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
  starPositions[i * 3 + 1] = Math.cos(phi) * r;
  starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 10, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat);
spaceGroup.add(stars);

const earthPivot = new THREE.Group();
spaceGroup.add(earthPivot);
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(ORBITAL_EARTH_RADIUS, 64, 48),
  new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 1.0, metalness: 0.0, emissive: 0x0b2a5a, emissiveIntensity: 0.18 })
);
earth.position.copy(spaceState.earthCenter);
earthPivot.add(earth);
const earthAtmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(ORBITAL_EARTH_RADIUS * 1.035, 48, 32),
  new THREE.MeshBasicMaterial({ color: 0x6ec8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false })
);
earthAtmosphere.position.copy(spaceState.earthCenter);
earthPivot.add(earthAtmosphere);

const moonPivot = new THREE.Group();
spaceGroup.add(moonPivot);
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(ORBITAL_EARTH_RADIUS * 0.273, 40, 30),
  new THREE.MeshStandardMaterial({ map: moonTexture, roughness: 1.0, metalness: 0.0 })
);
moon.position.set(ORBITAL_MOON_DISTANCE, 900, -2600);
moonPivot.add(moon);

const sunVisual = new THREE.Mesh(
  new THREE.SphereGeometry(360, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xffeab0, transparent: true, opacity: 0.98 })
);
sunVisual.position.set(-ORBITAL_SUN_DISTANCE, 6500, -12000);
spaceGroup.add(sunVisual);
const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(520, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffd26a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
);
sunGlow.position.copy(sunVisual.position);
spaceGroup.add(sunGlow);

// V15 atmospheric reentry effects. These stay lightweight: all geometry is
// procedural and the sound is synthesized with WebAudio, so no new asset pack
// is required for the cinematic transition.
const reentryFx = new THREE.Group();
reentryFx.visible = false;
scene.add(reentryFx);

const plasmaShell = new THREE.Mesh(
  new THREE.SphereGeometry(1.45, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xff6a24, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })
);
reentryFx.add(plasmaShell);

const plasmaCore = new THREE.Mesh(
  new THREE.SphereGeometry(1.05, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffd7a3, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })
);
reentryFx.add(plasmaCore);

const reentryRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.75, .075, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xffb05b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
);
reentryFx.add(reentryRing);

const reentryStreakCount = 56;
const reentryStreakPositions = new Float32Array(reentryStreakCount * 2 * 3);
const reentryStreakSeeds = Array.from({ length: reentryStreakCount }, () => ({
  a: Math.random() * Math.PI * 2,
  r: 1.8 + Math.random() * 7.5,
  z: Math.random() * 34 - 17,
  phase: Math.random() * 20
}));
const reentryStreakGeo = new THREE.BufferGeometry();
reentryStreakGeo.setAttribute('position', new THREE.BufferAttribute(reentryStreakPositions, 3));
const reentryStreakMat = new THREE.LineBasicMaterial({ color: 0xffb26b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const reentryStreaks = new THREE.LineSegments(reentryStreakGeo, reentryStreakMat);
reentryStreaks.frustumCulled = false;
scene.add(reentryStreaks);

const reentryOverlay = document.createElement('div');
reentryOverlay.id = 'reentry-overlay';
reentryOverlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:8;opacity:0;background:radial-gradient(circle at 50% 45%,rgba(255,220,170,0) 18%,rgba(255,120,40,.18) 54%,rgba(180,25,0,.58) 100%);mix-blend-mode:screen;transition:opacity .08s linear;';
document.body.appendChild(reentryOverlay);

function startReentryAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    window.__skyAudioCtx ||= new AudioCtx();
    const ctx = window.__skyAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 42;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 160;
    rumble.connect(rumbleFilter).connect(master);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = .45;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = .55;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);

    rumble.start();
    noise.start();
    return { ctx, master, rumble, noise, noiseFilter, noiseGain };
  } catch (err) {
    return null;
  }
}

function stopReentryAudio() {
  const a = reentryState.audio;
  if (!a) return;
  try {
    const now = a.ctx.currentTime;
    a.master.gain.cancelScheduledValues(now);
    a.master.gain.setTargetAtTime(0.0001, now, .12);
    setTimeout(() => {
      try { a.rumble.stop(); } catch (_) {}
      try { a.noise.stop(); } catch (_) {}
      try { a.master.disconnect(); } catch (_) {}
    }, 500);
  } catch (_) {}
  reentryState.audio = null;
}

function updateReentryAudio(intensity) {
  const a = reentryState.audio;
  if (!a) return;
  try {
    const now = a.ctx.currentTime;
    a.master.gain.setTargetAtTime(.02 + intensity * .25, now, .06);
    a.rumble.frequency.setTargetAtTime(38 + intensity * 42, now, .08);
    a.noiseFilter.frequency.setTargetAtTime(650 + intensity * 1900, now, .06);
    a.noiseGain.gain.setTargetAtTime(.25 + intensity * .75, now, .08);
  } catch (_) {}
}

function updateReentryFx(dt, time, intensity) {
  reentryState.intensity = intensity;
  reentryFx.visible = reentryState.active;
  reentryStreaks.visible = reentryState.active;
  if (!reentryState.active) {
    plasmaShell.material.opacity = 0;
    plasmaCore.material.opacity = 0;
    reentryRing.material.opacity = 0;
    reentryStreakMat.opacity = 0;
    reentryOverlay.style.opacity = '0';
    return;
  }

  const dir = velocity.lengthSq() > .01 ? velocity.clone().normalize() : getAimDirection(new THREE.Vector3());
  reentryFx.position.copy(hero.position);
  plasmaShell.scale.setScalar(1 + intensity * .9 + Math.sin(time * 33) * .025);
  plasmaCore.scale.setScalar(.92 + intensity * .45);
  plasmaShell.material.opacity = .08 + intensity * .50;
  plasmaCore.material.opacity = intensity * .24;
  reentryRing.material.opacity = intensity * .55;
  reentryRing.scale.setScalar(1 + intensity * .65 + Math.sin(time * 20) * .04);
  reentryRing.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), dir);
  reentryOverlay.style.opacity = String(THREE.MathUtils.clamp(intensity * .78, 0, .72));

  const side = new THREE.Vector3().crossVectors(dir, up);
  if (side.lengthSq() < .001) side.set(1,0,0); else side.normalize();
  const vertical = new THREE.Vector3().crossVectors(side, dir).normalize();
  const length = 3 + intensity * 13;
  for (let i = 0; i < reentryStreakCount; i++) {
    const seed = reentryStreakSeeds[i];
    const flow = ((time * (30 + intensity * 95) + seed.phase) % 36) - 18;
    const center = hero.position.clone()
      .addScaledVector(dir, flow)
      .addScaledVector(side, Math.cos(seed.a) * seed.r)
      .addScaledVector(vertical, Math.sin(seed.a) * seed.r);
    const a = center.clone().addScaledVector(dir, length * .45);
    const b = center.clone().addScaledVector(dir, -length * .55);
    const o = i * 6;
    reentryStreakPositions[o] = a.x; reentryStreakPositions[o+1] = a.y; reentryStreakPositions[o+2] = a.z;
    reentryStreakPositions[o+3] = b.x; reentryStreakPositions[o+4] = b.y; reentryStreakPositions[o+5] = b.z;
  }
  reentryStreakGeo.attributes.position.needsUpdate = true;
  reentryStreakMat.opacity = .12 + intensity * .75;
  updateReentryAudio(intensity);
}

function setCityVisibility(visible) {
  world.visible = visible;
  for (const cloud of clouds) cloud.visible = visible && cloudMat.opacity > 0.02;
  for (const ring of rings) ring.visible = visible && !ring.userData.collected;
  if (typeof enemyRoot !== 'undefined') enemyRoot.visible = visible;
  if (typeof enemyMarker !== 'undefined') enemyMarker.visible = visible && enemyAlive;
  if (bossHudEl) bossHudEl.style.display = visible ? '' : 'none';
}

function enterSpaceMode() {
  if (spaceState.active) return;
  forceStopIceBreath();
  stopHeatVision(false);
  spaceState.active = true;
  spaceState.savedCity.set(hero.position.x, Math.max(hero.position.y, SPACE_REENTRY_ALTITUDE), hero.position.z);
  hero.position.set(0, 0, 0);
  velocity.copy(getAimDirection(new THREE.Vector3())).multiplyScalar(Math.max(55, Math.min(velocity.length() + 35, 150)));
  flightMachine.state = 'flying';
  setCityVisibility(false);
  showMessage('ÓRBITA BAIXA · Terra, Sol e Lua à vista', 1400);
}

function exitSpaceMode() {
  if (!spaceState.active || reentryState.active) return;
  forceStopIceBreath();
  reentryState.active = true;
  reentryState.elapsed = 0;
  reentryState.cityPhase = false;
  reentryState.startSpacePos.copy(hero.position);
  const radial = hero.position.clone().sub(spaceState.earthCenter).normalize();
  reentryState.targetSpacePos.copy(spaceState.earthCenter).addScaledVector(radial, ORBITAL_EARTH_RADIUS + 1.8);
  reentryState.lateralStart.set(spaceState.savedCity.x, spaceState.savedCity.z);
  reentryState.audio = startReentryAudio();
  stopHeatVision(false);
  boostCharge = 0;
  flightMachine.state = 'flying';
  showMessage('REENTRADA ATMOSFÉRICA', 1300);
}

function switchReentryToCity() {
  if (reentryState.cityPhase) return;
  reentryState.cityPhase = true;
  spaceState.active = false;
  hero.position.set(reentryState.lateralStart.x, reentryState.cityStartY, reentryState.lateralStart.y);
  velocity.set(0, -680, 0);
  setCityVisibility(true);
  if (typeof enemyRoot !== 'undefined') enemyRoot.visible = false;
  if (typeof enemyMarker !== 'undefined') enemyMarker.visible = false;
  if (bossHudEl) bossHudEl.style.display = 'none';
  showMessage('PLASMA MÁXIMO · DESCIDA SOBRE A CIDADE', 1200);
}

function finishReentry() {
  reentryState.active = false;
  reentryState.elapsed = 0;
  reentryState.cityPhase = false;
  reentryState.intensity = 0;
  spaceState.active = false;
  spaceState.blend = 0;
  scene.fog = worldFog;
  scene.background = DAY_BACKGROUND.clone();
  setCityVisibility(true);
  if (bossHudEl) bossHudEl.style.display = '';
  hero.position.y = reentryState.cityEndY;
  const dir = getAimDirection(new THREE.Vector3());
  dir.y = THREE.MathUtils.clamp(dir.y, -.18, .28);
  dir.normalize();
  velocity.copy(dir).multiplyScalar(105);
  flightMachine.state = 'flying';
  stopReentryAudio();
  updateReentryFx(0, timer.getElapsed(), 0);
  showMessage('ATMOSFERA RECUPERADA · CONTROLE RESTAURADO', 1100);
}

function updateReentryMotion(dt, time) {
  reentryState.elapsed += dt;
  const p = THREE.MathUtils.clamp(reentryState.elapsed / reentryState.duration, 0, 1);
  const plasmaIn = THREE.MathUtils.smoothstep(p, .05, .42);
  const plasmaOut = 1 - THREE.MathUtils.smoothstep(p, .68, .98);
  const intensity = THREE.MathUtils.clamp(plasmaIn * plasmaOut * 1.16, 0, 1);

  if (!reentryState.cityPhase) {
    const t = THREE.MathUtils.smoothstep(p, 0, .48);
    hero.position.lerpVectors(reentryState.startSpacePos, reentryState.targetSpacePos, t);
    const toEarth = spaceState.earthCenter.clone().sub(hero.position).normalize();
    velocity.copy(toEarth).multiplyScalar(THREE.MathUtils.lerp(180, 760, t));
    flightForward.copy(toEarth);
    if (p >= .48) switchReentryToCity();
  } else {
    const local = THREE.MathUtils.clamp((p - .48) / .52, 0, 1);
    const ease = local * local * (3 - 2 * local);
    const y = THREE.MathUtils.lerp(reentryState.cityStartY, reentryState.cityEndY, ease);
    const driftScale = Math.sin(local * Math.PI) * 75;
    const aim = getAimDirection(new THREE.Vector3());
    hero.position.set(
      reentryState.lateralStart.x + aim.x * driftScale,
      y,
      reentryState.lateralStart.y + aim.z * driftScale
    );
    velocity.set(aim.x * 55, -THREE.MathUtils.lerp(720, 150, ease), aim.z * 55);
    flightForward.copy(velocity).normalize();
  }

  const targetYaw = Math.atan2(flightForward.x, flightForward.z);
  const targetPitch = -Math.asin(THREE.MathUtils.clamp(flightForward.y, -.98, .98));
  hero.rotation.y = lerpAngle(hero.rotation.y, targetYaw, 1 - Math.exp(-10 * dt));
  hero.rotation.x = THREE.MathUtils.lerp(hero.rotation.x, targetPitch, 1 - Math.exp(-8 * dt));
  hero.rotation.z = THREE.MathUtils.lerp(hero.rotation.z, Math.sin(time * 2.8) * .045 * intensity, 1 - Math.exp(-5 * dt));

  cameraShake = Math.max(cameraShake, .05 + intensity * .34);
  updateAnimation(Math.max(8, velocity.length()), true);
  updateReentryFx(dt, time, intensity);

  const modeEl = document.querySelector('#mode');
  if (modeEl) modeEl.textContent = `Modo: REENTRADA · ${Math.round(p * 100)}%`;
  const speedEl = document.querySelector('#speed');
  if (speedEl) speedEl.textContent = `Velocidade: ${Math.round(velocity.length() * 3.6)} km/h · REENTRADA`;

  if (p >= 1) finishReentry();
}

function updateSpaceEnvironment(dt, time) {
  const reentryOrbital = reentryState.active && !reentryState.cityPhase;
  const targetBlend = (spaceState.active || reentryOrbital) ? 1 : THREE.MathUtils.smoothstep(hero.position.y, SPACE_TRANSITION_START, SPACE_ENTRY_ALTITUDE);
  spaceState.blend = THREE.MathUtils.lerp(spaceState.blend, targetBlend, 1 - Math.exp(-2.5 * dt));
  const blend = THREE.MathUtils.clamp(spaceState.blend, 0, 1);

  const bg = DAY_BACKGROUND.clone().lerp(SPACE_BACKGROUND, blend);
  scene.background = bg;
  if (spaceState.active || (reentryState.active && !reentryState.cityPhase)) {
    scene.fog = null;
  } else {
    scene.fog = worldFog;
    worldFog.color.copy(DAY_FOG_COLOR).lerp(SPACE_BACKGROUND, blend * 0.75);
    worldFog.density = THREE.MathUtils.lerp(DAY_FOG_DENSITY, 0.00006, blend);
  }

  hemi.intensity = THREE.MathUtils.lerp(2.15, 0.32, blend);
  sun.intensity = THREE.MathUtils.lerp(4.0, 2.6, blend);
  starMat.opacity = THREE.MathUtils.smoothstep(blend, 0.12, 0.95) * 0.92;
  spaceGroup.visible = blend > 0.02 || spaceState.active || reentryState.active;
  earthPivot.visible = spaceState.active || (reentryState.active && !reentryState.cityPhase);
  moonPivot.visible = spaceState.active || (reentryState.active && !reentryState.cityPhase);
  sunVisual.visible = spaceGroup.visible;
  sunGlow.visible = spaceGroup.visible;
  cloudMat.opacity = cloudLayer.baseOpacity * (1 - blend);
  const skyLifeVisible = !spaceState.active && (!reentryState.active || reentryState.cityPhase) && cloudMat.opacity > 0.02;
  cloudLayer.setVisible(skyLifeVisible);
  birds.setVisible(skyLifeVisible);
  skyDome.update(time, blend);

  if (spaceState.active || (reentryState.active && !reentryState.cityPhase)) {
    earth.rotation.y += dt * 0.035;
    earthAtmosphere.rotation.y -= dt * 0.012;
    spaceState.moonAngle += dt * 0.03;
    moon.position.set(
      Math.cos(spaceState.moonAngle) * ORBITAL_MOON_DISTANCE,
      680 + Math.sin(spaceState.moonAngle * 0.7) * 220,
      Math.sin(spaceState.moonAngle) * ORBITAL_MOON_DISTANCE * 0.32 - 2500
    );
    moon.rotation.y += dt * 0.025;
  }
}

// ---------------------------------------------------------------------------
// INPUT / GAMEPLAY
// ---------------------------------------------------------------------------
const keys = Object.create(null);
let yaw = Math.PI;
let pitch = -.13;
let velocity = new THREE.Vector3();
let score = 0;
const timer = new THREE.Timer();
timer.connect(document);
const temp = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const flightForward = new THREE.Vector3();
const cameraBack = new THREE.Vector3();
const up = new THREE.Vector3(0,1,0);

// V15.1: orient the whole hero root from the exact 3D reticle direction.
// Object3D.lookAt() points a regular object's local +Z axis at the target,
// which matches this project's gameplay-forward axis after modelOrientation.
// Using a quaternion avoids the yaw/pitch Euler coupling that could leave the
// Superman mesh visibly off-axis during steep climbs, dives and fast turns.
const heroFlightOrientationHelper = new THREE.Object3D();
heroFlightOrientationHelper.up.copy(up);
function orientHeroToAim(dt, direction, bank = 0, responsiveness = 12) {
  if (!direction || direction.lengthSq() < 1e-8) return;
  heroFlightOrientationHelper.position.set(0, 0, 0);
  heroFlightOrientationHelper.quaternion.identity();
  heroFlightOrientationHelper.up.copy(up);
  heroFlightOrientationHelper.lookAt(direction.clone().normalize());
  if (bank) heroFlightOrientationHelper.rotateZ(bank);
  hero.quaternion.slerp(heroFlightOrientationHelper.quaternion, 1 - Math.exp(-responsiveness * dt));
}

// V10 super-power tuning. World units are treated as metres for the Mach HUD.
const MACH_ONE = 343;
const NORMAL_FLIGHT_SPEED = 72;
const SUPERSONIC_MAX_SPEED = 420;
let boostCharge = 0;
let wasSupersonic = false;
let sonicBoomCooldown = 0;

// Heat vision is now a held ability with heat/overheat instead of a one-shot.
let heatVisionActive = false;
let heatVisionHeat = 0;
let heatVisionOverheated = false;
let heatDamageAccumulator = 0;
let heatMessageCooldown = 0;

function getAimDirection(out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();
}

// ---------------------------------------------------------------------------
// V16 DYNAMIC EMERGENCIES / ICE BREATH
// ---------------------------------------------------------------------------
const eventRng = mulberry32(51077);
const fireSystem = new FireSystem();
const iceBreathController = new IceBreathController();
const emergencyPresentation = new EmergencyPresentation({
  scene,
  camera,
  hudRoot: document.querySelector('#event-hud'),
  markerRoot: document.querySelector('#event-markers')
});
let emergencyEventSerial = 0;
let iceBreathAction = null;
const recentBuildingFireIds = new Map();
const METEOR_COLLISION_RADIUS = 2.4;
const dynamicEventSystem = new DynamicEventSystem({
  rng: eventRng,
  factories: {
    meteor: createMeteorEvent,
    buildingFire: createBuildingFireEvent
  }
});

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat && ['KeyF', 'KeyE', 'KeyX', 'KeyC', 'KeyQ', 'KeyG', 'KeyR', 'Space'].includes(e.code)) return;

  if (e.code === 'KeyR') resetGame();
  if (e.code === 'Space') startDodge();
  if (e.code === 'KeyQ') startHeatVision();
  if (e.code === 'KeyG') startIceBreath();
  if (e.code === 'KeyC') startLeapAttack();
  if (e.code === 'KeyE') {
    if (e.shiftKey || keys.ShiftLeft || keys.ShiftRight) superPunch();
    else punch();
  }
  if (e.code === 'KeyX') superPunch();
  if (e.code === 'KeyF') toggleFlight();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyQ') stopHeatVision(false);
  if (e.code === 'KeyG') stopIceBreath();
});

// requestPointerLock() returns a promise that rejects when the browser refuses
// (e.g. clicking right after Esc); the existing "click to continue" hint covers it.
function lockPointer() {
  // Touch browsers (iOS Safari) have no pointer lock at all.
  if (IS_TOUCH) return;
  renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
}

function lookBy(dYaw, dPitch) {
  yaw += dYaw;
  pitch = THREE.MathUtils.clamp(pitch + dPitch, -1.05, .8);
}

function enterFullscreenLandscape() {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    root.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
}

const helpPanel = document.querySelector('#help');
const touchControls = IS_TOUCH ? createTouchControls({
  look: lookBy,
  onMenu: () => {
    touchControls.releaseAll();
    helpPanel.classList.remove('hidden');
  }
}) : null;
renderer.domElement.addEventListener('click', () => {
  if (document.querySelector('#help').classList.contains('hidden')) lockPointer();
});
document.querySelector('#play').addEventListener('click', e => {
  e.currentTarget.blur(); // Space is the dodge key; keep it from re-pressing the button
  document.querySelector('#help').classList.add('hidden');
  lockPointer();
  if (IS_TOUCH) enterFullscreenLandscape();
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && document.querySelector('#help').classList.contains('hidden')) showMessage('Clique na tela para continuar', 1200);
});
document.addEventListener('mousemove', e => {
  if (!document.pointerLockElement) return;
  yaw -= e.movementX * .0025;
  pitch -= e.movementY * .0020;
  pitch = THREE.MathUtils.clamp(pitch, -1.05, .8);
});

// ---------------------------------------------------------------------------
// V16 DYNAMIC EVENT RUNTIME
// ---------------------------------------------------------------------------
function randomBetween(min, max) {
  return min + (max - min) * eventRng();
}

function pointInsideBuildingFootprint(x, z, margin = 0) {
  const cell = colliderGrid.get(getGridKey(x, z));
  if (!cell) return false;
  return cell.some(box => x >= box.min.x - margin && x <= box.max.x + margin && z >= box.min.z - margin && z <= box.max.z + margin);
}

function createMeteorEvent() {
  if (!cityLoaded) return null;
  let impactPoint = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = randomBetween(-360, 360);
    const z = randomBetween(-360, 360);
    if (pointInsideBuildingFootprint(x, z, 1.5)) continue;
    impactPoint = { x, y:getBaseSurfaceHeightAt(x, z) + .08, z };
    break;
  }
  if (!impactPoint) return null;

  const id = `meteor-${++emergencyEventSerial}`;
  const fireCount = 3 + Math.floor(eventRng() * 4);
  const event = new MeteorEvent({
    id,
    impactPoint,
    startPosition: {
      x: impactPoint.x + randomBetween(-140, 140),
      y: 360,
      z: impactPoint.z + randomBetween(-140, 140)
    },
    warningSeconds: 1.5,
    fallSeconds: 12,
    fireCount
  });
  showMessage('ALERTA · METEORO DETECTADO', 1250);
  return event;
}

function createBuildingFireEvent() {
  if (!cityLoaded || !buildingTargets.length || fireSystem.remainingCapacity() <= 0) return null;
  const activeBuildingIds = dynamicEventSystem.getActiveEvents()
    .filter(event => event.type === 'building-fire' && event.state === 'active')
    .map(event => event.buildingId);
  const building = selectBuildingTarget(buildingTargets, {
    heroPosition: hero.position,
    activeBuildingIds,
    recentBuildingIds: [...recentBuildingFireIds.keys()],
    rng: eventRng,
    minHeroDistance: 70
  });
  if (!building) return null;

  const id = `building-fire-${++emergencyEventSerial}`;
  const requested = 1 + Math.floor(eventRng() * 3);
  const count = Math.min(requested, fireSystem.remainingCapacity());
  if (count <= 0) return null;
  const descriptors = createBuildingFireSpots({ eventId:id, building, count, rng:eventRng });
  const fireIds = fireSystem.addSpots(descriptors);
  if (!fireIds.length) return null;

  const event = new BuildingFireEvent({ id, buildingId:building.id });
  event.attachFireIds(fireIds);
  showMessage('EMERGÊNCIA · INCÊNDIO EM PRÉDIO', 1100);
  return event;
}

function buildMeteorImpactFireDescriptors(eventId, point, requestedCount) {
  const count = Math.min(Math.max(0, Number(requestedCount) || 0), fireSystem.remainingCapacity());
  const out = [];
  const used = [];
  const maxAttempts = Math.max(18, count * 12);
  for (let attempt = 0; attempt < maxAttempts && out.length < count; attempt++) {
    const angle = eventRng() * Math.PI * 2;
    const radius = randomBetween(7, 22);
    const x = THREE.MathUtils.clamp(point.x + Math.cos(angle) * radius, -CITY_EDGE + 3, CITY_EDGE - 3);
    const z = THREE.MathUtils.clamp(point.z + Math.sin(angle) * radius, -CITY_EDGE + 3, CITY_EDGE - 3);
    if (used.some(p => Math.hypot(p.x - x, p.z - z) < 3.2)) continue;
    const y = getSurfaceHeightAt(x, z) + .06;
    const index = out.length + 1;
    used.push({x,z});
    out.push({
      id:`${eventId}:impact-fire:${index}`,
      eventId,
      source:'meteor-impact',
      position:{x,y,z},
      normal:{x:0,y:1,z:0},
      radius:2.35,
      intensity:1
    });
  }
  return out;
}

function eventById(eventId) {
  return dynamicEventSystem.getActiveEvents().find(event => event.id === eventId) || null;
}

function pushCityActorsFrom(point, radius = 24, strength = 14) {
  const origin = new THREE.Vector3(point.x, point.y, point.z);
  for (const actor of [...trafficActors, ...npcActors]) {
    if (!actor?.object) continue;
    const delta = actor.object.position.clone().sub(origin);
    delta.y = 0;
    const distance = delta.length();
    if (distance < .01 || distance > radius) continue;
    delta.normalize();
    actor.object.position.addScaledVector(delta, (1 - distance / radius) * strength);
  }
}

function handleEventCommand(command) {
  if (!command) return;
  const event = eventById(command.eventId);
  if (command.type === 'meteor-impact') {
    const point = command.point || event?.impactPoint;
    if (!point) return;
    emergencyPresentation.pulseImpact(point, { strength:1.8 });
    const impactPosition = new THREE.Vector3(point.x, point.y, point.z);
    spawnGroundImpactFx(impactPosition, 3.2);
    bursts.embers(impactPosition, { count: 44, radius: 12 });
    const impactDistance = hero.position.distanceTo(impactPosition);
    const impactShake = THREE.MathUtils.lerp(.08, 1.0, 1 - THREE.MathUtils.smoothstep(impactDistance, 35, 300));
    cameraShake = Math.max(cameraShake, impactShake);
    pushCityActorsFrom(point, 27, 16);
    const requested = Math.min(Number(command.requestedFireCount) || 3, fireSystem.remainingCapacity());
    const descriptors = buildMeteorImpactFireDescriptors(command.eventId, point, requested);
    const fireIds = fireSystem.addSpots(descriptors);
    event?.attachFireIds?.(fireIds);
    showMessage(fireIds.length ? `IMPACTO · APAGUE ${fireIds.length} FOCOS` : 'IMPACTO DO METEORO', 1500);
    return;
  }
  if (command.type === 'meteor-intercepted') {
    emergencyPresentation.pulseAirburst(command.position);
    emergencyPresentation.removeMeteor(command.eventId, { exploded:false });
    event?.dispose?.();
    showMessage('EVENTO CONCLUÍDO · METEORO INTERCEPTADO', 1400);
    return;
  }
  if (command.type === 'meteor-resolved') {
    fireSystem.removeEvent(command.eventId);
    emergencyPresentation.removeMeteor(command.eventId);
    showMessage('EVENTO CONCLUÍDO · INCÊNDIOS EXTINTOS', 1250);
    return;
  }
  if (command.type === 'building-fire-resolved') {
    fireSystem.removeEvent(command.eventId);
    if (command.buildingId) recentBuildingFireIds.set(command.buildingId, 150);
    showMessage('EVENTO CONCLUÍDO · INCÊNDIO APAGADO', 1150);
  }
}

function tryInterceptActiveMeteor(method, origin, radius = 0, speed = 0) {
  const meteor = dynamicEventSystem.getActiveEvents().find(event => event.type === 'meteor' && event.state === 'falling');
  if (!meteor || !origin) return false;
  const snapshot = meteor.getSnapshot();
  const meteorPosition = new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z);
  if (origin.distanceTo(meteorPosition) > Math.max(0, radius) + METEOR_COLLISION_RADIUS) return false;
  const commands = meteor.tryIntercept({ method, speed, machOne:MACH_ONE });
  for (const command of commands) handleEventCommand(command);
  return commands.length > 0;
}

function trySupersonicMeteorSweep(previousPosition, currentPosition, speed) {
  if (speed < MACH_ONE) return false;
  const meteor = dynamicEventSystem.getActiveEvents().find(event => event.type === 'meteor' && event.state === 'falling');
  if (!meteor) return false;
  const snapshot = meteor.getSnapshot();
  const center = new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z);
  const segment = currentPosition.clone().sub(previousPosition);
  const lenSq = segment.lengthSq();
  if (lenSq < 1e-8) return false;
  const t = THREE.MathUtils.clamp(center.clone().sub(previousPosition).dot(segment) / lenSq, 0, 1);
  const closest = previousPosition.clone().addScaledVector(segment, t);
  return tryInterceptActiveMeteor('supersonic', closest, .9, speed);
}

function iceBreathSlotName(kind, variant) {
  const suffix = variant === 'air' ? 'Air' : 'Ground';
  if (kind === 'start') return `iceBreath${suffix}Start`;
  if (kind === 'loop') return `iceBreath${suffix}Loop`;
  return `iceBreath${suffix}Exit`;
}

function applyIceBreathCommand(command) {
  if (!command) return;
  if (command.type === 'cancel') {
    // No fade-out here: the next transition cross-fades from the breath pose.
    if (iceBreathAction && currentOnceAction === iceBreathAction) cancelCurrentOneShot();
    if (currentAction === iceBreathAction) currentAnimName = '';
    iceBreathAction = null;
    emergencyPresentation.setIceBreath({active:false});
    return;
  }

  const kind = command.type === 'play-start' ? 'start' : command.type === 'play-exit' ? 'exit' : 'loop';
  const slotName = iceBreathSlotName(kind, command.variant);
  const fallbackClip = {
    iceBreathGroundStart:'C003_IceBreath',
    iceBreathGroundLoop:'C003_IceBreath_Loop',
    iceBreathGroundExit:'C003_IceBreath_IntoIdle',
    iceBreathAirStart:'C003_Air_IceBreath',
    iceBreathAirLoop:'C003_Air_IceBreath_Loop',
    iceBreathAirExit:'C003_Air_IceBreath_IntoIdle'
  }[slotName];
  const cfg = heroSlot(slotName, { clip:fallbackClip, speed:1, fade:.07, loop:kind === 'loop' });
  const clip = findClip([cfg.clip, fallbackClip].filter(Boolean));
  if (!clip || !mixer) {
    iceBreathController.reset();
    emergencyPresentation.setIceBreath({active:false});
    showMessage('SOPRO CONGELANTE · ANIMAÇÃO AUSENTE', 800);
    return;
  }

  if (kind === 'loop') {
    iceBreathAction = transitionTo(clip, { fade:cfg.fade, once:false, timeScale:cfg.speed });
    return;
  }
  if (kind === 'start') {
    iceBreathAction = transitionTo(clip, {
      fade:cfg.fade, once:true, timeScale:cfg.speed,
      onFinished:() => applyIceBreathCommand(iceBreathController.onStartFinished())
    });
    return;
  }
  emergencyPresentation.setIceBreath({active:false});
  iceBreathAction = transitionTo(clip, {
    fade:cfg.fade, once:true, timeScale:cfg.speed,
    onFinished:() => {
      iceBreathController.onExitFinished();
      iceBreathAction = null;
      currentAnimName = '';
    }
  });
}

function canUseIceBreath() {
  return heroReady && !!mixer && !playerDead && !spaceState.active && !reentryState.active &&
    !leapAttack.active && !flightMachine.busy && !heatVisionActive && !heatVisionOverheated &&
    heatVisionAnimPhase === 'idle' && !actionLocked;
}

function startIceBreath() {
  const command = iceBreathController.requestStart({
    airborne: flightMachine.state !== 'grounded',
    canUse: canUseIceBreath()
  });
  if (command) {
    applyIceBreathCommand(command);
    showMessage('SOPRO CONGELANTE', 420);
  }
}

function stopIceBreath() {
  applyIceBreathCommand(iceBreathController.requestStop());
}

function forceStopIceBreath() {
  const command = iceBreathController.forceStop();
  if (command) applyIceBreathCommand(command);
  else emergencyPresentation.setIceBreath({active:false});
}

function getIceBreathOrigin() {
  const head = heroBoneMap.get('fml_un_C_head');
  const origin = new THREE.Vector3();
  if (head) head.getWorldPosition(origin);
  else origin.copy(hero.position).add(new THREE.Vector3(0, 1.55, 0));
  return origin.addScaledVector(getAimDirection(new THREE.Vector3()), .18);
}

function iceBreathOccluded(origin, spot) {
  const target = new THREE.Vector3(spot.position.x, spot.position.y, spot.position.z);
  const delta = target.clone().sub(origin);
  const distance = delta.length();
  if (distance <= .01) return false;
  const ray = new THREE.Ray(origin, delta.normalize());
  const hit = new THREE.Vector3();
  for (const box of collidersAlong(origin, target)) {
    const point = ray.intersectBox(box, hit);
    if (!point) continue;
    const hitDistance = point.distanceTo(origin);
    if (hitDistance > .05 && hitDistance < distance - .45) return true;
  }
  return false;
}

function updateIceBreath(dt) {
  if (!iceBreathController.active) {
    emergencyPresentation.setIceBreath({active:false});
    return;
  }
  if (playerDead || spaceState.active || reentryState.active || leapAttack.active || flightMachine.busy || heatVisionActive || heatVisionOverheated || actionLocked) {
    forceStopIceBreath();
    return;
  }

  applyIceBreathCommand(iceBreathController.setAirborne(flightMachine.state !== 'grounded'));
  const emitting = iceBreathController.held && (iceBreathController.phase === 'starting' || iceBreathController.phase === 'looping');
  if (!emitting) {
    emergencyPresentation.setIceBreath({active:false});
    return;
  }

  const origin = getIceBreathOrigin();
  const direction = getAimDirection(new THREE.Vector3());
  const affected = fireSystem.applyCoolingCone({
    origin,
    direction,
    range: ICE_BREATH_TUNING.range,
    halfAngleDeg: ICE_BREATH_TUNING.halfAngleDeg,
    dt,
    rate: ICE_BREATH_TUNING.coolingRate,
    occluded: spot => iceBreathOccluded(origin, spot)
  });
  emergencyPresentation.setIceBreath({ active:true, origin, direction, intensity:affected.length ? 1 : .76 });
}

function collectEmergencySnapshots() {
  return dynamicEventSystem.getSnapshots().map(snapshot => {
    const activeFireIds = (snapshot.fireIds || []).filter(id => fireSystem.getSpot(id)?.state !== 'extinguished');
    const enriched = { ...snapshot, fireIds:activeFireIds };
    if (snapshot.type === 'building-fire') {
      const fire = activeFireIds.length ? fireSystem.getSpot(activeFireIds[0]) : null;
      if (fire) enriched.position = { ...fire.position };
      else {
        const building = buildingTargets.find(item => item.id === snapshot.buildingId);
        if (building) enriched.position = {
          x:(building.min.x + building.max.x) * .5,
          y:building.max.y,
          z:(building.min.z + building.max.z) * .5
        };
      }
    }
    return enriched;
  });
}

function syncEmergencyPresentation(dt = 0) {
  const snapshots = collectEmergencySnapshots();
  for (const snapshot of snapshots) if (snapshot.type === 'meteor') emergencyPresentation.syncMeteor(snapshot);
  emergencyPresentation.syncFires(fireSystem.getActiveSpots());
  emergencyPresentation.updateHud(snapshots, hero.position);
  emergencyPresentation.updateMarkers(snapshots, camera, {width:innerWidth,height:innerHeight}, hero.position);
  emergencyPresentation.root.visible = !spaceState.active && !reentryState.active;
  if (dt > 0) emergencyPresentation.updateEffects(dt);
}

function updateDynamicEvents(dt, time) {
  const helpVisible = !document.querySelector('#help')?.classList.contains('hidden');
  const controlLocked = !heroReady || playerDead || actionLocked || flightMachine.busy || leapAttack.active || helpVisible;
  const pauses = [
    ['space', spaceState.active],
    ['reentry', reentryState.active],
    ['dead/control-lock', controlLocked]
  ];
  for (const [reason, active] of pauses) {
    if (active) dynamicEventSystem.pause(reason);
    else dynamicEventSystem.resume(reason);
  }

  if (dynamicEventSystem.paused) {
    syncEmergencyPresentation(0);
    return;
  }

  for (const [buildingId, remaining] of [...recentBuildingFireIds]) {
    const next = remaining - dt;
    if (next <= 0) recentBuildingFireIds.delete(buildingId);
    else recentBuildingFireIds.set(buildingId, next);
  }
  fireSystem.update(dt);
  const commands = dynamicEventSystem.update(dt, {
    time,
    heroPosition: hero.position,
    activeFireSpots: fireSystem.getActiveSpots().length,
    remainingFires: eventId => fireSystem.countByEvent(eventId)
  });
  for (const command of commands) handleEventCommand(command);
  syncEmergencyPresentation(dt);
}

// ---------------------------------------------------------------------------
// HEAT VISION V10
// ---------------------------------------------------------------------------
const heatBeamMat = new THREE.MeshBasicMaterial({
  color: 0xff1838, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false
});
const heatCoreMat = new THREE.MeshBasicMaterial({
  color: 0xfff2df, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false
});
const beamCylinderGeo = new THREE.CylinderGeometry(.018, .018, 1, 7, 1, true);
const beamCoreGeo = new THREE.CylinderGeometry(.007, .007, 1, 6, 1, true);
const beamL = new THREE.Mesh(beamCylinderGeo, heatBeamMat.clone());
const beamR = new THREE.Mesh(beamCylinderGeo, heatBeamMat.clone());
const beamCoreL = new THREE.Mesh(beamCoreGeo, heatCoreMat.clone());
const beamCoreR = new THREE.Mesh(beamCoreGeo, heatCoreMat.clone());
scene.add(beamL, beamR, beamCoreL, beamCoreR);

const heatImpact = new THREE.Mesh(
  new THREE.SphereGeometry(.16, 10, 8),
  new THREE.MeshBasicMaterial({ color:0xffc36a, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false })
);
heatImpact.visible = false;
scene.add(heatImpact);
const heatImpactLight = new THREE.PointLight(0xff3b12, 0, 7, 2);
scene.add(heatImpactLight);

function setCylinderBetween(mesh, a, b, radiusScale=1) {
  const delta = b.clone().sub(a);
  const len = Math.max(.001, delta.length());
  mesh.position.copy(a).addScaledVector(delta, .5);
  mesh.scale.set(radiusScale, len, radiusScale);
  mesh.quaternion.setFromUnitVectors(up, delta.normalize());
}

function eyeWorldPoints() {
  // Follow the animated eye bones so the beams leave the face in every pose
  // (crouched ground laser, horizontal flight). The fixed offsets remain as a
  // fallback for the placeholder model or renamed bones.
  const leftEye = heroBoneMap.get('fml_un_L_eyeBall');
  const rightEye = heroBoneMap.get('fml_un_R_eyeBall');
  if (leftEye && rightEye && importedHero?.visible !== false) {
    const aim = getAimDirection(new THREE.Vector3()).multiplyScalar(.05);
    return {
      left: leftEye.getWorldPosition(new THREE.Vector3()).add(aim),
      right: rightEye.getWorldPosition(new THREE.Vector3()).add(aim)
    };
  }
  return {
    left: hero.localToWorld(new THREE.Vector3(-.035, 1.79, .08)),
    right: hero.localToWorld(new THREE.Vector3(.035, 1.79, .08))
  };
}

function heatVisionRaycast() {
  const dir = getAimDirection(new THREE.Vector3());
  const origin = camera.position.clone();
  const ray = new THREE.Ray(origin, dir);
  let distance = 320;
  let target = 'air';

  // Buildings occlude the beam.
  const hit = new THREE.Vector3();
  for (const box of collidersAlong(origin, origin.clone().addScaledVector(dir, distance))) {
    const point = ray.intersectBox(box, hit);
    if (!point) continue;
    const d = point.distanceTo(origin);
    if (d > .2 && d < distance) { distance = d; target = 'building'; }
  }

  // Ground/street plane gives downward shots a visible impact.
  if (dir.y < -.001) {
    // Intersect the flat ground first, then refine once against the actual
    // road/sidewalk/pad height at that spot.
    let t = (GROUND_EPS - origin.y) / dir.y;
    const p = origin.clone().addScaledVector(dir, t);
    t = (getBaseSurfaceHeightAt(p.x, p.z) - origin.y) / dir.y;
    if (t > .2 && t < distance) { distance = t; target = 'ground'; }
  }

  // Jason is treated as a compact capsule/sphere around his upper body.
  if (enemyReady && enemyAlive) {
    const center = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.25, 0));
    const toCenter = center.clone().sub(origin);
    const along = toCenter.dot(dir);
    if (along > 0 && along < distance) {
      const closest = origin.clone().addScaledVector(dir, along);
      const radius = 1.35;
      if (closest.distanceToSquared(center) <= radius * radius) {
        distance = along;
        target = 'enemy';
      }
    }
  }

  return { origin, dir, distance, target, point: origin.clone().addScaledVector(dir, distance) };
}

function updateHeatVisionGeometry(intensity=1) {
  const hit = heatVisionRaycast();
  const eyes = eyeWorldPoints();
  const wobble = .004 * (1 - intensity);
  const endpoint = hit.point.clone();
  endpoint.x += (Math.random() - .5) * wobble;
  endpoint.y += (Math.random() - .5) * wobble;
  setCylinderBetween(beamL, eyes.left, endpoint, .7 + intensity * .7);
  setCylinderBetween(beamR, eyes.right, endpoint, .7 + intensity * .7);
  setCylinderBetween(beamCoreL, eyes.left, endpoint, .65 + intensity * .35);
  setCylinderBetween(beamCoreR, eyes.right, endpoint, .65 + intensity * .35);

  const outerOpacity = .34 + intensity * .58;
  beamL.material.opacity = beamR.material.opacity = outerOpacity;
  beamCoreL.material.opacity = beamCoreR.material.opacity = .72 + intensity * .28;

  heatImpact.position.copy(endpoint);
  if (hit.target !== 'air') bursts.sparks(endpoint, { count: 2, power: .55, dir: { x: 0, y: 1, z: 0 }, cone: 1.3, color: [1, .5, .18] });
  heatImpact.visible = hit.target !== 'air';
  heatImpact.material.opacity = hit.target === 'air' ? 0 : .45 + intensity * .45;
  heatImpact.scale.setScalar(.7 + intensity * .9 + Math.sin(timer.getElapsed() * 28) * .12);
  heatImpactLight.position.copy(endpoint);
  heatImpactLight.intensity = hit.target === 'air' ? 0 : 1.5 + intensity * 3.5;
  return hit;
}

function hideHeatVision() {
  for (const beam of [beamL, beamR, beamCoreL, beamCoreR]) beam.material.opacity = 0;
  heatImpact.visible = false;
  heatImpactLight.intensity = 0;
}

function startHeatVisionHoldLoop() {
  if (!heatVisionActive || heatVisionOverheated || !mixer) return;
  const loopClip = heatVisionAnimSource === 'ground' ? heatVisionHoldLoopGround : heatVisionHoldLoopAir;
  if (!loopClip) return;
  heatVisionAnimPhase = 'loop';
  transitionTo(loopClip, {
    fade: .08,
    once: false,
    timeScale: .88,
    loopMode: THREE.LoopPingPong
  });
}

function startHeatVision() {
  if (iceBreathController.active) return;
  if (heatVisionActive || heatVisionOverheated || playerDead) return;
  if (actionLocked && heroActiveSlot === 'flyStop') {
    cancelCurrentOneShot(.05);
    airStopState = 'idle';
  } else if (actionLocked) return;

  heatVisionActive = true;
  heatDamageAccumulator = 0;
  heatVisionAnimPhase = 'intro';
  heatVisionAnimSource = flightMachine.state === 'grounded' ? 'ground' : 'air';

  const grounded = heatVisionAnimSource === 'ground';
  const slotName = grounded ? 'heatVisionGround' : 'heatVision';
  const candidates = grounded ? ['C003_Laser_Ground', 'C003_Laser_Air'] : ['C003_Laser_Air', 'C003_Laser_Ground'];
  const fallbackSpeed = grounded ? 1.0 : 1.05;
  const started = playOneShot(candidates, '', fallbackSpeed, () => {
    if (heatVisionActive && keys.KeyQ && !heatVisionOverheated) startHeatVisionHoldLoop();
    else heatVisionAnimPhase = 'idle';
  }, slotName);
  if (!started) heatVisionAnimPhase = 'idle';
  document.body.classList.add('heat-vision-active');
}

function stopHeatVision(overheated=false) {
  if (!heatVisionActive && !overheated) return;
  heatVisionActive = false;
  hideHeatVision();
  document.body.classList.remove('heat-vision-active');

  if (heatVisionAnimPhase === 'loop') {
    // The next locomotion transition cross-fades out of the hold loop.
    currentAnimName = '';
    heatVisionAnimPhase = 'idle';
  }
  // If Q is released during the authored intro, allow that short one-shot to
  // finish naturally. Its completion callback will not enter the hold loop.

  if (overheated) {
    heatVisionOverheated = true;
    showMessage('VISÃO DE CALOR SUPERAQUECIDA', 950);
  }
}

function damageEnemyHeat(amount) {
  if (!enemyReady || !enemyAlive) return;
  enemyHealth = Math.max(0, enemyHealth - amount);
  updateCombatHUD();
  cameraShake = Math.max(cameraShake, .035);
  if (enemyHealth <= 0) defeatEnemy();
}

function updateHeatVision(dt) {
  heatMessageCooldown = Math.max(0, heatMessageCooldown - dt);
  if (heatVisionActive) {
    heatVisionHeat = Math.min(100, heatVisionHeat + dt * 24);
    const intensity = THREE.MathUtils.smoothstep(heatVisionHeat, 0, 70);
    const hit = updateHeatVisionGeometry(.55 + intensity * .45);
    heatDamageAccumulator += dt;
    if (hit.target === 'enemy' && heatDamageAccumulator >= .12) {
      // 30 DPS, applied in small ticks without forcing Jason into a flinch loop.
      damageEnemyHeat(30 * heatDamageAccumulator);
      heatDamageAccumulator = 0;
      if (heatMessageCooldown <= 0) {
        showMessage('VISÃO DE CALOR', 220);
        heatMessageCooldown = .42;
      }
    } else if (hit.target !== 'enemy') {
      heatDamageAccumulator = Math.min(heatDamageAccumulator, .12);
    }
    if (heatVisionHeat >= 100) stopHeatVision(true);
  } else {
    const coolRate = heatVisionOverheated ? 17 : 26;
    heatVisionHeat = Math.max(0, heatVisionHeat - dt * coolRate);
    if (heatVisionOverheated && heatVisionHeat <= 28) {
      heatVisionOverheated = false;
      showMessage('VISÃO DE CALOR PRONTA', 600);
    }
  }

  const heatFill = document.querySelector('#heat-fill');
  const heatText = document.querySelector('#heat-text');
  if (heatFill) heatFill.style.width = `${heatVisionHeat}%`;
  if (heatText) heatText.textContent = heatVisionOverheated ? 'RESFRIANDO' : heatVisionActive ? 'ATIVA' : 'PRONTA';
  document.body.classList.toggle('heat-overheated', heatVisionOverheated);
}

function heroIsPunching() {
  return actionLocked && (heroActiveSlot === 'punch' || heroActiveSlot === 'superPunch');
}

function punch() {
  if (heroIsPunching()) { bufferAttack('punch'); return; }
  if (iceBreathController.active) forceStopIceBreath();
  const started = playOneShot(['C003_Punch_01', 'C003_N_Attack_01'], 'SOCO!', 1.05, null, 'punch');
  if (started && !(heroAnimConfig?.slots?.punch?.events || []).length) normalPunchImpactTimer = .19;
}

function superPunch() {
  if (heroIsPunching()) { bufferAttack('super'); return; }
  if (iceBreathController.active) forceStopIceBreath();
  if (actionLocked || superPunchImpactTimer >= 0) return;
  const started = playOneShot(['C003_N_Attack_01', 'C003_Punch_01'], 'SUPER SOCO!', 1.16, null, 'superPunch');
  if (started && !(heroAnimConfig?.slots?.superPunch?.events || []).length) superPunchImpactTimer = .22;
}

function firstLeapObstacleDistance(start, direction, maxDistance) {
  const ray = new THREE.Ray(start.clone().add(new THREE.Vector3(0, 1.05, 0)), direction);
  const hit = new THREE.Vector3();
  let nearest = maxDistance;
  for (const box of collidersAlong(ray.origin, ray.origin.clone().addScaledVector(direction, maxDistance), 1.5)) {
    // The leap may clear street props, but it must not tunnel through buildings.
    const expanded = box.clone().expandByVector(new THREE.Vector3(.65, .25, .65));
    const point = ray.intersectBox(expanded, hit);
    if (!point) continue;
    const d = point.distanceTo(ray.origin);
    if (d > .45 && d < nearest) nearest = d;
  }
  return nearest;
}

function computeLeapDestination() {
  const start = hero.position.clone();
  const aim = getAimDirection(new THREE.Vector3());
  aim.y = 0;
  if (aim.lengthSq() < .001) aim.set(0, 0, 1).applyQuaternion(hero.quaternion);
  aim.normalize();

  let direction = aim.clone();
  let distance = 10.5;
  let lockedEnemy = false;

  if (enemyReady && enemyAlive) {
    const toEnemy = enemyRoot.position.clone().sub(start);
    toEnemy.y = 0;
    const enemyDistance = toEnemy.length();
    if (enemyDistance > 1.4 && enemyDistance <= LEAP_MAX_RANGE + 2) {
      const towardEnemy = toEnemy.clone().normalize();
      const inAimCone = towardEnemy.dot(aim) >= .58;
      const obstacle = firstLeapObstacleDistance(start, towardEnemy, enemyDistance);
      if (inAimCone && obstacle >= enemyDistance - .8) {
        direction.copy(towardEnemy);
        distance = THREE.MathUtils.clamp(enemyDistance - 1.05, LEAP_MIN_RANGE, LEAP_MAX_RANGE);
        lockedEnemy = true;
      }
    }
  }

  // If the reticle points into a building, land before the facade instead of
  // teleporting through it or snapping to its roof.
  const obstacle = firstLeapObstacleDistance(start, direction, distance);
  distance = Math.min(distance, Math.max(LEAP_MIN_RANGE, obstacle - 1.05));

  const end = start.clone().addScaledVector(direction, distance);
  end.x = THREE.MathUtils.clamp(end.x, -WORLD_LIMIT + 1, WORLD_LIMIT - 1);
  end.z = THREE.MathUtils.clamp(end.z, -WORLD_LIMIT + 1, WORLD_LIMIT - 1);
  end.y = getBaseSurfaceHeightAt(end.x, end.z) + GROUND_EPS;
  return { start, end, direction, distance, lockedEnemy };
}

function startLeapAttack() {
  if (iceBreathController.active) forceStopIceBreath();
  if (!heroReady || !mixer || playerDead || leapAttack.active || actionLocked || heatVisionActive) return;
  if (flightMachine.state !== 'grounded' || flightMachine.busy) {
    showMessage('LEAP ATTACK · POUSE PRIMEIRO', 620);
    return;
  }

  const cfg = heroSlot('leapAttack', { clip:'C003_LeapAttack', speed:1, fade:.06, loop:false });
  const clip = findClip([cfg.clip, 'C003_LeapAttack']);
  if (!clip) {
    showMessage('LEAP ATTACK · ANIMAÇÃO AUSENTE', 700);
    return;
  }

  const plan = computeLeapDestination();
  leapAttack.active = true;
  leapAttack.phase = 'windup';
  leapAttack.elapsed = 0;
  leapAttack.start.copy(plan.start);
  leapAttack.end.copy(plan.end);
  leapAttack.direction.copy(plan.direction);
  leapAttack.arcHeight = THREE.MathUtils.clamp(2.9 + plan.distance * .16, 3.35, 5.8);
  leapAttack.lockedEnemy = plan.lockedEnemy;
  leapAttack.impacted = false;
  // Longer jumps get a little more airtime without making the control sluggish.
  leapAttack.travel = THREE.MathUtils.clamp(.68 + plan.distance * .012, .72, .90);

  velocity.set(0,0,0);
  hero.rotation.y = Math.atan2(plan.direction.x, plan.direction.z);
  hero.rotation.x = 0;
  hero.rotation.z = 0;
  actionLocked = true;
  heroActiveSlot = 'leapAttack';
  heroEventQueue = [];
  const action = transitionTo(clip, { fade:cfg.fade, once:false, timeScale:cfg.speed });
  if (action) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  showMessage(plan.lockedEnemy ? 'LEAP ATTACK · JASON' : 'LEAP ATTACK', 520);
}

// Dust ring, flying debris and sparks for big ground impacts. `point.y` must be
// the surface height at the impact.
function spawnGroundImpactFx(point, power = 1) {
  const ground = { x: point.x, y: point.y + .05, z: point.z };
  bursts.dust(ground, { count: Math.round(22 + 24 * power), radius: 3 + 2.5 * power, power });
  bursts.debris(ground, { count: Math.round(10 + 10 * power), power });
  bursts.sparks({ x: ground.x, y: ground.y + .3, z: ground.z }, {
    count: Math.round(10 + 10 * power), power: .8 + power * .3, dir: { x: 0, y: 1, z: 0 }, cone: 1.4
  });
}

function triggerLeapImpact() {
  if (leapAttack.impacted) return;
  leapAttack.impacted = true;
  const origin = hero.position.clone().add(new THREE.Vector3(0, .18, 0));

  // Horizontal shock ring at the exact landing point.
  const fx = getImpactEffect('leap');
  const wave = fx.object;
  wave.rotation.x = -Math.PI / 2;
  wave.position.copy(origin).add(new THREE.Vector3(0, .06, 0));
  impactEffects.push({ object:wave, life:.48, maxLife:.48, poolItem: fx });
  spawnGroundImpactFx(origin, 1.3);

  cameraShake = Math.max(cameraShake, .74);

  // A leap attack is an area impact: the direct target takes the same hit as
  // anyone caught close to the landing point, and nearby city actors are shoved.
  if (enemyAlive) {
    const enemyCenter = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    const flat = enemyCenter.clone().sub(origin); flat.y = 0;
    if (flat.length() <= LEAP_IMPACT_RADIUS && Math.abs(enemyRoot.position.y - hero.position.y) < 3.2) {
      damageEnemy(LEAP_DAMAGE, origin, LEAP_KNOCKBACK, 'LEAP ATTACK');
    }
  }

  for (const actor of [...trafficActors, ...npcActors]) {
    const delta = actor.object.position.clone().sub(origin); delta.y = 0;
    const d = delta.length();
    if (d < .05 || d > 7.5) continue;
    actor.object.position.addScaledVector(delta.normalize(), (1 - d / 7.5) * 4.8);
  }
}

function beginLeapLanding() {
  triggerLeapImpact();
  leapAttack.phase = 'recover';
  velocity.set(0,0,0);
  hero.position.copy(leapAttack.end);

  const cfg = heroSlot('leapAttackLand', { clip:'C003_LeapAttackLand', speed:1, fade:.055, loop:false });
  const clip = findClip([cfg.clip, 'C003_LeapAttackLand', 'C003_Land']);
  if (!clip) {
    leapAttack.active = false;
    leapAttack.phase = 'idle';
    actionLocked = false;
    heroActiveSlot = '';
    return;
  }

  actionLocked = true;
  heroActiveSlot = 'leapAttackLand';
  transitionTo(clip, {
    fade: cfg.fade,
    once: true,
    timeScale: cfg.speed,
    onFinished: () => {
      leapAttack.active = false;
      leapAttack.phase = 'idle';
      leapAttack.elapsed = 0;
      heroActiveSlot = '';
      velocity.set(0,0,0);
      const surface = getBaseSurfaceHeightAt(hero.position.x, hero.position.z);
      hero.position.y = surface + GROUND_EPS;
    }
  });
}

function updateLeapAttack(dt) {
  if (!leapAttack.active) return;
  leapAttack.elapsed += dt;

  if (leapAttack.phase === 'windup') {
    hero.position.copy(leapAttack.start);
    velocity.set(0,0,0);
    if (leapAttack.elapsed >= leapAttack.windup) {
      leapAttack.phase = 'travel';
      leapAttack.elapsed = 0;
    }
    return;
  }

  if (leapAttack.phase === 'travel') {
    const t = THREE.MathUtils.clamp(leapAttack.elapsed / leapAttack.travel, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    hero.position.lerpVectors(leapAttack.start, leapAttack.end, smooth);
    hero.position.y += Math.sin(Math.PI * t) * leapAttack.arcHeight;
    // Keep a meaningful velocity for camera/animation-facing logic without
    // letting the normal locomotion integrator take control.
    velocity.copy(leapAttack.direction).multiplyScalar(leapAttack.start.distanceTo(leapAttack.end) / Math.max(.1, leapAttack.travel));
    velocity.y = Math.cos(Math.PI * t) * Math.PI * leapAttack.arcHeight / Math.max(.1, leapAttack.travel);
    if (t >= 1) beginLeapLanding();
    return;
  }

  // Recovery is animation-driven; keep the physical root glued to the ground.
  if (leapAttack.phase === 'recover') {
    const surface = getBaseSurfaceHeightAt(hero.position.x, hero.position.z);
    hero.position.y = surface + GROUND_EPS;
    velocity.set(0,0,0);
  }
}

function getBaseSurfaceHeightAt(x, z) {
  let surface = WORLD_GROUND_Y;
  const road = roadSurfaceAt(x, z);
  if (road != null) surface = Math.max(surface, road);
  const cell = surfaceGrid.get(getGridKey(x, z));
  if (cell) {
    for (const region of cell) {
      if (x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ) {
        surface = Math.max(surface, region.y);
        break;
      }
    }
  }
  return surface;
}

function getSurfaceHeightAt(x, z) {
  let surface = getBaseSurfaceHeightAt(x, z);
  const cell = colliderGrid.get(getGridKey(x, z));
  if (cell) {
    for (const box of cell) {
      if (x > box.min.x + .45 && x < box.max.x - .45 &&
          z > box.min.z + .45 && z < box.max.z - .45) {
        surface = Math.max(surface, box.max.y);
      }
    }
  }
  return surface;
}

function clipDuration(candidates, timeScale=1, fallback=.9, slotName='') {
  const cfg = slotName ? heroSlot(slotName, {clip:candidates[0],speed:timeScale}) : null;
  const clip = findClip([cfg?.clip, ...candidates].filter(Boolean));
  const speed = cfg?.speed ?? timeScale;
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) return fallback;
  return THREE.MathUtils.clamp(clip.duration / Math.max(.01, speed), .5, 2.2);
}

function startTakeoff() {
  if (iceBreathController.active) forceStopIceBreath();
  if (actionLocked) return;
  const duration = clipDuration(['C003_Flying_Intro', 'C003_Jump_01'], 1.05, .95, 'takeoff');
  if (!flightMachine.requestTakeoff(duration)) return;

  const surface = getSurfaceHeightAt(hero.position.x, hero.position.z);
  hero.position.y = Math.max(hero.position.y, surface + GROUND_EPS);
  transitionStartY = hero.position.y;
  transitionTargetY = surface + TAKEOFF_CLEARANCE;
  bursts.dust({ x: hero.position.x, y: surface + .05, z: hero.position.z }, { count: 20, radius: 2.6, power: .8 });
  velocity.set(0, 0, 0);

  playOneShot(['C003_Flying_Intro', 'C003_Jump_01'], 'DECOLAGEM!', 1.05, null, 'takeoff');
}

function requestLanding() {
  if (iceBreathController.active) forceStopIceBreath();
  if (flightMachine.requestLanding()) {
    showMessage('PARANDO VOO · POUSO AUTOMÁTICO', 700);
  }
}

function startLandingSequence(surfaceY) {
  if (iceBreathController.active) forceStopIceBreath();
  if (heatVisionActive) stopHeatVision(false);
  const duration = clipDuration(['C003_Land'], 1.0, .8, 'land');
  if (!flightMachine.touchdown(duration)) return;

  landingSurfaceY = surfaceY;
  landingDuration = duration;
  landingTouchedDown = false;
  // C003_Land switches from the airborne pose to the impact crouch after
  // ~0.075 s of clip time; the root must reach the surface right then.
  const landSpeed = heroSlot('land', { speed:1 }).speed || 1;
  landingTouchdownTime = Math.min(duration * .3, LAND_CLIP_TOUCHDOWN / landSpeed);
  transitionStartY = hero.position.y;
  transitionTargetY = surfaceY + GROUND_EPS;
  velocity.set(0, 0, 0);

  // Landing always wins over a pending one-shot (laser intro, flight stop...).
  if (actionLocked) cancelCurrentOneShot();
  heatVisionAnimPhase = 'idle';
  playOneShot(['C003_Land'], '', 1.0, null, 'land');
}

function landingImpact() {
  landingTouchedDown = true;
  cameraShake = Math.max(cameraShake, .22);
  const fx = getImpactEffect('leap');
  fx.object.rotation.set(-Math.PI / 2, 0, 0);
  fx.object.position.set(hero.position.x, landingSurfaceY + .08, hero.position.z);
  impactEffects.push({ object:fx.object, life:.32, maxLife:.32, poolItem:fx, scale:.45 });
  bursts.dust({ x: hero.position.x, y: landingSurfaceY + .05, z: hero.position.z }, { count: 18, radius: 2.4, power: .75 });
}

function toggleFlight() {
  if (spaceState.active) {
    showMessage('EM ÓRBITA · mire para a Terra e voe para voltar', 900);
    return;
  }
  if (flightMachine.state === 'grounded') startTakeoff();
  else if (flightMachine.state === 'flying') requestLanding();
  else if (flightMachine.state === 'landingApproach') {
    if (flightMachine.cancelLanding()) {
      showMessage('VOO RETOMADO', 450);
    }
  }
}

function resetGame() {
  stopReentryAudio();
  iceBreathController.reset();
  dynamicEventSystem.reset();
  fireSystem.reset();
  emergencyPresentation.reset();
  recentBuildingFireIds.clear();
  iceBreathAction = null;
  reentryState.active = false;
  reentryState.elapsed = 0;
  reentryState.cityPhase = false;
  reentryState.intensity = 0;
  reentryFx.visible = false;
  reentryStreaks.visible = false;
  reentryOverlay.style.opacity = '0';
  spaceState.active = false;
  spaceState.blend = 0;
  scene.fog = worldFog;
  scene.background = DAY_BACKGROUND.clone();
  setCityVisibility(true);
  hero.position.set(0, getSurfaceHeightAt(0, 130) + GROUND_EPS, 130);
  hero.rotation.set(0, 0, 0);
  velocity.set(0,0,0); score=0;
  flightMachine.forceGrounded();
  superPunchImpactTimer = -1;
  normalPunchImpactTimer = -1;
  cameraShake = 0;
  bursts.clear();
  boostCharge = 0; wasSupersonic = false; sonicBoomCooldown = 0;
  heatVisionHeat = 0; heatVisionOverheated = false; stopHeatVision(false);
  heatVisionAnimPhase = 'idle'; heatVisionAnimSource = 'air'; airStopState = 'moving';
  leapAttack.active = false; leapAttack.phase = 'idle'; leapAttack.elapsed = 0; leapAttack.impacted = false;
  actionLocked = false;
  heroEventQueue = [];
  playerHealth = playerMaxHealth;
  playerInvuln = 0;
  playerDead = false;
  playerHurtCooldown = 0;
  heroHurtKick = 0;
  heroDeathFall = 0;
  heroVisual.rotation.set(0, 0, 0);
  dodge.active = false;
  dodge.cooldown = 0;
  bufferedAttack = '';
  hitStopTimer = 0;
  landingTouchedDown = false;
  applyEnemyLevel(1);
  resetEnemy();
  updateCombatHUD();

  if (mixer) {
    mixer.stopAllAction();
    for (const listener of activeListeners) mixer.removeEventListener('finished', listener);
    activeListeners.clear();
  }
  currentAction = null;
  currentOnceAction = null; currentOnceListener = null;
  currentAnimName = '';

  for (const ring of rings) { ring.userData.collected=false; ring.visible=true; ring.scale.setScalar(1); }
  document.querySelector('#score').textContent = 0;
  showMessage('Missão reiniciada', 850);
}

let msgTimer;
function showMessage(text, ms=900) {
  const el = document.querySelector('#message');
  el.textContent = text; el.classList.add('show');
  clearTimeout(msgTimer); msgTimer = setTimeout(()=>el.classList.remove('show'), ms);
}

function triggerSuperPunchImpact(applyEnemyDamage=true) {
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(hero.quaternion).normalize();
  const origin = hero.position.clone().add(new THREE.Vector3(0, 1.15, 0)).addScaledVector(dir, 1.45);
  tryInterceptActiveMeteor('superPunch', origin, 8.0, velocity.length());

  const fx = getImpactEffect('punch');
  const wave = fx.object;
  wave.position.copy(origin);
  wave.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  impactEffects.push({ object: wave, life: .42, maxLife: .42, poolItem: fx });
  bursts.sparks(origin, { count: 24, power: 1.2, dir, cone: .9 });

  const pushActors = [...trafficActors, ...npcActors];
  for (const actor of pushActors) {
    const delta = actor.object.position.clone().sub(origin);
    const distance = delta.length();
    if (distance < .01 || distance > 15) continue;
    const n = delta.clone().normalize();
    if (n.dot(dir) < -.15) continue;
    const strength = (1 - distance / 15) * 9.5;
    actor.object.position.addScaledVector(n, strength);
  }

  if (applyEnemyDamage && enemyAlive) {
    const enemyCenter = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const delta = enemyCenter.sub(origin);
    const distance = delta.length();
    if (distance <= 8.0 && distance > .01 && delta.normalize().dot(dir) > -.05 && Math.abs(hero.position.y - enemyRoot.position.y) < 4.0) {
      damageEnemy(48, origin, 5.5, 'SUPER SOCO');
    }
  }

  cameraShake = Math.max(cameraShake, .62);
}


const fxPool = [];
function getImpactEffect(type) {
  let fx = fxPool.find(f => f.type === type && !f.active);
  if (!fx) {
    const wave = new THREE.Mesh(
      type === 'leap' ? new THREE.RingGeometry(.35, .95, 48) : new THREE.RingGeometry(.28, .72, 40),
      new THREE.MeshBasicMaterial({
        color: type === 'leap' ? 0xffdf9b : 0xfff1b8,
        transparent: true, opacity: type === 'leap' ? .9 : .95,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    scene.add(wave);
    fx = { type, active: true, object: wave };
    fxPool.push(fx);
  } else {
    fx.active = true;
    fx.object.visible = true;
  }
  return fx;
}

function updateImpactEffects(dt) {
  for (let i = impactEffects.length - 1; i >= 0; i--) {
    const fx = impactEffects[i];
    fx.life -= dt;
    const t = 1 - Math.max(0, fx.life) / fx.maxLife;
    fx.object.scale.setScalar((1 + t * 8.5) * (fx.scale ?? 1));
    fx.object.material.opacity = Math.max(0, 1 - t);
    if (fx.life <= 0) {
      if (fx.poolItem) {
        fx.object.visible = false;
        fx.poolItem.active = false;
      } else {
        scene.remove(fx.object);
        fx.object.geometry.dispose();
        fx.object.material.dispose();
      }
      impactEffects.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// SUPERSONIC FLIGHT V10
// ---------------------------------------------------------------------------
const speedLineCount = 72;
const speedLinePositions = new Float32Array(speedLineCount * 2 * 3);
const speedLineSeeds = Array.from({length:speedLineCount}, (_,i) => ({
  angle: rng() * Math.PI * 2,
  radius: 2.5 + rng() * 12,
  depth: -28 + rng() * 58,
  phase: rng()
}));
const speedLineGeo = new THREE.BufferGeometry();
speedLineGeo.setAttribute('position', new THREE.BufferAttribute(speedLinePositions, 3));
const speedLineMat = new THREE.LineBasicMaterial({ color:0xe7f6ff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false });
const speedLines = new THREE.LineSegments(speedLineGeo, speedLineMat);
speedLines.frustumCulled = false;
scene.add(speedLines);

const sonicEffects = [];
const contrailPoint = new THREE.Vector3();
let contrailClock = 0;
function spawnSonicBoom(dir) {
  sonicBoomCooldown = 1.4;
  cameraShake = Math.max(cameraShake, .42);
  showMessage('BOOM SÔNICO · MACH 1', 900);
  document.body.classList.add('sonic-boom-flash');
  setTimeout(() => document.body.classList.remove('sonic-boom-flash'), 160);
  playSonicBoomSound();

  for (let i=0;i<2;i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.2 + i*.7, .07, 7, 42),
      new THREE.MeshBasicMaterial({ color:0xe9fbff, transparent:true, opacity:.72 - i*.16, blending:THREE.AdditiveBlending, depthWrite:false })
    );
    ring.position.copy(hero.position).addScaledVector(dir, -1.4 - i*.9);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), dir.clone().normalize());
    scene.add(ring);
    sonicEffects.push({ object:ring, life:.55 + i*.12, maxLife:.55 + i*.12, base:1 + i*.12 });
  }
}

function playSonicBoomSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    window.__skyAudioCtx ||= new AudioCtx();
    const ctx = window.__skyAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.38, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .48);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(78, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + .42);
    osc.connect(gain);
    osc.start(now); osc.stop(now + .5);

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .24), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * (1-i/data.length);
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 700;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(.16, now); ng.gain.exponentialRampToValueAtTime(.0001, now+.24);
    noise.connect(filter).connect(ng).connect(ctx.destination); noise.start(now);
  } catch (err) { /* audio is optional */ }
}

function updateSupersonicEffects(dt, time, speed, boosting) {
  sonicBoomCooldown = Math.max(0, sonicBoomCooldown - dt);
  const mach = speed / MACH_ONE;
  const supersonic = flightMachine.state === 'flying' && mach >= 1;
  if (supersonic && !wasSupersonic && sonicBoomCooldown <= 0) spawnSonicBoom(flightForward);
  wasSupersonic = supersonic;

  contrailClock -= dt;
  if (flightMachine.state === 'flying' && speed > 150 && contrailClock <= 0) {
    contrailClock = supersonic ? .016 : .04;
    contrailPoint.copy(hero.position).addScaledVector(flightForward, -1.15);
    contrailPoint.y += 1.0;
    bursts.contrail(contrailPoint, { size: supersonic ? 1.5 : .9, alpha: supersonic ? .42 : .28 });
  }

  const visibility = flightMachine.state === 'flying' ? THREE.MathUtils.smoothstep(speed, 85, MACH_ONE) : 0;
  speedLineMat.opacity = visibility * (supersonic ? .82 : .42);
  if (visibility > .001) {
    const dir = flightForward.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, up);
    if (side.lengthSq() < .001) side.set(1,0,0); else side.normalize();
    const vertical = new THREE.Vector3().crossVectors(side, dir).normalize();
    const length = 1.4 + Math.min(11, speed / 36);
    for (let i=0;i<speedLineCount;i++) {
      const seed = speedLineSeeds[i];
      const flow = ((time * (18 + speed*.07) + seed.phase*40) % 58) - 29;
      const center = hero.position.clone()
        .addScaledVector(dir, flow)
        .addScaledVector(side, Math.cos(seed.angle)*seed.radius)
        .addScaledVector(vertical, Math.sin(seed.angle)*seed.radius);
      const a = center.clone().addScaledVector(dir, length*.5);
      const b = center.clone().addScaledVector(dir, -length*.5);
      const o=i*6;
      speedLinePositions[o]=a.x; speedLinePositions[o+1]=a.y; speedLinePositions[o+2]=a.z;
      speedLinePositions[o+3]=b.x; speedLinePositions[o+4]=b.y; speedLinePositions[o+5]=b.z;
    }
    speedLineGeo.attributes.position.needsUpdate = true;
  }

  for (let i=sonicEffects.length-1;i>=0;i--) {
    const fx=sonicEffects[i]; fx.life-=dt;
    const t=1-Math.max(0,fx.life)/fx.maxLife;
    fx.object.scale.setScalar(fx.base + t*8.5);
    fx.object.material.opacity=Math.max(0,(1-t)*.72);
    if (fx.life<=0) { scene.remove(fx.object); fx.object.geometry.dispose(); fx.object.material.dispose(); sonicEffects.splice(i,1); }
  }

  const machEl=document.querySelector('#mach');
  if (machEl) {
    if (flightMachine.state !== 'flying') machEl.textContent='Mach: —';
    else machEl.textContent=`Mach: ${mach.toFixed(2)}${supersonic ? ' · SUPERSÔNICO' : boosting ? ' · ACELERANDO' : ''}`;
  }
  document.body.classList.toggle('supersonic-active', supersonic);
}

function resolveHeroBuildingCollision(previousPosition) {
  // Swept collision prevents tunnelling through buildings at Mach 1+.
  const from = previousPosition.clone().add(new THREE.Vector3(0,1,0));
  const to = hero.position.clone().add(new THREE.Vector3(0,1,0));
  const delta = to.clone().sub(from);
  const travel = delta.length();
  if (travel < .0001) return;
  const ray = new THREE.Ray(from, delta.clone().normalize());
  let nearest = null;
  const hit = new THREE.Vector3();
  for (const box of collidersAlong(from, to, 1.5)) {
    const expanded = box.clone().expandByVector(new THREE.Vector3(.45,.2,.45));
    const point = ray.intersectBox(expanded, hit);
    if (!point) continue;
    const d = point.distanceTo(from);
    if (d <= travel + .05 && (!nearest || d < nearest.distance)) nearest = { distance:d, point:point.clone() };
  }
  if (!nearest) return;
  const impactSpeed = velocity.length();
  const safe = from.clone().addScaledVector(ray.direction, Math.max(0, nearest.distance-.28));
  hero.position.set(safe.x, safe.y-1, safe.z);
  velocity.multiplyScalar(impactSpeed > MACH_ONE ? .16 : .22);
  cameraShake = Math.max(cameraShake, impactSpeed > MACH_ONE ? .75 : .32);
  if (impactSpeed > 90) {
    const fast = impactSpeed > MACH_ONE;
    bursts.debris(nearest.point, { count: fast ? 34 : 14, power: fast ? 1.5 : 1 });
    bursts.dust(nearest.point, { count: fast ? 34 : 16, radius: fast ? 4.5 : 3, power: 1, tint: [.62, .62, .64] });
    bursts.sparks(nearest.point, { count: fast ? 30 : 12, power: 1.1 });
  }
  if (impactSpeed > 120) showMessage(impactSpeed > MACH_ONE ? 'IMPACTO SUPERSÔNICO' : 'IMPACTO', 520);
}

function updateHero(dt, time) {
  const boosted = keys.ShiftLeft || keys.ShiftRight;
  const boostingFlight = boosted && keys.KeyW && flightMachine.state === 'flying';
  const modeEl = document.querySelector('#mode');

  // V9 flight control: the reticle/camera pitch defines the full 3D forward
  // vector. Looking up/down therefore changes altitude naturally; there are no
  // dedicated ascend/descend keys anymore.
  getAimDirection(flightForward);
  forward.set(flightForward.x, 0, flightForward.z);
  if (forward.lengthSq() < .0001) forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  forward.normalize();
  right.crossVectors(forward, up).normalize();

  const stateEvent = flightMachine.update(dt);
  if (stateEvent === 'flyingStarted') {
    airStopState = 'moving';
    hero.position.y = Math.max(hero.position.y, transitionTargetY);
    velocity.copy(flightForward).multiplyScalar(2.4);
  } else if (stateEvent === 'grounded') {
    airStopState = 'moving';
    hero.position.y = transitionTargetY;
    velocity.set(0, 0, 0);
    boostCharge = 0;
    wasSupersonic = false;
    showMessage('VOO ENCERRADO', 650);
  }

  if (reentryState.active) {
    updateReentryMotion(dt, time);
    return;
  }

  if (spaceState.active) {
    flightMachine.state = 'flying';
    airStopState = 'moving';
    const orbitalBoost = boosted && keys.KeyW;
    const maxSpeed = orbitalBoost ? 280 : 120;
    const accel = orbitalBoost ? 145 : 62;
    const wish = new THREE.Vector3();
    if (keys.KeyW) wish.add(flightForward);
    if (keys.KeyS) wish.sub(flightForward);
    if (keys.KeyD) wish.add(right);
    if (keys.KeyA) wish.sub(right);
    if (wish.lengthSq() > 0) velocity.addScaledVector(wish.normalize(), accel * dt);
    const drag = orbitalBoost ? 0.08 : 0.24;
    velocity.multiplyScalar(Math.exp(-drag * dt));
    if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed);
    hero.position.addScaledVector(velocity, dt);

    const toHero = hero.position.clone().sub(spaceState.earthCenter);
    const distFromEarthCenter = toHero.length();
    const minDistance = ORBITAL_EARTH_RADIUS + SPACE_REENTRY_CLEARANCE;
    if (distFromEarthCenter < minDistance) hero.position.copy(spaceState.earthCenter).add(toHero.normalize().multiplyScalar(minDistance));
    if (distFromEarthCenter > ORBITAL_MAX_DISTANCE) hero.position.copy(spaceState.earthCenter).add(toHero.normalize().multiplyScalar(ORBITAL_MAX_DISTANCE));

    const toEarth = spaceState.earthCenter.clone().sub(hero.position);
    const surfaceClearance = toEarth.length() - ORBITAL_EARTH_RADIUS;
    if (keys.KeyW && surfaceClearance <= SPACE_REENTRY_CLEARANCE + 6 && flightForward.dot(toEarth.normalize()) > 0.45) {
      exitSpaceMode();
    }

    const orbitalBank = (keys.KeyD ? -.18 : 0) + (keys.KeyA ? .18 : 0);
    orientHeroToAim(dt, flightForward, orbitalBank, 12);

    updateAnimation(velocity.length(), orbitalBoost);

    const kmh = velocity.length() * 3.6;
    if (modeEl) modeEl.textContent = `Modo: ÓRBITA BAIXA · voe em direção à Terra para voltar`;
    document.querySelector('#speed').textContent = `Velocidade: ${Math.round(kmh)} km/h${velocity.length() >= MACH_ONE ? ' — SUPERSÔNICO' : orbitalBoost ? ' — IMPULSO ORBITAL' : ''}`;
    updateSupersonicEffects(dt, time, velocity.length(), orbitalBoost);
    return;
  }

  // Leap attack owns the world-space root until its landing recovery finishes.
  // Normal ground/flight physics are intentionally suspended during the move.
  if (leapAttack.active) {
    updateLeapAttack(dt);
  // Native takeoff/landing clips drive the visual while world-space movement
  // moves the character cleanly between ground and flight states.
  } else if (flightMachine.state === 'landing') {
    // Accelerate into the surface during the clip's short airborne lead-in,
    // then stay planted while C003_Land plays the impact crouch.
    const elapsed = flightMachine.progress * landingDuration;
    const t = THREE.MathUtils.clamp(elapsed / Math.max(.001, landingTouchdownTime), 0, 1);
    hero.position.y = THREE.MathUtils.lerp(transitionStartY, transitionTargetY, t * t);
    if (t >= 1 && !landingTouchedDown) landingImpact();
    velocity.set(0, 0, 0);
  } else if (flightMachine.busy) {
    const t = flightMachine.progress;
    const smooth = t * t * (3 - 2 * t);
    hero.position.y = THREE.MathUtils.lerp(transitionStartY, transitionTargetY, smooth);
    velocity.set(0, 0, 0);
  } else if (flightMachine.state === 'grounded') {
    const wish = new THREE.Vector3();
    if (keys.KeyW) wish.add(forward);
    if (keys.KeyS) wish.sub(forward);
    if (keys.KeyD) wish.add(right);
    if (keys.KeyA) wish.sub(right);
    wish.y = 0;

    const accel = boosted ? 35 : 25;
    const maxSpeed = boosted ? 14 : 8.5;
    if (dodge.active) {
      // The dash owns the horizontal velocity for its short duration.
      velocity.set(dodge.direction.x, 0, dodge.direction.z).multiplyScalar(DODGE_GROUND_SPEED);
    } else {
      if (wish.lengthSq() > 0) {
        wish.normalize();
        velocity.addScaledVector(wish, accel * dt);
      }
      velocity.y = 0;
      velocity.multiplyScalar(Math.exp(-5.0 * dt));
      if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed);
    }

    const previousPosition = hero.position.clone();
    hero.position.addScaledVector(velocity, dt);
    resolveHeroBuildingCollision(previousPosition);

    const surface = getSurfaceHeightAt(hero.position.x, hero.position.z);
    const currentFootY = hero.position.y - GROUND_EPS;
    if (currentFootY - surface > 1.25) {
      // Walking off a roof automatically catches the character in flight.
      flightMachine.state = 'flying';
      velocity.y = -1.5;
      showMessage('VOO ATIVO', 450);
    } else {
      hero.position.y = surface + GROUND_EPS;
    }
  } else {
    const landing = flightMachine.state === 'landingApproach';
    if (boostingFlight) boostCharge = Math.min(1, boostCharge + dt / 1.35);
    else boostCharge = Math.max(0, boostCharge - dt * 1.65);
    const boostCurve = boostCharge * boostCharge * (3 - 2 * boostCharge);
    const maxSpeed = boostingFlight ? THREE.MathUtils.lerp(120, SUPERSONIC_MAX_SPEED, boostCurve) : NORMAL_FLIGHT_SPEED;
    const accel = boostingFlight ? THREE.MathUtils.lerp(105, 285, boostCurve) : 58;
    const wish = new THREE.Vector3();

    if (!landing) {
      // W/S move exactly along/opposite the reticle, including its Y component.
      // Shift+W progressively opens the speed envelope up to Mach 1+ rather
      // than instantly teleporting the velocity to a boost value.
      if (keys.KeyW) wish.add(flightForward);
      if (keys.KeyS) wish.sub(flightForward);
      if (keys.KeyD) wish.add(right);
      if (keys.KeyA) wish.sub(right);
      if (wish.lengthSq() > 0) {
        wish.normalize();
        const speedNow = velocity.length();
        const steeringScale = speedNow > MACH_ONE ? .34 : speedNow > 180 ? .58 : 1;
        velocity.addScaledVector(wish, accel * steeringScale * dt);
        // At extreme speed the nose still follows the reticle, but with inertia.
        if (boostingFlight && speedNow > 110) {
          const desired = flightForward.clone().multiplyScalar(Math.max(speedNow, 1));
          velocity.lerp(desired, 1 - Math.exp(-(speedNow > MACH_ONE ? 1.1 : 2.0) * dt));
        }
      }
      const drag = boostingFlight ? .18 : velocity.length() > NORMAL_FLIGHT_SPEED ? 1.05 : 1.7;
      velocity.multiplyScalar(Math.exp(-drag * dt));
      if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed);
    } else {
      // F stops flight: horizontal momentum bleeds off and the hero descends
      // automatically toward whichever walkable surface is directly below.
      const surface = getSurfaceHeightAt(hero.position.x, hero.position.z);
      const clearance = Math.max(0, hero.position.y - surface);
      const descentSpeed = THREE.MathUtils.clamp(7 + clearance * .12, 8, 28);
      velocity.x *= Math.exp(-3.4 * dt);
      velocity.z *= Math.exp(-3.4 * dt);
      velocity.y = THREE.MathUtils.lerp(velocity.y, -descentSpeed, 1 - Math.exp(-4.5 * dt));
    }

    const previousPosition = hero.position.clone();
    hero.position.addScaledVector(velocity, dt);
    trySupersonicMeteorSweep(previousPosition, hero.position, velocity.length());
    resolveHeroBuildingCollision(previousPosition);

    const surface = getSurfaceHeightAt(hero.position.x, hero.position.z);
    const clearance = hero.position.y - surface;
    // Start C003_Land roughly one touchdown-time above the surface so the
    // impact crouch happens on the ground instead of in mid-air.
    if (landing && clearance <= Math.max(.5, -velocity.y * .1)) {
      startLandingSequence(surface);
    } else if (hero.position.y <= surface + GROUND_EPS) {
      hero.position.y = surface + GROUND_EPS;
      startLandingSequence(surface);
    }
  }

  const beforeClampX = hero.position.x, beforeClampZ = hero.position.z;
  hero.position.x = THREE.MathUtils.clamp(hero.position.x, -WORLD_LIMIT, WORLD_LIMIT);
  hero.position.z = THREE.MathUtils.clamp(hero.position.z, -WORLD_LIMIT, WORLD_LIMIT);
  if (hero.position.x !== beforeClampX) velocity.x *= .12;
  if (hero.position.z !== beforeClampZ) velocity.z *= .12;
  hero.position.y = THREE.MathUtils.clamp(hero.position.y, GROUND_EPS, 8200);

  if (flightMachine.state === 'flying') {
    // V15.1: the character's actual local +Z axis follows the reticle vector,
    // including steep vertical aim. Bank is applied around that forward axis,
    // so A/D can lean the body without changing where Superman is facing.
    const bank = (keys.KeyD ? -.20 : 0) + (keys.KeyA ? .20 : 0);
    orientHeroToAim(dt, flightForward, bank, 12);
  } else if (flightMachine.state === 'landingApproach' || flightMachine.state === 'landing') {
    // Descend upright, facing the horizontal aim, ready for the landing clip.
    orientHeroToAim(dt, forward, 0, 9);
  } else {
    const horizontal = new THREE.Vector3(velocity.x, 0, velocity.z);
    // A back/side dodge keeps Superman facing his opponent.
    if (horizontal.lengthSq() > .25 && !(dodge.active && (dodge.backward || dodge.side))) {
      const targetYaw = Math.atan2(horizontal.x, horizontal.z);
      hero.rotation.y = lerpAngle(hero.rotation.y, targetYaw, 1 - Math.exp(-7 * dt));
    }
    hero.rotation.z = THREE.MathUtils.lerp(hero.rotation.z, 0, 1 - Math.exp(-8 * dt));
    hero.rotation.x = THREE.MathUtils.lerp(hero.rotation.x, 0, 1 - Math.exp(-8 * dt));
  }

  updateAnimation(velocity.length(), boosted);

  for (const ring of rings) {
    if (ring.userData.collected) continue;
    ring.rotation.z += dt * 1.3; ring.rotation.y += dt * .35;
    ring.scale.setScalar(1 + Math.sin(time * 4 + ring.position.x) * .05);
    if (hero.position.distanceTo(ring.position) < 7.5) {
      ring.userData.collected = true; ring.visible = false; score++;
      document.querySelector('#score').textContent = score;
      showMessage(score === rings.length ? 'MISSÃO COMPLETA!' : `Anel ${score}/${rings.length}`, score === rings.length ? 2200 : 700);
    }
  }

  const modeLabel = spaceState.active ? 'ÓRBITA BAIXA' : {
    grounded: 'NO SOLO',
    takingOff: 'INICIANDO VOO',
    flying: 'VOO ATIVO · MIRA 3D',
    landingApproach: 'ENCERRANDO VOO',
    landing: 'POUSANDO'
  }[flightMachine.state] || 'VOO';
  if (modeEl) modeEl.textContent = `Modo: ${modeLabel}`;
  const kmh = velocity.length() * 3.6;
  document.querySelector('#speed').textContent = `Velocidade: ${Math.round(kmh)} km/h${velocity.length() >= MACH_ONE && flightMachine.state === 'flying' ? ' — SUPERSÔNICO' : boostingFlight ? ' — SUPERACELERAÇÃO' : ''}`;
  updateSupersonicEffects(dt, time, velocity.length(), boostingFlight);

  if (!spaceState.active && flightMachine.state === 'flying' && hero.position.y >= SPACE_ENTRY_ALTITUDE && flightForward.y > 0.42) enterSpaceMode();
}

function updateCamera(dt) {
  // The center reticle is now a real flight direction. The camera looks far
  // ahead along the same yaw/pitch vector used by movement, while remaining a
  // comfortable third-person distance behind Superman.
  const aim = reentryState.active && velocity.lengthSq() > .01 ? temp.copy(velocity).normalize() : getAimDirection(temp);
  const target = hero.position.clone().add(new THREE.Vector3(0, 1.08, 0));
  const speed = velocity.length();
  const mach = speed / MACH_ONE;
  const flightBoost = flightMachine.state === 'flying' && (keys.ShiftLeft || keys.ShiftRight) && keys.KeyW;
  const dist = reentryState.active ? THREE.MathUtils.lerp(11.5, 16.5, reentryState.intensity) : (flightBoost ? THREE.MathUtils.lerp(10.5, 17.5, THREE.MathUtils.clamp(mach, 0, 1.25)) : 7.8);
  cameraBack.copy(aim);
  cameraBack.y *= .34; // keep the camera usable at very steep climb/dive angles
  if (cameraBack.lengthSq() < .001) cameraBack.set(0,0,1);
  cameraBack.normalize();

  const cameraRight = new THREE.Vector3().crossVectors(aim, up);
  if (cameraRight.lengthSq() < .001) cameraRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
  cameraRight.normalize();
  let desired = target.clone()
    .addScaledVector(cameraBack, -dist)
    .addScaledVector(up, flightMachine.state === 'grounded' ? 1.7 : 1.35)
    .addScaledVector(cameraRight, .32);

  const rayVector = desired.clone().sub(target);
  const wantedDistance = rayVector.length();
  if (!spaceState.active && wantedDistance > .001 && buildingColliders.length) {
    const ray = new THREE.Ray(target, rayVector.clone().normalize());
    let nearest = wantedDistance;
    const hit = new THREE.Vector3();
    for (const box of collidersAlong(target, desired, 1)) {
      const point = ray.intersectBox(box, hit);
      if (!point) continue;
      const d = point.distanceTo(target);
      if (d > .25 && d < nearest) nearest = d;
    }
    if (nearest < wantedDistance) {
      desired = target.clone().add(ray.direction.clone().multiplyScalar(Math.max(.8, nearest - .5)));
    }
  }

  if (!spaceState.active) desired.y = Math.max(desired.y, .55);
  camera.position.lerp(desired, 1 - Math.exp(-10 * dt));
  if (cameraShake > .001) {
    camera.position.x += (Math.random() - .5) * cameraShake;
    camera.position.y += (Math.random() - .5) * cameraShake * .65;
    camera.position.z += (Math.random() - .5) * cameraShake;
    cameraShake *= Math.exp(-10 * dt);
  }

  const lookPoint = target.clone().addScaledVector(aim, 42);
  camera.lookAt(lookPoint);
  const targetFov = reentryState.active
    ? THREE.MathUtils.lerp(82, 104, reentryState.intensity)
    : flightMachine.state === 'flying'
      ? THREE.MathUtils.lerp(66, 96, THREE.MathUtils.smoothstep(speed, 90, SUPERSONIC_MAX_SPEED))
      : 62;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-5 * dt));
  camera.updateProjectionMatrix();
}

function updateCharacterGrounding(dt) {
  if (spaceState.active || reentryState.active) return;
  if (heroGroundRig) {
    const surface = flightMachine.state === 'landing' ? landingSurfaceY : getSurfaceHeightAt(hero.position.x, hero.position.z);
    updateFootGrounding(heroGroundRig, surface + GROUND_EPS, dt, heroFootLockWeight());
  }
  if (enemyGroundRig && enemyReady) {
    const surface = getSurfaceHeightAt(enemyRoot.position.x, enemyRoot.position.z);
    updateFootGrounding(enemyGroundRig, surface + GROUND_EPS, dt, enemyAlive ? 1 : 0);
  }
}

// How strongly Superman's feet are pinned to the surface below him.
function heroFootLockWeight() {
  if (playerDead) return 0;
  if (leapAttack.active) return leapAttack.phase === 'travel' ? 0 : 1;
  if (flightMachine.state === 'grounded') return 1;
  // Take-off: the feet push off the ground before the body lifts away.
  if (flightMachine.state === 'takingOff') return 1 - THREE.MathUtils.smoothstep(flightMachine.progress, .08, .45);
  if (flightMachine.state === 'landing') return landingTouchedDown ? 1 : 0;
  return 0;
}

// Sky, sun shadow, ambient life, particles and post-processing state. Runs after
// the camera so everything that follows it uses the final camera position.
function updateAtmosphere(dt, time) {
  updateSunShadow();
  shadowClock += dt;
  if (shadowClock >= shadowInterval) {
    shadowClock = 0;
    renderer.shadowMap.needsUpdate = true;
  }
  skyDome.follow(camera);
  cloudLayer.update(dt);
  birds.update(dt, time);
  bursts.update(dt, camera, renderer.domElement.height);
  const speed = velocity.length();
  const flying = flightMachine.state === 'flying';
  const reentryHeat = reentryState.active ? reentryState.intensity : 0;
  postFx.setState({
    speed01: Math.max(flying ? THREE.MathUtils.smoothstep(speed, 110, SUPERSONIC_MAX_SPEED) : 0, reentryHeat),
    impact01: THREE.MathUtils.clamp(cameraShake, 0, 1),
    heat01: reentryHeat
  }, dt);
}

const MAX_PIXEL_RATIO = PROFILE.maxPixelRatio;
const adaptiveResolution = new URLSearchParams(location.search).get('adaptive') === 'off'
  ? null
  : new AdaptiveResolution({ min: PROFILE.minPixelRatio, max: MAX_PIXEL_RATIO, ratio: PROFILE.startPixelRatio, targetMs: PROFILE.targetMs });
let lastFrameStamp = 0;
let degradeLevel = 0;

// Last resort once resolution scaling bottoms out: drop bloom, then refresh
// the shadow map less often.
function degradeQuality() {
  if (!adaptiveResolution || degradeLevel >= 2) return;
  const wanted = adaptiveResolution.floorHits >= 5 ? 2 : adaptiveResolution.floorHits >= 2 ? 1 : 0;
  if (wanted <= degradeLevel) return;
  degradeLevel = wanted;
  if (degradeLevel >= 1) postFx.setBloom(false);
  if (degradeLevel >= 2) shadowInterval = 1 / 15;
  console.info(`[perf] qualidade reduzida (nível ${degradeLevel})`);
}

function applyPixelRatio(ratio) {
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight);
  postFx.setSize(innerWidth, innerHeight, ratio);
}

function animate(timestamp) {
  if (adaptiveResolution && lastFrameStamp && !document.hidden) {
    const ratio = adaptiveResolution.sample(timestamp - lastFrameStamp);
    if (ratio !== null) applyPixelRatio(ratio);
    degradeQuality();
  }
  lastFrameStamp = timestamp;
  timer.update(timestamp);
  // Never step backwards: a negative delta would destabilise every damped lerp.
  const dt = THREE.MathUtils.clamp(timer.getDelta(), 0, .033);
  const time = timer.getElapsed();
  playerInvuln = Math.max(0, playerInvuln - dt);
  // Hitstop slows only the character animation clocks (and their timed hit
  // events) so impacts read clearly while camera and physics stay responsive.
  const animDt = hitStopTimer > 0 ? dt * .08 : dt;
  hitStopTimer = Math.max(0, hitStopTimer - dt);
  updateDodge(dt);
  updateBufferedAttack(dt);
  updateHero(dt,time);
  updateEnemy(dt,time);
  updateCityLife(dt,time);
  updatePlayerRegen(dt);
  updateHeroReactions(dt);
  // Mixers must run before foot-lock: bone world positions only represent the
  // current animation pose after mixer.update. Ground correction then affects
  // combat/laser bone queries in the same rendered frame.
  if (mixer) mixer.update(animDt);
  if (enemyMixer) enemyMixer.update(animDt);
  updateCharacterGrounding(dt);
  updateHeroEvents(animDt);
  updateEnemyEvents(animDt);
  updateHeatVision(dt);
  updateIceBreath(dt);
  if (normalPunchImpactTimer >= 0) {
    normalPunchImpactTimer -= dt;
    if (normalPunchImpactTimer <= 0) {
      normalPunchImpactTimer = -1;
      triggerNormalPunchImpact();
    }
  }
  if (superPunchImpactTimer >= 0) {
    superPunchImpactTimer -= dt;
    if (superPunchImpactTimer <= 0) {
      superPunchImpactTimer = -1;
      triggerSuperPunchImpact();
    }
  }
  updateDynamicEvents(dt, time);
  updateSpaceEnvironment(dt, time);
  updateCamera(dt);
  updateImpactEffects(dt);
  updateAtmosphere(dt, time);
  // Portrait phones show a "rotate" screen; don't spend GPU behind it.
  if (!(IS_TOUCH && innerHeight > innerWidth)) postFx.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  applyPixelRatio(adaptiveResolution ? adaptiveResolution.ratio : PROFILE.startPixelRatio);
});

function lerpAngle(a,b,t) {
  let d = (b-a+Math.PI)%(Math.PI*2)-Math.PI;
  if (d < -Math.PI) d += Math.PI*2;
  return a+d*t;
}
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}


function optimizeWorldInstancing() {
  const groups = new Map();
  world.updateMatrixWorld(true);

  const ignoreSet = new Set();
  function addIgnored(root) {
    if (!root) return;
    ignoreSet.add(root);
    if (root.children) {
      for (const child of root.children) addIgnored(child);
    }
  }
  for (const car of trafficActors) addIgnored(car.object);
  for (const npc of npcActors) addIgnored(npc.object);

  world.traverse(obj => {
    if (obj.isMesh && !obj.isInstancedMesh && !obj.isSkinnedMesh && !ignoreSet.has(obj)) {
      const matKeys = Array.isArray(obj.material) ? obj.material.map(m=>m.uuid).join() : obj.material.uuid;
      const chunk = chunkKey(obj.matrixWorld.elements[12], obj.matrixWorld.elements[14], INSTANCE_CHUNK);
      const key = obj.geometry.uuid + '_' + matKeys + '_' + obj.castShadow + '_' + obj.receiveShadow + '_' + chunk;
      let list = groups.get(key);
      if (!list) { list = []; groups.set(key, list); }
      list.push(obj);
    }
  });

  for (const [key, meshes] of groups.entries()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    const instanced = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    instanced.castShadow = first.castShadow;
    instanced.receiveShadow = first.receiveShadow;

    meshes.forEach((mesh, i) => {
      instanced.setMatrixAt(i, mesh.matrixWorld);
      mesh.parent.remove(mesh);
    });
    world.add(instanced);
  }
  // Everything left in the world except pedestrians never moves: stop the
  // renderer recomputing ~thousands of matrices every frame.
  world.traverse(obj => {
    if (obj === world || ignoreSet.has(obj)) return;
    obj.updateMatrix();
    obj.matrixAutoUpdate = false;
  });
  console.log('City Instancing: Converted ' + groups.size + ' unique meshes into InstancedMeshes.');
}

function triggerLeapAttackImpact() {
  const origin = hero.position.clone();
  const fx = getImpactEffect('leap');
  const wave = fx.object;
  wave.rotation.x = -Math.PI / 2;
  wave.position.copy(origin).add(new THREE.Vector3(0, .06, 0));
  impactEffects.push({ object:wave, life:.48, maxLife:.48, poolItem: fx });
  spawnGroundImpactFx(origin, 1.3);

  cameraShake = Math.max(cameraShake, .74);

  if (enemyAlive) {
    const enemyCenter = enemyRoot.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    const flat = enemyCenter.clone().sub(origin); flat.y = 0;
    if (flat.length() <= LEAP_IMPACT_RADIUS && Math.abs(enemyRoot.position.y - hero.position.y) < 3.2) {
      damageEnemy(LEAP_DAMAGE, origin, LEAP_KNOCKBACK, 'LEAP ATTACK');
    }
  }

  const pushActors = [...trafficActors, ...npcActors];
  for (const actor of pushActors) {
    const delta = actor.object.position.clone().sub(origin);
    const distance = delta.length();
    if (distance < .01 || distance > 22) continue;
    const strength = (1 - distance / 22) * 14;
    actor.object.position.addScaledVector(delta.normalize(), strength);
  }
}

// Optional debug handle for automated/browser inspection: open index.html?debug.
if (new URLSearchParams(location.search).has('debug')) {
  window.__sky = {
    THREE, hero, heroVisual, enemyRoot, camera, keys, velocity, timer, renderer, scene, postFx, bursts, skyDome, adaptiveResolution, applyPixelRatio, IS_TOUCH, PROFILE, lookBy,
    get mixer() { return mixer; },
    get enemyMixer() { return enemyMixer; },
    get importedHero() { return importedHero; },
    get importedEnemy() { return importedEnemy; },
    get state() {
      return {
        flight: flightMachine.state, anim: currentAnimName, locked: actionLocked, slot: heroActiveSlot,
        enemyAnim: enemyCurrentAnimName, enemyLocked: enemyActionLocked, enemyHealth, playerHealth,
        enemyLevel, enemyEnraged, enemyAlive, enemyRespawnTimer, poise: enemyPoise.value, warning: enemyAttackWarning.active,
        dodge: dodge.active, touchedDown: landingTouchedDown,
        heroY: hero.position.y, heroModelY: importedHero?.position.y
      };
    },
    activeWeights(which = 'hero') {
      const m = which === 'hero' ? mixer : enemyMixer;
      if (!m) return [];
      return m._actions.filter(a => a.isRunning() || a.getEffectiveWeight() > 0 || a.paused)
        .map(a => `${a.getClip().name}:${a.getEffectiveWeight().toFixed(2)}${a.paused ? '(paused)' : ''}${a.enabled ? '' : '(off)'}`);
    },
    setAim(y, p) { yaw = y; pitch = p; },
    // Renders the current frame from an arbitrary offset around a target root.
    view(dx = 4, dy = 1.2, dz = 0, target = hero) {
      const focus = target.position.clone().add(new THREE.Vector3(0, 1, 0));
      camera.position.copy(focus).add(new THREE.Vector3(dx, dy, dz));
      camera.lookAt(focus);
      postFx.render();
    },
    // Advances the real game loop by `ms` without scheduling another frame,
    // so inspection also works when the tab is hidden and rAF is throttled.
    tick(ms = 1000 / 60) {
      const raf = window.requestAnimationFrame;
      const visibility = timer._pageVisibilityHandler;
      window.requestAnimationFrame = () => 0;
      timer._pageVisibilityHandler = null; // hidden tabs would otherwise force dt = 0
      // Continue from the timer's last timestamp so dt is never negative.
      try { animate(timer._startTime + timer._currentTime + ms); }
      finally { window.requestAnimationFrame = raf; timer._pageVisibilityHandler = visibility; }
    },
    resetGame, damageEnemy, damagePlayer, enemyAttackWarning
  };
}
