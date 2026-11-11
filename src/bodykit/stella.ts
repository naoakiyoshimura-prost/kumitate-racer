import { Painter, fullRing, tab } from './painter';
import { clamp01, ease, type CarKit, type Detail, type Motion, type Palette, type PartDef, type Slot, type Unit, type V3 } from './types';

// STELLA（店長オリジナル、角型ブースター版）を部位ごとに作る。部位キットの試作1台目。
// 参考: STELLA_angular_v6 の4状態×4方向の分解図（生成画像なので前後図と横図で形が食い違う。決め方は下の「決めたこと」）。
//
// 8実体: コア / 前ボンネット&フェンダー左右 / 後肩カウル&アーチ左右 / リアウィング一式 / ブーストポッド左右
// 4状態: 0=NORMAL（全部格納） 1=BOOST1（ポッドとウィングの支持部が伸びる） 2=BOOST2（金リングが後ろへ伸びる）
//        3=BOOST3（ポッドの隠しダクトとカナードが展開）。setState は連続値で補間する。
//
// ポッドの動き方（PodRig）は3案を差し替えられる。ポッドの形は共通で、動き方と後肩カウルの「格納の型」だけが変わる:
//   A = 参考画どおり。台座と関節つきの腕で持ち上がる（NORMAL は後肩カウルの低い棚の上に伏せる）
//   B = スライド式。カウルのくぼみに沈んで上面だけ見え、BOOST1 で側壁のレールに沿って後ろ上へ滑り出る
//   C = カウル開き式（既定）。カウルの下に完全に隠れ、BOOST1 で上面パネルが外側へ跳ね上がり、折りたたみの腕で上がる
//
// 形は標準シャーシ（std4・中径タイヤ）の寸法で作る: 車軸 z=±0.72、タイヤ半径 0.3、タイヤの内側 x=0.48・外側 0.72
// （標準トレッド）、シャーシ板の上面 y≈0.255、ローラー先端 |x|=0.95。
// 別のシャーシ・タイヤ径・トレッドには StellaFit で形を変形して合わせる（下の「シャーシ追従」）。
//
// ── 数値表（[推]=参考画から読んだ推定、[仮]=参考画に無いので仮に決めた値） ───────────────
//  全体   ノーズ先端 z=+1.42 [推]、テール後端 z=-1.30 [推]、全幅 1.60（フェンダー外 |x|=0.80）[推]
//         キャノピー: 前端 z=0.80（ノーズの肩）→ 屋根 z 0.15〜-0.1・頂 y=0.905 → 後端 z=-0.42 [推: 横図でガラスがコア全長の約45%]
//         キャノピー半幅 0.25（胴の約7割）[推: 前図でキャノピーが胴の幅いっぱい]
//         胴の肩 y 0.55〜0.60（キャノピーの下）、後ろの背 y 0.73 [推: 横図でキャノピー後ろの白い背]
//         側面の白い斜めパネル: 胴の側面の下 5%→70%、上 75%→95%（前→後ろへ上がる）[推: 横図の斜めの白帯]
//  前フェンダー  z 0.28〜1.18、x 0.40〜0.78、上面 y 0.69（車軸の上）[推]。前面の黒い面は外周の 82%、白い縁は内側 26% [推]
//  後肩カウル    z -0.16〜-1.18、外殻 x 0.47〜0.80、上面 y 0.74 [推]。肩（ポッドの居場所）x 0.245〜0.47 [仮]
//  装甲板        上の板 0.014・横の板 0.012 浮かせる（板の段差）、板の側面は黒（溝に見える）[仮]
//  ウィング      翼端板の外 |x|=0.71、前縁 z=-1.00〜後縁 -1.38、NORMAL の翼下面 y≈0.79 [推]、支柱 x=±0.085 [推: 前後図]
//  ポッド        中心 x=±0.36、長さ 0.60（z +0.30〜-0.30）、半幅 0.095、半高 0.10 [推: 分解図の比率]
//                前の吸気口は上が 0.07 前へ出る斜め切り [推: 横図]、後ろは 74% に絞って金リング [推]
//  可動量        ウィング上昇 0.16 [仮]、金リング伸び 0.085 [推: B2横図でリング幅の約1.5倍]、
//                ダクト上昇 0.07 [仮]、カナードのせり出し 0.11・翼幅 0.13 [推: B3図で大きめ]、
//                ポッド上昇 A=0.17 [仮] / B=後ろ上へ (0, 0.20, -0.15) [仮] / C=0.33（フタ開き 155°）[仮]
//  色（白青赤）  base #f3f5f8 / sub #1d4ed8 / line #e3202b / frame #191b21 / glass #142636 / metal #d6a338 [推: 参考画の色味]
//
// ── 決めたこと（参考画の食い違い） ─────────────────────────────────────
//  ・ウィング: 横図では翼弦が車長の半分近い長い楔、前後図では細い一枚板。→ 翼弦 0.38（車長の約11%）の楔断面に統一、
//    後ろが厚い。支柱は前後図の「左右に2本」を採用（横図の前後2本は採らない）
//  ・ポッドの台座と腕: 横図は斜めの1本腕＋肘、前後図は縦の短い柱。→ 2本リンクの折りたたみ腕（肘が前へ出る）に統一。
//    先端は真上に上がる（ポッドは前後に動かない）
//  ・B3 のスクープ: 横図は前向きの口、後図は口の向きが不明。→ 前向き（ラム吸気）に統一
//  ・前照灯: 前図の画面左（= -x 側）が赤、画面右（+x 側）が青。→ -x=lamp（赤）、+x=lamp2（青）
//  ・コア後部: 後図では幅広の黒い吸気口つき、横図では細い尾。→ 下半分は幅0.46の箱（後面に黒いルーバー）、
//    上は細い尾びれ（青い先端）。尾びれはウィング支柱の間を通す
//  ・README の訂正（円筒型 glb を正本とし角型は旧別案）: 依頼どおり角型を基準にした
//
// ── シャーシ追従（StellaFit） ─────────────────────────────────────────
//  車軸を前のまとまり（z>0）と後ろのまとまり（z<0）に分け、それぞれの中心 zc・前後2軸の間隔 h・タイヤ半径 r を使う。
//  ・前フェンダー／後肩カウル: タイヤ中心の真下（地面）を基準に、高さと前後を r/0.3 倍（アーチがタイヤと相似に）。
//    2軸（6輪・8輪）は車軸の真上で前後に h だけ引き伸ばす（アーチの天井が平らにつながる「長いフェンダー」）。
//    横はタイヤの内側（|x|=0.46）より外だけを (トレッド+0.09)/0.33 倍（外側の面がタイヤの外へ付いていく）
//  ・コア: 前後位置を区間ごとに直線で写す（前の車軸より前・車軸の間・後ろの車軸より後ろ）。高さはシャーシ板に合わせて上下
//  ・ウィング・ポッド: 形は変えずに平行移動（ポッドは後肩カウルの中の居場所、ウィングはコアの尾に付いていく）
//  ・目安: 標準4輪は変形なし（恒等）。6輪・8輪は細部が粗い（下の報告を参照）

const S = (s: number) => s; // 状態の読みやすさ用
const k1 = (s: number) => ease(S(s));
const k2 = (s: number) => ease(s - 1);
const k3 = (s: number) => ease(s - 2);

// ── 共通の可動 ───────────────────────────────────────────
const WING_LIFT = 0.26; // [仮: 後方カメラからポッドの噴射口が翼に隠れない高さ]
const RING_EXT = 0.085; // [推]
const DUCT_H = 0.07; // [仮]
const CAN_OUT = 0.11; // [推]
const WING: Motion = { id: 'stella.wing', kind: 'translate', at: (s, o) => void (o.p[1] = WING_LIFT * k1(s)) };
const RING: Motion = { id: 'stella.ring', kind: 'translate', at: (s, o) => void (o.p[2] = -RING_EXT * k2(s)) };
const DUCT: Motion = { id: 'stella.duct', kind: 'translate', at: (s, o) => void (o.p[1] = DUCT_H * k3(s)) };
const CAN_P: Motion = { id: 'stella.canP', kind: 'translate', at: (s, o) => { const k = k3(s); o.p[0] = CAN_OUT * k; o.vis = k > 0.002; } };
const CAN_N: Motion = { id: 'stella.canN', kind: 'translate', at: (s, o) => { const k = k3(s); o.p[0] = -CAN_OUT * k; o.vis = k > 0.002; } };
// low 用: ダクトとカナードを1つにして、下からせり上がりながら現れる
const DEPLOY_LOW: Motion = { id: 'stella.deployLow', kind: 'translate', at: (s, o) => { const k = k3(s); o.p[1] = -DUCT_H * (1 - k); o.vis = k > 0.02; } };

// ── ポッドの動き方（差し替え可能） ─────────────────────────────
export type PodRigId = 'A' | 'B' | 'C';
export interface PodRig {
  id: PodRigId;
  label: string;
  rest: V3; // 右ポッド本体の中心（NORMAL）
  move: V3; // BOOST1 での本体の移動量
  k(s: number): number; // 0→1 の進み具合
  arm?: { len: number; baseY: number; baseZ: number }; // 折りたたみ腕（A・C）
  lid?: { open: number; k(s: number): number }; // カウルの上面パネル（C）
}
export const POD_RIGS: Record<PodRigId, PodRig> = {
  A: { id: 'A', label: 'A 腕で持ち上げ', rest: [0.36, 0.735, -0.61], move: [0, 0.17, 0], k: k1, arm: { len: 0.1, baseY: 0.615, baseZ: -0.66 } },
  B: { id: 'B', label: 'B スライド', rest: [0.36, 0.6, -0.61], move: [0, 0.2, -0.15], k: k1 },
  C: {
    id: 'C', label: 'C カウル開き', rest: [0.36, 0.52, -0.61], move: [0, 0.33, 0],
    k: (s) => ease((s - 0.3) / 0.7), arm: { len: 0.18, baseY: 0.405, baseZ: -0.74 },
    lid: { open: (155 * Math.PI) / 180, k: (s) => ease(s / 0.55) },
  },
};
const POD_W = 0.095, POD_H = 0.1; // 半幅・半高

// ── シャーシ追従 ──────────────────────────────────────────
export interface AxleGroup {
  zc: number; // まとまりの中心（1軸ならその車軸）
  h: number; // 2軸の間隔（1軸は 0）
  r: number; // タイヤ半径（まとまりの中の最大）
}
export interface StellaFit {
  front: AxleGroup;
  rear: AxleGroup;
  treadW: number;
  deckY: number;
}
export const STD_FIT: StellaFit = { front: { zc: 0.72, h: 0, r: 0.3 }, rear: { zc: -0.72, h: 0, r: 0.3 }, treadW: 0.24, deckY: 0.225 };
// carModel の axlesOf（[前後位置, タイヤ半径][]）から作る
export function fitFromAxles(axles: [number, number][], treadW: number, deckY: number): StellaFit {
  const grp = (list: [number, number][], fallback: AxleGroup): AxleGroup => {
    if (!list.length) return fallback;
    const zs = list.map(([z]) => z);
    return { zc: (Math.max(...zs) + Math.min(...zs)) / 2, h: Math.max(...zs) - Math.min(...zs), r: Math.max(...list.map(([, r]) => r)) };
  };
  return { front: grp(axles.filter(([z]) => z > 0), STD_FIT.front), rear: grp(axles.filter(([z]) => z <= 0), STD_FIT.rear), treadW, deckY };
}
type Warp = (p: V3) => V3;
const xOut = (x: number, f: number) => {
  const a = Math.abs(x);
  return a <= 0.46 ? x : Math.sign(x) * (0.46 + (a - 0.46) * f);
};
// フェンダー・カウル: タイヤの真下を基準に相似、2軸は車軸の真上で引き伸ばす
function groupWarp(g: AxleGroup, zStd: number, fit: StellaFit): Warp {
  const k = g.r / 0.3;
  const f = (fit.treadW + 0.09) / 0.33;
  return ([x, y, z]) => [xOut(x, f), y * k, g.zc + (z - zStd) * k + (z >= zStd - 1e-5 ? g.h / 2 : -g.h / 2)];
}
// コア: 区間ごとの直線で前後を写し、高さはシャーシ板に合わせる
function coreZ(fit: StellaFit) {
  const F = fit.front, R = fit.rear;
  const kF = F.r / 0.3, kR = R.r / 0.3;
  const fIn = F.zc - F.h / 2, rIn = R.zc + R.h / 2;
  return (z: number) => (z >= 0.72 ? F.zc + F.h / 2 + (z - 0.72) * kF : z <= -0.72 ? R.zc - R.h / 2 + (z + 0.72) * kR : rIn + ((z + 0.72) / 1.44) * (fIn - rIn));
}
const isStd = (f: StellaFit) => JSON.stringify(f) === JSON.stringify(STD_FIT);
function warpPainter(p: Painter, w: Warp): Painter {
  const q = new Painter();
  q.slot = p.slot;
  const pos = new Array<number>(p.pos.length);
  for (let i = 0; i < p.pos.length; i += 3) {
    const v = w([p.pos[i], p.pos[i + 1], p.pos[i + 2]]);
    pos[i] = v[0];
    pos[i + 1] = v[1];
    pos[i + 2] = v[2];
  }
  q.pos = pos;
  return q;
}
const warpUnits = (units: Unit[], w: Warp): Unit[] =>
  units.map((u) => ({ ...u, paint: warpPainter(u.paint, w), pivot: u.pivot && w(u.pivot), marks: u.marks?.map((m) => ({ ...m, pos: w(m.pos) })) }));

// ── 部品の小道具 ───────────────────────────────────────────
const unit = (id: string, label: string, paint: Painter, o: Partial<Unit> = {}): Unit => ({ id, label, paint, ...o });
// 右（+x）側で作った形を、左なら反転。前照灯は +x 側が lamp2（青）、-x 側が lamp（赤）
const sided = (p: Painter, side: number) => {
  if (side > 0) {
    const q = new Painter();
    q.pos = p.pos;
    q.slot = p.slot.map((s) => (s === 6 ? 7 : s));
    return q;
  }
  return p.mirrorX();
};
const sv = (v: V3, side: number): V3 => [v[0] * side, v[1], v[2]];
// 平らな細い帯（a→b、面の法線 n に垂直な向きへ幅 w）。ライト・差し線用
function strip(P: Painter, a: V3, b: V3, w: number, n: V3, s: Slot) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let px = d[1] * n[2] - d[2] * n[1], py = d[2] * n[0] - d[0] * n[2], pz = d[0] * n[1] - d[1] * n[0];
  const l = Math.hypot(px, py, pz) || 1;
  px *= w / 2 / l;
  py *= w / 2 / l;
  pz *= w / 2 / l;
  P.quad([a[0] - px, a[1] - py, a[2] - pz], [b[0] - px, b[1] - py, b[2] - pz], [b[0] + px, b[1] + py, b[2] + pz], [a[0] + px, a[1] + py, a[2] + pz], s);
}

// タイヤアーチ: z での円の上端（無ければ -Infinity）
const AX_Y = 0.3; // 車軸の高さ＝タイヤ半径 [carModel std4]
const archY = (z: number, zc: number, R: number) => {
  const d = Math.abs(z - zc);
  return d < R ? AX_Y + Math.sqrt(R * R - d * d) : -Infinity;
};
// アーチの縁の近くほど細かく z を刻む。車軸の真上（zc と zc-0.003）には必ず断面を置く（2軸の引き伸ばし用）
const archZs = (zmin: number, zmax: number, zc: number, R: number, n: number, extra: number[]) => {
  const zs = [zmin, zmax, zc, zc - 0.003, ...extra];
  for (let i = 0; i <= n; i++) zs.push(zc + R * Math.cos((Math.PI * i) / n));
  zs.push(zc + R * 1.004, zc - R * 1.004);
  return [...new Set(zs.filter((z) => z >= zmin - 1e-6 && z <= zmax + 1e-6).map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => b - a);
};

// フェンダー・カウルの殻（タイヤを避ける）。断面11点の輪、色の境目（青/白・赤線）は z で動かして斜めの塗り分けにする
//   点: 0 内下 / 1 内壁下 / 2 内壁上 / 3 外下 / 4 外の下1/3 / 5 青白の境 / 6 外の肩 / 7 赤線の外 / 8 赤線の内 / 9 稜線 / 10 内上
interface ShellOpt {
  zs: number[];
  zc: number;
  R: number;
  base: number;
  xi: (z: number) => number;
  xo: (z: number) => number;
  top: (z: number) => number;
  split: (z: number) => number; // 外側面の青/白の境（0=下 1=上）
  line: (z: number) => number; // 上面の赤線の位置（0=外 1=内）
  slot: (edge: number, z: number) => Slot;
  ridge?: (z: number) => number; // 上面の稜線の x（無ければ内側の縁のすぐ外）
  innerY?: (z: number) => number; // 内側の縁の高さ（ボンネットのようにノーズへ下がる面を作る）
  well?: number; // タイヤハウスの内壁の x（これより内側はアーチで持ち上げない）
  caps?: [Slot, Slot]; // 前端・後端の面の色
  taper?: { z: number; c: [number, number]; k: number }[]; // その z の断面を点 c へ k 倍に縮める（隣の断面の形を使う）
  recess?: { k: number; depth: number }; // 後端の面を黒い奥まった口にする（縁を k 倍に縮めて depth だけ奥へ。殻が中空に見える）
}
function archShell(P: Painter, o: ShellOpt) {
  const zs = [...o.zs];
  for (const t of o.taper ?? []) if (!zs.includes(t.z)) zs.push(t.z);
  zs.sort((a, b) => b - a);
  const zMid = (o.zs[0] + o.zs[o.zs.length - 1]) / 2;
  const rings = zs.map((z): V3[] => {
    const tp = o.taper?.find((t) => Math.abs(t.z - z) < 1e-6);
    if (!tp) return ringAt(z);
    // 端の断面: 内側にある一番近い断面を縮めて置く
    const near = o.zs.reduce((m, q) => (Math.abs(q - zMid) < Math.abs(z - zMid) && Math.abs(q - z) < Math.abs(m - z) ? q : m), zMid);
    return ringAt(near).map(([x, y]) => [tp.c[0] + (x - tp.c[0]) * tp.k, tp.c[1] + (y - tp.c[1]) * tp.k, z] as V3);
  });
  function ringAt(z: number): V3[] {
    const yb = Math.max(o.base, archY(z, o.zc, o.R));
    const yt = Math.max(o.top(z), yb + 0.035);
    const xi = o.xi(z), xo = o.xo(z);
    const h = yt - yb;
    const sp = Math.min(0.9, Math.max(0.34, o.split(z)));
    const xw = Math.max(xi, o.well ?? xi);
    const xr = o.ridge ? o.ridge(z) : xi + 0.03;
    const yi = o.innerY ? Math.min(o.innerY(z), yt - 0.01) : Math.max(yb, yt - 0.05);
    const ybi = o.innerY ? o.base : yb;
    // 赤線: 外の肩（点6）と稜線の間を line で動く
    const x6 = xo - 0.045, y6 = yb + h * 0.84;
    const f = 0.12 + 0.76 * clamp01(o.line(z));
    const lx = x6 + (xr - x6) * f, ly = y6 + (yt - y6) * f;
    const f2 = Math.min(0.97, f + 0.016 / Math.max(0.02, Math.abs(x6 - xr)));
    return [
      [xi, ybi, z], [xw, ybi, z], [xw, yb, z], [xo - 0.02, yb, z], [xo + 0.012, yb + h * 0.3, z], [xo + 0.006, yb + h * sp, z],
      [x6, y6, z], [lx, ly, z], [x6 + (xr - x6) * f2, y6 + (yt - y6) * f2 + 0.001, z], [xr, yt, z], [xi, yi, z],
    ];
  }
  const zm = (k: number) => (zs[k] + zs[k + 1]) / 2;
  P.loft(rings, (k, e) => o.slot(e, zm(k)), { cap0: o.caps?.[0] ?? 'frame', cap1: o.recess ? null : o.caps?.[1] ?? 'frame' });
  if (o.recess) {
    const last = rings[rings.length - 1];
    let cx = 0, cy = 0;
    for (const p of last) {
      cx += p[0] / last.length;
      cy += p[1] / last.length;
    }
    const dir = Math.sign(zs[zs.length - 2] - zs[zs.length - 1]); // 奥（殻の内側）の向き
    const inner = last.map(([x, y, z]) => [cx + (x - cx) * o.recess!.k, cy + (y - cy) * o.recess!.k, z + dir * o.recess!.depth] as V3);
    P.loft([last, inner], () => 'frame', { cap1: 'frame' });
  }
  return { rings, zs, kOf: (z: number) => zs.reduce((m, q, i) => (Math.abs(q - z) < Math.abs(zs[m] - z) ? i : m), 0) };
}
// 装甲板: 殻の一部（断面 k0〜k1、点 v0〜v1）を外へ lift だけ浮かせた板。板の側面は黒（溝・段差に見える）
function plate(P: Painter, rings: V3[][], k0: number, k1: number, v0: number, v1: number, lift: number, slot: (k: number, e: number) => Slot, wall: Slot = 'frame') {
  if (k1 < k0) [k0, k1] = [k1, k0];
  const n = rings[0].length;
  const nrm = (k: number, j: number): V3 => {
    const R = rings[k];
    const a = R[Math.max(0, j - 1)], b = R[Math.min(n - 1, j + 1)];
    const A = rings[Math.max(0, k - 1)][j], B = rings[Math.min(rings.length - 1, k + 1)][j];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    let cx = 0, cy = 0;
    for (const p of R) {
      cx += p[0];
      cy += p[1];
    }
    cx /= n;
    cy /= n;
    const p = R[j];
    if (nx * (p[0] - cx) + ny * (p[1] - cy) < 0) [nx, ny, nz] = [-nx, -ny, -nz];
    const l = Math.hypot(nx, ny, nz);
    return l < 1e-9 ? [0, 0, 0] : [nx / l, ny / l, nz / l];
  };
  const G: V3[][] = [];
  for (let k = k0; k <= k1; k++) {
    const row: V3[] = [];
    for (let j = v0; j <= v1; j++) {
      const p = rings[k][j], m = nrm(k, j);
      row.push([p[0] + m[0] * lift, p[1] + m[1] * lift, p[2] + m[2] * lift]);
    }
    G.push(row);
  }
  const W = v1 - v0;
  for (let a = 0; a < G.length - 1; a++) for (let e = 0; e < W; e++) P.quad(G[a][e], G[a][e + 1], G[a + 1][e + 1], G[a + 1][e], slot(k0 + a, v0 + e));
  for (let a = 0; a < G.length - 1; a++) {
    P.quad(rings[k0 + a][v0], G[a][0], G[a + 1][0], rings[k0 + a + 1][v0], wall);
    P.quad(rings[k0 + a][v1], G[a][W], G[a + 1][W], rings[k0 + a + 1][v1], wall);
  }
  for (const [a, k] of [[0, k0], [G.length - 1, k1]]) for (let e = 0; e < W; e++) P.quad(rings[k][v0 + e], rings[k][v0 + e + 1], G[a][e + 1], G[a][e], wall);
}
// アーチの縁取り（外側の面に付く帯）。φ はタイヤ中心から見た角度（0=前、π=後ろ）
function archRim(P: Painter, zc: number, R1: number, R2: number, x0: (z: number) => number, x1: (z: number) => number, f0: number, f1: number, n: number, s: Slot) {
  const rings: V3[][] = [];
  const fs: number[] = [];
  for (let i = 0; i <= n; i++) fs.push(f0 + ((f1 - f0) * i) / n);
  fs.push(Math.PI / 2, Math.PI / 2 + 0.01); // 真上（2軸の引き伸ばし用）
  fs.sort((a, b) => a - b);
  for (const f of fs) {
    const c = Math.cos(f), si = Math.sin(f);
    const z = zc + R2 * c;
    rings.push([
      [x0(z), AX_Y + R1 * si, zc + R1 * c], [x0(z), AX_Y + R2 * si, zc + R2 * c],
      [x1(z), AX_Y + R2 * si, zc + R2 * c], [x1(z), AX_Y + R1 * si, zc + R1 * c],
    ]);
  }
  P.loft(rings, (_k, e) => (e === 1 || e === 2 ? s : 'frame'), { cap0: s, cap1: s });
}
// 面の中の黒い構造（後ろ姿の内部）: ルーバー・箱・丸穴。z0 は面の z、dz は手前へ出す向き（+1/-1）
function innerFrame(P: Painter, x: [number, number], y: [number, number], z0: number, dz: number, holes: [number, number][]) {
  const [x0, x1] = x, [y0, y1] = y;
  const cx = (x0 + x1) / 2, w = (x1 - x0) / 2;
  // 外周の枠（太い黒い縁）と横桟
  P.box([cx, y1 - 0.01, z0 + dz * 0.012], [w, 0.01, 0.012], 'frame');
  P.box([cx, y0 + 0.008, z0 + dz * 0.012], [w, 0.008, 0.012], 'frame');
  for (const xx of [x0 + 0.01, x1 - 0.01]) P.box([xx, (y0 + y1) / 2, z0 + dz * 0.012], [0.01, (y1 - y0) / 2, 0.012], 'frame');
  // ルーバー（上半分、斜めの羽根）
  const n = 4;
  for (let i = 0; i < n; i++) {
    const yy = y1 - 0.03 - i * ((y1 - y0) * 0.45) / n;
    P.box([cx - w * 0.2, yy, z0 + dz * 0.008], [w * 0.62, 0.005, 0.01], 'frame');
  }
  // 箱（右下）
  P.box([cx + w * 0.45, y0 + (y1 - y0) * 0.28, z0 + dz * 0.02], [w * 0.32, (y1 - y0) * 0.16, 0.02], 'frame', 0.004);
  // 丸穴（黒い筒の口）
  for (const [hx, hy] of holes) P.lathe('z', [hx, hy], [[0.018, z0 + dz * 0.03], [0.028, z0 + dz * 0.03], [0.028, z0], [0.018, z0]], 8, () => 'frame');
}

// ══ 1. コア（運転席キャノピーから中央ノーズ先端まで一体） ═════════════════
// 断面の表（右半分）: [z, yb, wb, ws, ylow, wsh, ysh, wl, yl, wtop, ytop, crown] [推]
//   yb=底 / ws,ylow=側面の下 / wsh,ysh=肩 / wl,yl=赤線 / wtop,ytop=上面の端 / crown=中心の高さ
const CORE_ROWS: number[][] = [
  [1.42, 0.272, 0.012, 0.016, 0.28, 0.016, 0.29, 0.01, 0.295, 0.005, 0.3, 0.302],
  [1.2, 0.262, 0.05, 0.07, 0.282, 0.075, 0.325, 0.055, 0.335, 0.03, 0.345, 0.35],
  [0.95, 0.258, 0.09, 0.14, 0.285, 0.15, 0.37, 0.12, 0.385, 0.07, 0.4, 0.405],
  [0.7, 0.258, 0.14, 0.22, 0.29, 0.23, 0.43, 0.19, 0.45, 0.12, 0.465, 0.47],
  [0.45, 0.258, 0.17, 0.3, 0.29, 0.3, 0.5, 0.26, 0.52, 0.17, 0.54, 0.545],
  [0.2, 0.258, 0.18, 0.36, 0.29, 0.35, 0.55, 0.3, 0.57, 0.2, 0.585, 0.59],
  [-0.05, 0.258, 0.18, 0.37, 0.29, 0.36, 0.57, 0.31, 0.59, 0.21, 0.6, 0.605],
  [-0.3, 0.258, 0.17, 0.3, 0.29, 0.3, 0.6, 0.26, 0.62, 0.2, 0.66, 0.67],
  [-0.55, 0.258, 0.17, 0.26, 0.29, 0.26, 0.7, 0.22, 0.72, 0.16, 0.77, 0.78],
  [-0.85, 0.258, 0.16, 0.24, 0.29, 0.24, 0.71, 0.2, 0.73, 0.14, 0.78, 0.79],
  [-1.05, 0.258, 0.15, 0.21, 0.29, 0.21, 0.65, 0.17, 0.68, 0.11, 0.73, 0.74],
  [-1.2, 0.258, 0.13, 0.16, 0.29, 0.15, 0.5, 0.12, 0.53, 0.08, 0.56, 0.57],
];
const coreAt = (z: number, i: number) => tab(CORE_ROWS.map((r) => [r[0], r[i]] as [number, number]), z);
// 側面の白い斜めパネル（側面の高さに対する割合。前→後ろへ上がる）[推]
const BAND_LO: [number, number][] = [[1.42, 0.05], [0.9, 0.15], [0.2, 0.35], [-0.5, 0.55], [-1.2, 0.7]];
const BAND_HI: [number, number][] = [[1.42, 0.75], [0.9, 0.8], [0.2, 0.85], [-0.5, 0.92], [-1.2, 0.95]];
// キャノピー: [z, wb, yb, wm, ym, wt, yt, crown] [推]
const CAN: number[][] = [
  [0.8, 0.04, 0.47, 0.035, 0.475, 0.03, 0.48, 0.482],
  [0.6, 0.18, 0.5, 0.17, 0.57, 0.1, 0.62, 0.63],
  [0.4, 0.23, 0.53, 0.22, 0.66, 0.14, 0.76, 0.775],
  [0.15, 0.25, 0.565, 0.24, 0.72, 0.16, 0.87, 0.885],
  [-0.1, 0.25, 0.585, 0.24, 0.735, 0.16, 0.89, 0.905],
  [-0.3, 0.22, 0.62, 0.21, 0.745, 0.14, 0.84, 0.855],
  [-0.42, 0.18, 0.67, 0.17, 0.755, 0.11, 0.78, 0.79],
];

function buildCore(detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  // 胴: 右半分の 10 点 → 全周 18 点
  const zs = hi
    ? [1.42, 1.3, 1.2, 1.08, 0.95, 0.82, 0.7, 0.58, 0.45, 0.32, 0.2, 0.08, -0.05, -0.18, -0.3, -0.42, -0.55, -0.7, -0.85, -0.95, -1.05, -1.12, -1.2]
    : [1.42, 0.95, 0.45, -0.05, -0.55, -0.85, -1.05, -1.2]; // low は輪郭と塗り分けが崩れない最小の断面
  const rings = zs.map((z) => {
    const v = (i: number) => coreAt(z, i);
    const yl = v(8), wl = v(7);
    const ylow = v(4), ysh = v(6), ws = v(3), wsh = v(5);
    const lo = tab(BAND_LO, z), up = tab(BAND_HI, z);
    const pt = (f: number): [number, number] => [ws + (wsh - ws) * f + 0.012 * Math.sin(Math.PI * f), ylow + (ysh - ylow) * f];
    return fullRing([[0, v(1)], [v(2), v(1)], [ws, ylow], pt(lo), pt(up), [wsh, ysh], [wl, yl], [Math.max(0.004, wl - 0.014), yl + 0.004], [v(9), v(10)], [0, v(11)]], z);
  });
  P.loft(
    rings,
    (k, e) => {
      const re = e < 9 ? e : 17 - e;
      const z = (zs[k] + zs[k + 1]) / 2;
      switch (re) {
        case 0: case 1: return 'frame';
        case 2: return 'sub'; // 側面の下（青）
        case 3: return 'base'; // 白い斜めパネル
        case 4: return 'sub'; // 斜めパネルの上の青
        case 5: return z > 0.9 ? 'base' : z < -0.3 ? 'base' : 'sub';
        case 6: return 'line';
        case 7: return z < -0.3 ? 'sub' : 'base'; // 上面の端: 後ろの背は青、前は白
        default: return (z < 1.0 && z > 0.45) || z < -0.3 ? 'sub' : 'base'; // 中心: キャノピー前の青い V と後ろの青い背
      }
    },
    { cap0: 'sub', cap1: 'sub' },
  );
  // 斜めパネルの縁の赤い差し線（パネルの上端に沿う）
  if (hi) {
    const edge = zs.filter((z) => z <= 1.2 && z >= -1.05).map((z) => {
      const ylow = coreAt(z, 4), ysh = coreAt(z, 6), ws = coreAt(z, 3), wsh = coreAt(z, 5), f = tab(BAND_HI, z);
      return [ws + (wsh - ws) * f + 0.012 * Math.sin(Math.PI * f) + 0.003, ylow + (ysh - ylow) * f - 0.006, z] as V3;
    });
    for (const sx of [1, -1]) for (let i = 0; i < edge.length - 1; i++) strip(P, sv(edge[i], sx), sv(edge[i + 1], sx), 0.012, [sx, 0.15, 0], 'line');
  }
  // キャノピー: 横はガラス、上は青い屋根
  const canRows = hi ? CAN : [CAN[0], CAN[2], CAN[4], CAN[6]];
  P.loft(
    canRows.map((r) => fullRing([[0, r[2] - 0.005], [r[1], r[2]], [r[3], r[4]], [r[5], r[6]], [0, r[7]]], r[0])),
    (k, e) => {
      const re = e < 4 ? e : 7 - e;
      const z = (canRows[k][0] + canRows[k + 1][0]) / 2;
      if (re === 0) return null;
      if (re === 3) return z < 0.3 ? 'sub' : 'glass';
      if (re === 2) return z < 0.2 ? 'sub' : 'glass'; // 屋根の肩まで青（横から青い屋根が見える。横図）
      return 'glass';
    },
  );
  // ノーズ下の青いスプリッター（前図の V の下の板）
  P.loft(
    ((hi ? [[1.39, 0.025], [1.15, 0.12], [0.95, 0.19], [0.8, 0.2]] : [[1.39, 0.025], [0.8, 0.2]]) as [number, number][]).map(([z, w]) => [[-w, 0.258, z], [w, 0.258, z], [w * 0.92, 0.27, z], [-w * 0.92, 0.27, z]] as V3[]),
    (_k, e) => (e === 2 ? 'sub' : e === 0 ? 'frame' : 'line'),
    { cap0: 'sub', cap1: 'frame' },
  );
  if (hi) {
    // キャノピーの屋根とガラスの境に黒い縁
    const edge = CAN.filter((r) => r[0] <= 0.42);
    for (const sx of [-1, 1]) for (let i = 0; i < edge.length - 1; i++) P.beam([sx * edge[i][5], edge[i][6], edge[i][0]], [sx * edge[i + 1][5], edge[i + 1][6], edge[i + 1][0]], 0.012, 0.012, 'frame');
    // ガラスの下の縁（窓枠）
    for (const sx of [-1, 1]) for (let i = 0; i < CAN.length - 1; i++) P.beam([sx * CAN[i][1], CAN[i][2] + 0.004, CAN[i][0]], [sx * CAN[i + 1][1], CAN[i + 1][2] + 0.004, CAN[i + 1][0]], 0.014, 0.012, 'frame');
  }
  // 屋根の後ろの黒い支柱（横図の細いアーチ）
  const hoop: V3[] = [[0.22, 0.62, -0.3], [0.17, 0.82, -0.27], [0.06, 0.9, -0.25], [-0.06, 0.9, -0.25], [-0.17, 0.82, -0.27], [-0.22, 0.62, -0.3]];
  if (hi) for (let i = 0; i < hoop.length - 1; i++) P.beam(hoop[i], hoop[i + 1], 0.02, 0.02, 'frame', [0, 0, 1]);
  if (hi) {
    // 運転席: シート・ヘッドレスト・ハンドル・計器盤（ガラス越しに見える）
    P.box([0, 0.66, -0.15], [0.09, 0.11, 0.02], 'frame', 0.01);
    P.box([0, 0.58, -0.06], [0.09, 0.022, 0.08], 'frame', 0.008);
    for (const sx of [-1, 1]) P.box([sx * 0.075, 0.65, -0.12], [0.018, 0.085, 0.03], 'sub', 0.006);
    P.box([0, 0.79, -0.16], [0.048, 0.032, 0.018], 'frame', 0.008);
    P.lathe('z', [0, 0.65], [[0.042, 0.12], [0.054, 0.12], [0.054, 0.132], [0.042, 0.132], [0.042, 0.12]], 10, () => 'frame');
    P.box([0, 0.585, 0.32], [0.14, 0.025, 0.07], 'frame', 0.01);
  }
  // 側面のパネル（前フェンダーの後ろ〜後肩カウルの前をつなぐ板）。上端は後ろへ上がり、白い斜めの帯が側面を横切る [推: 横図]
  //   [z, 上端の高さ, 青白の境（0=下 1=上）]
  const SIDE: [number, number, number][] = [[0.42, 0.38, 0.62], [0.22, 0.43, 0.5], [-0.22, 0.52, 0.32], [-0.42, 0.56, 0.25]];
  const sillR = new Painter();
  sillR.loft(
    (hi ? SIDE : [SIDE[0], SIDE[3]]).map(([z, yt, sp]) => {
      const ys = 0.3 + (yt - 0.03 - 0.3) * sp;
      return ([[0.26, 0.262], [0.44, 0.262], [0.475, 0.3], [0.482, ys], [0.477, yt - 0.03], [0.465, yt - 0.018], [0.45, yt], [0.3, yt + 0.02], [0.26, yt + 0.01]] as [number, number][]).map(([x, y]) => [x, y, z] as V3);
    }),
    (_k, e) => (['frame', 'frame', 'sub', 'base', hi ? 'line' : 'base', 'base', 'base', 'frame', 'frame'] as Slot[])[e],
    { cap0: 'frame', cap1: 'frame' },
  );
  if (hi) {
    // パネルの前の黒い吸気口（くぼみ）
    sillR.poly([[0.484, 0.31, 0.4], [0.484, 0.36, 0.4], [0.484, 0.33, 0.24], [0.484, 0.3, 0.26]], 'frame');
  }
  P.append(sillR);
  P.append(sillR.mirrorX());
  // 尾びれ（上へ反る、先端は青）と、その下の白い支え
  const fin: number[][] = [
    [-0.85, 0.03, 0.74, 0.79],
    [-1.05, 0.045, 0.66, 0.8],
    [-1.2, 0.05, 0.57, 0.83],
    [-1.3, 0.04, 0.66, 0.86],
  ];
  P.loft(
    fin.map(([z, w, b, t]) => fullRing([[0, b], [w, b + 0.01], [w, t - 0.02], [w * 0.6, t - 0.005], [0, t]], z)),
    (k, e) => {
      const re = e < 4 ? e : 7 - e;
      if (k === 2) return re === 0 ? 'frame' : 'sub';
      return re === 3 ? 'line' : re === 0 ? 'frame' : 'base';
    },
    { cap1: 'sub' },
  );
  P.beam([0, 0.58, -1.17], [0, 0.3, -1.06], 0.05, 0.03, 'base', [0, 0, 1]);
  // 後面の黒いルーバーと下の箱（後図の左右の吸気口）
  if (hi) {
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) P.box([sx * 0.09, 0.315 + i * 0.03, -1.205], [0.05, 0.005, 0.008], 'frame');
    P.box([0, 0.3, -1.19], [0.05, 0.035, 0.02], 'sub', 0.008);
  }
  return [unit('core', 'コア', P)];
}

// ══ 2. 前ボンネット&フェンダー（右で作って左は反転） ════════════════════
function buildFenderF(side: number, detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  const zc = 0.72, R = 0.34;
  const sh = archShell(P, {
    zs: archZs(0.28, 1.18, zc, R, hi ? 12 : 4, hi ? [0.34, 0.4, 0.52, 0.96, 1.08, 1.12, 1.15] : []),
    zc, R, base: 0.27,
    // 内側はボンネット: ノーズの肩（コアの断面）に沿って下がる面。稜線はタイヤの真上
    xi: (z) => tab([[0.28, 0.37], [0.5, 0.31], [0.85, 0.175], [1.18, 0.085]], z),
    innerY: (z) => tab([[0.28, 0.48], [0.55, 0.45], [0.85, 0.4], [1.18, 0.345]], z),
    ridge: (z) => tab([[0.28, 0.45], [0.72, 0.44], [1.18, 0.44]], z), // タイヤハウスの内壁(0.462)より内側に置く（外だとアーチの天井が上面を突き抜ける）
    well: 0.462,
    xo: (z) => tab([[0.28, 0.7], [0.5, 0.77], [0.9, 0.78], [1.18, 0.68]], z),
    top: (z) => tab([[0.28, 0.5], [0.42, 0.64], [0.72, 0.69], [0.95, 0.62], [1.1, 0.5], [1.18, 0.42]], z),
    split: (z) => tab([[0.28, 0.5], [0.72, 0.4], [1.18, 0.34]], z),
    line: (z) => tab([[0.28, 0.05], [1.18, 0.95]], z),
    slot: (e, z) => (['frame', 'frame', 'frame', 'sub', 'sub', 'base', hi ? 'sub' : z > 1.0 ? 'sub' : 'base', 'line', 'base', 'base', 'sub'] as Slot[])[e],
    taper: [{ z: 1.22, c: [0.4, 0.33], k: 0.84 }, { z: 0.24, c: [0.5, 0.42], k: 0.72 }],
  });
  archRim(P, zc, 0.335, 0.37, () => 0.755, () => 0.79, 0.16, Math.PI - 0.12, hi ? 12 : 4, 'base');
  // 前面: 黒い面＋白い縁取り＋「く」の字のライト
  const F0 = sh.rings[0];
  const fz = F0[0][2];
  let cx = 0, cy = 0;
  for (const p of F0) {
    cx += p[0] / F0.length;
    cy += p[1] / F0.length;
  }
  const inset = (k: number, dz: number) => F0.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k, fz + dz] as V3);
  const out = inset(1, 0.004), ins = inset(hi ? 0.74 : 0.7, 0.004);
  for (let j = 0; j < F0.length; j++) {
    const j2 = (j + 1) % F0.length;
    P.quad(out[j], out[j2], ins[j2], ins[j], 'base');
  }
  // ライト（右フェンダー: 外上 → 内寄りの中 → 外下 の「く」）
  const LZ = fz + 0.008;
  const lamp: V3[] = [[0.42, 0.384, LZ], [0.6, 0.36, LZ], [0.55, 0.302, LZ]];
  strip(P, lamp[0], lamp[1], hi ? 0.026 : 0.03, [0, 0, 1], 'lamp');
  strip(P, lamp[1], lamp[2], hi ? 0.026 : 0.03, [0, 0, 1], 'lamp');
  if (hi) {
    // ライトの奥の黒い凹み（くの字の内側の小さな段）と下の白い縁
    strip(P, [0.46, 0.355, LZ - 0.002], [0.56, 0.34, LZ - 0.002], 0.022, [0, 0, 1], 'frame');
    strip(P, [0.33, 0.295, fz + 0.006], [0.52, 0.29, fz + 0.006], 0.01, [0, 0, 1], 'base');
  }
  P.box([0.3, 0.272, 1.16], [0.1, 0.012, 0.07], 'sub', hi ? 0.006 : 0);
  if (hi) {
    // 装甲板: 上の板（外の縁に赤線）・外側面の板（青白の斜め）・ボンネットの板（青）
    plate(P, sh.rings, sh.kOf(1.12), sh.kOf(0.34), 7, 9, 0.014, (_k, e) => (e === 7 ? 'line' : 'base'));
    plate(P, sh.rings, sh.kOf(1.15), sh.kOf(0.52), 4, 6, 0.012, (_k, e) => (e === 4 ? 'sub' : 'base'));
    plate(P, sh.rings, sh.kOf(1.12), sh.kOf(0.62), 9, 10, 0.01, () => 'base');
    // 内側の黒い骨（アーチの内側から見える）と外側面後ろの黒いルーバー
    P.box([0.462, 0.36, 0.72], [0.006, 0.08, 0.36], 'frame');
    for (let i = 0; i < 3; i++) P.beam([0.79, 0.42 + i * 0.045, 0.42 - i * 0.012], [0.776, 0.47 + i * 0.045, 0.33 - i * 0.012], 0.012, 0.018, 'frame', [1, 0, 0]);
    // 後ろの面（しきい側から見える）の内部構造
    innerFrame(P, [0.47, 0.7], [0.3, 0.5], 0.25, -1, [[0.52, 0.34]]);
  }
  return [unit('fender', side > 0 ? '右フロントフェンダー' : '左フロントフェンダー', sided(P, side))];
}

// ══ 3. 後肩カウル&アーチ（格納の型 A/B/C で肩の部分が変わる） ═══════════════
const LID_R: Motion = { id: 'stella.lidR', kind: 'general', at: (s, o) => void (o.r[2] = -POD_RIGS.C.lid!.open * POD_RIGS.C.lid!.k(s)) };
const LID_L: Motion = { id: 'stella.lidL', kind: 'general', at: (s, o) => void (o.r[2] = POD_RIGS.C.lid!.open * POD_RIGS.C.lid!.k(s)) };

function buildCowlR(side: number, bay: PodRigId, detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  const zc = -0.72, R = 0.34;
  const top = (z: number) => tab([[-0.16, 0.52], [-0.3, 0.68], [-0.5, 0.73], [-0.8, 0.74], [-1.0, 0.71], [-1.18, 0.6]], z);
  const sh = archShell(P, {
    zs: archZs(-1.18, -0.16, zc, R, hi ? 14 : 4, hi ? [-0.22, -0.3, -0.62, -0.95, -1.08, -1.13] : []),
    zc, R, base: 0.27,
    xi: () => 0.472,
    xo: (z) => tab([[-0.16, 0.7], [-0.4, 0.79], [-0.9, 0.8], [-1.18, 0.74]], z),
    top,
    split: (z) => tab([[-0.16, 0.55], [-0.72, 0.38], [-1.18, 0.6]], z),
    taper: [{ z: -1.22, c: [0.62, 0.45], k: 0.94 }, { z: -0.12, c: [0.6, 0.45], k: 0.55 }],
    caps: ['frame', 'frame'],
    recess: hi ? { k: 0.8, depth: 0.12 } : undefined,
    line: (z) => tab([[-0.16, 0.9], [-1.18, 0.1]], z),
    slot: (e, z) => (['frame', 'frame', 'frame', 'sub', 'sub', 'base', hi ? 'sub' : z < -0.75 ? 'sub' : 'base', 'line', 'base', 'base', 'frame'] as Slot[])[e],
  });
  archRim(P, zc, 0.335, 0.4, () => 0.77, () => 0.815, 0.12, Math.PI - 0.16, hi ? 14 : 4, 'base');
  if (hi) {
    // 装甲板: 上の板（内の縁に赤線）・外側面の前の板（青白）・外側面の後ろの板（青）
    plate(P, sh.rings, sh.kOf(-0.3), sh.kOf(-1.13), 7, 9, 0.014, (_k, e) => (e === 7 ? 'line' : 'base'));
    plate(P, sh.rings, sh.kOf(-0.22), sh.kOf(-0.62), 4, 6, 0.012, (_k, e) => (e === 4 ? 'sub' : 'base'));
    plate(P, sh.rings, sh.kOf(-0.95), sh.kOf(-1.15), 3, 6, 0.012, (_k, e) => (e === 3 ? 'sub' : 'base'));
    // 外側面の前寄りの吸気口（黒い凹み）と赤い下線
    P.poly([[0.822, 0.4, -0.3], [0.822, 0.36, -0.44], [0.822, 0.5, -0.47], [0.82, 0.55, -0.33]], 'frame');
    P.beam([0.824, 0.39, -0.29], [0.824, 0.35, -0.45], 0.006, 0.012, 'line', [1, 0, 0]);
    // 後ろの面: 黒い内部構造（ルーバー・箱・丸穴。後図）
    innerFrame(P, [0.52, 0.74], [0.33, 0.58], -1.1, -1, [[0.56, 0.38], [0.63, 0.38]]);
  }
  const units: Unit[] = [];
  // 肩（ポッドの居場所）x 0.245〜0.47、z -0.27〜-0.98
  const Z0 = -0.27, Z1 = -0.98;
  const zsh = hi ? [Z0, -0.4, -0.62, -0.72, -0.723, -0.84, Z1] : [Z0, Z1]; // 平らな壁は2軸の引き伸ばしで1枚が伸びるだけなので low は断面2つ
  const shTop = (z: number) => Math.min(top(z), 0.72);
  if (bay === 'A') {
    // 低い棚（y 0.60）。ポッドはこの上に伏せる。内側の壁は青、上面は白に赤線
    P.loft(
      zsh.map((z) => [[0.245, 0.42, z], [0.472, 0.42, z], [0.472, 0.6, z], [0.44, 0.61, z], [0.3, 0.605, z], [0.285, 0.603, z], [0.245, 0.58, z]] as V3[]),
      (_k, e) => (['frame', 'frame', 'base', 'base', 'line', 'sub', 'sub'] as Slot[])[e],
      { cap0: 'frame', cap1: 'frame' },
    );
  } else {
    // B・C 共通: 内側の薄い壁・床・前後の壁でポッドの部屋を作る
    const floorY = bay === 'B' ? 0.49 : 0.395;
    const wallTop = bay === 'B' ? (z: number) => shTop(z) - 0.005 : () => 0.665;
    P.loft(
      zsh.map((z) => [[0.245, 0.4, z], [0.262, 0.4, z], [0.262, wallTop(z), z], [0.256, wallTop(z) + 0.01, z], [0.245, wallTop(z), z]] as V3[]),
      (_k, e) => (['frame', 'frame', 'base', 'line', 'sub'] as Slot[])[e],
      { cap0: 'frame', cap1: 'frame' },
    );
    P.box([0.36, floorY - 0.008, (Z0 + Z1) / 2], [0.105, 0.008, (Z0 - Z1) / 2], 'frame');
    P.box([0.36, 0.53, Z0], [0.112, 0.13, 0.008], 'frame');
    if (hi) {
      // 部屋の中の黒い骨（ポッドが出たあと見える）: 横桟と丸穴
      for (const z of [-0.45, -0.8]) P.box([0.36, floorY + 0.03, z], [0.1, 0.03, 0.012], 'frame');
      for (const z of [-0.55, -0.68]) P.lathe('y', [0.36, z], [[0.025, floorY + 0.001], [0.025, floorY + 0.012], [0.015, floorY + 0.012]], 8, () => 'metal');
    }
    // 後ろの壁: 外から見える面なので車体色（上の縁に赤線）
    const bwTop = bay === 'B' ? 0.555 : 0.66;
    P.loft(
      [[[0.245, 0.4, Z1 + 0.012], [0.472, 0.4, Z1 + 0.012], [0.472, bwTop, Z1 + 0.012], [0.245, bwTop, Z1 + 0.012]], [[0.245, 0.4, Z1 - 0.004], [0.472, 0.4, Z1 - 0.004], [0.472, bwTop - 0.01, Z1 - 0.004], [0.245, bwTop - 0.01, Z1 - 0.004]]] as V3[][],
      (_k, e) => (e === 2 ? 'line' : 'frame'),
      { cap0: 'frame', cap1: 'frame' },
    );
    if (hi) {
      // 後ろの壁の黒い構造（後図: ルーバーと丸穴）
      for (let i = 0; i < 4; i++) P.box([0.33, 0.47 + i * 0.04, Z1 - 0.01], [0.06, 0.005, 0.008], 'frame');
      P.lathe('z', [0.42, 0.45], [[0.018, Z1 - 0.02], [0.026, Z1 - 0.02], [0.026, Z1 - 0.004]], 8, () => 'frame');
    }
    if (bay === 'B') {
      // 側壁のレール（後ろ上へ 0.20 : 0.15 の傾き）。ポッドの横のピンがここを滑る
      const r = POD_RIGS.B;
      const a: V3 = [0, r.rest[1] - 0.08 - 0.02, r.rest[2] - 0.06 + 0.015];
      const b: V3 = [0, a[1] + r.move[1] + 0.04, a[2] + r.move[2] - 0.03];
      for (const x of [0.266, 0.466]) P.beam([x, a[1], a[2]], [x, b[1], b[2]], 0.008, 0.022, 'metal', [0, 0, 1]);
    }
    if (bay === 'C') {
      // 上面のフタ（外側の縁が蝶番。BOOST1 で外へ跳ね上がる）
      const lid = new Painter();
      const zl = hi ? [Z0 - 0.005, -0.32, -0.62, -0.72, -0.723, -0.92, Z1 + 0.005] : [Z0 - 0.005, Z1 + 0.005];
      lid.loft(
        zl.map((z) => {
          const t = shTop(z);
          return [[0.25, t - 0.05, z], [0.47, t - 0.04, z], [0.475, t - 0.012, z], [0.44, t, z], [0.33, t - 0.004, z], [0.316, t - 0.005, z], [0.25, t - 0.02, z]] as V3[];
        }),
        (k, e) => (['frame', 'sub', k === 0 || k === zl.length - 2 ? 'sub' : 'base', 'base', 'line', 'base', 'sub'] as Slot[])[e],
        { cap0: 'sub', cap1: 'sub' },
      );
      if (hi) {
        lid.box([0.36, 0.64, -0.62], [0.08, 0.01, 0.25], 'frame'); // フタの裏の骨
        for (const z of [-0.45, -0.62, -0.8]) lid.box([0.36, 0.655, z], [0.085, 0.012, 0.008], 'frame');
      }
      // 蝶番
      P.box([0.474, 0.695, -0.62], [0.008, 0.012, 0.3], 'frame');
      // low ではフタはポッド本体と同じ動き（上に載ったカバーとして一緒に上がる）→ 左右・ポッドと同じメッシュにまとまる
      units.push(unit('lid', side > 0 ? '右カウルのフタ' : '左カウルのフタ', sided(lid, side), hi ? { pivot: sv([0.472, 0.7, -0.62], side), motion: side > 0 ? LID_R : LID_L } : { pivot: sv(POD_RIGS.C.rest, side), motion: rigMotions(POD_RIGS.C).body }));
    }
  }
  units.unshift(unit('cowl', side > 0 ? '右後肩カウル' : '左後肩カウル', sided(P, side)));
  return units;
}

// ══ 4. リアウィング一式（支柱2本が伸びる） ══════════════════════════
function buildWing(detail: Detail): Unit[] {
  const hi = detail === 'high';
  const base = new Painter();
  const top = new Painter();
  const n = hi ? 8 : 4;
  for (const sx of [-1, 1]) {
    base.lathe('y', [sx * 0.085, -1.07], hi ? [[0.032, 0.585], [0.032, 0.6], [0.022, 0.6], [0.022, 0.735], [0.027, 0.74], [0.027, 0.755], [0.0, 0.755]] : [[0.024, 0.585], [0.024, 0.755], [0, 0.755]], n, () => 'frame');
    top.lathe('y', [sx * 0.085, -1.07], [[0.015, 0.6], [0.015, 0.8]], n, () => 'metal');
  }
  top.box([0, 0.815, -1.1], [0.105, 0.03, 0.085], 'frame', hi ? 0.012 : 0);
  if (hi) top.box([0, 0.85, -1.08], [0.05, 0.008, 0.05], 'sub', 0.006);
  // 翼（右半分を x に沿って作って反転）
  const half = new Painter();
  const xs = hi ? [0.06, 0.25, 0.45, 0.62] : [0.06, 0.62];
  const y0 = (x: number) => 0.8 + (x - 0.06) * 0.05;
  const zLE = (x: number) => -1.0 - (x - 0.06) * 0.04;
  const zTE = -1.38;
  const ring = (x: number): V3[] => {
    const y = y0(x), le = zLE(x);
    const zl = tab([[0.06, -1.1], [0.62, -1.26]], x);
    return ([
      [le, y], [le - 0.06, y + 0.02], [zl, y + 0.03], [zl - 0.012, y + 0.031], [zl - 0.03, y + 0.034],
      [zTE + 0.04, y + 0.037], [zTE, y + 0.032], [zTE, y - 0.006], [le - 0.15, y - 0.018],
    ] as [number, number][]).map(([z, yy]) => [x, yy, z] as V3);
  };
  half.loft(xs.map(ring), (_k, e) => (['sub', 'base', 'line', 'base', 'sub', 'sub', 'sub', 'frame', 'frame'] as Slot[])[e], { cap0: 'frame' });
  // 翼端板: 外は青、前後の縁に赤、内側は黒
  const ye = y0(0.62);
  const prof: [number, number][] = [[-0.98, ye - 0.05], [-1.38, ye - 0.05], [-1.42, ye + 0.01], [-1.39, ye + 0.08], [-1.08, ye + 0.08], [-0.97, ye + 0.025]];
  const pz = (x: number, ins: number) => prof.map(([z, y]) => [x, y + (y < ye ? ins : -ins), z + (z < -1.2 ? ins : -ins)] as V3);
  half.loft(hi ? [pz(0.62, 0.012), pz(0.635, 0), pz(0.695, 0), pz(0.71, 0.012)] : [pz(0.62, 0), pz(0.71, 0)], (_k, e) => (e === 1 || e === 4 ? 'sub' : e === 5 || e === 2 ? 'line' : 'sub'), { cap0: 'frame', cap1: 'sub' });
  if (hi) half.poly([[0.7115, ye - 0.035, -1.28], [0.7115, ye - 0.035, -1.32], [0.7115, ye + 0.065, -1.32], [0.7115, ye + 0.065, -1.28]], 'line');
  top.append(half);
  top.append(half.mirrorX());
  return [
    unit('struts', 'ウィング支柱（下・固定）', base),
    unit('wing', 'ウィング（翼・ハブ・上の支柱）', top, { pivot: [0, 0.8, -1.1], motion: WING }),
  ];
}

// ══ 5. ブーストポッド（形は共通、動き方は PodRig で差し替え） ═══════════════
// 鋭い楔: 前は上が前へ出る斜め切りの四角い吸気口、後ろへ絞って金リング。
// 断面（右ポッドの中心からの比率）[rel z, 幅倍率, 高さ倍率, 上下ずれ(×h), 青白の境(×h), 前への傾き(上端が前へ出る量)] [推]
const POD_SEC: number[][] = [
  [0.3, 0.9, 0.84, -0.04, -0.45, 0.075],
  [0.22, 1.0, 1.0, 0.0, -0.45, 0.05],
  [0.06, 1.0, 1.0, 0.0, -0.3, 0.0],
  [-0.1, 0.97, 0.96, 0.0, 0.05, 0.0],
  [-0.22, 0.84, 0.82, 0.0, 0.35, 0.0],
  [-0.29, 0.74, 0.72, 0.0, 0.4, 0.0],
];
// 断面14点: 底・下の面取り・外側面（青白の境で2つ）・肩・赤線・上面・…（左右対称）
const podRing = (c: V3, sw: number, sh: number, dy: number, sp: number, slant: number, z: number): V3[] => {
  const w = POD_W * sw, h = POD_H * sh, y = c[1] + dy * POD_H;
  const pts: [number, number][] = [
    [-0.72 * w, -h], [0.72 * w, -h], [w, -0.45 * h], [w, sp * h], [w, 0.45 * h], [0.88 * w, 0.68 * h], [0.8 * w, 0.8 * h],
    [0.58 * w, h], [-0.58 * w, h], [-0.8 * w, 0.8 * h], [-0.88 * w, 0.68 * h], [-w, 0.45 * h], [-w, sp * h], [-w, -0.45 * h],
  ];
  return pts.map(([x, yy]) => [c[0] + x, y + yy, c[2] + z + slant * (yy / h)]);
};
const POD_EDGE: Slot[] = ['frame', 'sub', 'sub', 'base', 'base', 'line', 'base', 'base', 'base', 'line', 'base', 'base', 'sub', 'sub'];

function rigMotions(r: PodRig) {
  const body: Motion = { id: `stella.pod${r.id}`, kind: 'translate', at: (s, o) => { const k = r.k(s); o.p[0] = r.move[0] * k; o.p[1] = r.move[1] * k; o.p[2] = r.move[2] * k; } };
  if (!r.arm) return { body };
  const a = r.arm;
  const tipY = r.rest[1] - POD_H; // 本体の底（腕の先が付く所）
  const h0 = tipY - a.baseY;
  const th = (s: number) => Math.asin(Math.min(1, (h0 + r.move[1] * r.k(s)) / (2 * a.len)));
  const armLo: Motion = { id: `stella.arm${r.id}lo`, kind: 'rotX', at: (s, o) => void (o.r[0] = -th(s)) };
  const armHi: Motion = { id: `stella.arm${r.id}hi`, kind: 'rotX', at: (s, o) => void (o.r[0] = th(s)) };
  return { body, armLo, armHi, tipY };
}

function buildPod(side: number, rig: PodRig, detail: Detail): Unit[] {
  const hi = detail === 'high';
  const c = rig.rest;
  const M = rigMotions(rig);
  const body = new Painter();
  const secs = hi ? POD_SEC : [POD_SEC[0], POD_SEC[2], POD_SEC[4], POD_SEC[5]];
  const rings = secs.map(([z, sw, sh, dy, sp, sl]) => podRing(c, sw, sh, dy, sp, sl, z));
  body.loft(rings, (k, e) => (k === secs.length - 2 && e !== 0 ? (e === 5 || e === 9 ? 'line' : 'sub') : POD_EDGE[e]), { cap0: hi ? null : 'frame', cap1: 'frame' });
  if (hi) {
    // 側面の黒いルーバー（左右、後ろ寄り）と上面の青い楔
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) body.box([c[0] + sx * (POD_W * 0.98 + 0.003), c[1] + 0.03 - i * 0.022, c[2] - 0.13], [0.004, 0.006, 0.045], 'frame');
    body.poly([[c[0] - 0.035, c[1] + POD_H + 0.002, c[2] - 0.02], [c[0] + 0.035, c[1] + POD_H + 0.002, c[2] - 0.02], [c[0] + 0.045, c[1] + POD_H * 0.96 + 0.002, c[2] - 0.12], [c[0] - 0.045, c[1] + POD_H * 0.96 + 0.002, c[2] - 0.12]], 'sub');
  }
  // 吸気口（斜め切りの前面: 青い縁＋奥の黒いトンネル）
  const intake = new Painter();
  const [fz, fsw, fsh, fdy, fsp, fsl] = POD_SEC[0];
  if (hi) {
    const r0 = rings[0];
    const lip = podRing(c, fsw * 0.8, fsh * 0.74, fdy, fsp, fsl * 0.8, fz - 0.004);
    const deep = podRing(c, fsw * 0.7, fsh * 0.62, fdy, fsp, 0, fz - 0.1);
    intake.loft([r0, lip], () => 'sub');
    intake.loft([lip, deep], () => 'frame', { cap1: 'frame' });
    // 吸気口の奥の仕切り（縦の羽根2枚）
    for (const dx of [-0.025, 0.025]) intake.box([c[0] + dx, c[1] + fdy * POD_H, c[2] + fz - 0.06], [0.003, POD_H * fsh * 0.55, 0.04], 'frame');
  } else {
    intake.poly(podRing(c, fsw * 0.8, fsh * 0.74, fdy, fsp, fsl * 0.8, fz + 0.004), 'frame');
  }
  // ノズル（内側の黒い筒・タービン）と金リング。BOOST2 で一緒に後ろへ伸びる
  const nozzle = new Painter();
  const ring = new Painter();
  const nc: [number, number] = [c[0], c[1] + 0.003];
  const rz = c[2];
  const nn = hi ? 16 : 8;
  nozzle.lathe('z', nc, [[0.06, rz - 0.2], [0.06, rz - 0.3]], hi ? 12 : 8, () => 'frame');
  if (hi) nozzle.lathe('z', nc, [[0.0, rz - 0.282], [0.058, rz - 0.282]], 12, () => 'frame');
  else nozzle.poly(Array.from({ length: 8 }, (_, i) => [nc[0] + Math.cos((i / 8) * Math.PI * 2) * 0.058, nc[1] + Math.sin((i / 8) * Math.PI * 2) * 0.058, rz - 0.282] as V3), 'frame');
  if (hi) nozzle.lathe('z', nc, [[0.0, rz - 0.295], [0.02, rz - 0.282]], 8, () => 'metal');
  if (hi) for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    nozzle.quad([nc[0] + Math.cos(a) * 0.02, nc[1] + Math.sin(a) * 0.02, rz - 0.284], [nc[0] + Math.cos(a) * 0.056, nc[1] + Math.sin(a) * 0.056, rz - 0.284],
      [nc[0] + Math.cos(a + 0.3) * 0.056, nc[1] + Math.sin(a + 0.3) * 0.056, rz - 0.289], [nc[0] + Math.cos(a + 0.3) * 0.02, nc[1] + Math.sin(a + 0.3) * 0.02, rz - 0.289], 'metal');
  }
  ring.lathe('z', nc, hi ? [[0.058, rz - 0.29], [0.078, rz - 0.29], [0.082, rz - 0.302], [0.079, rz - 0.322], [0.062, rz - 0.322], [0.058, rz - 0.308], [0.058, rz - 0.29]] : [[0.078, rz - 0.29], [0.078, rz - 0.322]], nn, () => 'metal');
  // 隠しダクト（上面後ろ、前向きの口）
  const duct = new Painter();
  const dy0 = c[1] + POD_H - 0.072; // 格納時は本体の中
  const dsec = (z: number, s: number): V3[] =>
    ([[-0.045, 0], [0.045, 0], [0.05, 0.05 * s], [0.035, 0.06 * s], [-0.035, 0.06 * s], [-0.05, 0.05 * s]] as [number, number][]).map(([x, y]) => [c[0] + x, dy0 + y, c[2] + z]);
  duct.loft(hi ? [dsec(-0.05, 1), dsec(-0.12, 0.85), dsec(-0.2, 0.55)] : [dsec(-0.05, 1), dsec(-0.2, 0.55)], (_k, e) => (e === 0 ? 'frame' : e === 3 ? 'base' : 'sub'), { cap0: 'frame', cap1: 'sub' });
  if (hi) duct.poly([[c[0] - 0.04, dy0 + 0.005, c[2] - 0.048], [c[0] + 0.04, dy0 + 0.005, c[2] - 0.048], [c[0] + 0.03, dy0 + 0.052, c[2] - 0.048], [c[0] - 0.03, dy0 + 0.052, c[2] - 0.048]], 'frame');
  // カナード（左右の横へせり出す板、先端は赤）。格納時は本体の中。大きめ（翼幅 0.13・翼弦 0.2）
  const canard = (sx: number, out: boolean) => {
    const p = new Painter();
    const off = out ? CAN_OUT : 0;
    const x0 = c[0] + sx * (0.01 + off), x1 = c[0] + sx * (0.13 + off), xt = c[0] + sx * (0.112 + off);
    const y = c[1] - 0.01, t = 0.007;
    const pl = (xa: number, xb: number, s: Slot) => {
      const q = (x: number, zz: number, dy: number): V3 => [x, y + dy, c[2] + zz];
      const fa = 0.02, ra = -0.18, fb = -0.09, rb = -0.17;
      const ka = Math.abs(xa - x0) / Math.abs(x1 - x0), kb = Math.abs(xb - x0) / Math.abs(x1 - x0);
      const F = (k: number) => fa + (fb - fa) * k, Rr = (k: number) => ra + (rb - ra) * k;
      p.loft([[q(xa, F(ka), -t), q(xa, Rr(ka), -t), q(xa, Rr(ka), t), q(xa, F(ka), t)], [q(xb, F(kb), -t), q(xb, Rr(kb), -t), q(xb, Rr(kb), t), q(xb, F(kb), t)]], () => s, { cap0: s, cap1: s });
    };
    pl(x0, xt, 'frame');
    pl(xt, x1, 'line');
    return p;
  };
  // 支え（台座・腕）
  const units: Unit[] = [];
  const name = side > 0 ? '右' : '左';
  const base = new Painter();
  const armLo = new Painter();
  const armHi = new Painter();
  if (rig.arm && M.armLo) {
    const a = rig.arm;
    base.box([c[0], a.baseY - 0.012, a.baseZ + 0.02], [0.06, 0.008, 0.055], 'frame', hi ? 0.004 : 0);
    if (hi) base.lathe('x', [a.baseY, a.baseZ], [[0.012, c[0] - 0.06], [0.012, c[0] + 0.06]], 6, () => 'metal');
    for (const dx of [-0.045, 0.045]) armLo.beam([c[0] + dx, a.baseY, a.baseZ], [c[0] + dx, a.baseY, a.baseZ + a.len], 0.012, 0.016, 'frame', [0, 1, 0]);
    if (hi) armLo.lathe('x', [a.baseY, a.baseZ + a.len], [[0.011, c[0] - 0.055], [0.011, c[0] + 0.055]], 6, () => 'metal');
    if (hi) {
      armHi.beam([c[0], M.tipY!, a.baseZ], [c[0], M.tipY!, a.baseZ + a.len], 0.022, 0.016, 'frame', [0, 1, 0]);
      body.box([c[0], M.tipY! + 0.006, a.baseZ], [0.032, 0.008, 0.035], 'frame');
    }
  } else {
    // B: 横のピン（側壁のレールを滑る）
    for (const sx of [-1, 1]) body.lathe('x', [c[1] - 0.08, c[2] - 0.06], [[0.012, c[0] + sx * POD_W], [0.012, c[0] + sx * (POD_W + 0.02)]], 6, () => 'metal');
  }
  const pv = (v: V3) => sv(v, side);
  if (base.triangles) units.push(unit('base', `${name}ポッド台座`, sided(base, side)));
  if (armLo.triangles) {
    const a = rig.arm!;
    units.push(hi ? unit('armLo', `${name}ポッドの腕（下）`, sided(armLo, side), { pivot: pv([c[0], a.baseY, a.baseZ]), motion: M.armLo }) : unit('armLo', `${name}ポッドの腕（下）`, sided(armLo, side)));
  }
  units.push(unit('body', `${name}ポッド本体`, sided(body, side), { pivot: pv(c), motion: M.body }));
  if (armHi.triangles) {
    const a = rig.arm!;
    units.push(hi ? unit('armHi', `${name}ポッドの腕（上）`, sided(armHi, side), { parent: 'body', pivot: pv([c[0], M.tipY!, a.baseZ]), motion: M.armHi }) : unit('armHi', `${name}ポッドの腕（上）`, sided(armHi, side), { parent: 'body' }));
  }
  units.push(unit('intake', `${name}吸気口`, sided(intake, side), { parent: 'body' }));
  // 噴射口の目印: 金リングの後端（BOOST2 でリングと一緒に伸びる）。ブーストの炎はここから出る
  units.push(unit('ring', `${name}金リング`, sided(ring, side), { parent: 'body', pivot: pv([c[0], c[1], c[2] - 0.3]), motion: RING, marks: [{ id: 'nozzle', pos: pv([nc[0], nc[1], rz - 0.322]), r: 0.062 }] }));
  units.push(unit('nozzle', `${name}ノズル内側`, sided(nozzle, side), { parent: 'ring' }));
  if (hi) {
    units.push(unit('duct', `${name}隠しダクト`, sided(duct, side), { parent: 'body', pivot: pv([c[0], dy0, c[2]]), motion: DUCT }));
    // 外側（side 向き）と内側のカナード。左ポッドは反転するので動きも入れ替える
    units.push(unit('canardOut', `${name}カナード（外）`, sided(canard(1, false), side), { parent: 'body', pivot: pv(c), motion: side > 0 ? CAN_P : CAN_N }));
    units.push(unit('canardIn', `${name}カナード（内）`, sided(canard(-1, false), side), { parent: 'body', pivot: pv(c), motion: side > 0 ? CAN_N : CAN_P }));
  } else {
    const dep = new Painter();
    for (let i = 0; i < duct.slot.length; i++) {
      dep.pos.push(...duct.pos.slice(i * 9, i * 9 + 9).map((v, j) => (j % 3 === 1 ? v + DUCT_H : v)));
      dep.slot.push(duct.slot[i]);
    }
    dep.append(canard(1, true));
    dep.append(canard(-1, true));
    units.push(unit('deploy', `${name}ダクト・カナード`, sided(dep, side), { parent: 'body', pivot: pv(c), motion: DEPLOY_LOW }));
  }
  return units;
}

// ══ 組み上げ ═══════════════════════════════════════════════
export const STELLA_PALETTES: Record<string, { label: string; palette: Palette }> = {
  wbr: { label: '白青赤', palette: { base: 0xf3f5f8, sub: 0x1d4ed8, line: 0xe3202b, frame: 0x191b21, glass: 0x142636, metal: 0xd6a338, lamp: 0xff2a2a, lamp2: 0x3d7dff } },
  bkg: { label: '黒金', palette: { base: 0x23252b, sub: 0xb48a2c, line: 0xf3dc8f, frame: 0x0e0f12, glass: 0x2a3644, metal: 0xe8bb45, lamp: 0xffd26a, lamp2: 0xffd26a } },
  rw: { label: '赤白', palette: { base: 0xd2202c, sub: 0xf2f3f5, line: 0x1b1d24, frame: 0x1a1c22, glass: 0x1a2a3a, metal: 0xc9ced6, lamp: 0xf4f8ff, lamp2: 0xf4f8ff } },
};

// fit: シャーシ追従（省略時は標準4輪＝変形なし）
export function stellaKit(rigId: PodRigId = 'C', fit: StellaFit = STD_FIT): CarKit {
  const rig = POD_RIGS[rigId];
  const std = isStd(fit);
  const cz = coreZ(fit);
  const dy = fit.deckY - STD_FIT.deckY;
  const wF = groupWarp(fit.front, 0.72, fit);
  const wR = groupWarp(fit.rear, -0.72, fit);
  const wCore: Warp = ([x, y, z]) => [x, y + dy, cz(z)];
  const kR = fit.rear.r / 0.3;
  const wingD: V3 = [0, Math.max(dy, 0.75 * (kR - 1)), cz(-1.1) + 1.1];
  const wWing: Warp = ([x, y, z]) => [x, y + wingD[1], z + wingD[2]];
  const podC = wR(rig.rest);
  const wPod: Warp = ([x, y, z]) => [x, y + podC[1] - rig.rest[1], z + podC[2] - rig.rest[2]];
  // 左右のポッドは同じ平行移動（左は x を反転して作るので、x のずれは無い）
  const W = (w: Warp, f: (d: Detail) => Unit[]) => (std ? f : (d: Detail) => warpUnits(f(d), w));
  const at = (w: Warp, p: V3): V3 => (std ? p : w(p));
  const parts: PartDef[] = [
    { id: 'core', kind: 'core', label: 'コア（キャノピー〜ノーズ）', mount: { slot: 'core', side: 0, pos: at(wCore, [0, 0.26, 0]) }, explode: [0, 0, 0], build: W(wCore, (d) => buildCore(d)) },
  ];
  for (const side of [1, -1] as const) {
    const n = side > 0 ? 'R' : 'L';
    parts.push({ id: `fender${n}`, kind: 'fenderF', label: `前ボンネット&フェンダー ${n}`, mount: { slot: 'fenderF', side, pos: at(wF, [0.6 * side, 0.26, 0.72]) }, explode: [0.85 * side, 0, 0.75], build: W(wF, (d) => buildFenderF(side, d)) });
    parts.push({ id: `cowl${n}`, kind: 'cowlR', label: `後肩カウル&アーチ ${n}`, variant: rig.id, mount: { slot: 'cowlR', side, pos: at(wR, [0.62 * side, 0.26, -0.72]) }, explode: [0.9 * side, 0, -0.6], build: W(wR, (d) => buildCowlR(side, rig.id, d)) });
  }
  parts.push({ id: 'wing', kind: 'wing', label: 'リアウィング一式', mount: { slot: 'wing', side: 0, pos: at(wWing, [0, 0.6, -1.07]) }, explode: [0, 1.25, -0.7], build: W(wWing, (d) => buildWing(d)) });
  for (const side of [1, -1] as const) {
    const n = side > 0 ? 'R' : 'L';
    parts.push({ id: `pod${n}`, kind: 'pod', label: `ブーストポッド ${n}`, variant: rig.id, mount: { slot: 'pod', side, pos: at(wPod, [rig.rest[0] * side, rig.rest[1] - POD_H, rig.rest[2]]) }, explode: [0.55 * side, 0.85, 0.15], build: W(wPod, (d) => buildPod(side, rig, d)) });
  }
  return { id: `stella-${rig.id}`, name: 'STELLA', states: ['NORMAL', 'BOOST1', 'BOOST2', 'BOOST3'], palette: STELLA_PALETTES.wbr.palette, parts };
}
// カナード（ウィング部品の前後カナード）を付けられる高さ: フェンダー・カウルの上面より少し上（シャーシ追従込み）
export function stellaCanardY(z: number, fit: StellaFit = STD_FIT) {
  return z > 0 ? 0.72 * (fit.front.r / 0.3) : 0.77 * (fit.rear.r / 0.3);
}
