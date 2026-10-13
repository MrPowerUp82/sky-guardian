# Sky Guardian — Co-op online contra o Jason (P2P)

Data: 2026-10-13 · Status: aguardando revisão

## 1. Objetivo

Permitir que 2 a 4 pessoas joguem juntas, ao mesmo tempo, na mesma cidade, cada uma com o seu herói (Superman ou The Flash, com a skin escolhida), enfrentando o **mesmo Jason** e os **mesmos meteoros e incêndios**.

Sucesso significa:
- um jogador cria uma sala, recebe um código de 4 letras e os outros entram com ele;
- todos veem os heróis uns dos outros se movendo e o Jason atacando e sofrendo dano de todos;
- o jogo continua funcionando solo, sem mudança de comportamento, quando não há sala;
- tudo roda como site estático no **GitHub Pages**, sem servidor próprio.

### Fora do escopo da v1
- PvP e dano entre jogadores.
- Migração de anfitrião (se o anfitrião sair, a sala acaba).
- Sincronizar efeitos pesados dos outros heróis (raios do Flash, vibração do Reverso, laser, sopro de gelo). Aparecem só a pose, o modelo e a skin.
- Chat, voz, matchmaking público, contas e ranking.
- Garantia de conexão em redes que bloqueiam P2P (ver riscos).

## 2. Decisões já tomadas com o usuário

| Tema | Decisão |
|---|---|
| Modo | Co-op contra o Jason |
| Infraestrutura | WebRTC P2P com **código de sala**, via PeerJS e seu broker público gratuito |
| Hospedagem | GitHub Pages (arquivos estáticos) |
| Autoridade | O **anfitrião** simula o mundo compartilhado; cada jogador manda no próprio herói |

## 3. Arquitetura

```
 Convidado ──┐                     ┌── Convidado
             │   WebRTC (dados)    │
             └────►  ANFITRIÃO  ◄──┘
                  (Jason, eventos,
                   fogo, relógio)
```

Topologia em estrela: os convidados falam só com o anfitrião, que retransmite o que for necessário aos demais. Para até 4 jogadores isso é simples e suficiente.

### Quem é dono de quê

| Estado | Dono | Quem recebe |
|---|---|---|
| Posição, direção, animação, vida e poderes do herói | O próprio jogador | Todos (cerca de 15 Hz) |
| Jason: posição, clip, vida, fúria, nível, vivo/morto | Anfitrião | Convidados (cerca de 10 Hz) |
| Meteoros, incêndios e o relógio de eventos | Anfitrião | Convidados (comandos + snapshot cerca de 5 Hz) |
| Aplicação de dano ao Jason, ao fogo e ao meteoro | Anfitrião | Convidados (pedido → resultado) |
| Dano do Jason em um herói | O dono do herói aplica | Anfitrião manda `hit` ao convidado alvo |

### Módulos novos (cada um com um propósito e testável sozinho)

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `game/net/protocol.js` | Tipos de mensagem, `encode`/`decode`, validação, versão do protocolo | nada (puro) |
| `game/net/interpolation.js` | Buffer de snapshots com atraso fixo, interpolação de posição e yaw | nada (puro) |
| `game/net/transport.js` | Interface `Transport` (`send`, `onMessage`, `onClose`) + implementação PeerJS + implementação em memória para testes | PeerJS (só a implementação real) |
| `game/net/room.js` | Criar/entrar na sala, handshake, lista de jogadores, tempo limite, fechamento da sala | `protocol`, `transport` |
| `game/net/net-session.js` | Cola com o jogo: envia o estado local, aplica o remoto, roteia pedidos ao anfitrião | `room` e `api` passada pelo `main.js` |
| `game/net/remote-hero.js` | Boneco de outro jogador: carrega GLB por personagem e skin (com cache), mixer, interpolação, etiqueta de nome | three.js |
| `game/net/world-mirror.js` | No convidado: aplica snapshots do Jason, dos meteoros e dos incêndios | three.js |
| `game/ui/online-panel.js` | Aba **Online** no menu de pausa | DOM |
| `tools/vendor-peerjs.mjs` | Copia o PeerJS fixado para `vendor/peerjs/` (igual ao `vendor-three.mjs`) | npm |

`main.js` continua sendo o dono do loop e do estado do jogo. Ele ganha apenas ganchos pequenos (secção 5), sem absorver a lógica de rede.

## 4. Protocolo

Mensagens são JSON compacto `{ t: tipo, ... }`, cada uma com `t` conhecido. Mensagem desconhecida ou malformada é descartada em silêncio (nunca derruba o jogo).

| `t` | Direção | Conteúdo |
|---|---|---|
| `hello` | convidado → anfitrião | `proto`, `build`, `name`, `char`, `skin` |
| `welcome` | anfitrião → convidado | `id`, lista de jogadores, `seed` dos eventos, estado inicial do mundo |
| `reject` | anfitrião → convidado | `reason`: `full` \| `version` \| `closed` |
| `join` / `leave` | anfitrião → todos | jogador entrou ou saiu |
| `pose` | todos | `id`, `p` posição, `y` yaw, `clip`, `rate`, `hp`, `dead` |
| `world` | anfitrião → convidados | Jason (posição, yaw, clip, vida, máx., fúria, nível, vivo) + resumo de meteoros e incêndios |
| `event` | anfitrião → convidados | comandos do barramento de eventos já existente (`handleEventCommand`) |
| `dmg` | convidado → anfitrião | pedido de dano ao Jason: `amount`, `label`, `kb` |
| `cool` | convidado → anfitrião | apagar fogo (cone ou esfera) |
| `intercept` | convidado → anfitrião | destruir meteoro ativo |
| `hit` | anfitrião → convidado | Jason acertou: `amount`, direção |
| `reset` | anfitrião → todos | reiniciar a missão (todos mortos ou o anfitrião reiniciou) |
| `ping` / `pong` | ambos | detecção de queda |

Constantes de ajuste ficam em um só objeto, `NET_TUNING`:

| Constante | Valor inicial |
|---|---|
| `poseHz` | 15 |
| `worldHz` | 10 |
| `interpDelayMs` | 100 |
| `timeoutMs` | 15000 |
| `maxPlayers` | 4 |
| `bossHealthPerExtraPlayer` | +50% |
| `roomCodeLength` | 4 |

## 5. Ganchos em `main.js` (mudanças no jogo existente)

1. **Alvo do Jason.** `updateEnemy` e `triggerEnemyAttackImpact` usam `hero.position` fixo. Passam a usar `chooseTarget()` (vivo mais próximo entre o herói local e os remotos). Em solo, `chooseTarget()` devolve o herói local, então nada muda.
2. **Dano do Jason em remotos.** Se o alvo atingido é remoto, o anfitrião manda `hit` em vez de chamar `damagePlayer`.
3. **Convidado não simula o Jason.** Com a sessão ativa como convidado, `updateEnemy`, o scheduler de eventos e o AI ficam desligados. O espelho aplica os snapshots.
4. **Acertos viram pedidos.** No convidado, `damageEnemy` mantém o feedback local (faíscas, número, hitstop) e envia `dmg`. O mesmo vale para apagar fogo e para interceptar meteoro.
5. **Morte e `resetGame`.** Hoje morrer chama `resetGame` e zera o mundo. Online, a morte só renasce o próprio jogador (1,7 s depois, como hoje). O `R` do convidado vira "renascer". Só o anfitrião reinicia a sala (ou todos mortos, caso em que o anfitrião emite `reset`).
6. **Escala da vida do Jason** com o número de jogadores, aplicada onde a vida máxima é definida hoje.

Tudo isso é condicionado a `netSession?.active`. Sem sala, o caminho antigo roda exatamente como antes.

## 6. Fluxo de uma sessão

1. **Criar sala:** o anfitrião gera um código de 4 letras (alfabeto sem letras ambíguas), registra o ID `skyguardian-<código>` no PeerJS e espera.
2. **Entrar:** o convidado digita o código e conecta ao mesmo ID. Manda `hello`. O anfitrião valida `proto` e `build`, aplica o limite de jogadores e responde `welcome` ou `reject`.
3. **Jogo:** `pose` de todos; `world` e `event` do anfitrião; pedidos `dmg`, `cool` e `intercept` dos convidados.
4. **Saída:** `leave` ou 15 s sem `ping`/mensagens remove o jogador (a contagem só avança em ticks que realmente rodaram, para um travamento local não parecer silêncio do outro lado). Se o anfitrião cai, os convidados voltam ao modo solo com a mensagem "A sala foi encerrada".

## 7. Interface

Nova aba **Online** no menu de pausa:
- campo de **nome** (salvo no aparelho);
- botões **Criar sala** e **Entrar com código**;
- depois de conectado: código da sala bem visível (com botão de copiar), lista de jogadores com personagem e skin, botão **Sair da sala**;
- mensagens de erro em português: sala cheia, código inexistente, versão diferente, falha de conexão, sala encerrada.

Em jogo: etiqueta com o nome sobre cada herói remoto e um ponto de cor no minimapa.

## 8. Erros e riscos

| Risco | Tratamento |
|---|---|
| Redes sem P2P direto (CGNAT, algumas 4G, redes corporativas) | A v1 usa apenas STUN público (sem TURN), então algumas redes não conectam; a falha é reportada com mensagem clara. A lista de servidores ICE fica em configuração, para acrescentar um TURN depois sem mudar o código. |
| Broker público do PeerJS fora do ar ou limitado | Mensagem de erro; o broker é configurável, então trocar por um próprio é só configuração. |
| Versões diferentes do jogo na mesma sala | Handshake recusa com `reject: version`. O `build` vem do hash do pré-cache do PWA. |
| Anfitrião fecha a aba | Sala encerrada; os convidados voltam ao solo. |
| Mensagens inválidas ou maliciosas | Validação no `decode`, limites de tamanho e de taxa por jogador; valores numéricos são limitados (por exemplo, dano máximo por pedido) para impedir trapaça trivial. Confiança total entre amigos é aceitável na v1, mas o dano pedido é sempre validado no anfitrião. |
| Repositório público expõe modelos de terceiros | Decisão do usuário antes de publicar. O `ATTRIBUTION.md` já registra os avisos. |
| Pico de custo de skin remota (GLB de até 14 MB) | Carregamento sob demanda com cache por URL; o remoto aparece com um marcador simples até o modelo carregar. |

## 9. Testes

**Automatizados (Node, sem navegador):**
- `protocol`: ida e volta de cada mensagem, rejeição de mensagens malformadas, limites numéricos.
- `interpolation`: ordem dos snapshots, atraso fixo, interpolação de yaw pela menor volta, extrapolação limitada quando faltam pacotes.
- `room` com o transporte em memória: handshake, sala cheia, versão diferente, saída por tempo limite, fechamento da sala pelo anfitrião.
- `net-session` com o transporte em memória: `dmg` do convidado reduz a vida do Jason no anfitrião e o `world` seguinte traz a nova vida; `hit` chega só ao convidado alvo; `reset` chega a todos.
- Garantia de **não regressão solo**: teste de que `chooseTarget()` devolve o herói local e que nenhum gancho altera o caminho quando não há sessão.
- O teste de manifesto do PWA continua válido com `vendor/peerjs/` incluído.

**Manual:**
- Duas abas no `localhost` (WebRTC funciona na mesma máquina) e, depois de publicar, dois aparelhos em redes diferentes.
- Checklist: criar e entrar, ver o outro herói, dano ao Jason por ambos, meteoro e incêndio iguais nas duas telas, morte e renascimento de um jogador sem resetar o outro, anfitrião saindo.

## 10. Publicação no GitHub Pages

- O jogo já usa caminhos relativos (`./`) e `scope: './'` no manifesto; será confirmado servindo a partir de uma subpasta (`/repo/`).
- Workflow do GitHub Actions (`.github/workflows/pages.yml`) que roda `npm test`, `npm run pwa` e publica a pasta do projeto, excluindo `node_modules`, `*.bak`, `sky_guardian_threejs.zip` e `graphify-out/`.
- Limites do Pages respeitados: maior arquivo cerca de 14 MB; total cerca de 52 MB.
- Em plano gratuito o repositório precisa ser público (ver riscos).

## 11. Ordem de construção sugerida

1. `protocol`, `interpolation` e `transport` em memória, com testes.
2. `room` e `net-session` no transporte em memória, com testes.
3. Transporte PeerJS, `vendor-peerjs` e a aba Online.
4. Heróis remotos (`remote-hero`) e sincronização de pose.
5. Espelho do Jason e dos eventos (`world-mirror`) e os ganchos de dano.
6. Morte/renascimento online e escala da vida do Jason.
7. Workflow de publicação no Pages e passagem de teste manual com dois aparelhos.

## 12. Mudanças feitas ao planejar

Decididas ao ler o código para escrever o plano (`docs/superpowers/plans/2026-10-13-online-coop.md`):

1. O `build` do handshake é a constante `NET_BUILD` em `game/net/protocol.js`, não o hash do pré-cache do PWA (este só é conhecido depois que o service worker responde).
2. O `pose` leva `q` (quaternion) em vez de só `y` (yaw): o Superman voa com inclinação e rolagem.
3. Online, o loop de rede e o espelho continuam rodando durante a pausa; só o mundo simulado do anfitrião congela enquanto ele está no menu.
4. Módulo extra `game/net/rules.js` com as regras puras (escolha de alvo, acerto do Jason, escala de vida).
5. O `pose` inclui `char` e `skin`, para o remoto trocar de modelo sem mensagem extra.
6. `timeoutMs` passou de 5 s para 15 s: quem carrega um modelo de 14 MB (ou roda numa máquina lenta) pode travar a página por vários segundos, e o outro lado não distingue isso de uma queda; quedas reais chegam como evento `close`.
