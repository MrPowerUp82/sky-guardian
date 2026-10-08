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
