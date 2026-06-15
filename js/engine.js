/* ============================================================
   INO - engine.js  (ホスト権威型ゲームエンジン)
   依存: data.js
   ============================================================ */

(function (global) {
  const D = (typeof require !== 'undefined') ? require('./data.js') : global;
  const { COLORS, COLOR_JP, KIND_JP, buildDeck, BUFFS, CONDITIONS, DEBUFFS } = D;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const rint = (n) => Math.floor(Math.random() * n);

  /* effectiveColor: チェンジカードは pair の指定された側を使う(play時に決まる) */
  function handColors(hand) {
    const s = new Set();
    for (const c of hand) {
      if (c.kind === 'wild' || c.kind === 'wd4') continue;
      if (c.kind === 'change') { c.pair.forEach(x => s.add(x)); }
      else s.add(c.color);
    }
    return s;
  }

  class Engine {
    constructor(playerDefs, seed) {
      // playerDefs: [{id, name, isAI}]
      this.players = playerDefs.map((p, i) => ({
        seat: i, id: p.id, name: p.name, isAI: !!p.isAI,
        hand: [], roundWins: 0,
      }));
      this.round = 0;
      this.gameOver = false;
      this.gameWinnerSeat = null;
      this.events = [];          // {type, ...} アニメ/カットイン用
      this.decisions = [];       // 保留中のプレイヤー選択
      this.log = [];             // ゲーム進行ログ {type,text}
      this.startRound();
    }

    /* ---------- ラウンド開始 ---------- */
    startRound() {
      this.round++;
      this.deck = shuffle(buildDeck());
      this.discard = [];
      this.dir = 1;
      this.turn = rint(this.players.length); // 毎ラウンド スタートをランダム（AIになる場合もある）
      this.pending = { kind: null, amount: 0 }; // ドロー2/WD4スタッキング
      this.board = { color: null, cards: [], count: 0 };
      this.passStreak = 0;
      this.startingPlay = true;
      this.roundOver = false;
      this.roundWinners = [];
      this.forbiddenWinColor = null; // buff8 グローバル禁止上がり色
      this.forbiddenWinColorOwner = null;
      this.fired = new Set();        // この手番中に発動済みの "seat:buff"/"seat:debuff"
      this.lastDrawForcer = null;    // buff15用: 直近のドローを強制した席
      this.pendingForcer = null;     // ドロー2/WD4を出した席

      for (const p of this.players) {
        p.hand = this.deck.splice(0, 9);
        // 異能配布: バフ1/デバフ1/条件2(独立ランダム)
        p.cond = [rint(CONDITIONS.length), rint(CONDITIONS.length)]; // cond[0]->buff, cond[1]->debuff
        p.buffIdx = rint(BUFFS.length);
        p.debuffIdx = rint(DEBUFFS.length);
        // 永続フラグ初期化
        p.maxHand = null;
        p.draw2plus = false;       // buff10 ドロー2->ドロー3
        p.wildPlus4 = false;       // buff11
        p.snipePlus = false;       // buff13 スナイプ2
        p.drawReflect = false;     // buff15
        p.buffBlockedUntilTurn = false; // buff9 を受けた
        p.symbolsDead = false;     // deb1
        p.revealOne = false;       // deb4
        p.cantPlayBoardMatch = false; // deb5
        p.noTwoPlay = false;       // deb6
        p.cantChangeColor = false; // deb7
        p.lockWinUntilBuff = false;// deb8
        p.lockWinReleaseCond = null;
        p.drawPlus1 = false;       // deb10
        p.drawOnPass = false;      // deb11
        p.giftMinus = false;       // deb12
        p.declaredColor = null;    // deb13
        p.mustPass = false;        // deb2 次手番強制パス
        p.passUntilColor = null;   // deb3 色変化まで強制パス(その時の色)
      }
      this.emit({ type: 'roundStart', round: this.round });
      this.logPush('round', `―― ラウンド ${this.round} 開始 ――`);
    }

    emit(e) { this.events.push(e); }
    logPush(type, text) { if (this.log) this.log.push({ type, text }); }
    // 効果文に「これ以降」を含む(持続効果)はカットインを出さない
    isPassiveEffect(text) { return (text || '').indexOf('これ以降') >= 0; }

    nameOf(seat) { return this.players[seat] ? this.players[seat].name : `席${seat}`; }
    cardDesc(cards) {
      const c = cards[0];
      const cj = c.color ? COLOR_JP[c.color] : '';
      let label;
      if (c.kind === 'number') label = `${cj}${c.value}`;
      else if (c.kind === 'wild') label = 'ワイルド';
      else if (c.kind === 'wd4') label = 'ワイルドドロー4';
      else label = `${cj}${KIND_JP[c.kind]}`;
      return cards.length > 1 ? `${label}×${cards.length}` : label;
    }
    abilityTargetNote(kind, idx, seat) {
      const nm = s => this.nameOf(s);
      if (kind === 'buff') {
        if (idx === 0 || idx === 9 || idx === 12) return ` → ${nm(this.nextSeat(seat))}`;
        if (idx === 5) return ` → ${nm(this.prevSeat(seat))} と ${nm(this.nextSeat(seat))}`;
      } else if (kind === 'debuff') {
        if (idx === 9) return ` → ${nm(this.prevSeat(seat))}`;
      }
      return '';
    }

    cur() { return this.players[this.turn]; }
    seatRel(seat, step) { // 現在の方向で step 進んだ席
      const n = this.players.length;
      return ((seat + this.dir * step) % n + n) % n;
    }
    nextSeat(seat) { return this.seatRel(seat, 1); }
    prevSeat(seat) { return this.seatRel(seat, -1); }

    /* ---------- ドロー ---------- */
    reshuffleIfNeeded() {
      if (this.deck.length === 0 && this.discard.length > 1) {
        const top = this.discard.slice(-this.board.count);
        const rest = this.discard.slice(0, this.discard.length - this.board.count);
        this.deck = shuffle(rest);
        this.discard = top;
      }
    }
    drawCards(seat, n, facts) {
      const p = this.players[seat];
      const got = [];
      for (let i = 0; i < n; i++) {
        this.reshuffleIfNeeded();
        if (this.deck.length === 0) break;
        const c = this.deck.shift();
        p.hand.push(c); got.push(c);
      }
      if (got.length) {
        this.emit({ type: 'draw', seat, count: got.length });
        this.logPush('draw', `${this.nameOf(seat)} が ${got.length}枚ドロー`);
        if (facts) { facts.someoneDrew = true; facts.drawers.add(seat); }
        // buff15: ドローさせた相手も同枚数(反射)
        if (p.drawReflect && this.lastDrawForcer != null && this.lastDrawForcer !== seat) {
          p.drawReflect = false;
          const f = this.lastDrawForcer; this.lastDrawForcer = null;
          this.drawCards(f, got.length, facts);
        }
      }
      return got;
    }

    /* ---------- 合法手判定 ---------- */
    // 単一カードが現盤面に出せるか(色/数字/記号一致 or ワイルド)
    matchesBoard(card) {
      if (this.startingPlay) return true;
      if (card.kind === 'wild' || card.kind === 'wd4') return true;
      const b = this.board;
      if (card.kind === 'change') return card.pair.includes(b.color);
      if (b.cards.length) {
        const top = b.cards[0];
        if (card.color === b.color) return true;
        if (top.kind === card.kind && card.kind === 'number' && top.value === card.value) return true;
        if (top.kind === card.kind && card.kind !== 'number') return true;
      } else if (card.color === b.color) return true;
      return false;
    }

    // まとめ出しの妥当性: 同一種類(数字なら同数字 / 記号なら同記号 / 色は違ってよい)
    sameGroup(cards) {
      if (cards.length === 0) return false;
      const a = cards[0];
      if (a.kind === 'wild' || a.kind === 'wd4') return cards.every(c => c.kind === a.kind);
      if (a.kind === 'number') return cards.every(c => c.kind === 'number' && c.value === a.value);
      return cards.every(c => c.kind === a.kind);
    }

    // pending(ドロー2/WD4)がある時のスタッキング可否
    canStackOnPending(cards) {
      if (!this.pending.kind) return true;
      if (this.pending.kind === 'draw2') return cards.every(c => c.kind === 'draw2');
      if (this.pending.kind === 'wd4') return cards.every(c => c.kind === 'wd4');
      return false;
    }

    // プレイヤーが「この手番に出せるカードがあるか」(強制出し判定用・簡易)
    hasPlayable(seat) {
      const p = this.players[seat];
      if (this.pending.kind) {
        return p.hand.some(c => c.kind === this.pending.kind);
      }
      return p.hand.some(c => this.matchesBoard(c) && !this.blockedByDebuff(p, c));
    }
    blockedByDebuff(p, c) {
      // deb5: 盤面と同じ記号/数字/ワイルドは出せない
      if (p.cantPlayBoardMatch && this.board.cards.length) {
        const top = this.board.cards[0];
        if (c.kind === top.kind && (c.kind !== 'number' || c.value === top.value)) return true;
        if ((c.kind === 'wild' || c.kind === 'wd4') && (top.kind === 'wild' || top.kind === 'wd4')) return true;
      }
      return false;
    }

    /* ============================================================
       カードを出す  (opts: {color, gift:[uid], snipe:[{seat,n}], changeColor})
       ============================================================ */
    validatePlay(seat, uids, opts) {
      const p = this.players[seat];
      if (seat !== this.turn) return 'あなたの手番ではありません';
      if (this.mustPassNow(seat)) return 'デバフによりこの手番はパスのみ可能です';
      const cards = uids.map(u => p.hand.find(c => c.uid === u)).filter(Boolean);
      if (cards.length !== uids.length || cards.length === 0) return 'カードが見つかりません';
      if (!this.sameGroup(cards)) return '同じ種類のカードのみまとめて出せます';
      if (p.noTwoPlay && cards.length === 2) return '2枚出しは封じられています(デバフ)';
      if (this.pending.kind && !this.canStackOnPending(cards)) return `${KIND_JP[this.pending.kind]}にはスタッキングできません`;
      if (!this.pending.kind) {
        const first = cards[0];
        if (!this.matchesBoard(first)) return '盤面に出せないカードです';
        if (this.blockedByDebuff(p, first)) return 'このカードはデバフで出せません';
      }
      return null;
    }

    playCards(seat, uids, opts = {}) {
      const err = this.validatePlay(seat, uids, opts);
      if (err) return { error: err };
      this.fired = new Set(); // この手番の異能発動記録をリセット
      const p = this.players[seat];
      const cards = uids.map(u => p.hand.find(c => c.uid === u));
      const kind = cards[0].kind;
      const count = cards.length;

      // 手札から除去
      p.hand = p.hand.filter(c => !uids.includes(c.uid));

      // facts(条件評価用)
      const facts = this.newFacts(seat);
      facts.action = 'play';
      facts.count = count;
      facts.isSymbol = ['skip','draw2','reverse','gift','snipe','change'].includes(kind);

      // 盤面色の決定（複数色・チェンジ複数出しは最上段の色を選択）
      const wasStarting = this.startingPlay;
      const boardColorBefore = this.board.color;
      const achievable = this.achievableColors(cards, wasStarting, boardColorBefore, this.board.cards[0]);
      let newColor = (opts.color && achievable.includes(opts.color)) ? opts.color : achievable[0];

      // 条件用: 出した色(チェンジは結果色)
      const playedColors = new Set();
      for (const c of cards) {
        if (c.kind === 'change') playedColors.add(newColor);
        else if (c.color) playedColors.add(c.color);
      }
      facts.playedColors = playedColors;
      if (kind === 'number') facts.numberSum = cards.reduce((s, c) => s + c.value, 0);

      // cond16: 場と完全に同色かつ同枚数
      if (!wasStarting && this.board.cards.length === count) {
        const prevColors = this.board.cards.map(c => c.color).sort().join(',');
        const nowColors = cards.map(c => c.kind === 'change' ? newColor : c.color).sort().join(',');
        if (prevColors === nowColors) facts.exactSameAsBoard = true;
      }

      // 盤面更新
      this.discard.push(...cards);
      this.board = { color: newColor, cards: cards.slice(), count };
      // 最初の1枚(場札なしスタート)は「色が変わった」とは判定しない
      if (!wasStarting && boardColorBefore !== newColor) {
        facts.boardColorChanged = true; facts.colorChangedBy = seat;
      }
      this.startingPlay = false;
      this.passStreak = 0;
      this.emit({ type: 'play', seat, cards: cards.map(c => c.uid), color: newColor, kind, count });
      this.logPush('play', `${p.name}：${this.cardDesc(cards)} を出した（${COLOR_JP[newColor] || '−'}）`);

      // カード効果適用(手番移動含む)。turnAdvanced=true なら通常の次手番処理をスキップ
      const eff = this.applyCardEffect(seat, kind, count, cards, opts, facts);

      // 異能カスケード
      this.resolveAbilities(facts);

      // INO / 勝利判定
      this.checkIno(seat);
      const won = this.checkRoundWin(seat);

      if (!won && !this.roundOver) {
        if (!eff.turnAdvanced) this.advanceTurn();
        this.onTurnStart();
      }
      return { ok: true };
    }

    autoColor(p) {
      // 手札で一番多い色
      const cnt = { red:0, blue:0, yellow:0, green:0 };
      for (const c of p.hand) if (cnt[c.color] != null) cnt[c.color]++;
      let best = 'red', bv = -1;
      for (const k of COLORS) if (cnt[k] > bv) { bv = cnt[k]; best = k; }
      return best;
    }

    // 出したカード群で「最上段(=盤面色)」に選べる色の一覧
    achievableColors(cards, startingPlay, boardColor, boardTop) {
      const k = cards[0].kind;
      if (k === 'wild' || k === 'wd4') return COLORS.slice();
      if (k === 'change') {
        if (startingPlay) { const s = new Set(); cards.forEach(c => (c.pair || []).forEach(x => s.add(x))); return [...s]; }
        const res = this._changeChain(cards, boardColor);
        if (res.length) return res;
        const fb = new Set();
        cards.forEach(c => { const p = c.pair || []; if (p.includes(boardColor)) fb.add(p[0] === boardColor ? p[1] : p[0]); });
        return fb.size ? [...fb] : (cards[0].pair ? [cards[0].pair[0]] : COLORS.slice());
      }
      // 数字・記号: 一番下に置くカードは盤面と一致している必要がある
      const distinct = [...new Set(cards.map(c => c.color))];
      if (cards.length === 1 || startingPlay) return distinct;
      const valid = new Set();
      for (const C of distinct) {
        const idx = cards.findIndex(c => c.color === C);
        const remaining = cards.filter((_, i) => i !== idx);
        if (remaining.some(c => this._cardMatches(c, boardColor, boardTop))) valid.add(C);
      }
      return valid.size ? [...valid] : distinct;
    }
    _cardMatches(card, boardColor, top) {
      if (card.kind === 'wild' || card.kind === 'wd4') return true;
      if (card.kind === 'change') return (card.pair || []).includes(boardColor);
      if (card.color === boardColor) return true;
      if (top) {
        if (top.kind === card.kind && card.kind === 'number' && top.value === card.value) return true;
        if (top.kind === card.kind && card.kind !== 'number') return true;
      }
      return false;
    }
    _changeChain(cards, boardColor) {
      const n = cards.length; const results = new Set();
      const dfs = (cur, used) => {
        if (used.length === n) { results.add(cur); return; }
        for (let i = 0; i < n; i++) {
          if (used.includes(i)) continue;
          const p = cards[i].pair || [];
          if (p.includes(cur)) dfs(p[0] === cur ? p[1] : p[0], used.concat(i));
        }
      };
      dfs(boardColor, []);
      return [...results];
    }

    /* ---------- カード効果 ---------- */
    applyCardEffect(seat, kind, count, cards, opts, facts) {
      const res = { turnAdvanced: false };
      const nxt = this.nextSeat(seat);
      // deb1: 記号は不発(チェンジは色としては機能、効果は出ない)
      if (this.players[seat].symbolsDead && ['skip', 'draw2', 'reverse', 'gift', 'snipe'].includes(kind)) {
        this.emit({ type: 'fizzle', seat, kind });
        return res;
      }
      switch (kind) {
        case 'skip': {
          // 出した枚数分スキップ
          let s = seat;
          for (let i = 0; i < count; i++) s = this.nextSeat(s);
          this.turn = s; res.turnAdvanced = true;
          this.emit({ type: 'skip', seat, count });
          break;
        }
        case 'draw2': {
          const per = this.players[seat].draw2plus ? 3 : 2;
          this.pending.kind = 'draw2';
          this.pending.amount += per * count;
          this.pendingForcer = seat;
          this.emit({ type: 'pendingDraw', kind: 'draw2', amount: this.pending.amount });
          // 手番は次へ(スタッキング or 受け取りの判断)
          break;
        }
        case 'wd4': {
          const per = 4 + (this.players[seat].wildPlus4 ? 4 : 0);
          this.pending.kind = 'wd4';
          this.pending.amount += per * count;
          this.pendingForcer = seat;
          this.emit({ type: 'pendingDraw', kind: 'wd4', amount: this.pending.amount });
          break;
        }
        case 'reverse': {
          facts.reverseFired = true;
          this.emit({ type: 'reverse', seat, count });
          // 偶数枚で正順のまま、奇数枚で反転
          if (count % 2 === 1) this.dir *= -1;
          break;
        }
        case 'gift': {
          // 出した枚数分(ギフト-1デバフ反映)、次プレイヤーへ任意手札を渡す。手札数を上限に。
          let g = count - (this.players[seat].giftMinus ? 1 : 0);
          g = Math.max(0, Math.min(g, this.players[seat].hand.length));
          if (g > 0) {
            this.queueDecision({ type: 'gift', seat, target: nxt, amount: g, preset: (opts.gift || []).slice(0, g) });
          }
          break;
        }
        case 'snipe': {
          // 出した枚数分プレイヤーを選びドロー(スナイプ2なら各2枚)。スナイプの次から再開
          const per = this.players[seat].snipePlus ? 2 : 1;
          this.queueDecision({
            type: 'snipe', seat, picks: count, per, preset: opts.snipe || null,
          });
          // 手番再開はスナイプを出した次のプレイヤーから(=通常の次手番) → そのまま
          break;
        }
        case 'change': {
          this.emit({ type: 'colorChange', seat, color: this.board.color });
          break;
        }
        case 'wild': case 'number':
        default: break;
      }
      // pending(ドロー2/WD4)処理: 次プレイヤーが受けるかスタックするかは onTurnStart で扱う
      return res;
    }

    // deb2/deb3: この席が強制的にパスさせられるか
    mustPassNow(seat) {
      const p = this.players[seat];
      if (this.pending.kind) return false; // 先にドロー処理を行う
      if (p.mustPass) return true;
      if (p.passUntilColor != null) {
        if (this.board.color === p.passUntilColor) return true;
        p.passUntilColor = null;
      }
      return false;
    }

    /* ---------- 手番送り ---------- */
    advanceTurn() {
      this.turn = this.nextSeat(this.turn);
    }

    // 新しい手番開始時の自動処理(強制パス/受けドローなど)
    onTurnStart() {
      const p = this.cur();
      // buff9 ブロック解除(自分の手番開始)
      if (p.buffBlockedUntilTurn) p.buffBlockedUntilTurn = false;
      // buff8 禁止上がり色解除(指定者の手番開始)
      if (this.forbiddenWinColorOwner === p.seat) { this.forbiddenWinColor = null; this.forbiddenWinColorOwner = null; }
      this.emit({ type: 'turnStart', seat: p.seat });
    }

    /* ============================================================
       パス
       ============================================================ */
    pass(seat) {
      if (seat !== this.turn) return { error: 'あなたの手番ではありません' };
      const p = this.players[seat];
      this.fired = new Set();

      // pending(ドロー2/WD4)を受ける
      if (this.pending.kind) {
        const facts = this.newFacts(seat); facts.action = 'draw';
        let amt = this.pending.amount + (p.drawPlus1 ? 1 : 0);
        this.lastDrawForcer = this.pendingForcer;
        this.drawCards(seat, amt, facts);
        this.pending = { kind: null, amount: 0 }; this.pendingForcer = null;
        this.resolveAbilities(facts);
        // ドロー後はドローしたプレイヤーから手番再開(=この人の手番をやり直す)
        this.emit({ type: 'tookDraw', seat, amount: amt });
        this.onTurnStart();
        return { ok: true, tookDraw: true };
      }

      // 3人連続パス中の4人目は出せるなら出さねばならない
      if (this.passStreak >= this.players.length - 1 && this.hasPlayable(seat)) {
        return { error: '3人が連続パス中です。出せるカードがあるため出さなければなりません' };
      }

      const facts = this.newFacts(seat); facts.action = 'pass'; facts.passed = true;
      p.mustPass = false; // 強制パス消化
      // deb11: パス時1枚ドロー
      if (p.drawOnPass) { this.lastDrawForcer = null; this.drawCards(seat, 1, facts); }
      this.passStreak++;
      this.emit({ type: 'pass', seat });
      this.logPush('pass', `${p.name} がパス`);
      this.resolveAbilities(facts);

      // 全員パス -> ラウンドセット(手札最少が勝利)
      if (this.passStreak >= this.players.length) {
        this.endRoundByAllPass();
        return { ok: true, allPass: true };
      }
      this.advanceTurn();
      this.onTurnStart();
      return { ok: true };
    }

    endRoundByAllPass() {
      const min = Math.min(...this.players.map(p => p.hand.length));
      const winners = this.players.filter(p => p.hand.length === min).map(p => p.seat);
      this.emit({ type: 'allPass', winners });
      this.finishRound(winners);
    }

    /* ============================================================
       異能カスケード解決
       facts: この解決のトリガー情報
       ============================================================ */
    newFacts(actorSeat) {
      return {
        actorSeat, action: null,
        playedColors: new Set(), playedKinds: new Set(),
        isSymbol: false, numberSum: 0, count: 0, reverseFired: false,
        someoneDrew: false, drawers: new Set(),
        boardColorChanged: false, colorChangedBy: null,
        passed: false, exactSameAsBoard: false,
        abilityReceivers: new Set(), condMetThisPass: new Set(),
        drawReflectFrom: null,
      };
    }

    conditionMet(player, condIdx, facts) {
      const seat = player.seat;
      const isActor = seat === facts.actorSeat;
      const played = isActor && facts.action === 'play';
      switch (condIdx) {
        case 0: return facts.drawers.has(seat);                       // 自分がドローした時
        case 1: return facts.condMetThisPass.has(this.prevSeat(seat));// 前のプレイヤーが条件満たした時
        case 2: return isActor && facts.playedColors.has('red');      // 自分が赤を出した時
        case 3: return isActor && facts.playedColors.has('blue');     // 自分が青を出した時
        case 4: return isActor && facts.playedColors.has('yellow');   // 自分が黄を出した時
        case 5: return isActor && facts.playedColors.has('green');    // 自分が緑を出した時
        case 6: return played && facts.numberSum > 0 && facts.numberSum % 2 === 1; // 自分の出した数字合計が奇数
        case 7: return isActor && facts.isSymbol;                     // 自分が記号を出した時
        case 8: return played && handColors(player.hand).size >= 4;   // 自分が出したあと手札4色以上
        case 9: return facts.abilityReceivers.has(seat);              // 異能を受けた時
        case 10: return facts.reverseFired;                          // 誰かがリバース発動時
        case 11: return played && player.hand.length % 2 === 0;       // 自分が出したあと手札が偶数
        case 12: return facts.boardColorChanged && facts.colorChangedBy !== seat; // 他プレイヤーが色変更
        case 13: return facts.someoneDrew;                           // 誰かがドローした時
        case 14: return isActor && facts.passed;                     // 自分がパスした時
        case 15: return facts.exactSameAsBoard && isActor;           // 場と完全同色同枚数
        case 16: return played && player.hand.some(c => ['skip','draw2','reverse','gift','snipe','change'].includes(c.kind)); // 出したあと手札に記号
        default: return false;
      }
    }

    resolveAbilities(facts) {
      const n = this.players.length;
      // deb8 解除判定: バフ条件を満たしたら上がり制限を解除(同一条件は最初の1回をスキップ)
      for (const p of this.players) {
        if (p.lockWinUntilBuff && this.conditionMet(p, p.cond[0], facts)) {
          if (p.lockWinGrace) p.lockWinGrace = false;
          else p.lockWinUntilBuff = false;
        }
      }
      let changed = true;
      let guard = 0;
      while (changed && guard++ < 50) {
        changed = false;
        // 出番のプレイヤーから順に確認
        for (let i = 0; i < n; i++) {
          const seat = this.seatRel(facts.actorSeat, i);
          const p = this.players[seat];
          // バフ(cond[0]) 判定
          const bKey = `${seat}:buff`;
          if (!this.fired.has(bKey) && !p.buffBlockedUntilTurn && this.conditionMet(p, p.cond[0], facts)) {
            this.fired.add(bKey);
            facts.condMetThisPass.add(seat);
            if (!this.isPassiveEffect(BUFFS[p.buffIdx]))
              this.emit({ type: 'cutin', kind: 'buff', seat, condText: CONDITIONS[p.cond[0]], effText: BUFFS[p.buffIdx] });
            this.logPush('buff', `${this.nameOf(seat)} のバフ「${BUFFS[p.buffIdx]}」発動（条件:${CONDITIONS[p.cond[0]]}）${this.abilityTargetNote('buff', p.buffIdx, seat)}`);
            this.applyBuff(seat, p.buffIdx, facts);
            changed = true;
          }
          // デバフ(cond[1]) 判定
          const dKey = `${seat}:debuff`;
          if (!this.fired.has(dKey) && this.conditionMet(p, p.cond[1], facts)) {
            // deb8 同一条件特例: バフ条件とデバフ条件が同一なら、解除トリガー側では満たさない
            this.fired.add(dKey);
            facts.condMetThisPass.add(seat);
            if (!this.isPassiveEffect(DEBUFFS[p.debuffIdx]))
              this.emit({ type: 'cutin', kind: 'debuff', seat, condText: CONDITIONS[p.cond[1]], effText: DEBUFFS[p.debuffIdx] });
            this.logPush('debuff', `${this.nameOf(seat)} のデバフ「${DEBUFFS[p.debuffIdx]}」発動（条件:${CONDITIONS[p.cond[1]]}）${this.abilityTargetNote('debuff', p.debuffIdx, seat)}`);
            this.applyDebuff(seat, p.debuffIdx, facts);
            changed = true;
          }
        }
      }
    }

    markReceived(seat, facts) { if (facts) facts.abilityReceivers.add(seat); }

    /* ---------- バフ適用 ---------- */
    applyBuff(seat, idx, facts) {
      const p = this.players[seat];
      const nxt = this.nextSeat(seat);
      switch (idx) {
        case 0: // 次のプレイヤーは1枚ドロー
          this.markReceived(nxt, facts); this.lastDrawForcer = seat; this.drawCards(nxt, 1, facts); break;
        case 1: // リバース
          facts.reverseFired = true; this.dir *= -1; this.emit({ type: 'reverse', seat, count: 1, fromBuff: true }); break;
        case 2: // 山札から1枚ドローし1枚破棄
          this.lastDrawForcer = null; this.drawCards(seat, 1, facts);
          this.queueDecision({ type: 'discard', seat, amount: 1, reason: 'buff' }); break;
        case 3: // 追加で1枚破棄
          this.queueDecision({ type: 'discard', seat, amount: 1, reason: 'buff' }); break;
        case 4: // 盤面の色を好きな色に
          this.queueDecision({ type: 'chooseColor', seat, reason: 'buff', applyNow: true }); break;
        case 5: { // 両隣の条件を入れ替え
          [this.prevSeat(seat), this.nextSeat(seat)].forEach(s => {
            const q = this.players[s]; q.cond = [q.cond[1], q.cond[0]];
            this.markReceived(s, facts);
          });
          break;
        }
        case 6: // 手番外で盤面同色の記号を出す(選択)
          this.queueDecision({ type: 'buff7play', seat }); break;
        case 7: // 最大手札6枚
          p.maxHand = 6; this.trimHand(seat, facts); break;
        case 8: // 1色禁止上がり指定
          this.queueDecision({ type: 'chooseColor', seat, reason: 'forbidWin' }); break;
        case 9: { // 次プレイヤーはバフ条件を満たせない
          const q = this.players[nxt]; q.buffBlockedUntilTurn = true; this.markReceived(nxt, facts); break;
        }
        case 10: p.draw2plus = true; break;
        case 11: p.wildPlus4 = true; break;
        case 12: { // 次プレイヤーのデバフ条件を強制発動
          const q = this.players[nxt];
          const k = `${nxt}:debuff`;
          if (!this.fired.has(k)) {
            this.fired.add(k);
          if (!this.isPassiveEffect(DEBUFFS[q.debuffIdx]))
            this.emit({ type: 'cutin', kind: 'debuff', seat: nxt, condText: '強制発動', effText: DEBUFFS[q.debuffIdx] });
            this.logPush('debuff', `${this.nameOf(nxt)} のデバフ「${DEBUFFS[q.debuffIdx]}」が強制発動（${this.nameOf(seat)}のバフ）`);
            this.markReceived(nxt, facts);
            this.applyDebuff(nxt, q.debuffIdx, facts);
          }
          break;
        }
        case 13: p.snipePlus = true; break;
        case 14: // 山札から好きなカードを手札に
          this.queueDecision({ type: 'pickFromDeck', seat }); break;
        case 15: p.drawReflect = true; break;
      }
    }

    /* ---------- デバフ適用 ---------- */
    applyDebuff(seat, idx, facts) {
      const p = this.players[seat];
      switch (idx) {
        case 0: this.lastDrawForcer = null; this.drawCards(seat, 1, facts); break; // 1枚ドロー
        case 1: p.symbolsDead = true; break;
        case 2: p.mustPass = true; break;              // 次手番パス
        case 3: p.passUntilColor = this.board.color; break; // 色変化までパス
        case 4: p.revealOne = true; break;
        case 5: p.cantPlayBoardMatch = true; break;
        case 6: p.noTwoPlay = true; break;
        case 7: p.cantChangeColor = true; break;
        case 8: // バフ条件満たすまで上がれない
          p.lockWinUntilBuff = true;
          p.lockWinGrace = (p.cond[0] === p.cond[1]); // 同一条件は次の1回は解除しない
          break;
        case 9: { // 前のプレイヤーは1枚破棄
          const prev = this.prevSeat(seat);
          this.markReceived(prev, facts);
          this.queueDecision({ type: 'discard', seat: prev, amount: 1, reason: 'debuff' }); break;
        }
        case 10: p.drawPlus1 = true; break;
        case 11: p.drawOnPass = true; break;
        case 12: p.giftMinus = true; break;
        case 13: // 手札の色を1色宣言
          this.queueDecision({ type: 'declareColor', seat }); break;
      }
    }

    trimHand(seat, facts) {
      const p = this.players[seat];
      if (p.maxHand && p.hand.length > p.maxHand) {
        const over = p.hand.length - p.maxHand;
        this.queueDecision({ type: 'discard', seat, amount: over, reason: 'trim' });
      }
    }

    /* ============================================================
       決定キュー(プレイヤー選択)
       ============================================================ */
    queueDecision(dec) { dec.id = (this._did = (this._did || 0) + 1); this.decisions.push(dec); }
    nextDecision() { return this.decisions[0] || null; }

    resolveDecision(id, answer) {
      const i = this.decisions.findIndex(d => d.id === id);
      if (i < 0) return { error: 'no such decision' };
      const dec = this.decisions.splice(i, 1)[0];
      const facts = this.newFacts(dec.seat); // 二次発動用
      switch (dec.type) {
        case 'gift': {
          const giver = this.players[dec.seat], taker = this.players[dec.target];
          const uids = (answer && answer.uids) || [];
          const moving = giver.hand.filter(c => uids.includes(c.uid)).slice(0, dec.amount);
          giver.hand = giver.hand.filter(c => !moving.includes(c));
          taker.hand.push(...moving);
          this.markReceived(dec.target, facts);
          this.emit({ type: 'gift', from: dec.seat, to: dec.target, count: moving.length });
          this.checkRoundWin(dec.seat);
          break;
        }
        case 'snipe': {
          const assign = (answer && answer.assign) || []; // [{seat,n}]
          for (const a of assign) {
            this.markReceived(a.seat, facts);
            this.lastDrawForcer = dec.seat;
            this.drawCards(a.seat, a.n * dec.per, facts);
          }
          this.resolveAbilities(facts);
          break;
        }
        case 'discard': {
          const uids = (answer && answer.uids) || [];
          const p = this.players[dec.seat];
          const drop = p.hand.filter(c => uids.includes(c.uid)).slice(0, dec.amount);
          p.hand = p.hand.filter(c => !drop.includes(c));
          drop.forEach(c => this.discard.push(c));
          this.emit({ type: 'discardHand', seat: dec.seat, count: drop.length });
          this.checkRoundWin(dec.seat);
          break;
        }
        case 'chooseColor': {
          const col = (answer && answer.color) || 'red';
          if (dec.reason === 'buff' && dec.applyNow) {
            this.board.color = col;
            facts.boardColorChanged = true; facts.colorChangedBy = dec.seat;
            this.emit({ type: 'colorChange', seat: dec.seat, color: col });
            this.resolveAbilities(facts);
          }
          break;
        }
        case 'forbidWin': {
          const col = (answer && answer.color) || 'red';
          this.forbiddenWinColor = col; this.forbiddenWinColorOwner = dec.seat;
          this.emit({ type: 'forbidWin', seat: dec.seat, color: col });
          break;
        }
        case 'pickFromDeck': {
          const uid = answer && answer.uid;
          let idx = this.deck.findIndex(c => c.uid === uid);
          if (idx < 0) idx = 0;
          if (this.deck.length) {
            const c = this.deck.splice(idx, 1)[0];
            this.players[dec.seat].hand.push(c);
            this.emit({ type: 'pickDeck', seat: dec.seat });
          }
          break;
        }
        case 'declareColor': {
          const col = (answer && answer.color) || 'red';
          this.players[dec.seat].declaredColor = col;
          this.emit({ type: 'declareColor', seat: dec.seat, color: col });
          break;
        }
        case 'buff7play': {
          const uid = answer && answer.uid;
          const p = this.players[dec.seat];
          const c = p.hand.find(x => x.uid === uid);
          if (c) {
            p.hand = p.hand.filter(x => x.uid !== uid);
            this.discard.push(c);
            this.board = { color: c.kind === 'change' ? this.board.color : c.color, cards: [c], count: 1 };
            this.emit({ type: 'buff7play', seat: dec.seat, uid });
            const f2 = this.newFacts(dec.seat); f2.action = 'play'; f2.isSymbol = true;
            if (c.color) f2.playedColors.add(c.color);
            this.resolveAbilities(f2);
            this.checkRoundWin(dec.seat);
            // 自分の次から再開
            this.turn = this.nextSeat(dec.seat);
            this.onTurnStart();
          }
          break;
        }
      }
      return { ok: true };
    }

    /* ============================================================
       INO / 勝利
       ============================================================ */
    canWinNow(p) {
      if (p.lockWinUntilBuff) return false;
      // buff8 禁止上がり色: 全手札がその色のみなら上がれない
      if (this.forbiddenWinColor) {
        const cols = handColors(p.hand);
        if (cols.size === 1 && cols.has(this.forbiddenWinColor)) return false;
      }
      return true;
    }

    isInoState(p) {
      // 次に上がれる状態
      if (p.hand.length === 0) return false;
      if (this.sameGroup(p.hand)) return true; // 全て同一グループ→1手で出し切れる
      // ギフトで上がれる: ギフト枚数 >= ギフト以外の枚数 なら、ギフトを複数出しして残りを全部渡せる
      const gifts = p.hand.filter(c => c.kind === 'gift').length;
      const others = p.hand.length - gifts;
      if (gifts >= 1 && gifts >= others) return true;
      return false;
    }
    checkIno(seat) {
      const p = this.players[seat];
      if (p.hand.length > 0 && this.isInoState(p)) {
        this.emit({ type: 'cutin', kind: 'ino', seat });
      }
    }

    checkRoundWin(seat) {
      const p = this.players[seat];
      if (p.hand.length === 0 && this.canWinNow(p)) {
        this.emit({ type: 'roundWinByEmpty', seat });
        this.finishRound([seat]);
        return true;
      }
      return false;
    }

    finishRound(winnerSeats) {
      if (this.roundOver) return;
      this.roundOver = true;
      this.roundWinners = winnerSeats;
      this.decisions = []; // 上がりと同時に保留中の効果選択(ギフト等)は破棄してスタックを防ぐ
      winnerSeats.forEach(s => this.players[s].roundWins++);
      this.emit({ type: 'roundEnd', winners: winnerSeats, standings: this.players.map(p => ({ seat: p.seat, wins: p.roundWins })) });
      const champ = this.players.find(p => p.roundWins >= 2);
      if (champ) { this.gameOver = true; this.gameWinnerSeat = champ.seat; this.emit({ type: 'gameOver', seat: champ.seat }); }
    }

    /* ---------- 状態スナップショット(ネット配信用) ---------- */
    snapshot(forSeat = null) {
      return {
        round: this.round, dir: this.dir, turn: this.turn,
        board: { color: this.board.color, cards: this.board.cards, count: this.board.count },
        pending: this.pending, passStreak: this.passStreak, startingPlay: this.startingPlay,
        forcedPass: (!this.gameOver && !this.roundOver) ? this.mustPassNow(this.turn) : false,
        deckCount: this.deck.length,
        forbiddenWinColor: this.forbiddenWinColor,
        forcedPass: this.mustPassNow(this.turn),
        roundOver: this.roundOver, roundWinners: this.roundWinners,
        gameOver: this.gameOver, gameWinnerSeat: this.gameWinnerSeat,
        players: this.players.map(p => ({
          seat: p.seat, name: p.name, isAI: p.isAI,
          handCount: p.hand.length, roundWins: p.roundWins,
          hand: (forSeat === p.seat) ? p.hand : null,
          // 公開情報
          revealed: p.revealOne ? (p.hand[0] ? [p.hand[0]] : []) : [],
          declaredColor: p.declaredColor,
          lockWin: !!p.lockWinUntilBuff,
          // 異能は全員に公開
          ability: {
            buff: BUFFS[p.buffIdx], debuff: DEBUFFS[p.debuffIdx],
            condBuff: CONDITIONS[p.cond[0]], condDebuff: CONDITIONS[p.cond[1]],
          },
        })),
        decision: this.nextDecision(),
        deckView: (this.nextDecision() && this.nextDecision().type === 'pickFromDeck'
                   && this.nextDecision().seat === forSeat) ? this.deck.slice() : null,
        log: this.log.slice(-80),
        events: this.events.slice(),
      };
    }
    flushEvents() { const e = this.events; this.events = []; return e; }
  }

  Engine.prototype.lastDrawForcer = null;

  const api = { Engine, shuffle, handColors };
  if (typeof module !== 'undefined') module.exports = api;
  global.INOEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
