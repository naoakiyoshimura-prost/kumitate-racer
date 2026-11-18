// 同じ「直線→スロープ上り」でも、コースの中の位置（書き出しの点の並び方）で当たり量が変わるかの確認
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild } from '../src/setup';
import { build as buildLayout } from '../src/editor/geom';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
const S: PieceSpec = { type: 'straight', frac: 1 };
const Q: PieceSpec = { type: 'straight', frac: 0.25 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const U: PieceSpec = { type: 'slopeUp' }, D: PieceSpec = { type: 'slopeDown' };
const A = [S, U, D, S, Q, U, D, S, Q, Q, U, D, S, Q, Q, Q, U, D];
const B = Array(A.length).fill(S);
const lay = { version: 1 as const, name: 'v', lanes: 3 as const, pieces: [...A, S, L, L, L, L, ...A.map((p) => (p.type === 'slopeUp' || p.type === 'slopeDown' ? S : p)), S, L, L, L, L] as PieceSpec[] };
const bl = buildLayout(lay);
console.log('closed', bl.check.closed);
const course = toCourse(lay);
const track = new Track(course);
const t = applyBuild(tuning as unknown as Tuning, defaultBuild());
const car = new CarState(track, t, 1, () => 0.5);
let acc = 0;
const starts: number[] = [];
bl.placed.forEach((p, i) => { if (p.spec.type === 'slopeUp' && i < A.length) starts.push(acc); acc += p.length; });
for (const [side, e] of [['front', 14], ['rear', 48]] as const) {
  const out = starts.map((s0) => {
    let mx = -9;
    for (let d = -300; d <= 700; d += 2) mx = Math.max(mx, car.spongeApproach(side, e, (s0 + d) * MM_TO_GAME));
    return mx.toFixed(2);
  });
  console.log(side, e, 'mm: 各スロープ上りの谷での近づく量の最大', out.join(' / '));
}
