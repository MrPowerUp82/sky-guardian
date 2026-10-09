import { joystickKeys, clampKnob, lookDelta } from './touch-math.js';

// On-screen controls. They drive the game exactly like a keyboard: buttons and
// the stick dispatch the same KeyboardEvents the desktop handlers listen to, and
// dragging the right half of the screen turns the camera.
//
//   left half   -> floating joystick (WASD)
//   right half  -> look drag
//   buttons     -> actions (hold buttons stay pressed while the finger is down)

const BUTTONS = [
  // id, label, key, area, mode: 'tap' | 'hold' | 'latch'
  { id: 'heat', label: 'CALOR', code: 'KeyQ', area: 'a', mode: 'hold' },
  { id: 'ice', label: 'GELO', code: 'KeyG', area: 'b', mode: 'hold' },
  { id: 'turbo', label: 'TURBO', code: 'ShiftLeft', area: 'c', mode: 'latch' },
  { id: 'leap', label: 'LEAP', code: 'KeyC', area: 'd', mode: 'tap' },
  { id: 'super', label: 'SUPER', code: 'KeyX', area: 'e', mode: 'tap' },
  { id: 'dodge', label: 'ESQ.', code: 'Space', area: 'f', mode: 'tap' },
  { id: 'punch', label: 'SOCO', code: 'KeyE', area: 'g', mode: 'tap', big: true, plain: true },
  { id: 'fly', label: 'VOAR', code: 'KeyF', area: 'h', mode: 'tap', big: true }
];

const STICK_RADIUS = 52;

function keyEvent(type, code) {
  const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : 'Shift';
  return new KeyboardEvent(type, { code, key, bubbles: true, shiftKey: code === 'ShiftLeft' });
}

export function createTouchControls({ root = document.body, look, onMenu } = {}) {
  const ui = document.createElement('div');
  ui.id = 'touch-ui';
  ui.innerHTML = `
    <div id="touch-move" class="touch-zone"></div>
    <div id="touch-look" class="touch-zone"></div>
    <div id="touch-stick" hidden><div id="touch-stick-knob"></div></div>
    <div id="touch-buttons">${BUTTONS.map(b =>
      `<button type="button" class="touch-btn${b.big ? ' big' : ''}" data-id="${b.id}" style="grid-area:${b.area}">${b.label}</button>`).join('')}
    </div>
    <button type="button" id="touch-menu" aria-label="Menu">II</button>`;
  root.appendChild(ui);
  ui.addEventListener('contextmenu', e => e.preventDefault());

  const down = new Set();
  const press = code => { if (!down.has(code)) { down.add(code); window.dispatchEvent(keyEvent('keydown', code)); } };
  const release = code => { if (down.has(code)) { down.delete(code); window.dispatchEvent(keyEvent('keyup', code)); } };
  const buzz = () => navigator.vibrate?.(8);
  // Capture keeps the drag alive outside the element; it can throw for stale ids.
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* ignore */ } };

  // --- joystick ---------------------------------------------------------------
  const stick = ui.querySelector('#touch-stick');
  const knob = ui.querySelector('#touch-stick-knob');
  const moveZone = ui.querySelector('#touch-move');
  let stickId = null, stickOrigin = null;

  const applyStick = (dx, dy) => {
    const keys = joystickKeys(dx, dy, STICK_RADIUS);
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) (keys[code] ? press : release)(code);
  };
  const endStick = () => {
    stickId = null; stickOrigin = null; stick.hidden = true;
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) release(code);
  };
  moveZone.addEventListener('pointerdown', e => {
    if (stickId !== null) return;
    stickId = e.pointerId; stickOrigin = { x: e.clientX, y: e.clientY };
    capture(moveZone, e.pointerId);
    stick.style.left = `${e.clientX}px`; stick.style.top = `${e.clientY}px`;
    knob.style.transform = 'translate(-50%,-50%)';
    stick.hidden = false;
  });
  moveZone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    const dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y;
    const k = clampKnob(dx, dy, STICK_RADIUS);
    knob.style.transform = `translate(calc(-50% + ${k.x}px), calc(-50% + ${k.y}px))`;
    applyStick(dx, dy);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    moveZone.addEventListener(type, e => { if (e.pointerId === stickId) endStick(); });
  }

  // --- look -------------------------------------------------------------------
  const lookZone = ui.querySelector('#touch-look');
  let lookId = null, last = null;
  lookZone.addEventListener('pointerdown', e => {
    if (lookId !== null) return;
    lookId = e.pointerId; last = { x: e.clientX, y: e.clientY };
    capture(lookZone, e.pointerId);
  });
  lookZone.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId) return;
    const d = lookDelta(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
    look?.(d.yaw, d.pitch);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    lookZone.addEventListener(type, e => { if (e.pointerId === lookId) { lookId = null; last = null; } });
  }

  // --- buttons ----------------------------------------------------------------
  const buttonEls = new Map();
  for (const spec of BUTTONS) {
    const el = ui.querySelector(`[data-id="${spec.id}"]`);
    buttonEls.set(spec.id, el);
    let pointer = null;
    const fire = () => {
      buzz();
      el.classList.add('pressed');
      if (spec.mode === 'latch') {
        if (down.has(spec.code)) { release(spec.code); el.classList.remove('on'); }
        else { press(spec.code); el.classList.add('on'); }
      } else if (spec.plain && down.has('ShiftLeft')) {
        // With TURBO latched a punch would become a super punch; lift Shift for it.
        release('ShiftLeft'); press(spec.code); release(spec.code); press('ShiftLeft');
      } else {
        press(spec.code);
        if (spec.mode === 'tap') setTimeout(() => release(spec.code), 60);
      }
    };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (pointer !== null) return;
      pointer = e.pointerId;
      capture(el, e.pointerId);
      fire();
    });
    const up = e => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('pressed');
      if (spec.mode === 'hold') release(spec.code);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, up);
  }

  ui.querySelector('#touch-menu').addEventListener('pointerdown', e => { e.preventDefault(); onMenu?.(); });

  return {
    element: ui,
    // Relabels the action buttons for the active character: { heat: 'TEMPO', ... }.
    setLabels(labels = {}) {
      for (const [id, el] of buttonEls) if (labels[id]) el.textContent = labels[id];
    },
    // Releases everything (used when the menu opens so nothing stays stuck).
    releaseAll() {
      endStick();
      for (const code of [...down]) release(code);
      for (const el of buttonEls.values()) el.classList.remove('pressed', 'on');
    }
  };
}
