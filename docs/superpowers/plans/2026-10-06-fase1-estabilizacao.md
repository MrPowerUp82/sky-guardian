# Fase 1 — Estabilização de chão, animação e estados: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Superman nunca afunda no chão, as transições de animação ficam limpas e nenhuma sequência de teclas trava o estado de voo.

**Architecture:** Lógica pura (sanitização de clips e máquina de estados de voo) vai para módulos ES sem dependência de `three`, testáveis com `node --test`. `main.js` passa a usar esses módulos e ganha uma função única `transitionTo` para trocar de animação com `fadeOut` consistente. Um overlay de debug (`?debug=1`) permite conferir o resultado no navegador.

**Tech Stack:** Three.js 0.186 (CDN via importmap), JavaScript ES modules, `node:test` (Node ≥ 20) para testes da lógica pura.

**Spec:** `docs/superpowers/specs/2026-10-06-gameplay-polish-design.md` (seção "Fase 1")

## Descobertas que fundamentam o plano

Inspeção de `assets/superman/Superman-game.glb` (13 clips, `Root` sem movimento):

- O osso `fml_un_C_pelvis_att` carrega a altura vertical. Em `C003_Idle_01` fica em Y≈1,994 (altura de pé); em `C003_Flying*` fica em Y≈-0,12; em `C003_Land` vai de -0,23 a 2,03; em `C003_Flying_Intro` e `C003_Jump_01` fica entre -0,26 e 1,95.
- Ao trocar de `Idle` para `Flying_Intro`/`Jump_01`, o corpo cai ~2 unidades do GLB (≈ a altura do personagem) enquanto o root está a 0,04 m do chão. Isso é o "afundar no chão".

## Global Constraints

- Three.js puro, três `0.186.0` via CDN; sem bundler e sem dependências novas.
- Manter os controles atuais e `animation-configurator.*` funcionando.
- Módulos de lógica pura não importam `three`.
- `GROUND_EPS = 0.04` e `TAKEOFF_CLEARANCE = 3.35` permanecem como estão em `main.js`.
- A pasta não é repositório git: os passos usam "Checkpoint" (confirmar que tudo passa) em vez de commit.

## Review Focus

- Soco (`E`) ou `X` durante `takingOff`/`landing`: nenhum estado trava e o golpe é ignorado explicitamente (Task 2 e 5).
- `F` repetido rapidamente (decolar/pousar/cancelar): sempre termina em `grounded` ou `flying` (Task 2, fuzz).
- Morte ou `R` no meio de decolagem/pouso/voo: volta a `grounded` na superfície, sem trava de one-shot (Task 2 e 5).
- Pouso em telhado (`surface > 0`): pés em `surface + GROUND_EPS` em qualquer clip (Task 1 e 5).
- Quadro lento ou clip ausente (`findClip` devolve `null`): decolagem e pouso ainda terminam por timer (Task 2).

---

## File Structure

- Create `package.json` — `{"private": true, "type": "module"}` para o Node tratar os `.js` como ESM.
- Create `hero-motion.js` — sanitização de tracks (pura).
- Create `hero-state.js` — máquina de estados de voo (pura).
- Create `debug-overlay.js` — overlay `?debug=1` e harness de teclas.
- Create `tools/inspect-glb.js` — inspetor de clips do GLB (copiar de `C:\Users\Gusta\.gemini\antigravity\brain\c66768f1-1a0c-40a6-983b-628dcf4adb69\scratch\inspect-glb.js`).
- Create `tests/hero-motion.test.js`, `tests/hero-state.test.js`.
- Modify `main.js` — carregamento do herói, `playClip`/`playOneShot`/`updateAnimation`, `startTakeoff`/`startLandingSequence`/`toggleFlight`/`resetGame`/`damagePlayer`, `updateHero`.

---

### Task 1: Sanitização de clips do Superman

**Files:**
- Create: `package.json`, `hero-motion.js`, `tools/inspect-glb.js`
- Test: `tests/hero-motion.test.js`

**Interfaces:**
- Produces: `export const STAND_PELVIS_Y = 1.994`
- Produces: `export const VERTICAL_TRACK_PATTERN = /^fml_un_C_pelvis_att\.position$/`
- Produces: `export function neutralizeVerticalTracks(tracks: Array<{name: string, values: Float32Array}>, constantY: number = STAND_PELVIS_Y): Array<{name: string, values: Float32Array}>` — devolve novas tracks (não muta as originais). Nas que casam com `VERTICAL_TRACK_PATTERN`, o componente Y de cada tripla `[x, y, z]` vira `constantY`; X, Z e as demais tracks ficam iguais.

- [ ] **Step 1: Write the failing tests** em `tests/hero-motion.test.js` (`node:test` + `node:assert/strict`):
  - `neutralizeVerticalTracks fixa Y da pelvis em STAND_PELVIS_Y`: track `fml_un_C_pelvis_att.position` com valores `[0,-0.234,0.1, 0.2,2.031,0.3]` → resultado `[0,1.994,0.1, 0.2,1.994,0.3]` (usar `assert.ok(Math.abs(a-b) < 1e-6)`).
  - `não altera outras tracks`: uma track `Root.position` e uma `fml_un_C_pelvis_att.quaternion` voltam idênticas.
  - `não muta a entrada`: `values` originais intactos após a chamada.
  - `aceita constantY customizado`.

- [ ] **Step 2: Run** `node --test tests/hero-motion.test.js` — Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implement** `hero-motion.js` com as exportações acima (e criar `package.json`). Copiar o inspetor para `tools/inspect-glb.js`.

- [ ] **Step 4: Run** `node --test tests/hero-motion.test.js` — Expected: PASS (4 testes).

- [ ] **Step 5: Checkpoint:** rodar `node tools/inspect-glb.js assets/superman/Superman-game.glb` e confirmar que a saída lista `fml_un_C_pelvis_att` (o nome do osso do padrão existe no GLB).

---

### Task 2: Máquina de estados de voo

**Files:**
- Create: `hero-state.js`
- Test: `tests/hero-state.test.js`

**Interfaces:**
- Produces: `export class HeroFlightState` com:
  - `state: 'grounded' | 'takingOff' | 'flying' | 'landingApproach' | 'landing'` (inicia em `grounded`)
  - `requestTakeoff(duration: number): boolean` — só em `grounded`; vai para `takingOff`, zera o timer.
  - `requestLanding(): boolean` — só em `flying`; vai para `landingApproach`.
  - `cancelLanding(): boolean` — só em `landingApproach`; volta a `flying`.
  - `touchdown(duration: number): boolean` — só em `flying`/`landingApproach`; vai para `landing`, zera o timer.
  - `forceGrounded(): void` — usado por reset/morte; vai para `grounded` e zera o timer.
  - `update(dt: number): 'flyingStarted' | 'grounded' | null` — avança o timer em `takingOff`/`landing`; ao completar, vai para `flying` (devolve `'flyingStarted'`) ou `grounded` (devolve `'grounded'`); fora disso devolve `null`.
  - `get progress(): number` — 0..1 do timer atual (0 fora de `takingOff`/`landing`).
  - `get busy(): boolean` — `true` em `takingOff`/`landing`.
- Consumes: nada.

- [ ] **Step 1: Write the failing tests** em `tests/hero-state.test.js`:
  - `decolagem completa por timer`: `requestTakeoff(0.9)`, `update(0.5)` → `null`; `update(0.5)` → `'flyingStarted'`, `state === 'flying'`.
  - `pouso completa por timer`: de `flying`, `touchdown(0.8)`, `update(1)` → `'grounded'`.
  - `quadro lento`: `requestTakeoff(0.9)` e `update(5)` termina na hora.
  - `requisições inválidas são recusadas`: `requestTakeoff` fora de `grounded`, `requestLanding` fora de `flying`, `touchdown` em `grounded` devolvem `false` e não mudam o estado.
  - `cancelLanding` volta a `flying`.
  - `forceGrounded` durante `takingOff`/`landing` volta a `grounded` com `progress === 0`.
  - `fuzz`: PRNG com seed fixa (mulberry32), 2000 sequências de 40 ações aleatórias (`requestTakeoff(0.9)`, `requestLanding`, `cancelLanding`, `touchdown(0.8)`, `forceGrounded`, `update` com dt em 0.016–0.2). Depois de cada sequência, chamar `update(1)` duas vezes e afirmar `state` ∈ `{grounded, flying, landingApproach}` (nunca `takingOff`/`landing`) e `busy === false`.

- [ ] **Step 2: Run** `node --test tests/hero-state.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** `HeroFlightState` em `hero-state.js`; o timer interno guarda a duração recebida (mínimo 0.01 para evitar divisão por zero).

- [ ] **Step 4: Run** `node --test tests/` — Expected: PASS (todos os testes das Tasks 1 e 2).

- [ ] **Step 5: Checkpoint:** `node --test tests/` verde.

---

### Task 3: Sanitizar clips e fixar altura dos pés no `main.js`

**Files:**
- Modify: `main.js` — bloco `gltfLoader.load(CHARACTER_URL, ...)` (linhas ~499-532)

**Interfaces:**
- Consumes: `neutralizeVerticalTracks` de `hero-motion.js`.
- Produces: `function sanitizeHeroClip(clip: THREE.AnimationClip): THREE.AnimationClip` em `main.js` — clona o clip e substitui `tracks` por `neutralizeVerticalTracks(clip.tracks)` convertendo cada resultado de volta em `THREE.VectorKeyframeTrack(name, track.times, values)` quando a track foi alterada.

- [ ] **Step 1:** Importar `neutralizeVerticalTracks` no topo de `main.js`, definir `sanitizeHeroClip` (mesma ideia de `sanitizeEnemyClip`) e preencher `clipMap` com os clips sanitizados.
- [ ] **Step 2: Verify no navegador:** rodar `python -m http.server 8080`, abrir `http://localhost:8080/?debug=1`, pressionar `Espaço` e `F` algumas vezes. Expected: nos primeiros frames da decolagem e do pouso o corpo não afunda no chão (antes caía ~2 unidades).
- [ ] **Step 3: Checkpoint:** reiniciar com `R` e repetir. Se os pés do herói ficarem acima ou abaixo da rua em `Idle`, ajustar `STAND_PELVIS_Y` em `hero-motion.js` em até ±0,05 e repetir (o teste da Task 1 usa a constante exportada, então continua válido).

---

### Task 4: `transitionTo` e one-shots sem resíduo

**Files:**
- Modify: `main.js` — `playClip`, `playOneShot`, `updateAnimation`, `resetGame`

**Interfaces:**
- Produces: `function transitionTo(clip: THREE.AnimationClip, opts?: {fade?: number, once?: boolean, timeScale?: number, onFinished?: () => void}): THREE.AnimationAction | null`.
  - Sempre aplica `fadeOut(fade)` na ação anterior (se existir e for diferente da nova), inclusive quando era um one-shot terminado.
  - Quando um one-shot termina: a ação sofre `fadeOut(0.12)` (nunca fica congelada com peso total), `actionLocked = false` e `onFinished` roda.
  - Nunca usa `clampWhenFinished = true`.
  - Remove o listener `finished` correspondente ao terminar, ao ser interrompido ou ao resetar (mantém um `Set` de listeners ativos).
- `playClip` e `playOneShot` passam a delegar para `transitionTo` mantendo suas assinaturas atuais.
- `resetGame` chama `mixer.stopAllAction()`, limpa o `Set` de listeners e zera `currentAction`/`currentAnimName`/`actionLocked`.

- [ ] **Step 1:** Implementar `transitionTo` e adaptar `playClip`/`playOneShot`/`resetGame`.
- [ ] **Step 2: Verify no navegador:** com `?debug=1`, dar soco (`E`), super soco (`X`) e visão de calor (`Q`) em sequência, no solo e no voo. Expected: depois de cada golpe, o clip seguinte (Idle/Run/Flying) aparece sem pose residual (braço preso no último frame do golpe).
- [ ] **Step 3: Checkpoint:** repetir após `R` no meio de um golpe; a animação volta a `Idle` limpa.

---

### Task 5: Integrar `HeroFlightState` e estados à prova de travamento

**Files:**
- Modify: `main.js` — substituir `flightState`, `transitionStartY`, `transitionTargetY`, `transitionTimer`, `transitionDuration` por uma instância `heroFlight = new HeroFlightState()`; adaptar `startTakeoff`, `requestLanding`, `startLandingSequence`, `toggleFlight`, `resetGame`, `damagePlayer`, `updateHero`, `updateAnimation`, handler de `keydown`, `punch`, `superPunch`, `fireBeam`.

**Interfaces:**
- Consumes: `HeroFlightState` (Task 2) e `transitionTo` (Task 4).
- Regras:
  - `startTakeoff()` chama `heroFlight.requestTakeoff(clipDuration([...]))` e toca o clip de decolagem em `transitionTo(..., {once: true})` sem depender de `onFinished` para mudar de estado; `updateHero` chama `heroFlight.update(dt)` e trata `'flyingStarted'` (aplica `velocity.y = 1.5`) e `'grounded'` (zera velocidade).
  - `startLandingSequence(surfaceY)` chama `heroFlight.touchdown(clipDuration(['C003_Land']))` e a interpolação de altura usa `heroFlight.progress`.
  - `punch`, `superPunch` e `fireBeam` retornam sem fazer nada quando `heroFlight.busy` (ignorado de forma explícita, sem chamar `playOneShot`).
  - `resetGame` e a morte do jogador chamam `heroFlight.forceGrounded()`; a morte também trava golpes até o `resetGame`.
  - `GROUND_EPS`: `hero.position.y = surface + GROUND_EPS` sempre que o estado volta a `grounded`.

- [ ] **Step 1:** Fazer a substituição e remover as variáveis antigas sem deixar referências.
- [ ] **Step 2: Verify:** `node --test tests/` continua verde e `http://localhost:8080/?debug=1` carrega sem erros no console.
- [ ] **Step 3: Verify no navegador:** apertar `E` e `X` durante a decolagem e durante o pouso; `F` 10 vezes seguidas. Expected: nenhum travamento; o modo na HUD sempre termina em `NO SOLO` ou `VOO`.
- [ ] **Step 4: Verify telhado:** pousar em cima de um prédio (voar para cima, descer com `Ctrl`). Expected: pés em cima do telhado, sem afundar em nenhum clip.

---

### Task 6: Overlay de debug e harness de teclas

**Files:**
- Create: `debug-overlay.js`
- Modify: `main.js` (registro do overlay quando `new URLSearchParams(location.search).has('debug')`), `README.md` (documentar `?debug=1`)

**Interfaces:**
- Produces: `export function createDebugOverlay(getSnapshot: () => {state: string, clip: string, feetY: number, surfaceY: number, locked: boolean}): {update: () => void}` — cria um `<pre id="debug">` no canto da tela e atualiza a cada frame.
- Produces: `window.__sky = { press(code: string, ms?: number): Promise<void>, runStress(): Promise<Array<{name: string, ok: boolean, state: string}>> }` — `press` dispara `keydown`/`keyup` sintéticos em `window`; `runStress` executa as sequências: soco durante a decolagem, soco durante o pouso, `F` ×10 em 1 s, `R` no meio do voo, e depois de cada uma espera 4 s e confere que o estado é `grounded` ou `flying` e que `locked === false`.

- [ ] **Step 1:** Implementar o overlay e `window.__sky`, conectar `getSnapshot` ao estado atual do herói (`heroFlight.state`, `currentAnimName`, `hero.position.y`, `getSurfaceHeightAt`, `actionLocked`).
- [ ] **Step 2: Verify:** abrir `http://localhost:8080/?debug=1`, clicar em JOGAR e, no console do navegador, rodar `await __sky.runStress()`. Expected: todas as entradas com `ok: true`.
- [ ] **Step 3: Checkpoint:** `node --test tests/` verde, `runStress` verde e atualizar `CHANGELOG_V7.md` com um item "Estabilização de animação e chão".

---

## Self-Review

- **Cobertura da spec (Fase 1):** root motion/chão → Tasks 1 e 3; máquina de animação com `fadeOut` consistente → Task 4; estados à prova de travamento, fila/ignorar golpes e reset/morte → Tasks 2 e 5; verificação com overlay e script de teclas → Task 6. O "offset por clip medido" da spec foi substituído por uma constante única (`STAND_PELVIS_Y`) porque a inspeção mostrou que o desvio vem de uma única track (`fml_un_C_pelvis_att.position`).
- **Consistência de tipos:** `HeroFlightState` (`requestTakeoff`, `requestLanding`, `cancelLanding`, `touchdown`, `forceGrounded`, `update`, `progress`, `busy`) é usado com os mesmos nomes nas Tasks 5 e 6; `transitionTo` (Task 4) é consumido na Task 5.
- **Pontos de atenção:** os passos de verificação no navegador exigem olhar o resultado; se a pose de voo ficar visualmente alta ou baixa depois da Task 3, ajustar apenas `STAND_PELVIS_Y`.
