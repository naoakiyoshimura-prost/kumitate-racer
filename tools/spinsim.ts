// 仕切りレーンのスピンなし（mini.json spin.walledOff）とブースト発動直後のホイルスピン（gripFeel.boostSpin）の前後比較（2026-11-22）
// テストプレイの5台を、タイヤ5種に付け替えて、3段ブーストありで店長のコース（2026チャレンジ）を3周。押し方は「直線だけ」と「押せるときはいつでも（押しっぱなし）」
// 実行: npm run -s spinsim   注意: setcars と同じく、俯瞰モードの調整（main.ts miniTune）のうち走りに要る分だけ足している
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild } from '../src/setup';
import { fitMini } from '../src/miniCourse';
import { toCourse } from '../src/editor/export';
import { SET_CARS, setBuild } from '../src/playtest';
import { LAYOUT_COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const DT = mini.speed.maxStep;
const mc = mini as any;
const COMPOUNDS = ['soft', 'medium', 'hard', 'superHard', 'extraHard'];
function miniLike(base: Tuning, neu: boolean): Tuning {
  return { ...base,
    landing: { ...base.landing, maxOutChance: base.landing.maxOutChance * mc.landingOutMul, bounce: mc.bounce.on ? mc.bounce : undefined },
    air: { ...base.air, flightGravityMul: mc.jump.gravityMul, airSpeedMul: mc.jump.airSpeedMul, flyOut: { width: mc.flyOut.width, load: mc.flyOut.load }, steep: { climbMin: mc.steep.climbMin, noCrestSlope: mc.steep.noCrestSlope, noCrestUp: mc.steep.noCrestUp }, lcRamp: mc.lcRamp?.on ? { angleDeg: mc.lcRamp.angleDeg } : undefined, lcJump: { ...mc.lcJump } } as any,
    corner: { ...base.corner, rollerDrag: base.corner.rollerDrag * mc.roller.dragMul * Math.max(0.2, 1 + mc.gripFeel.wallEase * Math.min(0, (base.tire.compoundGrip ?? 1) - 1)), impactDrag: base.corner.impactDrag * mc.roller.impactMul / Math.sqrt(mc.roller.dragMul) },
    spin: base.spin && { ...base.spin, speedKeep: mc.spin.speedKeep, drag: mc.spin.drag, idleMul: mc.spin.idleMul, walledOff: neu },
    tire: { ...base.tire, gripFeel: { scrub: mc.gripFeel.scrub, exitAccel: mc.gripFeel.exitAccel, spin: mc.gripFeel.spin, spinBelow: mc.gripFeel.spinBelow, boostSpin: neu ? mc.gripFeel.boostSpin : undefined } } };
}
const track = new Track(fitMini(toCourse(LAYOUT_COURSES.stechal2026, 'custom'), mini.course));
function run(t: Tuning, always: boolean) {
  let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const car = new CarState(track, t, 1, rand); car.multiBoost = true;
  let time = 0;
  while (car.lap <= 3 && time < 900) {
    if ((always || !car.inCorner) && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', time);
    car.update(DT); time += DT;
  }
  return { time, spins: car.spins, outs: car.courseOuts };
}
// ブースト1段目を最高速の半分から発動して、0.6秒・1.0秒後の速さ（平らな直線）
function burst(t: Tuning) {
  const car = new CarState(track, t, 1, () => 0.5); car.multiBoost = true;
  car.speed = t.car.maxSpeed * 0.5;
  car.command('boost', 0);
  let guard = 0;
  while (!car.isBoosting && guard++ < 1000) { if (car.multiNext > 0 && car.multiCharge === 0) car.command('boost', guard * DT); (car as any).distance = 0.5; car.speed = t.car.maxSpeed * 0.5; car.update(DT); }
  const v0 = car.speed; let time = 0; const out: number[] = [];
  while (time < 1.0001) { (car as any).distance = 0.5; car.update(DT); time += DT; if (Math.abs(time - 0.6) < DT / 2 || Math.abs(time - 1.0) < DT / 2) out.push(car.speed - v0); }
  return out;
}
console.log('コース: 2026チャレンジ（3レーン）3周、3段ブーストあり。タイム秒（スピン/コースアウト）。前=今までの計算、後=仕切りレーンでスピンなし＋ブースト直後のホイルスピン');
console.log('車  タイヤ        直線だけ 前         後           押しっぱなし 前      後         ブースト0.6秒の伸び 前→後');
if (process.env.BURST) { SET_CARS.forEach((c, i) => { for (const comp of COMPOUNDS) { const base = applyBuild(tuning as Tuning, { ...setBuild(i), compound: comp } as any); const bo = burst(miniLike(base, false)), bn = burst(miniLike(base, true)); console.log(`${i + 1}番 ${comp.padEnd(10)} 0.6秒 ${bo[0].toFixed(2)}→${bn[0].toFixed(2)}  1.0秒 ${bo[1].toFixed(2)}→${bn[1].toFixed(2)}  最高速 ${base.car.maxSpeed.toFixed(1)}`); } }); process.exit(0); }
SET_CARS.forEach((c, i) => {
  for (const comp of COMPOUNDS) {
    const b = { ...setBuild(i), compound: comp } as any;
    const base = applyBuild(tuning as Tuning, b);
    const o = miniLike(base, false), n = miniLike(base, true);
    const f = (r: any) => `${r.time.toFixed(2)}(${r.spins}/${r.outs})`.padEnd(12);
    console.log(`${i + 1}番 ${comp.padEnd(10)}  ${f(run(o, false))} ${f(run(n, false))}   ${f(run(o, true))} ${f(run(n, true))}`);
  }
});
