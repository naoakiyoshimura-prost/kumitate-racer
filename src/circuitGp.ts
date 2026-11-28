// 8の字グランプリ（試作、2026-11-18 店長の依頼）: サーキット式の「外壁のみ」で走る、立体交差のある8の字の大きいコース。
// 実在のコースの名前・コーナー名・ロゴは使わない（画面の名前も仮名）。形はおおまかな特徴（8の字の立体交差、連続S字、
// ヘアピン、大きく回り込む2段のコーナー、高速の左コーナー、シケイン）を、直線と円弧の組み合わせで描いた簡略版。
// 公開する段階では形もオリジナルに直す前提（店長判断）。
// 単位: 区間は「実寸の長さ(m)と曲がる角度(度、+が右)」。ゲームの縮尺は 1m → 100mm（ミニ四駆の世界）で、幅はビッグ1周と同じ（5レーンの2倍）
import type { CourseData } from './track';
import { MM_TO_GAME } from './editor/export';

// [長さ m, 曲がる角度 度（+ 右）]。最初の区間がホームストレート（スタートはこの途中）
// ヘアピン（左125度）はゲーム補正で半径を約2倍（実寸約46m）にしてある。元の半径では標準の車がブーストなしでも毎周外壁に当たってコースアウトした
const SEGS: [number, number][] = [
  [617.2, 0], [40, 15], [50, 40], [60, 10], [130, 120], [140, 0], [100, -50], [30, 5], [70, 60], [60, 5], [110, -70], [30, -5], [30, 10],
  [130, 90], [30, 10], [50, -5], [110, -75], [200, -50], [130, -30], [130, 0], [10, 5], [40, 40], [110, 5], [10, 10], [30, 55], [10, 15],
  [250, 0], [70, 30], [60, 5], [30, -20], [100, -125], [20, -20], [20, -10], [100, 5], [150, 50], [200, 25], [200, 45], [120, 0], [30, -5],
  [70, -55], [80, -30], [110, -90], [60, -25], [380, -20], [548.2, 0], [70, -35], [100, -20], [200, -10], [70, 10], [30, 65], [20, 10],
  [10, -15], [30, -60], [20, -5], [90, 45], [80, 25], [150, 20],
];
const HEAD0 = -48.9; // スタートの向き（度）
export const GP_SCALE_MM = 100; // 実寸1m → ミニ四駆の世界で何mmか
const STEP_M = 4; // 点の間隔（実寸m、ゲームでは約8m）
const BRIDGE_MM = 450; // 立体交差の橋の高さ（mm）。下をくぐる車（高さ約40mm）に十分な余裕
const RAMP_M = 160; // 橋の上り下りの長さ（実寸m、片側）。勾配は最大4%ほどで、飛ばないように緩く

function trace(): [number, number][] {
  let x = 0, y = 0, h = (HEAD0 * Math.PI) / 180;
  const pts: [number, number][] = [[0, 0]];
  for (const [l, t] of SEGS) {
    const n = Math.max(1, Math.round(l / STEP_M));
    const a = (-t * Math.PI) / 180 / n;
    for (let k = 0; k < n; k++) {
      h += a / 2;
      x += (Math.cos(h) * l) / n;
      y += (Math.sin(h) * l) / n;
      h += a / 2;
      pts.push([x, y]);
    }
  }
  pts.pop(); // 最後の点はスタートと同じ
  return pts;
}

// 自分自身と交わる所（立体交差）を探す: [先に通る側の点番号, 後に通る側の点番号]
function crossing(p: [number, number][]): [number, number] | null {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    for (let j = i + 10; j < n - 10 + Math.min(i, 10); j++) {
      const c = p[j % n], d = p[(j + 1) % n];
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      if (Math.abs(den) < 1e-9) continue;
      const u = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
      const v = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) return [i, j % n];
    }
  }
  return null;
}

// width: 5レーンのコース幅（ゲームの m）。幅は widthMul 倍して使う
export function gpCourse(baseWidth: number, widthMul: number, steps: number): CourseData {
  const p = trace();
  const k = GP_SCALE_MM * MM_TO_GAME; // 実寸m → ゲームの m
  const x = crossing(p);
  // 後から通る側（2段コーナーのあとの長い直線）を橋にして持ち上げる。なめらかに上げ下げ（端で傾きが0）
  const over = x ? x[1] : -1;
  const n = p.length;
  const rampPts = RAMP_M / STEP_M;
  const H = BRIDGE_MM * MM_TO_GAME;
  const height = (i: number) => {
    if (over < 0) return 0;
    let d = Math.abs(i - over);
    d = Math.min(d, n - d);
    const flat = 2; // 交わる所の前後は平らに
    if (d <= flat) return H;
    const r = (d - flat) / rampPts;
    if (r >= 1) return 0;
    return H * (0.5 + 0.5 * Math.cos(Math.PI * r));
  };
  const points = p.map(([px, py], i) => [Math.round(px * k * 100) / 100, Math.round(-py * k * 100) / 100, Math.round(height(i) * 1000) / 1000] as [number, number, number]);
  return {
    id: 'custom',
    name: '8の字グランプリ（試作）',
    width: baseWidth * widthMul,
    lanes: steps,
    laps: 1,
    circuitKind: 'big',
    laneless: true,
    circuit: true,
    points,
  } as CourseData;
}
