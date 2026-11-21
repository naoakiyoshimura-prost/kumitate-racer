// ねじれ輪チェンジ（twistChange）の輪の通り道。three に依存しない純粋な計算（エディタの表示・書き出し・テストで共通）。
// 2026-11-16 店長「作りたいね、3レーン版も」。形は店長の説明（同日）「ただのコーナーとストレートの組み合わせ」「一番右レーンから、ストレート → 左へ180度 → ストレート → 左に210度くらい → ストレート → 右に30度 でLCJの接続に戻る」。
// 直線の長さと高さは店長の情報に無いので推定（下の ringPath の説明）。形はこの関数1つにまとめてある。
// 座標は部品の入口の姿勢で: x = 前、y = 上、z = 右（mm）。bank = 路面の横傾き（度、+ で右側が高い）
import { dim, lanePitch } from './catalog';
import type { LaneCount } from './types';

export interface RingPath {
  pts: [number, number, number][]; // [前, 上, 右]
  bank: number[]; // 点ごとの横傾き（度）
  length: number; // 輪の通り道の長さ（mm）
}

const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
// 入口・出口の向きが前（+x）の S 字（3次エルミート、z だけ曲げる）
const hermiteZ = (z0: number, z1: number, u: number) => z0 + (z1 - z0) * (3 * u * u - 2 * u * u * u);

export function ringPath(lanes: LaneCount, ov?: Record<string, number>, step = 20): RingPath {
  // 2026-11-16 店長「ねじれてるように見えて、ただのコーナーとストレートの組み合わせ」「一番右レーンから、ストレート → 左へ180度ターン →
  // ストレート → 左に210度くらいターン → ストレート → 右に30度 で接続に戻る」。ターンは普通のコーナーと同じ平らな路面（横傾きなし）。
  // 直線の長さは店長の情報に無いので計算で決める（推定）: 最初のターンは部品の終わりに接し（L1 = X − R）、2つ目のターンは部品の入口に接して
  //   最初の直線の真上を横切り（L2）、斜めの直線 L3 は横のずれから、右30度のあとの直線 L4（店長の「LCJの接続に戻る」まで）で部品の終わりに着く。
  const X = dim(lanes, 'twistLength', ov);
  const R = dim(lanes, 'twistRadius', ov); // ターンの半径（輪の中心線）
  const top = dim(lanes, 'twistTop', ov); // 一番高い所（2つ目のターンが最初の直線の真上を通る所）
  const E = ((lanes - 1) / 2) * lanePitch(lanes, ov); // 端のレーンの中心の横位置
  const A2 = (210 * Math.PI) / 180, A3 = (30 * Math.PI) / 180;
  const s3 = Math.sin(A3), c3 = Math.cos(A3);
  // 向き θ（0 = 前、左回りで増える）。進む向き d = (cosθ, −sinθ)、左の法線 n = (−sinθ, −cosθ)（x, z）
  const run = (L1: number, L2: number, L3: number, L4: number, emit?: (x: number, z: number, s: number) => void) => {
    let x = 0, z = E, th = 0, s = 0;
    const line = (L: number) => { const m = Math.max(1, Math.ceil(L / step)); for (let i = 1; i <= m; i++) { const u = L / m; x += Math.cos(th) * u; z -= Math.sin(th) * u; s += u; emit?.(x, z, s); } };
    const turn = (A: number, left: boolean) => {
      const sg = left ? 1 : -1;
      const cx = x + sg * R * -Math.sin(th), cz = z + sg * R * -Math.cos(th);
      const m = Math.max(2, Math.ceil((R * A) / step));
      for (let i = 1; i <= m; i++) { const t2 = th + (sg * A * i) / m; x = cx - sg * R * -Math.sin(t2); z = cz - sg * R * -Math.cos(t2); s += (R * A) / m; emit?.(x, z, s); }
      th += sg * A;
    };
    line(L1); turn(Math.PI, true); line(L2); turn(A2, true); line(L3); turn(A3, false); line(L4);
    return { x, z, s };
  };
  // 直線0での出口から L3（横のずれ）→ L1・L2 を決める
  const e0 = run(0, 0, 0, 0);
  const L3 = Math.max(0, (e0.z + E) / s3);
  const L1 = Math.max(0, X - R);
  const L2 = Math.max(0, L1 - R); // 2つ目のターンの中心を x = R に（入口に接する）
  const L4 = Math.max(0, X - e0.x - L1 + L2 - L3 * c3); // 出口を x = X に
  const sPeak = L1 + Math.PI * R + L2 + Math.PI * R; // 2つ目のターンが最初の直線の真上（右端）に来る所
  const raw: [number, number, number][] = [[0, 0, E]];
  const total = run(L1, L2, L3, L4).s;
  run(L1, L2, L3, L4, (x, z, s) => raw.push([x, s, z]));
  // 高さ: 最初の直線で h1 まで上がり（最初のターンがコースの上を横切るので下のレーンの車の上を通れる高さ）、2つ目のターンが最初の直線の真上に来る所（sPeak）で一番高く、
  // そこから出口まで下りる（最後の直線 L4 は最初のターンの下をくぐる）
  const h1 = top * 0.55;
  const hAt = (s: number) => (s <= L1 ? h1 * smooth(0, L1, s) : s <= sPeak ? h1 + (top - h1) * smooth(L1, sPeak, s) : top * (1 - smooth(sPeak, total, s)));
  const pts: [number, number, number][] = raw.map(([x, s, z]) => [x, hAt(s), z]);
  pts[0][1] = 0;
  const last = pts[pts.length - 1];
  last[0] = X; last[1] = 0; last[2] = -E; // 計算の丸めを消す
  const bank = pts.map(() => 0); // 普通のコーナーと同じ平らな路面
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return { pts, bank, length };
}

// 輪の中で、斜めに横切る線（1）と、下りの左の線（5）が上から見て重なる所の高さの差の最小（mm）。下を通る車と当たらない目安
export function ringClearance(path: RingPath): number {
  const { pts } = path;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 40; j < pts.length; j++) {
    const dx = pts[i][0] - pts[j][0], dz = pts[i][2] - pts[j][2];
    if (dx * dx + dz * dz < 60 * 60) best = Math.min(best, Math.abs(pts[i][1] - pts[j][1]));
  }
  return best;
}
