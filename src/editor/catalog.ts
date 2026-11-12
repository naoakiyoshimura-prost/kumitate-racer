// コースエディタの寸法表（実寸 mm / 度）。three に依存しない純粋なデータ。
// 出典の区別が最重要: official=メーカー公表（note に URL か「公式」）、measured=実測（店長の説明・第三者の実測。公式ではない）、
// estimated=公表値から計算（note に式）、provisional=仮の値。
// 3レーンと5レーンは別の表。5レーンは何も確認できていないので全部 provisional（3レーンの値を黙って流用しない）。
import type { Dim, LaneCount } from './types';

const URL_LANE = 'https://tamiya.com/japan/products/69578/index.html';
const URL_WAVE = 'https://www.tamiya.com/japan/products/69575/index.html';
const URL_BASIC = 'https://tamiya.com/japan/mini4wd/feature/2019/1206.html';

const mm = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'mm', source, note });
const cnt = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'count', source, note });
const deg = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'deg', source, note });

// 3レーン
const L3_LANE = 115;
const L3_WALL_T = 10;
const L3_WIDTH = 3 * L3_LANE + 2 * L3_WALL_T; // 365
// コーナーの中心線の半径 = 直線1枚の長さ（540）。
// 理由: 実物は「直線○枚ぶん」の格子の上で組むので、90度（2枚）曲がったときの前後・左右のずれ（どちらも半径と同じ）が
// 直線1枚ぶんにならないと、90度の折れを混ぜた並びが閉じない。以前の 517.5（外寸 約1.4m と壁厚の仮値10mm からの逆算）では
// 例えば「直線2・左90・直線2・左180・右90・左180」が 63.6mm ずれて閉じなかった。
const L3_RADIUS = 540;

const UNCONFIRMED5 = '未確認。3レーンとは別に要調査';

export const CATALOG: Record<LaneCount, Record<string, Dim>> = {
  3: {
    laneWidth: mm(L3_LANE, 'official', `1レーンのコース幅 115mm。${URL_LANE}`),
    wallHeight: mm(50, 'official', `フェンス高 50mm。${URL_LANE}`),
    wallThickness: mm(L3_WALL_T, 'provisional', '仮。外側の壁1枚の厚み（未確認）'),
    straightLength: mm(540, 'provisional', '直線1枚 540mm（広く言われる値だが公式ページで未確認）'),
    cornerCenterRadius: mm(
      L3_RADIUS,
      'estimated',
      `直線1枚（540、仮）と同じ長さと推定。公式の公表値は無い。根拠: (1) 第三者の調査メモで中央レーンの中心の半径 540mm、` +
        `(2) 基本コースの公表の外寸 約3.1m×1.4m（${URL_BASIC}）と合う: 短辺 2×540 + 幅365 = 1445、長辺 直線3枚 1620 + 1445 = 3065、` +
        '(3) 公表「3周20m」と合う: 中心線1周 2×1620 + 2π×540 ≈ 6633、3周 ≈ 19.9m、' +
        '(4) 半径が直線1枚と同じだと、90度の折れを混ぜた並びが格子の上で閉じる（517.5 では閉じなかった）',
    ),
    cornerAngle: deg(45, 'provisional', '1枚45度として扱う（エディタの前提。公式ページで未確認）'),
    slopeRise: mm(110, 'measured', '落差11cm（店長の説明。公式の値とされるが出典のページは未確認なので公式扱いにしていない）'),
    slopeLength: mm(540, 'measured', '店長の説明: スロープの全長は直線1枚と同じ（上から見た長さ）。ただし直線1枚の540自体が仮の値（公式で未確認）'),
    slopeBendRadius: mm(
      300,
      'provisional',
      '仮・未確認。スロープの折れ目（入口と出口の縦の丸み）の中心線の半径。公開値なし。バンクの半径より小さいことだけが定性的に分かっている。' +
        '長さと高さは上の2項目のまま、斜面の角度をこの半径から計算する（計算行の角度は推定）',
    ),
    bankAngle: deg(20, 'official', `バンクアプローチ1枚の角度 20度（公式の製品ページ。40度は20度を2枚重ねたもの＝店長の説明）。${URL_BASIC}`),
    bankBendRadius: mm(650, 'measured', '第三者の実測記事の値。公式ではない（アプローチ1枚は中心角20度の円弧で、弦の長さ 約226mm・半径 約650mm）'),
    waveLength: mm(540, 'provisional', '仮。直線1枚ぶんの長さと仮定'),
    waveSwing: mm(15, 'provisional', `仮。ウェーブで中心線が左右に振れる幅（片側）。公式の説明は「マシンが左右に激しく振られるウェーブ」（${URL_WAVE}）で、路面は平らなままコースが左右に蛇行する部品。振れ幅の公表値は無い`),
    waveCount: cnt(2, 'provisional', '仮。1個のウェーブで左右に往復する回数（公表値なし）'),
    laneChangeLength: mm(1620, 'measured', '店長の申告（2026-11-12）: 直線3本ぶん（540×3）。前後にLCジャンプのような坂が付き、その間を立体交差でつなぐ形（店長の説明）。坂と橋の長さの割合（1/3ずつ）は推定'),
    laneChangeRise: mm(70, 'provisional', '仮。立体交差の橋の高さ（壁高50mm＋余裕）'),
    bumpRise: mm(40, 'provisional', '仮。バウンド（片側がゆるく片側が急な山）の高さ。実物の公表値・実測値は見つからなかった'),
    bumpPeak: { value: 0.65, unit: 'count', source: 'provisional', note: '仮。バウンドの頂点の位置（部品の長さに対する割合。A の向きで入口から測る）' },
    steepRise: mm(220, 'estimated', '店長の指定（2026-11-12: スロープ2個ぶん=220mm 上がって水平）。実物の公表値・実測値は未確認'),
    steepAngle: deg(30, 'estimated', '店長の説明（30度バンクとその終わりを足したような形）から、斜面の角度を30度とした。丸みの半径（約297mm）は長さ・高さ・角度から計算した値で、実物は未確認'),
    humpRise: mm(45, 'provisional', '仮。こぶ（なめらかな山）の高さ。実物の公表値・実測値は見つからなかった'),
    shiftLength: mm(1390, 'estimated', '推定。シフトチェンジ全体の前への長さ（直線1枚 540 ＋ S字 約850）。店長の画面写し（参考ツールの2D表示）を直線1枚=540mmとして測った値'),
    shiftOffset: mm(230, 'estimated', '推定。シフトチェンジで横へずれる量（2レーンぶん）。店長の画面写しの目測は約235mm'),
  },
  5: {
    laneWidth: mm(115, 'provisional', `${UNCONFIRMED5}（1レーン幅は3レーンと同じと仮定）`),
    wallHeight: mm(60, 'provisional', UNCONFIRMED5),
    wallThickness: mm(12, 'provisional', UNCONFIRMED5),
    straightLength: mm(600, 'provisional', UNCONFIRMED5),
    cornerCenterRadius: mm(900, 'provisional', `${UNCONFIRMED5}（直線1枚の仮値600の1.5倍。直線と半分の直線で格子の上に閉じるようにした仮値。幅 5×115+2×12 = 599 が収まる）`),
    cornerAngle: deg(45, 'provisional', `${UNCONFIRMED5}（エディタの部品の前提として45度で仮置き）`),
    slopeRise: mm(110, 'provisional', `${UNCONFIRMED5}（3レーンの公式値110を仮置き）`),
    slopeLength: mm(600, 'provisional', `${UNCONFIRMED5}（全長は直線1枚と同じという3レーンの店長の説明を、5レーンの直線1枚の仮値600に当てはめた）`),
    slopeBendRadius: mm(250, 'provisional', `${UNCONFIRMED5}（5レーンは縦の曲がりが3レーンよりきついとの店長の説明により、3レーンの仮値300より小さく仮置き）`),
    bankAngle: deg(20, 'provisional', `${UNCONFIRMED5}（3レーンの公表角度を仮置き）`),
    bankBendRadius: mm(500, 'provisional', `${UNCONFIRMED5}（実測なし。5レーンは縦の曲がりがきついとの店長の説明により、3レーンの実測値650より小さく仮置き）`),
    waveLength: mm(600, 'provisional', `${UNCONFIRMED5}（直線1枚ぶんと仮定）`),
    waveSwing: mm(15, 'provisional', `${UNCONFIRMED5}（左右に振れる幅。3レーンの仮値を仮置き）`),
    waveCount: cnt(2, 'provisional', `${UNCONFIRMED5}（往復の回数は仮）`),
    laneChangeLength: mm(1800, 'provisional', `${UNCONFIRMED5}（3レーンの店長申告に合わせて直線3枚ぶんと仮定）`),
    laneChangeRise: mm(80, 'provisional', UNCONFIRMED5),
    bumpRise: mm(40, 'provisional', `${UNCONFIRMED5}（バウンドの高さ。公表値なし）`),
    bumpPeak: { value: 0.65, unit: 'count', source: 'provisional', note: `${UNCONFIRMED5}（バウンドの頂点の位置の割合）` },
    steepRise: mm(220, 'provisional', `${UNCONFIRMED5}（急スロープの高さ。3レーンの店長指定値を仮置き）`),
    steepAngle: deg(30, 'provisional', `${UNCONFIRMED5}（急スロープの斜面の角度）`),
    humpRise: mm(45, 'provisional', `${UNCONFIRMED5}（こぶの高さ。公表値なし）`),
    shiftLength: mm(1450, 'provisional', `${UNCONFIRMED5}（シフトチェンジの長さ。直線1枚＋S字850と仮定）`),
    shiftOffset: mm(230, 'provisional', `${UNCONFIRMED5}（シフトチェンジの横ずれ。2レーンぶんと仮定）`),
  },
};

// 上書きのキー（3レーンと5レーンは別の表なので、レーン数を含める）
export const dimKey = (lanes: LaneCount, key: string) => `${lanes}:${key}`;

// 上書きとして使える値か（有限で0より大きい。山の数は整数）
export function validDimValue(key: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  if (key === 'waveCount') return Number.isInteger(v) && v <= 20;
  return true;
}

// 値だけ。overrides（Layout.dims）にあればそれ、無ければ表の値（無いキーは例外: 打ち間違いを黙って0にしない）
export function dim(lanes: LaneCount, key: string, overrides?: Record<string, number>): number {
  const d = CATALOG[lanes]?.[key];
  if (!d) throw new Error(`寸法表に ${lanes}レーンの ${key} がありません`);
  const o = overrides?.[dimKey(lanes, key)];
  return validDimValue(key, o) ? o : d.value;
}

// コース全体の幅（外側の壁の外から外まで）= レーン幅×レーン数 + 外壁の厚み×2
export function trackWidth(lanes: LaneCount, overrides?: Record<string, number>): number {
  return lanes * dim(lanes, 'laneWidth', overrides) + 2 * dim(lanes, 'wallThickness', overrides);
}
