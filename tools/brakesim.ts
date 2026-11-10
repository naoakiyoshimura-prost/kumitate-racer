// スポンジブレーキの確認: 坂・バンク入りのコースで、ブレーキ無しと代表的な設定を比べる
// - エディタの部品で組んだコース（tools/slopesim.ts と同じ組み方。横傾きは CourseData に後から付けたもの）
// - 急坂の谷のコース（店長の定番の並び: 急坂を上る→180度コーナー→急坂を下る→スロープを上る→直線に着地→コーナー）。
//   3) は CourseData の points をここで直接作った版（急坂の角度20/30/40度・高さ・つなぎの半径は仮。以前からの比較用に残す）、
//   4) はエディタの新しいバンク部品（角度つきの坂）で組んだ版（見本 sampleBankValley。寸法はエディタの表の仮設定）
// 乱数の種を複数回して平均する（乱数は着地の乱れ・コースアウトにだけ使われる）
// 実行: npm run brakesim
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild, type Build } from '../src/setup';
import { build as buildLayout, sampleBankValley } from '../src/editor/geom';
import { dim } from '../src/editor/catalog';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { Layout, PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';

const base = tuning as Tuning;
const SEEDS = [7, 11, 23, 101, 977];
const DT = 1 / 60;
const LAPS = 3;
const MM = MM_TO_GAME;
const STRAIGHT_M = 540 * MM; // 直線1枚（540mm）のゲームでの長さ

// ---- コース ----
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const UP: PieceSpec = { type: 'slopeUp' };
const DOWN: PieceSpec = { type: 'slopeDown' };
const L4 = [L, L, L, L];
const lay = (name: string, pieces: PieceSpec[]): Layout => ({ version: 1, name, lanes: 3, pieces });
const FLAT = lay('平ら（対照）', [S, ...L4, S, ...L4]);
function editorCourse(l: Layout): CourseData {
  if (!buildLayout(l).check.closed) throw new Error(`${l.name} が閉じていない`);
  return toCourse(l);
}
// 部品 i0〜i1−1 の間だけ横傾き deg·sin(π·進み) 度を付ける（ゲーム側の横傾きの計算の確認用。tools/slopesim.ts と同じ）
function withLateralBank(l: Layout, i0: number, i1: number, deg: number): CourseData {
  const c = editorCourse(l);
  const lens = buildLayout(l).placed.map((p) => p.length);
  const tot = lens.reduce((a, b) => a + b, 0);
  const u0 = lens.slice(0, i0).reduce((a, b) => a + b, 0) / tot;
  const u1 = lens.slice(0, i1).reduce((a, b) => a + b, 0) / tot;
  const n = c.points.length;
  const bank = c.points.map((_, i) => {
    const u = i / n;
    return u > u0 && u < u1 ? Math.round(deg * Math.sin((Math.PI * (u - u0)) / (u1 - u0)) * 100) / 100 : 0;
  });
  return { ...c, bank };
}
const LAYOUTS: [string, CourseData][] = [
  ['坂→平ら', editorCourse(lay('坂→平ら', [UP, ...L4, DOWN, ...L4]))],
  ['山（上り→下り）', editorCourse(lay('山', [UP, DOWN, ...L4, S, S, S, S, ...L4]))],
  ['横傾き周回（コーナーに横傾き20度）', withLateralBank(lay('楕円', [S, S, ...L4, S, S, ...L4]), 2, 6, 20)],
  ['坂＋横傾き（坂の上のコーナーに横傾き20度）', withLateralBank(lay('坂', [UP, S, ...L4, S, DOWN, ...L4]), 2, 6, 20)],
];

// 急坂の谷のコース。高さの形は横方向の距離 x (mm) の関数を区間ごとにつなぐ
interface Seg { len: number; h: (x: number) => number } // len: 横方向の長さ (mm)、h: 区間の入口からの高さ (mm、絶対値)
const flat = (len: number, h0: number): Seg => ({ len, h: () => h0 });
// エディタのスロープと同じ形（H(1−cos πt)/2、長さ 1080mm・高さ 110mm）
const slope = (h0: number, dh: number, len = 1080): Seg => ({ len, h: (x) => h0 + (dh * (1 - Math.cos((Math.PI * x) / len))) / 2 });
// 急坂: 角度 deg、高さ rise、上り下りのつなぎは半径 rt の円弧（仮）
function steep(h0: number, rise: number, deg: number, up: boolean, rt = 400): Seg {
  const a = (deg * Math.PI) / 180;
  const ax = rt * Math.sin(a);
  const ah = rt * (1 - Math.cos(a));
  const mid = (rise - 2 * ah) / Math.tan(a);
  if (mid < 0) throw new Error('急坂のつなぎが高さに収まらない');
  const len = 2 * ax + mid;
  const climb = (x: number) => {
    if (x < ax) return rt - Math.sqrt(rt * rt - x * x);
    if (x < ax + mid) return ah + (x - ax) * Math.tan(a);
    const u = len - x;
    return rise - (rt - Math.sqrt(rt * rt - u * u));
  };
  return { len, h: (x) => (up ? h0 + climb(x) : h0 + rise - climb(x)) };
}
const STEEP_RISE = 250; // 急坂の高さ (mm、仮)
const SLOPE_RISE = 110;
const LAND_PIECES = 4;
interface Valley { course: CourseData; jumpFrom: number; jumpTo: number; landFrom: number; hit?: (d: number) => boolean; bankHit?: (d: number) => boolean } // 横方向の位置 (m、直線Bの入口から)。hit があればそれで判定（コース上の距離）
function valleyCourse(deg: number): Valley {
  const A: Seg[] = [slope(SLOPE_RISE, -SLOPE_RISE), flat(540, 0), steep(0, STEEP_RISE, deg, true), flat(540, STEEP_RISE)];
  const B: Seg[] = [steep(0, STEEP_RISE, deg, false), slope(0, SLOPE_RISE), flat(540 * LAND_PIECES, SLOPE_RISE)];
  const lenOf = (s: Seg[]) => s.reduce((a, x) => a + x.len, 0);
  const pad = lenOf(A) - lenOf(B);
  if (pad > 0) B.push(flat(pad, SLOPE_RISE));
  else A.push(flat(-pad, STEEP_RISE));
  const straight = lenOf(A) * MM;
  const R = 517.5 * MM; // コーナーの中心線の半径（エディタの3レーンと同じ）
  const hAt = (segs: Seg[], x: number) => {
    let at = 0;
    for (const s of segs) {
      if (x <= at + s.len) return s.h(x - at);
      at += s.len;
    }
    const last = segs[segs.length - 1];
    return last.h(last.len);
  };
  // 平面: 直線A（+x）→ 左180度 → 直線B（−x）→ 左180度
  const total = 2 * straight + 2 * Math.PI * R;
  const pts: [number, number, number][] = [];
  for (let p = 0; p < total - 1; p += 2) {
    let x: number, z: number, h: number;
    if (p < straight) [x, z, h] = [p, 0, hAt(A, p / MM)];
    else if (p < straight + Math.PI * R) {
      const th = (p - straight) / R;
      [x, z, h] = [straight + R * Math.sin(th), -R * (1 - Math.cos(th)), STEEP_RISE];
    } else if (p < 2 * straight + Math.PI * R) {
      const q = p - straight - Math.PI * R;
      [x, z, h] = [straight - q, -2 * R, hAt(B, q / MM)];
    } else {
      const th = (p - 2 * straight - Math.PI * R) / R;
      [x, z, h] = [-R * Math.sin(th), -2 * R + R * (1 - Math.cos(th)), SLOPE_RISE];
    }
    pts.push([x, z, h * MM]);
  }
  const tpl = editorCourse(lay('型', [S, ...L4, S, ...L4]));
  const sx = B[0].len * MM; // 直線Bのスロープの入口
  return {
    course: { ...tpl, id: 'valley', name: `急坂${deg}度の谷`, points: pts, laps: LAPS },
    jumpFrom: sx,
    jumpTo: sx + B[1].len * MM + 540 * LAND_PIECES * MM,
    landFrom: sx + B[1].len * MM,
  };
}

// ---- マシンと設定 ----
const MACHINES: [string, Build][] = [
  ['標準', defaultBuild()],
  ['最高速', { ...defaultBuild(), motor: 'spd5', gear: 'g32', tireSize: 'huge', booster: 'pod25' }],
];
type Setting = [string, string | undefined, string | undefined]; // 名前, brakeF, brakeR（高さ-強さ-場所）
const SETTINGS: Setting[] = [
  ['なし', undefined, undefined],
  ['前 低強外', 'low-strong-out', undefined],
  ['後 低強外', undefined, 'low-strong-out'],
  ['両 低強外', 'low-strong-out', 'low-strong-out'],
  ['両 低弱外', 'low-weak-out', 'low-weak-out'],
  ['両 低中外', 'low-mid-out', 'low-mid-out'],
  ['両 中中中', 'mid-mid-mid', 'mid-mid-mid'],
  ['両 高強外', 'high-strong-out', 'high-strong-out'],
  ['後 低強中', undefined, 'low-strong-mid'],
  ['後 低強軸', undefined, 'low-strong-axle'],
  ['前高弱+後低強外', 'high-weak-out', 'low-strong-out'],
  // リヤの姿勢の効きだけを見る（高い・弱いので減速は小さい。場所だけ替える）
  ['後 高弱外', undefined, 'high-weak-out'],
  ['後 高弱中', undefined, 'high-weak-mid'],
  ['後 高弱軸', undefined, 'high-weak-axle'],
];
const TIRES = ['tiny', 'standard', 'huge'] as const;
const TIRE_NAME = { tiny: '超小22', standard: '中26', huge: '超大32' };

interface Result { bankTakeoffs: number; time: number; tF: number; tR: number; loss: number; takeoffs: number; clean: number; wobble: number; out: number; courseOuts: number; flights: number[]; jumpTakeoffs: number }
function run(course: CourseData, t: Tuning, seed: number, valley?: Valley): Result {
  const track = new Track(course);
  let sd = seed;
  const rand = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const car = new CarState(track, t, 1, rand);
  const r: Result = { bankTakeoffs: 0, time: 0, tF: 0, tR: 0, loss: 0, takeoffs: 0, clean: 0, wobble: 0, out: 0, courseOuts: 0, flights: [], jumpTakeoffs: 0 };
  let lastLand = 0;
  let wasAir = false;
  let from = -1; // 谷の後のスロープで離陸した距離
  // 直線Bの横方向の位置（谷のコースだけ）: 直線Bは z = −2R を −x へ走る
  const bPos = (d: number) => {
    const p = track.frameAt(d).position;
    const x0 = Math.max(...course.points.map((q) => q[0]));
    return Math.abs(p.z - course.points.reduce((m, q) => Math.min(m, q[1]), 0)) < 0.5 ? x0 - p.x : -1;
  };
  while (car.lap <= LAPS && r.time < 400) {
    if (!car.inCorner && !car.isBoosting) car.command('boost', r.time);
    car.update(DT);
    if (car.airborne && !wasAir) {
      r.takeoffs++;
      if (valley) {
        if (valley.bankHit?.(car.distance)) r.bankTakeoffs++;
        const inWin = valley.hit ? valley.hit(car.distance) : ((b) => b >= valley.jumpFrom && b <= valley.jumpTo)(bPos(car.distance));
        if (inWin) {
          from = car.distance;
          r.jumpTakeoffs++;
        }
      }
    }
    if (!car.airborne && wasAir && from >= 0) {
      r.flights.push((car.distance - from + track.length) % track.length);
      from = -1;
    }
    wasAir = car.airborne;
    if (car.lastLandingTime !== lastLand) {
      lastLand = car.lastLandingTime;
      if (car.lastLanding === 'clean') r.clean++;
      else if (car.lastLanding === 'wobble') r.wobble++;
      else if (car.lastLanding === 'out') r.out++;
    }
    r.time += DT;
  }
  r.courseOuts = car.courseOuts;
  r.tF = car.spongeTimeF;
  r.tR = car.spongeTimeR;
  r.loss = car.spongeLoss;
  return r;
}
// 種ごとの平均
function avg(course: CourseData, t: Tuning, valley?: Valley) {
  const rs = SEEDS.map((s) => run(course, t, s, valley));
  const m = (f: (r: Result) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const fl = rs.flatMap((r) => r.flights);
  return {
    time: m((r) => r.time), tF: m((r) => r.tF), tR: m((r) => r.tR), loss: m((r) => r.loss), takeoffs: m((r) => r.takeoffs),
    clean: m((r) => r.clean), wobble: m((r) => r.wobble), out: m((r) => r.out), courseOuts: m((r) => r.courseOuts),
    flight: fl.length ? fl.reduce((a, b) => a + b, 0) / fl.length / STRAIGHT_M : NaN,
    flightMin: fl.length ? Math.min(...fl) / STRAIGHT_M : NaN,
    flightMax: fl.length ? Math.max(...fl) / STRAIGHT_M : NaN,
    jumps: m((r) => r.jumpTakeoffs),
    bankJumps: m((r) => r.bankTakeoffs),
  };
}
// 標準=タイヤそのまま。最高速構成は超大径なので、低くしてもゆるい坂では当たりにくい
const tuned = (b: Build, s: Setting, tire?: string) => applyBuild(base, { ...b, ...(tire ? { tireSize: tire } : {}), brakeF: s[1], brakeR: s[2] });
const n1 = (v: number, w = 5) => v.toFixed(1).padStart(w);
const n2 = (v: number, w = 5) => v.toFixed(2).padStart(w);
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
const HEAD = `${pad('マシン', 8)}${pad('設定', 18)}  タイム   差    当たり前/後(秒)  失速(m/s)  離陸  着地 きれい/乱れ/アウト  コースアウト`;
const row = (mn: string, sn: string, r: ReturnType<typeof avg>, ref: number) =>
  `${pad(mn, 8)}${pad(sn, 18)} ${n2(r.time, 7)}s ${((r.time - ref >= 0 ? "+" : "") + (r.time - ref).toFixed(2)).padStart(6)}  ${n2(r.tF)}/${n2(r.tR)}      ${n1(r.loss, 6)}   ${n1(r.takeoffs, 4)}   ${n1(r.clean, 4)}/${n1(r.wobble, 4)}/${n1(r.out, 4)}       ${n1(r.courseOuts, 4)}`;

console.log(`スポンジブレーキ比較（3周、乱数の種 ${SEEDS.length}本の平均: ${SEEDS.join(',')}）。数値は tuning.json brake の仮設定`);
console.log('設定は「高さ・強さ・場所」（場所: 外=フロントは先端寄り、リヤは後端寄り／軸=車軸寄り）。差=同じマシンのブレーキ無しとの差');
console.log('当たり=ブレーキが路面に当たっていた累計秒数、失速=ブレーキで失った速さの累計、離陸=空中に上がった回数（坂の頂上）');

// 0) 平らなコースでは当たらない（全設定・全タイヤ径）
{
  const c = editorCourse(FLAT);
  let touched = 0;
  let changed = 0;
  for (const [, b] of MACHINES) {
    for (const tire of TIRES) {
      const ref = avg(c, tuned(b, SETTINGS[0], tire)).time;
      for (const s of SETTINGS) {
        const r = avg(c, tuned(b, s, tire));
        touched += r.tF + r.tR;
        if (r.time !== ref) changed++;
      }
    }
  }
  console.log(`\n■ ${FLAT.name}: ${MACHINES.length}マシン×タイヤ径${TIRES.length}種×設定${SETTINGS.length}通り → 当たり時間の合計 ${touched.toFixed(2)}秒、ブレーキ無しとタイムが違う組 ${changed}`);
}

// 1) エディタのコース × 設定 × マシン（タイヤはそのマシンのまま）
for (const [name, c] of LAYOUTS) {
  console.log(`\n■ ${name}（1周 ${new Track(c).length.toFixed(1)}m）`);
  console.log(HEAD);
  for (const [mn, b] of MACHINES) {
    const ref = avg(c, tuned(b, SETTINGS[0])).time;
    for (const s of SETTINGS) console.log(row(mn, s[0], avg(c, tuned(b, s)), ref));
  }
}

// 2) タイヤ径で当たり方が変わるか（同じ設定、タイヤ径だけ替える）
console.log('\n■ タイヤ径の比較（坂＋横傾き）。隙間 = 高さ + (径−26mm)×tireGap');
console.log(HEAD);
{
  const c = LAYOUTS[3][1];
  for (const [mn, b] of MACHINES) {
    for (const tire of TIRES) {
      const ref = avg(c, tuned(b, SETTINGS[0], tire)).time;
      for (const s of [SETTINGS[0], SETTINGS[3], SETTINGS[6]]) console.log(row(`${mn}${TIRE_NAME[tire]}`, s[0], avg(c, tuned(b, s, tire)), ref));
    }
  }
}

// 3) 急坂の谷 → スロープで飛ぶ → 直線4枚に着地。飛距離を直線の枚数で出す
console.log(`\n■ 急坂の谷（急坂を上る→180度→急坂を下る→スロープを上る→直線${LAND_PIECES}枚→コーナー）。points を直接作ったシミュ用コース`);
console.log(`  急坂の高さ ${STEEP_RISE}mm・つなぎ半径400mm（仮）。飛距離=谷の後のスロープで離陸してから着地までの距離を直線1枚(540mm)で割った枚数（平均[最小〜最大]）`);
for (const deg of [20, 30, 40]) {
  const v = valleyCourse(deg);
  console.log(`\n□ 急坂 ${deg}度（1周 ${new Track(v.course).length.toFixed(1)}m）`);
  console.log(`${HEAD}  スロープ離陸/周  飛距離(枚)`);
  for (const [mn, b] of MACHINES) {
    const ref = avg(v.course, tuned(b, SETTINGS[0]), v).time;
    for (const s of SETTINGS) {
      const r = avg(v.course, tuned(b, s), v);
      const fl = Number.isNaN(r.flight) ? '   飛ばない' : `${n2(r.flight)} [${r.flightMin.toFixed(2)}〜${r.flightMax.toFixed(2)}]`;
      console.log(`${row(mn, s[0], r, ref)}   ${n1(r.jumps / LAPS, 4)}       ${fl}`);
    }
  }
}

// 4) エディタの新しいバンク部品で組んだ谷（見本「定番の並び」: スタート→直線3→バンク上り→180度→バンク下り→スロープ上り→直線4→180度→スロープ下り）
// 離陸の判定は「谷の後のスロープの入口〜着地用の直線4枚の終わり」（コース上の距離。エディタの部品の長さの割合を Track の長さに当てる）
function editorValley(deg: 20 | 30 | 40): Valley {
  const l = sampleBankValley(3, deg);
  const b = buildLayout(l);
  if (!b.check.closed) throw new Error(`${l.name} が閉じていない`);
  const course = { ...toCourse(l), id: `valley-ed${deg}`, laps: LAPS };
  const len = new Track(course).length;
  const cum: number[] = [0];
  for (const p of b.placed) cum.push(cum[cum.length - 1] + p.length);
  const tot = cum[cum.length - 1];
  const iS = l.pieces.findIndex((p) => p.type === 'slopeUp');
  const d0 = (cum[iS] / tot) * len;
  const d1 = (cum[iS + 1 + LAND_PIECES] / tot) * len;
  const iD = l.pieces.findIndex((p) => p.type === 'bankDown');
  const b0 = (cum[iD] / tot) * len;
  return { course, jumpFrom: d0, jumpTo: d1, landFrom: (cum[iS + 1] / tot) * len, hit: (d) => d >= d0 && d <= d1, bankHit: (d) => d >= b0 && d < d0 };
}
console.log(`\n■ エディタの新バンクで組んだ谷（見本「定番の並び」3レーン。バンクの高さ ${dim(3, 'bankRise')}mm・折れ目の半径 ${dim(3, 'bankBendRadius')}mm、スロープの折れ目の半径 ${dim(3, 'slopeBendRadius')}mm、すべて仮設定）`);
console.log(`  飛距離=谷の後のスロープで離陸してから着地までの距離を直線1枚(540mm)で割った枚数（平均[最小〜最大]）。着地用の直線は${LAND_PIECES}枚`);
console.log('  バンク下り離陸=バンク下りの部品の中（坂の頂上）で浮いた回数。ここで浮いて谷を飛び越すと、スロープでは離陸しない（飛ばない）');
const SUMMARY: string[] = [];
for (const deg of [20, 30, 40] as const) {
  const v = editorValley(deg);
  console.log(`\n□ エディタのバンク ${deg}度（1周 ${new Track(v.course).length.toFixed(1)}m）`);
  console.log(`${HEAD}  バンク下り離陸/周  スロープ離陸/周  飛距離(枚)`);
  for (const [mn, b] of MACHINES) {
    const ref = avg(v.course, tuned(b, SETTINGS[0]), v).time;
    for (const s of SETTINGS) {
      const r = avg(v.course, tuned(b, s), v);
      const fl = Number.isNaN(r.flight) ? '   飛ばない' : `${n2(r.flight)} [${r.flightMin.toFixed(2)}〜${r.flightMax.toFixed(2)}]`;
      console.log(`${row(mn, s[0], r, ref)}   ${n1(r.bankJumps / LAPS, 4)}            ${n1(r.jumps / LAPS, 4)}       ${fl}`);
      SUMMARY.push(`${deg}\t${mn}\t${s[0]}\t${Number.isNaN(r.flight) ? '-' : r.flight.toFixed(2)}`);
    }
  }
}
// 飛距離だけの一覧（角度ごとに横へ並べる）
console.log('\n■ エディタの新バンクで組んだ谷: 飛距離（直線の枚数、平均。- は飛ばない）');
console.log(`${pad('マシン', 8)}${pad('設定', 18)}   20度   30度   40度`);
for (const [mn] of MACHINES)
  for (const s of SETTINGS) {
    const cells = [20, 30, 40].map((d) => SUMMARY.find((x) => x.startsWith(`${d}\t${mn}\t${s[0]}\t`))!.split('\t')[3].padStart(6));
    console.log(`${pad(mn, 8)}${pad(s[0], 18)} ${cells.join(' ')}`);
  }
