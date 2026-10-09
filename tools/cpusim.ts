// CPUの強さ確認: コースごとに、CPU単独で走らせたときの平均タイムとコースアウト回数
// 実行: npm run cpusim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const t = applyBuild(tuning as Tuning, defaultBuild());
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const runs = 20;
  let total = 0;
  let outs = 0;
  for (let r = 0; r < runs; r++) {
    const car = new CarState(track, t, 2);
    const cpu = new CpuDriver(car, track, tuning.cpu, t.boost.boostCost, t.corner.threshold);
    const dt = 1 / 60;
    let time = 0;
    while (car.lap <= laps && time < 600) {
      cpu.update(dt, time);
      car.update(dt);
      time += dt;
    }
    total += time;
    outs += car.courseOuts;
  }
  console.log(`${course.name} ${laps}周: CPU平均 ${(total / runs).toFixed(2)}s  コースアウト平均 ${(outs / runs).toFixed(1)}回`);
}
