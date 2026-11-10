// エディタの見本コースを書き出して走らせ、縮尺ごとの走りやすさを比べる
// 縮尺A: ゲームの仕切りレーン幅 3.6m に合わせる（約31.3倍）  縮尺B: 車体の縮尺（全長165mm=3.38m、約20.5倍）
// 実行: npm run customsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild } from '../src/setup';
import { sampleOval } from '../src/editor/geom';
import { toCourse, MM_TO_GAME, MM_TO_GAME_WIDE } from '../src/editor/export';
import tuning from '../src/data/tuning.json';

const t = applyBuild(tuning as Tuning, defaultBuild());
const DT = 1 / 60;
const SCALES: [string, number][] = [['A レーン幅3.6m合わせ', MM_TO_GAME_WIDE], ['B 車体の縮尺', MM_TO_GAME]];

console.log('縮尺                 レーン幅  1周     タイム(3周)  最高速   平均速   コースアウト  壁沿い  発動1/2/3');
for (const lanes of [3, 5] as const) {
  for (const [name, k] of SCALES) {
    for (const boost of [0, 3]) {
      const course = toCourse(sampleOval(lanes), 'custom', k);
      const track = new Track(course);
      let seed = 5;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const car = new CarState(track, t, 1, rand);
      car.multiBoost = boost > 0;
      let time = 0, top = 0, roller = 0, prev = 0;
      const fired = [0, 0, 0, 0];
      const laps = 3;
      while (car.lap <= laps && time < 300) {
        // 直線に入ったらブースト（多段は切れるたびに次の段を押す）
        if (boost && !car.inCorner && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', time);
        car.update(DT);
        if (car.boostLevel > prev) fired[car.boostLevel]++;
        prev = car.boostLevel;
        if (car.onRoller) roller += DT;
        top = Math.max(top, car.speed);
        time += DT;
      }
      console.log(`${lanes}レーン ${name.padEnd(14)} ${boost ? '3段' : '無し'}  ${(course.width / lanes).toFixed(2)}m  ${track.length.toFixed(0).padStart(4)}m  ${time.toFixed(2).padStart(7)}s  ${(top * 3.6).toFixed(0).padStart(4)}km/h ${((track.length * laps) / time * 3.6).toFixed(0).padStart(4)}km/h  ${String(car.courseOuts).padStart(3)}回     ${roller.toFixed(1).padStart(5)}s  ${fired.slice(1).join('/')}`);
    }
  }
}
