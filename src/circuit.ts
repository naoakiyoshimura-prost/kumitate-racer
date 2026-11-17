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
export function toCircuit(c: CourseData): CourseData {
  const s = circuitCfg.scale;
  const at = <T extends { at: number; length: number }>(z: T): T => ({ ...z, at: z.at * s, length: z.length * s });
  return {
    ...c,
    name: c.name,
    width: c.width * circuitCfg.widthMul,
    lanes: circuitCfg.steps,
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
export function circuitTune(t: Tuning): Tuning {
  const a = aeroLevel(t);
  const ac = circuitCfg.aero;
  return {
    ...t,
    car: { ...t.car, maxSpeed: t.car.maxSpeed * circuitCfg.speedMul * (1 - ac.speedLoss * a) },
    corner: { ...t.corner, grip: t.corner.grip * circuitCfg.gripMul + ac.grip * a, downforce: 0 },
  };
}

// サーキット式の見本コース（5レーンの部品で組む。形は仮）: 長い直線2本を、180°ターン（間に短い直線）でつなぐ
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
export const CIRCUIT_LAYOUT: Layout = {
  version: 1, name: 'サーキット（試作）', lanes: 5,
  pieces: [{ type: 'start' }, S, S, S, S, L, L, S, L, L, S, S, S, S, S, L, L, S, L, L],
};
