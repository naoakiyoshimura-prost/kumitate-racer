// レースゲームモードの試作コースを走らせて、ブースト全開区間の秒数・1周のタイム・最高速を測る（2026-11-26）
// 実行: npx esbuild tools/rgsim.ts --bundle --platform=node --format=esm --outfile=dist/rgsim.mjs && node dist/rgsim.mjs
// 注意: main.ts の rgTune と同じ換算（SIM_SCALE は試作の ?play=1 の値）。俯瞰モードの細かい調整（miniTune）は入れていない
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild, part, type Build } from '../src/setup';
import { toCourse } from '../src/editor/export';
import { circuitTune, CIRCUIT_BIG_LAYOUT } from '../src/circuit';
import { rgCourse, rgCfg } from '../src/raceGame';
import { presetBuilds } from '../src/save';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const DT = mini.speed.maxStep;
const S = Math.max(1, ((mini.speed.realMps * 1000 * 3.38) / 165 / mini.speed.refGameMps) * mini.speed.ratio);
function rgTune(t: Tuning, build: Build, stages: number): Tuning {
  const c = rgCfg;
  const v = (k: number) => k / 3.6 / S, acc = (k: number) => k / 3.6 / S / S;
  const kind = (part('booster', build.booster) as { boostKind?: string }).boostKind;
  const dm = c.drainMul[kind ?? 'pod2'] ?? 1, G = t.boost.gaugeMax;
  return { ...t, car: { ...t.car, maxSpeed: v(c.top[0]), accel: acc(c.accel[0]) }, boost: { ...t.boost, startGauge: G, rg: { drain: (G / (c.fullSec * S)) * dm, regen: G / (c.regenSec * S), unlock: c.unlock.map((x) => x * S), charge: c.charge.map((x) => x * S), top: c.top.map(v), accel: c.accel.map(acc), stages, minEn: (G * c.minEn) / 100, steer: c.steer / S, brake: acc(c.brake), driftHold: c.driftHold, driftScrub: c.driftScrub / S, kick: { window: c.driftKick.window * S, time: c.driftKick.time * S, accelMul: c.driftKick.accelMul } } } };
}
const course = rgCourse(toCourse(CIRCUIT_BIG_LAYOUT, 'custom').width);
const track = new Track(course);
// 上昇トルネードの終わり（区間の距離）: 高さが最大になる所
let helixEnd = 0, hmax = -1;
for (let s = 0; s < track.length; s += 2) { const y = track.frameAt(s).position.y; if (y > hmax + 1e-6) { hmax = y; helixEnd = s; } }
console.log(`1周 ${(track.length / 1000).toFixed(2)}km、上昇トルネードの終わり ${(helixEnd / 1000).toFixed(2)}km、高さ ${hmax.toFixed(1)}m、SIM_SCALE ${S.toFixed(2)}`);
const booster = process.env.BOOSTER;
for (const stages of [3, 2]) {
  const b0 = presetBuilds()[Number(process.env.PRESET ?? 4)];
  const build = { ...b0, ...(booster ? { booster } : {}) } as Build;
  const t = rgTune(circuitTune(applyBuild(tuning as Tuning, build), 'rg'), build, stages);
  const car = new CarState(track, t, Math.floor((course.lanes ?? 11) / 2), () => 0.5);
  let time = 0, lapStart = 0, boostStart = -1, boostEnd = -1, vmax = 0, stageAt: string[] = [];
  let lastStage = 0; let endAt = 0; const laps: number[] = [];
  while (car.lap <= 2 && time < 600 * S) {
    // 2周目のメインストレートの頭から全開: 押せる時に押す（段は進めるだけ進める）
    if (car.lap === 2 && car.distance % track.length < helixEnd) car.command('boost', time);
    // 人の代わりのハンドル: 道の真ん中へ戻すようにスティックを倒す
    car.rgManual = true;
    car.rgSteer = Math.max(-1, Math.min(1, -(car.lat - car.wallCenter) / 3));
    const lap0 = car.lap;
    car.update(DT); time += DT;
    if (car.lap !== lap0) { laps.push((time - lapStart) / S); lapStart = time; }
    if (car.lap === 2) {
      if (car.isBoosting && boostStart < 0) boostStart = time;
      if (boostStart >= 0 && boostEnd < 0 && !car.isBoosting && car.rgCharge <= 0) { boostEnd = time; endAt = car.distance % track.length; }
      if (car.rgStage !== lastStage) { stageAt.push(`${car.rgStage}段@${((time - boostStart) / S).toFixed(1)}s`); lastStage = car.rgStage; }
      vmax = Math.max(vmax, car.speed);
    }
  }
  const atEnd = boostEnd > 0 ? '' : '（周の終わりまで続いた）';
  console.log(`${stages}段: 1周目 ${laps[0]?.toFixed(1)}秒（ブーストなし）、2周目 ${laps[1]?.toFixed(1)}秒、全開 ${((boostEnd - boostStart) / S).toFixed(1)}秒${atEnd}、最高 ${(vmax * S * 3.6).toFixed(0)}km/h、${stageAt.join(' ')}、切れた所 ${(endAt / 1000).toFixed(2)}km、コースアウト${car.courseOuts}`);
}
// ドリフトでカット → 立ち上がりで再発動（溜めなし・追加加速）を確かめる
{
  const build = presetBuilds()[4];
  const t = rgTune(circuitTune(applyBuild(tuning as Tuning, build), 'rg'), build, 3);
  const car = new CarState(track, t, 5, () => 0.5);
  car.rgManual = true;
  car.speed = t.boost.rg!.top[0];
  let time = 0;
  const step = (sec: number) => { for (let i = 0; i < (sec * S) / DT; i++) { car.update(DT); time += DT; } };
  car.command('boost', 0); step(2);
  const before = car.isBoosting;
  car.rgDrifting = true; step(0.5);
  const cut = !car.isBoosting;
  const en = car.gauge;
  car.rgDrifting = false; step(0.3);
  car.command('boost', time); const v0 = car.speed; step(1);
  console.log(`ドリフトでカット: 前 ${before ? '発動中' : '-'} → ${cut ? '切れた' : '切れない'}（EN残り ${en.toFixed(0)}）。立ち上がりで再発動: 段 ${car.rgStage}、追加加速の残り ${(car.rgKick / S).toFixed(2)}秒、1秒で +${((car.speed - v0) * S * 3.6).toFixed(0)}km/h`);
  car.rgBraking = true; step(0.2); console.log(`ブレーキでカット: ${car.isBoosting ? '切れない' : '切れた'}`);
}
