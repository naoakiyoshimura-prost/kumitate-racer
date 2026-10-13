// バッテリーの比較: 同じマシンでバッテリーだけ変え、コースごとのタイムとブースト回数を出す（CPUの走らせ方。EX技は使わない）
// 実行: npm run batterysim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, applyCourse, defaultBuild, options, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const machine: Partial<Build> = { motor: 'bal2', booster: 'twin2', rollerF: 'bearing', rollerR: 'bearing', shaft: 'bearing' };
let seed = 9;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const res = options('battery').map((d) => {
    const b = { ...defaultBuild(), ...machine, battery: d.id };
    const t = applyCourse(applyBuild(base, b), b, course.id);
    let total = 0;
    let boosts = 0;
    for (let r = 0; r < 4; r++) {
      const car = new CarState(track, t, 2, rand);
      const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
      let time = 0;
      while (car.lap <= laps && time < 600) {
        const before = car.isBoosting;
        cpu.update(1 / 60, time);
        if (!before && car.isBoosting) boosts++;
        car.update(1 / 60);
        time += 1 / 60;
      }
      total += time;
    }
    return { name: d.name, time: total / 4, boosts: boosts / 4 };
  }).sort((a, b) => a.time - b.time);
  console.log(`${course.name}: ${res.map((r) => `${r.name} ${r.time.toFixed(2)}s（ブースト${r.boosts.toFixed(1)}回）`).join(' / ')}`);
}
