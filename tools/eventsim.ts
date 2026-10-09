// 大会バランス確認: 各大会のコスト制限内でランダムにマシンを組み、大会CPUに勝てる割合と最速構成を出す
// 実行: npm run eventsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { CATEGORIES, applyBuild, buildCost, defaultBuild, options, part, type Build } from '../src/setup';
import { courseById } from '../src/courses';
import { CAREER } from '../src/events';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
let seed = 11;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function run(track: Track, laps: number, t: Tuning, mistakeRate: number) {
  let total = 0;
  for (let r = 0; r < 3; r++) {
    const car = new CarState(track, t, 2, rand);
    const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate }, t.boost.boostCost, t.corner.threshold, rand);
    let time = 0;
    while (car.lap <= laps && time < 300) {
      cpu.update(1 / 60, time);
      car.update(1 / 60);
      time += 1 / 60;
    }
    total += time;
  }
  return total / 3;
}

const def = defaultBuild();
const label = (b: Build) =>
  CATEGORIES.filter((c) => b[c.key] !== def[c.key]).map((c) => part(c.key, b[c.key]).name).join('+') || '初期';

for (const ev of CAREER) {
  const course = courseById(ev.course);
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const cpuBuild = { ...def, ...ev.cpu };
  const cpuTime = run(track, laps, applyBuild(base, cpuBuild), tuning.cpu.mistakeRate);
  const starter = run(track, laps, applyBuild(base, def), 0);
  const res: { b: Build; time: number }[] = [];
  let tries = 0;
  while (res.length < 120 && tries++ < 20000) {
    const b = { ...def };
    for (const c of CATEGORIES) {
      const o = options(c.key).filter((x) => x.cost <= ev.singleCap!);
      b[c.key] = o[Math.floor(rand() * o.length)].id;
    }
    if (buildCost(b).total > ev.costCap!) continue;
    res.push({ b, time: run(track, laps, applyBuild(base, b), 0) });
  }
  res.sort((a, b) => a.time - b.time);
  const wins = res.filter((r) => r.time < cpuTime).length;
  console.log(`\n${ev.name}（${course.name} 上限${ev.costCap}/単品${ev.singleCap}）CPU ${cpuTime.toFixed(1)}s(コスト${buildCost(cpuBuild).total}) 初期 ${starter.toFixed(1)}s  勝てる構成 ${wins}/${res.length}`);
  for (const r of res.slice(0, 3)) console.log(`  ${r.time.toFixed(1)}s [${buildCost(r.b).total}] ${label(r.b)}`);
}
