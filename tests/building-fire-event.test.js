import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBuildingTarget, createBuildingFireSpots, BuildingFireEvent } from '../game/events/building-fire-event.js';

const b=(id,x,z,w=20,h=30,d=20)=>({id,min:{x:x-w/2,y:0,z:z-d/2},max:{x:x+w/2,y:h,z:z+d/2}});
const seq=(values)=>{let i=0;return()=>values[(i++)%values.length]};

test('seleção respeita distância mínima de 70 e IDs ativos/recentes',()=>{
  const buildings=[b('near',20,0),b('active',100,0),b('recent',0,120),b('ok',150,0)];
  const result=selectBuildingTarget(buildings,{heroPosition:{x:0,y:0,z:0},activeBuildingIds:['active'],recentBuildingIds:['recent'],rng:()=>0,minHeroDistance:70});
  assert.equal(result.id,'ok');
});

test('retorna null sem candidato elegível',()=>{
  assert.equal(selectBuildingTarget([b('near',10,0)],{heroPosition:{x:0,y:0,z:0},rng:()=>0,minHeroDistance:70}),null);
});

test('escolha é determinística com RNG injetado',()=>{
  const buildings=[b('a',100,0),b('b',120,0),b('c',140,0)];
  assert.equal(selectBuildingTarget(buildings,{heroPosition:{x:0,y:0,z:0},rng:()=>.5}).id,'b');
});

test('gera 1–3 focos válidos em teto/fachadas com normais externas',()=>{
  const building=b('tower',100,50,30,60,20);
  const spots=createBuildingFireSpots({eventId:'fire-1',building,count:5,rng:seq([0,.5,.25,.75,.9,.4,.6,.2,.8])});
  assert.equal(spots.length,3);
  for (const s of spots) {
    assert.equal(s.eventId,'fire-1'); assert.equal(s.buildingId,'tower'); assert.equal(s.source,'building-fire');
    assert.ok(s.position.x>=building.min.x && s.position.x<=building.max.x);
    assert.ok(s.position.y>=building.min.y && s.position.y<=building.max.y+.001);
    assert.ok(s.position.z>=building.min.z && s.position.z<=building.max.z);
    const n=s.normal;
    const valid=(n.x===1||n.x===-1||n.z===1||n.z===-1||n.y===1);
    assert.ok(valid,'normal deve apontar para fora');
    if(n.y===1) assert.equal(s.position.y,building.max.y);
    if(n.x===1) assert.equal(s.position.x,building.max.x);
    if(n.x===-1) assert.equal(s.position.x,building.min.x);
    if(n.z===1) assert.equal(s.position.z,building.max.z);
    if(n.z===-1) assert.equal(s.position.z,building.min.z);
  }
});

test('count mínimo é 1',()=>{
  assert.equal(createBuildingFireSpots({eventId:'x',building:b('a',0,0),count:0,rng:()=>0}).length,1);
});

test('BuildingFireEvent anexa só IDs reais e resolve uma vez após último foco',()=>{
  const e=new BuildingFireEvent({id:'bf1',buildingId:'tower'});
  e.attachFireIds(['a',null,'b','a']);
  assert.deepEqual(e.getSnapshot().fireIds,['a','b']);
  assert.deepEqual(e.update(.1,{remainingFires:1}),[]);
  assert.deepEqual(e.update(.1,{remainingFires:0}),[{type:'building-fire-resolved',eventId:'bf1',buildingId:'tower'}]);
  assert.equal(e.getSnapshot().state,'resolved');
  assert.deepEqual(e.update(.1,{remainingFires:0}),[]);
});
