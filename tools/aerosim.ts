// エアロモードの使い方の比較: 使わない / 直線でエアロ・コーナーでサーキット / ずっとエアロ
// 実行: npm run aerosim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
let seed = 5;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const t = applyBuild(base, { ...defaultBuild(), body: 'shifter', rollerF: 'bearing', rollerR: 'bearing' });

for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  // この先 len メートルにコーナーがあるか
  const cornerAhead = (d: number, len: number) => {
    for (let a = 0; a <= len; a += 2) if (track.curvatureAt(d + a).k > t.corner.threshold) return true;
    return false;
  };
  const row: string[] = [];
  for (const mode of ['なし', '直線だけ', 'ずっと'] as const) {
    let total = 0;
    let switches = 0;
    for (let r = 0; r < 4; r++) {
      const car = new CarState(track, t, 2, rand);
      const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
      let time = 0;
      while (car.lap <= laps && time < 600) {
        const want = mode === 'ずっと' || (mode === '直線だけ' && !cornerAhead(car.distance, 25));
        if (mode !== 'なし' && want !== car.aeroTarget && car.command('transform', time)) switches++;
        cpu.update(1 / 60, time);
        car.update(1 / 60);
        time += 1 / 60;
      }
      total += time;
    }
    row.push(`${mode} ${(total / 4).toFixed(2)}s（切替${(switches / 4).toFixed(0)}回）`);
  }
  console.log(`${course.name}: ${row.join(' / ')}`);
}
