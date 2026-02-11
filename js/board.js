// Board rendering — draws zones, cards, and player info

import { getState, getMyPlayer, getOpponentPlayer, sendAction, PHASES } from './game.js';
import { getIsHost, sendMessage } from './connection.js';
import { playTap } from './sound.js';
import { t, tf } from './i18n.js';

let contextMenu = null;
let counterTargetCardId = null;

// --- Card Preview ---
let previewEl = null;

function ensurePreviewEl() {
  if (!previewEl) {
    previewEl = document.createElement('div');
    previewEl.id = 'card-preview';
    previewEl.className = 'hidden';
    document.body.appendChild(previewEl);
  }
}

function showCardPreview(cardData) {
  ensurePreviewEl();
  previewEl.innerHTML = '';
  if (cardData.imageUrl) {
    const img = document.createElement('img');
    img.src = cardData.imageUrl;
    img.alt = cardData.name;
    previewEl.appendChild(img);
  } else {
    const div = document.createElement('div');
    div.className = 'preview-token';
    div.textContent = `${cardData.name}\n${cardData.pt || ''}`;
    previewEl.appendChild(div);
  }
  previewEl.classList.remove('hidden');
}

function hideCardPreview() {
  if (previewEl) previewEl.classList.add('hidden');
}

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

  // Turn/Phase
  renderTurnPhase(state);

  // Render zones
  renderBattlefield('opponent-battlefield', opp.battlefield, state.cards, false);
  renderBattlefield('my-battlefield', me.battlefield, state.cards, true);
  renderHand('my-hand', me.hand, state.cards);
}

function renderTurnPhase(state) {
  if (!state.turn) return;
  const turn = state.turn;
  const isHost = getIsHost();
  const myRole = isHost ? 'host' : 'guest';

  document.getElementById('turn-counter').textContent = tf('turn.label', { num: turn.number });

  const activeName = turn.activePlayer === myRole ? t('player.you') : t('player.opponent');
  document.getElementById('active-player-display').textContent = tf('turn.activePlayer', { name: activeName });

  const priorityName = turn.priority === myRole ? t('player.you') : t('player.opponent');
  document.getElementById('priority-indicator').textContent = tf('turn.priority', { name: priorityName });

  // Highlight pass button if it's my priority
  const passBtn = document.getElementById('pass-priority-btn');
  if (turn.priority === myRole) {
    passBtn.classList.add('my-priority');
  } else {
    passBtn.classList.remove('my-priority');
  }

  // Phase pills
  const phaseDisplay = document.getElementById('phase-display');
  phaseDisplay.innerHTML = '';
  for (const phase of PHASES) {
    const pill = document.createElement('span');
    pill.className = 'phase-pill';
    pill.textContent = t(`turn.${phase}`);
    if (phase === turn.phase) pill.classList.add('active-phase');
    pill.addEventListener('click', () => sendAction('set_phase', { phase }));
    phaseDisplay.appendChild(pill);
  }
}

function renderBattlefield(elementId, entries, cards, isMine) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';

  const nonLands = [];
  const lands = [];

  for (const entry of entries) {
    const cardId = typeof entry === 'object' ? entry.cardId : entry;
    const cardData = cards[cardId];
    if (!cardData) continue;
    const isLand = cardData.typeLine && cardData.typeLine.toLowerCase().includes('land');
    (isLand ? lands : nonLands).push(entry);
  }

  const row1 = document.createElement('div');
  row1.className = 'battlefield-row';
  for (const entry of nonLands) {
    const cardId = typeof entry === 'object' ? entry.cardId : entry;
    const tapped = typeof entry === 'object' ? entry.tapped : false;
    const faceDown = typeof entry === 'object' ? entry.faceDown : false;
    const counters = typeof entry === 'object' ? (entry.counters || {}) : {};
    const phasedOut = typeof entry === 'object' ? entry.phasedOut : false;
    const note = typeof entry === 'object' ? (entry.note || '') : '';
    const cardData = cards[cardId];
    if (!cardData) continue;
    row1.appendChild(createCardElement(cardId, cardData, {
      tapped, faceDown, counters, phasedOut, note, isMine, zone: 'battlefield',
    }));
  }

  const row2 = document.createElement('div');
  row2.className = 'battlefield-row';
  for (const entry of lands) {
    const cardId = typeof entry === 'object' ? entry.cardId : entry;
    const tapped = typeof entry === 'object' ? entry.tapped : false;
    const faceDown = typeof entry === 'object' ? entry.faceDown : false;
    const counters = typeof entry === 'object' ? (entry.counters || {}) : {};
    const phasedOut = typeof entry === 'object' ? entry.phasedOut : false;
    const note = typeof entry === 'object' ? (entry.note || '') : '';
    const cardData = cards[cardId];
    if (!cardData) continue;
    row2.appendChild(createCardElement(cardId, cardData, {
      tapped, faceDown, counters, phasedOut, note, isMine, zone: 'battlefield',
    }));
  }

  el.appendChild(row1);
  el.appendChild(row2);
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
              playTap();
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

  // Opponent card right-click (view card)
  if (!isMine && zone === 'battlefield' && !faceDown) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showOpponentContextMenu(e.clientX, e.clientY, cardData);
    });
  }

  // Card preview on hover (all cards, not face-down)
  if (!faceDown) {
    el.addEventListener('mouseenter', () => showCardPreview(cardData));
    el.addEventListener('mouseleave', hideCardPreview);
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
    items.push({ label: t('context.tapUntap'), action: () => sendAction('tap', { cardId }) });
    items.push({ label: t('context.flip'), action: () => sendAction('flip', { cardId }) });
    items.push({ label: t('context.phaseOut'), action: () => sendAction('phase', { cardId }) });
    items.push({ label: t('context.counter'), action: () => openCounterModal(cardId) });
    items.push({ label: t('context.clone'), action: () => sendAction('clone_card', { cardId }) });
    items.push({ label: t('context.note'), action: () => openNoteModal(cardId) });
    items.push({ label: t('context.toHand'), action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'hand' }) });
    items.push({ label: t('context.toGraveyard'), action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'graveyard' }) });
    items.push({ label: t('context.toExile'), action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'exile' }) });
    items.push({ label: t('context.toLibraryTop'), action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'library' }) });
    items.push({ label: t('context.toLibraryBottom'), action: () => sendAction('move_card', { cardId, from: 'battlefield', to: 'library', index: 'bottom' }) });
  } else if (zone === 'hand') {
    items.push({ label: t('context.toBattlefield'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield' }) });
    items.push({ label: t('context.toBattlefieldTapped'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield', tapped: true }) });
    items.push({ label: t('context.toBattlefieldFaceDown'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'battlefield', faceDown: true }) });
    items.push({ label: t('context.toGraveyard'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'graveyard' }) });
    items.push({ label: t('context.toExile'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'exile' }) });
    items.push({ label: t('context.toLibraryTop'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'library' }) });
    items.push({ label: t('context.toLibraryBottom'), action: () => sendAction('move_card', { cardId, from: 'hand', to: 'library', index: 'bottom' }) });
    items.push({ label: t('context.reveal'), action: () => revealCard(cardId, 'hand') });
  } else if (zone === 'graveyard') {
    items.push({ label: t('context.toBattlefield'), action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'battlefield' }) });
    items.push({ label: t('context.toHand'), action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'hand' }) });
    items.push({ label: t('context.toExile'), action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'exile' }) });
    items.push({ label: t('context.toLibraryTop'), action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'library' }) });
    items.push({ label: t('context.toLibraryBottom'), action: () => sendAction('move_card', { cardId, from: 'graveyard', to: 'library', index: 'bottom' }) });
  } else if (zone === 'exile') {
    items.push({ label: t('context.toBattlefield'), action: () => sendAction('move_card', { cardId, from: 'exile', to: 'battlefield' }) });
    items.push({ label: t('context.toHand'), action: () => sendAction('move_card', { cardId, from: 'exile', to: 'hand' }) });
    items.push({ label: t('context.toGraveyard'), action: () => sendAction('move_card', { cardId, from: 'exile', to: 'graveyard' }) });
    items.push({ label: t('context.toLibraryTop'), action: () => sendAction('move_card', { cardId, from: 'exile', to: 'library' }) });
  } else if (zone === 'sideboard') {
    items.push({ label: t('context.toHand'), action: () => sendAction('move_card', { cardId, from: 'sideboard', to: 'hand' }) });
    items.push({ label: t('context.toLibraryTop'), action: () => sendAction('move_card', { cardId, from: 'sideboard', to: 'library' }) });
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

  // Reposition if clipping viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  }

  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
  }, 0);
}

function showOpponentContextMenu(x, y, cardData) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'card-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const div = document.createElement('div');
  div.textContent = t('context.viewCard');
  div.addEventListener('click', () => {
    showRevealModal([cardData]);
    closeContextMenu();
  });
  menu.appendChild(div);

  document.body.appendChild(menu);
  contextMenu = menu;

  // Reposition if clipping viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  }

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
  addSystemMessage(tf('system.revealCard', { name: cardData.name }));
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
    { label: t('context.toHand'), to: 'hand' },
    { label: t('context.toBattlefield'), to: 'battlefield' },
    { label: t('context.toGraveyard'), to: 'graveyard' },
    { label: t('context.toExile'), to: 'exile' },
    { label: t('context.toLibraryTop'), to: 'library' },
  ];

  for (const dest of dests) {
    const div = document.createElement('div');
    div.textContent = dest.label;
    div.addEventListener('click', () => {
      sendAction('search_library', { cardId, to: dest.to });
      closeSearchViewer();
      closeContextMenu();
      addSystemMessage(t('system.searchLibrary'));
    });
    menu.appendChild(div);
  }

  document.body.appendChild(menu);
  contextMenu = menu;

  // Reposition if clipping viewport
  const rect2 = menu.getBoundingClientRect();
  if (rect2.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect2.width - 4) + 'px';
  }
  if (rect2.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect2.height - 4) + 'px';
  }

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

export function addSystemMessage(text) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

