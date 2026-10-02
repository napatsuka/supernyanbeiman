'use strict';
// PeerJS による P2P 接続（シグナリングは PeerJS の公開サーバー、ゲームデータは WebRTC DataChannel で直接やりとり）
const Net = (() => {
  const PREFIX = 'bunny-coop-v1-';
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let peer = null, conn = null;
  const api = { onData: null, onClose: null, connected: false };

  function makeCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    return s;
  }

  function attach(c, onOpen) {
    conn = c;
    c.on('open', () => { api.connected = true; onOpen && onOpen(); });
    c.on('data', d => api.onData && api.onData(d));
    const closed = () => {
      if (conn !== c) return;
      api.connected = false; conn = null;
      api.onClose && api.onClose();
    };
    c.on('close', closed);
    c.on('error', closed);
  }

  function errText(err) {
    switch (err.type) {
      case 'peer-unavailable': return 'ルームが見つかりません。コードを確認してね';
      case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
        return '接続サーバーにつながりません。ネット接続を確認してね';
      case 'browser-incompatible': return 'このブラウザは WebRTC に対応していません';
      default: return '接続エラー: ' + (err.type || err.message || err);
    }
  }

  api.host = function ({ onCode, onConnected, onError }) {
    api.close();
    const code = makeCode();
    const p = peer = new Peer(PREFIX + code, { debug: 1 });
    p.on('open', () => onCode(code));
    p.on('error', err => {
      if (peer !== p) return;
      if (err.type === 'unavailable-id') { p.destroy(); api.host({ onCode, onConnected, onError }); return; }
      if (!api.connected) onError(errText(err));
    });
    p.on('connection', c => {
      if (conn) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); }); return; }
      attach(c, onConnected);
    });
    // シグナリングが切れても P2P は続くので、再接続だけ試みる
    p.on('disconnected', () => { if (peer === p && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch {} }, 1000); });
  };

  api.join = function (code, { onConnected, onError }) {
    api.close();
    const p = peer = new Peer({ debug: 1 });
    let done = false;
    const timer = setTimeout(() => { if (!done && peer === p) { onError('接続がタイムアウトしました。もう一度試してね'); api.close(); } }, 20000);
    p.on('open', () => {
      const c = p.connect(PREFIX + code.toUpperCase(), { serialization: 'json', reliable: true });
      attach(c, () => { done = true; clearTimeout(timer); onConnected(); });
    });
    p.on('error', err => {
      if (peer !== p || api.connected) return;
      clearTimeout(timer); onError(errText(err)); api.close();
    });
  };

  api.send = function (obj) {
    if (conn && conn.open) { try { conn.send(obj); } catch {} }
  };

  api.close = function () {
    const c = conn, p = peer;
    conn = null; peer = null; api.connected = false;
    try { c && c.close(); } catch {}
    try { p && p.destroy(); } catch {}
  };

  return api;
})();
