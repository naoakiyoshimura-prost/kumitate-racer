// レースゲーム: ドリフト角と速さの関係、きついコーナーの抜け方を数字で確かめる（2026-11-28 店長「ドリフトは90度直前まで」「低速は80度でブレーキングドリフト」「中速は45度でバランス」）
// 実行: npx esbuild tools/rgdrift.ts --bundle --platform=node --format=esm --outfile=dist/rgdrift.mjs && node dist/rgdrift.mjs
import './browserstub';
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { applyBuild, part, type Build } from '../src/setup';
import { toCourse } from '../src/editor/export';
import { circuitTune, CIRCUIT_BIG_LAYOUT } from '../src/circuit';
import { rgCourse, rgCfg, rgTuneWith } from '../src/raceGame';
import { playBuild } from '../src/playtest';
import tuning from '../src/data/tuning.json';
import mini from '../src/data/mini.json';
const DT = mini.speed.maxStep;
const S = Math.max(1, ((mini.speed.realMps * 1000 * 3.38) / 165 / mini.speed.refGameMps) * mini.speed.ratio);
const KMH = S * 3.6;
const build: Build = playBuild(2);
const t = rgTuneWith(circuitTune(applyBuild(tuning as Tuning, build), 'rg'), S, rgCfg.drainMul[(part('booster', build.booster) as { boostKind?: string }).boostKind ?? 'pod2'] ?? 1, 3);
const track = new Track({ ...rgCourse(toCourse(CIRCUIT_BIG_LAYOUT, 'custom').width), crestTakeoff: true });
// きついコーナーを探す: 20m ごとの向きの変わり方から半径を出し、半径 150m 未満が続く所
const head = (s: number) => { const f = track.frameAt(s); return Math.atan2(f.tangent.x, f.tangent.z); };
const corners: { from: number; to: number; r: number }[] = [];
let cur: { from: number; to: number; r: number } | null = null;
for (let s = 0; s < track.length; s += 10) {
  let d = head(s + 10) - head(s); d = Math.atan2(Math.sin(d), Math.cos(d));
  const r = Math.abs(10 / (d || 1e-9));
  if (r < 150) { if (!cur) cur = { from: s, to: s, r }; cur.to = s; cur.r = Math.min(cur.r, r); } else if (cur) { corners.push(cur); cur = null; }
}
console.log('きついコーナー', corners.map((c) => `${c.from}〜${c.to}m 半径${c.r.toFixed(0)}m`).join(' / '));
const fresh = (at: number, kmh: number) => { const c = new CarState(track, t, 5, () => 0.5); c.rgManual = true; c.distance = at; c.speed = kmh / KMH; return c; };
type Plan = (c: CarState, time: number) => void;
function run(at: number, kmh: number, until: number, plan: Plan) {
  const c = fresh(at, kmh); let time = 0, minV = 1e9, wall = 0, maxAng = 0, spins = 0;
  while (c.distance < until && time < 30 * S) {
    plan(c, time / S); c.update(DT); time += DT;
    minV = Math.min(minV, c.speed * KMH); if (c.onRoller) wall += DT / S; maxAng = Math.max(maxAng, (c.rgDriftAng * 180) / Math.PI); spins = c.spins;
  }
  return { sec: time / S, out: c.speed * KMH, minV, wall, maxAng, spins };
}
const fmt = (r: ReturnType<typeof run>) => `${r.sec.toFixed(2)}秒 出口${r.out.toFixed(0)} 最低${r.minV.toFixed(0)}km/h 壁${r.wall.toFixed(2)}秒 角度最大${r.maxAng.toFixed(0)}° スピン${r.spins}`;
// 1) その場の釣り合い: 直線（メインストレートの途中）で角度を固定して2秒、速さがどう動くか
console.log('\n== 角度ごとの速さの動き（直線で2秒）');
for (const kmh of [150, 250, 350]) {
  const row: string[] = [];
  for (const k of [-0.5, 0, 0.5, 1]) {
    const c = fresh(300, kmh); let time = 0;
    while (time < 2 * S) { c.rgDrifting = true; c.rgSteer = k; c.update(DT); time += DT; }
    row.push(`${((c.rgDriftAng * 180) / Math.PI).toFixed(0)}°→${(c.speed * KMH).toFixed(0)}`);
  }
  console.log(`${kmh}km/h から: ${row.join('  ')}`);
}
// 2) コーナーごと: グリップだけ（スティックで内側へ）/ 45度前後のドリフト / ブレーキ＋深いドリフト
for (const cn of corners) {
  const from = cn.from - 120, until = cn.to + 80;
  console.log(`\n== コーナー ${cn.from}m 半径${cn.r.toFixed(0)}m`);
  for (const kmh of [180, 250, 320, 400]) {
    const steerIn = (c: CarState) => (c.cornerInside || 0) * 1;
    const grip = run(from, kmh, until, (c) => { c.rgSteer = c.inCorner ? steerIn(c) * 0.6 - (c.lat - c.wallCenter) / 6 : -(c.lat - c.wallCenter) / 3; });
    const vG = 115 * Math.sqrt(cn.r / 30);
    const bgrip = run(from, kmh, until, (c) => { const pre = c.distance < cn.from; c.rgBraking = pre && c.speed * KMH > vG; c.rgSteer = c.inCorner ? (c.cornerInside || 0) * 0.6 - (c.lat - c.wallCenter) / 6 : -(c.lat - c.wallCenter) / 3; });
    const mid = run(from, kmh, until, (c) => { const inC = c.distance > cn.from - 20; c.rgDrifting = inC; c.rgSteer = inC ? (c.cornerInside || c.rgDriftSide || 0) * 0.3 : -(c.lat - c.wallCenter) / 3; });
    // ブレーキ＋深い角度で目標の速さまで落とし、そこから45度前後へ戻して立ち上がる（目標＝ドリフトで曲がれる速さの目安）
    const vT = 115 * Math.sqrt(cn.r / 30) * 1.55;
    const deep = run(from, kmh, until, (c) => { const inC = c.distance > cn.from - 30; const hot = c.speed * KMH > vT && c.distance < cn.to - 20; c.rgDrifting = inC; c.rgBraking = inC && hot; c.rgSteer = inC ? (c.cornerInside || c.rgDriftSide || 0) * (hot ? 1 : 0.3) - (hot ? 0 : (c.lat - c.wallCenter) / 8) : -(c.lat - c.wallCenter) / 3; });
    console.log(`${kmh}km/h 進入  突っ込み: ${fmt(grip)}\n            ブレーキ→グリップ: ${fmt(bgrip)}\n            45度前後: ${fmt(mid)}\n            ブレーキ＋深く: ${fmt(deep)}`);
  }
}
