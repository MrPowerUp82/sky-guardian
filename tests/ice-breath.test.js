import test from 'node:test';
import assert from 'node:assert/strict';
import { IceBreathController, ICE_BREATH_TUNING } from '../game/powers/ice-breath-controller.js';

test('tuning fixa alcance, cone e taxa', () => {
  assert.deepEqual(ICE_BREATH_TUNING, {range:24,halfAngleDeg:22,coolingRate:0.42});
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
