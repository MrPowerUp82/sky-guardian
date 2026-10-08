import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

test('V15 possui sequência de reentrada cinematográfica', () => {
  for (const token of ['reentryState', 'updateReentryMotion', 'updateReentryFx', 'startReentryAudio', 'finishReentry']) {
    assert.ok(main.includes(token), `faltando ${token}`);
  }
});

test('reentrada é acionada ao voar em direção à Terra', () => {
  assert.match(main, /surfaceClearance[\s\S]*exitSpaceMode\(\)/);
  assert.match(main, /REENTRADA ATMOSFÉRICA/);
});
