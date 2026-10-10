// モーター・ブースター・ギヤ比の比較: 同じランク（T）の中で、コースごとに速い組み合わせの上位を出す
// バランス型＋4:1（中央値）が全コースで最強になっていないかを見る
// 実行: npm run motorsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, part, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const RANK = process.argv[2] ?? '2';
const MAKERS = ['bal', 'pow', 'spd'];
const GEARS = ['g50', 'g45', 'g40', 'g36', 'g32'];
const common: Partial<Build> = { rollerF: 'bearing', rollerR: 'bearing', shaft: 'bearing' };

let seed = 3;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function run(track: Track, laps: number, t: Tuning) {
  let total = 0;
  let outs = 0;
  for (let r = 0; r < 3; r++) {
    const car = new CarState(track, t, 2, rand);
    const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
    let time = 0;
    while (car.lap <= laps && time < 600) {
      cpu.update(1 / 60, time);
      car.update(1 / 60);
      time += 1 / 60;
    }
    total += time;
    outs += car.courseOuts;
  }
  return { time: total / 3, outs: outs / 3 };
}

const wins: Record<string, number> = {};
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const res: { name: string; time: number; outs: number }[] = [];
  for (const m of MAKERS) for (const bo of MAKERS) for (const g of GEARS) {
    const b = { ...defaultBuild(), ...common, motor: `${m}${RANK}`, booster: `${bo}${RANK}`, gear: g };
    res.push({ name: `M:${m} B:${bo} ${part('gear', g).name}`, ...run(track, laps, applyBuild(base, b)) });
  }
  res.sort((a, b) => a.time - b.time);
  const mid = res.findIndex((r) => r.name === 'M:bal B:bal 4:1') + 1;
  console.log(`\n${course.name}: 中央値（バランス×バランス×4:1）は ${mid}位 / ${res.length}`);
  for (const r of res.slice(0, 5)) console.log(`  ${r.time.toFixed(2)}s  コースアウト${r.outs.toFixed(1)}  ${r.name}`);
  const top = res[0].name.split(' ').slice(0, 2).join(' ');
  wins[top] = (wins[top] ?? 0) + 1;
}
console.log('\nコースごとの1位の組み合わせ:', wins);
