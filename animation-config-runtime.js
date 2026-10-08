export function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeCharacterConfig(data, fallback) {
  const base = deepClone(fallback || {});
  const src = data && typeof data === 'object' ? data : {};
  const out = { ...base, ...src };
  out.schemaVersion = Number(out.schemaVersion || 2);
  out.transform = { ...(base.transform || {}), ...(src.transform || {}) };
  out.transform.rotationDeg = { ...(base.transform?.rotationDeg || {x:0,y:0,z:0}), ...(src.transform?.rotationDeg || {}) };
  out.transform.mirror = { ...(base.transform?.mirror || {x:false,y:false,z:false}), ...(src.transform?.mirror || {}) };
  out.slots = { ...(base.slots || {}), ...(src.slots || {}) };
  for (const [name, slot] of Object.entries(out.slots)) {
    const baseSlot = base.slots?.[name] || {};
    out.slots[name] = {
      speed: 1, loop: true, fade: .12, removeRootMotion: false, events: [],
      ...baseSlot, ...(slot || {}),
      events: Array.isArray(slot?.events) ? slot.events : (Array.isArray(baseSlot.events) ? baseSlot.events : [])
    };
  }
  out.hitboxes = Array.isArray(src.hitboxes) ? src.hitboxes : (Array.isArray(base.hitboxes) ? base.hitboxes : []);
  return out;
}

export async function loadCharacterConfig(url, fallback, storageKey = '') {
  if (storageKey) {
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) return normalizeCharacterConfig(JSON.parse(cached), fallback);
    } catch (error) {
      console.warn(`Animation config localStorage ignored: ${storageKey}`, error);
    }
  }
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return normalizeCharacterConfig(await response.json(), fallback);
  } catch (error) {
    console.warn(`Animation config fallback: ${url}`, error);
    return normalizeCharacterConfig(fallback, fallback);
  }
}

export function slotConfig(config, slotName, fallbacks = {}) {
  const src = config?.slots?.[slotName] || {};
  return {
    clip: src.clip || fallbacks.clip || '',
    speed: finite(src.speed, fallbacks.speed ?? 1, .05, 4),
    loop: src.loop ?? fallbacks.loop ?? true,
    fade: finite(src.fade, fallbacks.fade ?? .12, 0, 3),
    removeRootMotion: src.removeRootMotion ?? fallbacks.removeRootMotion ?? false,
    events: Array.isArray(src.events) ? src.events : [],
    note: src.note || ''
  };
}

export function hitboxById(config, id) {
  if (!id) return null;
  return (config?.hitboxes || []).find(h => h.id === id) || null;
}

export function finite(value, fallback, min=-Infinity, max=Infinity) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function queueSlotEvents(config, slotName, speed=1) {
  const slot = slotConfig(config, slotName);
  const scale = Math.max(.05, Math.abs(Number(speed) || 1));
  return slot.events
    .filter(e => Number.isFinite(Number(e.time)) && Number(e.time) >= 0)
    .map(e => ({ event: deepClone(e), remaining: Number(e.time) / scale }))
    .sort((a,b) => a.remaining - b.remaining);
}
