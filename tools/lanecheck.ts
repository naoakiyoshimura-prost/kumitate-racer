// 仕切りレーンのコースで、立体交差を通るたびにレーンが 1→2→3→1 と入れ替わるかを確かめる
// 実行: npx esbuild tools/lanecheck.ts --bundle --platform=node --format=esm --outfile=dist/lanecheck.mjs && node dist/lanecheck.mjs
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild } from '../src/setup';
import { courseById } from '../src/courses';
import tuning from '../src/data/tuning.json';

const track = new Track(courseById('triple'));
const t = applyBuild(tuning as Tuning, defaultBuild());
for (const lane of [0, 1, 2]) {
  const car = new CarState(track, t, lane);
  const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, Math.random);
  const seen: number[] = [car.chan];
  let time = 0;
  let maxOff = 0;
  let maxLift = 0;
  while (car.lap <= 3 && time < 300) {
    cpu.update(1 / 60, time);
    car.update(1 / 60);
    time += 1 / 60;
    if (seen[seen.length - 1] !== car.chan) seen.push(car.chan);
    if (!car.isOut) maxOff = Math.max(maxOff, Math.abs(car.lat - car.wallCenter) - car.wallHalf);
    maxLift = Math.max(maxLift, car.lift);
  }
  console.log(`スタート${lane + 1}レーン: ${time.toFixed(1)}s レーン順 ${seen.map((c) => c + 1).join('→')} コースアウト${car.courseOuts} 壁はみ出し${maxOff.toFixed(2)}m 橋の最高${maxLift.toFixed(1)}m`);
}
