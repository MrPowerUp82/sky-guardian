// Pure math for the minimap and full map. World coordinates are (x, z) in metres;
// map/canvas coordinates grow right (x) and down (z), so north (-z) is up.

// Pixels per metre of the pre-rendered static map: sharp but capped in size.
export function staticMapScale(span, maxSize = 2048, idealPxPerMetre = 1.3) {
  return Math.min(idealPxPerMetre, maxSize / span);
}

// Rotation that makes the aim direction (ax, az) point up on screen.
export function minimapRotation(ax, az) {
  if (Math.abs(ax) < 1e-6 && Math.abs(az) < 1e-6) return 0;
  return -Math.PI / 2 - Math.atan2(az, ax);
}

// Offset of a world point from the viewer, rotated into minimap screen space
// (up = aim direction). Returns pixels at `pxPerMetre`.
export function toMinimap(dx, dz, rotation, pxPerMetre) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { x: (dx * c - dz * s) * pxPerMetre, y: (dx * s + dz * c) * pxPerMetre };
}

// Keeps a marker inside a circle of `radius`; `clamped` tells whether it was
// outside (and so should be drawn as an edge arrow).
export function clampToCircle(x, y, radius) {
  const d = Math.hypot(x, y);
  if (d <= radius || d === 0) return { x, y, clamped: false, angle: Math.atan2(y, x) };
  return { x: x / d * radius, y: y / d * radius, clamped: true, angle: Math.atan2(y, x) };
}

// --- full map view (north-up, pan + zoom) -------------------------------------
export function defaultView(half) {
  return { cx: 0, cz: 0, zoom: 1, half };
}

export function clampView(view, minZoom = 1, maxZoom = 6) {
  const zoom = Math.min(maxZoom, Math.max(minZoom, view.zoom));
  // At zoom z the visible span is (2*half)/z, so the centre can move by half*(1-1/z).
  const limit = view.half * (1 - 1 / zoom);
  return {
    half: view.half,
    zoom,
    cx: Math.min(limit, Math.max(-limit, view.cx)),
    cz: Math.min(limit, Math.max(-limit, view.cz))
  };
}

// Canvas pixels per metre for a square canvas of `size` px showing the view.
export function viewScale(view, size) {
  return size / ((2 * view.half) / view.zoom);
}

export function worldToView(view, size, x, z) {
  const k = viewScale(view, size);
  return { x: size / 2 + (x - view.cx) * k, y: size / 2 + (z - view.cz) * k };
}

export function viewToWorld(view, size, px, py) {
  const k = viewScale(view, size);
  return { x: view.cx + (px - size / 2) / k, z: view.cz + (py - size / 2) / k };
}

// Zooms by `factor` keeping the world point under (px, py) fixed.
export function zoomAt(view, size, px, py, factor) {
  const before = viewToWorld(view, size, px, py);
  const zoomed = clampView({ ...view, zoom: view.zoom * factor });
  const after = viewToWorld(zoomed, size, px, py);
  return clampView({ ...zoomed, cx: zoomed.cx + (before.x - after.x), cz: zoomed.cz + (before.z - after.z) });
}

export function panBy(view, size, dxPx, dyPx) {
  const k = viewScale(view, size);
  return clampView({ ...view, cx: view.cx - dxPx / k, cz: view.cz - dyPx / k });
}
