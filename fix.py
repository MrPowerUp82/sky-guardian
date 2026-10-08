import json
import sys

# 1 & 2. Fix superman-animation-config.json
try:
    with open('config/superman-animation-config.json', 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    
    if 'events' not in cfg['slots']['heatVisionGround'] or len(cfg['slots']['heatVisionGround']['events']) == 0:
        cfg['slots']['heatVisionGround']['events'] = cfg['slots']['heatVision']['events'].copy()
    
    has_leap = any(e.get('type') == 'leapAttackAOE' for e in cfg['slots']['leapAttackLand'].get('events', []))
    if not has_leap:
        cfg['slots']['leapAttackLand']['events'].append({
            'id': 'leap-aoe-impact',
            'time': 0.05,
            'type': 'leapAttackAOE'
        })
        
    with open('config/superman-animation-config.json', 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
except Exception as e:
    print('Error patching JSON:', e)


# 3, 4, 5. Fix main.js
content = open('main.js', 'r', encoding='utf-8').read()

old_sanitize = '''function sanitizeEnemyClip(clip) {
  const c = clip.clone();
  // Keep the authored bone motion, but remove scene-root translation so AI
  // movement is controlled by gameplay rather than baked root motion.
  c.tracks = c.tracks.filter(track => !/^Root\.position$/i.test(track.name));
  return c;
}'''

new_sanitize = '''function sanitizeEnemyClip(clip) {
  const c = clip.clone();
  c.name = clip.name + '_NoRoot';
  c.tracks = c.tracks.filter(track => !/^Root\\\\.position$/i.test(track.name));
  return c;
}'''
content = content.replace(old_sanitize, new_sanitize)

old_enemy_clipmap = '''  enemyMixer = new THREE.AnimationMixer(importedEnemy);
  enemyClipMap = new Map(gltf.animations.map(c => {
    const clean = sanitizeEnemyClip(c);
    return [clean.name, clean];
  }));'''

new_enemy_clipmap = '''  enemyMixer = new THREE.AnimationMixer(importedEnemy);
  enemyClipMap = new Map();
  gltf.animations.forEach(c => {
    enemyClipMap.set(c.name, c);
    const clean = sanitizeEnemyClip(c);
    enemyClipMap.set(clean.name, clean);
  });'''
content = content.replace(old_enemy_clipmap, new_enemy_clipmap)

old_enemy_find = '''function enemyFindClip(candidates) {
  if (!enemyClipMap.size) return null;
  for (const name of candidates) if (enemyClipMap.has(name)) return enemyClipMap.get(name);
  const entries = [...enemyClipMap.entries()].map(([name, clip]) => [name.toLowerCase(), clip]);
  for (const candidate of candidates) {
    const q = candidate.toLowerCase();
    const exact = entries.find(([name]) => name === q);
    if (exact) return exact[1];
    const partial = entries.find(([name]) => name.includes(q));
    if (partial) return partial[1];
  }
  return null;
}'''

new_enemy_find = '''function enemyFindClip(candidates, removeRootMotion = false) {
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
}'''
content = content.replace(old_enemy_find, new_enemy_find)

# Patch enemy calls to pass cfg.removeRootMotion
content = content.replace("const clip = enemyFindClip([cfg.clip, 'Jason_Nav_Idle']);", "const clip = enemyFindClip([cfg.clip, 'Jason_Nav_Idle'], cfg.removeRootMotion);")
content = content.replace("const clip = enemyFindClip([cfg.clip, 'Jason_Walk', 'Jason_Nav_Idle']);", "const clip = enemyFindClip([cfg.clip, 'Jason_Walk', 'Jason_Nav_Idle'], cfg.removeRootMotion);")
content = content.replace("const clip = enemyFindClip([deathCfg.clip, 'Jason_HR_Flyback_B_Enter']);", "const clip = enemyFindClip([deathCfg.clip, 'Jason_HR_Flyback_B_Enter'], deathCfg.removeRootMotion);")
content = content.replace("const clip = enemyFindClip([cfg?.clip, ...candidates].filter(Boolean));", "const clip = enemyFindClip([cfg?.clip, ...candidates].filter(Boolean), cfg?.removeRootMotion);")


# Fix Leap Attack
old_dispatch = '''  if (event.type === 'heatVision') {
    if (enemyUnderAim(280, Number(event.radius) || 1.2)) {
      damageEnemy(Number(event.damage)||18, hero.position, Number(event.knockback)||0, event.label || 'VISÃO DE CALOR');
    }
    return;
  }
  if (event.type !== 'damage' || !enemyAlive) return;'''

new_dispatch = '''  if (event.type === 'heatVision') {
    if (enemyUnderAim(280, Number(event.radius) || 1.2)) {
      damageEnemy(Number(event.damage)||18, hero.position, Number(event.knockback)||0, event.label || 'VISÃO DE CALOR');
    }
    return;
  }
  if (event.type === 'leapAttackAOE') {
    triggerLeapAttackImpact();
    return;
  }
  if (event.type !== 'damage' || !enemyAlive) return;'''
content = content.replace(old_dispatch, new_dispatch)


old_leap_impact = '''    const startedLand = playOneShot(['C003_LeapAttackLand'], '', 1.0, () => {
      leapAttack.active = false;
      leapAttack.phase = 'idle';
      leapAttack.elapsed = 0;
      heroActiveSlot = '';
      velocity.set(0,0,0);
      const surface = getBaseSurfaceHeightAt(hero.position.x, hero.position.z);
      hero.position.y = surface + GROUND_EPS;
    }, 'leapAttackLand');

    if (!startedLand) {
      leapAttack.active = false;
      leapAttack.phase = 'idle';
      heroActiveSlot = '';
      velocity.set(0,0,0);
    }

    const origin = hero.position.clone();
    const fx = getImpactEffect('leap');
    const wave = fx.object;
    wave.rotation.x = -Math.PI / 2;
    wave.position.copy(origin).add(new THREE.Vector3(0, .06, 0));
    impactEffects.push({ object:wave, life:.48, maxLife:.48, poolItem: fx });

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

    const pushActors = [...trafficActors, ...npcActors];
    for (const actor of pushActors) {
      const delta = actor.object.position.clone().sub(origin);
      const distance = delta.length();
      if (distance < .01 || distance > 22) continue;
      const strength = (1 - distance / 22) * 14;
      actor.object.position.addScaledVector(delta.normalize(), strength);
    }'''

new_leap_impact = '''    const startedLand = playOneShot(['C003_LeapAttackLand'], '', 1.0, () => {
      leapAttack.active = false;
      leapAttack.phase = 'idle';
      leapAttack.elapsed = 0;
      heroActiveSlot = '';
      velocity.set(0,0,0);
      const surface = getBaseSurfaceHeightAt(hero.position.x, hero.position.z);
      hero.position.y = surface + GROUND_EPS;
    }, 'leapAttackLand');

    if (!startedLand) {
      leapAttack.active = false;
      leapAttack.phase = 'idle';
      heroActiveSlot = '';
      velocity.set(0,0,0);
    }'''

trigger_func = '''
function triggerLeapAttackImpact() {
  const origin = hero.position.clone();
  const fx = getImpactEffect('leap');
  const wave = fx.object;
  wave.rotation.x = -Math.PI / 2;
  wave.position.copy(origin).add(new THREE.Vector3(0, .06, 0));
  impactEffects.push({ object:wave, life:.48, maxLife:.48, poolItem: fx });

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
'''
if 'function triggerLeapAttackImpact' not in content:
    content = content.replace(old_leap_impact, new_leap_impact)
    content += trigger_func

with open('main.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
