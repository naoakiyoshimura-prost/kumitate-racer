// テストプレイ（セッティング）のテストコース3種（2026-11-19 店長「テストコースは3種くらいでいいかな、一周45〜50メートルくらい」）。
// どれも3レーンと5レーンで走れる。形は「左180度ターン2つのオーバル」を土台に、直線側へ見どころの区間を置き、
// 足りない長さは直線で埋めて1周45〜50m（実寸）にそろえる。部品の寸法はエディタの表のまま（仮の値を含む）
import { build } from './editor/geom';
import type { Layout, LaneCount, PieceSpec } from './editor/types';

const S: PieceSpec = { type: 'straight', frac: 1 }, H: PieceSpec = { type: 'straight', frac: 0.5 }, Q: PieceSpec = { type: 'straight', frac: 0.25 };
const C: PieceSpec = { type: 'corner', dir: 'L' }, R: PieceSpec = { type: 'corner', dir: 'R' };
const L4 = [C, C, C, C];
const U: PieceSpec = { type: 'slopeUp' }, D: PieceSpec = { type: 'slopeDown' };
const LC: PieceSpec = { type: 'laneChange' }, W: PieceSpec = { type: 'wave' }, HU: PieceSpec = { type: 'hump' }, BU: PieceSpec = { type: 'bump' };
const A20: PieceSpec = { type: 'bankApproach' }, A30: PieceSpec = { type: 'bankApproach', deg: 30 };
const GJ: PieceSpec = { type: 'gapJump' };
const DU: PieceSpec = { type: 'slopeUp', drop: true }, DD: PieceSpec = { type: 'slopeDown', drop: true };
const MU: PieceSpec = { type: 'slopeUp', mountain: true }, MD: PieceSpec = { type: 'slopeDown', mountain: true };
// 外側（右）へふくらむ寄り道: 右90度→直線→左90度→直線k→左90度→直線→右90度（右コーナーのローラーも試せる）
const bulge = (k: number): PieceSpec[] => [R, R, S, C, C, ...Array(k).fill(S), C, C, S, R, R];

export type TestCourseId = 'tc1' | 'tc2' | 'tc3';
export const TEST_COURSES: { id: TestCourseId; name: string; note: string }[] = [
  { id: 'tc1', name: 'テスト1 ベーシック', note: 'レーンチェンジ・ウェーブ・こぶ・スロープ、外へふくらむ右コーナー' },
  { id: 'tc2', name: 'テスト2 ジャンプ', note: 'スロープの後すぐコーナー（両側）・切れ目ジャンプ・大坂・大山。ブレーキの有無で分かれる' },
  { id: 'tc3', name: 'テスト3 バンク', note: '20度と30度のバンクの後にスロープ。バンクで当てず、スロープで当てる' },
];

// 直線側A（スタートから）・B（反対側）とターン2つ。5レーンでは長さが直線の1/2に少し足りない部品（スロープ・ウェーブ・切れ目ジャンプ）があるので、両側で数をそろえてある
function sides(id: TestCourseId, lanes: LaneCount): [PieceSpec[], PieceSpec[], PieceSpec[], PieceSpec[]] {
  const three = lanes === 3;
  if (id === 'tc1') return [[S, LC, S, W, S, U, D, S, ...bulge(three ? 6 : 3), S], [S, HU, S, BU, S, U, D, S, W, S, ...bulge(three ? 4 : 2), S], L4, L4];
  // テスト2は「スロープの後、少しの直線ですぐコーナー」を両側に置く（店長の実物の目安: 上り→下り→直線3枚でノーブレーキの速い車は飛び出し、ブレーキを当てると収まる）。
  // ブーストなしの最速マシンはノーブレーキで上りの入口から約6.9枚（3レーンの直線1枚=540mmで数えて）飛ぶので、着地がコーナーにかかる
  if (id === 'tc2') return three
    ? [[GJ, D, S, S, S, S, U, D, S, S, S], [DU, S, DD, S, S, MU, S, MD, S, S, U, D, S, S, S], L4, L4]
    : [[GJ, D, S, S, U, D, S, H], [DU, S, DD, S, MU, S, MD, W, W, S, U, D, S, H], L4, L4];
  return [[S, U, D, S, S, ...bulge(three ? 4 : 2), S], [S, LC, S, U, D, S], [A20, ...L4, A20], [A30, ...L4, A30]];
}

function forward(lanes: LaneCount, ps: PieceSpec[]): number {
  const b = build({ version: 1, name: 'x', lanes, pieces: [{ type: 'start' }, ...ps] });
  return b.placed[b.placed.length - 1].end.p[0] - b.placed[0].end.p[0];
}

const cache = new Map<string, Layout>();
export function testCourseLayout(id: TestCourseId, lanes: LaneCount): Layout {
  const key = `${id}:${lanes}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [A, B, T1, T2] = sides(id, lanes);
  const t = TEST_COURSES.find((c) => c.id === id)!;
  let a = [...A], b = [...B];
  // 両側の前への長さをそろえる（スタート1枚はA側に入る）
  const unit = forward(lanes, [S]);
  const diff = forward(lanes, a) + unit - forward(lanes, b);
  let n = Math.round(Math.abs(diff) / (unit / 4));
  const pad: PieceSpec[] = [];
  while (n >= 4) { pad.push(S); n -= 4; }
  if (n >= 2) { pad.push(H); n -= 2; }
  if (n >= 1) pad.push(Q);
  // 足す直線は各側の頭に置く（ターン直前の区間の並びを変えないため）
  if (diff > 0) b = [...pad, ...b]; else a = [...pad, ...a];
  // 1周45m以上になるまで両側に直線を足す
  let lay: Layout = { version: 1, name: `${t.name}（${lanes}レーン）`, lanes, pieces: [] };
  for (let k = 0; k < 80; k++) {
    lay = { ...lay, pieces: [{ type: 'start' }, ...Array(k).fill(S), ...a, ...T1, ...Array(k).fill(S), ...b, ...T2].map((p) => ({ ...p })) };
    if (build(lay).check.totalLengthMm >= 45000) break;
  }
  cache.set(key, lay);
  return lay;
}
