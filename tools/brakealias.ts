// ブレーキの効きが周ごとにぶれるかの確認（同じセッティング・同じ並びで、周ごとのブレーキの減速と当たっていた刻みの数）
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild } from '../src/setup';
import { presetBuilds } from '../src/save';
import { build as buildLayout } from '../src/editor/geom';
import { toCourse } from '../src/editor/export';
import type { PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const L4 = [L, L, L, L];
const lay = { version: 1 as const, name: 'a', lanes: 3 as const, pieces: [S, S, S, S, { type: 'slopeUp' }, { type: 'slopeDown' }, S, S, S, S, S, S, S, S, ...L4, ...Array(14).fill(S), ...L4] as PieceSpec[] };
const course = { ...toCourse(lay), laps: 12 };
const base = tuning as unknown as Tuning;
const mc = mini as any;
const t0 = applyBuild(base, { ...presetBuilds()[4], brakeF: 'mid-strong-mid', brakeR: 'mid-strong-mid' });
const sc = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * mc.brake.strengthMul]));
const t = { ...t0, air: { ...t0.air, flightGravityMul: mc.jump.gravityMul }, brake: { ...t0.brake!, strength: { front: sc(t0.brake!.strength.front), rear: sc(t0.brake!.strength.rear) } } } as Tuning;
for (const step of [0.02, 0.005, 0.001]) {
  const car = new CarState(new Track(course), t, 1, () => 0.5);
  let lap = car.lap, lossAt = 0, steps = 0, time = 0;
  const rows: string[] = [];
  while (car.lap <= 11 && time < 900) {
    const before = car.spongeLoss;
    car.update(step);
    time += step;
    if (car.spongeLoss > before) steps++;
    if (car.lap !== lap) { rows.push(`${(car.spongeLoss - lossAt).toFixed(1)}(${steps})`); lossAt = car.spongeLoss; steps = 0; lap = car.lap; }
  }
  console.log(`刻み${step}s: 周ごとの減速m/s(当たった刻み数) ${rows.slice(1).join(' ')}`);
}
