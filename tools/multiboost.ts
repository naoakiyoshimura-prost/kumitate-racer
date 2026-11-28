// 3段ブーストの比較: 同じ車・同じコースで、従来の1段ブーストと、3段ブーストを1段／2段／3段まで使ったときを比べる
// レーン取りはCPUと同じ（ブーストだけこちらで押す。CPU自身はブーストしない）。乱数は固定種
// 実行: npm run multiboost（MODE=time で溜め方式に切り替え）
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild } from '../src/setup';
import { courseById } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const t = applyBuild(base, defaultBuild());
if (process.env.MODE && t.boost.multi) t.boost.multi.mode = process.env.MODE;
const COURSE_IDS = ['standard', 'highspeed'];
const RUNS = 4;
const DT = 1 / 60;
const TAP_HZ = 8; // 連打の速さ（回/秒）。人が無理なく押せる程度

// maxStage: 0=従来の1段ブースト（multiBoost=false）、1〜3=3段ブーストをその段まで使う
// full: 1段目を、ゲージが満タン（上限）になるまで待ってから始める（3段ぶんのゲージを貯めてから連打）
const PLANS: { name: string; maxStage: number; full?: boolean }[] = [
  { name: '(a) 従来ブースト', maxStage: 0 },
  { name: '(b) 多段 1段だけ', maxStage: 1 },
  { name: '(c) 多段 2段まで', maxStage: 2 },
  { name: '(d) 多段 3段まで', maxStage: 3 },
  { name: '(e) 3段 満タン待ち', maxStage: 3, full: true },
];

function run(track: Track, laps: number, maxStage: number, full = false) {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let total = 0;
  let top = 0;
  let outs = 0;
  let spins = 0;
  let roller = 0;
  const fired = [0, 0, 0, 0]; // 段ごとの発動回数
  for (let r = 0; r < RUNS; r++) {
    const car = new CarState(track, t, 2, rand);
    car.multiBoost = maxStage > 0;
    const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0, boostChance: 0 }, t.boost.boostCost, t.corner.threshold, rand);
    let time = 0;
    let nextTap = 0;
    let prevLevel = 0;
    while (car.lap <= laps && time < 600) {
      if (maxStage === 0) {
        // 直線でゲージが足りたら押す（boostsim の MASH と同じ）
        if (!car.inCorner && car.boostCharge <= 0 && !car.isBoosting && car.gauge >= t.boost.boostCost) car.command('boost', time);
      } else if (time >= nextTap) {
        // 直線で、次の段がこの作戦の上限以内でゲージが足りれば連打
        const n = car.multiNext;
        const wait = full && n === 1 && car.gauge < car.gaugeCap;
        if (!car.inCorner && n >= 1 && n <= maxStage && !wait && car.gauge >= car.multiCostOf(n)) {
          car.command('boost', time);
          nextTap = time + 1 / TAP_HZ;
        }
      }
      cpu.update(DT, time);
      car.update(DT);
      const lv = car.boostLevel;
      if (car.multiBoost ? lv > prevLevel : lv > 0 && prevLevel === 0) fired[lv]++;
      prevLevel = lv;
      if (car.onRoller) roller += DT;
      top = Math.max(top, car.speed);
      time += DT;
    }
    total += time;
    outs += car.courseOuts;
    spins += car.spins;
  }
  return { time: total / RUNS, top: top * 3.6, outs: outs / RUNS, spins: spins / RUNS, roller: roller / RUNS, fired: fired.map((f) => f / RUNS) };
}

console.log(`3段ブースト比較（標準セッティング、${RUNS}回平均、連打 ${TAP_HZ}回/秒、mode=${t.boost.multi?.mode}）`);
console.log('壁沿い = ローラーで壁に押し付けられていた秒数。発動 = 1段目/2段目/3段目の発動回数（従来は1段目＝ブースト回数）');
for (const id of COURSE_IDS) {
  const course = courseById(id);
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  console.log(`\n${course.name}（${laps}周）`);
  console.log(`  ${'作戦'.padEnd(12)}  タイム   最高速     コースアウト  スピン  壁沿い   発動 1/2/3段`);
  for (const p of PLANS) {
    const r = run(track, laps, p.maxStage, p.full);
    console.log(
      `  ${p.name.padEnd(12)}  ${r.time.toFixed(2).padStart(6)}s  ${r.top.toFixed(0).padStart(4)}km/h  ${r.outs.toFixed(2).padStart(8)}回  ${r.spins.toFixed(2).padStart(5)}  ${r.roller.toFixed(1).padStart(5)}s   ${r.fired.slice(1).map((f) => f.toFixed(1)).join('/')}`,
    );
  }
}
