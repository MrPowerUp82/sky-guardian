// Graphics settings: schema (drives the pause-menu UI), presets, validation and
// persistence. Pure module: storage is injected so it can be tested in Node.

export const STORAGE_KEY = 'sky-guardian:graphics:v1';

// Order matters: it is the order controls appear in the menu.
export const SCHEMA = [
  { key: 'preset', label: 'Predefinição', type: 'select', options: [
    ['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['custom', 'Personalizada']
  ] },
  { key: 'resolutionAuto', label: 'Resolução automática', type: 'toggle', hint: 'Ajusta a resolução para manter a fluidez' },
  { key: 'resolutionScale', label: 'Escala de resolução', type: 'range', min: .5, max: 2, step: .05, format: v => `${Math.round(v * 100)}%`, enabledWhen: s => !s.resolutionAuto },
  { key: 'shadows', label: 'Sombras', type: 'select', options: [['off', 'Desligadas'], ['low', 'Baixas'], ['high', 'Altas']] },
  { key: 'msaa', label: 'Suavização de bordas', type: 'select', options: [[0, 'Desligada'], [2, '2x'], [4, '4x']] },
  { key: 'bloom', label: 'Brilho (bloom)', type: 'toggle' },
  { key: 'cameraFx', label: 'Efeitos de câmera', type: 'toggle', hint: 'Desfoque de velocidade e aberração nos impactos' },
  { key: 'viewDistance', label: 'Distância de visão', type: 'select', options: [['near', 'Curta'], ['normal', 'Normal'], ['far', 'Longa']] },
  { key: 'actorDistance', label: 'Carros e pedestres', type: 'select', options: [['near', 'Perto'], ['normal', 'Normal'], ['far', 'Longe']], hint: 'Distância em que aparecem' },
  { key: 'ambient', label: 'Nuvens e pássaros', type: 'toggle' },
  { key: 'particles', label: 'Partículas', type: 'select', options: [['off', 'Desligadas'], ['reduced', 'Reduzidas'], ['full', 'Completas']] },
  { key: 'minimap', label: 'Minimapa', type: 'toggle' },
  { key: 'showFps', label: 'Mostrar FPS', type: 'toggle' }
];

// Settings that a preset controls. Anything else (minimap, FPS...) is untouched.
export const PRESET_KEYS = ['resolutionAuto', 'shadows', 'msaa', 'bloom', 'cameraFx', 'viewDistance', 'actorDistance', 'ambient', 'particles'];

export const PRESETS = {
  low: { resolutionAuto: true, shadows: 'off', msaa: 0, bloom: false, cameraFx: false, viewDistance: 'near', actorDistance: 'near', ambient: false, particles: 'reduced' },
  medium: { resolutionAuto: true, shadows: 'low', msaa: 0, bloom: false, cameraFx: true, viewDistance: 'normal', actorDistance: 'normal', ambient: true, particles: 'reduced' },
  high: { resolutionAuto: true, shadows: 'high', msaa: 4, bloom: true, cameraFx: true, viewDistance: 'normal', actorDistance: 'normal', ambient: true, particles: 'full' }
};

// What "Automática" means on this machine.
export function autoPreset(touch) {
  return touch ? PRESETS.medium : PRESETS.high;
}

export function defaultSettings(touch = false) {
  return {
    preset: 'auto',
    ...autoPreset(touch),
    resolutionScale: 1,
    minimap: true,
    showFps: false
  };
}

const ENUMS = Object.fromEntries(SCHEMA.filter(e => e.type === 'select').map(e => [e.key, e.options.map(o => o[0])]));
const RANGES = Object.fromEntries(SCHEMA.filter(e => e.type === 'range').map(e => [e.key, e]));

// Coerces untrusted stored values into a complete, valid settings object.
export function sanitize(raw, touch = false) {
  const base = defaultSettings(touch);
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...base };
  for (const entry of SCHEMA) {
    const { key } = entry;
    if (!(key in src)) continue;
    const v = src[key];
    if (entry.type === 'toggle') out[key] = typeof v === 'boolean' ? v : base[key];
    else if (entry.type === 'select') out[key] = ENUMS[key].includes(v) ? v : base[key];
    else if (entry.type === 'range') {
      const n = Number(v);
      out[key] = Number.isFinite(n) ? Math.min(RANGES[key].max, Math.max(RANGES[key].min, n)) : base[key];
    }
  }
  // 'auto' always means the machine default, whatever else was stored.
  if (out.preset === 'auto') Object.assign(out, autoPreset(touch));
  else if (PRESETS[out.preset]) Object.assign(out, PRESETS[out.preset]);
  return out;
}

// Which named preset (if any) these settings match.
export function detectPreset(settings, touch = false) {
  const matches = preset => PRESET_KEYS.every(k => settings[k] === preset[k]);
  for (const name of ['low', 'medium', 'high']) {
    if (matches(PRESETS[name])) return matches(autoPreset(touch)) && settings.preset === 'auto' ? 'auto' : name;
  }
  return 'custom';
}

// Applies one change coming from the UI and keeps `preset` consistent.
export function applyChange(settings, key, value, touch = false) {
  const next = { ...settings };
  if (key === 'preset') {
    next.preset = value;
    if (value === 'auto') Object.assign(next, autoPreset(touch));
    else if (PRESETS[value]) Object.assign(next, PRESETS[value]);
    return sanitize(next, touch);
  }
  next[key] = value;
  if (PRESET_KEYS.includes(key)) next.preset = detectPresetAfterEdit(next, touch);
  return sanitize(next, touch);
}

function detectPresetAfterEdit(settings, touch) {
  const named = ['low', 'medium', 'high'].find(n => PRESET_KEYS.every(k => settings[k] === PRESETS[n][k]));
  if (!named) return 'custom';
  // Landing exactly on the machine's default reads as "Automática".
  const auto = autoPreset(touch);
  return PRESET_KEYS.every(k => settings[k] === auto[k]) ? 'auto' : named;
}

// Concrete numbers the renderer uses for each choice.
export const SHADOW_LEVELS = { off: null, low: { map: 1024, range: 120 }, high: { map: 2048, range: 170 } };
export const FOG_SCALE = { near: 1.6, normal: 1, far: .6 };
export const ACTOR_SCALE = { near: .6, normal: 1, far: 1.4 };
export const PARTICLE_DENSITY = { off: 0, reduced: .5, full: 1 };

export function loadSettings(storage, touch = false) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitize(text ? JSON.parse(text) : null, touch);
  } catch {
    return defaultSettings(touch);
  }
}

export function saveSettings(storage, settings) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
