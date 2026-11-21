// 段階4の確認: バンクの横傾き・坂の頂上での自然な離陸・空中でのブースト時間（多段ブーストだけ止める）
// エディタで坂入りのレイアウトを組んで書き出し、標準マシンと最高速構成で走らせて、
// 「新しい項目なし（今までの扱い）」と「あり」を比べる。俯瞰モード相当（多段ブースト・時間の延長）の行もある
// 横傾き（CourseData.bank）は、(1) エディタの平らなレイアウトを書き出したあとにコーナーの間だけ横傾きの列をここで付けたもの（ゲーム側の計算の確認）と、
// (2) エディタのバンクアプローチで組んだ見本（傾いた面の上のコーナーで書き出しに横傾きが出る）の両方で確かめる
// 実行: npm run slopesim
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild } from '../src/setup';
import { build, sampleBankValley } from '../src/editor/geom';
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
const L4 = [L, L, L, L];
const lay = (name: string, pieces: PieceSpec[]): Layout => ({ version: 1, name, lanes: 3, pieces });

// エディタのレイアウトを書き出し、部品 i0〜i1−1 の間だけ横傾き deg·sin(π·進み) 度を付ける（+ は右が高い＝左回りの外側が高い）。
// 以前のエディタの「バンク入口→左コーナー180度→バンク戻り」とほぼ同じ横傾きの付き方（90度の所で最大20度）
function withLateralBank(l: Layout, i0: number, i1: number, deg: number): CourseData {
  const c = toCourse(l);
  const lens = build(l).placed.map((p) => p.length);
  const tot = lens.reduce((a, b) => a + b, 0);
  const u0 = lens.slice(0, i0).reduce((a, b) => a + b, 0) / tot;
  const u1 = lens.slice(0, i1).reduce((a, b) => a + b, 0) / tot;
  const n = c.points.length;
  const bank = c.points.map((_, i) => {
    const u = i / n; // 点は2m間隔なので点の番号の割合 ≈ 距離の割合
    return u > u0 && u < u1 ? Math.round(deg * Math.sin((Math.PI * (u - u0)) / (u1 - u0)) * 100) / 100 : 0;
  });
  return { ...c, bank };
}
function editor(l: Layout): CourseData {
  const b = build(l);
  if (!b.check.closed) throw new Error(`${l.name} が閉じていない: ${b.check.messages.map((m) => m.text).join(' / ')}`);
  return toCourse(l);
}

const COURSES: [string, CourseData][] = [
  ['バンク周回（横傾き20度をCourseDataで付けたもの）', withLateralBank(lay('楕円', [S, S, ...L4, S, S, ...L4]), 2, 6, 20)],
  ['坂→平ら', editor(lay('坂→平ら', [UP, ...L4, DOWN, ...L4]))],
  ['山（上り→下り）', editor(lay('山', [UP, DOWN, ...L4, S, S, ...L4]))],
  ['坂＋横傾き（坂の上のコーナーに横傾き20度をCourseDataで付けたもの）', withLateralBank(lay('坂', [UP, S, ...L4, S, DOWN, ...L4]), 2, 6, 20)],
  // エディタのバンクアプローチで組んだ定番の並び: アプローチ→180度（傾いた面）→アプローチ→谷→スロープ上り→直線4枚→180度。40度はアプローチを2枚重ねたもの
  ...([1, 2] as const).map((k): [string, CourseData] => [`定番の並び（エディタのバンクアプローチ${k}枚=${20 * k}度）`, editor(sampleBankValley(3, k))]),
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
for (const [name, full] of COURSES) {
  const region = new Track(full);
  const banks = full.bank ?? [];
  const maxBank = banks.length ? Math.max(...banks.map(Math.abs)) : 0;
  console.log(`\n■ ${name}  1周 ${region.length.toFixed(1)}m  最高 ${Math.max(...full.points.map((p) => p[2] ?? 0)).toFixed(2)}m  横傾き最大 ${maxBank.toFixed(1)}度`);
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

// 見本「定番の並び」（バンクアプローチ1枚・2枚）で、スロープ上りから飛んだ距離（直線1枚=540mm の枚数）。ブレーキ無し、乱数の種7、3周の平均[最小〜最大]。
// 目標（店長の実物の経験）: ブレーキ無しの標準マシンで直線3〜4枚。数値は tuning.json air.crest（仮設定）
console.log(`\n■ 見本「定番の並び」のスロープからの飛距離（ブレーキ無し、直線1枚=540mm の枚数、3周の平均[最小〜最大]）。air.crest.gravity=${(tuning as Tuning).air.crest?.gravity}`);
console.log('見本            マシン  モード            飛距離(枚)              離陸の速さ(m/s)');
for (const k of [1, 2] as const) {
  const l = sampleBankValley(3, k);
  const b = build(l);
  const course = toCourse(l);
  const track = new Track(course);
  const si = l.pieces.findIndex((p) => p.type === 'start');
  const placed = [...b.placed.slice(si), ...b.placed.slice(0, si)];
  const cum: number[] = [0];
  for (const p of placed) cum.push(cum[cum.length - 1] + p.length);
  const at = (i: number) => (cum[i] / cum[cum.length - 1]) * track.length;
  const iS = placed.findIndex((p) => p.spec.type === 'slopeUp');
  const from = at(iS), to = at(iS + 5); // スロープ＋着地用の直線4枚
  const piece = (540 * 3.38) / 165;
  for (const [bn, t] of BUILDS)
    for (const [mode, tt, multi, dt] of [['クラシック', t, false, 1 / 60], ['俯瞰相当(多段)', miniLike(t), true, mini.speed.maxStep]] as const) {
      let seed = 7;
      const car = new CarState(track, tt, 1, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
      car.multiBoost = multi;
      const fl: number[] = [];
      const vs: number[] = [];
      let time = 0, was = false, start = -1;
      while (car.lap <= 3 && time < 400) {
        if (multi) {
          if (!car.inCorner && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', time);
        } else if (!car.inCorner && !car.isBoosting) car.command('boost', time);
        car.update(dt);
        if (car.airborne && !was && car.distance >= from && car.distance < to) { start = car.distance; vs.push(car.speed); }
        if (!car.airborne && was && start >= 0) { fl.push((car.distance - start + track.length) % track.length / piece); start = -1; }
        was = car.airborne;
        time += dt;
      }
      const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
      const cell = fl.length ? `${avg(fl).toFixed(2)} [${Math.min(...fl).toFixed(2)}〜${Math.max(...fl).toFixed(2)}]` : '飛ばない';
      console.log(`${`アプローチ${k}枚`.padEnd(12)} ${bn.padEnd(5)} ${mode.padEnd(14)} ${cell.padEnd(22)}  ${avg(vs).toFixed(1)}`);
    }
}
