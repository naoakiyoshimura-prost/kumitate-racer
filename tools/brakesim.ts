// スポンジブレーキの確認: 坂・バンク入りのコースで、ブレーキ無しと代表的な設定を比べる
// - エディタの部品で組んだコース（tools/slopesim.ts と同じ組み方。横傾きは CourseData に後から付けたもの）
// - 急坂の谷のコース（店長の定番の並び: 急坂を上る→180度コーナー→急坂を下る→スロープを上る→直線に着地→コーナー）。
//   3) は CourseData の points をここで直接作った版（急坂の角度20/30/40度・高さ・つなぎの半径は仮。以前からの比較用に残す）、
//   4) はエディタのバンクアプローチ（20度の円弧）で組んだ版（見本 sampleBankValley）。アプローチ2か所・スロープでの当たり時間、
//   傾いた面のコーナーでの離陸、スロープからの飛距離を、クラシック相当と俯瞰モード相当（miniLike）で出す
// - 5) 半径650のアプローチでは当たらず、スロープの谷（折れ目半径300）でだけ当たるか。27通り×前後（式=ゲームの路面での近づく量、シミュの当たり時間）、
//   部品の形そのものとゲームの路面の比較、書き出しの点の並び方による揺れ、タイヤ径
// - 6) スロープからの飛距離のまとめと、最高速構成の離陸の速さ
// 乱数の種を複数回して平均する（乱数は着地の乱れ・コースアウトにだけ使われる）
// 実行: npm run brakesim
import * as THREE from 'three';
import { Track, type CourseData } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, defaultBuild, type Build } from '../src/setup';
import { build as buildLayout, sampleBankValley } from '../src/editor/geom';
import { dim } from '../src/editor/catalog';
import { toCourse, MM_TO_GAME } from '../src/editor/export';
import type { Layout, PieceSpec } from '../src/editor/types';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';

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
  ['山（上り→下り）', editorCourse(lay('山', [UP, DOWN, ...L4, S, S, ...L4]))],
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
  const R = 540 * MM; // コーナーの中心線の半径（エディタの3レーンと同じ）
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
  // 谷（スロープ）でだけ当たる組（高さと場所を組にした『低×軸寄り・中×中・高×外寄り』）
  ['前 低強軸(谷)', 'low-strong-axle', undefined],
  ['前 中強中(谷)', 'mid-strong-mid', undefined],
  ['前 高強外(谷)', 'high-strong-out', undefined],
  ['後 低強軸(谷)', undefined, 'low-strong-axle'],
  ['後 中強中(谷)', undefined, 'mid-strong-mid'],
  ['後 高強外(谷)', undefined, 'high-strong-out'],
  // 店長の説明「フロントを抜き気味にしてリヤを強く」
  ['前高弱外+後低強外', 'high-weak-out', 'low-strong-out'],
  ['前高弱外+後中強中', 'high-weak-out', 'mid-strong-mid'],
  // リヤの姿勢の効きだけを見る（高い・弱い。場所だけ替える）
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

// 4) エディタのバンクアプローチで組んだ谷（見本「定番の並び」: スタート→直線3→アプローチ→180度（20度傾いた面）→アプローチ→スロープ上り→直線4→180度→スロープ下り）
// 部品の区間（アプローチ1・傾いた面のコーナー・アプローチ2・スロープ・着地用の直線4枚）を、エディタの部品の長さの割合で Track の距離に当てる
interface Span { from: number; to: number }
interface EdValley { course: CourseData; len: number; a1: Span; tilt: Span; a2: Span; slope: Span; jump: Span }
function editorValley(k: 1 | 2 = 1): EdValley {
  return valleyFrom(sampleBankValley(3, k), k);
}
function valleyFrom(l: Layout, k: 1 | 2): EdValley {
  const b = buildLayout(l);
  if (!b.check.closed) throw new Error(`${l.name} が閉じていない`);
  const course = { ...toCourse(l), id: `valley-ap${k}`, laps: LAPS };
  const len = new Track(course).length;
  const cum: number[] = [0];
  for (const p of b.placed) cum.push(cum[cum.length - 1] + p.length);
  const tot = cum[cum.length - 1];
  const at = (i: number) => (cum[i] / tot) * len;
  const iA = l.pieces.map((p, i) => (p.type === 'bankApproach' ? i : -1)).filter((i) => i >= 0);
  const iS = l.pieces.findIndex((p) => p.type === 'slopeUp');
  return {
    course, len,
    a1: { from: at(iA[0]), to: at(iA[k - 1] + 1) },
    tilt: { from: at(iA[k - 1] + 1), to: at(iA[k]) },
    a2: { from: at(iA[k]), to: at(iA[2 * k - 1] + 1) },
    slope: { from: at(iS), to: at(iS + 1) },
    jump: { from: at(iS), to: at(iS + 1 + LAND_PIECES) },
  };
}
const inSpan = (d: number, sp: Span, pad = 0) => d >= sp.from - pad && d < sp.to + pad;

// 俯瞰モード相当の数値（tools/slopesim.ts の miniLike の写し。src/main.ts miniTune と同じ考え方。main.ts は node で読めないため）
function miniLike(t: Tuning): Tuning {
  const m = mini.speed.boostTimeMul;
  const b = t.boost;
  const multi = b.multi && { ...b.multi, chargeTime: b.multi.chargeTime.map((v) => v * m), duration: b.multi.duration.map((v) => v * m), chainWindow: b.multi.chainWindow * m };
  return { ...t, landing: { ...t.landing, maxOutChance: t.landing.maxOutChance * mini.landingOutMul }, boost: { ...b, regen: b.regen / m, duration: b.duration * m, chargeTime: (b.chargeTime ?? 0) * m, multi } };
}

interface VRes { toV: number[]; time: number; cA1: [number, number]; cA2: [number, number]; cSl: [number, number]; cTilt: [number, number]; tiltTO: number; tiltAt: number[]; otherTO: number; slopeTO: number; flights: number[]; clean: number; wobble: number; out: number; courseOuts: number }
// ブレーキが当たっていた秒数（区間ごと、前/後）。区間は車の中心の距離で判定（前後の車軸は ±ホイールベース/2 なので、区間の前後に少し余裕を見る）
// strat: 'straight'=直線でブースト（以前からの押し方）、'valley'=スロープの入口で発動するように谷の手前でだけ押す
function runValley(v: EdValley, t: Tuning, seed: number, multi = false, dt = DT, strat: 'straight' | 'valley' = 'straight'): VRes {
  const track = new Track(v.course);
  let sd = seed;
  const rand = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const car = new CarState(track, t, 1, rand);
  car.multiBoost = multi;
  const r: VRes = { toV: [], time: 0, cA1: [0, 0], cA2: [0, 0], cSl: [0, 0], cTilt: [0, 0], tiltTO: 0, tiltAt: [], otherTO: 0, slopeTO: 0, flights: [], clean: 0, wobble: 0, out: 0, courseOuts: 0 };
  const pad = (base.brake!.wheelbase * base.brake!.mmToGame) / 2 + 0.5;
  let lastLand = 0;
  let wasAir = false;
  let from = -1;
  while (car.lap <= LAPS && r.time < 400) {
    if (strat === 'valley') {
      const ahead = (v.slope.from - car.distance + v.len) % v.len;
      if (!car.isBoosting && ahead < car.speed * (t.boost.chargeTime ?? 0) + 4) car.command('boost', r.time);
    } else if (multi) {
      if (!car.inCorner && car.multiNext > 0 && car.multiCharge === 0) car.command('boost', r.time);
    } else if (!car.inCorner && !car.isBoosting) car.command('boost', r.time);
    car.update(dt);
    const d = car.distance;
    const add = (c: [number, number]) => { if (car.spongeTouchF) c[0] += dt; if (car.spongeTouchR) c[1] += dt; };
    if (inSpan(d, v.a1, pad)) add(r.cA1);
    else if (inSpan(d, v.a2, pad)) add(r.cA2);
    else if (inSpan(d, v.slope, pad)) add(r.cSl);
    else if (inSpan(d, v.tilt)) add(r.cTilt);
    if (car.airborne && !wasAir) {
      if (inSpan(d, v.tilt)) { r.tiltTO++; r.tiltAt.push(((d - v.tilt.from) / (v.tilt.to - v.tilt.from)) * 180); }
      else if (inSpan(d, v.jump)) { r.slopeTO++; from = d; r.toV.push(car.speed); }
      else r.otherTO++;
    }
    if (!car.airborne && wasAir && from >= 0) { r.flights.push((d - from + track.length) % track.length); from = -1; }
    wasAir = car.airborne;
    if (car.lastLandingTime !== lastLand) {
      lastLand = car.lastLandingTime;
      if (car.lastLanding === 'clean') r.clean++;
      else if (car.lastLanding === 'wobble') r.wobble++;
      else if (car.lastLanding === 'out') r.out++;
    }
    r.time += dt;
  }
  r.courseOuts = car.courseOuts;
  return r;
}
function avgValley(v: EdValley, t: Tuning, multi = false, dt = DT, strat: 'straight' | 'valley' = 'straight', seeds = SEEDS) {
  const rs = seeds.map((sd) => runValley(v, t, sd, multi, dt, strat));
  const tv = rs.flatMap((r) => r.toV);
  const m = (f: (r: VRes) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const fl = rs.flatMap((r) => r.flights);
  const at = rs.flatMap((r) => r.tiltAt);
  return {
    toV: tv.length ? tv.reduce((a, b) => a + b, 0) / tv.length : NaN,
    time: m((r) => r.time),
    a1: [m((r) => r.cA1[0]) / LAPS, m((r) => r.cA1[1]) / LAPS], a2: [m((r) => r.cA2[0]) / LAPS, m((r) => r.cA2[1]) / LAPS],
    sl: [m((r) => r.cSl[0]) / LAPS, m((r) => r.cSl[1]) / LAPS], tl: [m((r) => r.cTilt[0]) / LAPS, m((r) => r.cTilt[1]) / LAPS],
    tiltTO: m((r) => r.tiltTO), tiltAt: at, otherTO: m((r) => r.otherTO), slopeTO: m((r) => r.slopeTO) / LAPS,
    flight: fl.length ? fl.reduce((a, b) => a + b, 0) / fl.length / STRAIGHT_M : NaN,
    flightMin: fl.length ? Math.min(...fl) / STRAIGHT_M : NaN, flightMax: fl.length ? Math.max(...fl) / STRAIGHT_M : NaN,
    clean: m((r) => r.clean), wobble: m((r) => r.wobble), out: m((r) => r.out), courseOuts: m((r) => r.courseOuts),
  };
}
const ms = (v: number) => (v * 1000).toFixed(0).padStart(4);
const fc = (a: number[]) => `${ms(a[0])}/${ms(a[1])}`;
const flightCell = (r: ReturnType<typeof avgValley>) => (Number.isNaN(r.flight) ? '  飛ばない' : `${n2(r.flight, 4)} [${r.flightMin.toFixed(2)}〜${r.flightMax.toFixed(2)}]`);
const whereCell = (a: number[]) => {
  if (!a.length) return '-';
  const lo = Math.min(...a), hi = Math.max(...a);
  return `${lo.toFixed(0)}〜${hi.toFixed(0)}度`;
};

const V1 = editorValley(1);
console.log(`\n■ エディタのバンクアプローチで組んだ谷（見本「定番の並び」3レーン、1周 ${V1.len.toFixed(1)}m）`);
console.log(`  寸法: アプローチ 20度・半径 ${dim(3, 'bankBendRadius')}mm（第三者の実測）、スロープ 上から ${dim(3, 'slopeLength')}mm・落差 ${dim(3, 'slopeRise')}mm・折れ目の半径 ${dim(3, 'slopeBendRadius')}mm（仮）`);
console.log(`  区間（Track の距離 m）: アプローチ1 ${V1.a1.from.toFixed(1)}〜${V1.a1.to.toFixed(1)}、傾いた面のコーナー ${V1.tilt.from.toFixed(1)}〜${V1.tilt.to.toFixed(1)}、アプローチ2 ${V1.a2.from.toFixed(1)}〜${V1.a2.to.toFixed(1)}、スロープ ${V1.slope.from.toFixed(1)}〜${V1.slope.to.toFixed(1)}`);
// ゲームの曲がりの見え方。以前の見方（3点の2階差分、前後4m）と、いまの見方（car.ts spongeApproach: 前後の車軸の真下の路面を結ぶ線を
// 車軸から e だけ延ばした点と路面の距離）を、区間の中の最大から「その大きさになる円の半径」(実寸mm) に直して並べる。
// 半径 R の円でへこむ路面なら、近づく量 = e(ホイールベース+e)/(2R) なので R = e(ホイールベース+e)/(2×近づく量)
const BK = base.brake!;
const probeCar = (c: CourseData) => new CarState(new Track(c), base, 1, () => 0.5);
function peakApproach(car: CarState, sp: Span, end: 'front' | 'rear', e: number, pad = 0) {
  let m = -Infinity;
  for (let s = sp.from - pad; s < sp.to + pad; s += 0.05) m = Math.max(m, car.spongeApproach(end, e, s));
  return m;
}
const eqR = (e: number, ap: number) => (ap > 0 ? ((e * (BK.wheelbase + e)) / (2 * ap)).toFixed(0) : '∞');
// 調べる区間（車体の中心の距離、前後にホイールベース/2+60mm の余裕）: アプローチ1（単独のバンクアプローチ、半径650）と、
// 谷（アプローチ2→スロープ上り。アプローチ2の円弧のすぐ後にスロープの折れ目が続くので、まとめて「谷」として見る）
const PADA = (BK.wheelbase / 2 + 60) * BK.mmToGame;
const regA1 = (v: EdValley): Span => ({ from: v.a1.from - PADA, to: v.a1.to + PADA });
const regV = (v: EdValley): Span => ({ from: v.a2.from - PADA, to: v.slope.to + PADA });
{
  const tr = new Track(V1.course);
  const span = 4;
  const bendAt = (s: number) => {
    const p1 = tr.frameAt(s).position;
    const acc = tr.frameAt(s + span).position.add(tr.frameAt(s - span).position).addScaledVector(p1, -2).divideScalar(span * span);
    return acc.dot(tr.surfaceAt(s).up);
  };
  const peak = (sp: Span) => { let m = 0; for (let s = sp.from; s < sp.to; s += 0.05) m = Math.max(m, bendAt(s)); return m; };
  const rr = (b: number) => (b > 0 ? (1 / (b * BK.mmToGame)).toFixed(0) : '∞');
  console.log(`  以前の見方（3点の2階差分・前後 ${span}m）の半径: アプローチ1 ${rr(peak(V1.a1))}mm、アプローチ2 ${rr(peak(V1.a2))}mm、スロープ ${rr(peak(V1.slope))}mm（形の半径はアプローチ ${dim(3, 'bankBendRadius')}・スロープ ${dim(3, 'slopeBendRadius')}）`);
  const car = probeCar(V1.course);
  for (const [end, e] of [['front', BK.place.front.mid], ['rear', BK.place.rear.mid]] as const) {
    const a1 = peakApproach(car, regA1(V1), end, e), vl = peakApproach(car, regV(V1), end, e);
    console.log(`  いまの見方（${end === 'front' ? 'フロント' : 'リヤ'}・車軸から${e}mm）: 近づく量の最大 アプローチ1 ${a1.toFixed(2)}mm（半径 ${eqR(e, a1)}mm 相当）、谷（アプローチ2→スロープの折れ目） ${vl.toFixed(2)}mm（${eqR(e, vl)}）`);
  }
}
console.log('  当たり=ブレーキが路面に当たっていた秒数を1周あたりのミリ秒で（前/後）。乱数の種5本×3周の平均');

const HEAD_A = `${pad('マシン', 8)}${pad('設定', 18)}  タイム   アプローチ1 前/後  アプローチ2 前/後  スロープ 前/後  (傾いたコーナー 前/後)`;
const HEAD_B = `${pad('マシン', 8)}${pad('設定', 18)}  タイム   傾いたコーナーで離陸(3周計)  離陸した場所(0〜180度)  ほかの所の離陸(スロープ以外)`;
const HEAD_C = `${pad('マシン', 8)}${pad('設定', 18)}  タイム   スロープ離陸/周  飛距離(枚) 平均[最小〜最大]  着地 きれい/乱れ/アウト  コースアウト`;
const rowA = (mn: string, sn: string, r: ReturnType<typeof avgValley>) => `${pad(mn, 8)}${pad(sn, 18)} ${n2(r.time, 7)}s    ${fc(r.a1)}          ${fc(r.a2)}       ${fc(r.sl)}     (${fc(r.tl)})`;
const rowB = (mn: string, sn: string, r: ReturnType<typeof avgValley>) => `${pad(mn, 8)}${pad(sn, 18)} ${n2(r.time, 7)}s    ${n1(r.tiltTO, 5)}                       ${pad(whereCell(r.tiltAt), 22)}  ${n1(r.otherTO, 5)}`;
const rowC = (mn: string, sn: string, r: ReturnType<typeof avgValley>) => `${pad(mn, 8)}${pad(sn, 18)} ${n2(r.time, 7)}s    ${n1(r.slopeTO, 4)}          ${pad(flightCell(r), 26)}  ${n1(r.clean, 4)}/${n1(r.wobble, 4)}/${n1(r.out, 4)}             ${n1(r.courseOuts, 4)}`;

const classic = MACHINES.map(([mn, b]) => SETTINGS.map((st) => ({ mn, sn: st[0], r: avgValley(V1, tuned(b, st)) }))).flat();
console.log('\n□ (a) アプローチ2か所とスロープでブレーキが当たっているか（クラシック相当）');
console.log(HEAD_A);
for (const x of classic) console.log(rowA(x.mn, x.sn, x.r));
console.log('\n□ (b) 傾いた面のコーナーで離陸していないか（クラシック相当）');
console.log(HEAD_B);
for (const x of classic) console.log(rowB(x.mn, x.sn, x.r));
console.log(`\n□ (c) スロープからの飛距離（クラシック相当、直線1枚=${(540).toFixed(0)}mm で割った枚数。着地用の直線は${LAND_PIECES}枚）`);
console.log(HEAD_C);
for (const x of classic) console.log(rowC(x.mn, x.sn, x.r));

console.log(`\n□ 俯瞰モード相当（miniLike: ブースト時間×${mini.speed.boostTimeMul}・多段ブースト・刻み ${mini.speed.maxStep}秒・着地アウト×${mini.landingOutMul}）: (a)(b)(c) をまとめて`);
console.log(`${pad('マシン', 8)}${pad('設定', 18)}  タイム   アプローチ1 前/後  アプローチ2 前/後  スロープ 前/後  傾き離陸(場所)       スロープ離陸/周  飛距離(枚)`);
for (const [mn, b] of MACHINES)
  for (const st of SETTINGS) {
    const r = avgValley(V1, miniLike(tuned(b, st)), true, mini.speed.maxStep);
    console.log(`${pad(mn, 8)}${pad(st[0], 18)} ${n2(r.time, 7)}s    ${fc(r.a1)}          ${fc(r.a2)}       ${fc(r.sl)}   ${pad(`${r.tiltTO.toFixed(1)}(${whereCell(r.tiltAt)})`, 20)} ${n1(r.slopeTO, 4)}          ${flightCell(r)}`);
  }

// 40度版（アプローチ2枚重ね）は参考に、ブレーキ無しと2設定だけ
{
  const V2 = editorValley(2);
  console.log(`\n□ 参考: アプローチ2枚重ね（40度）の見本（1周 ${V2.len.toFixed(1)}m、クラシック相当）`);
  console.log(`${pad('マシン', 8)}${pad('設定', 18)}  タイム   アプローチ1 前/後  アプローチ2 前/後  スロープ 前/後  傾き離陸(場所)       スロープ離陸/周  飛距離(枚)`);
  for (const [mn, b] of MACHINES)
    for (const st of [SETTINGS[0], SETTINGS[3], SETTINGS[13]]) {
      const r = avgValley(V2, tuned(b, st));
      console.log(`${pad(mn, 8)}${pad(st[0], 18)} ${n2(r.time, 7)}s    ${fc(r.a1)}          ${fc(r.a2)}       ${fc(r.sl)}   ${pad(`${r.tiltTO.toFixed(1)}(${whereCell(r.tiltAt)})`, 20)} ${n1(r.slopeTO, 4)}          ${flightCell(r)}`);
    }
}

// 5) バンクアプローチ（半径650）では当たらず、スロープ（折れ目半径300）でだけ当たるか。27通り×前後
const END_NAME = { front: 'フロント', rear: 'リヤ' } as const;
const HS = ['high', 'mid', 'low'] as const;
const SS = ['weak', 'mid', 'strong'] as const;
const PS = ['axle', 'mid', 'out'] as const;
const H_NAME = { high: '高', mid: '中', low: '低' }, S_NAME = { weak: '弱', mid: '中', strong: '強' }, P_NAME = { axle: '軸', mid: '中', out: '外' };
const gapOf = (end: 'front' | 'rear', h: (typeof HS)[number], tireMm = BK.baseTireMm) => Math.max(BK.minGap, BK.height[end][h] + (tireMm - BK.baseTireMm) * BK.tireGap);
const ox = (c: number) => (c > 0 ? '○' : '×');
{
  // 5a) エディタの形そのもの（部品の細かい点、30mm刻み）で測った近づく量と、ゲームの路面（書き出しの点≈2m間隔を結んだスプライン）で測った近づく量
  const l = sampleBankValley(3, 1);
  const b = buildLayout(l);
  const si = l.pieces.findIndex((p) => p.type === 'start');
  const placed = [...b.placed.slice(si), ...b.placed.slice(0, si)];
  const P: THREE.Vector3[] = [], U: THREE.Vector3[] = [], D: number[] = [];
  let dd = 0;
  for (const pc of placed)
    for (const [i, sm] of pc.samples.entries()) {
      if (P.length && i === 0) continue;
      const q = new THREE.Vector3(sm.p[0], sm.p[1], sm.p[2]);
      if (P.length) dd += q.distanceTo(P[P.length - 1]);
      P.push(q); U.push(new THREE.Vector3(...sm.u)); D.push(dd);
    }
  const at = (x: number): [THREE.Vector3, THREE.Vector3] => {
    x = ((x % dd) + dd) % dd;
    let lo = 0, hi = D.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m] <= x) lo = m; else hi = m; }
    const f = (x - D[lo]) / (D[hi] - D[lo] || 1);
    return [P[lo].clone().lerp(P[hi], f), U[lo].clone().lerp(U[hi], f).normalize()];
  };
  const trueAp = (sMm: number, end: 'front' | 'rear', e: number) => {
    const sg = end === 'front' ? 1 : -1;
    const [near] = at(sMm + (sg * BK.wheelbase) / 2), [far] = at(sMm - (sg * BK.wheelbase) / 2);
    const tip = near.clone().addScaledVector(near.clone().sub(far).normalize(), e);
    const [road, up] = at(sMm + sg * (BK.wheelbase / 2 + e));
    return road.sub(tip).dot(up);
  };
  const toMm = (m: number) => (m / V1.len) * dd;
  const truePeak = (sp: Span, end: 'front' | 'rear', e: number) => { let m = -Infinity; for (let x = toMm(sp.from); x < toMm(sp.to); x += 1) m = Math.max(m, trueAp(x, end, e)); return m; };
  const car = probeCar(V1.course);
  console.log(`\n■ 当たる・当たらない（見本の谷）。近づく量 = 前後の車軸の真下の路面を結ぶ線を車軸から e mm 外へ延ばした点と、その先の路面との距離（car.ts spongeApproach）`);
  console.log('□ (5a) 部品の形そのもの（エディタの細かい点）と、ゲームの路面（書き出しの点≈2m=約98mm間隔を結んだスプライン）の比較。近づく量の最大 mm');
  console.log(`${pad('', 30)}アプローチ1(半径650)  谷(スロープの折れ目300) 円の式 650 / 300`);
  for (const [name, end, e] of [['フロント 車軸から10mm', 'front', 10], ['フロント 車軸から14mm（記事の例）', 'front', 14], ['フロント 車軸から18mm', 'front', 18], ['リヤ 車軸から40mm', 'rear', 40], ['リヤ 車軸から48mm（記事の例）', 'rear', 48], ['リヤ 車軸から56mm', 'rear', 56]] as const) {
    const c650 = (e * (BK.wheelbase + e)) / 1300, c300 = (e * (BK.wheelbase + e)) / 600;
    console.log(`${pad(name, 30)}形 ${truePeak(regA1(V1), end, e).toFixed(2)} / ゲーム ${peakApproach(car, regA1(V1), end, e).toFixed(2)}    形 ${truePeak(regV(V1), end, e).toFixed(2)} / ゲーム ${peakApproach(car, regV(V1), end, e).toFixed(2)}    ${c650.toFixed(2)} / ${c300.toFixed(2)}`);
  }
  console.log('  第三者の計算記事（公式ではない）の例: フロント 車軸から14mm・地上高1.2mm、リヤ 車軸から48mm・高さ5mm。形そのものでは どちらもアプローチ×・スロープ○。');
  console.log('  ゲームの路面はスプラインで点の間をならすので、アプローチを1〜2割大きく、スロープの折れ目を1〜2割小さく見る（折れ目の円弧は約68mmで点の間隔より短い）。そのため仮設定の高さは記事の例より少し高めに置いた');

  // 5b) 27通り×前後: 式（ゲームの路面での近づく量の最大 − 隙間）と、シミュの当たり時間（標準マシン・中径・種1本・3周、1周あたりミリ秒）
  console.log(`\n□ (5b) 27通り×前後（標準マシン・中径26mm）。式=ゲームの路面での近づく量の最大−隙間（○=当たる）、シミュ=当たっていた時間（1周あたりミリ秒、種${SEEDS[0]}の3周）`);
  console.log(`  いまの仮設定: フロント 高さ ${HS.map((h) => BK.height.front[h]).join('/')}mm・場所 ${PS.map((p) => BK.place.front[p]).join('/')}mm・強さ ${SS.map((x) => BK.strength.front[x]).join('/')}、リヤ 高さ ${HS.map((h) => BK.height.rear[h]).join('/')}mm・場所 ${PS.map((p) => BK.place.rear[p]).join('/')}mm・強さ ${SS.map((x) => BK.strength.rear[x]).join('/')}（高/中/低、軸/中/外、弱/中/強）`);
  for (const end of ['front', 'rear'] as const) {
    console.log(`\n${END_NAME[end]}: 設定(高さ強さ場所)  隙間  式 アプローチ1/谷      シミュ アプローチ1/谷(うちアプローチ2側+スロープ側)(ms)  判定(シミュ)          タイム   飛距離(枚)`);
    const only: string[] = [], both: string[] = [], none: string[] = [];
    for (const h of HS)
      for (const st of SS)
        for (const pl of PS) {
          const code = `${h}-${st}-${pl}`;
          const name = `${H_NAME[h]}${S_NAME[st]}${P_NAME[pl]}`;
          const g = gapOf(end, h), e = BK.place[end][pl];
          const ga = peakApproach(car, regA1(V1), end, e) - g, gv = peakApproach(car, regV(V1), end, e) - g;
          const r = avgValley(V1, tuned(MACHINES[0][1], ['', end === 'front' ? code : undefined, end === 'rear' ? code : undefined]), false, DT, 'straight', SEEDS.slice(0, 1));
          const i = end === 'front' ? 0 : 1;
          const ca = r.a1[i], cb = r.a2[i], cs = r.sl[i];
          const cv = cb + cs;
          const verdict = ca <= 0 && cv > 0 ? 'バンク×・谷○' : ca > 0 && cv > 0 ? '両方○' : ca > 0 ? 'バンクだけ○' : '両方×';
          (verdict === 'バンク×・谷○' ? only : verdict === '両方○' ? both : none).push(name);
          console.log(`  ${pad(name, 20)} ${g.toFixed(2)}   ${ox(ga)}${n2(ga, 6)} ${ox(gv)}${n2(gv, 6)}      ${ms(ca)}/${ms(cv)}(${ms(cb)}+${ms(cs)})                          ${pad(verdict, 20)} ${n2(r.time, 6)}s  ${flightCell(r)}`);
        }
    console.log(`  ${END_NAME[end]}でバンクアプローチでは当たらず谷（スロープ）でだけ当たる（シミュ）: ${only.length}通り ${only.join('、')}`);
    console.log(`  両方で当たる: ${both.length}通り ${both.join('、')}／それ以外: ${none.length}通り`);
  }

  // 5c) 点の並び方による揺れ: 見本の両側の直線に同じ長さの直線（1/4・1/2）を足して、書き出しの点とスロープ・アプローチの位置関係をずらす
  console.log('\n□ (5c) 書き出しの点の並び方による揺れ（見本の両側に直線1/4・1/2を足して、点とアプローチ・スロープの位置関係をずらした6通り）。式の判定で「アプローチ1×・谷○」になった数/6');
  const Q: PieceSpec = { type: 'straight', frac: 0.25 }, Hf: PieceSpec = { type: 'straight', frac: 0.5 };
  const shifted = ([[], [Q], [Q, Q], [Q, Q, Q], [Hf], [Hf, Q]] as PieceSpec[][]).map((ins) => {
    const base0 = sampleBankValley(3, 1);
    const iS = base0.pieces.findIndex((x) => x.type === 'slopeUp');
    const pieces = [...base0.pieces.slice(0, 1), ...ins, ...base0.pieces.slice(1, iS + 1), ...ins, ...base0.pieces.slice(iS + 1)];
    return valleyFrom({ ...base0, pieces }, 1);
  });
  for (const end of ['front', 'rear'] as const) {
    const cells: string[] = [];
    for (const h of HS)
      for (const pl of PS) {
        let n = 0;
        for (const v of shifted) {
          const c = probeCar(v.course);
          const e = BK.place[end][pl], g = gapOf(end, h);
          const a = peakApproach(c, regA1(v), end, e), su = peakApproach(c, regV(v), end, e);
          if (a <= g && su > g) n++;
                  }
        cells.push(`${H_NAME[h]}${P_NAME[pl]} ${n}/6`);
      }
    console.log(`  ${END_NAME[end]}: ${cells.join('  ')}`);
  }
  for (const end of ['front', 'rear'] as const) {
    const rows: string[] = [];
    for (const pl of PS) {
      const e = BK.place[end][pl];
      const A = shifted.map((v) => peakApproach(probeCar(v.course), regA1(v), end, e));
      const S2 = shifted.map((v) => peakApproach(probeCar(v.course), regV(v), end, e));
      rows.push(`${P_NAME[pl]}(${e}mm) アプローチ1 ${Math.min(...A).toFixed(2)}〜${Math.max(...A).toFixed(2)}・谷 ${Math.min(...S2).toFixed(2)}〜${Math.max(...S2).toFixed(2)}`);
    }
    console.log(`  ${END_NAME[end]}の近づく量の幅(mm): ${rows.join('／')}`);
  }

  // 5d) タイヤ径で変わるか（式の判定、高さ×場所の9通り）
  console.log(`\n□ (5d) タイヤ径による違い（式の判定、隙間 = 高さ + (径−${BK.baseTireMm})×${BK.tireGap}）。各マスは アプローチ1/谷`);
  for (const end of ['front', 'rear'] as const)
    for (const [tn, mm] of [['超小22', 22], ['中26', 26], ['超大32', 32]] as const) {
      const cells = HS.flatMap((h) => PS.map((pl) => {
        const e = BK.place[end][pl], g = gapOf(end, h, mm);
        return `${H_NAME[h]}${P_NAME[pl]} ${ox(peakApproach(car, regA1(V1), end, e) - g)}/${ox(peakApproach(car, regV(V1), end, e) - g)}`;
      }));
      console.log(`  ${pad(END_NAME[end], 8)} ${pad(tn, 7)} ${cells.join(' ')}`);
    }
}

// 6) スロープからの飛距離のまとめ（標準/最高速 × ブレーキ無し/代表設定、クラシック相当と俯瞰相当）と、最高速構成の離陸の速さ
{
  const REP = [SETTINGS[0], SETTINGS[1], SETTINGS[2], SETTINGS[3], SETTINGS[9], SETTINGS[12], SETTINGS[14]];
  console.log(`\n■ スロープからの飛距離のまとめ（見本の谷、直線1枚=540mm で割った枚数、平均[最小〜最大]、種${SEEDS.length}本×3周）。air.crest.gravity=${base.air.crest!.gravity}`);
  console.log('  押し方: 直線=直線に入ったらブースト（以前からのシミュの押し方）、谷=スロープの入口で発動するように谷の手前でだけ押す。離陸の速さ=スロープで浮いた瞬間の速さ(m/s)');
  console.log(`${pad('マシン', 8)}${pad('設定', 20)} ${pad('クラシック 直線', 30)}${pad('クラシック 谷', 30)}${pad('俯瞰相当(多段)', 30)}`);
  for (const [mn, b] of MACHINES)
    for (const st of REP) {
      const t = tuned(b, st);
      const c1 = avgValley(V1, t), c2 = avgValley(V1, t, false, DT, 'valley'), c3 = avgValley(V1, miniLike(t), true, mini.speed.maxStep);
      const cell = (r: ReturnType<typeof avgValley>) => pad(`${flightCell(r)} ${Number.isNaN(r.toV) ? '' : r.toV.toFixed(1)}`, 30);
      console.log(`${pad(mn, 8)}${pad(st[0], 20)} ${cell(c1)}${cell(c2)}${cell(c3)}`);
    }
  console.log('  最高速構成が短いわけ: 飛距離は離陸の速さでほぼ決まる。最高速構成は180度コーナーに速く入って壁沿いで大きく減速し（出口は標準とほぼ同じ約16m/s）、');
  console.log('  そこからスロープまでの約15mで、加速が弱い（ギヤ比3.2・最高速型モーター）うえにブースター（大型2連）は溜め1秒・消費が多いので間に合わず、標準より遅い速さで飛ぶ');
}
