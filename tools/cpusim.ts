// CPUの強さ確認: CPU単独で走らせたときの平均ラップとコースアウト回数
// 実行: npm run cpusim
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import course from '../src/data/course1.json';
import tuning from '../src/data/tuning.json';

const track = new Track(course as CourseData);
const runs = 20;
let total = 0;
let outs = 0;
for (let r = 0; r < runs; r++) {
  const car = new CarState(track, tuning as Tuning, 2);
  const cpu = new CpuDriver(car, track, tuning.cpu, tuning.boost.boostCost, tuning.corner.threshold);
  const dt = 1 / 60;
  let t = 0;
  while (car.lap <= tuning.race.laps && t < 600) {
    cpu.update(dt, t);
    car.update(dt);
    t += dt;
  }
  total += t;
  outs += car.courseOuts;
}
console.log(`CPU ${tuning.race.laps}周 平均 ${(total / runs).toFixed(2)}s  コースアウト平均 ${(outs / runs).toFixed(1)}回`);
