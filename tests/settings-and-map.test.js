import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA, PRESETS, defaultSettings, sanitize, applyChange, detectPreset, loadSettings, saveSettings, STORAGE_KEY,
  SHADOW_LEVELS, FOG_SCALE, ACTOR_SCALE, PARTICLE_DENSITY, autoPreset
} from '../game/settings/graphics-settings.js';
import {
  staticMapScale, minimapRotation, toMinimap, clampToCircle, defaultView, clampView, worldToView, viewToWorld, zoomAt, panBy, viewScale
} from '../game/ui/map-math.js';

const memoryStorage = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
};

test('defaults differ between desktop and touch and are complete', () => {
  const d = defaultSettings(false), t = defaultSettings(true);
  assert.equal(d.shadows, 'high'); assert.equal(d.msaa, 4); assert.equal(d.bloom, true);
  assert.equal(t.shadows, 'low'); assert.equal(t.msaa, 0); assert.equal(t.bloom, false);
  for (const entry of SCHEMA) assert.ok(entry.key in d, `missing default: ${entry.key}`);
});

test('sanitize rejects junk and clamps ranges', () => {
  const s = sanitize({ preset: 'custom', shadows: 'ultra', msaa: 3, bloom: 'yes', resolutionScale: 99, showFps: true, evil: 1 }, false);
  assert.equal(s.shadows, 'high');            // invalid -> default
  assert.equal(s.msaa, 4);
  assert.equal(s.bloom, true);
  assert.equal(s.resolutionScale, 2);          // clamped
  assert.equal(s.showFps, true);
  assert.ok(!('evil' in s));
  assert.equal(sanitize(null, true).shadows, 'low');
  assert.equal(sanitize({ resolutionScale: 'abc' }, false).resolutionScale, 1);
});

test('"auto" always resolves to the machine defaults', () => {
  const s = sanitize({ preset: 'auto', shadows: 'off', bloom: false }, false);
  assert.equal(s.shadows, 'high'); assert.equal(s.bloom, true);
});

test('choosing a preset applies its bundle; editing one control makes it custom', () => {
  let s = applyChange(defaultSettings(false), 'preset', 'low');
  assert.equal(s.shadows, 'off'); assert.equal(s.msaa, 0); assert.equal(s.preset, 'low');
  s = applyChange(s, 'bloom', true);
  assert.equal(s.preset, 'custom');
  s = applyChange(s, 'bloom', false);
  assert.equal(s.preset, 'low');               // back to an exact match
  s = applyChange(s, 'minimap', false);        // non-preset keys never change the preset
  assert.equal(s.preset, 'low'); assert.equal(s.minimap, false);
});

test('landing exactly on the machine default reads as "auto"', () => {
  let s = applyChange(defaultSettings(false), 'preset', 'low');
  for (const [k, v] of Object.entries(autoPreset(false))) s = applyChange(s, k, v);
  assert.equal(s.preset, 'auto');
  assert.equal(detectPreset(s, false), 'auto');
  assert.equal(detectPreset({ ...s, bloom: false }, false), 'custom');
});

test('storage round-trips and survives corrupt data', () => {
  const store = memoryStorage();
  const s = applyChange(defaultSettings(false), 'preset', 'medium');
  assert.equal(saveSettings(store, s), true);
  assert.deepEqual(loadSettings(store, false), s);
  store.data.set(STORAGE_KEY, '{not json');
  assert.deepEqual(loadSettings(store, false), defaultSettings(false));
  assert.deepEqual(loadSettings(null, true), defaultSettings(true));
  assert.equal(saveSettings({ setItem() { throw new Error('quota'); } }, s), false);
});

test('every select option has a concrete runtime value', () => {
  for (const level of ['off', 'low', 'high']) assert.ok(level in SHADOW_LEVELS);
  for (const k of ['near', 'normal', 'far']) { assert.ok(FOG_SCALE[k] > 0); assert.ok(ACTOR_SCALE[k] > 0); }
  for (const k of ['off', 'reduced', 'full']) assert.ok(k in PARTICLE_DENSITY);
  for (const p of Object.values(PRESETS)) assert.ok(p.shadows in SHADOW_LEVELS);
});

test('static map scale is sharp but bounded', () => {
  assert.equal(staticMapScale(1000), 1.3);
  assert.ok(Math.abs(staticMapScale(2600) - 2048 / 2600) < 1e-12);
});

test('minimap rotation puts the aim direction at the top', () => {
  for (const [ax, az] of [[0, -1], [1, 0], [0, 1], [-1, 0], [.6, -.8]]) {
    const r = minimapRotation(ax, az);
    const p = toMinimap(ax * 100, az * 100, r, 1);
    assert.ok(Math.abs(p.x) < 1e-9, `x ${ax},${az}`);
    assert.ok(p.y < 0, `y ${ax},${az}`);
  }
  assert.equal(minimapRotation(0, 0), 0);
});

test('markers outside the minimap are clamped onto its rim', () => {
  assert.deepEqual(clampToCircle(3, 4, 10), { x: 3, y: 4, clamped: false, angle: Math.atan2(4, 3) });
  const c = clampToCircle(30, 40, 10);
  assert.equal(c.clamped, true);
  assert.ok(Math.abs(Math.hypot(c.x, c.y) - 10) < 1e-9);
});

test('full-map view: clamp, project and zoom around the cursor', () => {
  const v = defaultView(500);
  assert.deepEqual(clampView({ ...v, zoom: 0.2, cx: 900 }), { half: 500, zoom: 1, cx: 0, cz: 0 }); // no panning at zoom 1
  const c = clampView({ ...v, zoom: 2, cx: 9999, cz: -9999 });
  assert.equal(c.cx, 250); assert.equal(c.cz, -250);
  const size = 600;
  const p = worldToView(v, size, 0, 0);
  assert.deepEqual(p, { x: 300, y: 300 });
  const back = viewToWorld(v, size, 450, 150);
  assert.ok(Math.abs(back.x - 250) < 1e-9 && Math.abs(back.z + 250) < 1e-9);

  const target = viewToWorld(v, size, 450, 150);
  const z = zoomAt(v, size, 450, 150, 2);
  assert.equal(z.zoom, 2);
  const after = viewToWorld(z, size, 450, 150);
  assert.ok(Math.abs(after.x - target.x) < 1e-6 && Math.abs(after.z - target.z) < 1e-6, 'cursor stays on the same world point');
  assert.equal(zoomAt(v, size, 300, 300, 100).zoom, 6);
});

test('panning moves the view opposite to the drag and respects limits', () => {
  const size = 600;
  const v = { half: 500, zoom: 2, cx: 0, cz: 0 };
  const p = panBy(v, size, 60, 0);
  assert.ok(p.cx < 0 && p.cz === 0);
  assert.ok(Math.abs(p.cx + 60 / viewScale(v, size)) < 1e-9);
  assert.equal(panBy(v, size, -1e6, 0).cx, 250);
});
