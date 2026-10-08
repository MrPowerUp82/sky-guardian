// Pure device helpers (no DOM access) so they can be unit-tested in Node.

// `?touch=1` / `?touch=0` force the choice, which also makes the touch UI
// testable from a desktop browser.
export function isTouchDevice({ search = '', maxTouchPoints = 0, coarsePointer = false, userAgent = '' } = {}) {
  const forced = new URLSearchParams(search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (coarsePointer) return true;
  // iPadOS reports a desktop UA, so touch points are the tell there.
  return maxTouchPoints > 1 && /Mobi|Android|iPhone|iPad|iPod|Macintosh/.test(userAgent);
}

// Everything that scales with the machine. Desktop keeps the full V18 city;
// touch devices get a smaller map, fewer actors and lighter rendering.
export function qualityProfile(touch, devicePixelRatio = 1) {
  if (!touch) {
    return {
      roadCount: 15, traffic: 96, crowd: 120, trafficRadius: 200, npcRadius: 170,
      shadowMap: 2048, shadowRange: 170, clouds: 46, flocks: 7,
      fx: 'high', maxPixelRatio: Math.min(devicePixelRatio, 1.6), startPixelRatio: Math.min(devicePixelRatio, 1.6),
      minPixelRatio: .65, targetMs: 19
    };
  }
  const max = Math.min(devicePixelRatio, 1.25);
  return {
    roadCount: 11, traffic: 40, crowd: 36, trafficRadius: 140, npcRadius: 110,
    shadowMap: 1024, shadowRange: 120, clouds: 24, flocks: 3,
    fx: 'mobile', maxPixelRatio: max, startPixelRatio: Math.min(1, max),
    minPixelRatio: .5, targetMs: 24
  };
}
