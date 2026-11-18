// 店長の実物の目安（2026-11-18）: 最強モーター・24mm弱のタイヤでノーブレーキだとスロープの上りから6〜7枚飛ぶ。
// ブレーキを軽く当てると「スロープ上り→下り→直線×3」でコースアウトしない。ゲームで同じ並びを走らせて比べる
// 飛距離は「スロープ上りの入口から着地点まで」を直線1枚(540mm)で数える（店長の数え方）
import './browserstub';
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild, type Build } from '../src/setup';
import { build as buildLayout } from '../src/editor/geom';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const base = tuning as unknown as Tuning;
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const L4 = [L, L, L, L];
const pieces: PieceSpec[] = [S, { type: 'slopeUp' }, { type: 'slopeDown' }, S, S, S, ...L4, S, S, S, S, S, S, ...L4];
const lay = { version: 1 as const, name: 'jump', lanes: 3 as const, pieces };
const bl = buildLayout(lay);
if (!bl.check.closed) throw new Error('not closed');
const course: CourseData = { ...toCourse(lay), laps: 5 };
const lens = bl.placed.map((p) => p.length);
const upStart = lens[0] * MM_TO_GAME; // 書き出しの距離（m）。スロープ上りの入口
const PIECE = 540 * MM_TO_GAME;
const endOfStraights = lens.slice(0, 6).reduce((a, b) => a + b, 0) * MM_TO_GAME;

function miniLike(t: Tuning): Tuning {
  const m = mini.speed.boostTimeMul;
  const b = t.boost;
  const multi = b.multi && { ...b.multi, chargeTime: b.multi.chargeTime.map((v) => v * m), duration: b.multi.duration.map((v) => v * m), chainWindow: b.multi.chainWindow * m };
  return { ...t, landing: { ...t.landing, maxOutChance: t.landing.maxOutChance * mini.landingOutMul }, boost: { ...b, regen: b.regen / m, duration: b.duration * m, chargeTime: (b.chargeTime ?? 0) * m, multi } };
}
function run(t: Tuning, boost: boolean, seed: number) {
  const track = new Track(course);
  let sd = seed;
  const rand = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const car = new CarState(track, t, 1, rand);
  car.multiBoost = boost;
  const out = { lands: [] as number[], toV: [] as number[], outs: 0 };
  let wasAir = false, from = -1, time = 0;
  while (car.lap <= 5 && time < 300) {
    if (boost && !car.inCorner && !car.isBoosting) car.command('boost', time);
    car.update(mini.speed.maxStep ?? 1 / 60);
    time += mini.speed.maxStep ?? 1 / 60;
    const rel = (car.distance - upStart + track.length) % track.length;
    if (car.airborne && !wasAir && rel < 3 * PIECE) { from = rel; out.toV.push(car.speed); }
    if (!car.airborne && wasAir && from >= 0) { out.lands.push(rel / PIECE); from = -1; }
    wasAir = car.airborne;
  }
  out.outs = car.courseOuts;
  return out;
}
const MACH: [string, Build][] = [
  ['回転5・3.2・24mm', { ...defaultBuild(), motor: 'spd5', gear: 'g32', tireSize: 'small' }],
  ['トルク5・3.6・24mm', { ...defaultBuild(), motor: 'pow5', gear: 'g36', tireSize: 'small' }],
  ['標準', defaultBuild()],
];
const BR: [string, string | undefined, string | undefined][] = [
  ['ブレーキなし', undefined, undefined],
  ['後 中弱中（軽く）', undefined, 'mid-weak-mid'],
  ['前後 中弱中（軽く）', 'mid-weak-mid', 'mid-weak-mid'],
  ['後 中中中', undefined, 'mid-mid-mid'],
];
console.log(`並び: 直線→スロープ上り→下り→直線×3→コーナー。着地点=上りの入口から何枚目か（下りの終わり=2枚、直線の終わり=${((endOfStraights - upStart) / PIECE).toFixed(1)}枚）`);
for (const boost of [false, true]) {
  console.log(`\n■ ${boost ? 'ブーストあり（直線で押す）' : 'ブーストなし'}`);
  for (const [mn, b] of MACH) for (const [bn, f, r] of BR) {
    const t = miniLike(applyBuild(base, { ...b, brakeF: f, brakeR: r }));
    const rs = [7, 11, 23].map((s) => run(t, boost, s));
    const lands = rs.flatMap((x) => x.lands), v = rs.flatMap((x) => x.toV);
    const a = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN);
    console.log(`${mn.padEnd(16)} ${bn.padEnd(14)} 着地 ${a(lands).toFixed(1)}枚 [${Math.min(...lands).toFixed(1)}〜${Math.max(...lands).toFixed(1)}]  離陸 ${a(v).toFixed(1)}m/s  コースアウト ${(rs.reduce((p, x) => p + x.outs, 0) / 3).toFixed(1)}/5周`);
  }
}
