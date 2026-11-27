// レースゲーム: 上昇トルネードでの減速の原因を切り分ける（距離ごとの速さ・壁接触・坂・横の力）
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, part, type Build } from '../src/setup';
import { toCourse } from '../src/editor/export';
import { circuitTune, CIRCUIT_BIG_LAYOUT } from '../src/circuit';
import { rgCourse, rgCfg } from '../src/raceGame';
import { presetBuilds } from '../src/save';
import { PLAY_CARS, playBuild } from '../src/playtest';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';
const DT = mini.speed.maxStep;
const S = Math.max(1, ((mini.speed.realMps * 1000 * 3.38) / 165 / mini.speed.refGameMps) * mini.speed.ratio);
function rgTune(t: Tuning, build: Build): Tuning {
  const c = rgCfg; const v = (k: number) => k / 3.6 / S, acc = (k: number) => k / 3.6 / S / S;
  const dm = c.drainMul[(part('booster', build.booster) as any).boostKind ?? 'pod2'] ?? 1, G = t.boost.gaugeMax;
  return { ...t, car: { ...t.car, maxSpeed: v(c.top[0]), accel: acc(c.accel[0]), brakeF: undefined, brakeR: undefined }, tire: { ...t.tire, gripFeel: undefined }, boost: { ...t.boost, startGauge: G, rg: { drain: (G / (c.fullSec * S)) * dm, regen: G / (c.regenSec * S), unlock: c.unlock.map((x) => x * S), charge: c.charge.map((x) => x * S), top: c.top.map(v), accel: c.accel.map(acc), stages: 3, minEn: (G * c.minEn) / 100, steer: c.steer / S, brake: acc(c.brake), driftHold: c.driftHold, driftScrub: c.driftScrub / S } } };
}
const track = new Track({ ...rgCourse(toCourse(CIRCUIT_BIG_LAYOUT, 'custom').width), crestTakeoff: true });
const which = process.env.CAR ? Number(process.env.CAR) : -1;
const builds: [string, Build][] = PLAY_CARS.map((c, i) => [c.name, playBuild(i)]);
for (const [name, build] of builds) {
  if (which >= 0 && builds[which][0] !== name) continue;
  const t = rgTune(circuitTune(applyBuild(tuning as Tuning, build), 'rg'), build);
  const car = new CarState(track, t, 5, () => 0.5);
  car.rgManual = true; car.speed = t.boost.rg!.top[0];
  let time = 0; let next = 0; const out: string[] = [];
  car.command('boost', 0);
  while (car.distance < (Number(process.env.TO) || 4400) && time < 200 * S) {
    car.rgSteer = process.env.STEER ? Math.max(-1, Math.min(1, -(car.lat - car.wallCenter) / 3)) : 0;
    if (car.multiNext > 0) car.command('boost', time);
    car.update(DT); time += DT;
    if (car.distance >= next) { out.push(`${(car.distance / 1000).toFixed(1)}km ${(car.speed * S * 3.6).toFixed(0)}km/h 段${car.rgStage} 壁${car.onRoller ? '●' : '-'} 横${(car.lat - car.wallCenter).toFixed(1)} 空中${car.airborne ? '●' : '-'} ブレーキ接触${(car as any).spongeTouchF || (car as any).spongeTouchR ? '●' : '-'}`); next += 200; }
  }
  console.log(`== ${name} brakeF=${t.car.brakeF ?? '-'} brakeR=${t.car.brakeR ?? '-'}`); console.log(out.slice(8).join('\n'));
}
