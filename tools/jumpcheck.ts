// 店長の実物の目安（2026-11-18）: 最強モーター・24mm弱のタイヤでノーブレーキだとスロープの上りから6〜7枚飛ぶ。
// ブレーキを軽く当てると「スロープ上り→下り→直線×3」でコースアウトしない。ゲームで同じ並びを走らせて比べる
// 飛距離は「スロープ上りの入口から着地点まで」を直線1枚(540mm)で数える（店長の数え方）
import './browserstub';
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild, type Build } from '../src/setup';
import { presetBuilds } from '../src/save';
import { build as buildLayout } from '../src/editor/geom';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const base = tuning as unknown as Tuning;
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const L4 = [L, L, L, L];
// 着地を最後まで測るため、下りのあとの直線は12本（店長の並びは直線3本だが、どこまで飛ぶかを数える）
const RUN = 12;
const pieces: PieceSpec[] = [S, S, S, S, { type: 'slopeUp' }, { type: 'slopeDown' }, ...Array(RUN).fill(S), ...L4, ...Array(RUN + 6).fill(S), ...L4];
const lay = { version: 1 as const, name: 'jump', lanes: 3 as const, pieces };
const bl = buildLayout(lay);
if (!bl.check.closed) throw new Error('not closed');
const course: CourseData = { ...toCourse(lay), laps: 5 };
const lens = bl.placed.map((p) => p.length);
const upStart = lens.slice(0, 4).reduce((a, b) => a + b, 0) * MM_TO_GAME; // 書き出しの距離（m）。スロープ上りの入口
const PIECE = 540 * MM_TO_GAME;
const endOfStraights = lens.slice(0, 6 + RUN).reduce((a, b) => a + b, 0) * MM_TO_GAME;

// src/main.ts miniTune の写し（main.ts は node で読めないため。空中・着地・ローラー・ブレーキの倍率まで同じ）
function miniLike(t: Tuning): Tuning {
  const m = mini.speed.boostTimeMul;
  const b = t.boost;
  const mc = mini as any;
  const multi = b.multi && { ...b.multi, chargeTime: b.multi.chargeTime.map((v) => v * m), duration: b.multi.duration.map((v) => v * m), chainWindow: b.multi.chainWindow * m };
  const ease = Math.max(0.2, 1 + mc.gripFeel.wallEase * Math.min(0, ((t.tire as any).compoundGrip ?? 1) - 1));
  const sc = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * mc.brake.strengthMul]));
  return {
    ...t,
    car: { ...t.car, stability: t.car.stability - (mc.bounce.on ? (t.car as any).absorb ?? 0 : 0) },
    landing: { ...t.landing, maxOutChance: t.landing.maxOutChance * mc.landingOutMul, bounce: mc.bounce.on ? mc.bounce : undefined } as any,
    air: { ...t.air, flightGravityMul: mc.jump.gravityMul, airSpeedMul: mc.jump.airSpeedMul, flyOut: { width: mc.flyOut.width, load: mc.flyOut.load }, steep: { climbMin: mc.steep.climbMin, noCrestSlope: mc.steep.noCrestSlope, noCrestUp: mc.steep.noCrestUp } } as any,
    corner: { ...t.corner, rollerDrag: t.corner.rollerDrag * mc.roller.dragMul * ease, impactDrag: t.corner.impactDrag * mc.roller.impactMul / Math.sqrt(mc.roller.dragMul) },
    tire: { ...t.tire, gripFeel: { scrub: mc.gripFeel.scrub, exitAccel: mc.gripFeel.exitAccel, spin: mc.gripFeel.spin, spinBelow: mc.gripFeel.spinBelow } } as any,
    boost: { ...b, regen: b.regen / m, duration: b.duration * m, chargeTime: (b.chargeTime ?? 0) * m, multi },
    brake: t.brake && { ...t.brake, strength: { front: sc(t.brake.strength.front), rear: sc(t.brake.strength.rear) } as any },
  };
}
function run(t: Tuning, boost: boolean, seed: number) {
  const track = new Track(course);
  let sd = seed;
  const rand = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const car = new CarState(track, t, 1, rand);
  car.multiBoost = boost;
  const out = { lands: [] as number[], toV: [] as number[], outs: 0 };
  let wasAir = false, from = -1, time = 0;
  while (car.lap <= 5 && time < 600) {
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
const P = presetBuilds();
const MACH: [string, Build][] = [
  ['最速仕様(見本5)', { ...P[4], brakeF: undefined, brakeR: undefined }],
  ['回転5・3.2・24mm', { ...defaultBuild(), motor: 'spd5', gear: 'g32', tireSize: 'small' }],
  ['安定入門(見本1)', { ...P[0], brakeF: undefined, brakeR: undefined }],
];
const BR: [string, string | undefined, string | undefined][] = [
  ['ブレーキなし', undefined, undefined],
  ['前後 中弱中', 'mid-weak-mid', 'mid-weak-mid'],
  ['前後 中強中', 'mid-strong-mid', 'mid-strong-mid'],
  ['前後 中強外', 'mid-strong-out', 'mid-strong-out'],
];
// 調整の試し: JC_GRAV=飛行中の重力の倍率、JC_BRAKE=ブレーキの強さの倍率（mini.json の値を上書き）
const mc0 = mini as any;
if (process.env.JC_GRAV) mc0.jump.gravityMul = Number(process.env.JC_GRAV);
if (process.env.JC_BRAKE) mc0.brake.strengthMul = Number(process.env.JC_BRAKE);
console.log(`並び: 直線4→スロープ上り→下り→直線${RUN}。着地点=上りの入口から何枚目か（店長の並びなら5枚目より先はコーナー）。飛行中の重力×${mc0.jump.gravityMul}、ブレーキの強さ×${mc0.brake.strengthMul}`);
for (const boost of [false, true]) {
  console.log(`\n■ ${boost ? 'ブーストあり（直線で押す）' : 'ブーストなし'}`);
  for (const [mn, b] of MACH) for (const [bn, f, r] of BR) {
    const t = miniLike(applyBuild(base, { ...b, brakeF: f, brakeR: r }));
    const rs = [7, 11].map((s) => run(t, boost, s));
    const lands = rs.flatMap((x) => x.lands), v = rs.flatMap((x) => x.toV);
    const a = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN);
    console.log(`${mn.padEnd(16)} ${bn.padEnd(14)} 着地 ${a(lands).toFixed(1)}枚 [${Math.min(...lands).toFixed(1)}〜${Math.max(...lands).toFixed(1)}]  離陸 ${a(v).toFixed(1)}m/s  コースアウト ${(rs.reduce((p, x) => p + x.outs, 0) / rs.length).toFixed(1)}/5周`);
  }
}
