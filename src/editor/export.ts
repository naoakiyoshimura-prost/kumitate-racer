// コースエディタの Layout → ゲームの CourseData（src/track.ts の型）。three に依存しない。
import type { CourseData } from '../track';
import type { Frame, Layout } from './types';
import { build, right, bankDims } from './geom';
import { dim } from './catalog';

// 実寸 mm → ゲームの m の係数（1か所だけ）。
// 車体の縮尺に合わせる: ゲームの車は全長 3.38m、実寸の想定は 165mm → 3.38 / 165 m/mm（約 20.5倍）。
// こうするとレーン幅 115mm は 2.36m になり、車幅との比（レーン115mm に対して車幅 約105mm）が実物に近くなる。
// 以前は仕切りレーン 3.6m に合わせた約31.3倍だった（tools/customsim.ts で両方を比べられる）
export const MM_TO_GAME = 3.38 / 165;
export const MM_TO_GAME_WIDE = 3.6 / 115;

const POINT_STEP_M = 2; // 書き出す点の間隔（m）。ウェーブの小さな山がスプラインでつぶれない程度に細かく

const r2 = (v: number) => Math.round(v * 100) / 100;

// 姿勢 → 路面の横傾き（度、+ は進行方向の右側が高い）。ゲームの CourseData.bank の向きと同じ。
// 坂（前後の傾き）と分けるため、水平な右向き nh と「横傾きなしの路面の上向き」lift を基準に、路面の右向きがどれだけ起きているかを測る
export function bankDeg(fr: Frame): number {
  const [fx, fy, fz] = fr.f;
  // nh = f × 上(0,1,0) を水平にしたもの
  const hl = Math.hypot(fx, fz) || 1;
  const nh: [number, number, number] = [-fz / hl, 0, fx / hl];
  // lift = nh × f
  const lift: [number, number, number] = [nh[1] * fz - nh[2] * fy, nh[2] * fx - nh[0] * fz, nh[0] * fy - nh[1] * fx];
  const r = right(fr);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.atan2(dot(r, lift), dot(r, nh)) * 180) / Math.PI;
}

const isLoop = (t: string) => t === 'loop' || t === 'laneLoop';

export function toCourse(layout: Layout, id = 'custom', scale = MM_TO_GAME): CourseData {
  const { placed: placedAll, check } = build(layout);
  if (!check.closed) throw new Error('コースが閉じていないので書き出せません（build().check.closed を確認してください）');
  const k = scale;
  const ov = layout.dims;
  // start 部品があれば、その入口をゲームの距離0（スタート＝ゴール）にする。点列・立体交差の位置・バンクの列は、
  // 部品の並びを start から回した順で作る（周回なので位置は連続）。start が無ければ最初の部品が距離0
  const si = layout.pieces.findIndex((p) => p.type === 'start');
  const placed = si > 0 ? [...placedAll.slice(si), ...placedAll.slice(0, si)] : placedAll;

  // 中心線の点列を間引く。[x, z, 高さ]。最後の点は最初の点と重ねない
  // バンクの横傾き（u の傾き）は点ごとの角度（度）として bank に渡す（全部0なら渡さない＝水平のコースと同じ）
  const points: [number, number, number][] = [];
  const bank: number[] = [];
  let dist = 0; // 中心線に沿った距離（m）
  let lastAt = -Infinity;
  let prev: [number, number, number] | null = null;
  const pieceStart: number[] = []; // 部品の番号 → その入口の距離（m）
  for (const p of placed) {
    pieceStart[p.index] = dist;
    for (const s of p.samples) {
      const q: [number, number, number] = [s.p[0] * k, s.p[2] * k, s.p[1] * k];
      if (prev) dist += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
      prev = q;
      if (dist - lastAt >= POINT_STEP_M - 1e-9) {
        points.push([r2(q[0]), r2(q[1]), r2(q[2])]);
        bank.push(isLoop(p.spec.type) ? 0 : r2(bankDeg(s)));
        lastAt = dist;
      }
    }
  }
  // 最後の点がスタートに近すぎれば外す（閉じた曲線として扱うので重ねない）
  while (points.length > 3) {
    const a = points[points.length - 1];
    const b = points[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < POINT_STEP_M * 0.5) {
      points.pop();
      bank.pop();
    } else break;
  }

  const lanes = layout.lanes;
  const course: CourseData = {
    id,
    name: layout.name || 'エディタのコース',
    note: `コースエディタで作成（${lanes}レーン・1周 ${(check.totalLengthMm / 1000).toFixed(2)}m 実寸）`,
    lanes,
    walledLanes: lanes,
    laps: Math.max(2, check.lapsToReturn),
    width: r2(dim(lanes, 'laneWidth', ov) * k * lanes),
    wallHeight: r2(dim(lanes, 'wallHeight', ov) * k),
    points,
    // 坂の頂上で自然に浮く（エディタのコースは実物に寄せる。数値は tuning air.crest の仮設定）
    crestTakeoff: true,
  };
  if (bank.some((v) => v !== 0)) course.bank = bank;

  // ループ → 専用の区間（逆さまになるので、路面の向きと走りはゲーム側が専用に扱う）
  const lps = placed.filter((p) => isLoop(p.spec.type));
  if (lps.length) course.loops = lps.map((p) => ({ at: r2(pieceStart[p.index]), length: r2(p.length * k), radius: r2(bankDims(lanes, ov).radius * k), ...(p.spec.type === 'laneLoop' ? { lane: true } : {}) }));

  // レーンチェンジ → 立体交差（ゲームは1コースに1か所だけ対応: crossover は1つ）
  const lc = placed.filter((p) => p.spec.type === 'laneChange' || p.spec.type === 'bankChange');
  if (lc.length) {
    const p = lc[0];
    course.crossover = { at: r2(pieceStart[p.index]), length: r2(p.length * k), height: r2(dim(lanes, 'laneChangeRise', ov) * k) };
    if (lc.length > 1) course.note += `。注意: レーンチェンジ（バンクチェンジを含む）${lc.length}個のうちゲームに渡せるのは最初の1個だけ（ゲームは立体交差1か所まで）`;
  }
  return course;
}
