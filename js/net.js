/* ============================================================
   INO - net.js  (PeerJS ホスト権威型ネットワーク)
   ホスト: ルーム作成・全状態を保持・各席へ配信
   クライアント: 行動を送信・スナップショットを受信
   ============================================================ */
(function (global) {
  function randCode(n) {
    const s = 'abcdefghijkmnpqrstuvwxyz23456789';
    let r = ''; for (let i = 0; i < n; i++) r += s[Math.floor(Math.random() * s.length)];
    return r;
  }

  const Net = {
    /* -------- ホスト -------- */
    host(callbacks) {
      const roomId = 'ino-' + randCode(6);
      const peer = new Peer(roomId, { debug: 1 });
      const conns = {}; // seat -> conn
      const handle = {
        roomId, peer, conns,
        // 各クライアントへ、その席用スナップショットを送る
        broadcast(buildForSeat) {
          for (const seat in conns) {
            try { conns[seat].send({ t: 'state', snap: buildForSeat(parseInt(seat)) }); } catch (e) {}
          }
        },
        sendTo(seat, msg) { if (conns[seat]) try { conns[seat].send(msg); } catch (e) {} },
        assign(conn, seat, name) { conn._seat = seat; conn._name = name; conns[seat] = conn; },
        close() { try { peer.destroy(); } catch (e) {} },
      };

      peer.on('open', (id) => callbacks.onReady && callbacks.onReady(id));
      peer.on('error', (err) => callbacks.onError && callbacks.onError(err));
      peer.on('connection', (conn) => {
        conn.on('data', (msg) => {
          if (msg.t === 'join') {
            callbacks.onJoin && callbacks.onJoin(conn, msg.name);
          } else if (conn._seat != null) {
            callbacks.onMessage && callbacks.onMessage(conn._seat, msg);
          }
        });
        conn.on('close', () => {
          if (conn._seat != null) { delete conns[conn._seat]; callbacks.onLeave && callbacks.onLeave(conn._seat); }
        });
      });
      return handle;
    },

    /* -------- クライアント -------- */
    join(roomId, name, callbacks) {
      const peer = new Peer({ debug: 1 });
      const handle = {
        peer, conn: null,
        send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); },
        close() { try { peer.destroy(); } catch (e) {} },
      };
      peer.on('open', () => {
        const conn = peer.connect(roomId, { reliable: true });
        handle.conn = conn;
        conn.on('open', () => {
          conn.send({ t: 'join', name });
          callbacks.onOpen && callbacks.onOpen();
        });
        conn.on('data', (msg) => {
          if (msg.t === 'assigned') callbacks.onAssigned && callbacks.onAssigned(msg.seat, msg.roster);
          else if (msg.t === 'state') callbacks.onState && callbacks.onState(msg.snap);
          else if (msg.t === 'lobby') callbacks.onLobby && callbacks.onLobby(msg.roster);
          else if (msg.t === 'error') callbacks.onError && callbacks.onError(msg.msg);
        });
        conn.on('close', () => callbacks.onClose && callbacks.onClose());
        conn.on('error', (e) => callbacks.onError && callbacks.onError(e.message || 'connection error'));
      });
      peer.on('error', (err) => callbacks.onError && callbacks.onError(err.type || err.message || 'peer error'));
      return handle;
    },
  };

  global.INONet = Net;
})(typeof window !== 'undefined' ? window : globalThis);
