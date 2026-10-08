# Sky Guardian — Eventos dinâmicos de meteoro, incêndio e Ice Breath

Data: 2026-10-07 · Status: aprovado pelo usuário

## Objetivo

Transformar a cidade em um espaço que gere situações de emergência sem depender de uma missão aceita manualmente. O primeiro conjunto de eventos será composto por **meteoros** e **incêndios em prédios**. O jogador poderá impedir um meteoro antes do impacto; se falhar, o impacto criará incêndios. Incêndios também poderão surgir de forma independente em prédios da cidade e serão apagados com **Ice Breath**.

O sucesso desta fase é o jogador estar voando normalmente, receber um alerta, localizar a emergência no mundo, decidir se vai atendê-la e resolver o problema usando movimentação e poderes do Superman.

## Restrições e decisões já aprovadas

- Manter Three.js e os sistemas atuais de voo, cidade, combate, espaço/reentrada e animação.
- Usar a versão atual enviada pelo usuário como base.
- Eventos surgem automaticamente durante o jogo; não existe tela de aceitar missão.
- Meteoro pode ser **interceptado no ar** ou atingir a cidade.
- Impacto de meteoro cria incêndios.
- Incêndios podem surgir **independentemente de meteoros** em prédios válidos.
- `G` segurado ativa Ice Breath.
- Ice Breath usa os clips originais do Superman, com sequência início → loop → saída, distinta para chão e voo.
- Não adicionar XP, dinheiro ou árvore de progressão nesta fase.
- Novos eventos ficam pausados no espaço, durante reentrada e em sequências críticas que retirem o controle normal do jogador.

## Arquitetura

A implementação será dividida em unidades pequenas para evitar aumentar ainda mais a responsabilidade de `main.js`.

### `DynamicEventSystem`

Responsável por agenda, cooldowns, limites de simultaneidade e ciclo de vida dos eventos. Ele não conhece detalhes visuais de meteoro ou fogo; apenas cria, atualiza e encerra tipos de evento registrados.

Interface conceitual:

- `update(dt, context)` — avança timers e pode gerar um novo evento.
- `spawn(type, options)` — cria um evento explicitamente.
- `pause(reason)` / `resume(reason)` — impede novos spawns e pausa timers de geração.
- `reset()` — encerra eventos e limpa estado.
- `getActiveEvents()` — fornece dados para HUD/marcadores.

Regras iniciais:

- No máximo **1 meteoro ativo** por vez.
- Incêndios menores podem coexistir, respeitando um limite global de focos ativos.
- Meteoro tem cooldown maior do que incêndio espontâneo.
- O agendador usa uma janela aleatória, não um intervalo fixo, para evitar previsibilidade.
- Eventos não nascem imediatamente após reset/start; existe um período inicial de calma.
- Ao pausar por espaço/reentrada, o relógio de spawn também pausa para não criar uma emergência instantaneamente ao voltar.

### `MeteorEvent`

Controla um único meteoro desde o aviso até uma das duas conclusões possíveis.

Estados:

`warning → falling → intercepted | impacted → resolved`

Responsabilidades:

- Escolher/receber um ponto de impacto válido na cidade.
- Criar posição inicial alta e trajetória visível.
- Expor ETA, distância e posição para o HUD.
- Detectar interceptação.
- Produzir explosão aérea se interceptado.
- Produzir impacto, onda de choque e incêndios se atingir a cidade.
- Limpar meshes, partículas, marcador e referências ao finalizar.

### `BuildingFireEvent`

Representa uma emergência de incêndio independente. O evento seleciona um prédio válido e pede ao `FireSystem` para criar entre **1 e 3 focos** em posições coerentes na fachada ou cobertura.

O evento termina somente quando todos os focos ligados a ele estiverem extintos.

### `FireSystem`

Sistema compartilhado por incêndios espontâneos e incêndios provocados por meteoros.

Cada foco possui:

- posição e normal/superfície associada;
- intensidade normalizada `0..1`;
- raio efetivo;
- emissor de chama;
- emissor de fumaça;
- estado `burning`, `cooling` ou `extinguished`;
- `eventId` de origem.

A intensidade controla visualmente tamanho da chama, opacidade/emissão e quantidade de fumaça. Ice Breath reduz a intensidade continuamente. O fogo não desaparece instantaneamente: diminui, solta menos fumaça e então apaga.

O sistema fornece consultas por proximidade/cone para evitar testar todos os focos do mapa a cada frame.

### `IceBreathController`

Responsável apenas pela habilidade do Superman. Ele lê entrada, estado do herói e direção da mira; controla animação, VFX, áudio e entrega ao `FireSystem` um volume de resfriamento.

Não contém lógica específica de eventos: qualquer fogo registrado no `FireSystem` pode ser apagado.

## Meteoro — fluxo de gameplay

1. `DynamicEventSystem` escolhe `MeteorEvent` quando o cooldown permite.
2. Um ponto de impacto é escolhido dentro da área urbana jogável, evitando posições inválidas e conflitos com outro evento grande.
3. O HUD mostra `METEORO DETECTADO`, distância e ETA; um marcador 3D aponta o meteoro/área prevista de impacto.
4. O meteoro entra em queda com trilha visível e velocidade suficiente para exigir reação, mas com tempo realista de gameplay para Superman chegar usando voo/boost.
5. O jogador pode interceptá-lo antes do chão.
6. Se interceptado, ocorre explosão aérea e onda de choque visual; o evento termina sem criar incêndio no solo.
7. Se não for interceptado, o meteoro atinge o ponto previsto, produz impacto e cria **3 a 6 focos de incêndio** próximos.
8. O objetivo do evento muda para `APAGUE OS INCÊNDIOS` e só termina quando os focos ligados ao impacto forem extintos.

### Interceptação

A primeira versão aceita duas formas de interceptação:

- **Super Punch** atingindo o volume do meteoro.
- **Colisão supersônica** do Superman com o meteoro acima de um limiar de velocidade.

A interceptação é validada uma vez por meteoro para evitar múltiplos impactos no mesmo frame. Um acerto normal de baixa velocidade não destrói o meteoro; isso preserva o valor do Super Punch e da aceleração supersônica.

A detecção reutilizará os sistemas atuais de hit/velocidade sempre que possível, em vez de criar um segundo sistema de combate paralelo.

## Impacto do meteoro

No impacto:

- surge uma explosão curta e uma onda de choque radial;
- câmera recebe shake proporcional à distância;
- carros/NPCs próximos podem receber impulso usando as rotinas existentes de reação/knockback;
- é criado um decal/mesh de impacto simples ou cratera visual temporária, sem implementar terreno destrutível real;
- `FireSystem` recebe de 3 a 6 focos distribuídos ao redor do ponto, em superfícies urbanas válidas;
- o HUD deixa de exibir ETA e passa a mostrar quantos focos restam.

Destruição completa de prédios fica fora desta fase.

## Incêndios espontâneos em prédios

`BuildingFireEvent` pode surgir sem relação com um meteoro.

Seleção de prédio:

- usar os dados atuais de blocos/colisores/spatial grid para escolher um edifício real;
- evitar prédio já em chamas;
- evitar spawn colado ao herói;
- evitar regiões inválidas ou fora da cidade jogável;
- preferir posições visíveis/atingíveis pela câmera e pelo Ice Breath;
- criar de 1 a 3 focos na cobertura ou fachada.

Um prédio pode voltar a ser escolhido futuramente depois de um cooldown, mas não imediatamente após ter sido apagado.

## Ice Breath

### Controle

- Segurar `G`: inicia e mantém Ice Breath.
- Soltar `G`: encerra a habilidade e toca a animação de saída.
- A habilidade segue a direção 3D da mira atual.
- Pode ser usada parado/no chão e durante voo normal.
- Durante estados incompatíveis — reentrada cinematográfica, stun forte, morte, Leap Attack ativo ou transição crítica — a habilidade não inicia ou é encerrada de forma limpa.

### Animações

No chão:

`C003_IceBreath → C003_IceBreath_Loop → C003_IceBreath_IntoIdle`

No ar:

`C003_Air_IceBreath → C003_Air_IceBreath_Loop → C003_Air_IceBreath_IntoIdle`

Comportamento:

- `start` toca uma vez;
- se `G` continuar pressionado, entra no `Loop` com crossfade curto;
- o loop continua enquanto a habilidade estiver ativa;
- ao soltar `G`, o loop faz crossfade para `IntoIdle`;
- se o estado chão/ar mudar durante uso, a troca é feita no próximo ponto seguro, sem reiniciar a habilidade a cada frame;
- o término não pode deixar `actionLocked` ou outro lock de animação preso.

Os clips necessários devem ser incluídos no `Superman-game.glb` reduzido se ainda não estiverem presentes. A fonte continua sendo o GLB original fornecido pelo usuário.

### Área de efeito

O sopro usa um **cone curto/largo** alinhado à mira, com alcance limitado. A cada atualização:

1. encontra focos de fogo próximos da origem usando consulta espacial;
2. filtra por distância e ângulo do cone;
3. opcionalmente testa oclusão simples contra prédio/superfície para não apagar fogo através de paredes;
4. aplica resfriamento proporcional à proximidade do centro do cone e ao tempo `dt`.

Isso permite varrer o jato entre vários focos, mas exige que o jogador realmente mire neles.

### VFX e áudio

Ice Breath terá efeito procedural/local, sem dependência obrigatória de novos assets externos:

- fluxo de partículas/neblina azul-clara/branca;
- partículas mais concentradas perto da boca e mais largas no final do cone;
- condensação/fumaça fria no foco atingido;
- som contínuo com fade-in/fade-out;
- intensidade visual acompanha o estado `start/loop/exit`.

A origem do VFX deve preferir um bone/head/mouth anchor do modelo quando disponível; caso contrário usa um ponto estável relativo ao `heroVisual`.

## HUD e marcadores

### Meteoro

Durante aviso/queda:

`METEORO DETECTADO · 1,8 km · IMPACTO EM 12s`

Após impacto:

`IMPACTO · APAGUE OS INCÊNDIOS · 4 RESTANTES`

Após interceptação:

`EVENTO CONCLUÍDO · METEORO INTERCEPTADO`

### Incêndio espontâneo

`INCÊNDIO EM PRÉDIO · 430 m`

Durante combate ao fogo:

`INCÊNDIO · 2 FOCOS RESTANTES`

Ao concluir:

`EVENTO CONCLUÍDO · INCÊNDIO CONTROLADO`

Marcadores são world-space e devem possuir indicação de borda/seta quando o alvo estiver fora do campo de visão. O HUD mostra prioritariamente o evento mais urgente/próximo, sem esconder completamente outros eventos ativos.

## Frequência e equilíbrio inicial

Valores são parâmetros de tuning, não contratos fixos. Ponto de partida:

- período inicial sem eventos: ~30–45 s;
- incêndio espontâneo: janela de spawn ~45–90 s quando abaixo do limite;
- meteoro: cooldown ~120–210 s;
- máximo de 1 meteoro ativo;
- máximo inicial de 2 eventos de incêndio independentes;
- limite global aproximado de 10–12 focos de fogo ativos;
- alerta de meteoro deve oferecer tempo suficiente para alcançá-lo com boost a partir de uma distância média da cidade.

O sistema escolhe aleatoriamente dentro das janelas e evita eventos em sequência imediata. Esses valores serão ajustados após teste real de jogo.

## Integração com estados existentes

Novos spawns são bloqueados quando:

- `spaceState.active`;
- reentrada cinematográfica ativa;
- jogador morto/reset em andamento;
- outra sequência que explicitamente bloqueie controle normal.

Eventos terrestres já ativos ficam **congelados** enquanto o jogador está no espaço/reentrada: meteoros não continuam caindo e incêndios não avançam. Ao retornar, retomam do estado anterior. Isso evita falhas inevitáveis enquanto o jogador está fora do mapa urbano.

`resetGame()` deve chamar os resets de `DynamicEventSystem`, `FireSystem` e `IceBreathController`, remover VFX/marcadores e cancelar animações/áudio em andamento.

## Organização de arquivos proposta

- `game/events/dynamic-event-system.js`
- `game/events/meteor-event.js`
- `game/events/building-fire-event.js`
- `game/fire/fire-system.js`
- `game/powers/ice-breath-controller.js`
- `main.js` — apenas integração com contexto existente, input e ciclo de update
- `config/superman-animation-config.json` — novos slots de Ice Breath, se necessário
- `tests/dynamic-event-system.test.js`
- `tests/meteor-event.test.js`
- `tests/fire-system.test.js`
- `tests/ice-breath.test.js`

Se o projeto atual exigir menos módulos para evitar import cycles, `MeteorEvent` e `BuildingFireEvent` podem compartilhar utilitários internos, mas as responsabilidades acima permanecem separadas.

## Estratégia de testes

### Unitários

- agendador respeita cooldown, pausa e limites;
- meteoro calcula avanço/ETA e só resolve uma vez;
- interceptação por Super Punch e colisão supersônica respeita critérios;
- impacto gera quantidade configurada de focos;
- incêndio independente seleciona prédio válido e evita duplicata proibida;
- intensidade de fogo diminui por `coolingRate * dt` e nunca abaixo de zero;
- cone de Ice Breath inclui/exclui pontos conforme distância e ângulo;
- controller percorre estados de animação `start → loop → exit` sem lock residual;
- reset limpa todos os estados.

### Integração/static checks

- clips de Ice Breath necessários existem no runtime GLB/config;
- `main.js` registra e atualiza os novos sistemas uma vez por frame;
- eventos pausam durante espaço/reentrada;
- HUD recebe dados válidos dos eventos ativos;
- `node --check` nos módulos alterados;
- suíte `npm test` completa continua passando.

### Teste manual obrigatório

- iniciar jogo e aguardar incêndio espontâneo;
- localizar marcador e apagar 1–3 focos segurando `G`;
- confirmar animações de chão e voo;
- aguardar meteoro e interceptar com Super Punch;
- em outra tentativa, deixar meteoro cair e apagar os incêndios resultantes;
- entrar no espaço com evento ativo e confirmar que ele congela/retoma;
- resetar durante Ice Breath e durante meteoro ativo para confirmar limpeza visual/sonora.

## Tratamento de falhas

- Se não houver prédio válido após tentativas limitadas, o spawn daquele ciclo é cancelado e reagendado; não se usa posição arbitrária.
- Se um asset/VFX opcional falhar, gameplay continua com fallback procedural simples.
- Se um clip de Ice Breath estiver ausente do GLB reduzido, a build/test deve falhar claramente em vez de cair silenciosamente para animação errada.
- Eventos sempre possuem caminho de `dispose()` idempotente para evitar objetos, áudio ou listeners órfãos.

## Fora de escopo desta fase

- civis carregáveis/resgatáveis;
- avião em emergência;
- perseguições policiais;
- inimigos voadores;
- sistema de reputação/XP;
- destruição completa de prédios;
- propagação física complexa de fogo entre edifícios;
- água/bombeiros controlados por IA.

## Critérios de sucesso

A fase está concluída quando:

1. incêndios espontâneos surgem em prédios sem depender de meteoro;
2. meteoro aparece com alerta, trajetória e ETA compreensíveis;
3. jogador consegue interceptar meteoro no ar com Super Punch ou colisão supersônica;
4. meteoro não interceptado impacta e cria 3–6 focos de incêndio;
5. Ice Breath em `G` usa os clips corretos de chão e voo e apaga fogo progressivamente;
6. HUD/marcadores permitem localizar e acompanhar os eventos;
7. eventos pausam corretamente no espaço/reentrada e resetam sem resíduos;
8. suíte automatizada passa e os fluxos manuais principais são jogáveis sem erros de console.
