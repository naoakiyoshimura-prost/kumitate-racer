// テストプレイ（セッティング）の5台の性格を測る: テストコース3種（3レーン）をブーストなしで走らせ、1周のタイム・コースアウト・最高速/加速を出す
// 実行: npx esbuild tools/setcars.ts --bundle --platform=node --format=esm --outfile=dist/setcars.mjs && node dist/setcars.mjs [周回数] [候補のJSONファイル]
// 候補のJSONファイル: [{ "name": "...", "build": { 部位: id, ... } }, ...]（defaultBuild に重ねる）。省略時はテストプレイの5台（SET_CARS）
// 注意: guardsim と同じく、俯瞰モードの調整（main.ts miniTune）のうち走りに要る分だけ足している
import './browserstub';
import { readFileSync } from 'node:fs';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild, fixFit, type Build } from '../src/setup';
import { fitMini } from '../src/miniCourse';
import { toCourse } from '../src/editor/export';
import { SET_CARS, setBuild } from '../src/playtest';
import { testCourseLayout, type TestCourseId } from '../src/playCourses';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const DT = mini.speed.maxStep;
const LAPS = Number(process.argv[2] ?? 5);
const file = process.argv[3];
const cands: { name: string; build: Build }[] = file
  ? (JSON.parse(readFileSync(file, 'utf8')) as { name: string; build: Partial<Build> }[]).map((c) => ({ name: c.name, build: { ...defaultBuild(), ...c.build } as Build }))
  : SET_CARS.map((c, i) => ({ name: c.name, build: setBuild(i) }));
const mc = mini as any;
function miniLike(base: Tuning): Tuning {
  return { ...base,
    spin: base.spin && { ...base.spin, speedKeep: mc.spin.speedKeep, drag: mc.spin.drag, idleMul: mc.spin.idleMul, walledOff: process.env.OLDSPIN ? false : mc.spin.walledOff },
    landing: { ...base.landing, maxOutChance: base.landing.maxOutChance * mc.landingOutMul, bounce: mc.bounce.on ? mc.bounce : undefined },
    air: { ...base.air, flightGravityMul: mc.jump.gravityMul, airSpeedMul: mc.jump.airSpeedMul, flyOut: { width: mc.flyOut.width, load: mc.flyOut.load }, steep: { climbMin: mc.steep.climbMin, noCrestSlope: mc.steep.noCrestSlope, noCrestUp: mc.steep.noCrestUp }, lcRamp: mc.lcRamp?.on ? { angleDeg: mc.lcRamp.angleDeg } : undefined, lcJump: { ...mc.lcJump } } as any,
    corner: { ...base.corner, rollerDrag: base.corner.rollerDrag * mc.roller.dragMul, impactDrag: base.corner.impactDrag * mc.roller.impactMul / Math.sqrt(mc.roller.dragMul) } };
}
// LAYOUT=コースのJSON（エディタの Layout）を渡すと、そのコースだけで走らせる（店長の作ったコースで確かめる時）
const lay = process.env.LAYOUT ? JSON.parse(readFileSync(process.env.LAYOUT, 'utf8')) : null;
const courses: string[] = lay ? ['custom'] : ['tc1', 'tc2', 'tc3'];
const tracks = lay ? [new Track(fitMini(toCourse(lay, 'custom'), mini.course))] : (courses as TestCourseId[]).map((c) => new Track(fitMini(toCourse(testCourseLayout(c, 3), 'custom'), mini.course)));
if (lay) console.log(`コース: ${lay.name}（${lay.lanes}レーン、1周 ${tracks[0].length.toFixed(0)}m ゲーム内）`);
console.log(`3レーン・ブーストなし・各${LAPS}周。1周の平均秒（コースアウト回数）`);
console.log('マシン                 最高速  加速   重さg  ' + courses.join('            '));
for (const c of cands) {
  const fixed = fixFit(c.build);
  const t = miniLike(applyBuild(tuning as Tuning, c.build));
  if (process.env.ROLL) console.log(c.name, JSON.stringify({ rollerDrag: t.corner.rollerDrag, grip: t.corner.grip, gripWide: t.corner.gripWide, df: t.corner.downforce, thrust: t.car.thrust, minGrip: t.tire.minGrip, aeroDf: (t as any).aero?.downforce, rdm: (t as any).aero?.rollerDragMul, under: (t.corner as any).underMul }));
  const cols = tracks.map((track, k) => {
    let seed = 11 + k * 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const car = new CarState(track, t, 1, rand);
    let time = 0;
    const probe: Record<string, any> = {};
    let rol = 0, vmax = 0, vsum = 0;
    while (car.lap <= LAPS && time < LAPS * 300) { car.update(DT); time += DT; if (car.onRoller) rol += DT; if (process.env.PROBE && car.lap >= 2) { const kd = track.partKindAt(car.distance); const isC = kd === 'cornerL' || kd === 'cornerR'; const key = isC ? 'C' : 'S'; const pr = (probe[key] ??= { t: 0, v: 0, r: 0, vmin: 1e9, k: 0, lat: 0 }); pr.t += DT; pr.v += car.speed * DT; pr.r += car.onRoller ? DT : 0; pr.vmin = Math.min(pr.vmin, car.speed); pr.k += track.curvatureAt(car.distance).k * DT; pr.lat += Math.abs(car.lat) * DT; } vmax = Math.max(vmax, car.speed); vsum += car.speed * DT; }
    if (process.env.PROBE) for (const [kk, pr] of Object.entries(probe)) console.log(c.name, kk, `時間${pr.t.toFixed(1)}s 平均${(pr.v / pr.t).toFixed(1)} 最低${pr.vmin.toFixed(1)} ローラー${(pr.r / pr.t * 100).toFixed(0)}% k${(pr.k / pr.t).toFixed(4)} |lat|${(pr.lat / pr.t).toFixed(2)}`);
    return `${(time / LAPS).toFixed(2)}s(${String(car.courseOuts).padStart(2)})` + (process.env.ROLL ? ` スピン${car.spins} ローラー${(rol / time * 100).toFixed(0)}% 平均${(vsum / time).toFixed(1)}` : '');
  });
  console.log(`${c.name.padEnd(18)} ${t.car.maxSpeed.toFixed(1).padStart(6)} ${t.car.accel.toFixed(1).padStart(5)} ${(t.car.grams ?? 0).toFixed(0).padStart(6)}  ${cols.join('   ')}${fixed.length ? `  ※合わない部品を戻した: ${fixed.map((f) => f.join('=')).join(',')}` : ''}`);
}
