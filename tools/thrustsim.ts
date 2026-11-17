// レーンチェンジの橋で浮く回数と、スラスト角の効きを比べる（俯瞰モードのテストコース、テストプレイの3台）
// 実行: npm run thrustsim
// 注意: 俯瞰モードの調整（main.ts miniTune）のうち、橋で浮く判定に要る分（lcJump・飛行中の重力）だけを足している。ブースト時間の倍率などは入れていない
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild } from '../src/setup';
import { fitMini } from '../src/miniCourse';
import { toCourse } from '../src/editor/export';
import { PLAY_LAYOUT, PLAY_CARS, playBuild } from '../src/playtest';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const DT = mini.speed.maxStep;
const LAPS = Number(process.argv[2] ?? 60);
const lj = mini.lcJump;
const track = new Track(fitMini(toCourse(PLAY_LAYOUT, 'custom'), mini.course));
console.log(`テストコース 1周 ${track.length.toFixed(0)}m、${LAPS}周（橋を渡るのは3周に1回＝${Math.floor(LAPS / 3)}回）`);
console.log('マシン            ブースト スラスト  橋の頂上の速さ  浮いた  飛び出し  1周の平均');
for (const [i, pc] of PLAY_CARS.entries()) {
  for (const boost of [false, true]) {
    for (const thrust of [0, 2, 4, 6]) {
      const base = applyBuild(tuning as Tuning, { ...playBuild(i), thrust: String(thrust) });
      const t: Tuning = { ...base, air: { ...base.air, flightGravityMul: mini.jump.gravityMul, lcJump: { minSpeed: lj.minSpeed, plainMinSpeed: lj.plainMinSpeed, fastMinSpeed: lj.fastMinSpeed, fastSpan: lj.fastSpan, fastMax: lj.fastMax, angleDeg: lj.angleDeg, outSpan: lj.outSpan, maxOut: lj.maxOut } } };
      let seed = 7 + i * 31 + thrust;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const car = new CarState(track, t, 0, rand);
      car.multiBoost = true;
      let time = 0, pp = -1;
      const crest: number[] = [];
      while (car.lap <= LAPS && time < LAPS * 200) {
        // ブーストあり: 撃てるときはいつも撃つ（橋の上でブースト中になる回数を多めに見る）
        if (boost && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', time);
        car.update(DT);
        const p = track.crossProgress(car.distance);
        if (pp >= 0 && pp < 0.25 && p >= 0.25 && car.lift > 0) crest.push(car.speed);
        pp = p;
        time += DT;
      }
      const avg = crest.length ? crest.reduce((a, b) => a + b, 0) / crest.length : 0;
      console.log(`${pc.name.padEnd(14)} ${boost ? 'あり' : 'なし'}     ${String(thrust).padStart(2)}度      ${avg.toFixed(1).padStart(5)}        ${String(car.lcJumps).padStart(3)}回   ${String(car.courseOuts).padStart(3)}回     ${(time / LAPS).toFixed(2)}s`);
    }
  }
}
