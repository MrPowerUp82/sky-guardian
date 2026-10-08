# Eventos Dinâmicos: Meteoro, Incêndio e Ice Breath — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a cidade gerar automaticamente meteoros e incêndios em prédios, permitir interceptar meteoros no ar e apagar qualquer foco de fogo com Ice Breath no `G`, usando as animações originais do Superman.

**Architecture:** A lógica determinística fica em módulos ES puros e testáveis sem Three.js: `FireSystem`, `IceBreathController`, `MeteorEvent`, `BuildingFireEvent` e `DynamicEventSystem`. `main.js` vira o adaptador para a cidade/combate já existentes, enquanto um módulo de apresentação concentra meshes, partículas, áudio e marcadores/HUD para não engrossar ainda mais o arquivo principal.

**Tech Stack:** Three.js `0.186.0` via importmap/CDN, JavaScript ES modules, `node:test`/`node:assert`, GLB 2.0 local, WebAudio procedural, DOM/CSS para HUD.

**Spec:** `docs/superpowers/specs/2026-10-07-dynamic-events-meteor-fire-design.md`

## Global Constraints

- Usar a versão atual enviada pelo usuário como base; preservar voo 3D, combate, espaço/reentrada, cidade, spatial partitioning e instancing existentes.
- Eventos são automáticos; não existe tela de aceitar missão.
- Meteoro pode ser interceptado por Super Punch ou colisão supersônica; impacto não interceptado cria **3–6** focos de fogo.
- Incêndios em prédios surgem independentemente de meteoros e criam **1–3** focos em fachadas/coberturas válidas.
- `G` segurado ativa Ice Breath; `Q` continua sendo Heat Vision.
- Ice Breath usa os seis clips originais: `C003_IceBreath`, `C003_IceBreath_Loop`, `C003_IceBreath_IntoIdle`, `C003_Air_IceBreath`, `C003_Air_IceBreath_Loop`, `C003_Air_IceBreath_IntoIdle`.
- Não adicionar XP, dinheiro, reputação, propagação complexa de fogo, destruição total de prédios ou novas dependências de runtime.
- Novos spawns e o avanço dos eventos terrestres congelam em `spaceState.active`, `reentryState.active`, morte/reset ou outra sequência que retire controle normal.
- Limites iniciais: **1 meteoro**, **2 eventos de incêndio independentes** e **12 focos de fogo ativos** no total.
- Janelas iniciais: calma de **30–45 s**, incêndio de prédio a cada **45–90 s**, meteoro a cada **120–210 s** quando elegível.
- O primeiro tuning do Ice Breath será `range=24`, `halfAngleDeg=22`, `coolingRate=0.42 intensidade/s`; manter isso centralizado em constantes para ajuste posterior.
- O runtime continua iniciável com `python -m http.server 8080`; qualquer ferramenta de build usada para copiar clips não pode virar dependência do navegador.
- O repositório atual tem `HEAD` contendo a spec, mas a maior parte da base está não rastreada. Na execução, criar/confirmar um baseline explícito antes de abrir worktree; não perder a versão enviada pelo usuário.

## Review Focus

- **`G` durante troca de estado crítica:** segurar Ice Breath e iniciar pouso/decolagem/reentrada/morte/reset deve encerrar a habilidade, VFX, áudio e animação sem deixar lock residual (Task 3 + Task 8).
- **`Q` e `G` concorrentes:** Heat Vision e Ice Breath nunca devem aplicar efeitos simultaneamente; a habilidade já ativa mantém prioridade e a segunda tentativa é ignorada (Task 3 + Task 8).
- **Impacto com limite de 12 fogos quase cheio:** criar somente os focos que cabem e anexar ao evento apenas IDs realmente criados, para o meteoro nunca esperar por fogo inexistente (Task 2 + Task 4 + Task 8).
- **Pausa longa no espaço/reentrada:** timers de spawn, ETA do meteoro e estado dos incêndios não avançam durante a pausa e retomam do mesmo ponto (Task 6 + Task 8).
- **Frame lento no instante de impacto/interceptação:** o meteoro emite exatamente uma resolução, mesmo se `dt` atravessar o fim da trajetória ou Super Punch/colisão supersônica ocorrer no mesmo frame (Task 4).

---

## File Structure

- Create `game/fire/fire-system.js` — dados dos focos, spatial grid, intensidade e resfriamento por cone.
- Create `game/powers/ice-breath-controller.js` — máquina de estados `idle → starting → looping → exiting`, variante chão/ar e comandos de animação.
- Create `game/events/meteor-event.js` — estado/ETA/trajetória e resolução única por interceptação ou impacto.
- Create `game/events/building-fire-event.js` — escolha de prédio, geração de posições de 1–3 focos e conclusão por `eventId`.
- Create `game/events/dynamic-event-system.js` — agendamento, limites, cooldowns, pausa, factories e ciclo de vida dos eventos.
- Create `game/events/emergency-presentation.js` — Three.js/DOM/WebAudio para meteoro, fogo, Ice Breath, HUD e marcadores.
- Create `tools/add-animation-clips.mjs` — copiador GLB sem dependência externa para anexar apenas os seis clips necessários ao runtime otimizado.
- Create `tests/v16-animation-assets.test.js` — presença dos seis clips, slots/config e tamanho sanity-check do GLB.
- Create `tests/fire-system.test.js`.
- Create `tests/ice-breath.test.js`.
- Create `tests/meteor-event.test.js`.
- Create `tests/building-fire-event.test.js`.
- Create `tests/dynamic-event-system.test.js`.
- Create `tests/v16-dynamic-events-integration.test.js` — wiring estático das rotinas críticas.
- Modify `main.js` — registro de prédios elegíveis, input `G`, factories/adapters, interceptação, pausa/reset e update por frame.
- Modify `config/superman-animation-config.json` — seis slots de Ice Breath.
- Modify `animation-configurator.js` — expor os seis slots e defaults corretos de loop.
- Modify `index.html` — ajuda do `G` e markup do HUD de emergência.
- Modify `style.css` — HUD, marcador off-screen e estados de alerta.
- Modify `package.json` — incluir os novos módulos nos checks de sintaxe.
- Create `CHANGELOG_V16.md` e update `README.md` — controles e gameplay novos.

---

### Task 1: Restaurar os seis clips de Ice Breath e expor slots configuráveis

**Files:**
- Create: `tools/add-animation-clips.mjs`
- Create: `tests/v16-animation-assets.test.js`
- Modify: `assets/superman/Superman-game.glb`
- Modify: `config/superman-animation-config.json`
- Modify: `animation-configurator.js`
- Modify: `main.js` (`HERO_CONFIG_FALLBACK`, região ~linhas 45–65)

**Interfaces:**
- `tools/add-animation-clips.mjs <target.glb> <source.glb> <clip...>` — lê dois GLB 2.0 de buffer único, copia somente accessors/bufferViews usados pelos clips indicados, remapeia nós de canais pelo `node.name`, falha se um clip/nó não existir e reescreve o target atomicamente.
- Produces config slots:
  - `iceBreathGroundStart → C003_IceBreath`, loop `false`.
  - `iceBreathGroundLoop → C003_IceBreath_Loop`, loop `true`.
  - `iceBreathGroundExit → C003_IceBreath_IntoIdle`, loop `false`.
  - `iceBreathAirStart → C003_Air_IceBreath`, loop `false`.
  - `iceBreathAirLoop → C003_Air_IceBreath_Loop`, loop `true`.
  - `iceBreathAirExit → C003_Air_IceBreath_IntoIdle`, loop `false`.

- [ ] **Step 1: Write the failing asset/config tests** in `tests/v16-animation-assets.test.js` using the existing GLB JSON-chunk reader pattern. Assert all six names exist in `Superman-game.glb`, all six slots map exactly as above, only the two `*Loop` slots have `loop: true`, and the optimized runtime GLB stays `< 18 MiB` so the tool cannot accidentally copy the full source model.

- [ ] **Step 2: Run** `node --test tests/v16-animation-assets.test.js` — Expected: FAIL because the runtime currently has none of the six Ice Breath clips/slots.

- [ ] **Step 3: Implement** `tools/add-animation-clips.mjs`. Preserve the target GLB scene/meshes; append only selected animation sampler accessors and their binary ranges; remap every channel target node by exact node name; align JSON/BIN chunks to 4 bytes; reject duplicate/missing clip names instead of silently degrading.

- [ ] **Step 4: Materialize the source clip data** for the one-time build: `unzip -p /mnt/data/superman-multiversus.zip source/Superman.glb > /tmp/Superman-original.glb`, then invoke the tool with the six approved clip names against `assets/superman/Superman-game.glb`.

- [ ] **Step 5: Add the six slots** to `config/superman-animation-config.json`, `HERO_CONFIG_FALLBACK`, and `animation-configurator.js` (`CHARACTER_DEFS.superman.slots`, `suggestions`, plus the non-loop slot list used by `freshConfig`).

- [ ] **Step 6: Run** `node --test tests/v16-animation-assets.test.js tests/v12-animation-assets.test.js tests/v13-leap-attack.test.js` — Expected: PASS; old laser/leap clips remain present.

- [ ] **Step 7: Commit** `git add tools/add-animation-clips.mjs assets/superman/Superman-game.glb config/superman-animation-config.json animation-configurator.js main.js tests/v16-animation-assets.test.js && git commit -m "feat: restore ice breath animations"`.

---

### Task 2: Implementar FireSystem puro com limite global e spatial query

**Files:**
- Create: `game/fire/fire-system.js`
- Create: `tests/fire-system.test.js`

**Interfaces:**
- `export const FIRE_TUNING = { cellSize: 32, maxSpots: 12, coolingRate: 0.42, coolingStateSeconds: 0.15 }`.
- `export class FireSystem`:
  - `constructor(tuning = FIRE_TUNING)`.
  - `addSpot({ id, eventId, position, normal, radius = 2, intensity = 1, source = 'unknown', buildingId = null }) -> object|null`; returns `null` at `maxSpots`.
  - `addSpots(descriptors) -> string[]`; returns only IDs actually created.
  - `getSpot(id)`, `getActiveSpots()`, `countByEvent(eventId)`, `remainingCapacity()`.
  - `querySphere(position, radius) -> object[]` using a 32-unit grid.
  - `applyCoolingCone({ origin, direction, range = 24, halfAngleDeg = 22, dt, rate = 0.42, occluded = null }) -> string[]`; intensity decreases by `rate * weight * dt`, clamps to `0`, and no point behind/outside cone is touched.
  - `update(dt)`; expires transient `cooling` state back to `burning` but never resurrects `extinguished`.
  - `removeEvent(eventId)`, `reset()`.

- [ ] **Step 1: Write failing tests** for: add/query across neighboring grid cells; cap at 12; cooling at cone center; rejection outside range/angle/behind; optional `occluded(spot) === true`; intensity never negative; `countByEvent`; `cooling → burning`; `reset` empties all state; `addSpots` returns only created IDs when capacity is nearly full.

- [ ] **Step 2: Run** `node --test tests/fire-system.test.js` — Expected: FAIL with module missing.

- [ ] **Step 3: Implement** `game/fire/fire-system.js` with plain `{x,y,z}` math only; do not import `three`.

- [ ] **Step 4: Run** `node --test tests/fire-system.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `git add game/fire/fire-system.js tests/fire-system.test.js && git commit -m "feat: add spatial fire system"`.

---

### Task 3: Implementar IceBreathController e regras de exclusão de poder

**Files:**
- Create: `game/powers/ice-breath-controller.js`
- Create: `tests/ice-breath.test.js`

**Interfaces:**
- `export const ICE_BREATH_TUNING = { range: 24, halfAngleDeg: 22, coolingRate: 0.42 }`.
- `export class IceBreathController` with public read-only state fields `phase` (`idle|starting|looping|exiting`), `variant` (`ground|air|null`), `held`, `active`.
- `requestStart({ airborne, canUse }) -> command|null`; emits exactly one `{ type:'play-start', variant }` when entering.
- `requestStop() -> command|null`; during `starting` only records `held=false`; during `looping` emits `{type:'play-exit', variant}`.
- `onStartFinished() -> command|null`; held => `{type:'play-loop', variant}`, released => `{type:'play-exit', variant}`.
- `setAirborne(airborne) -> command|null`; if looping and variant changes, emits one `{type:'switch-loop', variant}`; does not restart every update.
- `forceStop() -> {type:'cancel'}|null`; immediately resets to idle for reentry/death/reset/incompatible sequences.
- `onExitFinished()` and `reset()` return to clean idle.

- [ ] **Step 1: Write failing tests** for ground `start→loop→exit→idle`, release during intro, air variant, one-time loop swap ground↔air, denied `canUse=false`, `forceStop`, repeated keydown idempotence, and no state remaining after reset.

- [ ] **Step 2: Run** `node --test tests/ice-breath.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** the controller without Three.js or DOM dependencies.

- [ ] **Step 4: Run** `node --test tests/ice-breath.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `git add game/powers/ice-breath-controller.js tests/ice-breath.test.js && git commit -m "feat: add ice breath state controller"`.

---

### Task 4: Implementar MeteorEvent com ETA, interceptação e impacto único

**Files:**
- Create: `game/events/meteor-event.js`
- Create: `tests/meteor-event.test.js`

**Interfaces:**
- `export class MeteorEvent` constructor requires `{ id, impactPoint, startPosition, warningSeconds = 1.5, fallSeconds = 12, fireCount }`; `fireCount` must be an integer `3..6` chosen by the factory.
- Public snapshot: `getSnapshot() -> { id,type:'meteor',state,position,impactPoint,eta,fireIds,priority }`.
- `update(dt, { remainingFires = 0 } = {}) -> command[]`:
  - `warning → falling` after `warningSeconds`;
  - linearly advances from `startPosition` to `impactPoint` during `fallSeconds`;
  - crossing the end emits **one** `{type:'meteor-impact', eventId, point, requestedFireCount}` and enters `impacted`;
  - when `impacted` and attached fires reach `0`, emits exactly one `{type:'meteor-resolved', eventId}` and enters `resolved`.
- `tryIntercept({ method, speed = 0, machOne = 343 }) -> command[]`; accepts `superPunch` or `supersonic` with `speed >= machOne`, only in `falling`, and emits exactly one `{type:'meteor-intercepted', eventId, position}`.
- `attachFireIds(ids)` stores only created IDs; zero created fires resolves the post-impact event on the next update rather than hanging.
- `reset()/dispose()` are idempotent.

- [ ] **Step 1: Write failing tests** for warning/ETA, deterministic trajectory, Super Punch intercept, low-speed collision rejection, Mach-1 collision acceptance, one-shot intercept, one-shot impact under oversized `dt`, attach `3–6` IDs, zero-capacity impact resolution, and impacted→resolved after last fire.

- [ ] **Step 2: Run** `node --test tests/meteor-event.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** `game/events/meteor-event.js` with plain vector objects; no renderer dependencies.

- [ ] **Step 4: Run** `node --test tests/meteor-event.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `git add game/events/meteor-event.js tests/meteor-event.test.js && git commit -m "feat: add meteor event state machine"`.

---

### Task 5: Implementar BuildingFireEvent e seleção de fachadas/coberturas

**Files:**
- Create: `game/events/building-fire-event.js`
- Create: `tests/building-fire-event.test.js`

**Interfaces:**
- Building descriptors supplied by `main.js`: `{ id, min:{x,y,z}, max:{x,y,z} }`; never retain a live Three.js object because city instancing may remove the source mesh.
- `export function selectBuildingTarget(buildings, { heroPosition, activeBuildingIds = [], recentBuildingIds = [], rng, minHeroDistance = 70 }) -> building|null`.
- `export function createBuildingFireSpots({ eventId, building, count, rng }) -> descriptors`; `count` clamps `1..3`; each descriptor contains `position`, outward `normal`, `radius`, `eventId`, `buildingId`, `source:'building-fire'`; positions must be on roof or one of four facades and inside the building extents with margin.
- `export class BuildingFireEvent` constructor `{id, buildingId}`; `attachFireIds(ids)`; `update(dt,{remainingFires})`; `getSnapshot()`; when its actually-created fire IDs reach zero it emits exactly one `{type:'building-fire-resolved', eventId, buildingId}` and resolves.

- [ ] **Step 1: Write failing tests** for min 70-unit hero distance, exclusion of active/recent building IDs, null when no candidate exists, deterministic choice with injected RNG, 1–3 valid roof/facade spots, outward normals, attach only real IDs, and resolution after final focus.

- [ ] **Step 2: Run** `node --test tests/building-fire-event.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** the pure selection/placement/event logic.

- [ ] **Step 4: Run** `node --test tests/building-fire-event.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `git add game/events/building-fire-event.js tests/building-fire-event.test.js && git commit -m "feat: add building fire events"`.

---

### Task 6: Implementar DynamicEventSystem com timers pausáveis e limites

**Files:**
- Create: `game/events/dynamic-event-system.js`
- Create: `tests/dynamic-event-system.test.js`

**Interfaces:**
- `export const DEFAULT_EVENT_TUNING = { initialCalm:[30,45], buildingFireWindow:[45,90], meteorWindow:[120,210], minGapSeconds:20, retrySeconds:15, maxMeteors:1, maxBuildingFireEvents:2, maxFireSpots:12 }`.
- `export class DynamicEventSystem` constructor `{ rng, factories, tuning = DEFAULT_EVENT_TUNING }`, where factories are `{ meteor(options), buildingFire(options) }` and may return `null` when the world has no valid target.
- `update(dt, context) -> command[]`; updates existing events and spawn clocks only when not paused; removes resolved events after their final commands are drained.
- `spawn(type, options = {}) -> event|null` applies type limits before invoking the factory.
- `pause(reason)`, `resume(reason)` use a reason `Set`; one resume cannot cancel another active pause reason.
- `getActiveEvents()`, `getSnapshots()`, `countType(type)`, `reset()`.
- Scheduler never checks Three.js objects; `context` carries `activeFireSpots`, `remainingFires(eventId)` and any data the event instance needs.

- [ ] **Step 1: Write failing tests** for initial calm, fire window, meteor window, injected deterministic RNG, the 20s global minimum gap between automatic spawns, limits `1/2`, factory returning null then 15s retry, nested pause reasons, no timer/ETA advancement during pause, resume from same remainder, and `reset()` disposing events/timers.

- [ ] **Step 2: Run** `node --test tests/dynamic-event-system.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** `game/events/dynamic-event-system.js`; timers are floating seconds and decrease only inside unpaused `update`.

- [ ] **Step 4: Run** `node --test tests/dynamic-event-system.test.js tests/meteor-event.test.js tests/building-fire-event.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `git add game/events/dynamic-event-system.js tests/dynamic-event-system.test.js && git commit -m "feat: schedule dynamic city emergencies"`.

---

### Task 7: Criar apresentação procedural de meteoro, fogo, Ice Breath e HUD

**Files:**
- Create: `game/events/emergency-presentation.js`
- Create: `tests/v16-dynamic-events-integration.test.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `package.json`

**Interfaces:**
- `export class EmergencyPresentation` constructor `{ scene, camera, hudRoot, markerRoot }`.
- `syncMeteor(snapshot)`, `removeMeteor(id, {exploded=false}={})` — sphere emissiva + trail prealocado; no alocação de geometria por frame.
- `syncFires(spots)` — mantém `Map<fireId, view>`; flame/smoke opacity/scale derive de `spot.intensity`; extinguidos fazem fade curto e são removidos.
- `setIceBreath({ active, origin, direction, intensity })` — atualiza um pool prealocado de partículas/neblina e um áudio WebAudio contínuo com fade; `active:false` silencia e esconde.
- `pulseImpact(point,{strength})` and `pulseAirburst(point)` reuse a small effect pool.
- `updateHud(snapshots, heroPosition)` — prioridade: meteoro em queda > meteoro impactado/incêndios > incêndio independente mais próximo; formatos de texto exatamente como a spec.
- `updateMarkers(snapshots, camera, viewport)` — projeta alvo; on-screen fica junto ao alvo; off-screen clampa à borda e rotaciona seta para o alvo.
- `reset()` removes/hides all views, markers and audio nodes idempotently.

- [ ] **Step 1: Add static integration assertions** to `tests/v16-dynamic-events-integration.test.js` for IDs `event-hud`/`event-markers`, `Segure G`, import of `EmergencyPresentation`, and absence of new external asset URLs for emergency VFX.

- [ ] **Step 2: Run** `node --test tests/v16-dynamic-events-integration.test.js` — Expected: FAIL.

- [ ] **Step 3: Add HUD markup** to `index.html`: `#event-hud` with primary/secondary lines and `#event-markers` overlay; add help row `<kbd>Segure G</kbd> sopro congelante / apagar incêndios`.

- [ ] **Step 4: Add CSS** for urgent meteor/fire states, marker distance label and edge arrow; keep `pointer-events:none` and z-index below pause/help panel.

- [ ] **Step 5: Implement** `game/events/emergency-presentation.js` with Three.js procedural geometry/materials only and lazy WebAudio creation after user interaction.

- [ ] **Step 6: Extend** `package.json#scripts.check` to include `node --check` for every new JS/MJS module.

- [ ] **Step 7: Run** `npm run check` and `node --test tests/v16-dynamic-events-integration.test.js` — Expected: PASS for the presentation/static subset.

- [ ] **Step 8: Commit** `git add game/events/emergency-presentation.js index.html style.css package.json tests/v16-dynamic-events-integration.test.js && git commit -m "feat: add emergency vfx and hud"`.

---

### Task 8: Integrar eventos, Ice Breath e interceptação ao gameplay existente

**Files:**
- Modify: `main.js`
- Modify: `tests/v16-dynamic-events-integration.test.js`

**Interfaces:**
- Add `buildingTargets = []` next to `buildingColliders`; `registerBuildingCollider()` stores immutable `{id,min,max}` snapshots in addition to the existing `Box3`, so instancing cannot invalidate fire targets.
- `createMeteorEvent()` chooses an urban impact point with at most 24 attempts inside `[-360,360]` X/Z, sets impact Y from the visible base/urban surface, and starts the meteor around Y=360 with up to ±140 units of lateral offset for a 12s fall; returns `null` after failed attempts.
- `createBuildingFireEvent()` calls `selectBuildingTarget()`, chooses count `1..3`, adds spots through `FireSystem`, attaches only returned IDs, and marks building recent on resolution.
- `handleEventCommand(command)` owns side effects:
  - `meteor-impact`: camera shake/impact VFX, push nearby `trafficActors`/`npcActors`, call `buildMeteorImpactFireDescriptors(eventId, point, count)` to sample 3–6 urban surface positions at 7–22 units from impact (bounded attempts), add them to `FireSystem`, and attach only created IDs.
  - `meteor-intercepted`: airburst VFX/message, no ground fire.
  - completion: one-shot success message and cleanup.
- `tryInterceptActiveMeteor(method, origin, radius, speed)` queries the active falling meteor snapshot and only calls `event.tryIntercept(...)` when `origin.distanceTo(meteor.position) <= radius + meteorRadius`.
- Super Punch integration is centralized inside `triggerSuperPunchImpact()` so both the configured event path and the timer fallback attempt interception even when Jason is dead/not ready; supersonic integration happens after hero movement using swept segment-vs-sphere detection so Mach travel cannot tunnel through a meteor.
- `canUseIceBreath()` is false for player death, `spaceState.active`, `reentryState.active`, `leapAttack.active`, `flightMachine.busy`, Heat Vision active/overheated sequence, or existing incompatible one-shot.
- `startIceBreath`, `stopIceBreath`, `applyIceBreathCommand`, `updateIceBreath(dt)` bridge controller commands to the six config slots via `transitionTo`; `updateAnimation()` returns while Ice Breath is active, without abusing the global `actionLocked`.
- `G` keydown starts once; `G` keyup requests stop. Starting Heat Vision while Ice Breath is active is ignored and vice versa.
- `updateDynamicEvents(dt,time)` computes pause reasons (`space`, `reentry`, `dead/control-lock`), updates event system, handles commands, then syncs presentation/HUD.
- `resetGame()` resets controller, event system, fire system and presentation before rebuilding normal state.

- [ ] **Step 1: Expand the failing integration tests** to assert: imports/instantiation of all five logic modules; `KeyG` keydown/keyup wiring; six slot names referenced; `registerBuildingCollider` populates `buildingTargets`; event update is called once from `animate`; pause conditions mention both `spaceState.active` and `reentryState.active`; `resetGame()` resets all three systems/presentation; Super Punch and superspeed paths call `tryInterceptActiveMeteor`.

- [ ] **Step 2: Run** `node --test tests/v16-dynamic-events-integration.test.js` — Expected: FAIL on the missing wiring.

- [ ] **Step 3: Add imports/instances and building descriptors** in `main.js`; preserve all existing `buildingColliders` users unchanged.

- [ ] **Step 4: Implement factories and command handler** for independent building fires and meteor impact fires. For meteor fires, request `3 + floor(rng()*4)` but cap through `FireSystem.remainingCapacity()`; attach only IDs returned by `addSpots`.

- [ ] **Step 5: Wire Super Punch interception** once inside `triggerSuperPunchImpact()`, before enemy-only damage logic, so both the event-timed path and timer fallback share it; use the existing punch origin/radius and avoid double intercept after the meteor leaves `falling`.

- [ ] **Step 6: Wire swept supersonic interception** after movement. Use previous/current hero position segment against a meteor sphere; require speed `>= MACH_ONE` before calling `tryIntercept`.

- [ ] **Step 7: Implement the Ice Breath bridge**. Use head/mouth bone preference (`fml_un_C_head` first) for origin, fallback to `hero.position + (0,1.55,0)`; each frame call `FireSystem.applyCoolingCone` with current 3D aim. The occlusion callback casts toward each fire and blocks only when a collider hit lies >0.45m before the fire point, so the burning facade/roof itself is still reachable but a far-side fire cannot be cooled through the building.

- [ ] **Step 8: Add mutual exclusion and critical-state cancellation**: Heat Vision vs Ice Breath, Leap/reentry/death/reset/takeoff/landing; ensure `EmergencyPresentation.setIceBreath({active:false})` runs on every force-stop path.

- [ ] **Step 9: Integrate scheduler into `animate()`** exactly once per frame, after hero movement/combat state is known and before camera/render. While paused, call presentation sync without advancing event logic so already-visible city emergency visuals remain frozen.

- [ ] **Step 10: Run** `npm run check && npm test` — Expected: all prior 22 tests plus all new V16 tests PASS.

- [ ] **Step 11: Commit** `git add main.js tests/v16-dynamic-events-integration.test.js && git commit -m "feat: integrate meteor fire and ice breath gameplay"`.

---

### Task 9: Documentar e fazer verificação manual obrigatória

**Files:**
- Create: `CHANGELOG_V16.md`
- Modify: `README.md`

**Interfaces:**
- README documents `G` hold, automatic building fires, meteor interception methods, meteor-impact fires, pause behavior in space/reentry, and the development-only clip-copy tool.
- Changelog identifies V16 as the dynamic-emergencies release and does not claim visual validation before the manual checks below are actually run.

- [ ] **Step 1: Write** `CHANGELOG_V16.md` and update `README.md` with the final behavior and controls.

- [ ] **Step 2: Run automated verification**: `npm run check && npm test`. Expected: exit code `0`; record the exact final test count from stdout rather than hard-coding it in user-facing text beforehand.

- [ ] **Step 3: Run local HTTP smoke test**: `python -m http.server 8080` from the project root, open `http://localhost:8080`, and verify no console exception during initial city/Superman/Jason load.

- [ ] **Step 4: Manual fire flow:** wait/temporarily lower tuning only in a local test build; confirm an independent building fire creates 1–3 reachable focuses, HUD/marker locates it, ground Ice Breath runs `start→loop→exit`, intensities visibly shrink, and completion fires only after the final focus.

- [ ] **Step 5: Manual airborne Ice Breath flow:** start flying, hold `G`, confirm `C003_Air_IceBreath → Loop → IntoIdle`; change ground/air state around the ability and verify no stuck action/audio/VFX.

- [ ] **Step 6: Manual meteor success/failure:** intercept one meteor with Super Punch; intercept another by Mach collision; allow another to impact and verify exactly 3–6 created fires, impact feedback, HUD transition and completion after extinction.

- [ ] **Step 7: Manual pause/reset edge cases:** with a meteor/fire active, enter orbit/reentry and verify ETA/fire state freezes and resumes; press `R` during Ice Breath and during a falling meteor and verify no residual mesh, marker, audio or animation lock.

- [ ] **Step 8: Commit** `git add README.md CHANGELOG_V16.md && git commit -m "docs: document dynamic emergencies"`.

- [ ] **Step 9: Final branch review** against the spec success criteria 1–8; only after this review package the user-facing ZIP.

