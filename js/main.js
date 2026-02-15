// Entry point — screen management, event wiring

import { createGame, joinGame, sendMessage, setOnMessage, setOnConnected, getIsHost, getIsSolo, setSoloMode } from './connection.js';
import { parseDeckList, fetchCards, buildDeck } from './deck.js';
import { initGame, sendAction, handleMessage, setOnStateChange, getState, getMyPlayer, getOpponentPlayer, getLibraryTop, resetGameState } from './game.js';
import { renderBoard, renderZoneViewer, closeZoneViewer, addSystemMessage, openScryViewer, getScryResult, closeScryViewer, openSearchViewer, closeSearchViewer, showRevealModal, closeRevealModal, getCounterTargetCardId, resetCounterTarget, getNoteTargetCardId, resetNoteTarget } from './board.js';
import { initDragDrop } from './drag.js';
import { playTap, playDraw, playShuffle, playLifeChange, playDice, playCoin, toggleMute, isMuted } from './sound.js';
import { setLocale, applyI18nToDOM, t, tf } from './i18n.js';

// ===== i18n =====
const browserLang = navigator.language.startsWith('ja') ? 'ja' : 'en';
setLocale(browserLang).then(() => applyI18nToDOM());

// ===== Solo Mode =====
document.getElementById('solo-btn').addEventListener('click', () => {
  if (!myDeckReady) return;
  setSoloMode();
  createGameBtn.classList.add('hidden');
  document.getElementById('solo-btn').classList.add('hidden');
  if (myDeckReady) {
    opponentDeckCards = [];
    opponentSideboardCards = [];
    startGame();
  }
});

// ===== State =====
let myDeckCards = null;
let mySideboardCards = null;
let opponentDeckCards = null;
let opponentSideboardCards = null;
let myDeckReady = false;
let opponentDeckReady = false;
let mulliganCount = 0;

// ===== DOM refs =====
const lobby = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const createGameBtn = document.getElementById('create-game-btn');
const inviteSection = document.getElementById('invite-section');
const inviteUrlInput = document.getElementById('invite-url');
const copyUrlBtn = document.getElementById('copy-url-btn');
const connectionStatus = document.getElementById('connection-status');
const deckSection = document.getElementById('deck-section');
const deckInput = document.getElementById('deck-input');
const loadDeckBtn = document.getElementById('load-deck-btn');
const deckStatus = document.getElementById('deck-status');
const waitingOpponent = document.getElementById('waiting-opponent');
const soloBtn = document.getElementById('solo-btn');
soloBtn.disabled = true;

// ===== Connection (initialized after auth) =====
const urlParams = new URLSearchParams(location.search);
const peerParam = urlParams.get('peer');

initLobby();
loadDeckHistory();

function loadDeckHistory() {
  const history = JSON.parse(localStorage.getItem('mtg-deck-history') || '[]');
  const historySection = document.getElementById('deck-history-section');
  const select = document.getElementById('deck-history-select');
  while (select.options.length > 1) select.remove(1);

  if (history.length === 0) {
    historySection.classList.add('hidden');
  } else {
    historySection.classList.remove('hidden');
    for (const deck of history) {
      const opt = document.createElement('option');
      opt.value = deck.timestamp;
      opt.textContent = `${deck.name} (${new Date(deck.timestamp).toLocaleDateString()})`;
      select.appendChild(opt);
    }
    // Auto-load most recent deck
    const latest = history[0];
    document.getElementById('deck-input').value = latest.text;
    document.getElementById('deck-name-input').value = latest.name;
    select.value = String(latest.timestamp);
  }
  updateLoadBtnState();
}

// ===== Load Button State =====
function updateLoadBtnState() {
  loadDeckBtn.disabled = !deckInput.value.trim();
  soloBtn.disabled = !myDeckReady;
}
deckInput.addEventListener('input', updateLoadBtnState);

document.getElementById('deck-history-select').addEventListener('change', (e) => {
  const ts = parseInt(e.target.value, 10);
  if (!ts) {
    // "新しいデッキ" selected — clear fields
    document.getElementById('deck-input').value = '';
    document.getElementById('deck-name-input').value = '';
    updateLoadBtnState();
    return;
  }
  const history = JSON.parse(localStorage.getItem('mtg-deck-history') || '[]');
  const deck = history.find(d => d.timestamp === ts);
  if (deck) {
    document.getElementById('deck-input').value = deck.text;
    document.getElementById('deck-name-input').value = deck.name;
    updateLoadBtnState();
  }
});

function initLobby() {
  if (peerParam) {
    // Guest mode — auto-join
    createGameBtn.textContent = t('connection.connecting');
    createGameBtn.disabled = true;

    joinGame(peerParam).then(() => {
      connectionStatus.textContent = t('connection.connected');
      createGameBtn.classList.add('hidden');
      document.getElementById('solo-btn').classList.add('hidden');
      inviteSection.classList.remove('hidden');
      inviteSection.querySelector('p').textContent = t('connection.joinedHost');
      inviteUrlInput.classList.add('hidden');
      copyUrlBtn.classList.add('hidden');
    }).catch((err) => {
      createGameBtn.textContent = t('connection.failed');
      connectionStatus.textContent = `${t('connection.error')} ${err}`;
    });
  } else {
    // Host mode
    createGameBtn.addEventListener('click', async () => {
      createGameBtn.disabled = true;
      createGameBtn.textContent = t('connection.creating');

      const { inviteUrl } = await createGame(connectionStatus);
      inviteUrlInput.value = inviteUrl;
      inviteSection.classList.remove('hidden');
      createGameBtn.classList.add('hidden');
      document.getElementById('solo-btn').classList.add('hidden');
    });
  }
}

// Copy invite URL
copyUrlBtn.addEventListener('click', () => {
  inviteUrlInput.select();
  navigator.clipboard.writeText(inviteUrlInput.value);
  copyUrlBtn.textContent = t('lobby.copied');
  setTimeout(() => { copyUrlBtn.textContent = t('lobby.copy'); }, 2000);
});

// Show deck section when peer connects (for host)
setOnConnected(() => {
  connectionStatus.textContent = t('connection.connected');
});

// ===== Deck Loading =====
loadDeckBtn.addEventListener('click', async () => {
  const text = deckInput.value.trim();
  if (!text) {
    deckStatus.textContent = t('deck.inputRequired');
    return;
  }

  loadDeckBtn.disabled = true;
  deckStatus.textContent = t('deck.fetchingCards');

  try {
    const { main: mainEntries, sideboard: sbEntries } = parseDeckList(text);
    if (mainEntries.length === 0) {
      deckStatus.textContent = t('deck.noCardsFound');
      loadDeckBtn.disabled = false;
      return;
    }

    const allEntries = [...mainEntries, ...sbEntries];
    const firstPrint = document.getElementById('first-print-checkbox').checked;
    const { cardDataMap } = await fetchCards(allEntries, (pct) => {
      deckStatus.textContent = tf('deck.fetching', { pct });
    }, { firstPrint });

    const { cards, notFound } = buildDeck(mainEntries, cardDataMap);
    const { cards: sbCards } = buildDeck(sbEntries, cardDataMap);

    const sbInfo = sbCards.length > 0 ? tf('deck.sideboardFormat', { count: sbCards.length }) : '';
    if (notFound.length > 0) {
      deckStatus.textContent = tf('deck.warningMissing', { names: notFound.join(', '), count: cards.length, sbInfo });
    } else {
      deckStatus.textContent = tf('deck.loadedSuccess', { count: cards.length, sbInfo });
    }

    myDeckCards = cards;
    mySideboardCards = sbCards;
    myDeckReady = true;
    updateLoadBtnState();
    renderDeckPreview(cards, sbCards);

    // Save to deck history (update existing if same name, else add new)
    const deckName = document.getElementById('deck-name-input').value.trim() || 'Unnamed';
    const deckHistory = JSON.parse(localStorage.getItem('mtg-deck-history') || '[]');
    const existingIdx = deckHistory.findIndex(d => d.name === deckName);
    if (existingIdx >= 0) {
      deckHistory.splice(existingIdx, 1);
    }
    deckHistory.unshift({ name: deckName, text, timestamp: Date.now() });
    if (deckHistory.length > 20) deckHistory.length = 20;
    try { localStorage.setItem('mtg-deck-history', JSON.stringify(deckHistory)); } catch (e) { /* storage full */ }

    if (getIsSolo()) {
      opponentDeckCards = [];
      opponentSideboardCards = [];
      startGame();
    } else if (getIsHost()) {
      if (opponentDeckReady) {
        startGame();
      } else {
        waitingOpponent.classList.remove('hidden');
      }
    } else if (peerParam) {
      sendMessage({ type: 'load_deck', payload: { cards, sideboard: sbCards } });
      waitingOpponent.classList.remove('hidden');
    } else {
      // No mode selected yet — deck is pre-loaded, re-enable button
      loadDeckBtn.disabled = false;
    }
  } catch (err) {
    deckStatus.textContent = tf('deck.error', { msg: err.message });
    loadDeckBtn.disabled = false;
  }
});

// ===== File Upload =====
document.getElementById('deck-file-btn').addEventListener('click', () => {
  document.getElementById('deck-file-input').click();
});

document.getElementById('deck-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('deck-input').value = ev.target.result;
    // Set deck name from filename
    let name = file.name.replace(/\.[^.]+$/, ''); // remove extension
    name = name.replace(/^Deck\s*-\s*/i, '');     // remove "Deck - " prefix
    document.getElementById('deck-name-input').value = name;
    updateLoadBtnState();
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ===== Clear Input =====
document.getElementById('deck-clear-btn').addEventListener('click', () => {
  document.getElementById('deck-input').value = '';
  document.getElementById('deck-name-input').value = '';
  document.getElementById('deck-history-select').value = '';
  updateLoadBtnState();
});

// ===== Clipboard Import =====
document.getElementById('deck-clipboard-btn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('deck-input').value = text;
    updateLoadBtnState();
  } catch (err) {
    deckStatus.textContent = t('deck.error', { msg: err.message });
  }
});

// ===== Message Handling =====
setOnMessage((msg) => {
  if (msg.type === 'load_deck' && getIsHost()) {
    opponentDeckCards = msg.payload.cards;
    opponentSideboardCards = msg.payload.sideboard || [];
    opponentDeckReady = true;

    if (myDeckReady) {
      startGame();
    }
    return;
  }

  if (msg.type === 'game_state' || msg.type === 'action') {
    handleMessage(msg);
    return;
  }

  if (msg.type === 'system') {
    addSystemMessage(msg.payload.text);
    return;
  }

  if (msg.type === 'reveal') {
    showRevealModal(msg.payload.cards);
    return;
  }

  if (msg.type === 'start_game' && !getIsHost()) {
    // Guest receives start signal — switch to game screen
    showGameScreen();
    return;
  }

  // Forward other messages to game handler
  handleMessage(msg);
});

// ===== Game State Rendering =====
setOnStateChange((eventType, eventData) => {
  if (eventType === 'system') {
    addSystemMessage(eventData.text);
    return;
  }
  if (eventType === 'reveal') {
    showRevealModal(eventData.cards);
    return;
  }
  renderBoard();
});

function renderDeckPreview(mainCards, sbCards) {
  let preview = document.getElementById('deck-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'deck-preview';
    document.body.appendChild(preview);
  }
  preview.innerHTML = '';

  function groupCards(cards) {
    const groups = new Map();
    for (const card of cards) {
      const g = groups.get(card.name);
      if (g) { g.count++; } else { groups.set(card.name, { ...card, count: 1 }); }
    }
    return groups;
  }

  function appendRow(groups, container) {
    const row = document.createElement('div');
    row.className = 'preview-row';
    for (const [, card] of groups) {
      if (!card.imageUrl) continue;
      const div = document.createElement('div');
      div.className = 'preview-card';
      const img = document.createElement('img');
      img.src = card.imageUrl;
      img.alt = card.name;
      div.appendChild(img);
      if (card.count > 1) {
        const badge = document.createElement('span');
        badge.className = 'preview-count';
        badge.textContent = `x${card.count}`;
        div.appendChild(badge);
      }
      row.appendChild(div);
    }
    container.appendChild(row);
  }

  appendRow(groupCards(mainCards), preview);

  if (sbCards.length > 0) {
    const label = document.createElement('div');
    label.className = 'preview-sb-label';
    label.textContent = `Sideboard: ${sbCards.length}`;
    preview.appendChild(label);
    appendRow(groupCards(sbCards), preview);
  }
}

function startGame() {
  initGame(myDeckCards, opponentDeckCards, mySideboardCards, opponentSideboardCards);

  // Tell guest to start
  sendMessage({ type: 'start_game', payload: {} });

  showGameScreen();
}

function showGameScreen() {
  const preview = document.getElementById('deck-preview');
  if (preview) preview.remove();
  lobby.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  initDragDrop();
  renderBoard();
}

// ===== End Game =====
document.getElementById('end-game-btn').addEventListener('click', () => {
  if (!confirm(t('game.endGameConfirm'))) return;
  endGame();
});

function endGame() {
  resetGameState();
  myDeckCards = null;
  mySideboardCards = null;
  opponentDeckCards = null;
  opponentSideboardCards = null;
  myDeckReady = false;
  opponentDeckReady = false;
  mulliganCount = 0;

  gameScreen.classList.add('hidden');
  lobby.classList.remove('hidden');

  createGameBtn.classList.remove('hidden');
  createGameBtn.disabled = false;
  createGameBtn.textContent = t('lobby.createGame');
  document.getElementById('solo-btn').classList.remove('hidden');
  inviteSection.classList.add('hidden');

  loadDeckBtn.disabled = false;
  deckStatus.textContent = '';
  waitingOpponent.classList.add('hidden');
  deckInput.value = '';
  document.getElementById('chat-log').innerHTML = '';
  const preview = document.getElementById('deck-preview');
  if (preview) preview.innerHTML = '';
  loadDeckHistory();
}

// ===== Play Log Toggle =====
const logPanel = document.getElementById('log-panel');
const logShowBtn = document.getElementById('log-show-btn');

document.getElementById('log-toggle-btn').addEventListener('click', () => {
  logPanel.classList.add('hidden-log');
  logShowBtn.style.display = 'block';
});

logShowBtn.addEventListener('click', () => {
  logPanel.classList.remove('hidden-log');
  logShowBtn.style.display = 'none';
});

// ===== Keyboard Shortcuts =====
function isModalOpen() {
  return ['zone-viewer', 'token-modal', 'dice-modal', 'scry-viewer', 'search-viewer', 'reveal-modal', 'counter-modal', 'note-modal']
    .some(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
}

document.addEventListener('keydown', (e) => {
  if (!gameScreen || gameScreen.classList.contains('hidden')) return;
  if (isModalOpen()) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'F2':
    case '1':
      e.preventDefault();
      sendAction('pass_priority', {});
      break;
    case 'F6':
    case '6':
      e.preventDefault();
      sendAction('next_turn', {});
      break;
    case 'd':
    case 'D':
      sendAction('draw', { count: 1 });
      playDraw();
      break;
    case 's':
    case 'S':
      sendAction('shuffle', {});
      addSystemMessage(t('system.shuffled'));
      playShuffle();
      break;
    case 'u':
    case 'U':
      sendAction('untap_all', {});
      break;
  }
});

// ===== Turn/Phase Buttons =====
document.getElementById('next-turn-btn').addEventListener('click', () => {
  sendAction('next_turn', {});
});

document.getElementById('pass-priority-btn').addEventListener('click', () => {
  sendAction('pass_priority', {});
});

// ===== Action Buttons =====
document.getElementById('draw-btn').addEventListener('click', () => {
  sendAction('draw', { count: 1 });
  playDraw();
});

document.getElementById('shuffle-btn').addEventListener('click', () => {
  sendAction('shuffle', {});
  addSystemMessage(t('system.shuffled'));
  playShuffle();
});

document.getElementById('mulligan-btn').addEventListener('click', () => {
  mulliganCount++;
  const drawCount = Math.max(1, 7 - mulliganCount + 1);
  sendAction('mulligan', { count: drawCount });
  addSystemMessage(tf('system.mulligan', { count: drawCount }));
  playShuffle();
});

document.getElementById('untap-all-btn').addEventListener('click', () => {
  sendAction('untap_all', {});
});

// Mute toggle
const muteBtn = document.getElementById('mute-btn');
muteBtn.textContent = isMuted() ? '🔇' : '🔊';
muteBtn.addEventListener('click', () => {
  const nowMuted = toggleMute();
  muteBtn.textContent = nowMuted ? '🔇' : '🔊';
});

// Life buttons
for (const btn of document.querySelectorAll('.life-btn')) {
  btn.addEventListener('click', () => {
    const delta = parseInt(btn.dataset.delta, 10);
    const me = getMyPlayer();
    if (me) {
      sendAction('set_life', { life: me.life + delta });
      playLifeChange();
    }
  });
}

// Poison buttons
for (const btn of document.querySelectorAll('.poison-btn')) {
  btn.addEventListener('click', () => {
    const delta = parseInt(btn.dataset.delta, 10);
    const me = getMyPlayer();
    if (me) {
      sendAction('set_poison', { poison: me.poison + delta });
    }
  });
}

// Token modal
document.getElementById('token-btn').addEventListener('click', () => {
  document.getElementById('token-modal').classList.remove('hidden');
});

document.getElementById('token-cancel-btn').addEventListener('click', () => {
  document.getElementById('token-modal').classList.add('hidden');
});

document.getElementById('token-create-btn').addEventListener('click', () => {
  const name = document.getElementById('token-name').value || 'Token';
  const pt = document.getElementById('token-pt').value || '1/1';
  sendAction('create_token', { name, pt });
  document.getElementById('token-modal').classList.add('hidden');
});

// Dice modal
document.getElementById('roll-btn').addEventListener('click', () => {
  document.getElementById('dice-modal').classList.remove('hidden');
});

document.getElementById('dice-cancel-btn').addEventListener('click', () => {
  document.getElementById('dice-modal').classList.add('hidden');
});

document.getElementById('dice-roll-btn').addEventListener('click', () => {
  const sides = parseInt(document.getElementById('dice-sides').value, 10) || 6;
  if (getIsHost()) {
    const result = Math.floor(Math.random() * sides) + 1;
    addSystemMessage(tf('system.diceRolled', { sides, result }));
    sendMessage({ type: 'system', payload: { text: tf('system.opponentDiceRolled', { sides, result }) } });
  } else {
    sendMessage({ type: 'roll', payload: { sides } });
  }
  playDice();
  document.getElementById('dice-modal').classList.add('hidden');
});

// Coin flip
document.getElementById('coin-btn').addEventListener('click', () => {
  if (getIsHost()) {
    const result = Math.random() < 0.5 ? t('system.coinHeads') : t('system.coinTails');
    addSystemMessage(tf('system.coinFlip', { result }));
    sendMessage({ type: 'system', payload: { text: tf('system.opponentCoinFlip', { result }) } });
  } else {
    sendMessage({ type: 'coin', payload: {} });
  }
  playCoin();
});

// Zone viewers (click to open GY/Exile)
document.getElementById('my-graveyard-zone').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state) renderZoneViewer(t('zone.graveyard'), me.graveyard, state.cards, 'graveyard');
});

document.getElementById('my-exile-zone').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state) renderZoneViewer(t('zone.exile'), me.exile, state.cards, 'exile');
});

document.getElementById('opponent-graveyard-zone').addEventListener('click', () => {
  const opp = getOpponentPlayer();
  const state = getState();
  if (opp && state) renderZoneViewer(t('zone.opponentGraveyard'), opp.graveyard, state.cards, 'graveyard');
});

document.getElementById('opponent-exile-zone').addEventListener('click', () => {
  const opp = getOpponentPlayer();
  const state = getState();
  if (opp && state) renderZoneViewer(t('zone.opponentExile'), opp.exile, state.cards, 'exile');
});

document.getElementById('zone-viewer-close').addEventListener('click', closeZoneViewer);

// Sideboard viewer
document.getElementById('my-sideboard-zone').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state) renderZoneViewer(t('zone.sideboard'), me.sideboard || [], state.cards, 'sideboard');
});

// Scry
document.getElementById('scry-btn').addEventListener('click', () => {
  document.getElementById('scry-modal').classList.remove('hidden');
});

document.getElementById('scry-cancel-btn').addEventListener('click', () => {
  document.getElementById('scry-modal').classList.add('hidden');
});

document.getElementById('scry-start-btn').addEventListener('click', () => {
  const count = parseInt(document.getElementById('scry-count').value, 10) || 1;
  document.getElementById('scry-modal').classList.add('hidden');
  const topCards = getLibraryTop(count);
  const state = getState();
  if (topCards.length > 0 && state) {
    openScryViewer(topCards, state.cards);
  }
});

document.getElementById('scry-confirm-btn').addEventListener('click', () => {
  const { top, bottom } = getScryResult();
  sendAction('scry_resolve', { top, bottom });
  closeScryViewer();
  addSystemMessage(tf('system.scryResolved', { total: top.length + bottom.length, top: top.length, bottom: bottom.length }));
});

// Library Search
document.getElementById('search-btn').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state && me.library.length > 0) {
    openSearchViewer(me.library, state.cards);
  }
});

document.getElementById('search-viewer-close').addEventListener('click', () => {
  closeSearchViewer();
  sendAction('shuffle', {});
  addSystemMessage(t('system.shuffled'));
});

// Reveal modal close
document.getElementById('reveal-modal-close').addEventListener('click', closeRevealModal);

// Counter modal
let selectedCounterType = '+1/+1';

for (const btn of document.querySelectorAll('.counter-type-btn')) {
  btn.addEventListener('click', () => {
    selectedCounterType = btn.dataset.type;
    for (const b of document.querySelectorAll('.counter-type-btn')) b.classList.remove('selected');
    btn.classList.add('selected');
  });
}

document.getElementById('counter-add-btn').addEventListener('click', () => {
  const cardId = getCounterTargetCardId();
  const custom = document.getElementById('counter-custom-type').value.trim();
  const type = custom || selectedCounterType;
  if (cardId) sendAction('add_counter', { cardId, type, delta: 1 });
});

document.getElementById('counter-remove-btn').addEventListener('click', () => {
  const cardId = getCounterTargetCardId();
  const custom = document.getElementById('counter-custom-type').value.trim();
  const type = custom || selectedCounterType;
  if (cardId) sendAction('add_counter', { cardId, type, delta: -1 });
});

document.getElementById('counter-cancel-btn').addEventListener('click', () => {
  document.getElementById('counter-modal').classList.add('hidden');
  resetCounterTarget();
});

// Note modal
document.getElementById('note-save-btn').addEventListener('click', () => {
  const cardId = getNoteTargetCardId();
  const note = document.getElementById('note-input').value.trim();
  if (cardId) sendAction('set_note', { cardId, note });
  document.getElementById('note-modal').classList.add('hidden');
  resetNoteTarget();
});

document.getElementById('note-cancel-btn').addEventListener('click', () => {
  document.getElementById('note-modal').classList.add('hidden');
  resetNoteTarget();
});

