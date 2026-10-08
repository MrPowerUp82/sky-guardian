import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution } from '../game/fx/adaptive-quality.js';

const feed = (a, ms, seconds) => {
  let last = null;
  for (let t = 0; t < seconds * 1000; t += ms) {
    const r = a.sample(ms);
    if (r !== null) last = r;
  }
  return last;
};

test('does nothing during the warm-up period', () => {
  const a = new AdaptiveResolution({ warmupMs: 3000 });
  assert.equal(feed(a, 50, 2.5), null);
  assert.equal(a.ratio, 1.6);
});

test('drops resolution when frames are slow, never below the minimum', () => {
  const a = new AdaptiveResolution({ warmupMs: 0 });
  const after = feed(a, 40, 4);
  assert.ok(after < 1.6);
  feed(a, 60, 30);
  assert.equal(a.ratio, .7);
});

test('recovers slowly after sustained fast frames, never above the maximum', () => {
  const a = new AdaptiveResolution({ warmupMs: 0, ratio: .8 });
  assert.equal(feed(a, 8, 2.4), null); // two fast windows are not enough
  feed(a, 8, 60);
  assert.equal(a.ratio, 1.6);
});

test('ignores hitches such as tab switches and invalid samples', () => {
  const a = new AdaptiveResolution({ warmupMs: 0 });
  for (let i = 0; i < 100; i++) a.sample(2000);
  a.sample(NaN);
  a.sample(-5);
  assert.equal(a.ratio, 1.6);
});

test('frames near the target keep the current ratio', () => {
  const a = new AdaptiveResolution({ warmupMs: 0, ratio: 1.2 });
  feed(a, 16.7, 20);
  assert.equal(a.ratio, 1.2);
});

test('floorHits counts slow windows at the minimum ratio and resets on recovery', () => {
  const a = new AdaptiveResolution({ warmupMs: 0, ratio: .7, min: .7 });
  feed(a, 60, 6);
  assert.ok(a.floorHits >= 3);
  feed(a, 8, 2);
  assert.equal(a.floorHits, 0);
});
