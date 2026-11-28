// 「コーナー→スロープ上り」と「直線→スロープ上り」でブレーキの当たり方・効き方・飛距離が違うかの確認（2026-11-18 店長「コーナーからスロープ上りの時にきいてない」）
// BC_OLD=1 で細かい点列なし（v94 までの計算）
import './browserstub';
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, type Build } from '../src/setup';
import { presetBuilds } from '../src/save';
import { build as buildLayout } from '../src/editor/geom';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const U: PieceSpec = { type: 'slopeUp' }, D: PieceSpec = { type: 'slopeDown' };
const S8 = Array(8).fill(S);
const L4 = [L, L, L, L];
const pieces: PieceSpec[] = [S, S, S, S, U, D, ...S8, ...L4, U, D, ...S8, S, S, S, S, ...L4];
const lay = { version: 1 as const, name: 'bc', lanes: 3 as const, pieces };
const bl = buildLayout(lay);
if (!bl.check.closed) throw new Error('not closed');
const course: CourseData = { ...toCourse(lay), laps: 6 };
if (process.env.BC_OLD) delete (course as any).fine;
let acc = 0; const ups: number[] = [];
bl.placed.forEach((p) => { if (p.spec.type === 'slopeUp') ups.push(acc * MM_TO_GAME); acc += p.length; });
const PIECE = 540 * MM_TO_GAME;
const NAME = ['直線→スロープ', 'コーナー→スロープ'];
// tools/jumpcheck.ts と同じ miniTune の写し（ブレーキ・空中だけで十分）
function miniLike(t: Tuning): Tuning {
  const mc = mini as any;
  const sc = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * mc.brake.strengthMul]));
  return { ...t, air: { ...t.air, flightGravityMul: mc.jump.gravityMul, airSpeedMul: mc.jump.airSpeedMul, flyOut: { width: mc.flyOut.width, load: mc.flyOut.load }, steep: { climbMin: mc.steep.climbMin, noCrestSlope: mc.steep.noCrestSlope, noCrestUp: mc.steep.noCrestUp } } as any,
    brake: t.brake && { ...t.brake, strength: { front: sc(t.brake.strength.front), rear: sc(t.brake.strength.rear) } as any } };
}
const P = presetBuilds();
const base: Build = { ...P[4] };
for (const [bn, f, r] of [['ブレーキなし', undefined, undefined], ['前後 中強中', 'mid-strong-mid', 'mid-strong-mid'], ['前後 中弱中', 'mid-weak-mid', 'mid-weak-mid']] as const) {
  const t = miniLike(applyBuild(tuning as unknown as Tuning, { ...base, brakeF: f, brakeR: r }));
  const track = new Track(course);
  const car = new CarState(track, t, 1, () => 0.5);
  const st = ups.map(() => ({ maxF: 0, maxR: 0, loss: 0, v0: 0, land: [] as number[], n: 0 }));
  let time = 0, wasAir = false, from = -1, lastLoss = 0;
  while (car.lap <= 6 && time < 600) {
    car.update(mini.speed.maxStep ?? 1 / 60); time += mini.speed.maxStep ?? 1 / 60;
    ups.forEach((u, i) => {
      const rel = (car.distance - u + track.length) % track.length;
      const s = st[i];
      if (rel < 1.5 * PIECE) {
        if (rel < 0.02 * PIECE && !car.airborne) s.v0 = car.speed;
        s.maxF = Math.max(s.maxF, car.spongeContactF); s.maxR = Math.max(s.maxR, car.spongeContactR);
        s.loss += car.spongeLoss - lastLoss;
        if (car.airborne && !wasAir) { from = i; s.n++; }
      }
      if (from === i && !car.airborne && wasAir) { s.land.push(rel / PIECE); from = -1; }
    });
    lastLoss = car.spongeLoss; wasAir = car.airborne;
  }
  console.log(`■ ${bn}`);
  st.forEach((s, i) => console.log(`  ${NAME[i].padEnd(10)} 入口の速さ ${s.v0.toFixed(2)}  最大当たり 前${s.maxF.toFixed(2)} 後${s.maxR.toFixed(2)}mm  減速 ${(s.loss / 6).toFixed(2)}m/s/周  着地 ${s.land.map((x) => x.toFixed(1)).join(',')}枚  コースアウト計${car.courseOuts}`));
}
