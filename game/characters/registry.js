// Playable characters: metadata only (no three.js), so the menu, the touch UI and
// the tests share one source of truth.

export const CHARACTER_STORAGE_KEY = 'sky-guardian:character';

export const CHARACTERS = Object.freeze([
  {
    id: 'superman',
    name: 'Superman',
    tagline: 'O Homem de Aço',
    emblem: 'S',
    accent: '#2a6bff',
    accent2: '#e0212b',
    modelUrl: './assets/superman/Superman-game.glb',
    credit: 'Modelo: King_45 (Sketchfab) · CC BY',
    skins: [
      { id: 'classic', name: 'Clássico', modelUrl: './assets/superman/Superman-game.glb', credit: 'Modelo: King_45 (Sketchfab) · CC BY', swatch: ['#2a6bff', '#e0212b'] },
      { id: 'armor', name: 'Armadura (MultiVersus)', modelUrl: './assets/superman/Superman-armor.glb', credit: 'Modelo: King_45 (Sketchfab) · CC BY', swatch: ['#26303c', '#8fb8bd'] }
    ],
    canFly: true,
    energyLabel: 'Visão de calor',
    abilities: [
      { key: 'F', name: 'Voo', desc: 'Decola e voa na direção da mira; Shift + W acelera até Mach 1+ e alcança o espaço.' },
      { key: 'Q', name: 'Visão de calor', desc: 'Raio contínuo (segure). Superaquece se usado por muito tempo.' },
      { key: 'G', name: 'Sopro congelante', desc: 'Apaga incêndios e congela o que estiver à frente (segure).' },
      { key: 'E', name: 'Soco / Super soco', desc: 'Soco com dano em área; Shift + E ou X é o super soco, que também intercepta meteoros.' },
      { key: 'C', name: 'Leap attack', desc: 'Salto com impacto em área.' },
      { key: 'Espaço', name: 'Esquiva', desc: 'Passo rápido invulnerável.' }
    ],
    touchLabels: { heat: 'CALOR', ice: 'GELO', turbo: 'TURBO', leap: 'LEAP', super: 'SUPER', dodge: 'ESQ.', punch: 'SOCO', fly: 'VOAR' }
  },
  {
    id: 'flash',
    name: 'The Flash',
    tagline: 'O Velocista Escarlate',
    emblem: '⚡',
    accent: '#e0212b',
    accent2: '#ffd23a',
    modelUrl: './assets/flash/the-flash.glb',
    credit: 'Modelo: nitwit.friends (Sketchfab) · CC BY 4.0',
    skins: [
      { id: 'classic', name: 'Clássico', modelUrl: './assets/flash/the-flash.glb', credit: 'Modelo: nitwit.friends (Sketchfab) · CC BY 4.0', swatch: ['#e0212b', '#ffd23a'] },
      // Vibrates so fast it blurs, red eyes, red lightning (see game/fx/reverse-flash-fx.js).
      { id: 'reverse', name: 'Flash Reverso', modelUrl: './assets/flash/reverse-flash.glb', credit: 'Modelo: nitwit.friends (Sketchfab) · CC BY 4.0', swatch: ['#d8c23a', '#c4161c'], fx: 'reverse-flash' }
    ],
    canFly: false,
    energyLabel: 'Força da Velocidade',
    abilities: [
      { key: 'Shift', name: 'Força da Velocidade', desc: 'Corrida supersônica com raios e rastro. Correr contra um prédio faz o Flash subir pela parede.' },
      { key: 'F', name: 'Salto relâmpago', desc: 'Pulo alto com impulso elétrico; aperte de novo no ar para um segundo pulo.' },
      { key: 'Espaço', name: 'Esquiva relâmpago', desc: 'Dash instantâneo de vários metros, invulnerável, deixando uma imagem residual.' },
      { key: 'E', name: 'Rajada de socos', desc: 'Corre até o Jason e desfere uma sequência de 8 socos em um instante.' },
      { key: 'X', name: 'Raio arremessado', desc: 'Dispara um relâmpago pela mira: fere o Jason e destrói meteoros.' },
      { key: 'C', name: 'Tornado relâmpago', desc: 'Gira em alta velocidade: empurra, fere o Jason e apaga fogo em volta.' },
      { key: 'G', name: 'Vendaval veloz', desc: 'Sopra um cone de vento elétrico que apaga incêndios (segure).' },
      { key: 'Q', name: 'Tempo lento', desc: 'O mundo desacelera enquanto o Flash continua em velocidade normal (segure).' }
    ],
    touchLabels: { heat: 'TEMPO', ice: 'VENTO', turbo: 'SPRINT', leap: 'TORNADO', super: 'RAIO', dodge: 'ESQ.', punch: 'SOCOS', fly: 'PULO' }
  }
]);

export const DEFAULT_CHARACTER = 'superman';

export function getCharacter(id) {
  return CHARACTERS.find(c => c.id === id) || CHARACTERS.find(c => c.id === DEFAULT_CHARACTER);
}

export function isCharacterId(id) {
  return CHARACTERS.some(c => c.id === id);
}

export function loadCharacterId(storage) {
  try {
    const id = storage?.getItem(CHARACTER_STORAGE_KEY);
    return isCharacterId(id) ? id : DEFAULT_CHARACTER;
  } catch {
    return DEFAULT_CHARACTER;
  }
}

// --- skins ------------------------------------------------------------------------
// Every character has at least one skin; the first is the default. The chosen skin
// of each character is stored as one JSON map { characterId: skinId }.

export const SKIN_STORAGE_KEY = 'sky-guardian:skins';

export function getSkin(characterId, skinId) {
  const skins = getCharacter(characterId).skins;
  return skins.find(s => s.id === skinId) || skins[0];
}

export function loadSkinIds(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(SKIN_STORAGE_KEY) || '{}');
    return Object.fromEntries(CHARACTERS.map(c => [c.id, getSkin(c.id, raw?.[c.id]).id]));
  } catch {
    return Object.fromEntries(CHARACTERS.map(c => [c.id, c.skins[0].id]));
  }
}

export function saveSkinId(storage, characterId, skinId) {
  if (!isCharacterId(characterId) || getSkin(characterId, skinId).id !== skinId) return false;
  try {
    storage?.setItem(SKIN_STORAGE_KEY, JSON.stringify({ ...loadSkinIds(storage), [characterId]: skinId }));
    return true;
  } catch {
    return false;
  }
}

export function saveCharacterId(storage, id) {
  if (!isCharacterId(id)) return false;
  try {
    storage?.setItem(CHARACTER_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
