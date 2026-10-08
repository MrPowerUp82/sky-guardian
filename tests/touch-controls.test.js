import test from 'node:test';
import assert from 'node:assert/strict';
import { isTouchDevice, qualityProfile } from '../game/ui/device.js';
import { joystickKeys, clampKnob, lookDelta } from '../game/ui/touch-math.js';

test('touch detection: coarse pointer, mobile UA and ?touch override', () => {
  assert.equal(isTouchDevice({ coarsePointer: true }), true);
  assert.equal(isTouchDevice({ maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }), true);
  assert.equal(isTouchDevice({ maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }), true); // iPadOS
  assert.equal(isTouchDevice({ maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), false);
  assert.equal(isTouchDevice({ search: '?touch=1' }), true);
  assert.equal(isTouchDevice({ search: '?touch=0', coarsePointer: true }), false);
});

test('mobile profile is strictly lighter than desktop', () => {
  const d = qualityProfile(false, 2), m = qualityProfile(true, 3);
  assert.ok(m.roadCount < d.roadCount && m.traffic < d.traffic && m.crowd < d.crowd);
  assert.ok(m.shadowMap < d.shadowMap && m.maxPixelRatio < d.maxPixelRatio + 1e-9);
  assert.ok(m.maxPixelRatio <= 1.25 && m.startPixelRatio <= 1);
  assert.equal(m.fx, 'mobile');
  assert.equal(d.fx, 'high');
  assert.equal(m.roadCount % 2, 1, 'odd road count keeps a road through the origin');
});

test('joystick: dead zone, cardinal and diagonal directions', () => {
  const r = 50;
  assert.deepEqual(joystickKeys(3, -4, r), { KeyW: false, KeyA: false, KeyS: false, KeyD: false });
  assert.deepEqual(joystickKeys(0, -50, r), { KeyW: true, KeyA: false, KeyS: false, KeyD: false });
  assert.deepEqual(joystickKeys(50, 0, r), { KeyW: false, KeyA: false, KeyS: false, KeyD: true });
  assert.deepEqual(joystickKeys(-35, 35, r), { KeyW: false, KeyA: true, KeyS: true, KeyD: false });
  assert.deepEqual(joystickKeys(35, -35, r), { KeyW: true, KeyA: false, KeyS: false, KeyD: true });
  assert.equal(joystickKeys(10, 10, 0).KeyW, false);
});

test('knob stays inside the base', () => {
  assert.deepEqual(clampKnob(30, 40, 100), { x: 30, y: 40 });
  const c = clampKnob(300, 400, 50);
  assert.ok(Math.abs(Math.hypot(c.x, c.y) - 50) < 1e-9);
  assert.deepEqual(clampKnob(0, 0, 50), { x: 0, y: 0 });
});

test('look delta follows mouse-look sign conventions', () => {
  const l = lookDelta(100, 50);
  assert.ok(l.yaw < 0 && l.pitch < 0);
  const r = lookDelta(-100, -50);
  assert.ok(r.yaw > 0 && r.pitch > 0);
});
