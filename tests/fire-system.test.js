import test from 'node:test';
import assert from 'node:assert/strict';
import { FireSystem, FIRE_TUNING } from '../game/fire/fire-system.js';

const p = (x,y=0,z=0) => ({x,y,z});
function spot(id, x, z=0, eventId='e1', extra={}) {
  return { id, eventId, position:p(x,0,z), normal:p(0,1,0), ...extra };
}

test('tuning V16 fixa grid, limite e cooling inicial', () => {
  assert.deepEqual(FIRE_TUNING, { cellSize:32, maxSpots:12, coolingRate:0.42, coolingStateSeconds:0.15 });
});

test('adiciona focos e consulta células vizinhas sem retornar distantes', () => {
  const fs = new FireSystem();
  fs.addSpot(spot('a', 31));
  fs.addSpot(spot('b', 34));
  fs.addSpot(spot('c', 100));
  assert.deepEqual(fs.querySphere(p(32), 5).map(s=>s.id).sort(), ['a','b']);
});

test('limita a 12 focos e addSpots retorna apenas ids realmente criados', () => {
  const fs = new FireSystem();
  for (let i=0;i<11;i++) assert.ok(fs.addSpot(spot(`s${i}`, i)));
  const ids = fs.addSpots([spot('last',20), spot('overflow',21)]);
  assert.deepEqual(ids, ['last']);
  assert.equal(fs.remainingCapacity(), 0);
  assert.equal(fs.addSpot(spot('nope',22)), null);
});

test('cone resfria foco central e não toca atrás, fora de alcance ou fora do ângulo', () => {
  const fs = new FireSystem();
  fs.addSpot(spot('center', 0, 10));
  fs.addSpot(spot('behind', 0, -5));
  fs.addSpot(spot('far', 0, 30));
  fs.addSpot(spot('side', 12, 10));
  const hit = fs.applyCoolingCone({ origin:p(0), direction:p(0,0,1), range:24, halfAngleDeg:22, dt:1, rate:.42 });
  assert.deepEqual(hit, ['center']);
  assert.ok(fs.getSpot('center').intensity < 1);
  for (const id of ['behind','far','side']) assert.equal(fs.getSpot(id).intensity, 1);
});

test('oclusão impede resfriamento', () => {
  const fs = new FireSystem();
  fs.addSpot(spot('blocked',0,8));
  const hit = fs.applyCoolingCone({ origin:p(0), direction:p(0,0,1), dt:1, occluded:s=>s.id==='blocked' });
  assert.deepEqual(hit, []);
  assert.equal(fs.getSpot('blocked').intensity, 1);
});

test('intensidade nunca fica negativa e extinguido não ressuscita', () => {
  const fs = new FireSystem();
  fs.addSpot(spot('fire',0,3, 'e1', {intensity:.1}));
  fs.applyCoolingCone({ origin:p(0), direction:p(0,0,1), dt:10, rate:1 });
  assert.equal(fs.getSpot('fire').intensity, 0);
  assert.equal(fs.getSpot('fire').state, 'extinguished');
  fs.update(10);
  assert.equal(fs.getSpot('fire').state, 'extinguished');
  assert.equal(fs.countByEvent('e1'), 0);
});

test('estado cooling volta a burning após janela curta', () => {
  const fs = new FireSystem();
  fs.addSpot(spot('fire',0,4));
  fs.applyCoolingCone({ origin:p(0), direction:p(0,0,1), dt:.1 });
  assert.equal(fs.getSpot('fire').state, 'cooling');
  fs.update(.16);
  assert.equal(fs.getSpot('fire').state, 'burning');
});

test('countByEvent, removeEvent e reset refletem apenas focos ativos', () => {
  const fs = new FireSystem();
  fs.addSpot(spot('a',0,2,'one'));
  fs.addSpot(spot('b',0,3,'one'));
  fs.addSpot(spot('c',0,4,'two'));
  assert.equal(fs.countByEvent('one'),2);
  fs.removeEvent('one');
  assert.equal(fs.countByEvent('one'),0);
  assert.deepEqual(fs.getActiveSpots().map(s=>s.id), ['c']);
  fs.reset();
  assert.deepEqual(fs.getActiveSpots(), []);
  assert.equal(fs.remainingCapacity(), 12);
});
