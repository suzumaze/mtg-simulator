// Entry point — screen management, event wiring

import { createGame, joinGame, sendMessage, setOnMessage, setOnConnected, getIsHost } from './connection.js';
import { parseDeckList, fetchCards, buildDeck } from './deck.js';
import { initGame, sendAction, handleMessage, setOnStateChange, getState, getMyPlayer, getOpponentPlayer, getLibraryTop } from './game.js';
import { renderBoard, renderZoneViewer, closeZoneViewer, addChatMessage, addSystemMessage, openScryViewer, getScryResult, closeScryViewer, openSearchViewer, closeSearchViewer, showRevealModal, closeRevealModal, getCounterTargetCardId, resetCounterTarget, getNoteTargetCardId, resetNoteTarget } from './board.js';
import { initDragDrop } from './drag.js';

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

function initLobby() {
  if (peerParam) {
    // Guest mode — auto-join
    createGameBtn.textContent = '接続中...';
    createGameBtn.disabled = true;

    joinGame(peerParam).then(() => {
      connectionStatus.textContent = '接続完了!';
      createGameBtn.classList.add('hidden');
      inviteSection.classList.remove('hidden');
      inviteSection.querySelector('p').textContent = 'ホストに接続しました';
      inviteUrlInput.classList.add('hidden');
      copyUrlBtn.classList.add('hidden');
      deckSection.classList.remove('hidden');
    }).catch((err) => {
      createGameBtn.textContent = '接続失敗';
      connectionStatus.textContent = `エラー: ${err}`;
    });
  } else {
    // Host mode
    createGameBtn.addEventListener('click', async () => {
      createGameBtn.disabled = true;
      createGameBtn.textContent = '作成中...';

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
  copyUrlBtn.textContent = 'コピー済!';
  setTimeout(() => { copyUrlBtn.textContent = 'コピー'; }, 2000);
});

// Show deck section when peer connects (for host)
setOnConnected(() => {
  deckSection.classList.remove('hidden');
  connectionStatus.textContent = '接続完了!';
});

// ===== Deck Loading =====
loadDeckBtn.addEventListener('click', async () => {
  const text = deckInput.value.trim();
  if (!text) {
    deckStatus.textContent = 'デッキリストを入力してください';
    return;
  }

  loadDeckBtn.disabled = true;
  deckStatus.textContent = 'カード情報を取得中...';

  try {
    const { main: mainEntries, sideboard: sbEntries } = parseDeckList(text);
    if (mainEntries.length === 0) {
      deckStatus.textContent = 'カードが見つかりませんでした';
      loadDeckBtn.disabled = false;
      return;
    }

    const allEntries = [...mainEntries, ...sbEntries];
    const { cardDataMap } = await fetchCards(allEntries, (pct) => {
      deckStatus.textContent = `取得中... ${pct}%`;
    });

    const { cards, notFound } = buildDeck(mainEntries, cardDataMap);
    const { cards: sbCards } = buildDeck(sbEntries, cardDataMap);

    const sbInfo = sbCards.length > 0 ? ` + SB ${sbCards.length}枚` : '';
    if (notFound.length > 0) {
      deckStatus.textContent = `⚠ 見つからないカード: ${notFound.join(', ')} (${cards.length}枚${sbInfo}読み込み済み)`;
    } else {
      deckStatus.textContent = `✓ ${cards.length}枚${sbInfo}のデッキを読み込みました`;
    }

    myDeckCards = cards;
    mySideboardCards = sbCards;
    myDeckReady = true;

    if (getIsHost()) {
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
    deckStatus.textContent = `エラー: ${err.message}`;
    loadDeckBtn.disabled = false;
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

  if (msg.type === 'chat') {
    addChatMessage(msg.payload.playerName, msg.payload.text);
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
  if (eventType === 'chat') {
    addChatMessage(eventData.playerName, eventData.text);
    return;
  }
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

// ===== Action Buttons =====
document.getElementById('draw-btn').addEventListener('click', () => {
  sendAction('draw', { count: 1 });
});

document.getElementById('shuffle-btn').addEventListener('click', () => {
  sendAction('shuffle', {});
  addSystemMessage('ライブラリーをシャッフルしました');
});

document.getElementById('mulligan-btn').addEventListener('click', () => {
  mulliganCount++;
  const drawCount = Math.max(1, 7 - mulliganCount + 1);
  sendAction('mulligan', { count: drawCount });
  addSystemMessage(`マリガン: ${drawCount}枚ドロー`);
});

document.getElementById('untap-all-btn').addEventListener('click', () => {
  sendAction('untap_all', {});
});

// Life buttons
for (const btn of document.querySelectorAll('.life-btn')) {
  btn.addEventListener('click', () => {
    const delta = parseInt(btn.dataset.delta, 10);
    const me = getMyPlayer();
    if (me) {
      sendAction('set_life', { life: me.life + delta });
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
    addSystemMessage(`d${sides}をロール: ${result}`);
    sendMessage({ type: 'system', payload: { text: `相手がd${sides}をロール: ${result}` } });
  } else {
    sendMessage({ type: 'roll', payload: { sides } });
  }
  document.getElementById('dice-modal').classList.add('hidden');
});

// Coin flip
document.getElementById('coin-btn').addEventListener('click', () => {
  if (getIsHost()) {
    const result = Math.random() < 0.5 ? '表 (Heads)' : '裏 (Tails)';
    addSystemMessage(`コインフリップ: ${result}`);
    sendMessage({ type: 'system', payload: { text: `相手がコインフリップ: ${result}` } });
  } else {
    sendMessage({ type: 'coin', payload: {} });
  }
});

// Chat
document.getElementById('chat-send-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  if (getIsHost()) {
    addChatMessage('You', text);
    sendMessage({ type: 'chat', payload: { playerName: 'Opponent', text } });
  } else {
    addChatMessage('You', text);
    sendMessage({ type: 'chat', payload: { text } });
  }
}

// Zone viewers (click to open GY/Exile)
document.getElementById('my-graveyard-zone').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state) renderZoneViewer('墓地', me.graveyard, state.cards, 'graveyard');
});

document.getElementById('my-exile-zone').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state) renderZoneViewer('追放', me.exile, state.cards, 'exile');
});

document.getElementById('opponent-graveyard-zone').addEventListener('click', () => {
  const opp = getOpponentPlayer();
  const state = getState();
  if (opp && state) renderZoneViewer('相手の墓地', opp.graveyard, state.cards, 'graveyard');
});

document.getElementById('opponent-exile-zone').addEventListener('click', () => {
  const opp = getOpponentPlayer();
  const state = getState();
  if (opp && state) renderZoneViewer('相手の追放', opp.exile, state.cards, 'exile');
});

document.getElementById('zone-viewer-close').addEventListener('click', closeZoneViewer);

// Sideboard viewer
document.getElementById('my-sideboard-zone').addEventListener('click', () => {
  const me = getMyPlayer();
  const state = getState();
  if (me && state) renderZoneViewer('サイドボード', me.sideboard || [], state.cards, 'sideboard');
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
  addSystemMessage(`Scry ${top.length + bottom.length}: トップ${top.length}枚, ボトム${bottom.length}枚`);
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
  addSystemMessage('ライブラリーをシャッフルしました');
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
