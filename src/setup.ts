import type { Tuning } from './car';
import parts from './data/parts.json';

// パーツの組み合わせ → 走行計算が見る性能値（tuning の car / corner / tire）
// 走行計算（car.ts）は性能値だけを見る。パーツが増えてもここだけ直せばよい

export type Category =
  | 'driver' | 'body' | 'chassis' | 'motor' | 'booster' | 'gear' | 'compound' | 'tireSize' | 'tread' | 'shaft' | 'rollerF' | 'rollerR' | 'bumperF' | 'bumperR'
  | 'layout' | 'wingF' | 'wingR' | 'damperF' | 'damperR' | 'suspension' | 'lightKit';
export type Build = Record<Category, string>;

export const CATEGORIES: { key: Category; label: string; hidden?: boolean }[] = [
  { key: 'driver', label: 'ドライバー' },
  { key: 'body', label: 'ボディ' },
  { key: 'chassis', label: 'シャーシ' },
  { key: 'motor', label: 'モーター' },
  { key: 'booster', label: 'ブースター' },
  { key: 'gear', label: 'ギヤ比' },
  { key: 'compound', label: 'タイヤ' },
  { key: 'tireSize', label: 'タイヤ径' },
  { key: 'tread', label: 'トレッド幅' },
  { key: 'shaft', label: '軸受け' },
  { key: 'rollerF', label: 'ローラー前' },
  { key: 'rollerR', label: 'ローラー後' },
  { key: 'bumperF', label: 'バンパー前' },
  { key: 'bumperR', label: 'バンパー後' },
  { key: 'layout', label: 'モーター位置', hidden: true }, // 駆動方式（シャーシ）に含めたので選ばない
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

// ボディ工房で作った自作ボディ（src/body/custom.ts が読み込む）。ボディの選択肢の後ろに並ぶ
export const customBodies: PartOption[] = [];
export const options = (c: Category): PartOption[] => (c === 'body' ? [...(parts.body as PartOption[]), ...customBodies] : (parts[c] as PartOption[]));

// 改造段階（+1〜+3）。同じコストのまま性能だけ少し上がる
export const MAX_UPGRADE = 3;
export type Upgrades = (c: Category, id: string) => number;
const noUpgrades: Upgrades = () => 0;
const UPGRADE = parts.upgrade as Partial<Record<Category, Record<string, number>>>;
export const canUpgrade = (c: Category, id: string) => (c === 'motor' || !!UPGRADE[c]) && id !== 'none';
export const upgradePrice = (c: Category, id: string, nextLevel: number) =>
  Math.round((Math.max(part(c, id).price, 300) * [0, 0.3, 0.6, 1][nextLevel]) / 10) * 10;
export const part = (c: Category, id: string): PartOption => options(c).find((o) => o.id === id) ?? options(c)[0];

// マシンの合計コストと、一番高い単品コスト
export function buildCost(build: Build) {
  let total = 0;
  let single = 0;
  for (const c of CATEGORIES) {
    const id = c.key === 'tireSize' && FIXED_TIRE[build.chassis] ? FIXED_TIRE[build.chassis] : build[c.key];
    const cost = part(c.key, id).cost;
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
  const p: any = { ...(options(c).find((o) => o.id === id) ?? parts[c][0]) };
  if (lv > 0 && c === 'motor') {
    // モーター: 全体が少し上がり、得意（回転かトルク）と苦手の差も広がる
    const up = parts.motorUpgrade;
    const avg = (p.rpm + p.torque) / 2;
    const mean = avg * (1 + up.mean * lv);
    const trait = 1 + up.trait * lv;
    const { rpm, torque } = p;
    p.rpm = mean + (rpm - avg) * trait;
    p.torque = mean + (torque - avg) * trait;
  } else if (lv > 0 && canUpgrade(c, p.id)) {
    for (const [f, per] of Object.entries(UPGRADE[c]!)) p[f] *= 1 + per * lv;
  }
  return p;
}

// ギヤ比は4:1が基準。効きは実際の比率よりややマイルドにする
// 変形機構付きのボディかシャーシか（変形マシンはカナードを付けられない。変形翼と役割が重なるため）
export function isTransformBuild(build: Build): boolean {
  return !!(part('body', build.body) as { transform?: boolean }).transform || !!(part('chassis', build.chassis) as { transform?: boolean }).transform;
}

const BASE_RATIO = 4;
const RATIO_EFFECT = 0.75;
const BASE_DRAG = 0.1;

// 6輪・8輪はタイヤ径を選べない（元々性能が高いので、径でさらに調整させない）。見た目の径は carModel.ts の AXLES
// 性能は中径26mm（基準値、増減なし）で固定する。見た目どおり小径で計算すると8輪が全コース最下位になったため（chassissim）
export const FIXED_TIRE: Record<string, string> = { front6: 'standard', rear6: 'standard', eight: 'standard', formula6: 'standard' };

export function applyBuild(base: Tuning, build: Build, upgrades: Upgrades = noUpgrades): Tuning {
  const pick = (c: Category) => pickPart(c, build[c], upgrades(c, build[c]));
  const m = pick('motor');
  const bo = pick('booster');
  const g = pick('gear');
  const c = pick('compound');
  const ts = FIXED_TIRE[build.chassis] ? pickPart('tireSize', FIXED_TIRE[build.chassis], 0) : pick('tireSize');
  const tr = pick('tread');
  const sh = pick('shaft');
  const rf = pick('rollerF');
  const rr = pick('rollerR');
  const bf = pick('bumperF');
  const br = pick('bumperR');
  // モーター位置は駆動方式（シャーシ）で決まる。走りの違いはシャーシの値に含めているので、位置そのものの補正は使わない
  const l = pickPart('layout', 'mid', 0);
  const noWing = isTransformBuild(build);
  const wf = noWing ? pickPart('wingF', 'none', 0) : pick('wingF');
  const wr = noWing ? pickPart('wingR', 'none', 0) : pick('wingR');
  const df = pick('damperF');
  const dr = pick('damperR');
  const su = pick('suspension');
  const lk = pick('lightKit');
  const bd = pick('body');
  const dv = pick('driver');
  const ch = pick('chassis');

  const weight = ts.weight * tr.weight * Math.sqrt(rf.weight * rr.weight) * bf.weight * br.weight * wf.weight * wr.weight *
    df.weight * dr.weight * su.weight * lk.weight * bd.weight * ch.weight;
  const ratio = (g.ratio / BASE_RATIO) ** RATIO_EFFECT;
  // 抵抗はモーターのトルクが弱いほど効く（ハイグリップ×高回転型は伸びない）
  const drag = c.drag * tr.drag + wf.drag + wr.drag + sh.drag;
  const dragLoss = (1 - drag / m.torque) / (1 - BASE_DRAG);
  // 前は衝撃（コースアウト耐性）、後ろは壁沿いの減速に効く
  const rollerDrag = rf.rollerDrag ** 0.4 * rr.rollerDrag ** 0.6 * bf.rollerDrag ** 0.5 * br.rollerDrag;
  const impact = rf.impact ** 0.6 * rr.impact ** 0.4 * bf.impact * br.impact ** 0.5;
  // 前後どちらにもウィングがあると空力バランスが取れて効きが上がる
  const aeroBalance = wf.downforce > 0 && wr.downforce > 0 ? 1.2 : 1;

  const t: Tuning = structuredClone(base);
  t.car.maxSpeed = base.car.maxSpeed * m.rpm * ts.diameter / ratio * dragLoss / Math.sqrt(weight) * ch.speed * bd.speed;
  t.car.accel = base.car.accel * m.torque * ratio / ts.diameter / weight * l.accel * bd.accel * sh.accel * ch.accel;
  t.corner.grip = base.corner.grip * c.grip * tr.grip * su.grip * ch.grip * ((ts as { grip?: number }).grip ?? 1);
  t.corner.slideFactor = base.corner.slideFactor * l.slide * bd.slide * ch.slide * Math.sqrt(rf.slide * rr.slide);
  t.corner.rollerDrag = base.corner.rollerDrag * rollerDrag * bd.rollerDrag;
  t.corner.courseOutImpact = base.corner.courseOutImpact * impact * bd.impact * ch.impact;
  t.tire.wearRate = base.tire.wearRate * c.wear * tr.grip * ((ch as { wear?: number }).wear ?? 1);
  t.car.diameter = ts.diameter;
  t.car.stability = base.car.stability + ts.stability + l.stability + wf.stability + wr.stability + df.stability + dr.stability +
    su.stability + lk.stability + bd.stability + ch.stability + rf.stability + rr.stability;
  // モーターはゲージ回復、ブースターはブーストの消費・加速・最高速・持続時間を決める
  t.boost.regen = base.boost.regen * m.regen * bd.regen;
  t.boost.boostCost = base.boost.boostCost * bo.boostCost;
  t.boost.accelMul = 1 + (base.boost.accelMul - 1) * bo.accel;
  t.boost.speedMul = 1 + (base.boost.speedMul - 1) * bo.speed;
  t.boost.duration = base.boost.duration * bo.duration * bd.boostTime;
  // EX技はドライバーが持つ。ドライバーの得意不得意も性能に乗せる
  // フロント2WDはドリフトできない
  t.car.ex = (ch as { noDrift?: boolean }).noDrift && dv.ex === 'drift' ? 'none' : dv.ex;
  // 駆動方式ごとの得意コーナー: 低速（きつい）コーナーと高速（ゆるい）コーナーでグリップが変わる
  t.car.reaccel = ch.reaccel;
  t.corner.gripTight = ch.gripTight;
  t.corner.gripWide = ch.gripWide;
  t.corner.slideTight = ch.slideTight;
  // グリップを超えたときの崩れ方（アンダー・スピン）は駆動方式で決まる
  t.corner.under = ch.under ?? 0;
  t.corner.underTight = ch.underTight ?? 0.5;
  t.corner.spin = ch.spin ?? 0;
  t.corner.spinDrift = ch.spinDrift ?? 0;
  t.corner.spinBoost = ch.spinBoost ?? 0;
  t.corner.boostGrip = ch.boostGrip ?? 1;
  t.corner.driftMul = ch.driftMul ?? 1;
  t.corner.driftStar = (ch as { driftStar?: number }).driftStar ?? 3;
  // 硬いタイヤでもグリップが落ちにくいシャーシ（EX 6輪フォーミュラ）: タイヤのグリップ不足を hardGrip の割合だけ取り戻す
  const hardGrip = (ch as { hardGrip?: number }).hardGrip ?? 0;
  if (hardGrip && c.grip < 1) t.corner.grip *= (1 - (1 - c.grip) * (1 - hardGrip)) / c.grip;
  t.car.maxSpeed *= dv.speed;
  t.car.accel *= dv.accel;
  t.corner.grip *= dv.grip;
  t.car.stability += dv.stability;
  t.boost.regen *= dv.regen;
  t.corner.courseOutImpact *= dv.impact;
  // 諸刃のドライバー（アズパカ）: コースアウトとスピンで止まっている時間が mishap 倍
  const mishap = (dv as { mishap?: number }).mishap ?? 1;
  t.corner.respawnTime *= mishap;
  if (t.spin) t.spin.time *= mishap;
  // 変形できるのは変形機構付きのボディかシャーシ
  t.car.transform = !!bd.transform || !!ch.transform;
  // 小型の変形機構（4WDエアロ）は、エアロモードの伸びが小さい
  const aeroSpeed = (ch as { aeroSpeed?: number }).aeroSpeed;
  if (aeroSpeed) t.aero = { ...t.aero, speedMul: aeroSpeed };
  t.corner.downforce = (wf.downforce + wr.downforce) * aeroBalance;
  // ブーストで上がる最高速は、どのマシンも同じ量（km/h）。標準マシンの最高速を基準にする（速いマシンほど得をしないように）
  const ref = refTop(base);
  t.boost.speedAdd = ref * (t.boost.speedMul - 1);
  t.boost.doubleAdd = ref * base.boost.speedMul * (base.ex.doubleMul - 1);
  return t;
}
// 標準マシン（最初の組み合わせ）の最高速。ブーストの伸び幅の基準
const refCache = new WeakMap<Tuning, number>();
let inRef = false;
function refTop(base: Tuning): number {
  if (inRef) return base.car.maxSpeed;
  if (!refCache.has(base)) {
    inRef = true;
    try {
      refCache.set(base, applyBuild(base, defaultBuild()).car.maxSpeed);
    } finally {
      inRef = false;
    }
  }
  return refCache.get(base)!;
}

// 画面表示用の5項目（標準セッティングを50とした目安）
// ブーストの強さの目安: 伸び幅×持続時間を、ゲージ消費で割る
const boostPower = (t: Tuning) => ((t.boost.speedMul - 1) + (t.boost.accelMul - 1) * 0.2) * t.boost.duration / t.boost.boostCost;

export function stats(tuning: Tuning, t: Tuning) {
  const base = applyBuild(tuning, defaultBuild());
  // フルノーマル＝100。伸びすぎる項目は p 乗で縮めて、改造の幅が見えるようにする
  const rel = (v: number, b: number, p = 1) => Math.round((v / b) ** p * 100);
  return [
    { label: '最高速', value: rel(t.car.maxSpeed, base.car.maxSpeed) },
    { label: '加速', value: rel(t.car.accel, base.car.accel) },
    { label: 'コーナー', value: rel(t.corner.grip / t.corner.slideFactor, base.corner.grip / base.corner.slideFactor) },
    { label: 'タイヤ耐久', value: rel(base.tire.wearRate, t.tire.wearRate) },
    { label: '着地安定', value: rel(Math.max(landingMargin(t), 0.01), landingMargin(base), 0.6) },
    { label: '壁の強さ', value: rel(t.corner.courseOutImpact / t.corner.rollerDrag, base.corner.courseOutImpact / base.corner.rollerDrag, 0.5) },
    { label: 'ゲージ回復', value: rel(t.boost.regen, base.boost.regen) },
    { label: 'ブースト', value: rel(boostPower(t), boostPower(base)) },
  ];
}

// 最高速でジャンプしたときに、着地安定性がどれだけ余っているか（表示用）
function landingMargin(t: Tuning) {
  const v = t.car.maxSpeed;
  const vy = v * Math.tan((t.air.rampAngle * Math.PI) / 180);
  const load = vy * t.landing.vyFactor + v * t.landing.speedFactor * t.car.diameter;
  return Math.max(0.5, t.car.stability - load + 6);
}

// ドライバーの得意コースは最高速・加速+3%、苦手コースは-3%
export function applyCourse(t: Tuning, build: Build, courseId: string): Tuning {
  const dv = part('driver', build.driver) as PartOption & { good?: string[]; bad?: string[] };
  const mul = dv.good?.includes(courseId) ? 1.03 : dv.bad?.includes(courseId) ? 0.97 : 1;
  const out: Tuning = structuredClone(t);
  out.car.maxSpeed *= mul;
  out.car.accel *= mul;
  return out;
}
