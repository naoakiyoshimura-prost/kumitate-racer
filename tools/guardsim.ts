// ローラーの装備（2段/3段・ゴムリング・スタビ）の効きを比べる（俯瞰モードのテストコース3種×3/5レーン、テストプレイの車）
// 実行: npx esbuild tools/guardsim.ts --bundle --platform=node --format=esm --outfile=dist/guardsim.mjs && node dist/guardsim.mjs [周回数]
// 見るもの: 装備なしと比べて、コースアウトの回数が減り、その分「減速で済んだ回数」が出るか。装備なしは今までとまったく同じになるか
// 注意: thrustsim と同じく、俯瞰モードの調整（main.ts miniTune）のうち橋とジャンプに要る分だけ足している
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, type Build } from '../src/setup';
import { fitMini } from '../src/miniCourse';
import { toCourse } from '../src/editor/export';
import { PLAY_CARS, playBuild } from '../src/playtest';
import { testCourseLayout, type TestCourseId } from '../src/playCourses';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const DT = mini.speed.maxStep;
const LAPS = Number(process.argv[2] ?? 30);
const lj = mini.lcJump;
const KITS: [string, Partial<Build>][] = [['なし', {}], ['2段', { rollerStage: '2' }], ['3段', { rollerStage: '3' }], ['3段+ゴム+スタビ', { rollerStage: '3', rollerRing: '1', stabi: '1' }]];
console.log(`各${LAPS}周、ブーストは撃てる時に毎回撃つ（壁に強く当たる場面を多めに作る）`);
const allImp: number[] = [];
const sum = KITS.map(() => ({ out: 0, save: 0, time: 0, fly: 0 }));
for (const c of ['tc1', 'tc2', 'tc3'] as TestCourseId[]) for (const lanes of [3, 5] as const) {
  const track = new Track(fitMini(toCourse(testCourseLayout(c, lanes), 'custom'), mini.course));
  for (const [i, pc] of PLAY_CARS.entries()) {
    const row: string[] = [];
    KITS.forEach(([, kit], k) => {
      const base = applyBuild(tuning as Tuning, { ...playBuild(i), ...kit } as Build);
      const mc = mini as any;
      const t: Tuning = { ...base,
        landing: { ...base.landing, maxOutChance: base.landing.maxOutChance * mc.landingOutMul, bounce: mc.bounce.on ? mc.bounce : undefined },
        air: { ...base.air, flightGravityMul: mc.jump.gravityMul, airSpeedMul: mc.jump.airSpeedMul, flyOut: { width: mc.flyOut.width, load: mc.flyOut.load }, steep: { climbMin: mc.steep.climbMin, noCrestSlope: mc.steep.noCrestSlope, noCrestUp: mc.steep.noCrestUp }, lcRamp: mc.lcRamp?.on ? { angleDeg: mc.lcRamp.angleDeg } : undefined, lcJump: { ...lj } } as any,
        corner: { ...base.corner, rollerDrag: base.corner.rollerDrag * mc.roller.dragMul, impactDrag: base.corner.impactDrag * mc.roller.impactMul / Math.sqrt(mc.roller.dragMul) } };
      let seed = 7 + i * 31;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const car = new CarState(track, t, 0, rand);
      car.multiBoost = true;
      car.impactLog = [];
      let time = 0;
      while (car.lap <= LAPS && time < LAPS * 200) {
        if (car.multiNext > 0 && car.multiCharge === 0) car.command('boost', time);
        car.update(DT);
        time += DT;
      }
      if (k === 0) allImp.push(...car.impactLog);
      sum[k].fly += car.flyOuts;
      sum[k].out += car.courseOuts; sum[k].save += car.guardSaves; sum[k].time += time;
      row.push(`${String(car.courseOuts).padStart(3)}/${String(car.guardSaves).padStart(3)} ${(time / LAPS).toFixed(2)}s`);
    });
    console.log(`${c} ${lanes}L ${pc.name.padEnd(10)} ${row.join(' | ')}`);
  }
}
console.log('合計（コースアウト/減速で済んだ/1周平均）');
KITS.forEach(([n], k) => console.log(`${n.padEnd(14)} ${sum[k].out} / ${sum[k].save}（うちコーナーで飛び出し ${sum[k].fly}）`));
const bins = [0.8, 0.9, 1.0, 1.03, 1.07, 1.15, 1.5, 3, 99];
console.log('壁に当たった勢い（限界=1.00）の分布（装備なし）');
for (let b = 0; b < bins.length - 1; b++) console.log(`${bins[b].toFixed(2)}〜${bins[b + 1].toFixed(2)}: ${allImp.filter((v) => v >= bins[b] && v < bins[b + 1]).length}`);
