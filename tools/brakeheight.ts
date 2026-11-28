// ブレーキの高さ・場所ごとに「スロープで当たるか・20度バンクで当たらないか・20度→30度のつなぎ目」を表にする（2026-11-18 店長の基準見直しの相談用）
// 当たる条件: 近づく量の最大 > 隙間 = 高さ + (タイヤ径 − 26)×0.06。ここでは「高さがこれ未満なら当たる」境目（タイヤ径ごと）を出す
import './browserstub';
import tuningJson from '../src/data/tuning.json';
import type { Tuning } from '../src/car';
import { benchMaxApproach } from '../src/brakeView';

const t = structuredClone(tuningJson) as unknown as Tuning;
const k = t.brake!;
const combos = [['straight', 'slopeUp', 'スロープ上り'], ['straight', 'slopeDown', 'スロープ下りの谷'], ['straight', 'bank20', '20度バンク'], ['bank20', 'bank30', '20→30度'], ['bank20', 'bank20', '20→20度(40度)']] as const;
for (const end of ['F', 'R'] as const) {
  const side = end === 'F' ? 'front' : 'rear';
  const places = end === 'F' ? [8, 10, 12, 14, 16, 18] : [36, 40, 44, 48, 52, 56];
  console.log(`\n${end === 'F' ? 'フロント' : 'リヤ'}: 当たる境目の高さ(mm, タイヤ26mm基準の設定値)。設定の高さがこれ未満なら当たる。今の表 高${k.height[side].high}/中${k.height[side].mid}/低${k.height[side].low}`);
  console.log('車軸から(mm)\t' + combos.map((c) => c[2]).join('\t'));
  for (const e of places) {
    const row = combos.map(([a, b]) => benchMaxApproach(t, a, b, end, e).toFixed(2));
    console.log(`${e}\t\t${row.join('\t\t')}`);
  }
}
console.log('\nタイヤ23mmなら同じ設定値で隙間が0.18mm狭い（=境目が0.18mm高い所に来る）');
