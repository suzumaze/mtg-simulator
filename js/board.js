// Board rendering — draws zones, cards, and player info

import { getState, getMyPlayer, getOpponentPlayer, sendAction } from './game.js';
import { getIsHost, sendMessage } from './connection.js';

let contextMenu = null;
let counterTargetCardId = null;

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

  // My GY/Exile/SB counts
  document.getElementById('my-gy-count').textContent = me.graveyard.length;
  document.getElementById('my-exile-count').textContent = me.exile.length;
  const sbCountEl = document.getElementById('my-sb-count');
  if (sbCountEl) sbCountEl.textContent = (me.sideboard || []).length;

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
    const phasedOut = typeof entry === 'object' ? entry.phasedOut : false;
    const note = typeof entry === 'object' ? (entry.note || '') : '';
    const cardData = cards[cardId];
    if (!cardData) continue;

    const cardEl = createCardElement(cardId, cardData, {
      tapped, faceDown, counters, phasedOut, note, isMine, zone: 'battlefield',
    });
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
  const { tapped, faceDown, counters, phasedOut, note, isMine, zone } = opts;

  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = cardId;
  el.dataset.zone = zone || '';

  if (tapped) el.classList.add('tapped');
  if (faceDown) el.classList.add('face-down');
  if (phasedOut) el.classList.add('phased-out');
  if (cardData.isToken) el.classList.add('token-card');

  if (cardData.isToken && !cardData.imageUrl) {
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

  // Note badge
  if (note) {
    const noteBadge = document.createElement('div');
    noteBadge.className = 'note-badge';
    noteBadge.textContent = note;
    el.appendChild(noteBadge);
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

  if (zone === 'battlefield') {
    items.push({ label: 'タップ/アンタップ', action: () => sendAction('tap', { cardId }) });
    items.push({ label: '裏返す', action: () => sendAction('flip', { cardId }) });
    items.push({ label: 'フェイズアウト', action: () => sendAction('phase', { cardId }) });
    items.push({ label: 'カウンター...', action: () => openCounterModal(cardId) });
    items.push({ label: 'コピーを生成', action: () => sendAction('clone_card', { cardId }) });
    items.push({ label: 'メモ', action: () => openNoteModal(cardId) });
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'hand' }) });
    items.push({ label: '→ 墓地', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'graveyard' }) });
    items.push({ label: '→ 追放', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'exile' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'library' }) });
    items.push({ label: '→ ライブラリーボトム', action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'library', index: 'bottom' }) });
  } else if (zone === 'hand') {
    items.push({ label: '→ 戦場', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield' }) });
    items.push({ label: '→ 戦場（タップ）', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield', tapped: true }) });
    items.push({ label: '→ 戦場（裏向き）', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield', faceDown: true }) });
    items.push({ label: '→ 墓地', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'graveyard' }) });
    items.push({ label: '→ 追放', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'exile' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'library' }) });
    items.push({ label: '→ ライブラリーボトム', action: () => sendAction('move_card', { cardId, from: 'hand', to: 'library', index: 'bottom' }) });
    items.push({ label: '相手に公開', action: () => revealCard(cardId, 'hand') });
  } else if (zone === 'graveyard') {
    items.push({ label: '→ 戦場', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'battlefield' }) });
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'hand' }) });
    items.push({ label: '→ 追放', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'exile' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'library' }) });
    items.push({ label: '→ ライブラリーボトム', action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'library', index: 'bottom' }) });
  } else if (zone === 'exile') {
    items.push({ label: '→ 戦場', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'battlefield' }) });
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'hand' }) });
    items.push({ label: '→ 墓地', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'graveyard' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'exile', to: 'library' }) });
  } else if (zone === 'sideboard') {
    items.push({ label: '→ 手札', action: () => sendAction('move_card', { cardId, from: 'sideboard', to: 'hand' }) });
    items.push({ label: '→ ライブラリートップ', action: () => sendAction('move_card', { cardId, from: 'sideboard', to: 'library' }) });
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

// --- Counter Modal ---
function openCounterModal(cardId) {
  counterTargetCardId = cardId;
  document.getElementById('counter-modal').classList.remove('hidden');
}

export function getCounterTargetCardId() {
  return counterTargetCardId;
}

export function resetCounterTarget() {
  counterTargetCardId = null;
}

// --- Note Modal ---
let noteTargetCardId = null;

function openNoteModal(cardId) {
  noteTargetCardId = cardId;
  document.getElementById('note-input').value = '';
  document.getElementById('note-modal').classList.remove('hidden');
}

export function getNoteTargetCardId() {
  return noteTargetCardId;
}

export function resetNoteTarget() {
  noteTargetCardId = null;
}

// --- Reveal ---
function revealCard(cardId, fromZone) {
  const state = getState();
  const cardData = state?.cards[cardId];
  if (!cardData) return;

  // Send reveal to opponent
  if (getIsHost()) {
    sendMessage({ type: 'reveal', payload: { cards: [{ cardId, ...cardData }], fromZone } });
  } else {
    sendMessage({ type: 'reveal', payload: { cards: [{ cardId, ...cardData }], fromZone } });
  }
  addSystemMessage(`カードを公開: ${cardData.name}`);
}

// --- Scry Viewer ---
let scryTopCards = [];
let scryBottomCards = [];

export function openScryViewer(cardIds, cards) {
  scryTopCards = [...cardIds];
  scryBottomCards = [];
  renderScryViewer(cards);
  document.getElementById('scry-viewer').classList.remove('hidden');
}

function renderScryViewer(cards) {
  const state = getState();
  const allCards = cards || state?.cards || {};

  const topEl = document.getElementById('scry-top-cards');
  const bottomEl = document.getElementById('scry-bottom-cards');
  topEl.innerHTML = '';
  bottomEl.innerHTML = '';

  for (const cardId of scryTopCards) {
    const cardData = allCards[cardId];
    if (!cardData) continue;
    const el = createScryCard(cardId, cardData, 'top');
    topEl.appendChild(el);
  }

  for (const cardId of scryBottomCards) {
    const cardData = allCards[cardId];
    if (!cardData) continue;
    const el = createScryCard(cardId, cardData, 'bottom');
    bottomEl.appendChild(el);
  }
}

function createScryCard(cardId, cardData, section) {
  const el = document.createElement('div');
  el.className = 'card scry-card';
  el.dataset.cardId = cardId;

  if (cardData.imageUrl) {
    const img = document.createElement('img');
    img.className = 'card-image';
    img.src = cardData.imageUrl;
    img.alt = cardData.name;
    el.appendChild(img);
  }

  const nameOverlay = document.createElement('div');
  nameOverlay.className = 'card-name-overlay';
  nameOverlay.style.display = 'block';
  nameOverlay.textContent = cardData.name;
  el.appendChild(nameOverlay);

  // Click to toggle between top and bottom
  el.addEventListener('click', () => {
    if (section === 'top') {
      scryTopCards = scryTopCards.filter(id => id !== cardId);
      scryBottomCards.push(cardId);
    } else {
      scryBottomCards = scryBottomCards.filter(id => id !== cardId);
      scryTopCards.push(cardId);
    }
    renderScryViewer();
  });

  // Drag to reorder within top
  if (section === 'top') {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', cardId);
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.style.borderLeft = '3px solid #c9a227';
    });
    el.addEventListener('dragleave', () => {
      el.style.borderLeft = '';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.style.borderLeft = '';
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId === cardId) return;
      const fromIdx = scryTopCards.indexOf(draggedId);
      const toIdx = scryTopCards.indexOf(cardId);
      if (fromIdx !== -1 && toIdx !== -1) {
        scryTopCards.splice(fromIdx, 1);
        scryTopCards.splice(toIdx, 0, draggedId);
        renderScryViewer();
      }
    });
  }

  return el;
}

export function getScryResult() {
  return { top: [...scryTopCards], bottom: [...scryBottomCards] };
}

export function closeScryViewer() {
  document.getElementById('scry-viewer').classList.add('hidden');
  scryTopCards = [];
  scryBottomCards = [];
}

// --- Library Search Viewer ---
export function openSearchViewer(cardIds, cards) {
  const viewer = document.getElementById('search-viewer');
  const container = document.getElementById('search-viewer-cards');
  container.innerHTML = '';

  for (const cardId of cardIds) {
    const cardData = cards[cardId];
    if (!cardData) continue;

    const el = createCardElement(cardId, cardData, { isMine: true, zone: 'library' });
    // Override click to select destination
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showSearchDestMenu(e.clientX, e.clientY, cardId);
    });
    el.removeAttribute('draggable');
    container.appendChild(el);
  }

  viewer.classList.remove('hidden');
}

function showSearchDestMenu(x, y, cardId) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'card-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const dests = [
    { label: '→ 手札', to: 'hand' },
    { label: '→ 戦場', to: 'battlefield' },
    { label: '→ 墓地', to: 'graveyard' },
    { label: '→ 追放', to: 'exile' },
    { label: '→ ライブラリートップ', to: 'library' },
  ];

  for (const dest of dests) {
    const div = document.createElement('div');
    div.textContent = dest.label;
    div.addEventListener('click', () => {
      sendAction('search_library', { cardId, to: dest.to });
      closeSearchViewer();
      closeContextMenu();
      addSystemMessage('ライブラリーを検索しました');
    });
    menu.appendChild(div);
  }

  document.body.appendChild(menu);
  contextMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

export function closeSearchViewer() {
  document.getElementById('search-viewer').classList.add('hidden');
}

// --- Reveal Modal ---
export function showRevealModal(cards) {
  const container = document.getElementById('reveal-modal-cards');
  container.innerHTML = '';

  for (const card of cards) {
    const el = document.createElement('div');
    el.className = 'card';
    if (card.imageUrl) {
      const img = document.createElement('img');
      img.className = 'card-image';
      img.src = card.imageUrl;
      img.alt = card.name;
      el.appendChild(img);
    }
    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'card-name-overlay';
    nameOverlay.style.display = 'block';
    nameOverlay.textContent = card.name;
    el.appendChild(nameOverlay);
    container.appendChild(el);
  }

  document.getElementById('reveal-modal').classList.remove('hidden');
}

export function closeRevealModal() {
  document.getElementById('reveal-modal').classList.add('hidden');
}

// --- Zone Viewer ---
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

// --- Chat ---
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
