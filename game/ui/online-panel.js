import { normalizeRoomCode, NET_TUNING } from '../net/protocol.js';
import { getCharacter, getSkin } from '../characters/registry.js';

// The "Online" tab of the pause menu: pure DOM, no game logic. The game supplies the
// current state and the callbacks.

export const ERROR_TEXT = {
  full: 'A sala está cheia (máximo de 4 jogadores).',
  version: 'Esta sala usa outra versão do jogo. Recarregue a página e tente de novo.',
  closed: 'A sala foi encerrada.',
  taken: 'Esse código já está em uso. Tente criar a sala de novo.',
  'not-found': 'Sala não encontrada. Confira o código.',
  network: 'Não foi possível conectar. Sua rede pode bloquear conexões diretas entre jogadores.',
  timeout: 'A sala não respondeu a tempo.',
  lost: 'A conexão com a sala foi perdida.',
  'host-left': 'O anfitrião saiu: a sala foi encerrada.'
};
export const describeNetError = code => ERROR_TEXT[code] || ERROR_TEXT.network;

export function cleanPlayerName(text) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NET_TUNING.maxNameLength);
}

export function validateJoinInput(text) {
  const code = normalizeRoomCode(text);
  return code
    ? { ok: true, code, error: '' }
    : { ok: false, code: '', error: `Código inválido: são ${NET_TUNING.roomCodeLength} letras ou números (sem I, L, O, 0 e 1).` };
}

/** What the tab actually shows. sync() runs on a timer, so it only rebuilds the DOM when this changes. */
export function stateSignature(state, localError = '') {
  return JSON.stringify([
    state.status, state.code, state.isHost, state.error, localError,
    (state.players || []).map(p => [p.id, p.name, p.char, p.skin, !!p.self, !!p.isHost])
  ]);
}

export function describePlayer(player) {
  return `${player.name} · ${getCharacter(player.char).name} (${getSkin(player.char, player.skin).name})`;
}

function h(tag, attrs = {}, children = []) {
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

export function createOnlinePanel({ getState, getName, setName, onCreate, onJoin, onLeave }) {
  const nameInput = h('input', { type: 'text', class: 'pm-input', maxlength: String(NET_TUNING.maxNameLength), placeholder: 'Seu nome', 'aria-label': 'Seu nome', autocomplete: 'off' });
  nameInput.addEventListener('change', () => { setName(cleanPlayerName(nameInput.value)); sync(); });
  const codeInput = h('input', { type: 'text', class: 'pm-input pm-code-input', maxlength: '8', placeholder: 'CÓDIGO', 'aria-label': 'Código da sala', autocomplete: 'off', autocapitalize: 'characters' });
  const message = h('p', { class: 'pm-hint' });
  const body = h('div', { class: 'pm-online-body' });
  const element = h('div', { class: 'pm-panel', 'data-tab': 'online' }, [
    h('div', { class: 'pm-online-name' }, [h('label', { text: 'Seu nome' }), nameInput]), body, message
  ]);
  let localError = '';
  let lastSignature = '';

  function join() {
    const result = validateJoinInput(codeInput.value);
    localError = result.error;
    if (!result.ok) return sync();
    onJoin(result.code);
  }

  function sync() {
    const state = getState();
    if (document.activeElement !== nameInput) nameInput.value = getName();
    const connected = state.status === 'connected';
    const busy = state.status === 'busy';
    nameInput.disabled = connected || busy;
    // Rebuilding on every tick would move the focused input and swallow clicks.
    const signature = stateSignature(state, localError);
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (connected) {
      const copy = h('button', { type: 'button', class: 'pm-secondary', text: 'Copiar código' });
      copy.addEventListener('click', () => { navigator.clipboard?.writeText(state.code).catch(() => {}); copy.textContent = 'Copiado!'; });
      body.replaceChildren(
        h('div', { class: 'pm-room' }, [
          h('small', { text: state.isHost ? 'Você é o anfitrião · passe o código aos amigos' : 'Conectado à sala' }),
          h('strong', { class: 'pm-room-code', text: state.code }),
          copy
        ]),
        h('ul', { class: 'pm-players' }, state.players.map(p => h('li', { class: p.self ? 'self' : '' }, [
          h('span', { text: describePlayer(p) }),
          p.isHost ? h('em', { text: 'anfitrião' }) : null,
          p.self ? h('em', { text: 'você' }) : null
        ]))),
        h('button', { type: 'button', class: 'pm-secondary', text: 'Sair da sala', onclick: () => onLeave() })
      );
      message.textContent = state.isHost ? 'Se você sair, a sala é encerrada para todos.' : 'Se o anfitrião sair, a sala é encerrada.';
      message.classList.remove('pm-error');
      return;
    }
    const create = h('button', { type: 'button', class: 'pm-primary', text: busy ? 'Conectando…' : 'Criar sala', onclick: () => { localError = ''; onCreate(); } });
    const enter = h('button', { type: 'button', class: 'pm-secondary', text: 'Entrar', onclick: join });
    create.disabled = enter.disabled = codeInput.disabled = busy;
    body.replaceChildren(
      h('div', { class: 'pm-online-row' }, [create]),
      h('div', { class: 'pm-online-row' }, [codeInput, enter])
    );
    const error = localError || state.error;
    message.textContent = error || 'Jogue com até 3 amigos contra o mesmo Jason. Um de vocês cria a sala e passa o código.';
    message.classList.toggle('pm-error', !!error);
  }

  codeInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') join(); });
  nameInput.addEventListener('keydown', e => e.stopPropagation());
  return { element, sync };
}
