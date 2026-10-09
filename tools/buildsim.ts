// セッティングの比較: コースごとに、代表的な組み合わせをCPUと同じ走り方（ミスなし）で走らせる
// 実行: npm run buildsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, stats, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const builds: Record<string, Partial<Build>> = {
  標準: {},
  '標準＋ダンパー軽': { damper: 'light' },
  最高速特化: { motor: 'speed', gear: 'high', tireSize: 'large', tread: 'narrow', compound: 'hard' },
  '最高速＋安定装備': { motor: 'speed', gear: 'high', tireSize: 'large', tread: 'narrow', compound: 'hard', wing: 'large', damper: 'heavy' },
  コーナー特化: { motor: 'torque', gear: 'low', tireSize: 'small', tread: 'wide', compound: 'soft' },
  加速型: { motor: 'torque', layout: 'rear', tireSize: 'small' },
};

let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

console.log('性能（標準=50）');
for (const [name, b] of Object.entries(builds)) {
  const t = applyBuild(base, { ...defaultBuild(), ...b });
  console.log(`  ${name}: ${stats(base, t).map((x) => `${x.label}${x.value}`).join(' ')}`);
}
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  console.log(`\n${course.name}（${laps}周）`);
  for (const [name, b] of Object.entries(builds)) {
    const t = applyBuild(base, { ...defaultBuild(), ...b });
    let total = 0;
    let outs = 0;
    let wobble = 0;
    const runs = 20;
    for (let r = 0; r < runs; r++) {
      const car = new CarState(track, t, 2, rand);
      const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
      let time = 0;
      let prevLanding = 0;
      while (car.lap <= laps && time < 600) {
        cpu.update(1 / 60, time);
        car.update(1 / 60);
        if (car.lastLandingTime !== prevLanding) {
          prevLanding = car.lastLandingTime;
          if (car.lastLanding === 'wobble') wobble++;
        }
        time += 1 / 60;
      }
      total += time;
      outs += car.courseOuts;
    }
    console.log(`  ${name}: ${(total / runs).toFixed(2)}s  コースアウト${(outs / runs).toFixed(1)}  着地乱れ${(wobble / runs).toFixed(1)}`);
  }
}
