import test from 'node:test';
import assert from 'node:assert/strict';
import { HeroFlightState } from '../hero-state.js';

test('decolagem completa por timer', () => {
  const f = new HeroFlightState();
  assert.equal(f.requestTakeoff(0.9), true);
  assert.equal(f.state, 'takingOff');
  assert.equal(f.update(0.5), null);
  assert.equal(f.state, 'takingOff');
  assert.equal(f.update(0.5), 'flyingStarted');
  assert.equal(f.state, 'flying');
});

test('pouso completa por timer', () => {
  const f = new HeroFlightState();
  f.requestTakeoff(0.9);
  f.update(1.0);
  assert.equal(f.touchdown(0.8), true);
  assert.equal(f.state, 'landing');
  assert.equal(f.update(1), 'grounded');
  assert.equal(f.state, 'grounded');
});

test('quadro lento', () => {
  const f = new HeroFlightState();
  f.requestTakeoff(0.9);
  assert.equal(f.update(5), 'flyingStarted');
  assert.equal(f.state, 'flying');
});

test('requisições inválidas são recusadas', () => {
  const f = new HeroFlightState();
  assert.equal(f.requestLanding(), false);
  assert.equal(f.touchdown(0.8), false);
  assert.equal(f.state, 'grounded');
  
  f.requestTakeoff(0.9);
  assert.equal(f.requestTakeoff(0.9), false);
  f.update(1); // agora flying
  
  assert.equal(f.requestTakeoff(0.9), false);
});

test('cancelLanding volta a flying', () => {
  const f = new HeroFlightState();
  f.requestTakeoff(0.9);
  f.update(1);
  assert.equal(f.requestLanding(), true);
  assert.equal(f.state, 'landingApproach');
  assert.equal(f.cancelLanding(), true);
  assert.equal(f.state, 'flying');
});

test('forceGrounded durante takingOff/landing volta a grounded com progress === 0', () => {
  const f = new HeroFlightState();
  f.requestTakeoff(0.9);
  f.update(0.5);
  f.forceGrounded();
  assert.equal(f.state, 'grounded');
  assert.equal(f.progress, 0);
});

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

test('fuzz', () => {
  const rng = mulberry32(12345);
  const f = new HeroFlightState();
  for (let i = 0; i < 2000; i++) {
    for (let j = 0; j < 40; j++) {
      const r = rng();
      if (r < 0.1) f.requestTakeoff(0.9);
      else if (r < 0.2) f.requestLanding();
      else if (r < 0.3) f.cancelLanding();
      else if (r < 0.4) f.touchdown(0.8);
      else if (r < 0.5) f.forceGrounded();
      else f.update(0.016 + rng() * 0.184);
    }
    f.update(1);
    f.update(1);
    assert.ok(['grounded', 'flying', 'landingApproach'].includes(f.state), `Estado final inválido: ${f.state}`);
    assert.equal(f.busy, false);
  }
});
