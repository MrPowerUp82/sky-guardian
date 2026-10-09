# Sky Guardian / Superman V17

> V17 corrige as animações do Superman e do Jason (pose de bind entre clips, golpes congelados, pouso/decolagem, personagens enterrados no asfalto) e melhora o combate: esquiva, poise do Jason, aviso de ataque, fúria, rounds e regeneração. Veja `CHANGELOG_V17.md`.

# Superman Three.js — Open City

Protótipo de fã em Three.js com o modelo Superman | MultiVersus e um boss Jason | MultiVersus, ambos carregados localmente. A cidade continua usando os pacotes CC0 já documentados em `ASSETS.md`.

## Rodar

Na pasta do projeto:

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`.

Não abra o `index.html` diretamente com `file://`, porque GLB e módulos ES precisam ser servidos por HTTP.

## Controles

- `W A S D`: mover / manobrar
- Mouse: mirar
- `F`: começar a voar / parar de voar (pouso automático)
- Durante o voo, `W` segue a mira em **3D**: mire para cima para subir e para baixo para descer
- Durante o voo, `S` recua na direção oposta à mira e `A/D` fazem strafe lateral
- `Shift + W` durante o voo: superaceleração progressiva até Mach 1+
- `E`: soco normal
- `Shift + E` ou `X`: super soco
- `C`: Leap Attack (no solo)
- segure `Q`: visão de calor contínua; solte para resfriar
- segure `G`: sopro congelante / Ice Breath para apagar incêndios
- `Espaço`: esquiva rápida com invulnerabilidade (no ar: impulso com giro)
- `R`: reiniciar luta/objetivos
- `Esc`: liberar o mouse

## Boss Jason

Jason nasce à frente do Superman, persegue o jogador pelas ruas e usa animações originais do GLB para idle, caminhada, combos, shoulder bash, hit reaction e derrota. Ele possui 180 HP no nível 1; a cada derrota volta em 7 s mais forte. Golpes leves desgastam o poise dele (só interrompem quando quebra), golpes pesados interrompem na hora, e um anel vermelho no chão avisa a área de cada ataque. O Superman possui 100 HP; ao chegar a zero, a luta reinicia automaticamente.

O modelo do Jason foi reduzido de aproximadamente 44,8 MB / 129 clips para aproximadamente 11,5 MB / 8 clips de gameplay, sem remover o mesh, texturas ou skeleton necessários.

## Observação de direitos

Este projeto continua sendo um fan prototype. Os personagens Superman, Jason Voorhees, MultiVersus e seus designs pertencem aos respectivos titulares. Consulte `ATTRIBUTION.md` e a página de origem de cada modelo antes de redistribuir/publicar.

## Configurador de animações 2.0 (V8)

Com o servidor rodando, abra:

`http://localhost:8080/animation-configurator.html`

A ferramenta permite visualizar todos os clips dos GLBs, corrigir orientação/espelhamento, inspecionar bones, criar hitboxes/hurtboxes e marcar eventos de dano diretamente na timeline. Use **Aplicar no jogo neste navegador** para testar sem editar código e **Exportar JSON** para enviar a configuração a uma IA.

Veja `ANIMATION_CONFIGURATOR.md` para o fluxo completo.

## V8 — Configuração de animação dirigida por dados

A V8 adiciona `animation-config-runtime.js` e a pasta `config/`. O jogo lê automaticamente os JSONs de Superman/Jason e usa seus slots, orientação, velocidade, fade e eventos de combate. O configurador 2.0 também pode aplicar uma configuração via `localStorage` para testar sem editar `main.js`.

Abra `animation-configurator.html`, configure o personagem, use **Aplicar no jogo neste navegador** e recarregue `index.html`. Para compartilhar a configuração, use **Exportar JSON**.


## V9 — Cidade e voo guiado pela mira

A malha urbana foi ampliada para nove avenidas por nove ruas, com quarteirões planejados por distrito: núcleo comercial mais vertical, zona intermediária mista e bordas com menor densidade. O gerador também cria parques, praças, faixas de pedestre, marcações de pista, mais tráfego, mais pedestres e um skyline decorativo além do limite jogável.

O voo não usa mais teclas separadas de subir/descer. `F` inicia o voo e `F` novamente encerra o voo com pouso automático na rua ou telhado abaixo do personagem. Enquanto o voo está ativo, a mira define o vetor 3D completo: `W` acelera exatamente para onde a câmera aponta, inclusive para cima ou para baixo.



## V11 — Grounding / personagens sem afundar

A V11 substitui a antiga suposição de que todo o chão estava em `Y=0` por superfícies visuais reais. Ruas, calçadas/pads e telhados agora participam do cálculo de altura. Superman, Jason e NPCs animados também recebem um **foot lock** pós-animação: o jogo acompanha bones de calcanhar/pé/dedos e corrige apenas o visual do modelo depois do `AnimationMixer`, sem alterar a física do personagem. Isso evita que animações de idle, caminhada, soco e pouso empurrem os pés para dentro do asfalto.

A correção é liberada suavemente durante decolagem/voo e reativada quando o personagem está no chão. Os NPCs passam a usar a altura real da rua/calçada em vez de `Y=0`.

## V10 — Visão de calor e voo supersônico

- **Visão de calor:** segure `Q`. Os feixes seguem a mira, respeitam oclusão por prédios, causam dano contínuo em Jason e superaquecem se usados por tempo demais. Solte `Q` para resfriar.
- **Voo supersônico:** durante o voo, segure `W + Shift`. A aceleração aumenta progressivamente até atravessar a barreira do som. O HUD mostra o Mach e a passagem por Mach 1 gera um boom sônico. Velocidade máxima ajustada: ~420 m/s (~1512 km/h / Mach 1,22).
- Em alta velocidade, a câmera abre o FOV e recua, aparecem rastros de velocidade e as curvas ganham inércia.


## V12 — visão de calor com hold-loop + idle aéreo

- **Visão de calor em duas fases:** ao pressionar `Q`, toca primeiro o clip autoral completo (`C003_Laser_Air` no ar ou `C003_Laser_Ground` no chão). Se `Q` continuar pressionado quando o clip termina, o jogo entra em um **hold-loop** construído a partir da parte final de menor movimento do mesmo clip e reproduzido em `LoopPingPong` para esconder a emenda. Ao soltar `Q`, o loop termina e a locomoção normal reassume suavemente.
- O GLB original não possui um clip separado chamado `Laser_*_Loop`; por isso o hold-loop é derivado do próprio clip autoral em runtime, sem inventar uma pose nova.
- **Desaceleração no ar:** quando a velocidade cai e não há comando de movimento, toca `C003_Flying_Stop` uma vez.
- **Parado no ar:** depois do `Flying_Stop`, Superman entra em `C003_S08_Emote_CharacterSelect_Loop` enquanto permanecer praticamente imóvel.
- `Flying_Stop` é interruptível: voltar a mover, atacar ou iniciar a visão de calor cancela a transição para não deixar os controles presos.
- O runtime do Superman agora preserva 15 clips, incluindo `C003_Laser_Ground` e `C003_S08_Emote_CharacterSelect_Loop`.


## V13 — Leap Attack

O GLB original do Superman contém dois clips específicos para esse movimento: `C003_LeapAttack` (1,88 s) e `C003_LeapAttackLand` (1,04 s). Eles foram restaurados no GLB otimizado do jogo.

Pressione `C` no solo. Se Jason estiver dentro do cone da mira, a uma distância útil e sem prédio bloqueando a linha de visão, o golpe trava o destino nele. Caso contrário, Superman salta na direção horizontal da mira. O deslocamento usa uma trajetória parabólica em world-space para respeitar a escala da cidade, enquanto os clips autorais cuidam da pose.

O ataque não atravessa prédios: a trajetória é encurtada antes da fachada. No touchdown, o jogo troca para `C003_LeapAttackLand`, cria uma onda de impacto, aplica dano/knockback em Jason e empurra atores leves próximos. O foot-lock é suspenso durante o salto e reativado na recuperação para evitar afundamento no chão.


## V15 — Reentrada cinematográfica

Ao voar para fora da atmosfera, Superman entra no cenário orbital. Para voltar, aponte para a Terra e avance. A aproximação inicia automaticamente uma sequência de reentrada com plasma, som, shake de câmera e FOV dinâmico. A cidade reaparece durante a descida e o controle é devolvido ainda em voo.

A escala Terra/Lua/Sol no cenário orbital é artisticamente comprimida para gameplay; as proporções astronômicas reais não cabem de forma prática na mesma escala da cidade.


## V16 — Emergências dinâmicas, meteoros e Ice Breath

A cidade agora gera emergências automaticamente enquanto o jogador está em gameplay normal, sem tela de aceitar missão. Há dois eventos principais:

- **Incêndio em prédio:** escolhe um prédio válido longe do Superman e cria de 1 a 3 focos em cobertura/fachadas. Esses incêndios são independentes de meteoros e podem surgir sozinhos.
- **Meteoro:** aparece com alerta, marcador e ETA. Durante a queda ele pode ser interceptado com **Super Punch** ou por uma colisão de voo a **Mach 1+**. Se atingir a cidade, o impacto cria de **3 a 6 focos de incêndio**, respeitando o limite global de 12 focos ativos.

Para apagar fogo, mantenha `G` pressionado e mire com a câmera. O Ice Breath usa alcance de 24 m e cone de aproximadamente 22° por lado, respeita oclusão por prédios e reduz a intensidade das chamas gradualmente. Os clips preservados do GLB original são:

- Solo: `C003_IceBreath` → `C003_IceBreath_Loop` → `C003_IceBreath_IntoIdle`
- Ar: `C003_Air_IceBreath` → `C003_Air_IceBreath_Loop` → `C003_Air_IceBreath_IntoIdle`

Ice Breath e visão de calor são mutuamente exclusivos. O sopro é cancelado de forma segura em morte, Leap Attack, decolagem/pouso, entrada em órbita, reentrada e reset. Eventos existentes congelam seus timers durante órbita/reentrada e retomam quando o gameplay da cidade volta.

O scheduler usa uma calma inicial de 30–45 s, janela de 45–90 s para incêndios independentes e 120–210 s para meteoros, com um intervalo global mínimo para evitar spam. O limite simultâneo é de 1 meteoro e 2 eventos independentes de incêndio.

### Ferramenta de desenvolvimento para animações

`tools/add-animation-clips.mjs` copia clips selecionados do GLB original para o GLB otimizado sem substituir mesh, skeleton ou texturas do runtime. Ela existe apenas para manutenção do projeto; o jogo não depende do GLB original em execução.

## V18 — visão de calor com Start / Loop / Exit (como o Ice Breath)

- Ao segurar `Q` (ou o botão CALOR no toque) a visão de calor agora toca **`Laser_*_Start` → `Laser_*_Loop` → `Laser_*_Exit`**, com variantes de chão (`Ground`) e de ar (`Air`). Antes, o loop era só a ponta final do clip, que no chão já voltava a ficar em pé.
- Os clips foram **gravados no GLB** (`tools/bake-subclips.mjs` + `tools/heat-vision-clips.json`) a partir dos clips autorais: o `Loop` é um ciclo contínuo (a ponta é misturada no começo, então a primeira e a última pose são iguais) e o `Exit` leva de volta à pose neutra.
- Seis slots configuráveis no configurador: `heatVision{Ground,Air}{Start,Loop,Exit}`. Se os clips novos estiverem ausentes, o jogo volta ao comportamento antigo.
- Soltar `Q` durante o Start deixa o Start terminar e vai direto para o Exit; mover-se durante o Exit cancela a saída.
- Para refazer os cortes: `node tools/bake-subclips.mjs assets/superman/Superman-game.glb tools/heat-vision-clips.json` (a partir de um GLB sem esses clips).

## V19 — pausa, gráficos, mapa e minimapa

- `P` ou `Esc` pausam (no toque, o botão **II**). `M` abre direto o mapa; tocar no minimapa faz o mesmo no celular.
- A aba **Gráficos** aplica tudo na hora e salva no aparelho (`localStorage`, chave `sky-guardian:graphics:v1`). Com **Resolução automática** ligada o jogo ajusta a escala sozinho; desligada, vale o controle de escala.
- URL: `?fx=off|low|mobile|high` e `?adaptive=off` ainda existem e definem apenas o estado inicial.

## V20 — The Flash

Abra **Pausa → Personagem** (ou `?character=flash`) para jogar de The Flash. Ele não voa: corre. **Shift** ativa a Força da Velocidade (raios, rastro e imagens residuais); correr contra um prédio alto o faz subir pela parede. Habilidades: `F` salto, `Espaço` esquiva relâmpago, `E` rajada de socos, `X` raio, `C` tornado, `G` vendaval (apaga fogo), `Q` tempo lento. No celular os mesmos botões ganham novos nomes.

## V21 — PWA (jogar offline)

- **Instalar:** no Chrome/Edge/Android aparece o botão **Instalar o jogo** na tela inicial; no iPhone/iPad use Compartilhar → Adicionar à Tela de Início. Precisa de **HTTPS** (ou `localhost`).
- **Offline:** na primeira visita online o jogo baixa os 91 modelos (~38 MB) em segundo plano; a tela inicial e o menu de pausa (aba Jogo) mostram o progresso e "pronto para jogar offline ✓". Depois disso funciona sem internet (aparece o selo OFFLINE quando a conexão cai).
- **three.js local:** o jogo não depende mais de CDN — as bibliotecas ficam em `vendor/three/` (`npm run vendor` as baixa de novo).
- **Atualizações:** arquivos de código usam rede primeiro (edições aparecem na hora, com o cache como reserva). Ao **adicionar ou remover arquivos** ou trocar um modelo `.glb`, rode `npm run pwa` (um teste avisa se esquecer). Só os modelos alterados são baixados de novo.
- Ícones: `python tools/make-icons.py`. `?nosw` desliga e limpa o service worker.
