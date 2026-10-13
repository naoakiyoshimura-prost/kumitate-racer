// EXドリフトの得: シャーシごとに、カケル（EXドリフト）でEXを使う／使わないのタイム差（全コース合計）
// ドリフト適性0のシャーシ（FF）が、ほかより得にならないことを確かめる
// 実行: npm run driftsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, options } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const rows: { name: string; star: number; off: number; on: number; outsOff: number; outsOn: number }[] = [];
for (const ch of options('chassis').filter((c) => !process.env.CH || c.id === process.env.CH)) {
  const r = { name: ch.name, star: (ch as { driftStar?: number }).driftStar ?? 3, off: 0, on: 0, outsOff: 0, outsOn: 0 };
  for (const useEx of [false, true]) {
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const t = applyBuild(tuning as Tuning, { ...defaultBuild(), chassis: ch.id, driver: 'kakeru' });
    for (const course of COURSES) {
      const track = new Track(course);
      const laps = course.laps ?? tuning.race.laps;
      for (let run = 0; run < 3; run++) {
        const car = new CarState(track, t, 2, rand);
        const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
        let time = 0;
        while (car.lap <= laps && time < 300) {
          if (useEx && car.canEx() && car.command('ex', time)) void 0;
          if (useEx && car.exActive === 'drift' && car.cornerInside && car.vLat * car.cornerInside < -1.5) car.command(car.cornerInside < 0 ? 'left' : 'right', time);
          cpu.update(1 / 60, time);
          car.update(1 / 60);
          time += 1 / 60;
        }
        if (useEx) { r.on += time / 3; r.outsOn += car.courseOuts / 3; } else { r.off += time / 3; r.outsOff += car.courseOuts / 3; }
      }
    }
  }
  rows.push(r);
}
rows.sort((a, b) => b.star - a.star);
console.log('シャーシ  適性  EXなし  EXあり  得(秒)  得(%)  コースアウト なし→あり');
for (const r of rows) console.log(`${r.name.padEnd(12)} ${r.star}  ${r.off.toFixed(1)}  ${r.on.toFixed(1)}  ${(r.off - r.on).toFixed(1)}  ${(((r.off - r.on) / r.off) * 100).toFixed(2)}%  ${r.outsOff.toFixed(1)}→${r.outsOn.toFixed(1)}`);
