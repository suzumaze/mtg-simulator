// Game state management

import { getIsHost, sendMessage } from './connection.js';

let nextCardId = 1;
let gameState = null;
let onStateChange = null;

export function setOnStateChange(cb) {
  onStateChange = cb;
}

export function getState() {
  return gameState;
}

function genId() {
  return `c${nextCardId++}`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function initGame(myCards, opponentCards) {
  const cards = {};

  const myLibrary = [];
  for (const c of myCards) {
    const id = genId();
    cards[id] = { name: c.name, imageUrl: c.imageUrl, oracleText: c.oracleText, typeLine: c.typeLine };
    myLibrary.push(id);
  }
  shuffle(myLibrary);

  const oppLibrary = [];
  for (const c of opponentCards) {
    const id = genId();
    cards[id] = { name: c.name, imageUrl: c.imageUrl, oracleText: c.oracleText, typeLine: c.typeLine };
    oppLibrary.push(id);
  }
  shuffle(oppLibrary);

  const selfRole = getIsHost() ? 'host' : 'guest';
  const oppRole = getIsHost() ? 'guest' : 'host';

  gameState = {
    players: {
      [selfRole]: {
        name: 'You',
        life: 20,
        poison: 0,
        library: myLibrary,
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
      },
      [oppRole]: {
        name: 'Opponent',
        life: 20,
        poison: 0,
        library: oppLibrary,
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
      },
    },
    cards,
  };

  // Draw 7 for each player
  drawCards(selfRole, 7);
  drawCards(oppRole, 7);

  broadcastState();
}

function myRole() {
  return getIsHost() ? 'host' : 'guest';
}

function oppRole() {
  return getIsHost() ? 'guest' : 'host';
}

export function getMyPlayer() {
  return gameState?.players[myRole()];
}

export function getOpponentPlayer() {
  return gameState?.players[oppRole()];
}

function drawCards(role, count) {
  const player = gameState.players[role];
  const drawn = player.library.splice(0, Math.min(count, player.library.length));
  player.hand.push(...drawn);
}

function broadcastState() {
  if (onStateChange) onStateChange();

  if (getIsHost()) {
    // Send state to guest, hiding guest's own hand/library details
    // (guest sees their own local state for hidden info)
    sendMessage({ type: 'game_state', payload: serializeStateForOpponent() });
  }
}

function serializeStateForOpponent() {
  const opp = oppRole();
  const me = myRole();
  return {
    players: {
      [me]: {
        ...gameState.players[me],
        // Hide host's hand card IDs from guest — send count only
        hand: gameState.players[me].hand.length,
        library: gameState.players[me].library.length,
      },
      [opp]: gameState.players[opp],
    },
    cards: gameState.cards,
  };
}

export function sendAction(type, payload) {
  if (getIsHost()) {
    // Host processes locally
    processAction(myRole(), type, payload);
  } else {
    // Guest sends action to host
    sendMessage({ type, payload });
  }
}

export function processAction(role, type, payload) {
  if (!gameState) return;

  const player = gameState.players[role];

  switch (type) {
    case 'draw': {
      drawCards(role, payload.count || 1);
      broadcastAction(role, type, payload);
      break;
    }
    case 'move_card': {
      const { cardId, from, to, index } = payload;
      removeCardFromZone(role, from, cardId);
      addCardToZone(role, to, cardId, index);
      broadcastAction(role, type, payload);
      break;
    }
    case 'tap': {
      const entry = player.battlefield.find(e =>
        (typeof e === 'object' ? e.cardId : e) === payload.cardId
      );
      if (entry && typeof entry === 'object') {
        entry.tapped = !entry.tapped;
      }
      broadcastAction(role, type, payload);
      break;
    }
    case 'flip': {
      const entry2 = player.battlefield.find(e =>
        (typeof e === 'object' ? e.cardId : e) === payload.cardId
      );
      if (entry2 && typeof entry2 === 'object') {
        entry2.faceDown = !entry2.faceDown;
      }
      broadcastAction(role, type, payload);
      break;
    }
    case 'set_life': {
      player.life = payload.life;
      broadcastAction(role, type, payload);
      break;
    }
    case 'set_poison': {
      player.poison = payload.poison;
      broadcastAction(role, type, payload);
      break;
    }
    case 'add_counter': {
      const entry3 = player.battlefield.find(e =>
        (typeof e === 'object' ? e.cardId : e) === payload.cardId
      );
      if (entry3 && typeof entry3 === 'object') {
        if (!entry3.counters) entry3.counters = {};
        const ctype = payload.type || '+1/+1';
        entry3.counters[ctype] = (entry3.counters[ctype] || 0) + (payload.delta || 1);
        if (entry3.counters[ctype] <= 0) delete entry3.counters[ctype];
      }
      broadcastAction(role, type, payload);
      break;
    }
    case 'create_token': {
      const tokenId = genId();
      gameState.cards[tokenId] = {
        name: payload.name || 'Token',
        imageUrl: null,
        oracleText: '',
        typeLine: 'Token',
        isToken: true,
        pt: payload.pt || '1/1',
      };
      player.battlefield.push({
        cardId: tokenId,
        tapped: false,
        faceDown: false,
        counters: {},
      });
      broadcastAction(role, type, payload);
      break;
    }
    case 'shuffle': {
      shuffle(player.library);
      broadcastAction(role, type, payload);
      break;
    }
    case 'mulligan': {
      // Return hand to library, shuffle, draw N
      player.library.push(...player.hand);
      player.hand = [];
      shuffle(player.library);
      const drawCount = payload.count || 7;
      drawCards(role, drawCount);
      broadcastAction(role, type, { count: drawCount });
      break;
    }
    case 'untap_all': {
      for (const entry of player.battlefield) {
        if (typeof entry === 'object') {
          entry.tapped = false;
        }
      }
      broadcastAction(role, type, payload);
      break;
    }
    case 'load_deck': {
      // Guest sends deck data to host
      const cards = payload.cards;
      const lib = [];
      for (const c of cards) {
        const id = genId();
        gameState.cards[id] = { name: c.name, imageUrl: c.imageUrl, oracleText: c.oracleText, typeLine: c.typeLine };
        lib.push(id);
      }
      shuffle(lib);
      player.library = lib;
      player.hand = [];
      player.battlefield = [];
      player.graveyard = [];
      player.exile = [];
      drawCards(role, 7);
      broadcastAction(role, type, {});
      break;
    }
    default:
      console.warn('Unknown action:', type);
  }

  broadcastState();
}

function broadcastAction(role, type, data) {
  if (getIsHost()) {
    sendMessage({
      type: 'action',
      payload: { player: role, type, ...data },
    });
  }
}

function removeCardFromZone(role, zoneName, cardId) {
  const player = gameState.players[role];
  const zone = player[zoneName];
  if (!zone) return;

  if (zoneName === 'battlefield') {
    const idx = zone.findIndex(e => (typeof e === 'object' ? e.cardId : e) === cardId);
    if (idx !== -1) zone.splice(idx, 1);
  } else {
    const idx = zone.indexOf(cardId);
    if (idx !== -1) zone.splice(idx, 1);
  }
}

function addCardToZone(role, zoneName, cardId, index) {
  const player = gameState.players[role];
  const zone = player[zoneName];
  if (!zone) return;

  if (zoneName === 'battlefield') {
    zone.push({
      cardId,
      tapped: false,
      faceDown: false,
      counters: {},
    });
  } else if (zoneName === 'library') {
    // Add to top by default, or to specific index
    if (index === 'bottom') {
      zone.push(cardId);
    } else {
      zone.unshift(cardId);
    }
  } else {
    zone.push(cardId);
  }
}

// Handle incoming messages
export function handleMessage(msg) {
  if (getIsHost()) {
    // Host receives actions from guest
    const oppR = oppRole();
    switch (msg.type) {
      case 'load_deck':
        processAction(oppR, 'load_deck', msg.payload);
        break;
      case 'chat':
        // Show to host locally
        if (onStateChange) onStateChange('chat', { playerName: 'Opponent', text: msg.payload.text });
        break;
      case 'roll': {
        const rollResult = Math.floor(Math.random() * (msg.payload.sides || 6)) + 1;
        // Show to host
        if (onStateChange) onStateChange('system', { text: `相手がd${msg.payload.sides}をロール: ${rollResult}` });
        // Send result back to guest
        sendMessage({ type: 'system', payload: { text: `d${msg.payload.sides}をロール: ${rollResult}` } });
        break;
      }
      case 'coin': {
        const coinResult = Math.random() < 0.5 ? '表 (Heads)' : '裏 (Tails)';
        if (onStateChange) onStateChange('system', { text: `相手がコインフリップ: ${coinResult}` });
        sendMessage({ type: 'system', payload: { text: `コインフリップ: ${coinResult}` } });
        break;
      }
      default:
        processAction(oppR, msg.type, msg.payload);
    }
  } else {
    // Guest receives state updates from host
    switch (msg.type) {
      case 'game_state':
        applyRemoteState(msg.payload);
        break;
      case 'action':
        // Action notification for UI feedback
        break;
      case 'chat':
        if (onStateChange) onStateChange('chat', msg.payload);
        break;
      case 'system':
        if (onStateChange) onStateChange('system', msg.payload);
        break;
    }
  }
}

function applyRemoteState(remoteState) {
  if (!gameState) {
    // First state received — initialize
    gameState = { players: {}, cards: {} };
  }

  const me = myRole();
  const opp = oppRole();

  // Update cards database
  Object.assign(gameState.cards, remoteState.cards);

  // My zones come from host (hand/library are full arrays for me)
  gameState.players[me] = remoteState.players[me];

  // Opponent's zones — hand and library are counts only
  const remoteOpp = remoteState.players[opp];
  gameState.players[opp] = {
    ...remoteOpp,
    // hand/library are numbers from host — store as counts
    handCount: typeof remoteOpp.hand === 'number' ? remoteOpp.hand : (remoteOpp.hand?.length || 0),
    libraryCount: typeof remoteOpp.library === 'number' ? remoteOpp.library : (remoteOpp.library?.length || 0),
    hand: typeof remoteOpp.hand === 'number' ? [] : (remoteOpp.hand || []),
    library: typeof remoteOpp.library === 'number' ? [] : (remoteOpp.library || []),
  };

  if (onStateChange) onStateChange();
}

export function mulliganCount() {
  const player = getMyPlayer();
  if (!player) return 7;
  // Standard: each mulligan draws one fewer
  return Math.max(1, 7 - (player._mulliganCount || 0));
}
