// セッティング探索: ランダムな組み合わせを走らせ、コースごとの上位を出す（標準が上位を独占していないかの確認）
// 実行: npm run searchbuild
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { CATEGORIES, applyBuild, defaultBuild, options, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function run(track: Track, laps: number, t: Tuning) {
  let total = 0;
  for (let r = 0; r < 3; r++) {
    const car = new CarState(track, t, 2, rand);
    const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
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
const builds: Build[] = [def];
for (let i = 0; i < 250; i++) {
  const b = { ...def };
  for (const c of CATEGORIES) {
    const o = options(c.key);
    b[c.key] = o[Math.floor(rand() * o.length)].id;
  }
  builds.push(b);
}
const label = (b: Build) =>
  CATEGORIES.filter((c) => b[c.key] !== def[c.key]).map((c) => options(c.key).find((o) => o.id === b[c.key])!.name).join('+') || '標準';

for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const res = builds.map((b) => ({ b, time: run(track, laps, applyBuild(base, b)) })).sort((a, b) => a.time - b.time);
  const rank = res.findIndex((r) => r.b === def) + 1;
  console.log(`\n${course.name}: 標準は ${rank}位 / ${res.length}（${res.find((r) => r.b === def)!.time.toFixed(1)}s）`);
  for (const r of res.slice(0, 5)) console.log(`  ${r.time.toFixed(1)}s ${label(r.b)}`);
}
