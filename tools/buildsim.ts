// セッティングの比較: 代表的な組み合わせで、CPUと同じ走り方をさせたときの3周タイム
// 実行: npm run buildsim
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, stats, type Build } from '../src/setup';
import course from '../src/data/course1.json';
import tuning from '../src/data/tuning.json';

const track = new Track(course as CourseData);
const base = tuning as Tuning;
const builds: Record<string, Partial<Build>> = {
  標準: {},
  最高速特化: { motor: 'speed', gear: 'high', tireSize: 'large', tread: 'narrow', compound: 'hard' },
  コーナー特化: { motor: 'torque', gear: 'low', tireSize: 'small', tread: 'wide', compound: 'soft' },
  高回転ハイグリップ: { motor: 'speed', compound: 'soft', tread: 'wide' },
  リヤ加速: { layout: 'rear', motor: 'torque', roller: 'alloy' },
};
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const [name, b] of Object.entries(builds)) {
  const t = applyBuild(base, { ...defaultBuild(), ...b });
  let total = 0;
  let outs = 0;
  let life = 0;
  const runs = 10;
  for (let r = 0; r < runs; r++) {
    const car = new CarState(track, t, 2);
    const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
    let time = 0;
    while (car.lap <= tuning.race.laps && time < 600) {
      cpu.update(1 / 60, time);
      car.update(1 / 60);
      time += 1 / 60;
    }
    total += time;
    outs += car.courseOuts;
    life += car.tireLife;
  }
  const s = stats(base, t).map((x) => `${x.label}${x.value}`).join(' ');
  console.log(`${name}: ${(total / runs).toFixed(2)}s コースアウト${(outs / runs).toFixed(1)} タイヤ残${Math.round((life / runs) * 100)}% | 最高速${t.car.maxSpeed.toFixed(1)} | ${s}`);
}
