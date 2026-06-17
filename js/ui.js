/* ============================================================
   INO - ui.js  (描画 + 入力 + カットイン + 決定モーダル)
   app: { snap, selfSeat, role, submitPlay, submitPass, submitDecision, playAgain }
   ============================================================ */
(function (global) {
  const COLORS = ['red', 'blue', 'yellow', 'green'];
  const COLOR_JP = { red: '赤', blue: '青', yellow: '黄', green: '緑', black: '黒' };
  const COLOR_HEX = { red: '#e23b32', blue: '#2c6fd4', yellow: '#e8b400', green: '#3a9d4b', black: '#15151c' };
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

      // イベント処理(カットイン・効果音・ドローアニメ)
      let didPlay = false; const drawSeats = [];
      (snap.events || []).forEach(ev => {
        if (ev.type === 'cutin') this._cutQ.push(ev);
        else if (ev.type === 'play') didPlay = true;
        else if (ev.type === 'draw') drawSeats.push({ seat: ev.seat, count: ev.count || 1 });
      });
      this.pumpCutins();
      if (didPlay) this.swish(2400);
      if (drawSeats.length) this.swish(1800);
      this.startBgm(); // ジャズBGM（設定ON時・既に再生中なら無視）

      this.buildBoard(snap, app.selfSeat);
      if (drawSeats.length) this.animateDraws(drawSeats, app.selfSeat);

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
      const arrow = el('div', 'dirarrow ' + (snap.dir === 1 ? 'spin-cw' : 'spin-ccw'), snap.dir === 1 ? '↻' : '↺');
      root.appendChild(arrow);

      // 残り時間（手札の左・チップ表示）+ ラウンド番号。上部バーは廃止
      const timer = el('div', 'handtimer', `<span class="r">R${snap.round}</span><span class="ttimer" id="turntimer">⏱ --</span>`);
      root.appendChild(timer);
      this.syncTimer(snap);

      // 異能一覧 / ログ トグル
      const abBtn = el('button', 'iconbtn left' + (this._abOpen ? ' on' : ''), '異能一覧');
      abBtn.onclick = () => { this._abOpen = !this._abOpen; this.buildBoard(snap, selfSeat); };
      root.appendChild(abBtn);
      const logBtn = el('button', 'iconbtn right' + (this._logOpen ? ' on' : ''), 'ログ');
      logBtn.onclick = () => { this._logOpen = !this._logOpen; this.buildBoard(snap, selfSeat); };
      root.appendChild(logBtn);
      const helpBtn = el('button', 'iconbtn help', '?');
      helpBtn.onclick = () => this.showRules();
      root.appendChild(helpBtn);
      if (this._abOpen) root.appendChild(this.buildAbilityPanel(snap, selfSeat));
      if (this._logOpen) root.appendChild(this.buildLogPanel(snap));

      // 方向バッジ
      root.appendChild(el('div', 'dirbadge', snap.dir === 1 ? '↻ 右回り' : '↺ 左回り'));

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
            oa.innerHTML = `<span class="b">バフ：${this.esc(p.ability.condBuff)}、${this.esc(p.ability.buff)}</span>` +
                           `<span class="d">デバフ：${this.esc(p.ability.condDebuff)}、${this.esc(p.ability.debuff)}</span>`;
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
      const acceptOnly = isMyTurn && snap.acceptDrawOnly; // 強制パス中にドローを受けた→受け入れのみ
      const noAction = forced || acceptOnly;              // 出す/スタッキング不可
      const tmsg = el('div', 'turnmsg' + (isMyTurn ? ' your' : ''));
      if (myDecision) tmsg.textContent = '選択してください';
      else if (snap.roundOver) tmsg.textContent = '';
      else if (acceptOnly) tmsg.textContent = '強制パス中：ドローを「受け入れる」のみ可能です';
      else if (forced) tmsg.textContent = '強制パス：パスのみ可能です（パスを押してください）';
      else if (isMyTurn) tmsg.textContent = snap.pending && snap.pending.kind ? `あなたの番 — 同じ記号を重ねるか「ドローを受ける」` : 'あなたの番です';
      else tmsg.textContent = `${this.esc(snap.players[snap.turn] ? snap.players[snap.turn].name : '')} の番…`;
      wrap.appendChild(tmsg);

      // ability 表示(自分の異能 — バフは左・デバフは右に分離表示)
      if (me.ability) {
        const bf = el('div', 'selfbuff');
        bf.innerHTML = `<span class="sa-tag">バフ</span><span class="sa-cond">${this.esc(me.ability.condBuff)}、</span><span class="sa-eff">${this.esc(me.ability.buff)}</span>`;
        root.appendChild(bf);
        const df = el('div', 'selfdebuff');
        df.innerHTML = `<span class="sa-tag">デバフ</span><span class="sa-cond">${this.esc(me.ability.condDebuff)}、</span><span class="sa-eff">${this.esc(me.ability.debuff)}</span>`;
        root.appendChild(df);
      }

      const hand = el('div', 'hand');
      const sorted = (me.hand || []).slice();
      for (const c of sorted) {
        const hc = el('div', 'hcard'); hc.style.backgroundImage = `url('${c.img}')`;
        const playable = isMyTurn && !noAction && this.canPlayClient(c, snap, me);
        if (this._sel.has(c.uid)) hc.classList.add('sel');
        if (isMyTurn && !playable && !this._sel.has(c.uid)) hc.classList.add('disabled');
        hc.onclick = () => { if (noAction || hc._suppressClick) { hc._suppressClick = false; return; } this.toggleCard(c, snap, me); };
        if (isMyTurn && !noAction) this.makeDraggable(hc, c, snap, me);
        hand.appendChild(hc);
      }
      wrap.appendChild(hand);

      // 操作ボタン
      const acts = el('div', 'actions');
      const playBtn = el('button', 'btn primary', '出す');
      playBtn.disabled = !(isMyTurn && !noAction && this._sel.size > 0);
      playBtn.onclick = () => this.doPlay(snap, me);
      const passLabel = acceptOnly ? '受け入れる' : ((snap.pending && snap.pending.kind) ? 'ドローを受ける' : (forced ? 'パス（強制）' : 'パス'));
      const passBtn = el('button', 'btn ghost' + (acceptOnly ? ' primary' : ''), passLabel);
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
            <div class="ap-line buff"><span class="ap-k">バフ</span><span class="ap-c">${this.esc(p.ability.condBuff)}、</span><span class="ap-e">${this.esc(p.ability.buff)}</span></div>
            <div class="ap-line debuff"><span class="ap-k">デバフ</span><span class="ap-c">${this.esc(p.ability.condDebuff)}、</span><span class="ap-e">${this.esc(p.ability.debuff)}</span></div>
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

    doPlay(snap, me, explicitUids) {
      const uids = explicitUids ? explicitUids.slice() : [...this._sel];
      if (!uids.length) return;
      const cards = uids.map(u => me.hand.find(x => x.uid === u)).filter(Boolean);
      const finish = (opts) => { this._sel.clear(); this.app.submitPlay(uids, opts || {}); };
      let achievable = this.achievableColors(cards, snap.startingPlay, snap.board.color, snap.board.cards && snap.board.cards[0]);
      // 色変更不可デバフ: 盤面色しか選べない（不可能ならエンジンが弾く）
      if (me.noColorChange && !snap.startingPlay) {
        const f = achievable.filter(c => c === snap.board.color);
        achievable = f.length ? f : [snap.board.color];
      }
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

    // 手札カードをドラッグ＆ドロップで場に出す
    makeDraggable(hc, c, snap, me) {
      let dragging = false, ghost = null, sx = 0, sy = 0, pid = null;
      const THRESH = 14;
      const dropZone = () => {
        const f = document.querySelector('.felt') || document.querySelector('.pile') || document.querySelector('.deck');
        return f ? f.getBoundingClientRect() : null;
      };
      const onMove = (e) => {
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - sx, dy = pt.clientY - sy;
        if (!dragging && Math.hypot(dx, dy) > THRESH) {
          dragging = true;
          ghost = hc.cloneNode(true);
          ghost.className = 'hcard dragghost';
          ghost.style.cssText += `position:fixed;left:0;top:0;z-index:70;pointer-events:none;width:${hc.offsetWidth}px;height:${hc.offsetHeight}px;`;
          document.body.appendChild(ghost);
          hc.style.opacity = '0.35';
          const fr = dropZone(); if (fr) { const dz = document.querySelector('.felt'); if (dz) dz.classList.add('drop-hot'); }
        }
        if (dragging && ghost) {
          ghost.style.transform = `translate(${pt.clientX - hc.offsetWidth / 2}px,${pt.clientY - hc.offsetHeight / 2}px) scale(1.06)`;
          e.preventDefault && e.preventDefault();
        }
      };
      const finishDrag = (e) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', finishDrag);
        document.removeEventListener('pointercancel', finishDrag);
        const dz = document.querySelector('.felt'); if (dz) dz.classList.remove('drop-hot');
        if (ghost) { ghost.remove(); ghost = null; }
        hc.style.opacity = '';
        if (!dragging) return; // タップ扱い（onclickが処理）
        const pt = (e.changedTouches ? e.changedTouches[0] : e);
        const r = dropZone();
        const over = r && pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom;
        if (over) {
          // ドロップ成立 → このカード（選択に含まれていれば選択ごと）を出す
          let uids;
          if (this._sel.has(c.uid) && this._sel.size > 1) uids = [...this._sel];
          else uids = [c.uid];
          const cardObjs = uids.map(u => me.hand.find(x => x.uid === u)).filter(Boolean);
          if (cardObjs.length && this.canPlayClient(cardObjs[0], snap, me)) {
            this.doPlay(snap, me, uids);
          } else {
            this.toast && this.toast('そのカードは今出せません');
          }
        }
        hc._suppressClick = true; // 直後のclick(toggle)を無効化
        setTimeout(() => { hc._suppressClick = false; }, 50);
      };
      hc.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        sx = e.clientX; sy = e.clientY; dragging = false; pid = e.pointerId;
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', finishDrag);
        document.addEventListener('pointercancel', finishDrag);
      });
    },

    achievableColors(cards, startingPlay, boardColor, boardTop) {
      const k = cards[0].kind;
      if (k === 'wild' || k === 'wd4') return ['red', 'blue', 'yellow', 'green'];
      if (k === 'change') {
        if (startingPlay) { const s = new Set(); cards.forEach(c => (c.pair || []).forEach(x => s.add(x))); return [...s]; }
        return this.changeTopColors(cards, boardColor);
      }
      const distinct = [...new Set(cards.map(c => c.color))];
      if (cards.length === 1 || startingPlay) return distinct;
      const valid = new Set();
      for (const C of distinct) {
        const idx = cards.findIndex(c => c.color === C);
        const remaining = cards.filter((_, i) => i !== idx);
        if (remaining.some(c => this._cardMatches(c, boardColor, boardTop))) valid.add(C);
      }
      return valid.size ? [...valid] : distinct;
    },
    _cardMatches(card, boardColor, top) {
      if (card.kind === 'wild' || card.kind === 'wd4') return true;
      if (card.kind === 'change') return (card.pair || []).includes(boardColor);
      if (card.color === boardColor) return true;
      if (top) {
        if (top.kind === card.kind && card.kind === 'number' && top.value === card.value) return true;
        if (top.kind === card.kind && card.kind !== 'number') return true;
      }
      return false;
    },
    changeTopColors(cards, boardColor) {
      if (cards.length === 1) { const p = cards[0].pair || []; return [p[0] === boardColor ? p[1] : p[0]]; }
      const res = new Set();
      for (let i = 0; i < cards.length; i++) {
        const rest = cards.filter((_, j) => j !== i);
        if (rest.some(c => (c.pair || []).includes(boardColor))) (cards[i].pair || []).forEach(c => res.add(c));
      }
      return [...res];
    },

    /* ============================================================
       カットイン
       ============================================================ */
    pumpCutins() {
      if (this._cutShowing) return;
      if (!this._cutQ.length) { const cb = this._drainCb; if (cb) { this._drainCb = null; cb(); } return; }
      const ev = this._cutQ.shift();
      this._cutShowing = true;
      this.chime(ev.kind); // バフ/デバフ/INO の発動音（ポーンッ）
      const layer = document.getElementById('cutin');
      const name = (this.app.snap.players[ev.seat] || {}).name || '';
      this.speak(ev, name); // 異能の読み上げ（設定ON時）
      const pcls = 'p' + (ev.seat % 4);
      let body, kindcls, extra = '';
      if (ev.kind === 'ino') {
        kindcls = 'ino'; extra = ' fullscreen';
        body = `<div class="ci-tag">【INO】</div><div class="ci-name">${this.esc(name)}</div><div class="ci-eff">次に上がれる！</div>`;
      } else {
        kindcls = ev.kind;
        const tag = ev.kind === 'buff' ? '【バフ】' : '【デバフ】';
        body = `<div class="ci-tag">${tag}</div><div class="ci-name">${this.esc(name)}</div>` +
               `<div class="ci-cond">${this.esc(ev.condText)}、</div>` +
               `<div class="ci-eff">${this.esc(ev.effText)}</div>`;
      }
      layer.className = 'cutin-layer on ' + pcls + ' ' + kindcls + extra;
      layer.innerHTML = `<div class="ci-box">${body}<div class="ci-tap">画面をタップで進む ▶</div></div>`;
      // 画面全体でクリック検知するための透明キャッチャー
      let catcher = document.getElementById('cutcatch');
      if (!catcher) { catcher = document.createElement('div'); catcher.id = 'cutcatch'; document.body.appendChild(catcher); }
      catcher.style.cssText = 'position:fixed;inset:0;z-index:49;cursor:pointer;background:transparent';
      const dismiss = () => {
        layer.classList.remove('on'); layer.onclick = null; clearTimeout(this._cutTimer);
        const cc = document.getElementById('cutcatch'); if (cc) { cc.onclick = null; cc.style.display = 'none'; }
        this._cutShowing = false;
        if (this._advanceCb) { try { this._advanceCb(); } catch (e) {} } // ホストの30秒ゲートをリセット
        setTimeout(() => this.pumpCutins(), 70);
      };
      catcher.style.display = 'block';
      catcher.onclick = dismiss;
      layer.onclick = dismiss;
      // 自動送りはしない：ホスト/過半数のクリックで進む（保険はホスト側の30秒）
    },
    onCutAdvance(cb) { this._advanceCb = cb; },
    hasPendingCutins() { return this._cutShowing || this._cutQ.length > 0; },
    onDrain(cb) { this._drainCb = cb; this.pumpCutins(); },
    clearCutins() {
      this._cutQ = []; this._drainCb = null; this._cutShowing = false; this._advanceCb = null;
      clearTimeout(this._cutTimer);
      const l = document.getElementById('cutin'); if (l) { l.classList.remove('on'); l.onclick = null; }
      const cc = document.getElementById('cutcatch'); if (cc) { cc.onclick = null; cc.style.display = 'none'; }
    },

    /* ---------- ルール説明オーバーレイ ---------- */
    showRules() {
      const R = document.getElementById('rules'); if (!R) return;
      const rc = (img, label, desc) => `<div class="rc"><img src="assets/${img}" alt=""><div class="rc-l">${label}</div><div class="rc-d">${desc}</div></div>`;
      R.innerHTML = `<div class="rules-box">
        <button class="rules-close" id="rulesClose">✕ 閉じる</button>
        <h2 class="rules-title">INO の遊び方</h2>
        <div class="rules-settings">
          <span>⚙️ 設定</span>
          <button class="set-toggle" id="ttsToggle">🔊 異能の読み上げ：${this.ttsEnabled() ? 'ON' : 'OFF'}</button>
          <button class="set-toggle" id="bgmToggle">🎷 BGM（ジャズ）：${this.bgmEnabled() ? 'ON' : 'OFF'}</button>
        </div>
        <div class="rules-sec"><h3>🎯 目的</h3>
          <p>手札をすべて出し切るとそのラウンドの勝ち。全員がパスしたときは手札が最も少ない人の勝ち。<b>2ラウンド先取</b>で優勝です。</p></div>
        <div class="rules-sec"><h3>📜 基本ルール</h3>
          <ul>
            <li>自分の番では、場札と<b>色</b>または<b>数字／記号</b>が合うカードを1枚以上出すか、パスします。</li>
            <li>同じ種類なら<b>色違いでもまとめて出せます</b>。一番下が場札と一致し、<b>一番上の色</b>が新しい場の色になります。</li>
            <li>ドロー2・ワイルドドロー4は<b>重ねがけ</b>でき、受ける人がまとめて引きます。</li>
            <li>手番には制限時間があり、残り時間は手札の左に出ます。</li>
          </ul></div>
        <div class="rules-sec"><h3>✨ 異能（バフ・デバフ）</h3>
          <p>毎ラウンド、各プレイヤーに<b>バフ1つ・デバフ1つ</b>と、それぞれの<b>発動条件</b>が割り当てられます。条件を満たすと自動で発動し、カットインが出ます（バフは左・デバフは右の色）。相手の異能と条件も画面で確認できます。</p></div>
        <div class="rules-sec"><h3>🔔 INO（イノ）</h3>
          <p>次の自分の番で上がれる状態になると、自動で<b>INO宣言</b>します（全画面カットイン）。</p></div>
        <h2 class="rules-title">🃏 カードの種類</h2>
        <div class="rc-grid">
          ${rc('card_000.png', '数字 0〜5', '基本カード。色か数字が合えば出せる。')}
          ${rc('card_006.png', 'スキップ', '次のプレイヤーを飛ばす。')}
          ${rc('card_007.png', 'ドロー2', '次の人が2枚引く。重ねがけ可。')}
          ${rc('card_008.png', 'リバース', '手番の向きを反転する。')}
          ${rc('card_009.png', 'ギフト', '出した枚数だけ、次の人に手札を渡す。')}
          ${rc('card_010.png', 'スナイプ', '出した枚数だけ、狙った人にドローさせる。')}
          ${rc('card_011.png', 'チェンジ', '場の色を、書かれたもう一方の色に変える。')}
          ${rc('card_048.png', 'ワイルド', '好きな色に変更できる。')}
          ${rc('card_049.png', 'ワイルドドロー4', '好きな色に変更＋次の人が4枚引く。重ねがけ可。')}
        </div>
        <p class="rules-note">色は赤・青・黄・緑の4色。最大4人で対戦し、空席はAIが担当します。</p>
      </div>`;
      R.classList.remove('hidden');
      const c = document.getElementById('rulesClose'); if (c) c.onclick = () => this.hideRules();
      const tt = document.getElementById('ttsToggle');
      if (tt) tt.onclick = () => { const on = !this.ttsEnabled(); this.setTts(on); tt.textContent = `🔊 異能の読み上げ：${on ? 'ON' : 'OFF'}`; if (on && window.speechSynthesis) { try { const u = new SpeechSynthesisUtterance('読み上げをオンにしました'); u.lang = 'ja-JP'; window.speechSynthesis.speak(u); } catch (e) {} } };
      const bg = document.getElementById('bgmToggle');
      if (bg) bg.onclick = () => { const on = !this.bgmEnabled(); this.setBgm(on); bg.textContent = `🎷 BGM（ジャズ）：${on ? 'ON' : 'OFF'}`; };
      R.onclick = (e) => { if (e.target === R) this.hideRules(); };
    },
    hideRules() { const R = document.getElementById('rules'); if (R) { R.classList.add('hidden'); R.onclick = null; } },

    /* ---------- 異能の読み上げ（TTS） ---------- */
    toast(msg) {
      try {
        const t = document.getElementById('toast'); if (!t) return;
        t.textContent = msg; t.style.opacity = '1';
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => { t.style.opacity = '0'; }, 1700);
      } catch (e) {}
    },
    ttsEnabled() { try { return localStorage.getItem('ino_tts') !== 'off'; } catch (e) { return true; } },
    setTts(on) { try { localStorage.setItem('ino_tts', on ? 'on' : 'off'); } catch (e) {} if (!on && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} } },
    speak(ev, name) {
      try {
        if (!this.ttsEnabled()) return;
        if (!('speechSynthesis' in window)) return;
        let text;
        if (ev.kind === 'ino') text = `${name || ''}、イノ。次に上がれます`;
        else {
          const label = ev.kind === 'buff' ? 'バフ' : 'デバフ';
          text = `${label}。${ev.condText || ''}、${ev.effText || ''}`;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP'; u.rate = 1.08; u.pitch = 1.0;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) {}
    },

    chime(kind) {
      try {
        const ctx = this._actx; if (!ctx) return;
        const now = ctx.currentTime;
        const base = kind === 'debuff' ? 540 : (kind === 'ino' ? 660 : 720);
        const notes = kind === 'ino' ? [base, base * 1.26, base * 1.5] : [base, base * 1.5];
        notes.forEach((f, i) => {
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const g = ctx.createGain();
          const t0 = now + i * 0.06;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.26 / (i + 1), t0 + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0007, t0 + 0.5);
          o.connect(g); g.connect(ctx.destination);
          o.start(t0); o.stop(t0 + 0.55);
        });
      } catch (e) {}
    },

    /* ---------- 効果音（カードのシュッ音をWeb Audioで合成） ---------- */
    initAudio() {
      try {
        if (!this._actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this._actx = new AC(); }
        if (this._actx.state === 'suspended') this._actx.resume();
      } catch (e) {}
    },
    swish(freq) {
      try {
        const ctx = this._actx; if (!ctx) return;
        const dur = 0.16;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) { const t = i / d.length; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4); }
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq || 2400; bp.Q.value = 0.9;
        const g = ctx.createGain(); g.gain.value = 0.3;
        src.connect(bp); bp.connect(g); g.connect(ctx.destination);
        src.start();
      } catch (e) {}
    },

    /* ---------- ジャズ風BGM（Web Audioで合成・ループ） ---------- */
    bgmEnabled() { try { return localStorage.getItem('ino_bgm') !== 'off'; } catch (e) { return true; } },
    setBgm(on) { try { localStorage.setItem('ino_bgm', on ? 'on' : 'off'); } catch (e) {} if (on) this.startBgm(); else this.stopBgm(); },
    _bgmFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },
    _bgmNote(ctx, freq, t0, dur, type, peak, dest) {
      const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      o.connect(g); g.connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    _bgmTick(ctx, t0, dest, peak, freq) {
      const dur = 0.05;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) { const t = i / d.length; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3); }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = freq || 8000;
      const g = ctx.createGain(); g.gain.value = peak;
      src.connect(bp); bp.connect(g); g.connect(dest); src.start(t0);
    },
    startBgm() {
      try {
        this.initAudio(); const ctx = this._actx; if (!ctx) return;
        if (this._bgmOn || !this.bgmEnabled()) return;
        this._bgmOn = true;
        if (!this._bgmGain) { this._bgmGain = ctx.createGain(); this._bgmGain.gain.value = 0.0001; this._bgmGain.connect(ctx.destination); }
        const now = ctx.currentTime;
        this._bgmGain.gain.cancelScheduledValues(now);
        this._bgmGain.gain.setValueAtTime(Math.max(0.0001, this._bgmGain.gain.value), now);
        this._bgmGain.gain.linearRampToValueAtTime(0.4, now + 2.0); // フェードイン
        this._bgmBeat = 0;
        this._bgmSpb = 60 / 96; // 96 BPM
        this._bgmNextTime = now + 0.18;
        this._bgmSchedule();
      } catch (e) {}
    },
    _bgmSchedule() {
      try {
        const ctx = this._actx; if (!ctx || !this._bgmOn) return;
        const spb = this._bgmSpb, dest = this._bgmGain;
        // I-vi-ii-V in C（Cmaj7 - Am7 - Dm7 - G7）/ ウォーキングベース
        const BASS = [[36, 40, 43, 45], [45, 43, 41, 40], [38, 41, 45, 47], [43, 45, 47, 50]];
        const CH = [[64, 67, 71], [60, 64, 67], [62, 65, 69], [59, 62, 65]];
        while (this._bgmNextTime < ctx.currentTime + 0.35) {
          const beat = this._bgmBeat, bar = Math.floor(beat / 4) % 4, bi = beat % 4, t = this._bgmNextTime;
          // ウォーキングベース（各拍）
          this._bgmNote(ctx, this._bgmFreq(BASS[bar][bi]), t, spb * 0.92, 'triangle', 0.17, dest);
          // コンピング（1拍目は長め・3拍目は短め）
          if (bi === 0 || bi === 2) {
            const dur = bi === 0 ? spb * 1.7 : spb * 0.85;
            CH[bar].forEach(m => this._bgmNote(ctx, this._bgmFreq(m), t + 0.012, dur, 'sine', 0.05, dest));
          }
          // スウィングのライド（拍頭＋スウィングした「ウラ」）
          this._bgmTick(ctx, t, dest, 0.05, 8000);
          this._bgmTick(ctx, t + spb * 0.66, dest, 0.03, 9500);
          this._bgmBeat++;
          this._bgmNextTime += spb;
        }
        this._bgmTimer = setTimeout(() => this._bgmSchedule(), 60);
      } catch (e) {}
    },
    stopBgm() {
      this._bgmOn = false;
      clearTimeout(this._bgmTimer);
      try {
        const ctx = this._actx; if (ctx && this._bgmGain) {
          const now = ctx.currentTime;
          this._bgmGain.gain.cancelScheduledValues(now);
          this._bgmGain.gain.setValueAtTime(Math.max(0.0001, this._bgmGain.gain.value), now);
          this._bgmGain.gain.linearRampToValueAtTime(0.0001, now + 0.6);
        }
      } catch (e) {}
    },

    /* ---------- ドローのアニメ（裏向きカードが山札→席へ飛ぶ） ---------- */
    animateDraws(draws, selfSeat) {
      try {
        const fx = document.getElementById('fxlayer'); if (!fx) return;
        const deckEl = document.querySelector('.deck .top'); if (!deckEl) return;
        const dr = deckEl.getBoundingClientRect();
        if (!dr.width) return; // 非表示環境（テスト等）はスキップ
        const N = (this.app.snap.players || []).length || 4;
        draws.forEach((dw) => {
          const rel = ((dw.seat - selfSeat) % N + N) % N;
          const pos = ['bottom', 'left', 'top', 'right'][rel];
          const seatEl = document.querySelector('.seat.pos-' + pos); if (!seatEl) return;
          const sr = seatEl.getBoundingClientRect();
          const n = Math.min(dw.count || 1, 3);
          for (let i = 0; i < n; i++) {
            const card = document.createElement('div');
            card.className = 'flycard';
            card.style.left = dr.left + 'px'; card.style.top = dr.top + 'px';
            card.style.width = dr.width + 'px'; card.style.height = dr.height + 'px';
            fx.appendChild(card);
            const dx = (sr.left + sr.width / 2) - (dr.left + dr.width / 2);
            const dy = (sr.top + sr.height / 2) - (dr.top + dr.height / 2);
            requestAnimationFrame(() => {
              setTimeout(() => {
                card.style.transform = `translate(${dx}px,${dy}px) scale(.5) rotate(${(Math.random()*40-20)|0}deg)`;
                card.style.opacity = '0.15';
              }, i * 90);
            });
            setTimeout(() => card.remove(), 650 + i * 90);
          }
        });
      } catch (e) {}
    },


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
        case 'declareColor': {
          // 手札4色判定と同じ数え方：チェンジは2色、ワイルド類は黒
          const cols = [...new Set((me.hand || []).flatMap(c => {
            if (c.kind === 'wild' || c.kind === 'wd4') return ['black'];
            if (c.kind === 'change') return c.pair || [];
            return [c.color];
          }).filter(Boolean))];
          return this.decColor(dec, '手札の色を宣言', '手札にある色を1つ全員に公開します（黒＝ワイルド）', cols.length ? cols : COLORS);
        }
        case 'gift': {
          if (dec.reason === 'reverseGift') {
            const to = (snap.players[dec.target] || {}).name || '相手';
            return this.decSelectCards(dec, me, dec.amount, `${this.esc(to)} に渡す（ギフト-1）`, `あなたが渡す${dec.amount}枚を選んでください`);
          }
          return this.decSelectCards(dec, me, dec.amount, '次のプレイヤーへ渡す', `${dec.amount}枚を選んでください`);
        }
        case 'discard': return this.decSelectCards(dec, me, dec.amount, 'カードを破棄', `${dec.amount}枚を選んでください`);
        case 'snipe': return this.decSnipe(dec, snap);
        case 'pickFromDeck': return this.decPickDeck(dec, snap);
        case 'buff7play': return this.decBuff7(dec, me, snap);
      }
    },

    decColor(dec, title, sub, allowed) {
      const cols = allowed || COLORS;
      const m = this.openModal(`<h3>${title}</h3><div class="sub">${sub}</div>
        <div class="colorpick">${cols.map(c => `<div class="swatch-wrap"><div class="swatch" data-c="${c}" style="background:${COLOR_HEX[c] || '#888'}"></div><span class="swatch-lbl">${COLOR_JP[c] || c}</span></div>`).join('')}</div>
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
