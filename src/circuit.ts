// サーキット式（2026-11-17 店長決定）: レーンを仕切る壁が無く、内側と外側にだけ壁がある広い1本道。
// 走りは今の「レーンなし」（CourseData.laneless）の仕組みを使う: 透明レールで曲がり、遠心力がグリップを超えた分だけ外へ流れ、
// 流れた位置がそのまま自分のラインになる。左右のボタンで横へ動く（押し続けると動き続ける）。壁に当たればローラーで受ける。
// ミニ四駆モード（仕切りレーン）の走りの計算は変えない。このモードだけの倍率は mini.json circuit（すべて仮設定）。
// コースは「中心線＋幅」のまま持つので、あとでハンドル操作のレースゲームモードも同じコースを読める
import type { CourseData } from './track';
import type { Tuning } from './car';
import type { Layout, PieceSpec } from './editor/types';
import { miniCfg } from './mini';

export const circuitCfg = miniCfg.circuit;

// エディタの5レーンのコース（中心線＋幅）をサーキット式に直す: 形を scale 倍、幅を widthMul 倍、仕切りと特殊な仕掛けは外す
export type CircuitKind = 'std' | 'big' | 'bigWide' | 'rg';
// 種類ごとの倍率: std=半径2倍（周回）、big/bigWide=半径10倍・1周（幅2倍/4倍）
export function circuitDims(kind: CircuitKind) {
  const c = circuitCfg, b = c.big;
  // レースゲームモード（raceGame.ts）: 最高速は rg.top で決めるので speedMul は使わない。scale はコーナーとみなす曲がりの閾値を下げる倍率（半径約1kmまでコーナー）
  if (kind === 'rg') { const r = (c as unknown as { rg: { gripMul: number; widthMul: number; steps: number; laps: number } }).rg; return { scale: 30, widthMul: r.widthMul, steps: r.steps, speedMul: 1, gripMul: r.gripMul, laps: r.laps }; }
  if (kind === 'std') return { scale: c.scale, widthMul: c.widthMul, steps: c.steps, speedMul: c.speedMul, gripMul: c.gripMul, laps: 0 };
  const wide = kind === 'bigWide';
  return { scale: b.scale, widthMul: wide ? b.wideMul : b.widthMul, steps: wide ? b.wideSteps : b.steps, speedMul: b.speedMul, gripMul: b.gripMul, laps: b.laps };
}
export function toCircuit(c: CourseData, kind: CircuitKind = 'std'): CourseData {
  const d = circuitDims(kind);
  const s = d.scale;
  const at = <T extends { at: number; length: number }>(z: T): T => ({ ...z, at: z.at * s, length: z.length * s });
  return {
    ...c,
    name: c.name,
    width: c.width * d.widthMul,
    lanes: d.steps,
    laps: d.laps || c.laps,
    circuitKind: kind,
    walledLanes: undefined,
    laneless: true,
    circuit: true,
    points: c.points.map((p) => [p[0] * s, p[1] * s, (p[2] ?? 0) * s] as [number, number, number]),
    // 立体交差・分岐路・ループはレーンのあるコースの仕掛けなので外す（このモードでは普通の道として走る）
    crossover: undefined,
    crossovers: undefined,
    forks: undefined,
    loops: undefined,
    ramps: c.ramps?.map(at),
    jumps: c.jumps?.map((j) => ({ ...j, at: j.at * s })),
    slow: c.slow?.map(at),
  };
}

// 空力の段階（0〜1）: ウィングの downforce 合計（setup.ts で corner.downforce）を基準値で割ったもの
export const aeroLevel = (t: Tuning) => Math.min(1, Math.max(0, t.corner.downforce / circuitCfg.aero.ref));

// サーキット式の走りの倍率: 最高速度×speedMul、グリップ×gripMul。空力はセッティングの段階で効く（速さの2乗のダウンフォースは使わない）
export function circuitTune(t: Tuning, kind: CircuitKind = 'std'): Tuning {
  const d = circuitDims(kind);
  const a = aeroLevel(t);
  const ac = circuitCfg.aero;
  return {
    ...t,
    car: { ...t.car, maxSpeed: t.car.maxSpeed * d.speedMul * (1 - ac.speedLoss * a) },
    // コーナーとみなす曲がり具合も形の倍率で下げる（半径10倍だと元の閾値より緩く、コーナー扱いにならなかった）
    corner: { ...t.corner, grip: t.corner.grip * d.gripMul + ac.grip * a, downforce: 0, threshold: t.corner.threshold / d.scale },
  };
}

// サーキット式の見本コース（5レーンの部品で組む。形は仮）: 長い直線2本を、180°ターン（間に短い直線）でつなぐ
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
export const CIRCUIT_LAYOUT: Layout = {
  version: 1, name: 'サーキット（試作）', lanes: 5,
  pieces: [{ type: 'start' }, S, S, S, S, L, L, S, L, L, S, S, S, S, S, L, L, S, L, L],
};

// 大きいコース（半径10倍、1周だけ。店長「1周1分のコースを5台で」11-17）: 長方形に近い形で、90°コーナー4つ。直線1本≒12m
export const CIRCUIT_BIG_LAYOUT: Layout = {
  version: 1, name: 'ビッグサーキット（試作）', lanes: 5,
  pieces: [{ type: 'start' }, S, S, S, S, L, L, S, S, L, L, S, S, S, S, S, L, L, S, S, L, L],
};
