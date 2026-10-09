# Assets externos e licenças

## Personagem — Superman | MultiVersus

- Autor do upload: King_45
- Fonte: https://sketchfab.com/3d-models/superman-multiversus-339ed9e6d8ff438fa82de22ecc314cf1
- Licença mostrada na página do Sketchfab: Creative Commons Attribution (CC BY).
- Arquivo fornecido pelo usuário: `Superman.glb` dentro do ZIP original.
- Runtime nesta build: `assets/superman/Superman-game.glb`.
- O runtime contém mesh, texturas PBR, rig e 15 animações selecionadas do GLB original.

Clips mantidos:

- `C003_Idle_01`
- `C003_Flying_Hold`
- `C003_Flying`
- `C003_Flying_Intro`
- `C003_Flying_Stop`
- `C003_S08_Emote_CharacterSelect_Loop`
- `C003_Flying_U_Additive`
- `C003_Flying_D_Additive`
- `C003_Punch_01`
- `C003_N_Attack_01`
- `C003_Laser_Air`
- `C003_Laser_Ground`
- `C003_Laser_Ground_Start`, `C003_Laser_Ground_Loop`, `C003_Laser_Ground_Exit` (V18: cortados de `C003_Laser_Ground` com `tools/bake-subclips.mjs`)
- `C003_Laser_Air_Start`, `C003_Laser_Air_Loop`, `C003_Laser_Air_Exit` (V18: cortados de `C003_Laser_Air`)
- `C003_Land`
- `C003_Jump_01`
- `C003_Run_01`

A licença CC BY do upload não deve ser confundida com uma cessão dos direitos do personagem/branding Superman ou de MultiVersus.

## Cidade — Kenney City Kit (Commercial)

- Fonte oficial: https://kenney.nl/assets/city-kit-commercial
- Licença indicada pelo autor: Creative Commons CC0
- Uso: prédios comerciais, arranha-céus (`building-a…n`, `building-skyscraper-a…e`) e prédios `low-detail-*` para o horizonte decorativo.
- Runtime (V18): cópia local em `assets/kenney/city-kit-commercial/`.

## Subúrbios — Kenney City Kit (Suburban)

- Fonte oficial: https://kenney.nl/assets/city-kit-suburban
- Licença indicada pelo autor: Creative Commons CC0
- Uso: casas `building-type-a…l` e árvores `tree-large` / `tree-small` nos bairros residenciais e subúrbios.
- Runtime (V18): cópia local em `assets/kenney/city-kit-suburban/`.

## Ruas, postes e semáforos — Kenney City Kit (Roads)

- Fonte oficial: https://kenney.nl/assets/city-kit-roads
- Licença indicada pelo autor: Creative Commons CC0
- Uso: ruas, cruzamentos, postes (`light-curved`, `light-square`), semáforos, cones, barreiras de obra, caçamba e placa de rua.
- Runtime (V18): cópia local em `assets/kenney/city-kit-roads/`.

## Veículos — Kenney Car Kit

- Fonte oficial: https://kenney.nl/assets/car-kit
- Licença indicada pelo autor: Creative Commons CC0
- Uso: sedans, SUVs, táxi, viatura, hatch esportivo, van, entrega, caminhão, caminhão de lixo, ambulância e caminhão de bombeiros.
- Runtime (V18): cópia local em `assets/kenney/car-kit/`.

## Vegetação — Kenney Nature Kit

- Fonte oficial: https://kenney.nl/assets/nature-kit
- Licença indicada pelo autor: Creative Commons CC0
- Uso: árvores, arbustos, flores e pedras (parques, calçadas e quintais).
- Runtime (V18): cópia local em `assets/kenney/nature-kit/`.

## NPCs — Kenney Mini Characters

- Fonte oficial: https://kenney.nl/assets/mini-characters
- Licença indicada pelo autor: Creative Commons CC0
- Uso: os 12 personagens (`female-a…f`, `male-a…f`) como pedestres.
- Runtime (V18): cópia local em `assets/kenney/mini-characters/`.

## GLBs Kenney locais e mirror de reserva

Desde a V18 os GLBs da cidade ficam em `assets/kenney/<pack>/…` (≈12 MB, CC0, baixados do mirror `Hidencod/tge-assets`). O jogo carrega o arquivo local primeiro e só usa o mirror
`https://raw.githubusercontent.com/Hidencod/tge-assets/main/packs/...` se um arquivo local estiver ausente.

O catálogo do mirror registra os packs utilizados como Kenney / `CC0-1.0`.

## Efeitos V18

Céu, sol, nuvens, pássaros, partículas e pós-processamento (bloom, borrão radial de velocidade, aberração cromática, vinheta) são procedurais — não usam assets externos.

## Jason | MultiVersus — boss local

- Autor do upload: King_45
- Origem fornecida pelo usuário: https://sketchfab.com/3d-models/jason-multiversus-3927daaa6ca94650affd43b172ece2a9
- Arquivo original fornecido pelo usuário: `Jason.glb` (~44,8 MB, 129 animações)
- Arquivo runtime neste projeto: `assets/jason/Jason-game.glb` (~11,5 MB, 8 animações)
- Clips mantidos: `Jason_Nav_Idle`, `Jason_Walk`, `Jason_Attack_Combo_01`, `Jason_Attack_Combo_02`, `Jason_Attack_Combo_03`, `Jason_Attack_Dash_Shoulder_Bash`, `Jason_HR_Deflect`, `Jason_HR_Flyback_B_Enter`.
- O arquivo é usado apenas no protótipo de fã; mantenha o crédito e confirme a licença vigente na página do Sketchfab antes de redistribuição.

## The Flash — personagem jogável (V20)

- Modelo: **The Flash Rigged (HatchXR)** por nitwit.friends — https://sketchfab.com/3d-models/the-flash-rigged-hatchxr-1261cf0905be44c09f278533d2149c4c — licença **CC BY 4.0**.
- Runtime: `assets/flash/the-flash.glb` (~1,5 MB, 5,9 mil triângulos, rig Mixamo de 66 ossos).
- Clips originais: `stand`, `walk`, `walkLeft`, `walkRight`, `run`, `strafeLeft`, `strafeRight`, `jumpUp`, `jumpDown`, `punch` (combo de 8 socos), `waveHello` e a pose `mixamo.com` (T-pose). O jogo usa `stand`, `walk`, `run`, `jumpUp`, `jumpDown` e `punch`.
- Não há clips de voo, laser ou sopro: as habilidades exclusivas usam esses clips com velocidade e rotação procedurais.
