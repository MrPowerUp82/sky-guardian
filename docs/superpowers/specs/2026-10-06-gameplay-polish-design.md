# Sky Guardian Superman V7 — Polimento de animação, voo e combate

Data: 2026-10-06 · Status: aguardando revisão do usuário

## Objetivo

O jogo deve parecer sólido ao jogar: o Superman não afunda no chão nem trava em estados
estranhos, o voo é fluido e o combate contra Jason tem impacto e leitura clara.

## Restrições

- Three.js puro, GLBs locais atuais (`assets/superman/Superman-game.glb`, `assets/jason/Jason-game.glb`).
- Manter os controles existentes e o configurador de animações (`animation-configurator.*`).
- Código principal em `main.js`; novos módulos pequenos são permitidos (ex.: debug).

## Problemas observados (hipóteses lidas no código, a confirmar nos GLBs)

1. **Afundar no chão:** os clips do Superman não passam por sanitização de root motion
   (o Jason passa, em `sanitizeEnemyClip`). Clips como `Land`, `Flying_Intro` e `Jump`
   provavelmente trazem translação vertical. A altura do modelo é normalizada só na bind pose.
2. **Transições bugadas:** em `playOneShot`, ao terminar o one-shot, `currentAction` vira `null`
   sem `fadeOut` da ação congelada (`clampWhenFinished`), que continua com peso total e
   contamina o clip seguinte. Se `playOneShot` recusa por `actionLocked` durante o pouso,
   o callback nunca roda e o estado fica preso em `landing`.
3. **Voo:** movimento usa só o yaw (pitch não influencia), inclinação do corpo limitada a ±0,18 rad,
   inércia pouco perceptível.
4. **Combate:** dano por timer fixo, sem hitstop, Jason sofre stunlock (invulnerabilidade de 0,1 s),
   ataques do Jason sem aviso visual.

## Fase 1 — Estabilização

1. **Chão e root motion:** `sanitizeHeroClip` remove/neutraliza translação vertical do root nos clips
   do Superman. Medir a altura dos pés por clip e aplicar offset para os pés ficarem em `hero.position.y`.
   Antes de aplicar, inspecionar o GLB e confirmar quais clips têm translação.
2. **Máquina de animação:** `transitionTo(clip, opts)` única; sempre `fadeOut` da ação anterior,
   inclusive após one-shots; sem `clampWhenFinished` em clips que voltam à locomoção.
3. **Estados à prova de travamento:** `takingOff`/`landing` terminam por timer próprio, independente do
   callback do one-shot. Golpes durante `takingOff`/`landing` entram numa fila curta ou são ignorados
   explicitamente. `resetGame` e a morte do jogador chamam `stopAllAction` e voltam ao estado base.
4. **Verificação:** painel de debug opcional (estado, clip atual, altura dos pés) e script que dispara
   sequências de teclas (soco no pouso, `F` repetido, `Espaço` durante golpe) conferindo que o estado
   sempre volta a `grounded` ou `flying`.

**Critério de sucesso:** pés no chão em todos os clips; nenhuma sequência de teclas trava animação
ou estado; transições visualmente limpas.

## Fase 2 — Voo

1. **Direção:** em voo, `W/A/S/D` seguem a direção da câmera incluindo pitch. `Espaço`/`Ctrl` continuam
   subir/descer puros. No solo e na aproximação do pouso o movimento segue horizontal.
2. **Inércia:** aceleração separada do amortecimento, curva de aceleração, menos arrasto em alta velocidade,
   boost com tempo de carga curto (FOV e partículas de vento), planar ao soltar as teclas.
3. **Corpo:** inclinação para frente proporcional à velocidade (até ~70° no boost), roll nas curvas,
   rotação suave por pitch e yaw para a direção do movimento.
4. **Transições:** decolagem só entra em voo após o clip, com velocidade inicial na direção apontada;
   no pouso o corpo volta à vertical para casar com `Land`; câmera suaviza altura/distância nas trocas.

**Riscos:** o clip `Flying` pode ter pose ereta (ajustar pivô/rotação do root); colisão da câmera com
prédios em voo vertical.

## Fase 3 — Combate

1. **Janelas de golpe:** hitbox checado a cada frame dentro de uma janela do tempo normalizado do clip;
   cada golpe acerta o mesmo alvo no máximo uma vez. Início, fim, dano e alcance em tabela de configuração.
2. **Impacto:** hitstop de 60–120 ms (maior no super soco), recuo e tremor de câmera proporcionais,
   faíscas, números de dano; combo de 2–3 golpes com `E` e janela de cancelamento (se os clips existirem).
3. **IA do Jason:** aviso visual ~0,3 s antes do golpe (linha de alcance no dash); fase mais agressiva abaixo
   de 50% de HP; stagger por dano acumulado; super armor parcial e período sem interrupção após stagger
   (sem stunlock).
4. **Esquiva do jogador (aprovada):** esquiva curta (`Alt`, e `Ctrl` no solo se não conflitar) com janela
   de invulnerabilidade.
5. **Equilíbrio:** valores atuais (soco 22, super soco 48, dano do Jason 14–20, HP 100 vs 180) como ponto
   de partida; meta de luta de 45–90 s, ajustada em teste.

**Riscos:** durações/nomes de clips (`C003_Punch_01`, `Jason_Attack_Combo_0X`) a conferir no GLB;
combo encadeado depende de clips extras que talvez não estejam no GLB reduzido.

## Fora de escopo

Novos inimigos, novos mapas, troca de modelos, mudança de engine.

## Execução

Fases entregues em ordem; cada uma termina jogável e testável antes da seguinte.
