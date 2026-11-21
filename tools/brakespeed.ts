// 進入速度ごとに、スロープ1回で失う速さ（ブレーキ）と当たっていた時間を比べる（2026-11-18 店長「速度に応じて効いたり効かなかったり？」）
// ゲームと同じ刻み（mini.json speed.maxStep）で、刻みの位置（位相）を変えて10通り走らせ、ばらつきも出す。速さは固定（減速は足し上げるだけ）
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning, spongePlaceMm } from '../src/car';
import { applyBuild, defaultBuild } from '../src/setup';
import { build as buildLayout } from '../src/editor/geom';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const L4 = [L, L, L, L];
const pieces: PieceSpec[] = [S, S, S, S, { type: 'slopeUp' }, { type: 'slopeDown' }, ...Array(8).fill(S), ...L4, ...Array(14).fill(S), ...L4];
const lay = { version: 1 as const, name: 'bs', lanes: 3 as const, pieces };
const bl = buildLayout(lay);
const course = toCourse(lay);
if (process.env.BS_OLD) delete (course as any).fine;
const track = new Track(course);
const t = applyBuild(tuning as unknown as Tuning, { ...defaultBuild(), brakeF: 'mid-strong-mid', brakeR: 'mid-strong-mid' });
const k = t.brake!;
const mul = (mini as any).brake.strengthMul;
const car = new CarState(track, t, 1, () => 0.5);
const up = bl.placed.slice(0, 4).reduce((a, p) => a + p.length, 0) * MM_TO_GAME;
const dt = (mini as any).speed.maxStep;
for (const v of [10, 15, 20, 25, 30, 35]) {
  const res = [];
  for (let ph = 0; ph < 10; ph++) {
    let s = up - 3 + (ph / 10) * v * dt, loss = 0, time = 0;
    while (s < up + 6) {
      let l = 0, hit = false;
      // ゲーム（car.ts updateSponge）と同じく1コマの中を区切って平均。BS_NOSUB=1 で区切らない（v94 まで）
      const n = process.env.BS_NOSUB ? 1 : Math.min(8, Math.max(1, Math.ceil((v * dt) / 0.1)));
      for (const side of ['front', 'rear'] as const) {
        const b = side === 'front' ? t.car.brakeF! : t.car.brakeR!;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += Math.max(0, car.spongeApproach(side, spongePlaceMm(k, side, b), process.env.BS_NOSUB ? s : s + v * dt * ((i + 0.5) / n)) - car.spongeGap(b, side));
        if (sum > 0) { hit = true; l += (sum / n) * k.strength[side][b.strength] * mul * (side === 'front' ? 1 + k.frontDrag : 1); }
      }
      loss += l * (v / k.refSpeed) ** k.speedExp * dt;
      if (hit) time += dt;
      s += v * dt;
    }
    res.push([loss, time]);
  }
  const ls = res.map((r) => r[0]), ts = res.map((r) => r[1]);
  const avg = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
  console.log(`進入 ${v}m/s: 失う速さ 平均${avg(ls).toFixed(2)} [${Math.min(...ls).toFixed(2)}〜${Math.max(...ls).toFixed(2)}]m/s (${(avg(ls) / v * 100).toFixed(0)}%)  当たっている時間 ${(avg(ts) * 1000).toFixed(0)}ms = ${(avg(ts) / dt).toFixed(1)}コマ`);
}
