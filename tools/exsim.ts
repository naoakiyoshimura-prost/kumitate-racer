// EX技の確認: ボディごとに、使えるタイミングで毎回EXを使ったときのタイムと発動回数
// 実行: npm run exsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, options } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

let seed = 3;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  console.log(`\n${course.name}（${laps}周）`);
  for (const body of options('body')) {
    for (const useEx of [false, true]) {
      const t = applyBuild(tuning as Tuning, { ...defaultBuild(), body: body.id });
      let total = 0;
      let used = 0;
      let outs = 0;
      const runs = 10;
      for (let r = 0; r < runs; r++) {
        const car = new CarState(track, t, 2, rand);
        const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
        let time = 0;
        while (car.lap <= laps && time < 300) {
          if (useEx && car.canEx() && car.command('ex', time)) used++;
          cpu.update(1 / 60, time);
          car.update(1 / 60);
          time += 1 / 60;
        }
        total += time;
        outs += car.courseOuts;
      }
      console.log(`  ${body.name} ${useEx ? 'EXあり' : 'EXなし'}: ${(total / runs).toFixed(2)}s  EX ${(used / runs).toFixed(1)}回  コースアウト${(outs / runs).toFixed(1)}`);
    }
  }
}
