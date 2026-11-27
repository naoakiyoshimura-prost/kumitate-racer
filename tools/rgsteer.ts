// レースゲーム: スティックを倒しきって壁へ寄せたときの速さの落ち方（2026-11-27 店長「操作できなかった」の確認用）
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, part, type Build } from '../src/setup';
import { toCourse } from '../src/editor/export';
import { circuitTune, CIRCUIT_BIG_LAYOUT } from '../src/circuit';
import { rgCourse, rgCfg } from '../src/raceGame';
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
const t = rgTune(circuitTune(applyBuild(tuning as Tuning, playBuild(2)), 'rg'), playBuild(2));
for (const [from, steer] of [[600, 1], [2800, 1], [2800, -1]] as const) {
  const car = new CarState(track, t, 5, () => 0.5);
  car.rgManual = true; car.distance = from; car.speed = t.boost.rg!.top[0];
  const out: string[] = [];
  let time = 0, next = 0;
  while (time < 3 * S) {
    car.rgSteer = time < 1.5 * S ? steer : 0;
    car.update(DT); time += DT;
    if (time >= next) { out.push(`${(time / S).toFixed(1)}s ${(car.speed * S * 3.6).toFixed(0)}km/h 横${car.lat.toFixed(1)}/${car.wallHalf.toFixed(1)} 壁${car.onRoller ? '●' : '-'} コーナー${car.inCorner ? '●' : '-'} スピン${car.spins} 外${car.isOut ? '●' : '-'} vLat${car.vLat.toFixed(1)}`); next += 0.25 * S; }
  }
  console.log(`== ${from}m スティック${steer > 0 ? '右' : '左'}`); console.log(out.join('\n'));
}
