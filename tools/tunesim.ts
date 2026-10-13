// 改造の方向（チューン方向）の比較: 同じモーター・同じ＋3で、方向（標準・出力・トルク・効率）だけ変えて全コースを走らせる
// 見る点: どの方向もコースの半分以上で1位にならないか。純正（標準・効率）だけでも1位との差が小さいか
// 実行: npm run tunesim [ランク番号 1〜4、既定2] [改造段階、既定3]
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, MOTOR_TUNES, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const RANK = process.argv[2] ?? '2';
const LV = Number(process.argv[3] ?? 3);
const MAKERS = ['bal', 'pow', 'spd'];
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
const genuineGap: number[] = [];
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  console.log(`\n${course.name}（${laps}周）`);
  for (const m of MAKERS) {
    const b = { ...defaultBuild(), ...common, motor: `${m}${RANK}` };
    const plain = run(track, laps, applyBuild(base, b)).time;
    const res = MOTOR_TUNES.map((d) => ({ d, ...run(track, laps, applyBuild(base, b, (c) => (c === 'motor' ? LV : 0), (c) => (c === 'motor' ? d.id : undefined))) }));
    const best = Math.min(...res.map((r) => r.time));
    const top = res.find((r) => r.time === best)!.d;
    wins[top.name] = (wins[top.name] ?? 0) + 1;
    const g = Math.min(...res.filter((r) => r.d.line === 'genuine').map((r) => r.time));
    genuineGap.push((g - best) / laps);
    const cells = res.map((r) => `${r.d.name} ${r.time.toFixed(2)}s${r.outs ? `(CO${r.outs.toFixed(1)})` : ''}`).join(' / ');
    console.log(`  ${m}${RANK} ＋0 ${plain.toFixed(2)}s → ＋${LV}: ${cells}  1位=${top.name}`);
  }
}
const n = COURSES.length * MAKERS.length;
console.log(`\n1位の回数（${n}回中）:`, wins);
console.log(`純正（標準・効率）の最速と1位の差: 1周あたり平均 ${(genuineGap.reduce((a, b) => a + b, 0) / n).toFixed(3)}s、最大 ${Math.max(...genuineGap).toFixed(3)}s`);
