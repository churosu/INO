/* ============================================================
   INO - main.js  (コントローラ)
   メニュー/ロビー進行、ホスト権威ループ、行動ルーティング
   ============================================================ */
(function () {
  const Net = window.INONet;
  const app = {
    role: null, name: '', selfSeat: 0,
    net: null, engine: null, snap: null,
    roster: [], started: false, timer: null,
  };
  window.app = app;

  const $ = id => document.getElementById(id);
  const escapeHtml = s => (s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  /* ---------- 画面切替 ---------- */
  function show(screen) {
    ['menu', 'lobby', 'game'].forEach(s => {
      const e = $(s);
      if (s === 'game') e.classList.toggle('on', screen === 'game');
      else e.classList.toggle('hidden', screen !== s);
    });
  }
  function menuError(m) { $('menuErr').textContent = m || ''; }
  function toast(m) {
    let t = $('toast'); t.textContent = m; t.style.opacity = '1';
    clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = '0', 2200);
  }
  app.onNetError = (m) => { if (app.snap || app.started) toast(typeof m === 'string' ? m : '通信エラー'); else menuError(String(m)); };

  /* ============================================================
     ロビー描画
     ============================================================ */
  function setRoomCode(code) { $('roomCode').textContent = code; }
  function renderLobby() {
    const list = $('rosterList'); list.innerHTML = '';
    for (let s = 0; s < 4; s++) {
      const r = app.roster.find(x => x.seat === s);
      const slot = document.createElement('div');
      if (r) { slot.className = 'slot' + (r.isAI ? ' ai' : ''); slot.innerHTML = `<span class="dot"></span> 席${s + 1}: ${escapeHtml(r.name)}${r.seat === app.selfSeat ? ' (あなた)' : ''}`; }
      else { slot.className = 'slot empty'; slot.innerHTML = `<span class="dot"></span> 席${s + 1}: 空席 → 開始時にAIが入ります`; }
      list.appendChild(slot);
    }
  }

  /* ============================================================
     ホスト
     ============================================================ */
  function createRoom() {
    const nm = $('nameInput').value.trim(); if (!nm) { menuError('名前を入力してください'); return; }
    app.role = 'host'; app.name = nm; app.selfSeat = 0;
    app.roster = [{ seat: 0, name: nm, isAI: false }];
    app.net = Net.host({
      onReady: (id) => { show('lobby'); setRoomCode(id); $('startBtn').classList.remove('hidden'); $('lobbyHint').textContent = 'このコードを友だちに共有して参加してもらうか、そのまま開始するとAIと対戦できます。'; renderLobby(); },
      onError: (e) => menuError('接続エラー: ' + (e.type || e.message || e)),
      onJoin: (conn, name) => {
        if (app.started) { try { conn.send({ t: 'error', msg: 'ゲームは開始済みです' }); } catch (e) {} return; }
        const taken = app.roster.map(r => r.seat);
        let seat = -1; for (let s = 1; s < 4; s++) if (!taken.includes(s)) { seat = s; break; }
        if (seat < 0) { try { conn.send({ t: 'error', msg: '満員です' }); } catch (e) {} return; }
        app.net.assign(conn, seat, name || ('Player' + seat));
        app.roster.push({ seat, name: name || ('Player' + seat), isAI: false });
        try { conn.send({ t: 'assigned', seat, roster: app.roster }); } catch (e) {}
        broadcastLobby(); renderLobby();
      },
      onMessage: (seat, msg) => hostHandle(seat, msg),
      onLeave: (seat) => {
        if (app.started && app.engine) { app.engine.players[seat].isAI = true; app.engine.players[seat].name = 'AI(離脱)'; hostTick(); }
        else { app.roster = app.roster.filter(r => r.seat !== seat); broadcastLobby(); renderLobby(); }
      },
    });
  }
  function broadcastLobby() { for (const s in app.net.conns) app.net.sendTo(s, { t: 'lobby', roster: app.roster }); }

  function startGame() {
    if (app.started) return;
    app.started = true;
    let ai = 1; const defs = [];
    for (let s = 0; s < 4; s++) {
      const r = app.roster.find(x => x.seat === s);
      if (r) defs.push({ id: 's' + s, name: r.name, isAI: !!r.isAI });
      else defs.push({ id: 's' + s, name: 'AI' + (ai++), isAI: true });
    }
    app.engine = new window.INOEngine.Engine(defs);
    INOUI.reset();
    hostTick();
  }

  function hostHandle(seat, msg) {
    const E = app.engine; if (!E) return;
    if (msg.t === 'action') {
      let r;
      if (msg.action === 'play') r = E.playCards(seat, msg.uids, msg.opts || {});
      else if (msg.action === 'pass') r = E.pass(seat);
      if (r && r.error) { app.net.sendTo(seat, { t: 'error', msg: r.error }); return; }
      hostTick();
    } else if (msg.t === 'decision') {
      const dec = E.nextDecision();
      if (dec && dec.id === msg.id && dec.seat === seat) { E.resolveDecision(msg.id, msg.answer); hostTick(); }
    }
  }

  function hostTick() {
    const E = app.engine; if (!E) return;
    // 配信 + ホスト描画
    app.net.broadcast(seat => E.snapshot(seat));
    app.snap = E.snapshot(app.selfSeat);
    INOUI.renderGame(app);
    E.flushEvents();

    if (E.gameOver) return;
    clearTimeout(app.timer);
    if (E.roundOver) { app.timer = setTimeout(() => { E.startRound(); hostTick(); }, 2800); return; }

    const dec = E.nextDecision();
    if (dec) {
      const owner = E.players[dec.seat];
      if (owner.isAI) app.timer = setTimeout(() => { E.resolveDecision(dec.id, INOAI.resolveDecision(E, dec)); hostTick(); }, 900);
      return; // human はモーダルで入力待ち
    }
    const seat = E.turn; const p = E.players[seat];
    if (E.mustPassNow(seat)) { app.timer = setTimeout(() => { E.pass(seat); hostTick(); }, 850); return; }
    if (p.isAI) app.timer = setTimeout(() => { aiAct(seat); hostTick(); }, 1200);
    // human はUIで入力待ち
  }

  function aiAct(seat) {
    const E = app.engine; const p = E.players[seat];
    const act = INOAI.chooseAction(E, seat);
    if (act.kind === 'play') {
      const r = E.playCards(seat, act.uids, act.opts);
      if (r.error) { const pr = E.pass(seat); if (pr.error) forcePlay(seat); }
    } else {
      const r = E.pass(seat);
      if (r.error) forcePlay(seat); // 3連続パス後の強制出し
    }
  }
  function forcePlay(seat) {
    const E = app.engine, p = E.players[seat];
    const c = p.hand.find(x => E.matchesBoard(x) && !E.blockedByDebuff(p, x));
    if (c) { const o = (c.kind === 'wild' || c.kind === 'wd4') ? { color: E.autoColor(p) } : {}; E.playCards(seat, [c.uid], o); }
    else E.pass(seat);
  }

  /* ============================================================
     クライアント
     ============================================================ */
  function joinRoom() {
    const nm = $('nameInput').value.trim(); if (!nm) { menuError('名前を入力してください'); return; }
    const code = $('codeInput').value.trim(); if (!code) { menuError('ルームコードを入力してください'); return; }
    app.role = 'client'; app.name = nm;
    menuError('接続中…');
    app.net = Net.join(code, nm, {
      onAssigned: (seat, roster) => { app.selfSeat = seat; app.roster = roster; show('lobby'); setRoomCode(code); $('startBtn').classList.add('hidden'); $('lobbyHint').textContent = 'ホストの開始を待っています…'; renderLobby(); menuError(''); },
      onLobby: (roster) => { app.roster = roster; renderLobby(); },
      onState: (snap) => { app.started = true; app.snap = snap; INOUI.renderGame(app); },
      onError: (m) => app.onNetError(m),
      onClose: () => toast('ホストとの接続が切れました'),
    });
  }

  /* ============================================================
     行動の送信(UIから呼ばれる)
     ============================================================ */
  app.submitPlay = (uids, opts) => {
    if (app.role === 'host') { const r = app.engine.playCards(app.selfSeat, uids, opts || {}); if (r.error) { toast(r.error); return; } hostTick(); }
    else app.net.send({ t: 'action', action: 'play', uids, opts });
  };
  app.submitPass = () => {
    if (app.role === 'host') { const r = app.engine.pass(app.selfSeat); if (r.error) { toast(r.error); return; } hostTick(); }
    else app.net.send({ t: 'action', action: 'pass' });
  };
  app.submitDecision = (answer) => {
    if (app.role === 'host') { const dec = app.engine.nextDecision(); if (dec && dec.seat === app.selfSeat) { app.engine.resolveDecision(dec.id, answer); hostTick(); } }
    else { const dec = app.snap && app.snap.decision; if (dec) app.net.send({ t: 'decision', id: dec.id, answer }); }
  };
  app.playAgain = () => location.reload();

  /* ---------- ボタン配線 ---------- */
  window.addEventListener('DOMContentLoaded', () => {
    $('createBtn').onclick = createRoom;
    $('joinBtn').onclick = joinRoom;
    $('startBtn').onclick = startGame;
    $('copyBtn').onclick = () => { const c = $('roomCode').textContent; navigator.clipboard && navigator.clipboard.writeText(c); toast('コードをコピーしました'); };
    $('leaveBtn').onclick = () => location.reload();
    show('menu');
  });
})();
