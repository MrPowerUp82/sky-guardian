# Atribuição do personagem

## Superman | MultiVersus

- Modelo: **Superman | MultiVersus**
- Autor do upload no Sketchfab: **King_45**
- Fonte: https://sketchfab.com/3d-models/superman-multiversus-339ed9e6d8ff438fa82de22ecc314cf1
- Licença indicada na página do Sketchfab: **Creative Commons Attribution (CC BY)**
- Uso nesta build: mesh, texturas, rig e uma seleção das animações incluídas no GLB baixado pelo usuário.

### Alterações feitas para esta build

O arquivo original foi tecnicamente otimizado para runtime web: foram preservados o modelo, materiais, texturas, skeleton e 15 clips úteis de gameplay, removendo os outros clips da cópia de runtime. O arquivo resultante é `assets/superman/Superman-game.glb`.

### Observação importante sobre propriedade intelectual

A licença do upload determina os termos atribuídos pelo autor/uploader do arquivo. Ela não deve ser interpretada como uma licença independente sobre a propriedade intelectual do personagem Superman, marcas da DC/Warner Bros. ou os assets originais de MultiVersus. Para publicação pública/comercial, verifique separadamente os direitos aplicáveis.

---

## Jason | MultiVersus

**3D model:** Jason | MultiVersus  
**Author/uploader:** King_45  
**Source:** https://sketchfab.com/3d-models/jason-multiversus-3927daaa6ca94650affd43b172ece2a9

O arquivo foi fornecido pelo usuário para integração neste fan prototype. Preserve este crédito e verifique a licença atual exibida pelo Sketchfab antes de redistribuir ou publicar o modelo.

Jason Voorhees / Friday the 13th / MultiVersus e elementos associados permanecem propriedade dos respectivos titulares de direitos.

---

## The Flash (personagem jogável)

**3D model:** The Flash Rigged (HatchXR)  
**Author:** nitwit.friends — https://sketchfab.com/nitwit.friends  
**Source:** https://sketchfab.com/3d-models/the-flash-rigged-hatchxr-1261cf0905be44c09f278533d2149c4c  
**License:** CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/

Arquivo usado sem alterações de geometria/texturas em `assets/flash/the-flash.glb`. As 12 animações (Mixamo) vêm no próprio arquivo; o jogo remove o deslocamento horizontal do quadril em tempo de execução. The Flash e DC Comics pertencem aos respectivos titulares de direitos; este é um protótipo de fã.

---

## Skin — Reverse Flash (The Flash)

**3D model:** Reverse Flash Rigged (HatchXR)  
**Author:** nitwit.friends — https://sketchfab.com/nitwit.friends  
**Source:** https://sketchfab.com/3d-models/reverse-flash-rigged-hatchxr-de686b3e51824ff99d3faffb040c5bf5  
**License:** CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/

Arquivo usado sem alterações em `assets/flash/reverse-flash.glb` (mesmo rig Mixamo e mesmas 12 animações do The Flash). Vibração, blur, olhos vermelhos e raios carmesim são efeitos feitos em tempo de execução (`game/fx/reverse-flash-fx.js`). Reverse Flash e DC Comics pertencem aos respectivos titulares de direitos; este é um protótipo de fã.

## Skin — Superman Armadura (Superman | MultiVersus, variante S11)

**3D model:** Superman | MultiVersus  
**Author:** King_45 — https://sketchfab.com/3d-models/superman-multiversus-339ed9e6d8ff438fa82de22ecc314cf1  
**License:** CC BY (conforme exibido pelo upload no Sketchfab)

O ZIP fornecido pelo usuário traz a variante S11 da malha (traje escuro com armadura). `tools/build-skin-glb.mjs` gerou `assets/superman/Superman-armor.glb`: mantém malha, texturas e rig e os mesmos 29 clips da skin clássica (os 6 sub-clips do laser foram cortados com `tools/bake-subclips.mjs`). Os direitos do personagem Superman / DC / MultiVersus não são cedidos pela licença do upload.
