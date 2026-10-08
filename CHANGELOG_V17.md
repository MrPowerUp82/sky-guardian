# Sky Guardian Superman V17 — Animações corrigidas e combate melhorado

## Correções de animação

- **Pose de bind exposta no fim de one-shots:** ao terminar soco, decolagem, pouso, `Flying_Stop` etc., o clip era desligado e, por pelo menos um quadro, nenhuma animação tinha peso — o Superman "piscava" em pé e rígido e depois misturava com essa pose por ~8 quadros. Agora one-shots seguram o último quadro e a próxima animação faz crossfade a partir dele.
- **Repetir o mesmo clip** (soco → soco) zerava o peso da ação; agora usa um clone alternado e faz crossfade.
- **Golpes do Jason congelados para sempre:** cada ataque terminado ficava pausado com peso 1.0. Depois de alguns ataques, idle/caminhada contribuíam só ~25% da pose. Agora todo clip terminado sai por crossfade.
- **Regex de root motion do Jason** (`/^Root\\.position$/`) nunca casava; corrigida.
- **Altura da pélvis por tipo de clip:** clips de solo (soco, super soco, laser, Ice Breath, Leap Attack, idle, corrida) mantêm a altura original no chão — agachamentos ficam plantados em vez de flutuar. No ar continuam achatados. `C003_Land` usa modo híbrido e o hover mantém o balanço.
- **Pouso:** o agachamento de impacto tocava a 3 m de altura e depois o Superman descia "de elevador". Agora ele desce em pose ereta, toca o chão no instante do clip (~0,075 s) e o agachamento acontece no chão, com poeira e tremor de câmera.
- **Decolagem:** o corpo saltava ~1 m no primeiro quadro; agora os pés empurram o chão (foot-lock com peso que se desfaz durante a subida).
- **Leap Attack:** o wind-up agachado flutuava ~0,7 m; agora fica no chão.
- **Visão de calor:** os feixes saem dos ossos dos olhos (antes de um ponto fixo, que no voo ficava acima das costas). O impacto no chão usa a altura real da superfície.
- **Morte do Jason:** o clip Flyback terminava no ar; agora ele cai de costas no asfalto.

## Correções do mundo

- **Personagens enterrados no asfalto:** os tiles de rua têm topo em ~0,32 m (calçadas ~0,64 m), mas o jogo usava 0,085 m. Superman, Jason, carros, postes, árvores, semáforos e pedestres afundavam (pedestres nas calçadas até ~55 cm). O perfil agora é medido do próprio tile ao carregar a cidade.
- Faixas pintadas e o anel do Jason ficavam escondidos sob o asfalto; agora aparecem.
- `dt` negativo não desestabiliza mais as interpolações; `requestPointerLock` rejeitado não gera erro no console.
- `tools/inspect-glb.js` voltou a funcionar (usava `require` em projeto ESM).

## Gameplay

- **Poise do Jason:** fim do stunlock infinito. Golpes leves desgastam o poise e só interrompem quando ele quebra; golpes pesados interrompem na hora; após um stagger há 1,25 s de imunidade. Durante o wind-up do ataque dele há super armor contra golpes leves.
- **Aviso de ataque:** um anel vermelho no chão marca a área do golpe do Jason e se preenche até o impacto. Depois de comprometido com o golpe, ele quase não gira mais — dá para desviar.
- **Esquiva (`Espaço`):** dash curto com invulnerabilidade. No chão é um passo (padrão: para trás, mantendo o olhar no inimigo); no ar é um impulso com giro (barrel roll). Pode cancelar a recuperação do soco depois do acerto. Esquivar no momento certo mostra **ESQUIVA PERFEITA**.
- **Fúria:** abaixo de 50% de vida o Jason fica mais rápido e agressivo, com brilho vermelho.
- **Rounds:** ao ser derrotado, o Jason volta em 7 s, mais forte (nível 2, 3...: mais vida, dano e ritmo). `R` volta ao nível 1.
- **Sensação de impacto:** hitstop curto, flash no Jason, números de dano flutuantes, flash vermelho e recuo do Superman ao apanhar, queda procedural na derrota.
- **Regeneração solar:** após 4,5 s sem dano, o Superman recupera 7 HP/s.
- **Buffer de golpes:** apertar `E`/`X` durante um soco agenda o próximo golpe.

## Desenvolvimento

- `game/combat/enemy-poise.js` (poise e escala por nível) e o remapeamento de pélvis em `hero-motion.js` são módulos puros com testes.
- `index.html?debug` expõe `window.__sky` (estado, pesos das animações, `tick(ms)` para avançar o jogo quadro a quadro mesmo com a aba oculta).
