# V18 — cidade ampliada e novos efeitos

## Cidade
- Grade de avenidas 9×9 → **15×15** (≈1,4 km de lado; limite do mundo ±718 m). Tudo deriva de `ROAD_COUNT`/`ROAD_SPACING` em `main.js`.
- **Distritos** (`game/world/city-layout.js`): centro de torres, anel misto, bairros residenciais (prédios baixos + casas) e subúrbios de casas com quintais. Fachadas viradas para a rua.
- Novos modelos Kenney CC0 (locais em `assets/kenney/`): +9 prédios comerciais, +3 arranha-céus, 12 casas, árvores/arbustos/flores/pedras, 8 prédios `low-detail` para o horizonte, 12 tipos de pedestres, 13 veículos (van, caminhão, lixo, ambulância, bombeiros…), cones/barreiras/caçambas/placas.
- 96 carros e 120 pedestres; 8 anéis novos nos distritos distantes.
- Performance: instancing por *chunk* de 192 m (culling por distrito), colisões/raycasts via grade espacial em vez de varrer todos os prédios, sombra do sol seguindo o herói (frustum de 460 m com *texel snapping*).

## Efeitos
- Céu em shader (gradiente, halo e disco do sol, cirros) que casa com a névoa do horizonte.
- Nuvens volumétricas em sprites com deriva; bandos de pássaros.
- Pós-processamento (`game/fx/post-fx.js`): bloom, borrão radial proporcional à velocidade, aberração cromática nos impactos, vinheta e grade de cor. `?fx=low` reduz custo, `?fx=off` desliga.
- Partículas (`game/fx/particle-bursts.js`): poeira, destroços, faíscas, brasas e rastro de vapor em voo rápido — ligadas a decolagem/pouso, leap attack, socos, impacto de meteoro, colisões supersônicas e visão de calor.

## Otimização
- Tráfego instanciado (`game/world/instanced-traffic.js`): ~600 malhas de carros viraram poucas `InstancedMesh`, desenhadas só num raio de 200 m. Pedestres a mais de 170 m ficam ocultos.
- Instancing por chunk de 128 m também para faixas e cruzamentos; matrizes estáticas do mundo não são recalculadas por frame.
- Sombra do sol: frustum menor (±170 m), re-renderizada a ~40 Hz, e postes, semáforos, plantas e props pequenos não projetam sombra.
- Resolução dinâmica (`game/fx/adaptive-quality.js`): reduz o pixel ratio quando o frame passa de ~19 ms e sobe devagar quando sobra folga; se chegar ao piso, desliga o bloom e depois reduz a taxa das sombras. `?adaptive=off` desliga.
- Medido em cena de rua no centro: triângulos ~1,0 M → ~0,56 M, draw calls 974 → ~810 (altitude: 0,73 M → 0,30 M tris).

## Mobile
- Detecção automática (`pointer: coarse` / UA; `?touch=1` e `?touch=0` forçam) em `game/ui/device.js`.
- Controles de toque (`game/ui/touch-controls.js`): joystick flutuante à esquerda (WASD 8 direções), arrastar à direita para mirar câmera/voo e botões VOAR, SOCO, SUPER, LEAP, ESQ., CALOR/GELO (segurar) e TURBO (liga/desliga). Os botões disparam os mesmos eventos de teclado do desktop, então toda a jogabilidade é reaproveitada. Botão ⏸ reabre o menu.
- UI: HUD compacto, tela cheia + trava em paisagem ao tocar JOGAR, aviso para girar o aparelho em retrato, safe-areas, sem zoom/scroll por gestos.
- Perfil leve (`qualityProfile`): cidade 11×11 avenidas, 40 carros, 36 pedestres, sombra 1024 px/±120 m, pixel ratio ≤ 1,25 (começa em 1,0), sem MSAA nem bloom, resolução dinâmica a partir de 24 ms. Anéis fora do mapa menor são omitidos.

## Visão de calor: Start / Loop / Exit
- Seis clips novos no GLB do Superman (`C003_Laser_{Ground,Air}_{Start,Loop,Exit}`), cortados dos clips autorais; os loops fecham sem emenda.
- Slots `heatVision{Ground,Air}{Start,Loop,Exit}` na config, no fallback do jogo e no configurador. O Exit pode ser interrompido ao se mover.
- `tools/bake-subclips.mjs` gera esses cortes (fatia simples ou loop com cross-fade) e tem testes em `tests/heat-vision-loop.test.js`.

## Menu de pausa, mapa e minimapa
- **Pausa de verdade** (`P`, `Esc`, botão II no toque; perder o pointer lock também pausa): o mundo congela, as teclas soltam e o áudio suspende, mas a cena continua sendo desenhada para as mudanças gráficas aparecerem atrás do menu (`game/ui/pause-menu.js`).
- **Gráficos** (`game/settings/graphics-settings.js`, salvos em `localStorage`): predefinição (automática/baixa/média/alta/personalizada), resolução automática ou escala manual, sombras, suavização de bordas (MSAA 0/2x/4x, trocada em tempo real), bloom, efeitos de câmera, distância de visão, distância de carros/pedestres, nuvens e pássaros, partículas, minimapa e contador de FPS. "Restaurar padrão" volta ao perfil do aparelho.
- **Minimapa** no HUD (círculo, "para frente" = cima, N indicado): Jason (seta na borda se estiver longe), anéis, incêndios e meteoros. No toque ele fica ao lado do botão de pausa e abre o mapa ao tocar.
- **Mapa** (`M` ou aba Mapa): cidade inteira com ruas, parques, praças e prédios por altura; arraste, role/pinça para zoom, "Centralizar em mim". Camada estática desenhada uma vez (`game/ui/game-map.js`).

## V20 — The Flash e troca de personagem
- **Aba Personagem** no menu de pausa (Superman / The Flash); a escolha é salva e trocar reinicia a missão. `?character=flash` força o personagem.
- **The Flash** (`game/characters/flash-controller.js`): não voa. Corrida de 13 m/s e **Força da Velocidade** (Shift) até 72 m/s; correr contra um prédio alto faz subir pela **parede** até o telhado.
- **Habilidades exclusivas:** salto e pulo duplo (F), esquiva relâmpago (Espaço), rajada de 8 socos com dash até o Jason (E), raio arremessado que fere o Jason e destrói meteoros (X), tornado relâmpago (C), vendaval que apaga incêndios (G, segure) e **tempo lento** (Q, segure). Energia compartilhada na barra "Força da Velocidade".
- **Efeitos de raio** (`game/fx/speed-force-fx.js`): arcos elétricos pelo corpo, raios e rastro atrás de quem corre, imagens residuais, anéis de choque, luz amarela que acompanha, faíscas e poeira nos pés, desfoque radial e FOV aberto na velocidade, visual frio no tempo lento.
- Anéis do mapa descem para as avenidas quando se joga de Flash. O HUD, os botões de toque e a aba Controles mudam de acordo com o personagem.
- Modelo CC BY 4.0 de nitwit.friends (ver ATTRIBUTION.md).

## Meteoro maior, supervelocidade e dano do Ice Breath
- **Meteoro** com raio 2,4 → 6,2 m (núcleo mais detalhado, giro, rastro 4× mais longo); a colisão usa o mesmo valor, e o impacto (anel, poeira, empurrão, raio dos focos) cresceu junto.
- **Destruir em supervelocidade:** voar com Shift + W a ≥ 240 m/s (~860 km/h, em ~1 s de boost) atravessa o meteoro e o pulveriza: explosão com faíscas, pedras, brasas e poeira, tremor de câmera pela distância e mensagem "METEORO PULVERIZADO". O alcance conta um cone de choque de 4 m em volta do herói, e o HUD do evento agora lembra "DESTRUA: SUPERVELOCIDADE · SUPER SOCO".
- **Ice Breath com dano:** 16 de dano por segundo no Jason dentro do cone (números flutuantes e faíscas de gelo), que também o **congela**: ele fica azulado e 50% mais lento por ~1,8 s depois de cada sopro. Testes em `tests/ice-breath.test.js`.
