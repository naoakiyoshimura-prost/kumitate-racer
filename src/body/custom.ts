import { customBodies, part, type PartOption } from '../setup';
import { bodyMetrics, parseBody2, type BodyData2, type BodyLine, type BodyMetrics } from './blocks';
import { SAMPLE_BODY } from './samples';
import { skey } from '../storage';

// ボディ工房で保存した自作ボディ（5枠）を読み込み、ガレージの「ボディ」に並べる。id は my0〜my4
// 性能 = 選んだ系統の基準ボディ ＋ 形の効果（体積→重さ、前から見た面積→空気抵抗。どちらも±3%で頭打ち）
export const BODY_KEY = skey('kumitate-racer.bodies.v1');
export const customBodyData = new Map<string, BodyData2>();
const BASE: Record<BodyLine, string> = { edge: 'slider', stream: 'cyclone', balance: 'twin' };
export const LINE_JA: Record<BodyLine, string> = { edge: '直線', stream: '流線', balance: 'バランス' };
export const BASE_NAME: Record<BodyLine, string> = { edge: 'スライダー', stream: 'サイクロン', balance: 'ツインバーナー' };
const CHASSIS_TOP = 0.9 * 2.3; // シャーシの板を上から見た面積

let ref: BodyMetrics | null = null;
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
export function shapeEffect(body: BodyData2) {
  ref ??= bodyMetrics(SAMPLE_BODY);
  const m = bodyMetrics(body);
  let wk = clamp(m.volume / ref.volume - 1);
  let dk = clamp(m.front / ref.front - 1);
  // 小さすぎるボディ（上から見てシャーシの半分を覆わない）は、軽さ・空気抵抗の得をなくす（板1枚が最速にならないように）
  const tooSmall = m.top < CHASSIS_TOP * 0.5;
  if (tooSmall) {
    wk = Math.max(0, wk);
    dk = Math.max(0, dk);
  }
  return { weight: 1 + 0.03 * wk, speed: 1 - 0.03 * dk, accel: 1 - 0.015 * dk, wPct: 3 * wk, dPct: 3 * dk, tooSmall };
}
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

export function loadCustomBodies() {
  customBodies.length = 0;
  customBodyData.clear();
  let slots: unknown[] = [];
  try {
    slots = JSON.parse(localStorage.getItem(BODY_KEY) ?? 'null')?.slots ?? [];
  } catch {
    return;
  }
  slots.forEach((raw, i) => {
    const b = parseBody2(raw);
    if (!b || !b.items.length) return;
    const id = `my${i}`;
    const base = part('body', BASE[b.line]) as PartOption & Record<string, number>;
    const e = shapeEffect(b);
    customBodies.push({
      ...base, id, name: `★${b.name}`, price: 0, tier: 'N', transform: false, line: b.line, cowl: 'open',
      weight: base.weight * e.weight, speed: base.speed * e.speed, accel: base.accel * e.accel,
      note: `自作ボディ（枠${i + 1}・${LINE_JA[b.line]}型）。${base.name}の性能＋形の効果: 重さ${pct(e.wPct)} 空気抵抗${pct(e.dPct)}${e.tooSmall ? '（小さすぎるので軽さの得なし）' : ''}`,
    } as PartOption);
    customBodyData.set(id, b);
  });
}
if (typeof localStorage !== 'undefined') loadCustomBodies();
