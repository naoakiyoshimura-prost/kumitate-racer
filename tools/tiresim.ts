// タイヤ径の比較: コースごとに、各タイヤ径でモーター/ギヤの組み合わせを試し、一番速いタイムを出す
// 超小・超大が「得意なコースだけ最強」になっているかを見る
// 実行: npm run tiresim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, type Build } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const SIZES = ['tiny', 'small', 'standard', 'large', 'huge'];
const MOTORS = ['torque', 'balance', 'speed'];
const GEARS = ['low', 'mid', 'high'];
const common: Partial<Build> = { rollerF: 'bearing', rollerR: 'bearing', shaft: 'bearing' };

let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function run(track: Track, laps: number, t: Tuning) {
  let total = 0;
  let outs = 0;
  const runs = 6;
  for (let r = 0; r < runs; r++) {
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
  return { time: total / runs, outs: outs / runs };
}

for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  const rows = SIZES.map((size) => {
    let best = { time: Infinity, outs: 0, combo: '' };
    for (const motor of MOTORS) for (const gear of GEARS) {
      const r = run(track, laps, applyBuild(base, { ...defaultBuild(), ...common, tireSize: size, motor, gear }));
      if (r.time < best.time) best = { ...r, combo: `${motor}/${gear}` };
    }
    return { size, ...best };
  });
  const top = Math.min(...rows.map((r) => r.time));
  console.log(`\n${course.name}（${laps}周）`);
  for (const r of rows) console.log(`  ${r.time === top ? '★' : ' '} ${r.size.padEnd(8)} ${r.time.toFixed(2)}s  コースアウト${r.outs.toFixed(1)}  ${r.combo}`);
}
