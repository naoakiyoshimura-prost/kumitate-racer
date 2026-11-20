// 図面（2D・3D）の部品の色を、走る画面の模型風カラーと同じ対応にする（2026-11-20 店長「図面引く画面でも、ストレート、コーナーの色とかは対応させておいて、2D、3D両方」）
import type { Placed } from './types';
import { PART_COLORS, STRAIGHT_COLORS, type CoursePartKind } from '../track';

// 部品の色分けの種類（書き出しの parts と同じ決め方）
export function partKind(p: Placed): CoursePartKind {
  const sp = p.spec;
  const rise = p.end.p[1] - p.start.p[1];
  return sp.type === 'corner' ? (sp.dir === 'R' ? 'cornerR' : 'cornerL')
    : sp.type === 'gapJump' || sp.type === 'hump' || sp.type === 'bump' ? 'jump'
    : sp.type === 'slopeUp' || (sp.type === 'bankApproach' && rise > 1) ? 'up'
    : sp.type === 'slopeDown' || (sp.type === 'bankApproach' && rise < -1) ? 'down'
    : 'straight';
}
// 直線系の色は、テストプレイで選んだ色（白・黒・黄・グレー）に合わせる
function straightHex(): number {
  let k = 'white';
  try { k = localStorage.getItem('kumitate-racer.straightColor') ?? 'white'; } catch { /* */ }
  return (STRAIGHT_COLORS.find(([id]) => id === k) ?? STRAIGHT_COLORS[0])[2];
}
export function modelHex(p: Placed): number {
  const k = partKind(p);
  return k === 'straight' ? straightHex() : PART_COLORS[k];
}
export const cssHex = (n: number) => '#' + n.toString(16).padStart(6, '0');
