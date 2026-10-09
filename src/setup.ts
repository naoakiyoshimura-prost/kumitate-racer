import type { Tuning } from './car';
import parts from './data/parts.json';

// パーツの組み合わせ → 走行計算が見る性能値（tuning の car / corner / tire）
// 走行計算（car.ts）は性能値だけを見る。パーツが増えてもここだけ直せばよい

export type Category =
  | 'body' | 'motor' | 'gear' | 'compound' | 'tireSize' | 'tread' | 'shaft' | 'rollerF' | 'rollerR' | 'bumperF' | 'bumperR'
  | 'layout' | 'wingF' | 'wingR' | 'damperF' | 'damperR' | 'suspension' | 'lightKit';
export type Build = Record<Category, string>;

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'body', label: 'ボディ（EX技）' },
  { key: 'motor', label: 'モーター' },
  { key: 'gear', label: 'ギヤ比' },
  { key: 'compound', label: 'タイヤ' },
  { key: 'tireSize', label: 'タイヤ径' },
  { key: 'tread', label: 'トレッド幅' },
  { key: 'shaft', label: '軸受け' },
  { key: 'rollerF', label: 'ローラー前' },
  { key: 'rollerR', label: 'ローラー後' },
  { key: 'bumperF', label: 'バンパー前' },
  { key: 'bumperR', label: 'バンパー後' },
  { key: 'layout', label: 'モーター位置' },
  { key: 'wingF', label: 'ウィング前' },
  { key: 'wingR', label: 'ウィング後' },
  { key: 'damperF', label: 'マスダンパー前' },
  { key: 'damperR', label: 'マスダンパー後' },
  { key: 'suspension', label: 'サスペンション' },
  { key: 'lightKit', label: '軽量化' },
];

export type Tier = 'N' | 'T' | 'H' | 'R' | 'EX';
export const TIER_LABEL: Record<Tier, string> = { N: 'ノーマル', T: 'チューンド', H: 'ハイパー', R: 'レーシング', EX: 'EX' };

export interface PartOption {
  id: string;
  name: string;
  note: string;
  tier: Tier;
  cost: number; // ランクポイント。合計がレースのコスト上限以下でないと出られない
  price: number; // ショップ価格（0=最初から所持）
}

export const options = (c: Category): PartOption[] => parts[c] as PartOption[];

// 改造段階（+1〜+3）。同じコストのまま性能だけ少し上がる
export const MAX_UPGRADE = 3;
export type Upgrades = (c: Category, id: string) => number;
const noUpgrades: Upgrades = () => 0;
const UPGRADE = parts.upgrade as Partial<Record<Category, Record<string, number>>>;
export const canUpgrade = (c: Category, id: string) => !!UPGRADE[c] && id !== 'none';
export const upgradePrice = (c: Category, id: string, nextLevel: number) =>
  Math.round((Math.max(part(c, id).price, 300) * [0, 0.3, 0.6, 1][nextLevel]) / 10) * 10;
export const part = (c: Category, id: string): PartOption => options(c).find((o) => o.id === id) ?? options(c)[0];

// マシンの合計コストと、一番高い単品コスト
export function buildCost(build: Build) {
  let total = 0;
  let single = 0;
  for (const c of CATEGORIES) {
    const cost = part(c.key, build[c.key]).cost;
    total += cost;
    single = Math.max(single, cost);
  }
  return { total, single };
}
export const defaultBuild = (): Build => ({ ...(parts.default as Build) });

// パーツの数値（改造段階を反映済み）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickPart(c: Category, id: string, lv: number): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = { ...((parts[c] as { id: string }[]).find((o) => o.id === id) ?? parts[c][0]) };
  if (lv > 0 && canUpgrade(c, p.id)) {
    for (const [f, per] of Object.entries(UPGRADE[c]!)) p[f] *= 1 + per * lv;
  }
  return p;
}

const BASE_RATIO = 3.7;
const BASE_DRAG = 0.1;

export function applyBuild(base: Tuning, build: Build, upgrades: Upgrades = noUpgrades): Tuning {
  const pick = (c: Category) => pickPart(c, build[c], upgrades(c, build[c]));
  const m = pick('motor');
  const g = pick('gear');
  const c = pick('compound');
  const ts = pick('tireSize');
  const tr = pick('tread');
  const sh = pick('shaft');
  const rf = pick('rollerF');
  const rr = pick('rollerR');
  const bf = pick('bumperF');
  const br = pick('bumperR');
  const l = pick('layout');
  const wf = pick('wingF');
  const wr = pick('wingR');
  const df = pick('damperF');
  const dr = pick('damperR');
  const su = pick('suspension');
  const lk = pick('lightKit');
  const bd = pick('body');

  const weight = ts.weight * tr.weight * Math.sqrt(rf.weight * rr.weight) * bf.weight * br.weight * wf.weight * wr.weight *
    df.weight * dr.weight * su.weight * lk.weight * bd.weight;
  const ratio = g.ratio / BASE_RATIO;
  // 抵抗はモーターのトルクが弱いほど効く（ハイグリップ×高回転型は伸びない）
  const drag = c.drag * tr.drag + wf.drag + wr.drag + sh.drag;
  const dragLoss = (1 - drag / m.torque) / (1 - BASE_DRAG);
  // 前は衝撃（コースアウト耐性）、後ろは壁沿いの減速に効く
  const rollerDrag = rf.rollerDrag ** 0.4 * rr.rollerDrag ** 0.6 * bf.rollerDrag ** 0.5 * br.rollerDrag;
  const impact = rf.impact ** 0.6 * rr.impact ** 0.4 * bf.impact * br.impact ** 0.5;
  // 前後どちらにもウィングがあると空力バランスが取れて効きが上がる
  const aeroBalance = wf.downforce > 0 && wr.downforce > 0 ? 1.2 : 1;

  const t: Tuning = structuredClone(base);
  t.car.maxSpeed = base.car.maxSpeed * m.rpm * ts.diameter / ratio * dragLoss / Math.sqrt(weight);
  t.car.accel = base.car.accel * m.torque * ratio / ts.diameter / weight * l.accel * bd.accel * sh.accel;
  t.corner.grip = base.corner.grip * c.grip * tr.grip * su.grip;
  t.corner.slideFactor = base.corner.slideFactor * l.slide * bd.slide;
  t.corner.rollerDrag = base.corner.rollerDrag * rollerDrag * bd.rollerDrag;
  t.corner.courseOutImpact = base.corner.courseOutImpact * impact * bd.impact;
  t.tire.wearRate = base.tire.wearRate * c.wear * tr.grip;
  t.car.diameter = ts.diameter;
  t.car.stability = base.car.stability + ts.stability + l.stability + wf.stability + wr.stability + df.stability + dr.stability +
    su.stability + lk.stability + bd.stability;
  t.car.ex = bd.ex;
  t.car.transform = !!bd.transform;
  t.corner.downforce = (wf.downforce + wr.downforce) * aeroBalance;
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
