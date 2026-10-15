// ブースターの比較: 同じランクで、ブースター5種（溜め時間つき）のコースごとのタイム。1種が全部勝っていないかを見る
// 実行: npm run boostsim [ランク番号 1〜5、既定 2]
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const RANK = process.argv[2] ?? '2';
const BOOSTERS = ['twin', 'quad', 'single', 'pod2', 'pod4'];
const common: Partial<Build> = { rollerF: 'bearing', rollerR: 'bearing', shaft: 'bearing', motor: `bal${RANK}`, ...(process.env.DRIVER ? { driver: process.env.DRIVER } : {}) };

function run(track: Track, laps: number, t: Tuning) {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let total = 0;
  for (let r = 0; r < 4; r++) {
    const car = new CarState(track, t, 2, rand);
    const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0, ...(process.env.AGGR ? { boostChance: 1, boostReserve: 0 } : {}) }, t.boost.boostCost, t.corner.threshold, rand);
    let time = 0;
    while (car.lap <= laps && time < 600) {
      // MASH=1: 人の遊び方に近づける。コーナーの外ならゲージがあるたびにすぐ押す（立ち上がりで押す）
      if (process.env.MASH && !car.inCorner && car.boostCharge <= 0 && !car.isBoosting && car.gauge >= t.boost.boostCost) car.command('boost', time);
      // DRIVER=…: そのドライバーのEXを使えるたびに使う（チャージ系はその間ブースト連打、Wブーストは2段目も押す）
      if (process.env.DRIVER) {
        if (car.canEx()) car.command('ex', time);
        if (car.doubleReady) car.command('ex', time);
        if (car.exActive === 'hyperCharge' || car.exActive === 'capacitor') car.command('boost', time);
      }
      cpu.update(1 / 60, time);
      car.update(1 / 60);
      time += 1 / 60;
    }
    total += time;
  }
  return total / 4;
}

const wins: Record<string, number> = {};
const sum: Record<string, number> = {};
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const res = BOOSTERS.map((bo) => ({ bo, time: run(track, laps, applyBuild(base, { ...defaultBuild(), ...common, booster: `${bo}${RANK}` })) }));
  res.sort((a, b) => a.time - b.time);
  wins[res[0].bo] = (wins[res[0].bo] ?? 0) + 1;
  for (const r of res) sum[r.bo] = (sum[r.bo] ?? 0) + r.time;
  console.log(`${course.name.padEnd(10)} ${res.map((r) => `${r.bo} ${r.time.toFixed(1)}`).join('  ')}`);
}
console.log('\n合計と1位の数');
for (const bo of BOOSTERS.sort((a, b) => sum[a] - sum[b])) console.log(`  ${bo.padEnd(6)} ${sum[bo].toFixed(1)}s  1位 ${wins[bo] ?? 0}`);
