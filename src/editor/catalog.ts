// コースエディタの寸法表（実寸 mm / 度）。three に依存しない純粋なデータ。
// 出典の区別が最重要: official=メーカー公表（note に URL か「公式」）、measured=実測（店長の説明・第三者の実測。公式ではない）、
// estimated=公表値から計算（note に式）、provisional=仮の値。
// 3レーンと5レーンは別の表。5レーンは何も確認できていないので全部 provisional（3レーンの値を黙って流用しない）。
import type { Dim, LaneCount } from './types';

const URL_LANE = 'https://tamiya.com/japan/products/69578/index.html';
const URL_BASIC = 'https://tamiya.com/japan/mini4wd/feature/2019/1206.html';

const mm = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'mm', source, note });
const cnt = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'count', source, note });
const deg = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'deg', source, note });

// 3レーン
const L3_LANE = 115;
const L3_WALL_T = 10;
const L3_WIDTH = 3 * L3_LANE + 2 * L3_WALL_T; // 365
// 基本コースの外寸の短辺 約1.4m は、コーナーの外側の壁の外から外まで = 2×(中心半径 + 幅/2)
const L3_RADIUS = 1400 / 2 - L3_WIDTH / 2; // 517.5

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
      `基本コースの外寸 約1.4m（${URL_BASIC}）から逆算: 1400/2 − 幅/2、幅 = 3×115 + 2×壁厚10(仮) = 365 → 517.5。` +
        '検算: 外寸の長辺 約3.1m なら直線部 3100−1400 = 1700、中心線1周 2×1700 + 2π×517.5 ≈ 6652、3周 ≈ 20.0m（公表「3周20m」と一致）。' +
        '別の推定（第三者の調査メモ。公式ではない）では中央レーンの中心の半径 540mm',
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
    waveHeight: mm(8, 'provisional', '仮。山の高さ（谷も同じ深さ）'),
    waveCount: cnt(2, 'provisional', '仮。1個のウェーブに並ぶ山の数（前半の山が高く後半が低い。実物の断面は未確認）'),
    laneChangeLength: mm(1080, 'provisional', '仮。直線2枚ぶんと仮定'),
    laneChangeRise: mm(70, 'provisional', '仮。立体交差の橋の高さ（壁高50mm＋余裕）'),
  },
  5: {
    laneWidth: mm(115, 'provisional', `${UNCONFIRMED5}（1レーン幅は3レーンと同じと仮定）`),
    wallHeight: mm(60, 'provisional', UNCONFIRMED5),
    wallThickness: mm(12, 'provisional', UNCONFIRMED5),
    straightLength: mm(600, 'provisional', UNCONFIRMED5),
    cornerCenterRadius: mm(760, 'provisional', `${UNCONFIRMED5}（幅 5×115+2×12 = 599 を収める仮値）`),
    cornerAngle: deg(45, 'provisional', `${UNCONFIRMED5}（エディタの部品の前提として45度で仮置き）`),
    slopeRise: mm(110, 'provisional', `${UNCONFIRMED5}（3レーンの公式値110を仮置き）`),
    slopeLength: mm(600, 'provisional', `${UNCONFIRMED5}（全長は直線1枚と同じという3レーンの店長の説明を、5レーンの直線1枚の仮値600に当てはめた）`),
    slopeBendRadius: mm(250, 'provisional', `${UNCONFIRMED5}（5レーンは縦の曲がりが3レーンよりきついとの店長の説明により、3レーンの仮値300より小さく仮置き）`),
    bankAngle: deg(20, 'provisional', `${UNCONFIRMED5}（3レーンの公表角度を仮置き）`),
    bankBendRadius: mm(500, 'provisional', `${UNCONFIRMED5}（実測なし。5レーンは縦の曲がりがきついとの店長の説明により、3レーンの実測値650より小さく仮置き）`),
    waveLength: mm(600, 'provisional', `${UNCONFIRMED5}（直線1枚ぶんと仮定）`),
    waveHeight: mm(10, 'provisional', UNCONFIRMED5),
    waveCount: cnt(2, 'provisional', `${UNCONFIRMED5}（山の数は仮）`),
    laneChangeLength: mm(1200, 'provisional', `${UNCONFIRMED5}（直線2枚ぶんと仮定）`),
    laneChangeRise: mm(80, 'provisional', UNCONFIRMED5),
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
