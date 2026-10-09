import { defaultView, clampView, zoomAt, panBy } from './map-math.js';

const TABS = [['game', 'Jogo'], ['character', 'Personagem'], ['graphics', 'Gráficos'], ['map', 'Mapa'], ['controls', 'Controles']];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

/**
 * Pause menu with four tabs (game / graphics / map / controls). It owns only DOM
 * and input: the game supplies the schema, current values and callbacks.
 */
export function createPauseMenu({
  schema, getSettings, onChange, onResetGraphics, onResume, onRestart,
  gameMap, getMapState, getStatus, mapHalf, controlsSource, root = document.body,
  characters = [], getCharacterState = () => ({ activeId: '', loadingId: '', error: '' }), onSelectCharacter = () => {}
}) {
  let open = false;
  let tab = 'game';
  let view = defaultView(mapHalf);
  let mapCanvas = null;
  let lastStatus = 0;

  const tabButtons = new Map();
  const panels = new Map();

  // --- game tab -----------------------------------------------------------------
  const status = el('div', { class: 'pm-status' });
  const gamePanel = el('div', { class: 'pm-panel', 'data-tab': 'game' }, [
    el('div', { class: 'pm-actions' }, [
      el('button', { type: 'button', class: 'pm-primary', text: 'Continuar', onclick: () => onResume() }),
      el('button', { type: 'button', class: 'pm-secondary', text: 'Reiniciar missão', onclick: () => onRestart() })
    ]),
    status,
    el('p', { class: 'pm-hint', text: 'Pause também com Esc ou P. As configurações gráficas valem na hora e ficam salvas neste aparelho.' })
  ]);

  // --- graphics tab ---------------------------------------------------------------
  const controls = new Map();
  const gfxList = el('div', { class: 'pm-list' });
  for (const entry of schema) {
    const row = el('div', { class: 'pm-row', 'data-key': entry.key });
    const label = el('div', { class: 'pm-label' }, [el('span', { text: entry.label }), entry.hint ? el('small', { text: entry.hint }) : null]);
    let control;
    if (entry.type === 'toggle') {
      control = el('button', { type: 'button', class: 'pm-switch', role: 'switch', 'aria-label': entry.label,
        onclick: () => onChange(entry.key, !getSettings()[entry.key]) });
    } else if (entry.type === 'select') {
      control = el('div', { class: 'pm-seg', role: 'group', 'aria-label': entry.label }, entry.options.map(([value, text]) =>
        el('button', { type: 'button', 'data-value': String(value), text, onclick: () => { if (value !== 'custom') onChange(entry.key, value); } })));
    } else {
      const out = el('span', { class: 'pm-value' });
      const input = el('input', { type: 'range', min: entry.min, max: entry.max, step: entry.step, 'aria-label': entry.label,
        oninput: e => onChange(entry.key, Number(e.target.value)) });
      control = el('div', { class: 'pm-range' }, [input, out]);
      control._input = input; control._out = out;
    }
    row.append(label, control);
    gfxList.append(row);
    controls.set(entry.key, { entry, row, control });
  }
  const graphicsPanel = el('div', { class: 'pm-panel', 'data-tab': 'graphics' }, [
    gfxList,
    el('div', { class: 'pm-actions' }, [el('button', { type: 'button', class: 'pm-secondary', text: 'Restaurar padrão', onclick: () => onResetGraphics() })])
  ]);

  function syncGraphics() {
    const settings = getSettings();
    for (const { entry, row, control } of controls.values()) {
      const value = settings[entry.key];
      if (entry.type === 'toggle') control.setAttribute('aria-checked', String(!!value));
      else if (entry.type === 'select') {
        for (const b of control.children) {
          const selected = b.dataset.value === String(value);
          b.classList.toggle('on', selected);
          b.setAttribute('aria-pressed', String(selected));
          if (b.dataset.value === 'custom') b.disabled = true;
        }
      } else {
        control._input.value = value;
        control._out.textContent = entry.format ? entry.format(value) : String(value);
      }
      const enabled = entry.enabledWhen ? entry.enabledWhen(settings) : true;
      row.classList.toggle('disabled', !enabled);
      for (const input of row.querySelectorAll('input,button')) if (input.dataset.value !== 'custom') input.disabled = !enabled;
    }
  }

  // --- map tab ----------------------------------------------------------------------
  mapCanvas = el('canvas', { class: 'pm-map', width: 720, height: 720, 'aria-label': 'Mapa da cidade' });
  const legend = el('div', { class: 'pm-legend' }, [
    ['#ffffff', 'Você'], ['#ff3b4d', 'Jason'], ['#38e8ff', 'Anéis'], ['#ff9a2e', 'Incêndios'], ['#ff5a3c', 'Meteoro']
  ].map(([color, text]) => el('span', {}, [el('i', { style: `background:${color}` }), text])));
  const mapTools = el('div', { class: 'pm-maptools' }, [
    el('button', { type: 'button', text: '+', 'aria-label': 'Aproximar', onclick: () => zoom(1.5) }),
    el('button', { type: 'button', text: '−', 'aria-label': 'Afastar', onclick: () => zoom(1 / 1.5) }),
    el('button', { type: 'button', text: 'Centralizar em mim', onclick: () => centerOnHero() }),
    el('button', { type: 'button', text: 'Mapa inteiro', onclick: () => { view = defaultView(mapHalf); } })
  ]);
  const mapPanel = el('div', { class: 'pm-panel pm-mappanel', 'data-tab': 'map' }, [
    el('div', { class: 'pm-mapwrap' }, [mapCanvas]), el('div', { class: 'pm-mapside' }, [mapTools, legend,
      el('p', { class: 'pm-hint', text: 'Arraste para mover, role ou use dois dedos para aproximar.' })])
  ]);

  const size = () => mapCanvas.width;
  const zoom = f => { view = zoomAt(view, size(), size() / 2, size() / 2, f); };
  function centerOnHero() {
    const s = getMapState();
    view = clampView({ ...view, zoom: Math.max(view.zoom, 2.5), cx: s.hero.x, cz: s.hero.z });
  }
  const canvasPoint = e => {
    const r = mapCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * size() / r.width, y: (e.clientY - r.top) * size() / r.height };
  };
  const pointers = new Map();
  let pinch = null;
  mapCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = canvasPoint(e);
    view = zoomAt(view, size(), p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  mapCanvas.addEventListener('pointerdown', e => {
    mapCanvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, canvasPoint(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  mapCanvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId), now = canvasPoint(e);
    pointers.set(e.pointerId, now);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) view = zoomAt(view, size(), (a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch.dist);
      pinch.dist = dist;
    } else if (pointers.size === 1) {
      view = panBy(view, size(), now.x - prev.x, now.y - prev.y);
    }
  });
  for (const type of ['pointerup', 'pointercancel']) {
    mapCanvas.addEventListener(type, e => { pointers.delete(e.pointerId); pinch = null; });
  }
  mapCanvas.addEventListener('dblclick', () => centerOnHero());

  // --- character tab --------------------------------------------------------------
  const characterGrid = el('div', { class: 'pm-chars' });
  const characterNote = el('p', { class: 'pm-hint', text: 'Trocar de personagem reinicia a missão. Cada herói tem habilidades exclusivas.' });
  const characterPanel = el('div', { class: 'pm-panel', 'data-tab': 'character' }, [characterGrid, characterNote]);

  function syncCharacters() {
    const { activeId, loadingId, error } = getCharacterState();
    characterGrid.replaceChildren(...characters.map(c => {
      const active = c.id === activeId, loading = c.id === loadingId;
      const button = el('button', {
        type: 'button', class: active ? 'pm-secondary on' : 'pm-primary',
        text: active ? 'Em uso' : loading ? 'Carregando…' : `Jogar com ${c.name}`,
        onclick: () => onSelectCharacter(c.id)
      });
      button.disabled = active || !!loadingId;
      return el('article', { class: `pm-char${active ? ' active' : ''}`, style: `--accent:${c.accent};--accent2:${c.accent2}` }, [
        el('header', {}, [
          el('div', { class: 'pm-emblem', text: c.emblem, 'aria-hidden': 'true' }),
          el('div', {}, [el('h3', { text: c.name }), el('p', { text: c.tagline }), el('small', { text: c.credit })])
        ]),
        el('ul', {}, c.abilities.map(a => el('li', {}, [el('kbd', { text: a.key }), el('span', {}, [el('b', { text: a.name }), ` — ${a.desc}`])]))),
        button
      ]);
    }));
    characterNote.textContent = error || 'Trocar de personagem reinicia a missão. Cada herói tem habilidades exclusivas.';
    characterNote.classList.toggle('pm-error', !!error);
  }

  // --- controls tab ---------------------------------------------------------------
  const controlsPanel = el('div', { class: 'pm-panel', 'data-tab': 'controls' });
  function syncControls() { controlsPanel.replaceChildren(...(controlsSource?.() || [])); }

  // --- shell ----------------------------------------------------------------------
  for (const [id, text] of TABS) {
    tabButtons.set(id, el('button', { type: 'button', role: 'tab', text, onclick: () => show(id) }));
  }
  for (const panel of [gamePanel, characterPanel, graphicsPanel, mapPanel, controlsPanel]) panels.set(panel.dataset.tab, panel);
  const card = el('div', { class: 'pm-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu de pausa' }, [
    el('div', { class: 'pm-head' }, [el('h2', { text: 'PAUSADO' }), el('div', { class: 'pm-tabs', role: 'tablist' }, [...tabButtons.values()]),
      el('button', { type: 'button', class: 'pm-close', 'aria-label': 'Continuar', text: '✕', onclick: () => onResume() })]),
    el('div', { class: 'pm-body' }, [...panels.values()])
  ]);
  const overlay = el('div', { id: 'pause-menu', hidden: '' }, [card]);
  overlay.addEventListener('contextmenu', e => e.preventDefault());
  root.append(overlay);

  function show(id) {
    tab = id;
    for (const [name, b] of tabButtons) { b.classList.toggle('on', name === id); b.setAttribute('aria-selected', String(name === id)); }
    for (const [name, p] of panels) p.hidden = name !== id;
    if (id === 'graphics') syncGraphics();
    if (id === 'character') syncCharacters();
    if (id === 'controls') syncControls();
    if (id === 'game') syncStatus();
    if (id === 'map') fitMap();
  }

  function syncStatus() {
    status.replaceChildren(...getStatus().map(([k, v]) => el('div', {}, [el('span', { text: k }), el('b', { text: v })])));
  }

  // Keeps the canvas bitmap sharp for its on-screen size (square).
  function fitMap() {
    const rect = mapCanvas.getBoundingClientRect();
    const px = Math.round(Math.min(900, Math.max(320, rect.width * (window.devicePixelRatio > 1 ? 1.5 : 1))));
    if (rect.width > 0 && Math.abs(mapCanvas.width - px) > 8) { mapCanvas.width = mapCanvas.height = px; }
  }

  show('game');
  return {
    element: overlay,
    isOpen: () => open,
    open(startTab = 'game') {
      open = true; overlay.hidden = false;
      show(startTab);
      requestAnimationFrame(() => { if (tab === 'map') fitMap(); });
    },
    close() { open = false; overlay.hidden = true; pointers.clear(); pinch = null; },
    // Called every frame while open: keeps the map and values live.
    tick() {
      if (!open) return;
      if (tab === 'map' && gameMap?.ready) gameMap.drawFull(mapCanvas, view, getMapState());
      if (tab === 'game' && performance.now() - lastStatus > 250) { lastStatus = performance.now(); syncStatus(); }
    },
    refresh() { if (!open) return; if (tab === 'graphics') syncGraphics(); if (tab === 'character') syncCharacters(); if (tab === 'controls') syncControls(); },
    syncGraphics
  };
}
