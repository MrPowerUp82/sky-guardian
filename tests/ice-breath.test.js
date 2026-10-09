import test from 'node:test';
import assert from 'node:assert/strict';
import { IceBreathController, ICE_BREATH_TUNING, iceConeContains } from '../game/powers/ice-breath-controller.js';

test('tuning fixa alcance, cone e taxa', () => {
  assert.deepEqual(ICE_BREATH_TUNING, {range:24,halfAngleDeg:22,coolingRate:0.42,damagePerSecond:16,chillSeconds:1.8,chillSlow:.5});
});

test('ground start→loop→exit→idle', () => {
  const c = new IceBreathController();
  assert.deepEqual(c.requestStart({airborne:false,canUse:true}), {type:'play-start',variant:'ground'});
  assert.equal(c.phase,'starting'); assert.equal(c.active,true); assert.equal(c.held,true);
  assert.deepEqual(c.onStartFinished(), {type:'play-loop',variant:'ground'});
  assert.equal(c.phase,'looping');
  assert.deepEqual(c.requestStop(), {type:'play-exit',variant:'ground'});
  assert.equal(c.phase,'exiting'); assert.equal(c.held,false);
  assert.equal(c.onExitFinished(), null);
  assert.equal(c.phase,'idle'); assert.equal(c.variant,null); assert.equal(c.active,false);
});

test('soltar durante intro não interrompe até intro terminar e então sai', () => {
  const c = new IceBreathController();
  c.requestStart({airborne:false,canUse:true});
  assert.equal(c.requestStop(), null);
  assert.equal(c.phase,'starting'); assert.equal(c.held,false);
  assert.deepEqual(c.onStartFinished(), {type:'play-exit',variant:'ground'});
  assert.equal(c.phase,'exiting');
});

test('variante aérea usa comandos air', () => {
  const c = new IceBreathController();
  assert.deepEqual(c.requestStart({airborne:true,canUse:true}), {type:'play-start',variant:'air'});
  assert.deepEqual(c.onStartFinished(), {type:'play-loop',variant:'air'});
});

test('troca loop ground↔air emite uma vez por mudança', () => {
  const c = new IceBreathController();
  c.requestStart({airborne:false,canUse:true}); c.onStartFinished();
  assert.deepEqual(c.setAirborne(true), {type:'switch-loop',variant:'air'});
  assert.equal(c.setAirborne(true), null);
  assert.deepEqual(c.setAirborne(false), {type:'switch-loop',variant:'ground'});
});

test('nega início quando canUse=false e keydown repetido é idempotente', () => {
  const c = new IceBreathController();
  assert.equal(c.requestStart({airborne:false,canUse:false}), null);
  assert.equal(c.phase,'idle');
  assert.ok(c.requestStart({airborne:false,canUse:true}));
  assert.equal(c.requestStart({airborne:false,canUse:true}), null);
});

test('forceStop cancela imediatamente e é idempotente', () => {
  const c = new IceBreathController();
  c.requestStart({airborne:true,canUse:true}); c.onStartFinished();
  assert.deepEqual(c.forceStop(), {type:'cancel'});
  assert.equal(c.phase,'idle'); assert.equal(c.held,false); assert.equal(c.variant,null);
  assert.equal(c.forceStop(), null);
});

test('reset limpa qualquer estado sem comando residual', () => {
  const c = new IceBreathController();
  c.requestStart({airborne:false,canUse:true}); c.onStartFinished();
  c.reset();
  assert.equal(c.phase,'idle'); assert.equal(c.variant,null); assert.equal(c.held,false); assert.equal(c.active,false);
  assert.equal(c.onExitFinished(), null);
});

test('o cone acerta o Jason à frente, dentro do alcance, e ignora quem está fora', () => {
  const o = {x:0,y:1.3,z:0}, fwd = {x:0,y:0,z:-1};
  assert.equal(iceConeContains(o, fwd, {x:0,y:1.2,z:-10}), true);
  assert.equal(iceConeContains(o, fwd, {x:0,y:1.2,z:-40}), false, 'além do alcance');
  assert.equal(iceConeContains(o, fwd, {x:0,y:1.2,z:10}), false, 'atrás');
  assert.equal(iceConeContains(o, fwd, {x:12,y:1.2,z:-10}), false, 'fora do ângulo');
  // 22° de meio-ângulo: 10 m à frente tolera ~4 m para o lado (+ o raio do corpo)
  assert.equal(iceConeContains(o, fwd, {x:3.6,y:1.2,z:-10}), true);
  assert.equal(iceConeContains(o, fwd, {x:5.5,y:1.2,z:-10}, ICE_BREATH_TUNING, 1), false);
  assert.equal(iceConeContains(o, fwd, {x:4.9,y:1.2,z:-10}, ICE_BREATH_TUNING, 1), true, 'o raio do corpo alarga o cone');
  assert.equal(iceConeContains(o, {x:0,y:0,z:0}, {x:0,y:1,z:-5}), false);
  assert.equal(iceConeContains(o, fwd, {x:0,y:1.3,z:-.5}, ICE_BREATH_TUNING, 1), true, 'colado em quem sopra');
});

test('o sopro congelante dá dano, esfria e retarda o Jason no jogo', async () => {
  const fs = await import('node:fs');
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const update = main.match(/function\s+updateIceBreath\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(update, /applyIceBreathDamage\s*\(/);
  assert.match(main, /enemyChill\s*=\s*1/);
  assert.match(main, /updateEnemy\(worldDt \* chillScale/);
});

test('o meteoro ficou maior e a colisão acompanha o tamanho visual', async () => {
  const fs = await import('node:fs');
  const presentation = fs.readFileSync(new URL('../game/events/emergency-presentation.js', import.meta.url), 'utf8');
  const radius = Number(presentation.match(/const METEOR_RADIUS = ([\d.]+);/)?.[1]);
  assert.ok(radius >= 5, `raio ${radius}`);
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /const METEOR_COLLISION_RADIUS = METEOR_RADIUS;/);
  assert.match(main, /METEORO PULVERIZADO · SUPERVELOCIDADE/);
});
