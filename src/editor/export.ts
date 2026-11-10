// コースエディタの Layout → ゲームの CourseData（src/track.ts の型）。three に依存しない。
import type { CourseData } from '../track';
import type { Layout } from './types';
import { build } from './geom';
import { dim } from './catalog';

// 実寸 mm → ゲームの m の係数（1か所だけ）。
// 車体の縮尺に合わせる: ゲームの車は全長 3.38m、実寸の想定は 165mm → 3.38 / 165 m/mm（約 20.5倍）。
// こうするとレーン幅 115mm は 2.36m になり、車幅との比（レーン115mm に対して車幅 約105mm）が実物に近くなる。
// 以前は仕切りレーン 3.6m に合わせた約31.3倍だった（tools/customsim.ts で両方を比べられる）
export const MM_TO_GAME = 3.38 / 165;
export const MM_TO_GAME_WIDE = 3.6 / 115;

const POINT_STEP_M = 2; // 書き出す点の間隔（m）。ウェーブの小さな山がスプラインでつぶれない程度に細かく

const r2 = (v: number) => Math.round(v * 100) / 100;

export function toCourse(layout: Layout, id = 'custom', scale = MM_TO_GAME): CourseData {
  const { placed, check } = build(layout);
  if (!check.closed) throw new Error('コースが閉じていないので書き出せません（build().check.closed を確認してください）');
  const k = scale;

  // 中心線の点列を間引く。[x, z, 高さ]。最後の点は最初の点と重ねない
  // バンクの横傾き（u の傾き）はゲーム側が未対応なので渡さない。高さだけ渡す
  const points: [number, number, number][] = [];
  let dist = 0; // 中心線に沿った距離（m）
  let lastAt = -Infinity;
  let prev: [number, number, number] | null = null;
  const pieceStart: number[] = [];
  for (const p of placed) {
    pieceStart.push(dist);
    for (const s of p.samples) {
      const q: [number, number, number] = [s.p[0] * k, s.p[2] * k, s.p[1] * k];
      if (prev) dist += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
      prev = q;
      if (dist - lastAt >= POINT_STEP_M - 1e-9) {
        points.push([r2(q[0]), r2(q[1]), r2(q[2])]);
        lastAt = dist;
      }
    }
  }
  // 最後の点がスタートに近すぎれば外す（閉じた曲線として扱うので重ねない）
  while (points.length > 3) {
    const a = points[points.length - 1];
    const b = points[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < POINT_STEP_M * 0.5) points.pop();
    else break;
  }

  const lanes = layout.lanes;
  const course: CourseData = {
    id,
    name: layout.name || 'エディタのコース',
    note: `コースエディタで作成（${lanes}レーン・1周 ${(check.totalLengthMm / 1000).toFixed(2)}m 実寸）`,
    lanes,
    walledLanes: lanes,
    laps: Math.max(2, check.lapsToReturn),
    width: r2(dim(lanes, 'laneWidth') * k * lanes),
    wallHeight: r2(dim(lanes, 'wallHeight') * k),
    points,
  };

  // レーンチェンジ → 立体交差（ゲームは1コースに1か所だけ対応: crossover は1つ）
  const lc = placed.filter((p) => p.spec.type === 'laneChange');
  if (lc.length) {
    const p = lc[0];
    course.crossover = { at: r2(pieceStart[p.index]), length: r2(p.length * k), height: r2(dim(lanes, 'laneChangeRise') * k) };
    if (lc.length > 1) course.note += `。注意: レーンチェンジ${lc.length}個のうちゲームに渡せるのは最初の1個だけ（ゲームは立体交差1か所まで）`;
  }
  return course;
}
