// シャーシ比較: 同じ中盤セッティングでシャーシだけ変えたときのタイム
// 実行: npm run chassissim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, options } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

let seed = 5;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const mid = { motor: 'hyperTorque', compound: 'soft', rollerF: 'doubleBearing', rollerR: 'bearing', shaft: 'bearing', damperF: 'light' };
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const line = options('chassis').map((ch) => {
    const t = applyBuild(tuning as Tuning, { ...defaultBuild(), ...mid, chassis: ch.id });
    let total = 0;
    let outs = 0;
    for (let r = 0; r < 4; r++) {
      const car = new CarState(track, t, 2, rand);
      const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
      let time = 0;
      while (car.lap <= laps && time < 300) {
        cpu.update(1 / 60, time);
        car.update(1 / 60);
        time += 1 / 60;
      }
      total += time;
      outs += car.courseOuts;
    }
    return `${ch.name} ${(total / 4).toFixed(1)}s(out${(outs / 4).toFixed(1)})`;
  });
  console.log(`${course.name}: ${line.join('  ')}`);
}
