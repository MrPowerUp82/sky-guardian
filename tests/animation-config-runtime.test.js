import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCharacterConfig, slotConfig, hitboxById, queueSlotEvents } from '../animation-config-runtime.js';

test('normaliza schema V2 preservando defaults', () => {
  const fallback = { transform:{rotationDeg:{x:0,y:-90,z:0},mirror:{x:false,y:false,z:false}}, slots:{fly:{clip:'Fly',speed:1,events:[]}}, hitboxes:[] };
  const cfg = normalizeCharacterConfig({ transform:{rotationDeg:{y:90}}, slots:{fly:{speed:1.5}} }, fallback);
  assert.equal(cfg.transform.rotationDeg.y, 90);
  assert.equal(cfg.transform.rotationDeg.x, 0);
  assert.equal(cfg.slots.fly.clip, 'Fly');
  assert.equal(cfg.slots.fly.speed, 1.5);
});

test('queueSlotEvents converte tempo do clip para tempo real usando speed', () => {
  const cfg = { slots:{ punch:{speed:2,events:[{time:.4,type:'damage'},{time:.2,type:'effect'}]} } };
  const q = queueSlotEvents(cfg, 'punch', 2);
  assert.equal(q.length, 2);
  assert.equal(q[0].remaining, .1);
  assert.equal(q[1].remaining, .2);
});

test('hitboxById encontra volume por id', () => {
  const h = {id:'fist',bone:'wrist'};
  assert.equal(hitboxById({hitboxes:[h]}, 'fist'), h);
  assert.equal(hitboxById({hitboxes:[h]}, 'missing'), null);
});

test('slotConfig limita números inválidos', () => {
  const s = slotConfig({slots:{fly:{clip:'Fly',speed:99,fade:-4,events:[]}}}, 'fly');
  assert.equal(s.speed, 4);
  assert.equal(s.fade, 0);
});
