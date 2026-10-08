// Pure layout helpers for the city planner. Nothing here touches three.js so the
// rules can be unit-tested in Node.

export function makeRoadCenters(count, spacing) {
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => (i - half) * spacing);
}

// Districts are defined as fractions of the city half-extent so the city can
// grow without retuning absolute distances.
export const DISTRICT_LIMITS = Object.freeze({ core: .26, mid: .6, residential: .82 });

export function classifyDistrict(radial, cityHalf) {
  const t = radial / cityHalf;
  if (t < DISTRICT_LIMITS.core) return 'core';
  if (t < DISTRICT_LIMITS.mid) return 'mid';
  if (t < DISTRICT_LIMITS.residential) return 'residential';
  return 'suburb';
}

// Kenney buildings are authored with their facade on +Z. Returns the Y rotation
// that makes a lot at offset (ox, oz) from its block centre face the nearest
// street; centre lots fall back to `fallback`.
export function lotFacingRotation(ox, oz, fallback = 0) {
  if (Math.abs(ox) < 1 && Math.abs(oz) < 1) return fallback;
  if (Math.abs(oz) >= Math.abs(ox)) return oz > 0 ? 0 : Math.PI;
  return ox > 0 ? Math.PI / 2 : -Math.PI / 2;
}

export function chunkKey(x, z, size) {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

// Moves `value` onto the nearest multiple of `step`. Used to snap the sun's
// shadow frustum to whole shadow-map texels so shadows do not shimmer while the
// camera moves.
export function snapToStep(value, step) {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

// Snaps a world-space focus point to the texel grid of a directional light.
// `lightDir` points from the target toward the light. Returns the adjusted point.
export function snapFocusToLightTexels(focus, lightDir, texelSize) {
  const len = Math.hypot(lightDir.x, lightDir.y, lightDir.z) || 1;
  const d = { x: lightDir.x / len, y: lightDir.y / len, z: lightDir.z / len };
  // right = normalize(worldUp x d), up = d x right
  let rx = d.z, ry = 0, rz = -d.x;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = d.y * rz - d.z * ry;
  const uy = d.z * rx - d.x * rz;
  const uz = d.x * ry - d.y * rx;
  const pr = focus.x * rx + focus.y * ry + focus.z * rz;
  const pu = focus.x * ux + focus.y * uy + focus.z * uz;
  const dr = snapToStep(pr, texelSize) - pr;
  const du = snapToStep(pu, texelSize) - pu;
  return {
    x: focus.x + rx * dr + ux * du,
    y: focus.y + ry * dr + uy * du,
    z: focus.z + rz * dr + uz * du
  };
}
