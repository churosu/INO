/* ============================================================
   INO - ui.js  (描画 + 入力 + カットイン + 決定モーダル)
   app: { snap, selfSeat, role, submitPlay, submitPass, submitDecision, playAgain }
   ============================================================ */
(function (global) {
  const COLORS = ['red', 'blue', 'yellow', 'green'];
  const COLOR_JP = { red: '赤', blue: '青', yellow: '黄', green: '緑' };
  const COLOR_HEX = { red: '#e23b32', blue: '#2c6fd4', yellow: '#e8b400', green: '#3a9d4b' };
  const SYMS = ['skip', 'draw2', 'reverse', 'gift', 'snipe', 'change'];
  const BACK = 'assets/card_back.png';

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  const UI = {
    _sel: new Set(),
    _cutQ: [], _cutShowing: false,
    _decId: null, _snipe: null,
    _abOpen: false, _logOpen: false,
    _deadline: null, _timerInt: null, _timerName: '', _timerToken: null,
    _drainCb: null, _lastRound: null,
    app: null,

    reset() { this._sel = new Set(); this._cutQ = []; this._cutShowing = false; this._decId = null; this._snipe = null; this._abOpen = false; this._logOpen = false; this._deadline = null; this._timerToken = null; this._drainCb = null; },

    syncTimer(snap) {
      const active = snap.turnSecondsLeft != null && !snap.roundOver && !snap.gameOver;
      const ws = (snap.decision && snap.decision.seat != null) ? snap.decision.seat : snap.turn;
      const token = active ? `${snap.round}|${snap.turn}|${snap.decision ? snap.decision.id : '-'}` : null;
      if (token !== this._timerToken) {
        this._timerToken = token;
        this._deadline = active ? Date.now() + snap.turnSecondsLeft * 1000 : null;
        this._timerName = (snap.players[ws] || {}).name || '';
      }
      if (!this._timerInt) this._timerInt = setInterval(() => this.tickTimer(), 250);
      this.tickTimer();
    },
    tickTimer() {
      const el2 = document.getElementById('turntimer'); if (!el2) return;
      if (this._deadline == null) { el2.textContent = '⏱ --'; el2.classList.remove('warn'); return; }
      const left = Math.max(0, Math.ceil((this._deadline - Date.now()) / 1000));
      el2.textContent = `⏱ ${left}s ・ ${this.short(this._timerName)}`;
      el2.classList.toggle('warn', left <= 15);
    },

    /* ---------- メイン描画 ---------- */
    renderGame(app) {
      this.app = app;
      const snap = app.snap; if (!snap) return;
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('lobby').classList.add('hidden');
      document.getElementById('game').classList.add('on');

      // イベント処理(カットインを積む)
      (snap.events || []).forEach(ev => { if (ev.type === 'cutin') this._cutQ.push(ev); });
      this.pumpCutins();

      this.buildBoard(snap, app.selfSeat);

      // ラウンド結果 / 勝敗 / 決定モーダル
      if (snap.gameOver) { this.showGameOver(snap); }
      else if (snap.roundOver) { this.showRoundResult(snap); }
      else {
        const dec = snap.decision;
        if (dec && dec.seat === app.selfSeat) this.showDecision(dec, snap);
        else { this._decId = null; this.hideModal(); }
      }
    },

    /* ---------- 盤面構築 ---------- */
    buildBoard(snap, selfSeat) {
      const N = snap.players.length;
      let root = document.getElementById('board-root');
      root.innerHTML = '';

      // 背景の色を盤面の色に合わせる
      const tint = document.getElementById('bgtint');
      if (tint) {
        const col = snap.board.color ? COLOR_HEX[snap.board.color] : null;
        tint.style.background = col ? `radial-gradient(1100px 760px at 50% 32%, ${col}55, ${col}14 55%, transparent 72%)` : 'transparent';
      }

      // felt（盤面の色に合わせて円内を着色）
      const felt = el('div', 'felt');
      felt.style.transition = 'background .6s ease';
      if (snap.board.color) {
        const c = COLOR_HEX[snap.board.color];
        felt.style.background = `radial-gradient(circle at 50% 45%, ${c} 0%, ${c}aa 38%, ${c}33 62%, #0f1722 82%)`;
      }
      root.appendChild(felt);

      // 円内の大きな回転方向
      const arrow = el('div', 'dirarrow ' + (snap.dir === 1 ? 'spin-ccw' : 'spin-cw'), snap.dir === 1 ? '↺' : '↻');
      root.appendChild(arrow);

      // topbar
      const scores = snap.players.map(p => `${this.short(p.name)} ${p.roundWins}`).join(' ・ ');
      const bar = el('div', 'topbar', `<span class="round">R${snap.round}</span><span class="ttimer" id="turntimer">⏱ --</span><span>${scores}</span>`);
      root.appendChild(bar);
      this.syncTimer(snap);

      // 異能一覧 / ログ トグル
      const abBtn = el('button', 'iconbtn left' + (this._abOpen ? ' on' : ''), '異能一覧');
      abBtn.onclick = () => { this._abOpen = !this._abOpen; this.buildBoard(snap, selfSeat); };
      root.appendChild(abBtn);
      const logBtn = el('button', 'iconbtn right' + (this._logOpen ? ' on' : ''), 'ログ');
      logBtn.onclick = () => { this._logOpen = !this._logOpen; this.buildBoard(snap, selfSeat); };
      root.appendChild(logBtn);
      if (this._abOpen) root.appendChild(this.buildAbilityPanel(snap, selfSeat));
      if (this._logOpen) root.appendChild(this.buildLogPanel(snap));

      // 方向バッジ
      root.appendChild(el('div', 'dirbadge', snap.dir === 1 ? '↺ 左回り' : '↻ 右回り'));

      // 中央(山札・場札・色ランプ)
      const center = el('div', 'center');
      const deck = el('div', 'deck');
      const deckTop = el('div', 'top'); deckTop.style.backgroundImage = `url('${BACK}')`;
      deck.appendChild(deckTop);
      deck.appendChild(el('div', 'num', `山札 ${snap.deckCount}`));
      const pile = el('div', 'pile');
      if (snap.board.cards && snap.board.cards.length) {
        snap.board.cards.forEach((c, i) => {
          const im = el('img'); im.src = c.img; im.style.left = (i * 10) + 'px'; im.style.zIndex = i; pile.appendChild(im);
        });
      } else {
        const ph = el('div', '', '場札なし'); ph.style.cssText = 'color:var(--mut);font-size:11px;width:74px;text-align:center'; pile.appendChild(ph);
      }
      const lamp = el('div', 'colorlamp'); if (snap.board.color) { lamp.style.color = COLOR_HEX[snap.board.color]; lamp.style.background = COLOR_HEX[snap.board.color]; } else lamp.style.opacity = '0';
      center.appendChild(deck); center.appendChild(pile); center.appendChild(lamp);
      root.appendChild(center);

      // pending(ドロー)表示
      if (snap.pending && snap.pending.kind) {
        root.appendChild(el('div', 'pending', `${snap.pending.kind === 'wd4' ? 'ワイルドドロー4' : 'ドロー2'} 累積 +${snap.pending.amount}`));
      }

      // 席
      for (const p of snap.players) {
        const rel = ((p.seat - selfSeat) % N + N) % N;
        const pos = ['bottom', 'left', 'top', 'right'][rel];
        const seat = el('div', `seat pos-${pos}${snap.turn === p.seat ? ' active' : ''}`);
        if (rel !== 0) {
          // 相手: 裏向きミニ + 公開/宣言タグ
          const cards = el('div', 'oppcards');
          const show = Math.min(p.handCount, 12);
          for (let i = 0; i < show; i++) { const m = el('div', 'mini'); m.style.backgroundImage = `url('${BACK}')`; cards.appendChild(m); }
          (p.revealed || []).forEach(c => { const m = el('div', 'mini'); m.style.backgroundImage = `url('${c.img}')`; cards.appendChild(m); });
          if (pos === 'top') seat.appendChild(cards);
          const plate = el('div', 'nameplate', `${this.esc(p.name)}${p.isAI ? '' : ''} <span class="wins">${'★'.repeat(p.roundWins)}</span>`);
          seat.appendChild(plate);
          seat.appendChild(el('div', 'count', `手札 ${p.handCount}`));
          const tags = el('div', '', '');
          if (p.declaredColor) tags.appendChild(el('span', 'tag declare', `宣言:${COLOR_JP[p.declaredColor]}`));
          if (p.lockWin) tags.appendChild(el('span', 'tag declare', '上がり制限'));
          tags.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;justify-content:center';
          seat.appendChild(tags);
          if (p.ability) {
            const oa = el('div', 'oppability');
            oa.innerHTML = `<span class="b">バフ：${this.esc(p.ability.buff)}</span><span class="cond">条件：${this.esc(p.ability.condBuff)}</span>` +
                           `<span class="d">デバフ：${this.esc(p.ability.debuff)}</span><span class="cond">条件：${this.esc(p.ability.condDebuff)}</span>`;
            seat.appendChild(oa);
          }
          if (pos !== 'top') seat.appendChild(cards);
        } else {
          const plate = el('div', 'nameplate', `<span class="you">${this.esc(p.name)}(あなた)</span> <span class="wins">${'★'.repeat(p.roundWins)}</span>`);
          seat.appendChild(plate);
        }
        root.appendChild(seat);
      }

      // 自分の手札 + 操作
      const me = snap.players[selfSeat];
      const wrap = el('div', 'hand-wrap');
      // ターン表示
      const myDecision = snap.decision && snap.decision.seat === selfSeat;
      const isMyTurn = snap.turn === selfSeat && !snap.decision && !snap.roundOver && !snap.gameOver;
      const forced = isMyTurn && snap.forcedPass;
      const tmsg = el('div', 'turnmsg' + (isMyTurn ? ' your' : ''));
      if (myDecision) tmsg.textContent = '選択してください';
      else if (snap.roundOver) tmsg.textContent = '';
      else if (forced) tmsg.textContent = '強制パス：パスのみ可能です（パスを押してください）';
      else if (isMyTurn) tmsg.textContent = snap.pending && snap.pending.kind ? `あなたの番 — 同じ記号を重ねるか「ドローを受ける」` : 'あなたの番です';
      else tmsg.textContent = `${this.esc(snap.players[snap.turn] ? snap.players[snap.turn].name : '')} の番…`;
      wrap.appendChild(tmsg);

      // ability 表示(自分の異能 — 常時・大きめ・条件つき)
      if (me.ability) {
        const ab = el('div', 'myability');
        ab.innerHTML =
          `<div class="ab-row buff"><span class="ab-tag">バフ</span><span class="ab-body"><span class="ab-eff">${this.esc(me.ability.buff)}</span><span class="ab-cond">条件：${this.esc(me.ability.condBuff)}</span></span></div>` +
          `<div class="ab-row debuff"><span class="ab-tag">デバフ</span><span class="ab-body"><span class="ab-eff">${this.esc(me.ability.debuff)}</span><span class="ab-cond">条件：${this.esc(me.ability.condDebuff)}</span></span></div>`;
        wrap.appendChild(ab);
      }

      const hand = el('div', 'hand');
      const sorted = (me.hand || []).slice();
      for (const c of sorted) {
        const hc = el('div', 'hcard'); hc.style.backgroundImage = `url('${c.img}')`;
        const playable = isMyTurn && !forced && this.canPlayClient(c, snap, me);
        if (this._sel.has(c.uid)) hc.classList.add('sel');
        if (isMyTurn && !playable && !this._sel.has(c.uid)) hc.classList.add('disabled');
        hc.onclick = () => { if (forced) return; this.toggleCard(c, snap, me); };
        hand.appendChild(hc);
      }
      wrap.appendChild(hand);

      // 操作ボタン
      const acts = el('div', 'actions');
      const playBtn = el('button', 'btn primary', '出す');
      playBtn.disabled = !(isMyTurn && !forced && this._sel.size > 0);
      playBtn.onclick = () => this.doPlay(snap, me);
      const passBtn = el('button', 'btn ghost', (snap.pending && snap.pending.kind) ? 'ドローを受ける' : (forced ? 'パス（強制）' : 'パス'));
      passBtn.disabled = !isMyTurn;
      passBtn.onclick = () => { this._sel.clear(); this.app.submitPass(); };
      acts.appendChild(playBtn); acts.appendChild(passBtn);
      wrap.appendChild(acts);

      root.appendChild(wrap);
    },

    short(n) { return (n || '').length > 6 ? n.slice(0, 6) : n; },
    esc(s) { return (s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); },

    buildAbilityPanel(snap, selfSeat) {
      const panel = el('div', 'sidepanel ab');
      let rows = '';
      snap.players.forEach(p => {
        const me = p.seat === selfSeat;
        rows += `<div class="ap-player${me ? ' me' : ''}">
            <div class="ap-name">${this.esc(p.name)}${me ? '（あなた）' : ''} <span class="ap-wins">${'★'.repeat(p.roundWins)}</span></div>
            <div class="ap-line buff"><span class="ap-k">バフ</span><span class="ap-e">${this.esc(p.ability.buff)}</span><span class="ap-c">条件：${this.esc(p.ability.condBuff)}</span></div>
            <div class="ap-line debuff"><span class="ap-k">デバフ</span><span class="ap-e">${this.esc(p.ability.debuff)}</span><span class="ap-c">条件：${this.esc(p.ability.condDebuff)}</span></div>
          </div>`;
      });
      panel.innerHTML = `<div class="sp-head"><span>異能一覧</span><button class="sp-close" id="abClose">閉じる</button></div><div class="sp-body">${rows}</div>`;
      panel.querySelector('#abClose').onclick = () => { this._abOpen = false; this.buildBoard(snap, selfSeat); };
      return panel;
    },

    buildLogPanel(snap) {
      const panel = el('div', 'sidepanel log');
      const items = (snap.log || []).map(l => `<div class="lg ${l.type}">${this.esc(l.text)}</div>`).join('');
      panel.innerHTML = `<div class="sp-head"><span>ログ</span><button class="sp-close" id="lgClose">閉じる</button></div><div class="sp-body" id="lgBody">${items || '<div class="lg info">まだログはありません</div>'}</div>`;
      panel.querySelector('#lgClose').onclick = () => { this._logOpen = false; this.buildBoard(snap, this.app.selfSeat); };
      setTimeout(() => { const b = document.getElementById('lgBody'); if (b) b.scrollTop = b.scrollHeight; }, 0);
      return panel;
    },

    /* ---------- クライアント側の合法性ヒント ---------- */
    canPlayClient(c, snap, me) {
      if (snap.pending && snap.pending.kind) return c.kind === snap.pending.kind;
      // デバフ: 記号不発で出せない(簡易) — サーバ側で最終判定
      if (snap.startingPlay) return true;
      if (c.kind === 'wild' || c.kind === 'wd4') return true;
      const b = snap.board;
      if (c.kind === 'change') return c.pair && c.pair.includes(b.color);
      if (c.color === b.color) return true;
      const top = b.cards && b.cards[0];
      if (top) {
        if (top.kind === c.kind && c.kind === 'number' && top.value === c.value) return true;
        if (top.kind === c.kind && c.kind !== 'number') return true;
      }
      return false;
    },

    sameGroup(a, b) {
      if (a.kind === 'wild' || a.kind === 'wd4') return b.kind === a.kind;
      if (a.kind === 'number') return b.kind === 'number' && b.value === a.value;
      return b.kind === a.kind;
    },

    toggleCard(c, snap, me) {
      if (snap.turn !== this.app.selfSeat || snap.decision) return;
      if (this._sel.has(c.uid)) { this._sel.delete(c.uid); }
      else {
        // 選択中グループと同種のみ追加。違えばリセット
        if (this._sel.size) {
          const any = me.hand.find(x => this._sel.has(x.uid));
          if (any && !this.sameGroup(any, c)) this._sel.clear();
        }
        this._sel.add(c.uid);
      }
      this.buildBoard(snap, this.app.selfSeat);
    },

    doPlay(snap, me) {
      const uids = [...this._sel];
      if (!uids.length) return;
      const cards = uids.map(u => me.hand.find(x => x.uid === u)).filter(Boolean);
      const finish = (opts) => { this._sel.clear(); this.app.submitPlay(uids, opts || {}); };
      const achievable = this.achievableColors(cards, snap.startingPlay, snap.board.color);
      if (achievable.length > 1) {
        const k = cards[0].kind;
        const title = (k === 'wild' || k === 'wd4') ? '色を選ぶ' : '一番上にする色を選ぶ';
        const sub = (k === 'wild' || k === 'wd4') ? `${k === 'wd4' ? 'ワイルドドロー4' : 'ワイルド'}の色を指定`
          : '複数の色を出しました。盤面（一番上）にする色を選んでください';
        this.askColor(title, sub, (col) => finish({ color: col }), achievable);
      } else {
        finish({ color: achievable[0] });
      }
    },

    // 出したカードで最上段に選べる色（engineと同じロジック）
    achievableColors(cards, startingPlay, boardColor) {
      const k = cards[0].kind;
      if (k === 'wild' || k === 'wd4') return ['red', 'blue', 'yellow', 'green'];
      if (k === 'change') {
        if (cards.length > 1) { const s = new Set(); cards.forEach(c => (c.pair || []).forEach(x => s.add(x))); return [...s]; }
        if (startingPlay) return (cards[0].pair || []).slice();
        const pair = cards[0].pair || [];
        return [pair[0] === boardColor ? pair[1] : pair[0]];
      }
      const s = new Set(); cards.forEach(c => { if (c.color) s.add(c.color); }); return [...s];
    },

    /* ============================================================
       カットイン
       ============================================================ */
    pumpCutins() {
      if (this._cutShowing) return;
      if (!this._cutQ.length) { const cb = this._drainCb; if (cb) { this._drainCb = null; cb(); } return; }
      const ev = this._cutQ.shift();
      this._cutShowing = true;
      const layer = document.getElementById('cutin');
      const name = (this.app.snap.players[ev.seat] || {}).name || '';
      const pcls = 'p' + (ev.seat % 4);
      let body, kindcls;
      if (ev.kind === 'ino') {
        kindcls = 'ino';
        body = `<div class="ci-tag">【INO】</div><div class="ci-name">${this.esc(name)}</div><div class="ci-eff">次に上がれる！</div>`;
      } else {
        kindcls = ev.kind;
        const tag = ev.kind === 'buff' ? '【バフ】' : '【デバフ】';
        body = `<div class="ci-tag">${tag}</div><div class="ci-name">${this.esc(name)}</div>` +
               `<div class="ci-cond">条件：${this.esc(ev.condText)}</div>` +
               `<div class="ci-eff">効果：${this.esc(ev.effText)}</div>`;
      }
      layer.className = 'cutin-layer on ' + pcls + ' ' + kindcls;
      layer.innerHTML = `<div class="ci-box">${body}<div class="ci-tap">クリックで進む ▶</div></div>`;
      const dismiss = () => {
        layer.classList.remove('on'); layer.onclick = null; clearTimeout(this._cutTimer);
        this._cutShowing = false;
        setTimeout(() => this.pumpCutins(), 70);
      };
      layer.onclick = dismiss;
      this._cutTimer = setTimeout(dismiss, 12000); // 安全フォールバック(長め)
    },
    hasPendingCutins() { return this._cutShowing || this._cutQ.length > 0; },
    onDrain(cb) { this._drainCb = cb; this.pumpCutins(); },


    /* ============================================================
       決定モーダル
       ============================================================ */
    modalEl() { return document.getElementById('modal'); },
    hideModal() { this.modalEl().classList.remove('on'); },
    openModal(html) { const m = this.modalEl(); m.innerHTML = `<div class="modal">${html}</div>`; m.classList.add('on'); return m.querySelector('.modal'); },

    showDecision(dec, snap) {
      if (this._decId === dec.id) return; // 既に表示中(状態保持)
      this._decId = dec.id; this._snipe = null;
      const me = snap.players[this.app.selfSeat];
      switch (dec.type) {
        case 'chooseColor': return this.decColor(dec, '盤面の色を変更', 'バフ効果：好きな色を選べます');
        case 'forbidWin': return this.decColor(dec, '禁止上がり色を指定', 'この色だけでは上がれなくなります（次のあなたの番まで）');
        case 'declareColor': return this.decColor(dec, '手札の色を宣言', '持っている色を1つ全員に公開します');
        case 'gift': return this.decSelectCards(dec, me, dec.amount, '次のプレイヤーへ渡す', `${dec.amount}枚を選んでください`);
        case 'discard': return this.decSelectCards(dec, me, dec.amount, 'カードを破棄', `${dec.amount}枚を選んでください`);
        case 'snipe': return this.decSnipe(dec, snap);
        case 'pickFromDeck': return this.decPickDeck(dec, snap);
        case 'buff7play': return this.decBuff7(dec, me, snap);
      }
    },

    decColor(dec, title, sub, allowed) {
      const cols = allowed || COLORS;
      const m = this.openModal(`<h3>${title}</h3><div class="sub">${sub}</div>
        <div class="colorpick">${cols.map(c => `<div class="swatch" data-c="${c}" style="background:${COLOR_HEX[c]}"></div>`).join('')}</div>
        <div class="foot"><button class="btn primary" id="ok" disabled>決定</button></div>`);
      let pick = null;
      m.querySelectorAll('.swatch').forEach(s => s.onclick = () => {
        m.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel')); s.classList.add('sel');
        pick = s.dataset.c; m.querySelector('#ok').disabled = false;
      });
      m.querySelector('#ok').onclick = () => { this.hideModal(); this._decId = null; this.app.submitDecision({ color: pick }); };
    },

    decSelectCards(dec, me, amount, title, sub) {
      const sel = new Set();
      const m = this.openModal(`<h3>${title}</h3><div class="sub">${sub}</div>
        <div class="pickgrid" id="grid"></div>
        <div class="counter" id="cnt"></div>
        <div class="foot"><button class="btn primary" id="ok" disabled>決定</button></div>`);
      const grid = m.querySelector('#grid');
      const upd = () => { m.querySelector('#cnt').textContent = `${sel.size} / ${amount}`; m.querySelector('#ok').disabled = sel.size !== amount; };
      (me.hand || []).forEach(c => {
        const hc = el('div', 'hcard'); hc.style.backgroundImage = `url('${c.img}')`;
        hc.onclick = () => {
          if (sel.has(c.uid)) { sel.delete(c.uid); hc.classList.remove('sel'); }
          else if (sel.size < amount) { sel.add(c.uid); hc.classList.add('sel'); }
          upd();
        };
        grid.appendChild(hc);
      });
      upd();
      m.querySelector('#ok').onclick = () => { this.hideModal(); this._decId = null; this.app.submitDecision({ uids: [...sel] }); };
    },

    decSnipe(dec, snap) {
      const total = dec.picks; const assign = {};
      const opp = snap.players.filter(p => p.seat !== dec.seat);
      const m = this.openModal(`<h3>スナイプ</h3><div class="sub">合計 ${total} 回ぶん、ドローさせる相手を選ぶ（1回 = ${dec.per}枚）</div>
        <div class="targetgrid" id="tg"></div>
        <div class="counter" id="cnt"></div>
        <div class="foot"><button class="btn ghost" id="rst">リセット</button><button class="btn primary" id="ok" disabled>決定</button></div>`);
      const tg = m.querySelector('#tg');
      const draw = () => {
        tg.innerHTML = '';
        opp.forEach(p => {
          const t = el('div', 'tcard', `<div class="n">+${(assign[p.seat] || 0) * dec.per}</div><div class="nm">${this.esc(p.name)}</div><div class="nm" style="color:var(--ino)">手札 ${p.handCount}枚</div>`);
          t.onclick = () => { const used = Object.values(assign).reduce((a, b) => a + b, 0); if (used < total) { assign[p.seat] = (assign[p.seat] || 0) + 1; upd(); } };
          tg.appendChild(t);
        });
      };
      const upd = () => { const used = Object.values(assign).reduce((a, b) => a + b, 0); m.querySelector('#cnt').textContent = `${used} / ${total}`; m.querySelector('#ok').disabled = used !== total; draw(); };
      m.querySelector('#rst').onclick = () => { for (const k in assign) delete assign[k]; upd(); };
      m.querySelector('#ok').onclick = () => {
        const out = Object.entries(assign).filter(([s, n]) => n > 0).map(([s, n]) => ({ seat: +s, n }));
        this.hideModal(); this._decId = null; this.app.submitDecision({ assign: out });
      };
      upd();
    },

    decPickDeck(dec, snap) {
      const deck = snap.deckView || [];
      const m = this.openModal(`<h3>山札から1枚選ぶ</h3><div class="sub">好きなカードを手札に加えます（残り${deck.length}枚）</div>
        <div class="pickgrid" id="grid" style="max-height:46vh;overflow:auto"></div>
        <div class="foot"><button class="btn primary" id="ok" disabled>決定</button></div>`);
      const grid = m.querySelector('#grid'); let pick = null;
      deck.forEach(c => {
        const hc = el('div', 'hcard'); hc.style.backgroundImage = `url('${c.img}')`;
        hc.onclick = () => { grid.querySelectorAll('.hcard').forEach(x => x.classList.remove('sel')); hc.classList.add('sel'); pick = c.uid; m.querySelector('#ok').disabled = false; };
        grid.appendChild(hc);
      });
      m.querySelector('#ok').onclick = () => { this.hideModal(); this._decId = null; this.app.submitDecision({ uid: pick }); };
    },

    decBuff7(dec, me, snap) {
      const board = snap.board.color;
      const cand = (me.hand || []).filter(c => SYMS.includes(c.kind) && (c.color === board || c.kind === 'change'));
      if (!cand.length) { this.hideModal(); this._decId = null; this.app.submitDecision({ skip: true }); return; }
      const m = this.openModal(`<h3>バフ：手番外で記号を出す</h3><div class="sub">盤面(${COLOR_JP[board] || '-'})と同色の記号カードを1枚選んで出します</div>
        <div class="pickgrid" id="grid"></div>
        <div class="foot"><button class="btn ghost" id="skip">出さない</button><button class="btn primary" id="ok" disabled>出す</button></div>`);
      const grid = m.querySelector('#grid'); let pick = null;
      cand.forEach(c => {
        const hc = el('div', 'hcard'); hc.style.backgroundImage = `url('${c.img}')`;
        hc.onclick = () => { grid.querySelectorAll('.hcard').forEach(x => x.classList.remove('sel')); hc.classList.add('sel'); pick = c.uid; m.querySelector('#ok').disabled = false; };
        grid.appendChild(hc);
      });
      m.querySelector('#skip').onclick = () => { this.hideModal(); this._decId = null; this.app.submitDecision({ skip: true }); };
      m.querySelector('#ok').onclick = () => { this.hideModal(); this._decId = null; this.app.submitDecision({ uid: pick }); };
    },

    askColor(title, sub, cb, allowed) {
      const cols = allowed || COLORS;
      const m = this.openModal(`<h3>${title}</h3><div class="sub">${sub}</div>
        <div class="colorpick">${cols.map(c => `<div class="swatch" data-c="${c}" style="background:${COLOR_HEX[c]}"></div>`).join('')}</div>
        <div class="foot"><button class="btn primary" id="ok" disabled>決定</button></div>`);
      let pick = null;
      m.querySelectorAll('.swatch').forEach(s => s.onclick = () => { m.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel')); s.classList.add('sel'); pick = s.dataset.c; m.querySelector('#ok').disabled = false; });
      m.querySelector('#ok').onclick = () => { this.hideModal(); cb(pick); };
    },

    /* ---------- 勝敗 ---------- */
    showRoundResult(snap) {
      const self = this.app.selfSeat;
      const winners = snap.roundWinners || [];
      const names = winners.map(s => snap.players[s] ? snap.players[s].name : '').join('・');
      const acks = snap.roundAcks || [];
      const meAcked = acks.includes(self);
      const standings = snap.players.slice().sort((a, b) => b.roundWins - a.roundWins);
      const srows = standings.map(p => `<div class="srow${winners.includes(p.seat) ? ' win' : ''}">
          <span>${this.esc(p.name)}${p.seat === self ? '（あなた）' : ''}</span>
          <span class="stars">${'★'.repeat(p.roundWins)}${'☆'.repeat(Math.max(0, 2 - p.roundWins))}</span></div>`).join('');
      const ackChips = snap.players.map(p => `<span class="ack${acks.includes(p.seat) ? ' done' : ''}">${this.esc(this.short(p.name))}${acks.includes(p.seat) ? ' ✓' : ''}</span>`).join('');
      const html = `<div class="rr">
        <h3>ラウンド ${snap.round} 決着</h3>
        <div class="winner">🏆 ${this.esc(names)} の勝ち！</div>
        <div class="stand">${srows}</div>
        <div class="acks">${ackChips}</div>
        <div class="waiting">${meAcked ? '他のプレイヤーの準備を待っています…' : '全員が「次のラウンドへ」を押すと進みます（2本先取で優勝）'}</div>
        <div class="foot"><button class="btn primary" id="rrnext" ${meAcked ? 'disabled' : ''}>次のラウンドへ</button></div>
      </div>`;
      const m = this.openModal(html);
      const btn = m.querySelector('#rrnext');
      if (btn) btn.onclick = () => { btn.disabled = true; this.app.submitAck && this.app.submitAck(); };
    },

    showGameOver(snap) {
      const win = snap.gameWinnerSeat === this.app.selfSeat;
      const name = snap.players[snap.gameWinnerSeat].name;
      const m = this.openModal(`<div class="endcard">
        <h3>ゲーム終了</h3>
        <div class="big ${win ? 'win' : 'lose'}">${win ? 'あなたの勝ち！' : this.esc(name) + ' の勝ち'}</div>
        <div class="sub">2ラウンド先取で決着しました</div>
        <div class="foot"><button class="btn primary" id="again">もう一度</button></div></div>`);
      m.querySelector('#again').onclick = () => { this.hideModal(); this.app.playAgain && this.app.playAgain(); };
    },
  };

  global.INOUI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
