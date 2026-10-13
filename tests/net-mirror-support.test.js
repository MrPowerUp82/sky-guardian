import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicEventSystem } from '../game/events/dynamic-event-system.js';
import { MeteorEvent } from '../game/events/meteor-event.js';
import { FireSystem } from '../game/fire/fire-system.js';

const meteor = (id = 'meteor-1') => new MeteorEvent({
  id, impactPoint: { x: 0, y: 0, z: 0 }, startPosition: { x: 0, y: 100, z: 0 }, warningSeconds: 1, fallSeconds: 2, fireCount: 3
});

test('mirror mode never auto-spawns, but adopted events keep advancing and emitting commands', () => {
  let spawned = 0;
  const sys = new DynamicEventSystem({
    rng: () => 0, tuning: { initialCalm: [0, 0], buildingFireWindow: [0, 0], meteorWindow: [0, 0] },
    factories: { meteor: () => { spawned++; return null; }, buildingFire: () => { spawned++; return null; } }
  });
  sys.setMirror(true);
  sys.adopt(meteor());
  const commands = [];
  for (let i = 0; i < 40; i++) commands.push(...sys.update(.1, { remainingFires: () => 0 }));
  assert.equal(spawned, 0);
  assert.deepEqual(commands.map(c => c.type), ['meteor-impact', 'meteor-resolved']);
  sys.setMirror(false);
  sys.update(1, {});
  assert.ok(spawned > 0, 'normal scheduling resumes when mirror mode is off');
});

test('adopt ignores duplicates and survives reset()', () => {
  const sys = new DynamicEventSystem({ factories: {} });
  const m = meteor();
  assert.equal(sys.adopt(m), m);
  sys.adopt(m);
  assert.equal(sys.getActiveEvents().length, 1);
  sys.setMirror(true);
  sys.reset();
  assert.equal(sys.getActiveEvents().length, 0);
  assert.equal(sys.mirror, true, 'mirror flag is a mode, not part of the world state');
});

const spot = (id, intensity = 1, eventId = 'e1') => ({ id, eventId, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, radius: 2, intensity });

test('getSnapshot lists active spots with rounded intensity', () => {
  const fire = new FireSystem();
  fire.addSpots([spot('a', .456), spot('b', 1)]);
  assert.deepEqual(fire.getSnapshot(), [['a', .46], ['b', 1]]);
});

test('syncFromSnapshot follows the host: extinguishes missing spots, only ever lowers intensity', () => {
  const fire = new FireSystem();
  fire.addSpots([spot('a', 1), spot('b', .4), spot('c', 1)]);
  fire.syncFromSnapshot([['a', .6], ['b', .9]]);          // c is gone; b host value is higher -> keep local .4
  assert.equal(fire.getSpot('a').intensity, .6);
  assert.equal(fire.getSpot('a').state, 'cooling');
  assert.equal(fire.getSpot('b').intensity, .4);
  assert.equal(fire.getSpot('c').state, 'extinguished');
  assert.equal(fire.countByEvent('e1'), 2);
  fire.syncFromSnapshot([['a', 0]]);
  assert.equal(fire.getSpot('a').state, 'extinguished');
  assert.equal(fire.getSpot('b').state, 'extinguished');
  fire.syncFromSnapshot([['ghost', .5]]);                  // unknown ids are ignored, not created
  assert.equal(fire.getSpot('ghost'), null);
});
