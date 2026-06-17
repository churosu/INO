/* ============================================================
   INO - ai.js
   ヒューリスティックAI: 手札・盤面・残枚数から手を選ぶ
   ============================================================ */
(function (global) {
  const SYMBOLS = ['skip', 'draw2', 'reverse', 'gift', 'snipe', 'change'];

  function colorCounts(hand) {
    const c = { red: 0, blue: 0, yellow: 0, green: 0 };
    for (const x of hand) if (c[x.color] != null) c[x.color]++;
    return c;
  }
  function bestColor(hand) {
    const c = colorCounts(hand); let b = 'red', v = -1;
    for (const k of ['red', 'blue', 'yellow', 'green']) if (c[k] > v) { v = c[k]; b = k; }
    return b;
  }

  // カードの「持っていたくなさ」(高いほど早く手放したい)
  function dumpScore(card) {
    if (card.kind === 'wild' || card.kind === 'wd4') return -5; // 温存
    if (card.kind === 'change') return 1;
    if (SYMBOLS.includes(card.kind)) return 3; // 記号は効果的なので出したい
    return 2; // 数字
  }

  const AI = {
    // 行動決定: {kind:'play', uids, opts} | {kind:'pass'}
    chooseAction(E, seat) {
      const p = E.players[seat];

      // pending(ドロー2/WD4)が来ている
      if (E.pending.kind) {
        const stackable = p.hand.filter(c => c.kind === E.pending.kind);
        // 受けると痛い枚数なら、出せるならスタックする
        if (stackable.length && (E.pending.amount >= 2)) {
          return { kind: 'play', uids: [stackable[0].uid], opts: {} };
        }
        return { kind: 'pass' }; // 受け取る
      }

      const playable = p.hand.filter(c => E.matchesBoard(c) && !E.blockedByDebuff(p, c)
        && E.legalTopColors([c], seat).length > 0);
      if (playable.length === 0) return { kind: 'pass' };

      // スコアで出すカードを選ぶ
      const scored = playable.map(c => {
        let s = dumpScore(c);
        // 残り少ない相手がいる時は妨害系を優先
        const minOpp = Math.min(...E.players.filter(q => q.seat !== seat).map(q => q.hand.length));
        if (minOpp <= 2 && ['skip', 'draw2', 'snipe'].includes(c.kind)) s += 4;
        if ((c.kind === 'wild' || c.kind === 'wd4') && p.hand.length <= 2) s += 10; // 上がりに使う
        return { c, s };
      }).sort((a, b) => b.s - a.s);

      const chosen = scored[0].c;
      // 同種まとめ出し(色違い可)。一気に減らせるなら出す
      let group = p.hand.filter(x => E.sameGroup([chosen, x]));
      if (p.noTwoPlay) group = group.filter((_, i) => true); // 2枚は後で除外
      let uids = group.map(x => x.uid);
      if (p.noTwoPlay && uids.length === 2) uids = [chosen.uid];
      // チェンジは色の連続性が必要なので単体で
      if (chosen.kind === 'change') uids = [chosen.uid];
      // 色変更不可デバフ中は単体出し（盤面色を維持できる選択のみ合法）
      if (p.cantChangeColor) uids = [chosen.uid];

      const opts = {};
      if (chosen.kind === 'wild' || chosen.kind === 'wd4') opts.color = bestColor(p.hand);
      if (chosen.kind === 'gift') {
        const keep = p.hand.filter(x => !uids.includes(x.uid));
        const give = keep.slice().sort((a, b) => dumpScore(b) - dumpScore(a)).slice(0, uids.length);
        opts.gift = give.map(x => x.uid);
      }
      if (chosen.kind === 'snipe') {
        const target = E.players.filter(q => q.seat !== seat).sort((a, b) => a.hand.length - b.hand.length)[0];
        opts.snipe = [{ seat: target.seat, n: uids.length }];
      }
      return { kind: 'play', uids, opts };
    },

    // 決定キューの自動解決
    resolveDecision(E, dec) {
      const p = E.players[dec.seat];
      switch (dec.type) {
        case 'gift': {
          const give = p.hand.slice().sort((a, b) => dumpScore(b) - dumpScore(a)).slice(0, dec.amount);
          return { uids: give.map(c => c.uid) };
        }
        case 'discard': {
          const drop = p.hand.slice().sort((a, b) => dumpScore(b) - dumpScore(a)).slice(0, dec.amount);
          return { uids: drop.map(c => c.uid) };
        }
        case 'snipe': {
          const target = E.players.filter(q => q.seat !== dec.seat).sort((a, b) => a.hand.length - b.hand.length)[0];
          return { assign: [{ seat: target.seat, n: dec.picks }] };
        }
        case 'forbidWin': {
          // 上がりに近い相手の主要色を禁止して妨害する
          const opps = E.players.filter(q => q.seat !== dec.seat).sort((a, b) => a.hand.length - b.hand.length);
          const t = opps[0];
          return { color: (t && t.hand.length) ? bestColor(t.hand) : bestColor(p.hand) };
        }
        case 'chooseColor': case 'declareColor':
          return { color: bestColor(p.hand) };
        case 'pickFromDeck': {
          // ワイルド優先、なければ多い色の数字
          const wild = E.deck.find(c => c.kind === 'wild' || c.kind === 'wd4');
          if (wild) return { uid: wild.uid };
          const col = bestColor(p.hand);
          const same = E.deck.find(c => c.color === col);
          return { uid: (same || E.deck[0] || {}).uid };
        }
        case 'buff7play': {
          const board = E.board.color;
          const sym = p.hand.find(c => SYMBOLS.includes(c.kind) && (c.color === board || c.kind === 'change'));
          return sym ? { uid: sym.uid } : { skip: true };
        }
        default: return {};
      }
    },
  };

  if (typeof module !== 'undefined') module.exports = AI;
  global.INOAI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
