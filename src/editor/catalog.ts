// コースエディタの寸法表（実寸 mm / 度）。three に依存しない純粋なデータ。
// 出典の区別が最重要: official=メーカー公表（note に URL）、estimated=公表値から計算（note に式）、provisional=仮の値。
// 3レーンと5レーンは別の表。5レーンは何も確認できていないので全部 provisional（3レーンの値を黙って流用しない）。
import type { Dim, LaneCount } from './types';

const URL_LANE = 'https://tamiya.com/japan/products/69578/index.html';
const URL_BASIC = 'https://tamiya.com/japan/mini4wd/feature/2019/1206.html';

const mm = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'mm', source, note });
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
        '検算: 外寸の長辺 約3.1m なら直線部 3100−1400 = 1700、中心線1周 2×1700 + 2π×517.5 ≈ 6652、3周 ≈ 20.0m（公表「3周20m」と一致）',
    ),
    cornerAngle: deg(45, 'provisional', '1枚45度として扱う（エディタの前提。公式ページで未確認）'),
    slopeRise: mm(110, 'provisional', '店長指定の基準。部品資料との照合は未了'),
    slopeLength: mm(1080, 'provisional', '仮。直線2枚ぶんの長さと仮定'),
    bankAngle: deg(20, 'official', `バンクアプローチの角度 20度。${URL_BASIC}`),
    bankLength: mm(540, 'provisional', '仮。バンクの入口・戻り1個の中心線の長さ（直線1枚ぶんと仮定）'),
    waveLength: mm(540, 'provisional', '仮。直線1枚ぶんの長さと仮定'),
    waveHeight: mm(8, 'provisional', '仮。山の高さ（谷も同じ深さ）'),
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
    slopeRise: mm(110, 'provisional', `${UNCONFIRMED5}（店長指定の3レーンの基準を仮置き）`),
    slopeLength: mm(1200, 'provisional', `${UNCONFIRMED5}（直線2枚ぶんと仮定）`),
    bankAngle: deg(20, 'provisional', `${UNCONFIRMED5}（3レーンの公表角度を仮置き）`),
    bankLength: mm(600, 'provisional', `${UNCONFIRMED5}（直線1枚ぶんと仮定）`),
    waveLength: mm(600, 'provisional', `${UNCONFIRMED5}（直線1枚ぶんと仮定）`),
    waveHeight: mm(10, 'provisional', UNCONFIRMED5),
    laneChangeLength: mm(1200, 'provisional', `${UNCONFIRMED5}（直線2枚ぶんと仮定）`),
    laneChangeRise: mm(80, 'provisional', UNCONFIRMED5),
  },
};

// 値だけ（無いキーは例外: 打ち間違いを黙って0にしない）
export function dim(lanes: LaneCount, key: string): number {
  const d = CATALOG[lanes]?.[key];
  if (!d) throw new Error(`寸法表に ${lanes}レーンの ${key} がありません`);
  return d.value;
}

// コース全体の幅（外側の壁の外から外まで）= レーン幅×レーン数 + 外壁の厚み×2
export function trackWidth(lanes: LaneCount): number {
  return lanes * dim(lanes, 'laneWidth') + 2 * dim(lanes, 'wallThickness');
}
