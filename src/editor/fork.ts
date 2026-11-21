// 分岐路（forkRoad）: 直線の区間で、左の split 本のレーンの組（A）が左へずれながら上がり、残り（B）が右へずれて、区間の終わりでまた合流する。
// 2026-11-16 調査メモ8章の「5→3＋2」（実物は内側3本がS字で上へ、外側2本がS字で下へ分かれ、別々に走って合流。全体の幅 約5.5m）を、
// ゲームでは「直線の上でレーンの組ごとに横と高さをずらす」形に単純化した。寸法はすべて仮。three に依存しない（エディタとテストで共通）
import { dim } from './catalog';
import type { LaneCount } from './types';

export interface ForkDims { length: number; split: number; sep: number; rise: number }
export function forkDims(lanes: LaneCount, ov?: Record<string, number>): ForkDims {
  return { length: dim(lanes, 'forkLength', ov), split: Math.min(lanes - 1, Math.max(1, Math.round(dim(lanes, 'forkSplit', ov)))), sep: dim(lanes, 'forkSep', ov), rise: dim(lanes, 'forkRise', ov) };
}
const sm = (x: number) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v); };
// 分かれ具合 0〜1（最初の1/4で分かれ、最後の1/4で合流）。ゲーム側 Track.forkE と同じ式
export const forkE = (t: number) => sm(t / 0.25) * (1 - sm((t - 0.75) / 0.25));
// 部品の割合 t での組のずれ（mm）: lat = 横（右が+）、y = 高さ
export function forkOffset(d: ForkDims, t: number, group: 'A' | 'B'): { lat: number; y: number } {
  const e = forkE(t);
  return group === 'A' ? { lat: -d.sep * e, y: d.rise * e } : { lat: d.sep * e, y: 0 };
}
