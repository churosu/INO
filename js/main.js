/* ============================================================
   INO - main.js  (コントローラ)
   ソロ(AI対戦) / オンライン(ホスト・クライアント) 進行
   ============================================================ */
(function () {
  const Net = window.INONet;
  const app = {
    role: null, name: '', selfSeat: 0,
    net: null, engine: null, snap: null,
    roster: [], started: false, timer: null, hostRetries: 0,
    turnTimeout: null, turnDeadline: null,
  };
  window.app = app;

  const $ = id => document.getElementById(id);
  const escapeHtml = s => (s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  function show(screen) {
    ['menu', 'lobby', 'game'].forEach(s => {
      const e = $(s);
      if (s === 'game') e.classList.toggle('on', screen === 'game');
      else e.classList.toggle('hidden', screen !== s);
    });
  }
  function menuError(m) { const e = $('menuErr'); if (e) e.textContent = m || ''; }
  function toast(m) { const t = $('toast'); if (!t) return; t.textContent = m; t.style.opacity = '1'; clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = '0', 2400); }
  app.onNetError = (m) => { if (app.snap || app.started) toast(typeof m === 'string' ? m : '通信エラー'); else menuError(String(m)); };

  function nameOrDefault() { const v = ($('nameInput').value || '').trim(); return v || 'プレイヤー'; }

  /* ===== ソロ(AIと対戦) 通信なしで必ず起動 ===== */
  function startSolo() {
    if (!window.INOEngine) { menuError('スクリプトを読み込めていません。アップロード構成を確認してください。'); return; }
    app.role = 'host'; app.net = null; app.selfSeat = 0; app.started = true;
    const defs = [
      { id: 's0', name: nameOrDefault(), isAI: false },
      { id: 's1', name: 'AI1', isAI: true },
      { id: 's2', name: 'AI2', isAI: true },
      { id: 's3', name: 'AI3', isAI: true },
    ];
    app.engine = new window.INOEngine.Engine(defs);
    window.INOUI.reset();
    hostTick();
  }

  /* ===== ロビー ===== */
  function setRoomCode(code) { $('roomCode').textContent = code; }
  function renderLobby() {
    const list = $('rosterList'); list.innerHTML = '';
    for (let s = 0; s < 4; s++) {
      const r = app.roster.find(x => x.seat === s);
      const slot = document.createElement('div');
      if (r) { slot.className = 'slot' + (r.isAI ? ' ai' : ''); slot.innerHTML = '<span class="dot"></span> 席' + (s + 1) + ': ' + escapeHtml(r.name) + (r.seat === app.selfSeat ? ' (あなた)' : ''); }
      else { slot.className = 'slot empty'; slot.innerHTML = '<span class="dot"></span> 席' + (s + 1) + ': 空席 → 開始時にAIが入ります'; }
      list.appendChild(slot);
    }
  }

  /* ===== オンライン: ホスト ===== */
  function createRoom() {
    if (typeof Peer === 'undefined') { menuError('PeerJSを読み込めませんでした。オンライン対戦は使えません。「1人で遊ぶ」をお試しください。'); return; }
    if (!window.INONet) { menuError('スクリプトを読み込めていません。アップロード構成を確認してください。'); return; }
    app.role = 'host'; app.name = nameOrDefault(); app.selfSeat = 0;
    app.roster = [{ seat: 0, name: app.name, isAI: false }];
    show('lobby'); setRoomCode('接続中…'); $('startBtn').classList.remove('hidden');
    $('lobbyHint').textContent = 'サーバーに接続しています…（数秒かかることがあります）';
    renderLobby();
    spawnHost();
  }
  function spawnHost() {
    let ready = false;
    app.net = Net.host({
      onReady: (id) => { ready = true; app.hostRetries = 0; setRoomCode(id); $('lobbyHint').textContent = 'このコードを共有して参加してもらうか、そのまま「ゲーム開始」でAIと対戦できます。'; },
      onError: (e) => {
        const type = (e && (e.type || e.message)) || e;
        if (!ready && (type === 'unavailable-id') && app.hostRetries < 4) { app.hostRetries++; try { app.net.close(); } catch (x) {} spawnHost(); return; }
        if (!ready) { $('lobbyHint').textContent = '接続に失敗しました: ' + type + ' ／「1人で遊ぶ」でAIとは対戦できます。'; setRoomCode('接続失敗'); }
        else toast('通信エラー: ' + type);
      },
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
        if (app.started && app.engine) { app.engine.players[seat].isAI = true; app.engine.players[seat].name = 'AI(離脱)'; if (app.engine.roundOver) ackRound(seat); else hostTick(); }
        else { app.roster = app.roster.filter(r => r.seat !== seat); broadcastLobby(); renderLobby(); }
      },
    });
    setTimeout(() => { if (!ready && app.role === 'host' && !app.started) $('lobbyHint').textContent = 'まだ接続できていません。回線環境によってはオンライン対戦が使えないことがあります。「1人で遊ぶ」はそのまま遊べます。'; }, 8000);
  }
  function broadcastLobby() { if (!app.net) return; for (const s in app.net.conns) app.net.sendTo(s, { t: 'lobby', roster: app.roster }); }

  function startGame() {
    if (app.started) return;
    if (!window.INOEngine) { toast('スクリプト未読み込み'); return; }
    app.started = true;
    let ai = 1; const defs = [];
    for (let s = 0; s < 4; s++) {
      const r = app.roster.find(x => x.seat === s);
      if (r) defs.push({ id: 's' + s, name: r.name, isAI: !!r.isAI });
      else defs.push({ id: 's' + s, name: 'AI' + (ai++), isAI: true });
    }
    app.engine = new window.INOEngine.Engine(defs);
    window.INOUI.reset();
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
    } else if (msg.t === 'ack') {
      ackRound(seat);
    } else if (msg.t === 'cutready') {
      if (app.cutReady) { app.cutReady.add(seat); app.checkCutGate && app.checkCutGate(); }
    }
  }

  const TURN_MS = 100000; // 手番制限時間 100秒

  function buildSnap(seat) {
    const s = app.engine.snapshot(seat);
    s.turnLimit = 100;
    s.turnSecondsLeft = (app.turnDeadline != null) ? Math.max(0, Math.ceil((app.turnDeadline - Date.now()) / 1000)) : null;
    s.roundAcks = app.roundAcks ? [...app.roundAcks] : [];
    return s;
  }

  function rebroadcast() {
    const E = app.engine; if (!E) return;
    if (app.net) app.net.broadcast(seat => buildSnap(seat));
    app.snap = buildSnap(app.selfSeat);
    window.INOUI.renderGame(app);
    E.flushEvents();
  }

  function hostTick() {
    const E = app.engine; if (!E) return;
    clearTimeout(app.timer); clearTimeout(app.turnTimeout); clearTimeout(app.gateTimer);
    app.turnDeadline = null; // タイマーはカットインを見終えてから設定

    // 配信 + 描画（カットインがUIに積まれる）
    rebroadcast();

    if (E.gameOver) return;

    // バフ/デバフのカットインは「ホストがクリック」または「プレイヤーの過半数がクリック」で進む
    let gated = false;
    try {
      if (window.INOUI && typeof window.INOUI.hasPendingCutins === 'function' && window.INOUI.hasPendingCutins()) {
        gated = true;
        app.cutReady = new Set();
        app.cutGateDone = false;
        const advance = () => {
          if (app.cutGateDone) return; app.cutGateDone = true;
          clearTimeout(app.gateTimer);
          try { window.INOUI.clearCutins && window.INOUI.clearCutins(); } catch (e) {}
          scheduleNext();
        };
        app.checkCutGate = () => {
          const humans = E.players.filter(p => !p.isAI).map(p => p.seat);
          const need = Math.floor(humans.length / 2) + 1;
          const ready = [...app.cutReady].filter(s => humans.includes(s)).length;
          if (app.cutReady.has(app.selfSeat) || ready >= need) advance();
        };
        window.INOUI.onDrain(() => { app.cutReady.add(app.selfSeat); app.checkCutGate(); });
        app.gateTimer = setTimeout(advance, 12000); // 保険（誰もクリックしなくても進む）
      }
    } catch (e) { gated = false; }
    if (!gated) { app.checkCutGate = null; scheduleNext(); }
  }

  function scheduleNext() {
    const E = app.engine; if (!E || E.gameOver) return;
    clearTimeout(app.timer); clearTimeout(app.turnTimeout); clearTimeout(app.gateTimer);

    if (E.roundOver) { startRoundAckWait(); return; }

    // 決定キュー
    const dec = E.nextDecision();
    if (dec) {
      const owner = E.players[dec.seat];
      if (owner.isAI) app.timer = setTimeout(() => { E.resolveDecision(dec.id, window.INOAI.resolveDecision(E, dec)); hostTick(); }, 750);
      else { app.turnDeadline = Date.now() + TURN_MS; rebroadcast(); app.turnTimeout = setTimeout(() => autoTimeoutDecision(dec), TURN_MS); }
      return;
    }

    // 手番
    const seat = E.turn; const p = E.players[seat];
    if (p.isAI) {
      if (E.mustPassNow(seat)) app.timer = setTimeout(() => { E.pass(seat); hostTick(); }, 750);
      else app.timer = setTimeout(() => { aiAct(seat); hostTick(); }, 1100);
    } else {
      app.turnDeadline = Date.now() + TURN_MS; rebroadcast();
      app.turnTimeout = setTimeout(() => autoTimeoutTurn(seat), TURN_MS);
    }
  }

  /* ラウンド決着: 全員（人間）がクリックしてから次へ。AI席は自動承認 */
  function startRoundAckWait() {
    const E = app.engine;
    app.roundAcks = new Set();
    E.players.forEach(pl => { if (pl.isAI) app.roundAcks.add(pl.seat); });
    rebroadcast();
    checkRoundAcks();
  }
  function ackRound(seat) {
    const E = app.engine;
    if (!E || !E.roundOver || E.gameOver) return;
    if (!app.roundAcks) app.roundAcks = new Set();
    app.roundAcks.add(seat);
    if (!checkRoundAcks()) rebroadcast(); // まだ揃わなければ待機表示を更新
  }
  function checkRoundAcks() {
    const E = app.engine;
    if (app.roundAcks && app.roundAcks.size >= E.players.length) {
      E.startRound(); app.roundAcks = null; hostTick(); return true;
    }
    return false;
  }

  function autoTimeoutTurn(seat) {
    const E = app.engine; if (!E || E.gameOver || E.roundOver) return;
    if (E.turn !== seat || E.nextDecision()) return;
    const r = E.pass(seat);
    if (r && r.error) forcePlay(seat);
    hostTick();
  }
  function autoTimeoutDecision(dec) {
    const E = app.engine; if (!E) return;
    const cur = E.nextDecision();
    if (cur && cur.id === dec.id) { E.resolveDecision(dec.id, window.INOAI.resolveDecision(E, dec)); hostTick(); }
  }

  function aiAct(seat) {
    const E = app.engine;
    const act = window.INOAI.chooseAction(E, seat);
    if (act.kind === 'play') {
      const r = E.playCards(seat, act.uids, act.opts);
      if (r.error) { const pr = E.pass(seat); if (pr.error) forcePlay(seat); }
    } else {
      const r = E.pass(seat);
      if (r.error) forcePlay(seat);
    }
  }
  function forcePlay(seat) {
    const E = app.engine, p = E.players[seat];
    const c = p.hand.find(x => E.matchesBoard(x) && !E.blockedByDebuff(p, x));
    if (c) { const o = (c.kind === 'wild' || c.kind === 'wd4') ? { color: E.autoColor(p) } : {}; const r = E.playCards(seat, [c.uid], o); if (r && r.error) E.pass(seat); }
    else E.pass(seat);
  }

  /* ===== オンライン: クライアント ===== */
  function joinRoom() {
    if (typeof Peer === 'undefined') { menuError('PeerJSを読み込めませんでした。オンライン対戦は使えません。'); return; }
    const code = ($('codeInput').value || '').trim(); if (!code) { menuError('ルームコードを入力してください'); return; }
    app.role = 'client'; app.name = nameOrDefault();
    menuError('接続中…');
    app.net = Net.join(code, app.name, {
      onAssigned: (seat, roster) => { app.selfSeat = seat; app.roster = roster; show('lobby'); setRoomCode(code); $('startBtn').classList.add('hidden'); $('lobbyHint').textContent = 'ホストの開始を待っています…'; renderLobby(); menuError(''); },
      onLobby: (roster) => { app.roster = roster; renderLobby(); },
      onState: (snap) => { app.started = true; app.snap = snap; window.INOUI.renderGame(app); if (window.INOUI.hasPendingCutins()) window.INOUI.onDrain(() => app.net && app.net.send({ t: 'cutready' })); },
      onError: (m) => app.onNetError(m),
      onClose: () => toast('ホストとの接続が切れました'),
    });
  }

  /* ===== 行動送信(UIから) ===== */
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
  app.submitAck = () => {
    if (app.role === 'host') ackRound(app.selfSeat);
    else app.net.send({ t: 'ack' });
  };
  app.playAgain = () => location.reload();

  /* ===== 配線 ===== */
  window.addEventListener('DOMContentLoaded', () => {
    $('soloBtn').onclick = startSolo;
    $('createBtn').onclick = createRoom;
    $('joinBtn').onclick = joinRoom;
    $('startBtn').onclick = startGame;
    $('copyBtn').onclick = () => { const c = $('roomCode').textContent; if (navigator.clipboard) navigator.clipboard.writeText(c); toast('コードをコピーしました'); };
    $('leaveBtn').onclick = () => location.reload();
    // 効果音の初期化（ブラウザのポリシー上、最初の操作で有効化）
    document.addEventListener('pointerdown', () => { window.INOUI && window.INOUI.initAudio && window.INOUI.initAudio(); });
    show('menu');
  });
})();
