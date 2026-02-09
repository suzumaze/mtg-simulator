// Board rendering — draws zones, cards, and player info

import { getState, getMyPlayer, getOpponentPlayer, sendAction } from './game.js';
import { getIsHost } from './connection.js';

let contextMenu = null;

export function renderBoard() {
  const state = getState();
  if (!state) return;

  const me = getMyPlayer();
  const opp = getOpponentPlayer();
  if (!me || !opp) return;

  // Opponent info
  document.getElementById('opponent-name').textContent = opp.name;
  document.getElementById('opponent-life').textContent = opp.life;
  document.getElementById('opponent-poison').textContent = opp.poison;
  document.getElementById('opponent-library-count').textContent =
    opp.libraryCount ?? opp.library.length;
  document.getElementById('opponent-hand-count').textContent =
    opp.handCount ?? opp.hand.length;

  // My info
  document.getElementById('my-life').textContent = me.life;
  document.getElementById('my-poison').textContent = me.poison;
  document.getElementById('my-library-count').textContent = me.library.length;

  // My GY/Exile counts
  document.getElementById('my-gy-count').textContent = me.graveyard.length;
  document.getElementById('my-exile-count').textContent = me.exile.length;

  // Opponent GY/Exile counts
  document.getElementById('opponent-gy-count').textContent = opp.graveyard.length;
  document.getElementById('opponent-exile-count').textContent = opp.exile.length;

  // Render zones
  renderBattlefield('opponent-battlefield', opp.battlefield, state.cards, false);
  renderBattlefield('my-battlefield', me.battlefield, state.cards, true);
  renderHand('my-hand', me.hand, state.cards);
}

function renderBattlefield(elementId, entries, cards, isMine) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';

  for (const entry of entries) {
    const cardId = typeof entry === 'object' ? entry.cardId : entry;
    const tapped = typeof entry === 'object' ? entry.tapped : false;
    const faceDown = typeof entry === 'object' ? entry.faceDown : false;
    const counters = typeof entry === 'object' ? (entry.counters || {}) : {};
    const cardData = cards[cardId];
    if (!cardData) continue;

    const cardEl = createCardElement(cardId, cardData, { tapped, faceDown, counters, isMine, zone: 'battlefield' });
    el.appendChild(cardEl);
  }
}

function renderHand(elementId, cardIds, cards) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';

  for (const cardId of cardIds) {
    const cardData = cards[cardId];
    if (!cardData) continue;

    const cardEl = createCardElement(cardId, cardData, { isMine: true, zone: 'hand' });
    el.appendChild(cardEl);
  }
}

function createCardElement(cardId, cardData, opts = {}) {
  const { tapped, faceDown, counters, isMine, zone } = opts;

  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = cardId;
  el.dataset.zone = zone || '';

  if (tapped) el.classList.add('tapped');
  if (faceDown) el.classList.add('face-down');
  if (cardData.isToken) el.classList.add('token-card');

  if (cardData.isToken) {
    // Token display
    const tokenDisplay = document.createElement('div');
    tokenDisplay.className = 'token-display';
    const nameEl = document.createElement('div');
    nameEl.className = 'token-name';
    nameEl.textContent = cardData.name;
    const ptEl = document.createElement('div');
    ptEl.className = 'token-pt';
    ptEl.textContent = cardData.pt || '';
    tokenDisplay.appendChild(nameEl);
    tokenDisplay.appendChild(ptEl);
    el.appendChild(tokenDisplay);
  } else if (cardData.imageUrl) {
    const img = document.createElement('img');
    img.className = 'card-image';
    img.src = cardData.imageUrl;
    img.alt = cardData.name;
    img.loading = 'lazy';
    el.appendChild(img);
  }

  // Name overlay
  const nameOverlay = document.createElement('div');
  nameOverlay.className = 'card-name-overlay';
  nameOverlay.textContent = cardData.name;
  el.appendChild(nameOverlay);

  // Counter badge
  if (counters && Object.keys(counters).length > 0) {
    const total = Object.entries(counters).map(([k, v]) => `${k}:${v}`).join(' ');
    const badge = document.createElement('div');
    badge.className = 'counter-badge';
    badge.textContent = total;
    el.appendChild(badge);
  }

  // Draggable (own cards only)
  if (isMine) {
    el.draggable = true;

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ cardId, fromZone: zone }));
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });

    // Click: tap/untap on battlefield
    if (zone === 'battlefield') {
      el.addEventListener('click', (e) => {
        if (e.detail === 1) {
          // Single click = tap/untap
          setTimeout(() => {
            if (!e._preventTap) {
              sendAction('tap', { cardId });
            }
          }, 200);
        }
      });
    }

    // Right-click context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, cardId, zone);
    });
  }

  return el;
}

function showContextMenu(x, y, cardId, zone) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'card-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const items = [];
  const role = getIsHost() ? 'host' : 'guest';

  if (zone === 'battlefield') {
    items.push({ label: 'タップ/アンタップ', action: () => sendAction('tap', { cardId }) });
    items.push({ label: '裏返す', action: () => sendAction('flip', { cardId }) });
    items.push({ label: 'カウンター +1', action: () => sendAction('add_counter', { cardId, type: '+1/+1', delta: 1 }) });
    items.push({ label: 'カウンター -1', action: () => sendAction('add_counter', { cardId, type: '+1/+1', delta: -1 }) });
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'hand' }) });
    items.push({ label: '→ 墓地', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'graveyard' }) });
    items.push({ label: '→ 追放', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'exile' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'library' }) });
    items.push({ label: '→ ライブラリーボトム', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'library', index: 'bottom' }) });
  } else if (zone === 'hand') {
    items.push({ label: '→ 戦場', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield' }) });
    items.push({ label: '→ 墓地', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'graveyard' }) });
    items.push({ label: '→ 追放', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'exile' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'library' }) });
  } else if (zone === 'graveyard') {
    items.push({ label: '→ 戦場', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'battlefield' }) });
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'hand' }) });
    items.push({ label: '→ 追放', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'exile' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'library' }) });
  } else if (zone === 'exile') {
    items.push({ label: '→ 戦場', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'battlefield' }) });
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'hand' }) });
    items.push({ label: '→ 墓地', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'graveyard' }) });
  }

  for (const item of items) {
    const div = document.createElement('div');
    div.textContent = item.label;
    div.addEventListener('click', () => {
      item.action();
      closeContextMenu();
    });
    menu.appendChild(div);
  }

  document.body.appendChild(menu);
  contextMenu = menu;

  // Close on click elsewhere
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

function closeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

export function renderZoneViewer(title, cardIds, cards, zone) {
  const viewer = document.getElementById('zone-viewer');
  const titleEl = document.getElementById('zone-viewer-title');
  const cardsContainer = document.getElementById('zone-viewer-cards');

  titleEl.textContent = title;
  cardsContainer.innerHTML = '';

  for (const cardId of cardIds) {
    const cardData = cards[cardId];
    if (!cardData) continue;

    const cardEl = createCardElement(cardId, cardData, { isMine: true, zone });
    cardsContainer.appendChild(cardEl);
  }

  viewer.classList.remove('hidden');
}

export function closeZoneViewer() {
  document.getElementById('zone-viewer').classList.add('hidden');
}

export function addChatMessage(sender, text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-sender">${escapeHtml(sender)}:</span> ${escapeHtml(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

export function addSystemMessage(text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
