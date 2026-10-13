import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describeNetError, ERROR_TEXT, cleanPlayerName, validateJoinInput, describePlayer, stateSignature } from '../game/ui/online-panel.js';
import { GameMap } from '../game/ui/game-map.js';

test('every failure the net layer can raise has a Portuguese message', () => {
  for (const code of ['full', 'version', 'closed', 'taken', 'not-found', 'network', 'timeout', 'lost', 'host-left']) {
    assert.ok(ERROR_TEXT[code] && /[a-zà-ú]/i.test(ERROR_TEXT[code]), code);
  }
  assert.equal(describeNetError('something-new'), ERROR_TEXT.network);
  assert.equal(describeNetError(undefined), ERROR_TEXT.network);
});

test('player names are cleaned and capped', () => {
  assert.equal(cleanPlayerName('  Ana  '), 'Ana');
  assert.equal(cleanPlayerName('A\u0007b\u0000c'), 'Abc');
  assert.equal(cleanPlayerName('x'.repeat(40)).length, 16);
  assert.equal(cleanPlayerName(null), '');
});

test('join input accepts messy codes and explains bad ones', () => {
  assert.deepEqual(validateJoinInput(' ab cd '), { ok: true, code: 'ABCD', error: '' });
  for (const text of ['', 'abc', 'abcde', 'ab0d', 'ab-']) {
    const r = validateJoinInput(text);
    assert.equal(r.ok, false, text);
    assert.match(r.error, /código/i);
  }
});

test('describePlayer names the hero and the skin', () => {
  assert.equal(describePlayer({ name: 'Ana', char: 'superman', skin: 'armor' }), 'Ana · Superman (Armadura (MultiVersus))');
  assert.equal(describePlayer({ name: 'Bia', char: 'flash', skin: 'classic' }), 'Bia · The Flash (Clássico)');
});

test('the pause menu shows the Online tab only when a panel is supplied', () => {
  const menu = fs.readFileSync(new URL('../game/ui/pause-menu.js', import.meta.url), 'utf8');
  assert.match(menu, /\['online', 'Online'\]/);
  assert.match(menu, /onlinePanel = null/);
  assert.match(menu, /onlinePanel \? TABS : TABS\.filter/);
});

test('the map draws other players as green dots with names on the big map', () => {
  const calls = { arc: 0, fills: [], texts: [] };
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'arc') return () => { calls.arc++; };
      if (k === 'fillText' || k === 'strokeText') return (text) => { calls.texts.push(text); };
      return k in t ? t[k] : () => {};
    },
    set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') calls.fills.push(v); return true; }
  });
  const state = { rings: [], fires: [], meteors: [], enemy: null, peers: [{ x: 10, z: 20, name: 'Bia' }, { x: -5, z: 3, name: 'Caio' }] };
  const place = (x, z) => ({ x, y: z, clamped: false, angle: 0 });
  GameMap.prototype._markers.call({}, ctx, state, place, 6, true);
  assert.equal(calls.arc, 2);
  assert.ok(calls.fills.includes('#3ee08a'));
  assert.ok(calls.texts.includes('Bia') && calls.texts.includes('Caio'));
  calls.arc = 0;
  GameMap.prototype._markers.call({}, ctx, { ...state, peers: undefined }, place, 6, true);   // solo state has no peers
  assert.equal(calls.arc, 0);
});

test('the Online tab only rebuilds when something visible changed (a rebuild every tick drops focus and clicks)', () => {
  const base = { status: 'connected', code: 'ABCD', isHost: true, error: '', players: [{ id: 'p0', name: 'Ana', char: 'superman', skin: 'classic', self: true, isHost: true }] };
  const same = JSON.parse(JSON.stringify(base));
  assert.equal(stateSignature(base, ''), stateSignature(same, ''), 'identical state -> identical signature');
  const changes = [
    { ...base, status: 'idle' }, { ...base, code: 'WXYZ' }, { ...base, error: 'x' },
    { ...base, players: [...base.players, { id: 'p1', name: 'Bia', char: 'flash', skin: 'reverse', self: false, isHost: false }] },
    { ...base, players: [{ ...base.players[0], skin: 'armor' }] }
  ];
  for (const next of changes) assert.notEqual(stateSignature(next, ''), stateSignature(base, ''));
  assert.notEqual(stateSignature(base, 'Código inválido'), stateSignature(base, ''), 'a local validation error also re-renders');
  const panel = fs.readFileSync(new URL('../game/ui/online-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /if \(signature === lastSignature\) return;/);
});
