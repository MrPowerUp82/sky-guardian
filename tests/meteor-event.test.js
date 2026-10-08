import test from 'node:test';
import assert from 'node:assert/strict';
import { MeteorEvent } from '../game/events/meteor-event.js';

const meteor = (overrides={}) => new MeteorEvent({
  id:'m1', impactPoint:{x:0,y:0,z:0}, startPosition:{x:0,y:120,z:0}, warningSeconds:1.5, fallSeconds:12, fireCount:4, ...overrides
});

test('warning expõe ETA e transiciona para falling', () => {
  const m=meteor();
  assert.equal(m.getSnapshot().state,'warning');
  assert.equal(m.getSnapshot().eta,13.5);
  assert.deepEqual(m.update(1),[]);
  assert.equal(m.getSnapshot().state,'warning');
  assert.equal(m.getSnapshot().eta,12.5);
  m.update(.5);
  assert.equal(m.getSnapshot().state,'falling');
  assert.equal(m.getSnapshot().eta,12);
});

test('trajetória falling é linear e determinística', () => {
  const m=meteor({warningSeconds:0, startPosition:{x:10,y:100,z:-10}, impactPoint:{x:20,y:0,z:30}, fallSeconds:10});
  m.update(0); m.update(5);
  assert.deepEqual(m.getSnapshot().position,{x:15,y:50,z:10});
  assert.equal(m.getSnapshot().eta,5);
});

test('Super Punch intercepta uma única vez', () => {
  const m=meteor({warningSeconds:0}); m.update(0);
  const first=m.tryIntercept({method:'superPunch'});
  assert.equal(first.length,1); assert.equal(first[0].type,'meteor-intercepted');
  assert.equal(m.getSnapshot().state,'intercepted');
  assert.deepEqual(m.tryIntercept({method:'superPunch'}),[]);
  assert.deepEqual(m.update(99),[]);
});

test('colisão supersônica exige Mach 1', () => {
  const low=meteor({warningSeconds:0}); low.update(0);
  assert.deepEqual(low.tryIntercept({method:'supersonic',speed:342,machOne:343}),[]);
  assert.equal(low.getSnapshot().state,'falling');
  const fast=meteor({warningSeconds:0}); fast.update(0);
  assert.equal(fast.tryIntercept({method:'supersonic',speed:343,machOne:343})[0].type,'meteor-intercepted');
});

test('dt grande cruza impacto uma vez e pede 3–6 fogos escolhidos pela factory', () => {
  const m=meteor({warningSeconds:0,fallSeconds:2,fireCount:6}); m.update(0);
  const commands=m.update(5);
  assert.deepEqual(commands,[{type:'meteor-impact',eventId:'m1',point:{x:0,y:0,z:0},requestedFireCount:6}]);
  assert.equal(m.getSnapshot().state,'impacted');
  assert.deepEqual(m.update(1,{remainingFires:2}),[]);
});

test('fireCount fora de 3..6 é rejeitado', () => {
  assert.throws(()=>meteor({fireCount:2}),/fireCount/);
  assert.throws(()=>meteor({fireCount:7}),/fireCount/);
});

test('attachFireIds preserva apenas ids reais e resolve após último foco', () => {
  const m=meteor({warningSeconds:0,fallSeconds:1}); m.update(0); m.update(1);
  m.attachFireIds(['f1','f2']);
  assert.deepEqual(m.getSnapshot().fireIds,['f1','f2']);
  assert.deepEqual(m.update(.1,{remainingFires:1}),[]);
  assert.deepEqual(m.update(.1,{remainingFires:0}),[{type:'meteor-resolved',eventId:'m1'}]);
  assert.equal(m.getSnapshot().state,'resolved');
  assert.deepEqual(m.update(.1,{remainingFires:0}),[]);
});

test('impacto sem capacidade de fogo resolve no update seguinte sem travar', () => {
  const m=meteor({warningSeconds:0,fallSeconds:1}); m.update(0); m.update(2);
  m.attachFireIds([]);
  assert.deepEqual(m.update(.01,{remainingFires:0}),[{type:'meteor-resolved',eventId:'m1'}]);
});

test('reset/dispose são idempotentes e encerram o evento', () => {
  const m=meteor();
  m.reset(); m.dispose(); m.dispose();
  assert.equal(m.getSnapshot().state,'resolved');
  assert.deepEqual(m.update(1),[]);
});
