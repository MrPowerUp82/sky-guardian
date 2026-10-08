# Configurador de Animações 2.0

Abra o projeto por HTTP e acesse `animation-configurator.html`.

## Fluxo recomendado

1. Escolha Superman ou Jason.
2. Escolha um slot (`fly`, `punch`, `attack1` etc.) e o clip correspondente.
3. Ajuste velocidade, fade, loop e orientação.
4. Ative “Mostrar esqueleto” para descobrir os bones.
5. Crie hitboxes/hurtboxes ligadas a bones como `fml_un_R_wrist`.
6. Na timeline, posicione o clip no frame do impacto, clique “Usar tempo atual” e crie um evento `damage`.
7. Clique “Aplicar no jogo neste navegador” e recarregue `index.html` para testar imediatamente.
8. Quando estiver satisfeito, exporte o JSON. Para tornar a configuração parte do projeto, substitua o arquivo correspondente em `config/`.

## Prioridade de carregamento

O jogo V8 procura, nesta ordem:

1. `localStorage` salvo pelo Configurador 2.0;
2. `config/superman-animation-config.json` ou `config/jason-animation-config.json`;
3. defaults internos do `main.js` caso o JSON não esteja disponível.

## Eventos suportados no runtime V8

- `damage`: aplica dano usando `hitboxId`, `radius`, `damage` e `knockback`.
- `heatVision`: testa a mira e aplica dano no boss.
- `cameraShake`: usa `strength` para tremer a câmera.
- `effect` e `note`: são preservados no JSON para expansões/IA, mas não executam gameplay nesta versão.

O tempo de cada evento é salvo em segundos locais do clip. O runtime considera a velocidade do slot ao disparar o evento.
