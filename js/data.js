/* ============================================================
   INO - data.js
   カード定義 / 山札生成 / 異能テキスト
   ============================================================ */

const COLORS = ['red', 'blue', 'yellow', 'green'];
const COLOR_JP = { red: '赤', blue: '青', yellow: '黄', green: '緑' };
const COLOR_HEX = { red: '#e23b32', blue: '#2c6fd4', yellow: '#e8b400', green: '#3a9d4b' };

// チェンジカードの色スロット割り当て（赤=赤青, 青=青黄, 黄=黄緑, 緑=緑赤）
const CHANGE_PAIR = {
  red:    ['red', 'blue'],
  blue:   ['blue', 'yellow'],
  yellow: ['yellow', 'green'],
  green:  ['green', 'red'],
};

// 記号スロット順（画像 index と一致）: 0-5 数字, 6 skip,7 draw2,8 reverse,9 gift,10 snipe,11 change
const SYMBOL_SLOTS = ['skip', 'draw2', 'reverse', 'gift', 'snipe', 'change'];

const KIND_JP = {
  number: '数字', skip: 'スキップ', draw2: 'ドロー2', reverse: 'リバース',
  gift: 'ギフト', snipe: 'スナイプ', change: 'チェンジ', wild: 'ワイルド', wd4: 'ワイルドドロー4',
};

// index -> 画像ファイル名
function imgFor(index) { return `assets/card_${String(index).padStart(3, '0')}.png`; }

/* 50種のカード型を定義（typeId は一意の文字列） */
function buildCardTypes() {
  const types = [];
  COLORS.forEach((color, ci) => {
    // 数字 0-5
    for (let n = 0; n <= 5; n++) {
      const idx = ci * 12 + n;
      types.push({ typeId: `${color}_n${n}`, color, kind: 'number', value: n, img: imgFor(idx) });
    }
    // 記号
    SYMBOL_SLOTS.forEach((kind, si) => {
      const idx = ci * 12 + 6 + si;
      const t = { typeId: `${color}_${kind}`, color, kind, value: null, img: imgFor(idx) };
      if (kind === 'change') t.pair = CHANGE_PAIR[color].slice();
      types.push(t);
    });
  });
  types.push({ typeId: 'wild', color: null, kind: 'wild', value: null, img: imgFor(48) });
  types.push({ typeId: 'wd4', color: null, kind: 'wd4', value: null, img: imgFor(49) });
  return types;
}

const CARD_TYPES = buildCardTypes();
const CARD_TYPE_BY_ID = Object.fromEntries(CARD_TYPES.map(t => [t.typeId, t]));

/* 山札生成: 数字×3, 記号×2, ワイルド×2 = 124枚 */
function buildDeck() {
  const deck = [];
  let uid = 0;
  for (const t of CARD_TYPES) {
    let count;
    if (t.kind === 'number') count = 3;
    else if (t.kind === 'wild' || t.kind === 'wd4') count = 2;
    else count = 2; // 記号
    for (let k = 0; k < count; k++) {
      deck.push({ uid: uid++, ...t, pair: t.pair ? t.pair.slice() : undefined });
    }
  }
  return deck;
}

/* ---------------- 異能テキスト ---------------- */
const BUFFS = [
  '次のプレイヤーは1枚ドロー',
  'リバース',
  '山札から1枚ドローし1枚破棄する',
  '追加で1枚破棄する',
  '盤面の色を好きな色に変更できる',
  '両隣のプレイヤーは自分のバフデバフ条件を入れ替える',
  '手番に関わらず盤面と同色の記号カードを出し、自分の次のプレイヤーから手番を再開する',
  'これ以降自分の最大手札枚数が6枚になる(超過した時はその分破棄する)',
  '次の自分の手番開始まで1色禁止上がりに指定する(その色のカードでは上がれない)',
  '次の自分の手番開始まで次のプレイヤーはバフ条件を満たせない',
  'これ以降自分が使うドロー2はドロー3として扱う',
  'これ以降自分のワイルド全てにドロー+4として扱う',
  '次のプレイヤーのデバフ条件を強制的に満たす',
  'これ以降自分の使うスナイプはスナイプ2として扱う',
  '山札から好きなカードを手札に加える',
  '次にドローした時、ドローさせたプレイヤーも同じ枚数ドローする',
];

const CONDITIONS = [
  'ドローした時',
  '前のプレイヤーが条件を満たした時(バフデバフ問わず)',
  '赤のカードを出した時',
  '青のカードを出した時',
  '黄のカードを出した時',
  '緑のカードを出した時',
  '出した数字カードの合計が奇数の時',
  '記号カードを出した時',
  'カードを出したあと手札が4色以上の時',
  '異能を受けた時(バフデバフの効果を受けた時)',
  '誰かがリバース発動時',
  'カードを出したあと手札が偶数の時',
  '他プレイヤーが盤面の色を変えた時',
  '誰かがドローした時',
  'パスした時',
  '場と完全に同色かつ同じ枚数出した時',
  'カードを出したあと手札に記号カードがある時',
];

const DEBUFFS = [
  '1枚ドロー',
  'これ以降自分の記号は不発(チェンジの色変更効果のみ不発)',
  '次の手番時パスをする',
  '盤面の色が変わるまでパスし続ける',
  'これ以降手札1枚公開し続ける',
  'これ以降盤面と同じ記号数字ワイルドは出せない',
  'これ以降2枚出し不可(1枚・3枚以上は可)',
  'これ以降自分の出したカードで盤面の色変更不可',
  'バフ条件を満たすまで上がれない',
  '前のプレイヤーは1枚破棄する',
  'これ以降自分の受けるドロー効果合計+1',
  'これ以降パスする時に1枚ドローする',
  'これ以降自分のギフトはギフト-1になる',
  '手札の色を1色宣言する',
];

const _DATA_EXPORTS = {
  COLORS, COLOR_JP, COLOR_HEX, CHANGE_PAIR, KIND_JP, CARD_TYPES, CARD_TYPE_BY_ID,
  buildDeck, BUFFS, CONDITIONS, DEBUFFS, imgFor,
};
if (typeof module !== 'undefined') {
  module.exports = _DATA_EXPORTS;
} else {
  // ブラウザ: 他スクリプト(engine.js等)から参照できるよう global に公開
  Object.assign(typeof window !== 'undefined' ? window : globalThis, _DATA_EXPORTS);
}
