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

// ===== Auth Gate =====
const PASSPHRASE_HASH = '2605313bb00abca41065d79008856c1de17d0bb0a63d55f53df2614487c044d0';

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkAuth() {
  const input = document.getElementById('passphrase-input').value;
  const hash = await sha256(input);
  if (hash === PASSPHRASE_HASH) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    initLobby();
  } else {
    document.getElementById('auth-error').classList.remove('hidden');
  }
}

document.getElementById('auth-btn').addEventListener('click', checkAuth);
document.getElementById('solo-btn').addEventListener('click', async () => {
  const input = document.getElementById('passphrase-input').value;
  const hash = await sha256(input);
  if (hash === PASSPHRASE_HASH) {
    setSoloMode();
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    initSoloLobby();
  } else {
    document.getElementById('auth-error').classList.remove('hidden');
  }
});
document.getElementById('passphrase-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkAuth();
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

// ===== Connection (initialized after auth) =====
const urlParams = new URLSearchParams(location.search);
const peerParam = urlParams.get('peer');

function initSoloLobby() {
  createGameBtn.classList.add('hidden');
  deckSection.classList.remove('hidden');
  loadDeckHistory();
}

function loadDeckHistory() {
  const history = JSON.parse(localStorage.getItem('mtg-deck-history') || '[]');
  const select = document.getElementById('deck-history-select');
  while (select.options.length > 1) select.remove(1);
  for (const deck of history) {
    const opt = document.createElement('option');
    opt.value = deck.timestamp;
    opt.textContent = `${deck.name} (${new Date(deck.timestamp).toLocaleDateString()})`;
    select.appendChild(opt);
  }
}

document.getElementById('deck-history-select').addEventListener('change', (e) => {
  const ts = parseInt(e.target.value, 10);
  if (!ts) return;
  const history = JSON.parse(localStorage.getItem('mtg-deck-history') || '[]');
  const deck = history.find(d => d.timestamp === ts);
  if (deck) {
    document.getElementById('deck-input').value = deck.text;
    document.getElementById('deck-name-input').value = deck.name;
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
      inviteSection.classList.remove('hidden');
      inviteSection.querySelector('p').textContent = t('connection.joinedHost');
      inviteUrlInput.classList.add('hidden');
      copyUrlBtn.classList.add('hidden');
      deckSection.classList.remove('hidden');
      loadDeckHistory();
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
  deckSection.classList.remove('hidden');
  connectionStatus.textContent = t('connection.connected');
  loadDeckHistory();
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

    // Save to deck history
    const deckName = document.getElementById('deck-name-input').value.trim() || 'Unnamed';
    const deckHistory = JSON.parse(localStorage.getItem('mtg-deck-history') || '[]');
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
    } else {
      sendMessage({ type: 'load_deck', payload: { cards, sideboard: sbCards } });
      waitingOpponent.classList.remove('hidden');
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
  };
  reader.readAsText(file);
  e.target.value = '';
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

function startGame() {
  initGame(myDeckCards, opponentDeckCards, mySideboardCards, opponentSideboardCards);

  // Tell guest to start
  sendMessage({ type: 'start_game', payload: {} });

  showGameScreen();
}

function showGameScreen() {
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

  loadDeckBtn.disabled = false;
  deckStatus.textContent = '';
  waitingOpponent.classList.add('hidden');
  deckInput.value = '';
  document.getElementById('chat-log').innerHTML = '';
}

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

