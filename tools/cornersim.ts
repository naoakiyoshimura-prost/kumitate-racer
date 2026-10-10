// グリップで曲げるか、ローラーで曲げるか: 代表的なセッティングのコース別タイムと壁に付いている割合
// 実行: npm run cornersim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';
let seed = 5; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const base = { motor: 'hyperDash', gear: 'high', shaft: 'bearing' };
const builds: Record<string, object> = {
  'グリップ(ソフト+ノーマル)': { compound: 'soft', rollerF: 'plastic', rollerR: 'plastic' },
  'グリップ(スリック+ベアリング)': { compound: 'slick', rollerF: 'bearing', rollerR: 'bearing' },
  'ローラー(ハード+超低摩擦)': { compound: 'hard', rollerF: 'doubleBearing', rollerR: 'superLowFriction' },
  'ローラー(ハード+低摩擦B)': { compound: 'hard', rollerF: 'lowFrictionBearing', rollerR: 'lowFrictionBearing' },
  '中間(ミディアム+ベアリング)': { compound: 'medium', rollerF: 'bearing', rollerR: 'bearing' },
};
for (const course of COURSES) {
  const track = new Track(course); const laps = course.laps ?? 3;
  const out: string[] = [];
  for (const [name, b] of Object.entries(builds)) {
    const t = applyBuild(tuning as Tuning, { ...defaultBuild(), ...base, ...b });
    let total = 0, outs = 0, wall = 0, frames = 0;
    for (let i = 0; i < 4; i++) { const car = new CarState(track, t, 2, rand); const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
      let time = 0; while (car.lap <= laps && time < 300) { cpu.update(1/60, time); car.update(1/60); time += 1/60; frames++; if (car.onRoller) wall++; } total += time; outs += car.courseOuts; }
    out.push(`  ${name}: ${(total/4).toFixed(1)}s out${(outs/4).toFixed(1)} 壁${Math.round(wall/frames*100)}%`);
  }
  console.log(course.name + '\n' + out.join('\n'));
}
