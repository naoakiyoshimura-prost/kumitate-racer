// ねじれ輪チェンジ（twistChange）の輪の通り道。three に依存しない純粋な計算（エディタの表示・書き出し・テストで共通）。
// 2026-11-16 店長「作りたいね、3レーン版も」。実物の写真2枚と大会のコース図からの読み（推定）:
//   右端のレーンから上がって斜めにコースの上を横切り（下を走る車とは高さですれ違う）→ 奥で180度ターン → コースの外側（右）を逆向きに戻る
//   → 手前の一番高い所でもう一度180度ターン → 左の外を前へ進みながら下りて左端のレーンへ。上から見ると輪が一周する。
// 「途中で逆向きに走るか」は写真からの読みで未確定。形はこの関数1つにまとめたので、読みが変わったらここだけ直す。
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
  const X = dim(lanes, 'twistLength', ov); // 部品の長さ（直線の上を進む長さ）
  const r = Math.min(dim(lanes, 'twistRadius', ov), X / 2 - 10); // 両端の180度ターンの半径（輪の中心線）
  const top = dim(lanes, 'twistTop', ov); // 一番高い所（手前のターン）
  const B = dim(lanes, 'twistBank', ov); // ターンの頂点での横傾き（度）
  const E = ((lanes - 1) / 2) * lanePitch(lanes, ov); // 端のレーンの中心の横位置
  const xn = r, xf = X - r; // 手前・奥のターンの中心
  const hDiag = top * 0.16; // 斜めに横切り終える所の高さ（低いまま: 下りの左の線がこの上を越える）
  const hFar = top * 0.6; // 奥のターンを回り終えた所
  const pts: [number, number, number][] = [];
  const bank: number[] = [];
  const push = (x: number, y: number, z: number, b: number) => { pts.push([x, y, z]); bank.push(b); };
  const n = (len: number) => Math.max(4, Math.ceil(len / step));
  // 1) 右端のレーン → 斜めに横切って奥のターンの入口（左、z = −r）へ。高さ 0 → hDiag
  const L1 = Math.hypot(xf, E + r);
  for (let i = 0, m = n(L1); i < m; i++) { const u = i / m; push(xf * u, hDiag * smooth(0.05, 1, u), hermiteZ(E, -r, u), 0); }
  // 2) 奥のターン: 中心 (xf, 0)、左 → 奥の端 → 右。右回りなので右側が低く傾く（bank は −）。高さ hDiag → hFar
  const L2 = Math.PI * r;
  for (let i = 0, m = n(L2); i < m; i++) { const u = i / m, a = Math.PI * u; push(xf + r * Math.sin(a), hDiag + (hFar - hDiag) * smooth(0, 0.6, u), -r * Math.cos(a), -B * Math.sin(a)); } // 左端のレーンの真上（出口の着地の上）を通るまでに急いで上がる
  // 3) 右の外を逆向きに戻る: (xf, r) → (xn, r)。高さ hFar → top
  const L3 = xf - xn;
  for (let i = 0, m = n(L3); i < m; i++) { const u = i / m; push(xf - L3 * u, hFar + (top - hFar) * smooth(0, 1, u), r, 0); }
  // 4) 手前のターン: 中心 (xn, 0)、右 → 手前の端 → 左。一番高い所
  for (let i = 0, m = n(L2); i < m; i++) { const u = i / m, a = Math.PI * u; push(xn - r * Math.sin(a), top, r * Math.cos(a), -B * Math.sin(a)); }
  // 5) 左の外を前へ: (xn, −r) → 出口（左端のレーン）。最初は高いまま、奥のターンの入口（斜めの線の終わり）を上で越えてから下りる
  const L5 = X - xn;
  const dropFrom = Math.min(0.75, Math.max(0.2, (xf - xn + r * 0.5) / L5)); // 下り始め（奥のターンの入口を越えたあたり）
  for (let i = 0, m = n(L5); i <= m; i++) { const u = i / m; push(xn + L5 * u, top * (1 - smooth(dropFrom * 0.6, 1, u)), hermiteZ(-r, -E, u), 0); }
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
