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

export function saveCharacterId(storage, id) {
  if (!isCharacterId(id)) return false;
  try {
    storage?.setItem(CHARACTER_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
