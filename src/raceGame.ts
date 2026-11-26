// レースゲームモードの試作コース（2026-11-26 店長「こんな感じのレイアウトをレースゲームモードでつくれる？」「左下の一回回ってるところは、
// トルネードバンクで上昇しながら駆け抜ける」「メインストレートからトルネードバンクを抜けるまでブースト全開、27秒」「トップスピードは700km」）。
// 形はオリジナル: 店長の見せた図の「長いメインストレート → 上りながら1回転 → 中高速コーナーとS字 → ストレートへ戻る」という流れだけを借り、
// 線は写していない。作品名・コース名・ロゴは画面にもコードにも書かない。参考の画像はリポジトリに入れない。
// 単位: 区間は [長さ m, 曲がる角度 度（+ が右）]。コースの1mはゲームの1m（車体3.38mを実車の大きさと見る）
import type { CourseData } from './track';
import { miniCfg } from './mini';

type Seg = [number | 'MAIN' | 'A' | 'B', number];
const MAIN_M = 1000; // メインストレート
const HELIX_RISE = 25; // 上昇トルネードで上がる高さ（m）
const SEGS: Seg[] = [
  ['MAIN', 0],
  [500, -18], // ゆるい左の高速キンク
  [250, 0],
  [2450, -360], // 上昇トルネード（左回り360度、半径約390m）。抜けた所は入口の道の真上（高さ HELIX_RISE）
  [180, 0],
  [520, 95], // 右の高速スイーパー
  ['A', 0], // 左側の直線（閉じるように長さを計算）
  [300, 40], [120, 0], [260, -55], [120, 0], [240, 50], // 左側のS字
  [350, 70],
  [300, 0], [380, -45], [250, 0], [520, 90], [250, 0], [380, -45], // 上側の高速S
  ['B', 0], // 上側の直線（閉じるように長さを計算）
  [420, 110], // 右の中速コーナー
  [200, 0], [260, -60], [180, 55], [150, 0],
  [400, 73], // 最終コーナー → メインストレート
];
const HELIX = 3; // 上昇トルネードの区間の番号
const STEP_M = 8; // 点の間隔（m）

function trace(segs: [number, number][]): { pts: [number, number][]; seg: number[] } {
  let x = 0, y = 0, h = Math.PI; // 西向きにスタート
  const pts: [number, number][] = [[0, 0]];
  const seg: number[] = [0];
  segs.forEach(([l, t], si) => {
    const n = Math.max(1, Math.round(l / STEP_M));
    const a = (-t * Math.PI) / 180 / n;
    for (let k = 0; k < n; k++) {
      h += a / 2;
      x += (Math.cos(h) * l) / n;
      y += (Math.sin(h) * l) / n;
      h += a / 2;
      pts.push([x, y]);
      seg.push(si);
    }
  });
  return { pts, seg };
}
const fill = (a: number, b: number): [number, number][] => SEGS.map(([l, t]) => [l === 'MAIN' ? MAIN_M : l === 'A' ? a : l === 'B' ? b : l, t]);
// A・B の長さを、周回の終わりがスタートに戻るように決める（終点は2本の長さに対して線形）
function solve(): [number, number] {
  const end = (a: number, b: number) => { const p = trace(fill(a, b)).pts; return p[p.length - 1]; };
  const e0 = end(0, 0), ea = end(1, 0), eb = end(0, 1);
  const m = [[ea[0] - e0[0], eb[0] - e0[0]], [ea[1] - e0[1], eb[1] - e0[1]]];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  return [(-e0[0] * m[1][1] + e0[1] * m[0][1]) / det, (-e0[1] * m[0][0] + e0[0] * m[1][0]) / det];
}

export const rgCfg = (miniCfg as unknown as { circuit: { rg: RgCfg } }).circuit.rg;
export interface RgCfg {
  top: number[]; accel: number[]; fullSec: number; unlock: number[]; charge: number[]; drainMul: Record<string, number>;
  regenSec: number; minEn: number; stages: number; gripMul: number; bank: number; laps: number; widthMul: number; steps: number;
}

export function rgCourse(baseWidth: number): CourseData {
  const [a, b] = solve();
  const { pts, seg } = trace(fill(a, b));
  pts.pop();
  seg.pop();
  const n = pts.length;
  // 高さ: 上昇トルネードで 0→HELIX_RISE、抜けたあと下りの区間（スイーパーから左側のS字の終わりまで）でなめらかに 0 へ
  const first = seg.indexOf(HELIX), last = seg.lastIndexOf(HELIX);
  const downTo = seg.lastIndexOf(11);
  const ease = (r: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, r)));
  const height = (i: number) => {
    if (i >= first && i <= last) return (HELIX_RISE * (i - first)) / (last - first); // 一定の上り（約1%）
    if (i > last && i <= downTo) return HELIX_RISE * (1 - ease((i - last) / (downTo - last)));
    return 0;
  };
  // 横傾き: 上昇トルネードの中だけ（左回りなので左が低い＝右側が高い +）。入口と出口の80mでなめらかに
  const rampPts = 80 / STEP_M;
  const bank = pts.map((_, i) => {
    if (i < first || i > last) return 0;
    const r = Math.min(1, (i - first) / rampPts, (last - i) / rampPts);
    return Math.round(rgCfg.bank * ease(r) * 100) / 100;
  });
  return {
    id: 'custom',
    name: 'レースゲーム（試作）',
    width: baseWidth * rgCfg.widthMul,
    lanes: rgCfg.steps,
    laps: rgCfg.laps,
    circuitKind: 'rg',
    laneless: true,
    circuit: true,
    points: pts.map(([x, y], i) => [Math.round(x * 100) / 100, Math.round(-y * 100) / 100, Math.round(height(i) * 1000) / 1000] as [number, number, number]),
    bank,
  } as CourseData;
}
