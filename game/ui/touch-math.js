// Pure math for the on-screen joystick.

const NONE = Object.freeze({ KeyW: false, KeyA: false, KeyS: false, KeyD: false });

/**
 * Converts a thumb offset (px, y down) into WASD key states.
 * `radius` is the full-deflection distance. Inside the dead zone nothing is
 * pressed; past it the stick is 8-way: a direction counts when its axis
 * component is above `diag` of the unit vector.
 */
export function joystickKeys(dx, dy, radius, { dead = .22, diag = .38 } = {}) {
  const len = Math.hypot(dx, dy);
  if (!(radius > 0) || len / radius < dead) return NONE;
  const ux = dx / len, uy = dy / len;
  return {
    KeyW: -uy > diag,
    KeyS: uy > diag,
    KeyA: ux < -diag,
    KeyD: ux > diag
  };
}

// Clamps the knob inside the base circle.
export function clampKnob(dx, dy, radius) {
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: dx, y: dy };
  return { x: dx / len * radius, y: dy / len * radius };
}

// Touch drag -> camera angle deltas (radians); y is inverted like mouse look.
export function lookDelta(dxPx, dyPx, { yawPerPx = .0052, pitchPerPx = .0042 } = {}) {
  return { yaw: -dxPx * yawPerPx, pitch: -dyPx * pitchPerPx };
}
