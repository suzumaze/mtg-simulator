// PeerJS connection management

let peer = null;
let conn = null;
let isHost = false;
let onMessageCallback = null;
let onConnectedCallback = null;

export function getIsHost() {
  return isHost;
}

export function setOnMessage(cb) {
  onMessageCallback = cb;
}

export function setOnConnected(cb) {
  onConnectedCallback = cb;
}

export function sendMessage(msg) {
  if (conn && conn.open) {
    conn.send(msg);
  }
}

function setupConnection(connection) {
  conn = connection;
  conn.on('data', (data) => {
    if (onMessageCallback) onMessageCallback(data);
  });
  conn.on('open', () => {
    if (onConnectedCallback) onConnectedCallback();
  });
  conn.on('close', () => {
    console.log('Connection closed');
  });
}

export function createGame(statusEl) {
  isHost = true;
  return new Promise((resolve) => {
    peer = new Peer();
    peer.on('open', (id) => {
      const url = `${location.origin}${location.pathname}?peer=${id}`;
      resolve({ peerId: id, inviteUrl: url });
    });
    peer.on('connection', (connection) => {
      setupConnection(connection);
      if (statusEl) statusEl.textContent = '接続完了!';
    });
    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      if (statusEl) statusEl.textContent = `エラー: ${err.type}`;
    });
  });
}

export function joinGame(hostPeerId) {
  isHost = false;
  return new Promise((resolve, reject) => {
    peer = new Peer();
    peer.on('open', () => {
      const connection = peer.connect(hostPeerId, { reliable: true });
      setupConnection(connection);
      connection.on('open', () => {
        resolve();
      });
      connection.on('error', (err) => {
        reject(err);
      });
    });
    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      reject(err);
    });
  });
}
