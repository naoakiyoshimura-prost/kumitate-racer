// 俯瞰モードの「コース縮尺・レーン幅・コースアウトしきい値」を変えて、走りやすさと速さの感じを比べる
// 実行: npm run minisim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild } from '../src/setup';
import { courseFor } from '../src/courses';
import { fitMini } from '../src/miniCourse';
import tuning from '../src/data/tuning.json';

const DT = 1 / 60;
const FAST = process.argv.includes('fast'); // 最高速に振った組み合わせ
const ALWAYS = process.argv.includes('always'); // コーナーでも構わず押す（雑な操作の想定）
const CAR_LEN = 3.38;
const CASES: [string, number, number, number][] = [
  // 名前, レーン幅, コース縮尺, コースアウトしきい値の倍率
  ['いままで 3.6m ×1.00', 3.6, 1, 1],
  ['幅だけ 2.36m ×1.00', 2.36, 1, 1],
  ['2.36m ×0.65', 2.36, 0.654, 1],
  ['2.36m ×0.65 out×2', 2.36, 0.654, 2],
  ['2.36m ×0.65 out×3', 2.36, 0.654, 3],
];
console.log('コース     設定                  1周    3周タイム  平均(車身/秒) 最高速  アウト スピン 壁沿い  発動');
for (const [id, mode] of [['triple', 'open'], ['oval', 'walled'], ['circuit', 'walled'], ['updown3', 'open'], ['grand', 'walled']] as const) {
  for (const [name, lw, sc, om] of CASES) {
    for (const boost of [0, 3]) {
      const base = applyBuild(tuning as Tuning, FAST ? { ...defaultBuild(), motor: 'spd5', gear: 'g32', tireSize: 'huge', booster: 'pod25' } : defaultBuild());
      const t = { ...base, corner: { ...base.corner, courseOutImpact: base.corner.courseOutImpact * om } };
      const track = new Track(fitMini(courseFor(id, mode), { laneWidth: lw, courseScale: sc, wallHeight: 0 }));
      let seed = 5 + boost;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const car = new CarState(track, t, 1, rand);
      car.multiBoost = boost > 0;
      let time = 0, top = 0, roller = 0, prev = 0, fired = 0;
      while (car.lap <= 3 && time < 400) {
        if (boost && (ALWAYS || !car.inCorner) && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', time);
        car.update(DT);
        if (car.boostLevel > prev) fired++;
        prev = car.boostLevel;
        if (car.onRoller) roller += DT;
        top = Math.max(top, car.speed);
        time += DT;
      }
      console.log(`${id.padEnd(8)} ${name.padEnd(20)} ${boost ? '3段' : '無し'} ${track.length.toFixed(0).padStart(4)}m ${time.toFixed(1).padStart(7)}s ${((track.length * 3) / time / CAR_LEN).toFixed(1).padStart(6)}      ${(top * 3.6).toFixed(0).padStart(4)}  ${String(car.courseOuts).padStart(3)}  ${String(car.spins).padStart(3)}  ${roller.toFixed(1).padStart(5)}s  ${fired}`);
    }
  }
}
