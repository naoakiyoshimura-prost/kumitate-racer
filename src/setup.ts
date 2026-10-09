import type { Tuning } from './car';
import parts from './data/parts.json';

// パーツの組み合わせ → 走行計算が見る性能値（tuning の car / corner / tire）
// 走行計算（car.ts）は性能値だけを見る。パーツが増えてもここだけ直せばよい

export type Category = 'body' | 'motor' | 'gear' | 'compound' | 'tireSize' | 'tread' | 'roller' | 'layout' | 'wing' | 'damper';
export type Build = Record<Category, string>;

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'body', label: 'ボディ（EX技）' },
  { key: 'motor', label: 'モーター' },
  { key: 'gear', label: 'ギヤ比' },
  { key: 'compound', label: 'タイヤ' },
  { key: 'tireSize', label: 'タイヤ径' },
  { key: 'tread', label: 'トレッド幅' },
  { key: 'roller', label: 'ローラー（前後4か所）' },
  { key: 'layout', label: 'モーター位置' },
  { key: 'wing', label: 'ウィング' },
  { key: 'damper', label: 'マスダンパー' },
];

export interface PartOption {
  id: string;
  name: string;
  note: string;
}

export const options = (c: Category): PartOption[] => parts[c] as PartOption[];
export const defaultBuild = (): Build => ({ ...(parts.default as Build) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pick = (c: Category, id: string): any => (parts[c] as { id: string }[]).find((p) => p.id === id) ?? parts[c][0];

const BASE_RATIO = 3.7;
const BASE_DRAG = 0.1;

export function applyBuild(base: Tuning, build: Build): Tuning {
  const m = pick('motor', build.motor);
  const g = pick('gear', build.gear);
  const c = pick('compound', build.compound);
  const ts = pick('tireSize', build.tireSize);
  const tr = pick('tread', build.tread);
  const r = pick('roller', build.roller);
  const l = pick('layout', build.layout);
  const w = pick('wing', build.wing);
  const d = pick('damper', build.damper);
  const bd = pick('body', build.body);

  const weight = ts.weight * tr.weight * r.weight * w.weight * d.weight * bd.weight;
  const ratio = g.ratio / BASE_RATIO;
  // 抵抗はモーターのトルクが弱いほど効く（ハイグリップ×高回転型は伸びない）
  const drag = c.drag * tr.drag + w.drag;
  const dragLoss = (1 - drag / m.torque) / (1 - BASE_DRAG);

  const t: Tuning = structuredClone(base);
  t.car.maxSpeed = base.car.maxSpeed * m.rpm * ts.diameter / ratio * dragLoss / Math.sqrt(weight);
  t.car.accel = base.car.accel * m.torque * ratio / ts.diameter / weight * l.accel * bd.accel;
  t.corner.grip = base.corner.grip * c.grip * tr.grip;
  t.corner.slideFactor = base.corner.slideFactor * l.slide * bd.slide;
  t.corner.rollerDrag = base.corner.rollerDrag * r.rollerDrag * bd.rollerDrag;
  t.corner.courseOutImpact = base.corner.courseOutImpact * r.impact * bd.impact;
  t.tire.wearRate = base.tire.wearRate * c.wear * tr.grip;
  t.car.diameter = ts.diameter;
  t.car.stability = base.car.stability + ts.stability + l.stability + w.stability + d.stability + bd.stability;
  t.car.ex = bd.ex;
  t.corner.downforce = w.downforce;
  return t;
}

// 画面表示用の5項目（標準セッティングを50とした目安）
export function stats(tuning: Tuning, t: Tuning) {
  const base = applyBuild(tuning, defaultBuild());
  const rel = (v: number, b: number) => Math.max(5, Math.min(100, Math.round((v / b) * 50)));
  return [
    { label: '最高速', value: rel(t.car.maxSpeed ** 2, base.car.maxSpeed ** 2) },
    { label: '加速', value: rel(t.car.accel, base.car.accel) },
    { label: 'コーナー', value: rel(t.corner.grip / t.corner.slideFactor, base.corner.grip / base.corner.slideFactor) },
    { label: 'タイヤ耐久', value: rel(base.tire.wearRate, t.tire.wearRate) },
    { label: '着地安定', value: rel(landingMargin(t), landingMargin(base)) },
    { label: '壁の強さ', value: rel(t.corner.courseOutImpact / t.corner.rollerDrag, base.corner.courseOutImpact / base.corner.rollerDrag) },
  ];
}

// 最高速でジャンプしたときに、着地安定性がどれだけ余っているか（表示用）
function landingMargin(t: Tuning) {
  const v = t.car.maxSpeed;
  const vy = v * Math.tan((t.air.rampAngle * Math.PI) / 180);
  const load = vy * t.landing.vyFactor + v * t.landing.speedFactor * t.car.diameter;
  return Math.max(0.5, t.car.stability - load + 6);
}
