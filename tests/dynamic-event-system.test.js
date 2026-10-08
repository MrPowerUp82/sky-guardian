import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicEventSystem, DEFAULT_EVENT_TUNING } from '../game/events/dynamic-event-system.js';
import { MeteorEvent } from '../game/events/meteor-event.js';

class FakeEvent {
  constructor(id,type){this.id=id;this.type=type;this.state='active';this.elapsed=0;this.disposed=false;}
  update(dt){this.elapsed+=dt;return [];}
  getSnapshot(){return {id:this.id,type:this.type,state:this.state,elapsed:this.elapsed,priority:1};}
  dispose(){this.disposed=true;this.state='resolved';}
}
const fixed={initialCalm:[10,10],buildingFireWindow:[5,5],meteorWindow:[20,20],minGapSeconds:2,retrySeconds:3,maxMeteors:1,maxBuildingFireEvents:2,maxFireSpots:12};
const context={activeFireSpots:0,remainingFires:()=>1};

test('defaults preservam tuning aprovado',()=>{
  assert.deepEqual(DEFAULT_EVENT_TUNING,{initialCalm:[30,45],buildingFireWindow:[45,90],meteorWindow:[120,210],minGapSeconds:20,retrySeconds:15,maxMeteors:1,maxBuildingFireEvents:2,maxFireSpots:12});
});

test('calma inicial bloqueia spawn e fire window dispara após ela',()=>{
  let n=0;
  const sys=new DynamicEventSystem({rng:()=>0,factories:{buildingFire:()=>new FakeEvent(`f${++n}`,'building-fire'),meteor:()=>new FakeEvent('m','meteor')},tuning:fixed});
  sys.update(9.9,context); assert.equal(sys.getActiveEvents().length,0);
  sys.update(.1,context); assert.equal(sys.getActiveEvents().length,0);
  sys.update(4.9,context); assert.equal(sys.countType('building-fire'),0);
  sys.update(.1,context); assert.equal(sys.countType('building-fire'),1);
});

test('meteor window dispara deterministicamente com RNG injetado',()=>{
  let meteors=0;
  const sys=new DynamicEventSystem({rng:()=>0,factories:{buildingFire:()=>null,meteor:()=>{meteors++;return new FakeEvent(`m${meteors}`,'meteor')}},tuning:{...fixed,buildingFireWindow:[999,999],minGapSeconds:0}});
  sys.update(10,context); sys.update(20,context);
  assert.equal(meteors,1); assert.equal(sys.countType('meteor'),1);
});

test('gap global mínimo impede dois spawns automáticos colados',()=>{
  let f=0,m=0;
  const sys=new DynamicEventSystem({rng:()=>0,factories:{buildingFire:()=>new FakeEvent(`f${++f}`,'building-fire'),meteor:()=>new FakeEvent(`m${++m}`,'meteor')},tuning:{...fixed,initialCalm:[0,0],buildingFireWindow:[0,0],meteorWindow:[0,0],minGapSeconds:20}});
  sys.update(0,context); assert.equal(sys.getActiveEvents().length,1);
  sys.update(19.9,context); assert.equal(sys.getActiveEvents().length,1);
  sys.update(.1,context); assert.equal(sys.getActiveEvents().length,2);
});

test('limites de 1 meteoro e 2 incêndios são aplicados antes da factory',()=>{
  let fm=0,ff=0;
  const sys=new DynamicEventSystem({rng:()=>0,factories:{meteor:()=>{fm++;return new FakeEvent(`m${fm}`,'meteor')},buildingFire:()=>{ff++;return new FakeEvent(`f${ff}`,'building-fire')}},tuning:fixed});
  assert.ok(sys.spawn('meteor')); assert.equal(sys.spawn('meteor'),null); assert.equal(fm,1);
  assert.ok(sys.spawn('buildingFire')); assert.ok(sys.spawn('buildingFire')); assert.equal(sys.spawn('buildingFire'),null); assert.equal(ff,2);
});

test('factory null agenda retry de 15/3s sem martelar a cada frame',()=>{
  let calls=0;
  const sys=new DynamicEventSystem({rng:()=>0,factories:{buildingFire:()=>{calls++;return null},meteor:()=>null},tuning:{...fixed,initialCalm:[0,0],buildingFireWindow:[0,0],meteorWindow:[999,999],minGapSeconds:0,retrySeconds:3}});
  sys.update(0,context); assert.equal(calls,1);
  sys.update(2.9,context); assert.equal(calls,1);
  sys.update(.1,context); assert.equal(calls,2);
});

test('pause aninhado congela timers e ETA e resume do mesmo restante',()=>{
  const meteor=new MeteorEvent({id:'m',impactPoint:{x:0,y:0,z:0},startPosition:{x:0,y:120,z:0},warningSeconds:0,fallSeconds:12,fireCount:3});
  meteor.update(0);
  const sys=new DynamicEventSystem({rng:()=>0,factories:{meteor:()=>meteor,buildingFire:()=>null},tuning:{...fixed,initialCalm:[999,999]}});
  sys.spawn('meteor');
  sys.update(2,context); const eta=sys.getSnapshots()[0].eta;
  sys.pause('space'); sys.pause('reentry'); sys.update(100,context);
  assert.equal(sys.getSnapshots()[0].eta,eta);
  sys.resume('space'); sys.update(100,context); assert.equal(sys.getSnapshots()[0].eta,eta);
  sys.resume('reentry'); sys.update(1,context); assert.equal(sys.getSnapshots()[0].eta,eta-1);
});

test('remove resolvidos após drenar comando final',()=>{
  const e=new FakeEvent('f','building-fire');
  e.update=()=>{e.state='resolved';return [{type:'done',eventId:'f'}]};
  const sys=new DynamicEventSystem({rng:()=>0,factories:{buildingFire:()=>e,meteor:()=>null},tuning:{...fixed,initialCalm:[999,999]}});
  sys.spawn('buildingFire');
  assert.deepEqual(sys.update(.1,context),[{type:'done',eventId:'f'}]);
  assert.equal(sys.getActiveEvents().length,0);
});

test('reset dispõe eventos e reinicia timers',()=>{
  const e=new FakeEvent('m','meteor');
  const sys=new DynamicEventSystem({rng:()=>0,factories:{meteor:()=>e,buildingFire:()=>null},tuning:fixed});
  sys.spawn('meteor'); sys.update(4,context); sys.reset();
  assert.equal(e.disposed,true); assert.equal(sys.getActiveEvents().length,0);
  sys.update(9.9,context); assert.equal(sys.getActiveEvents().length,0);
});
