import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('HUD V16 expõe emergência e controle de Ice Breath', () => {
  const html=read('index.html');
  assert.match(html,/id=["']event-hud["']/);
  assert.match(html,/id=["']event-markers["']/);
  assert.match(html,/Segure G/i);
});

test('main importa EmergencyPresentation e VFX de emergência não usa assets externos', () => {
  const main=read('main.js');
  assert.match(main,/import\s+\{\s*EmergencyPresentation(?:\s*,\s*METEOR_RADIUS)?\s*\}\s+from\s+["']\.\/game\/events\/emergency-presentation\.js["']/);
  const module=read('game/events/emergency-presentation.js');
  assert.doesNotMatch(module,/https?:\/\//i);
  assert.match(module,/export class EmergencyPresentation/);
});

test('CSS do HUD de eventos é não-interativo e possui seta off-screen', () => {
  const css=read('style.css');
  assert.match(css,/#event-hud[\s\S]*pointer-events\s*:\s*none/);
  assert.match(css,/#event-markers[\s\S]*pointer-events\s*:\s*none/);
  assert.match(css,/\.event-marker\.offscreen/);
});

test('main integra os sistemas lógicos V16 e instancia controladores', () => {
  const main=read('main.js');
  assert.match(main,/import\s+\{\s*FireSystem\s*\}\s+from\s+["']\.\/game\/fire\/fire-system\.js["']/);
  assert.match(main,/import\s+\{[^}]*IceBreathController[^}]*ICE_BREATH_TUNING[^}]*\}\s+from\s+["']\.\/game\/powers\/ice-breath-controller\.js["']/s);
  assert.match(main,/import\s+\{\s*MeteorEvent\s*\}\s+from\s+["']\.\/game\/events\/meteor-event\.js["']/);
  assert.match(main,/import\s+\{[^}]*BuildingFireEvent[^}]*selectBuildingTarget[^}]*createBuildingFireSpots[^}]*\}\s+from\s+["']\.\/game\/events\/building-fire-event\.js["']/s);
  assert.match(main,/import\s+\{[^}]*DynamicEventSystem[^}]*\}\s+from\s+["']\.\/game\/events\/dynamic-event-system\.js["']/s);
  assert.match(main,/new\s+FireSystem\s*\(/);
  assert.match(main,/new\s+IceBreathController\s*\(/);
  assert.match(main,/new\s+DynamicEventSystem\s*\(/);
  assert.match(main,/new\s+EmergencyPresentation\s*\(/);
});

test('G controla Ice Breath e os seis slots originais são usados pelo bridge', () => {
  const main=read('main.js');
  assert.match(main,/e\.code\s*===\s*["']KeyG["'][\s\S]{0,120}startIceBreath\s*\(/);
  assert.match(main,/e\.code\s*===\s*["']KeyG["'][\s\S]{0,120}stopIceBreath\s*\(/);
  for (const slot of [
    'iceBreathGroundStart','iceBreathGroundLoop','iceBreathGroundExit',
    'iceBreathAirStart','iceBreathAirLoop','iceBreathAirExit',
  ]) assert.match(main,new RegExp(`\\b${slot}\\b`));
  assert.match(main,/function\s+canUseIceBreath\s*\(/);
  assert.match(main,/function\s+updateIceBreath\s*\(/);
});

test('registerBuildingCollider preserva alvos imutáveis para incêndios', () => {
  const main=read('main.js');
  assert.match(main,/const\s+buildingTargets\s*=\s*\[\]/);
  const fn=main.match(/function\s+registerBuildingCollider\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn,/buildingTargets\.push\s*\(/);
  assert.match(fn,/min\s*:\s*Object\.freeze\(\{\s*x\s*:/);
  assert.match(fn,/max\s*:\s*Object\.freeze\(\{\s*x\s*:/);
});

test('scheduler é atualizado uma vez por frame e pausa em espaço/reentrada', () => {
  const main=read('main.js');
  assert.match(main,/function\s+updateDynamicEvents\s*\(/);
  assert.match(main,/spaceState\.active/);
  assert.match(main,/reentryState\.active/);
  const animate=main.match(/function\s+animate\s*\(timestamp\)\s*\{[\s\S]*?requestAnimationFrame\(animate\);\n\}/)?.[0] || '';
  assert.equal((animate.match(/updateDynamicEvents\s*\(/g)||[]).length,1);
});

test('reset limpa eventos, fogo, Ice Breath e apresentação', () => {
  const main=read('main.js');
  const reset=main.match(/function\s+resetGame\s*\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(reset,/iceBreathController\.reset\s*\(/);
  assert.match(reset,/dynamicEventSystem\.reset\s*\(/);
  assert.match(reset,/fireSystem\.reset\s*\(/);
  assert.match(reset,/emergencyPresentation\.reset\s*\(/);
});

test('Super Punch e varredura supersônica tentam interceptar meteoro', () => {
  const main=read('main.js');
  const punch=main.match(/function\s+triggerSuperPunchImpact\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(punch,/tryInterceptActiveMeteor\s*\(/);
  assert.match(main,/function\s+trySupersonicMeteorSweep\s*\(/);
  assert.match(main,/speed\s*<\s*METEOR_SMASH_SPEED|speed\s*<\s*MACH_ONE|speed\s*>=\s*MACH_ONE/);
  assert.match(main,/trySupersonicMeteorSweep\s*\(previousPosition\s*,\s*hero\.position/);
  assert.match(main,/tryInterceptActiveMeteor\s*\(["']supersonic["']/);
});

test('cidade fallback também registra prédios como alvos de incêndio', () => {
  const main=read('main.js');
  const fallback=main.match(/function\s+makeFallbackCity\s*\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fallback,/registerBuildingCollider\s*\(\s*m\s*\)/);
});

test('VFX recorrentes liberam geometria e materiais ao sair da cena', () => {
  const module=read('game/events/emergency-presentation.js');
  assert.match(module,/function\s+disposeEmergencyObject\s*\(/);
  assert.match(module,/geometry\?\.dispose\?\.\(\)/);
  assert.match(module,/material\?\.dispose\?\.\(\)/);
  assert.match(module,/removeMeteor[\s\S]*disposeEmergencyObject\s*\(\s*v\s*\)/);
  assert.match(module,/!seen\.has\(id\)[\s\S]*disposeEmergencyObject\s*\(\s*view\s*\)/);
});

test('impacto do meteoro escala o camera shake pela distância do herói', () => {
  const main=read('main.js');
  const impact=main.match(/if\s*\(command\.type\s*===\s*["']meteor-impact["']\)\s*\{[\s\S]*?\n\s*return;/)?.[0] || '';
  assert.match(impact,/hero\.position\.distanceTo\s*\(/);
  assert.match(impact,/impactDistance/);
  assert.match(impact,/cameraShake\s*=\s*Math\.max\(cameraShake\s*,\s*impactShake\)/);
});

test('scheduler congela também durante actionLocked', () => {
  const main=read('main.js');
  const update=main.match(/function\s+updateDynamicEvents\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(update,/const\s+controlLocked\s*=\s*[^;]*\bactionLocked\b/);
});
