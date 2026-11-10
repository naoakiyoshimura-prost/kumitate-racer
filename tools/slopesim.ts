// 段階4の確認: バンクの横傾き・坂の頂上での自然な離陸・空中でのブースト時間（多段ブーストだけ止める）
// エディタでバンク入り・坂入りのレイアウトを組んで書き出し、標準マシンと最高速構成で走らせて、
// 「新しい項目なし（今までの扱い）」と「あり」を比べる。俯瞰モード相当（多段ブースト・時間の延長）の行もある
// 実行: npm run slopesim
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild } from '../src/setup';
import { build } from '../src/editor/geom';
import { toCourse } from '../src/editor/export';
import { courseFor } from '../src/courses';
import { fitMini } from '../src/miniCourse';
import type { Layout, PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const UP: PieceSpec = { type: 'slopeUp' };
const DOWN: PieceSpec = { type: 'slopeDown' };
const BI: PieceSpec = { type: 'bankIn' };
const BO: PieceSpec = { type: 'bankOut' };
const L4 = [L, L, L, L];
const lay = (name: string, pieces: PieceSpec[]): Layout => ({ version: 1, name, lanes: 3, pieces });

const LAYOUTS: Layout[] = [
  lay('バンク周回', [S, BI, ...L4, BO, S, ...L4]),
  lay('坂→平ら', [UP, ...L4, DOWN, ...L4]),
  lay('山（上り→下り）', [UP, DOWN, ...L4, S, S, S, S, ...L4]),
  lay('坂＋バンク', [UP, BI, ...L4, BO, DOWN, ...L4]),
];

const BUILDS: [string, Tuning][] = [
  ['標準', applyBuild(tuning as Tuning, defaultBuild())],
  ['最高速', applyBuild(tuning as Tuning, { ...defaultBuild(), motor: 'spd5', gear: 'g32', tireSize: 'huge', booster: 'pod25' })],
];

// 俯瞰モード相当の数値（src/main.ts miniTune と同じ考え方をここに写したもの。main.ts は node で読めないため）
function miniLike(t: Tuning): Tuning {
  const m = mini.speed.boostTimeMul;
  const b = t.boost;
  const multi = b.multi && { ...b.multi, chargeTime: b.multi.chargeTime.map((v) => v * m), duration: b.multi.duration.map((v) => v * m), chainWindow: b.multi.chainWindow * m };
  return { ...t, landing: { ...t.landing, maxOutChance: t.landing.maxOutChance * mini.landingOutMul }, boost: { ...b, regen: b.regen / m, duration: b.duration * m, chargeTime: (b.chargeTime ?? 0) * m, multi } };
}

interface Result {
  time: number;
  takeoffs: number;
  crest: number; // そのうち坂の頂上で浮いた回数
  clean: number;
  wobble: number;
  out: number;
  courseOuts: number;
  bankRoller: number; // バンク区間（横傾きのある所）で壁に当たっていた秒数
  bankTime: number; // バンク区間にいた秒数
  airBoost: number; // 空中にいる間にブーストが効いていた（残り時間があった）秒数
}

function run(course: CourseData, region: Track, t: Tuning, multi: boolean, dt: number, laps = 3): Result {
  const track = new Track(course);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const car = new CarState(track, t, 1, rand);
  car.multiBoost = multi;
  const r: Result = { time: 0, takeoffs: 0, crest: 0, clean: 0, wobble: 0, out: 0, courseOuts: 0, bankRoller: 0, bankTime: 0, airBoost: 0 };
  let lastLand = 0;
  let wasAir = false;
  while (car.lap <= laps && r.time < 400) {
    // 直線でブースト（多段は切れるたびに次の段）
    if (multi) {
      if (!car.inCorner && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', r.time);
    } else if (!car.inCorner && !car.isBoosting) car.command('boost', r.time);
    car.update(dt);
    if (car.airborne && !wasAir) r.takeoffs++;
    wasAir = car.airborne;
    if (car.airborne && car.isBoosting) r.airBoost += dt;
    if (car.lastLandingTime !== lastLand) {
      lastLand = car.lastLandingTime;
      if (car.lastLanding === 'clean') r.clean++;
      else if (car.lastLanding === 'wobble') r.wobble++;
      else if (car.lastLanding === 'out') r.out++;
    }
    if (region.bankAt(car.distance) !== 0 && !car.isOut) {
      r.bankTime += dt;
      if (car.onRoller) r.bankRoller += dt;
    }
    r.time += dt;
  }
  r.courseOuts = car.courseOuts;
  r.crest = car.crestTakeoffs;
  return r;
}

const fmt = (r: Result) =>
  `${r.time.toFixed(2).padStart(7)}s  ${String(r.takeoffs).padStart(3)}  ${`${r.clean}/${r.wobble}/${r.out}`.padStart(8)}  ${String(r.courseOuts).padStart(3)}   ${r.bankRoller.toFixed(2).padStart(5)}/${r.bankTime.toFixed(2).padStart(5)}s  ${r.airBoost.toFixed(2).padStart(5)}s`;

const VARIANTS: [string, (c: CourseData) => CourseData][] = [
  ['なし(従来)', (c) => ({ ...c, bank: undefined, crestTakeoff: false })],
  ['バンクだけ', (c) => ({ ...c, crestTakeoff: false })],
  ['離陸だけ', (c) => ({ ...c, bank: undefined })],
  ['両方', (c) => c],
];

console.log('エディタのコース（3レーン、3周、seed固定）。離陸=空中に上がった回数（ジャンプ台なしなので坂の頂上だけ）、着地=きれい/乱れ/アウト');
console.log('バンク壁=バンク区間で壁に当たっていた秒数/バンク区間にいた秒数、空中ブースト=空中でブーストの残り時間があった秒数');
for (const L of LAYOUTS) {
  const b = build(L);
  if (!b.check.closed) throw new Error(`${L.name} が閉じていない: ${b.check.messages.map((m) => m.text).join(' / ')}`);
  const full = toCourse(L);
  const region = new Track(full);
  const banks = full.bank ?? [];
  const maxBank = banks.length ? Math.max(...banks.map(Math.abs)) : 0;
  console.log(`\n■ ${L.name}  1周 ${region.length.toFixed(1)}m  最高 ${Math.max(...full.points.map((p) => p[2] ?? 0)).toFixed(2)}m  横傾き最大 ${maxBank.toFixed(1)}度`);
  console.log('マシン  モード            設定          タイム    離陸  着地        アウト  バンク壁           空中ブースト');
  for (const [bn, t] of BUILDS) {
    for (const [mode, tt, multi, dt] of [['クラシック', t, false, 1 / 60], ['俯瞰相当(多段)', miniLike(t), true, mini.speed.maxStep]] as const) {
      for (const [vn, f] of VARIANTS) {
        console.log(`${bn.padEnd(5)} ${mode.padEnd(14)} ${vn.padEnd(10)} ${fmt(run(f(full), region, tt, multi, dt))}`);
      }
    }
  }
}

// 俯瞰モードの既存コース（fitMini で crestTakeoff が付く）: 坂の頂上での離陸が起きるか
console.log('\n■ 俯瞰モードの既存コース（fitMini、俯瞰相当・多段ブースト）。なし=crestTakeoff を外したもの。離陸はジャンプ台・ウェーブを含み、( ) が坂の頂上');
console.log('コース     マシン  設定    タイム    離陸(うち頂上)  着地        アウト  空中ブースト');
for (const [id, mode] of [['updown3', 'open'], ['grand', 'walled'], ['circuit', 'walled'], ['lowtech', 'open']] as const) {
  const c = fitMini(courseFor(id, mode), mini.course);
  const region = new Track(c);
  for (const [bn, t] of BUILDS) {
    for (const [vn, cc] of [['なし', { ...c, crestTakeoff: false }], ['あり', c]] as const) {
      const r = run(cc, region, miniLike(t), true, mini.speed.maxStep);
      console.log(`${id.padEnd(9)} ${bn.padEnd(5)} ${vn.padEnd(4)} ${r.time.toFixed(2).padStart(7)}s  ${String(r.takeoffs).padStart(3)}(${r.crest})       ${`${r.clean}/${r.wobble}/${r.out}`.padStart(8)}  ${String(r.courseOuts).padStart(3)}    ${r.airBoost.toFixed(2).padStart(5)}s`);
    }
  }
}
