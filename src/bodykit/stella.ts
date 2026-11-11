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
// 寸法の基準は carModel.ts の標準シャーシ（std4・中径タイヤ）: 車軸 z=±0.72、タイヤ半径 0.3、
// タイヤの内側 x=0.48・外側 0.72（標準トレッド）、シャーシ板の上面 y≈0.255、ローラー先端 |x|=0.95。
// 6輪・8輪・別トレッドへの追従は未対応（組み込み時の課題として報告）。
//
// ── 数値表（[推]=参考画から読んだ推定、[仮]=参考画に無いので仮に決めた値） ───────────────
//  全体   ノーズ先端 z=+1.40 [推: 横図でノーズは前ローラーの少し手前]、テール後端 z=-1.30 [推]
//         キャノピー頂 y=0.85 [推: VALKYRIA 横図でタイヤ径の約1.4倍]、全幅 1.60（フェンダー外 |x|=0.80）[推]
//  前フェンダー  z 0.28〜1.18、x 0.40〜0.78、上面 y 0.69（車軸の上）[推]
//  後肩カウル    z -0.16〜-1.18、外殻 x 0.47〜0.80、上面 y 0.74 [推]。肩（ポッドの居場所）x 0.245〜0.47 [仮]
//  ウィング      翼端板の外 |x|=0.71、前縁 z=-1.00〜後縁 -1.38、NORMAL の翼下面 y≈0.79 [推]、支柱 x=±0.085 [推: 前後図]
//  ポッド        中心 x=±0.36、長さ 0.58（z -0.32〜-0.90）、幅 0.19、高さ 0.20 [推: 分解図の比率]
//  可動量        ウィング上昇 0.16 [仮]、金リング伸び 0.085 [推: B2横図でリング幅の約1.5倍]、
//                ダクト上昇 0.07 [仮]、カナードのせり出し 0.09 [推]、
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

const S = (s: number) => s; // 状態の読みやすさ用
const k1 = (s: number) => ease(S(s));
const k2 = (s: number) => ease(s - 1);
const k3 = (s: number) => ease(s - 2);

// ── 共通の可動 ───────────────────────────────────────────
const WING_LIFT = 0.16; // [仮]
const RING_EXT = 0.085; // [推]
const DUCT_H = 0.07; // [仮]
const CAN_OUT = 0.09; // [推]
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

// タイヤアーチ: z での円の上端（無ければ -Infinity）
const AX_Y = 0.3; // 車軸の高さ＝タイヤ半径 [carModel std4]
const archY = (z: number, zc: number, R: number) => {
  const d = Math.abs(z - zc);
  return d < R ? AX_Y + Math.sqrt(R * R - d * d) : -Infinity;
};
// アーチの縁の近くほど細かく z を刻む
const archZs = (zmin: number, zmax: number, zc: number, R: number, n: number, extra: number[]) => {
  const zs = [zmin, zmax, ...extra];
  for (let i = 0; i <= n; i++) zs.push(zc + R * Math.cos((Math.PI * i) / n));
  zs.push(zc + R * 1.004, zc - R * 1.004);
  return [...new Set(zs.filter((z) => z >= zmin - 1e-6 && z <= zmax + 1e-6).map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => b - a);
};

// フェンダー・カウルの殻（タイヤを避ける）。断面9点の輪、色の境目（青/白・赤線）は z で動かして斜めの塗り分けにする
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
  well?: number;
  caps?: [Slot, Slot]; // 前端・後端の面の色 // タイヤハウスの内壁の x（これより内側はアーチで持ち上げない）
  taper?: { z: number; c: [number, number]; k: number }[]; // その z の断面を点 c へ k 倍に縮める（隣の断面の形を使う）
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
  P.loft(rings, (k, e) => o.slot(e, zm(k)), { cap0: o.caps?.[0] ?? 'frame', cap1: o.caps?.[1] ?? 'frame' });
}
// アーチの縁取り（外側の面に付く帯）。φ はタイヤ中心から見た角度（0=前、π=後ろ）
function archRim(P: Painter, zc: number, R1: number, R2: number, x0: (z: number) => number, x1: (z: number) => number, f0: number, f1: number, n: number, s: Slot) {
  const rings: V3[][] = [];
  for (let i = 0; i <= n; i++) {
    const f = f0 + ((f1 - f0) * i) / n;
    const c = Math.cos(f), si = Math.sin(f);
    const z = zc + R2 * c;
    rings.push([
      [x0(z), AX_Y + R1 * si, zc + R1 * c], [x0(z), AX_Y + R2 * si, zc + R2 * c],
      [x1(z), AX_Y + R2 * si, zc + R2 * c], [x1(z), AX_Y + R1 * si, zc + R1 * c],
    ]);
  }
  P.loft(rings, (_k, e) => (e === 1 || e === 2 ? s : 'frame'), { cap0: s, cap1: s });
}

// ══ 1. コア（運転席キャノピーから中央ノーズ先端まで一体） ═════════════════
// 断面の表: [z, yb, wb, ws, ylow, ws2, ysplit, wsh, ysh, wl, yl, wtop, ytop, crown]（右半分）[推]
const CORE_ROWS: number[][] = [
  [1.4, 0.275, 0.012, 0.016, 0.282, 0.018, 0.29, 0.016, 0.3, 0.01, 0.304, 0.005, 0.308, 0.31],
  [1.15, 0.262, 0.05, 0.075, 0.285, 0.082, 0.305, 0.074, 0.34, 0.05, 0.35, 0.03, 0.36, 0.365],
  [0.85, 0.258, 0.1, 0.15, 0.29, 0.17, 0.33, 0.16, 0.39, 0.12, 0.405, 0.06, 0.42, 0.425],
  [0.55, 0.258, 0.15, 0.26, 0.29, 0.29, 0.35, 0.28, 0.44, 0.22, 0.46, 0.12, 0.47, 0.475],
  [0.3, 0.258, 0.18, 0.36, 0.29, 0.4, 0.36, 0.37, 0.46, 0.27, 0.48, 0.16, 0.49, 0.495],
  [-0.05, 0.258, 0.18, 0.37, 0.29, 0.41, 0.38, 0.37, 0.47, 0.27, 0.49, 0.16, 0.5, 0.505],
  [-0.2, 0.258, 0.18, 0.3, 0.29, 0.32, 0.38, 0.3, 0.5, 0.24, 0.52, 0.14, 0.56, 0.57],
  [-0.3, 0.258, 0.17, 0.23, 0.29, 0.235, 0.39, 0.225, 0.53, 0.2, 0.56, 0.13, 0.64, 0.66],
  [-0.6, 0.258, 0.17, 0.22, 0.29, 0.23, 0.41, 0.22, 0.57, 0.19, 0.6, 0.12, 0.67, 0.69],
  [-0.95, 0.258, 0.16, 0.21, 0.29, 0.22, 0.41, 0.2, 0.55, 0.16, 0.58, 0.1, 0.63, 0.645],
  [-1.12, 0.258, 0.15, 0.19, 0.29, 0.2, 0.39, 0.17, 0.5, 0.13, 0.53, 0.08, 0.57, 0.58],
  [-1.2, 0.258, 0.13, 0.16, 0.29, 0.17, 0.37, 0.14, 0.46, 0.1, 0.49, 0.06, 0.51, 0.52],
];
const coreAt = (z: number, i: number) => tab(CORE_ROWS.map((r) => [r[0], r[i]] as [number, number]), z);

function buildCore(detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  // 胴: 右半分の 9 点 → 全周 16 点
  const zs = hi
    ? [1.4, 1.28, 1.15, 1.0, 0.85, 0.7, 0.55, 0.42, 0.3, 0.12, -0.05, -0.2, -0.3, -0.45, -0.6, -0.78, -0.95, -1.05, -1.12, -1.2]
    : [1.4, 1.15, 0.85, 0.55, 0.3, -0.05, -0.2, -0.3, -0.6, -0.95, -1.2];
  const rings = zs.map((z) => {
    const v = (i: number) => coreAt(z, i);
    const yl = v(10), wl = v(9);
    return fullRing(
      [[0, v(1)], [v(2), v(1)], [v(3), v(4)], [v(5), v(6)], [v(7), v(8)], [wl, yl], [Math.max(0.004, wl - 0.014), yl + 0.004], [v(11), v(12)], [0, v(13)]],
      z,
    );
  });
  P.loft(
    rings,
    (k, e) => {
      const re = e < 8 ? e : 15 - e;
      const z = (zs[k] + zs[k + 1]) / 2;
      switch (re) {
        case 0: case 1: return 'frame';
        case 2: return z < -0.3 ? 'frame' : 'sub';
        case 3: case 4: return 'base';
        case 5: return 'line';
        case 6: return z > 0.55 || z < -0.3 ? 'base' : 'sub';
        default: return z > 1.0 ? 'base' : 'sub';
      }
    },
    { cap0: 'sub', cap1: 'sub' },
  );
  // キャノピー: 横はガラス、上は青い屋根。[z, wb, yb, wm, ym, wt, yt, crown] [推]
  const CAN: number[][] = [
    [0.66, 0.03, 0.465, 0.025, 0.47, 0.02, 0.475, 0.478],
    [0.45, 0.15, 0.475, 0.14, 0.55, 0.07, 0.6, 0.61],
    [0.25, 0.18, 0.49, 0.17, 0.62, 0.1, 0.74, 0.755],
    [0.05, 0.19, 0.5, 0.18, 0.66, 0.115, 0.82, 0.835],
    [-0.12, 0.185, 0.505, 0.175, 0.67, 0.115, 0.835, 0.85],
    [-0.26, 0.17, 0.54, 0.16, 0.68, 0.1, 0.8, 0.815],
    [-0.34, 0.14, 0.62, 0.13, 0.7, 0.08, 0.74, 0.75],
  ];
  const canRows = hi ? CAN : [CAN[0], CAN[2], CAN[4], CAN[6]];
  P.loft(
    canRows.map((r) => fullRing([[0, r[2] - 0.005], [r[1], r[2]], [r[3], r[4]], [r[5], r[6]], [0, r[7]]], r[0])),
    (k, e) => {
      const re = e < 4 ? e : 7 - e;
      const z = (canRows[k][0] + canRows[k + 1][0]) / 2;
      if (re === 0) return null;
      if (re === 3) return z < 0.2 ? 'sub' : 'glass';
      if (re === 2) return z < -0.2 ? 'sub' : 'glass';
      return 'glass';
    },
  );
  // ノーズ下の青いスプリッター（前図の V の下の板）
  P.loft(
    ((hi ? [[1.37, 0.025], [1.15, 0.12], [0.95, 0.19], [0.8, 0.2]] : [[1.37, 0.025], [0.8, 0.2]]) as [number, number][]).map(([z, w]) => [[-w, 0.258, z], [w, 0.258, z], [w * 0.92, 0.27, z], [-w * 0.92, 0.27, z]] as V3[]),
    (_k, e) => (e === 2 ? 'sub' : e === 0 ? 'frame' : 'line'),
    { cap0: 'sub', cap1: 'frame' },
  );
  if (hi) {
    // キャノピーの屋根とガラスの境に黒い縁
    const edge = CAN.filter((r) => r[0] <= 0.26);
    for (const sx of [-1, 1]) for (let i = 0; i < edge.length - 1; i++) P.beam([sx * edge[i][5], edge[i][6], edge[i][0]], [sx * edge[i + 1][5], edge[i + 1][6], edge[i + 1][0]], 0.012, 0.012, 'frame');
  }
  // 屋根の後ろの黒い支柱（横図の細いアーチ）
  const hoop: V3[] = [[0.16, 0.56, -0.2], [0.13, 0.78, -0.17], [0.05, 0.85, -0.16], [-0.05, 0.85, -0.16], [-0.13, 0.78, -0.17], [-0.16, 0.56, -0.2]];
  const hp = hi ? hoop : [hoop[0], hoop[1], hoop[4], hoop[5]];
  for (let i = 0; i < hp.length - 1; i++) P.beam(hp[i], hp[i + 1], 0.018, 0.018, 'frame', [0, 0, 1]);
  if (hi) {
    // 運転席: シート・ヘッドレスト・ハンドル・計器盤（ガラス越しに見える）
    P.box([0, 0.61, -0.15], [0.085, 0.1, 0.02], 'frame', 0.01);
    P.box([0, 0.53, -0.06], [0.085, 0.022, 0.08], 'frame', 0.008);
    for (const sx of [-1, 1]) P.box([sx * 0.07, 0.6, -0.12], [0.018, 0.08, 0.03], 'sub', 0.006);
    P.box([0, 0.73, -0.16], [0.045, 0.03, 0.018], 'frame', 0.008);
    P.lathe('z', [0, 0.6], [[0.04, 0.12], [0.052, 0.12], [0.052, 0.132], [0.04, 0.132], [0.04, 0.12]], 10, () => 'frame');
    P.box([0, 0.545, 0.3], [0.12, 0.025, 0.06], 'frame', 0.01);
  }
  // 側面のしきい（前フェンダーの後ろ〜後肩カウルの前をつなぐ白い板）
  const sill: [number, number][][] = [
    [[0.26, 0.262], [0.4, 0.262], [0.42, 0.3], [0.405, 0.35], [0.3, 0.37], [0.26, 0.36]],
    [[0.26, 0.262], [0.44, 0.262], [0.47, 0.31], [0.45, 0.37], [0.3, 0.4], [0.26, 0.39]],
  ];
  const sillZ: [number, number][] = [[0.4, 0], [0.22, 1], [-0.22, 1], [-0.4, 0]];
  const sillR = new Painter();
  sillR.loft(
    sillZ.map(([z, i]) => sill[i].map(([x, y]) => [x, y, z] as V3)),
    (_k, e) => (['frame', 'sub', 'base', 'base', 'frame', 'frame'] as Slot[])[e],
    { cap0: 'frame', cap1: 'frame' },
  );
  if (hi) sillR.box([0.43, 0.355, 0], [0.012, 0.004, 0.2], 'line'); // しきいの赤い差し線
  P.append(sillR);
  P.append(sillR.mirrorX());
  // 尾びれ（上へ反る、先端は青）と、その下の白い支え
  const fin: number[][] = [
    [-0.85, 0.03, 0.62, 0.64],
    [-1.05, 0.045, 0.58, 0.7],
    [-1.2, 0.05, 0.53, 0.75],
    [-1.3, 0.04, 0.62, 0.77],
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
  P.beam([0, 0.56, -1.17], [0, 0.3, -1.06], 0.05, 0.03, 'base', [0, 0, 1]);
  // 後面の黒いルーバーと下の箱（後図の左右の吸気口）
  if (hi) {
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) P.box([sx * 0.09, 0.315 + i * 0.026, -1.205], [0.05, 0.005, 0.008], 'frame');
    P.box([0, 0.3, -1.19], [0.05, 0.035, 0.02], 'sub', 0.008);
  }
  return [unit('core', 'コア', P)];
}

// ══ 2. 前ボンネット&フェンダー（右で作って左は反転） ════════════════════
function buildFenderF(side: number, detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  const zc = 0.72, R = 0.34;
  archShell(P, {
    zs: archZs(0.28, 1.18, zc, R, hi ? 12 : 4, hi ? [0.34, 0.4, 0.96, 1.08] : []),
    zc, R, base: 0.27,
    // 内側はボンネット: ノーズの肩（コアの断面）に沿って下がる面。稜線はタイヤの真上
    xi: (z) => tab([[0.28, 0.37], [0.5, 0.31], [0.85, 0.175], [1.18, 0.085]], z),
    innerY: (z) => tab([[0.28, 0.48], [0.55, 0.45], [0.85, 0.4], [1.18, 0.345]], z),
    ridge: (z) => tab([[0.28, 0.45], [0.72, 0.44], [1.18, 0.44]], z), // タイヤハウスの内壁(0.462)より内側に置く（外だとアーチの天井が上面を突き抜ける）
    well: 0.462,
    xo: (z) => tab([[0.28, 0.7], [0.5, 0.77], [0.9, 0.78], [1.18, 0.68]], z),
    top: (z) => tab([[0.28, 0.5], [0.42, 0.64], [0.72, 0.69], [0.95, 0.62], [1.1, 0.5], [1.18, 0.42]], z),
    split: (z) => tab([[0.28, 0.8], [0.72, 0.6], [1.18, 0.36]], z),
    line: (z) => tab([[0.28, 0.05], [1.18, 0.95]], z),
    slot: (e, z) => (['frame', 'frame', 'frame', 'sub', 'sub', 'base', z > 1.0 ? 'sub' : 'base', 'line', 'base', 'base', 'sub'] as Slot[])[e],
    taper: [{ z: 1.22, c: [0.42, 0.31], k: 0.6 }, { z: 0.24, c: [0.5, 0.42], k: 0.6 }],
  });
  archRim(P, zc, 0.335, 0.37, () => 0.755, () => 0.79, 0.16, Math.PI - 0.12, hi ? 12 : 4, 'base');
  // 前照灯（黒い凹みに光る「く」の字）と、下の青いスプリッター
  const L: V3[] = [[0.43, 0.312, 1.224], [0.52, 0.343, 1.224], [0.555, 0.33, 1.224], [0.55, 0.346, 1.224], [0.515, 0.36, 1.224], [0.425, 0.327, 1.224]];
  P.poly(L, 'lamp');
  P.box([0.3, 0.272, 1.16], [0.1, 0.012, 0.07], 'sub', hi ? 0.006 : 0);
  if (hi) {
    // 内側の黒い骨（アーチの内側から見える）と上面の折れ目の差し板
    P.box([0.462, 0.36, 0.72], [0.006, 0.08, 0.36], 'frame');
    for (let i = 0; i < 3; i++) P.beam([0.775, 0.42 + i * 0.045, 0.42 - i * 0.012], [0.762, 0.47 + i * 0.045, 0.33 - i * 0.012], 0.012, 0.018, 'frame', [1, 0, 0]);
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
  archShell(P, {
    zs: archZs(-1.18, -0.16, zc, R, hi ? 14 : 4, hi ? [-0.22, -0.3, -1.08, -1.13] : []),
    zc, R, base: 0.27,
    xi: () => 0.472,
    xo: (z) => tab([[-0.16, 0.7], [-0.4, 0.79], [-0.9, 0.8], [-1.18, 0.74]], z),
    top,
    split: (z) => tab([[-0.16, 0.72], [-0.72, 0.5], [-1.18, 0.8]], z),
    taper: [{ z: -1.22, c: [0.62, 0.42], k: 0.6 }, { z: -0.12, c: [0.6, 0.45], k: 0.55 }],
    caps: ['frame', 'sub'],
    line: (z) => tab([[-0.16, 0.9], [-1.18, 0.1]], z),
    slot: (e, z) => (['frame', 'frame', 'frame', 'sub', 'sub', 'base', z < -0.75 ? 'sub' : 'base', 'line', 'base', 'base', 'frame'] as Slot[])[e],
  });
  archRim(P, zc, 0.335, 0.4, () => 0.77, () => 0.815, 0.12, Math.PI - 0.16, hi ? 14 : 4, 'base');
  if (hi) {
    // 外側面の前寄りの吸気口（黒い凹み）と赤い下線
    P.poly([[0.812, 0.4, -0.3], [0.812, 0.36, -0.44], [0.812, 0.5, -0.47], [0.81, 0.55, -0.33]], 'frame');
    P.beam([0.814, 0.39, -0.29], [0.814, 0.35, -0.45], 0.006, 0.012, 'line', [1, 0, 0]);
    // 後面: 黒いルーバー3本と丸穴2つ（後図）
    for (let i = 0; i < 3; i++) P.box([0.62, 0.36 + i * 0.06, -1.186], [0.08, 0.008, 0.008], 'frame');
    for (const x of [0.53, 0.71]) P.lathe('z', [x, 0.31], [[0.022, -1.183], [0.032, -1.183], [0.032, -1.19]], 8, () => 'metal');
  }
  const units: Unit[] = [];
  // 肩（ポッドの居場所）x 0.245〜0.47、z -0.27〜-0.98
  const Z0 = -0.27, Z1 = -0.98;
  const zsh = hi ? [Z0, -0.4, -0.62, -0.84, Z1] : [Z0, Z1];
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
    // 後ろの壁: 外から見える面なので車体色（上の縁に赤線）
    const bwTop = bay === 'B' ? 0.555 : 0.66;
    P.loft(
      [[[0.245, 0.4, Z1 + 0.012], [0.472, 0.4, Z1 + 0.012], [0.472, bwTop, Z1 + 0.012], [0.245, bwTop, Z1 + 0.012]], [[0.245, 0.4, Z1 - 0.004], [0.472, 0.4, Z1 - 0.004], [0.472, bwTop - 0.01, Z1 - 0.004], [0.245, bwTop - 0.01, Z1 - 0.004]]] as V3[][],
      (_k, e) => (e === 2 ? 'line' : 'frame'),
      { cap0: 'frame', cap1: 'base' },
    );
    if (hi) P.box([0.36, 0.43, Z1 - 0.006], [0.1, 0.025, 0.004], 'sub');
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
      const zl = hi ? [Z0 - 0.005, -0.32, -0.62, -0.92, Z1 + 0.005] : [Z0 - 0.005, Z1 + 0.005];
      lid.loft(
        zl.map((z) => {
          const t = shTop(z);
          return [[0.25, t - 0.05, z], [0.47, t - 0.04, z], [0.475, t - 0.012, z], [0.44, t, z], [0.33, t - 0.004, z], [0.316, t - 0.005, z], [0.25, t - 0.02, z]] as V3[];
        }),
        (k, e) => (['frame', 'sub', k === 0 || k === zl.length - 2 ? 'sub' : 'base', 'base', 'line', 'base', 'sub'] as Slot[])[e],
        { cap0: 'sub', cap1: 'sub' },
      );
      if (hi) lid.box([0.36, 0.64, -0.62], [0.08, 0.01, 0.25], 'frame'); // フタの裏の骨
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
// 本体の断面（右ポッドの中心からの比率）[rel z, 幅倍率, 高さ倍率, 上下ずれ(×h), 青白の境(×h)] [推]
const POD_SEC: number[][] = [
  [0.29, 0.8, 0.58, -0.35, -0.2],
  [0.24, 0.93, 0.74, -0.22, -0.2],
  [0.12, 1.0, 0.9, -0.08, 0.05],
  [0.0, 1.0, 1.0, 0.0, 0.25],
  [-0.14, 1.0, 1.0, 0.0, 0.0],
  [-0.25, 0.96, 0.97, 0.0, -0.25],
  [-0.29, 0.9, 0.92, 0.0, -0.25],
];
const podRing = (c: V3, sw: number, sh: number, dy: number, sp: number, z: number): V3[] => {
  const w = POD_W * sw, h = POD_H * sh, y = c[1] + dy * POD_H;
  const pts: [number, number][] = [
    [-0.78 * w, -h], [0.78 * w, -h], [w, -0.4 * h], [w, sp * h], [w, 0.3 * h], [0.72 * w, 0.84 * h], [0.52 * w, 0.93 * h],
    [0.42 * w, 0.96 * h], [0.22 * w, h], [-0.22 * w, h], [-0.72 * w, 0.84 * h], [-w, 0.3 * h], [-w, sp * h], [-w, -0.4 * h],
  ];
  return pts.map(([x, yy]) => [c[0] + x, y + yy, c[2] + z]);
};
const POD_EDGE: Slot[] = ['frame', 'sub', 'sub', 'base', 'base', 'base', 'line', 'base', 'base', 'base', 'base', 'base', 'sub', 'sub'];

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
  const secs = hi ? POD_SEC : [POD_SEC[0], POD_SEC[2], POD_SEC[4], POD_SEC[6]];
  body.loft(
    secs.map(([z, sw, sh, dy, sp]) => podRing(c, sw, sh, dy, sp, z)),
    (k, e) => (k === 0 && e !== 0 ? 'sub' : POD_EDGE[e]),
    { cap0: 'frame', cap1: 'frame' },
  );
  if (hi) {
    // 側面の青い三角（参考画の斜めの塗り分け）
    const x = c[0] + POD_W + 0.002;
    body.poly([[x, c[1] - 0.03, c[2] + 0.1], [x, c[1] + 0.03, c[2] - 0.12], [x, c[1] - 0.03, c[2] - 0.2]], 'sub');
    body.poly([[-x + 2 * c[0], c[1] - 0.03, c[2] + 0.1], [-x + 2 * c[0], c[1] + 0.03, c[2] - 0.12], [-x + 2 * c[0], c[1] - 0.03, c[2] - 0.2]], 'sub');
    // 側面後ろの黒いルーバー（左右）
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) body.box([c[0] + sx * (POD_W + 0.004), c[1] + 0.035 - i * 0.022, c[2] - 0.2], [0.004, 0.006, 0.05], 'frame');
  }
  // 吸気口（前の六角の縁と奥の黒いトンネル）
  const intake = new Painter();
  const [fz, fsw, fsh, fdy, fsp] = POD_SEC[0];
  if (hi) {
    intake.loft(
      [podRing(c, fsw * 0.94, fsh * 0.94, fdy, fsp, fz + 0.016), podRing(c, fsw * 0.8, fsh * 0.78, fdy, fsp, fz + 0.016), podRing(c, fsw * 0.7, fsh * 0.66, fdy, fsp, fz - 0.06)],
      (k) => (k === 0 ? 'sub' : 'frame'),
      { cap1: 'frame' },
    );
    intake.loft([podRing(c, fsw, fsh, fdy, fsp, fz), podRing(c, fsw * 0.94, fsh * 0.94, fdy, fsp, fz + 0.016)], () => 'sub');
  } else {
    intake.poly(podRing(c, fsw * 0.8, fsh * 0.78, fdy, fsp, fz + 0.004), 'frame');
  }
  // ノズル（内側の黒い筒・タービン）と金リング。BOOST2 で一緒に後ろへ伸びる
  const nozzle = new Painter();
  const ring = new Painter();
  const nc: [number, number] = [c[0], c[1] + 0.005];
  const rz = c[2];
  const nn = hi ? 16 : 8;
  nozzle.lathe('z', nc, [[0.06, rz - 0.18], [0.06, rz - 0.295]], hi ? 12 : 8, () => 'frame');
  nozzle.lathe('z', nc, [[0.0, rz - 0.272], [0.058, rz - 0.272]], hi ? 12 : 8, () => 'frame');
  if (hi) nozzle.lathe('z', nc, [[0.0, rz - 0.285], [0.02, rz - 0.272]], 8, () => 'metal');
  if (hi) for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    nozzle.quad([nc[0] + Math.cos(a) * 0.02, nc[1] + Math.sin(a) * 0.02, rz - 0.274], [nc[0] + Math.cos(a) * 0.056, nc[1] + Math.sin(a) * 0.056, rz - 0.274],
      [nc[0] + Math.cos(a + 0.3) * 0.056, nc[1] + Math.sin(a + 0.3) * 0.056, rz - 0.279], [nc[0] + Math.cos(a + 0.3) * 0.02, nc[1] + Math.sin(a + 0.3) * 0.02, rz - 0.279], 'metal');
  }
  ring.lathe('z', nc, hi ? [[0.058, rz - 0.288], [0.08, rz - 0.288], [0.083, rz - 0.298], [0.08, rz - 0.312], [0.062, rz - 0.312], [0.058, rz - 0.3], [0.058, rz - 0.288]] : [[0.08, rz - 0.288], [0.08, rz - 0.312], [0.06, rz - 0.312]], nn, () => 'metal');
  // 隠しダクト（上面後ろ、前向きの口）
  const duct = new Painter();
  const dy0 = c[1] + POD_H - 0.072; // 格納時は本体の中
  const dsec = (z: number, s: number): V3[] =>
    ([[-0.045, 0], [0.045, 0], [0.05, 0.05 * s], [0.035, 0.06 * s], [-0.035, 0.06 * s], [-0.05, 0.05 * s]] as [number, number][]).map(([x, y]) => [c[0] + x, dy0 + y, c[2] + z]);
  duct.loft(hi ? [dsec(-0.05, 1), dsec(-0.12, 0.85), dsec(-0.2, 0.55)] : [dsec(-0.05, 1), dsec(-0.2, 0.55)], (_k, e) => (e === 0 ? 'frame' : e === 3 ? 'base' : 'sub'), { cap0: 'frame', cap1: 'sub' });
  if (hi) duct.poly([[c[0] - 0.04, dy0 + 0.005, c[2] - 0.048], [c[0] + 0.04, dy0 + 0.005, c[2] - 0.048], [c[0] + 0.03, dy0 + 0.052, c[2] - 0.048], [c[0] - 0.03, dy0 + 0.052, c[2] - 0.048]], 'frame');
  // カナード（左右の横へせり出す薄い板、先端は赤）。格納時は本体の中
  const canard = (sx: number, out: boolean) => {
    const p = new Painter();
    const off = out ? CAN_OUT : 0;
    const x0 = c[0] + sx * (0.015 + off), x1 = c[0] + sx * (0.088 + off), xt = c[0] + sx * (0.076 + off);
    const y = c[1] - 0.005, t = 0.006;
    const pl = (xa: number, xb: number, s: Slot) => {
      const q = (x: number, zz: number, dy: number): V3 => [x, y + dy, c[2] + zz];
      const fa = -0.02, ra = -0.15, fb = -0.07, rb = -0.14;
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
    armHi.beam([c[0], M.tipY!, a.baseZ], [c[0], M.tipY!, a.baseZ + a.len], 0.022, 0.016, 'frame', [0, 1, 0]);
    body.box([c[0], M.tipY! + 0.006, a.baseZ], [0.032, 0.008, 0.035], 'frame');
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
  units.push(unit('ring', `${name}金リング`, sided(ring, side), { parent: 'body', pivot: pv([c[0], c[1], c[2] - 0.3]), motion: RING }));
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

export function stellaKit(rigId: PodRigId = 'C'): CarKit {
  const rig = POD_RIGS[rigId];
  const parts: PartDef[] = [
    { id: 'core', kind: 'core', label: 'コア（キャノピー〜ノーズ）', mount: { slot: 'core', side: 0, pos: [0, 0.26, 0] }, explode: [0, 0, 0], build: (d) => buildCore(d) },
  ];
  for (const side of [1, -1] as const) {
    const n = side > 0 ? 'R' : 'L';
    parts.push({ id: `fender${n}`, kind: 'fenderF', label: `前ボンネット&フェンダー ${n}`, mount: { slot: 'fenderF', side, pos: [0.6 * side, 0.26, 0.72] }, explode: [0.85 * side, 0, 0.75], build: (d) => buildFenderF(side, d) });
    parts.push({ id: `cowl${n}`, kind: 'cowlR', label: `後肩カウル&アーチ ${n}`, variant: rig.id, mount: { slot: 'cowlR', side, pos: [0.62 * side, 0.26, -0.72] }, explode: [0.9 * side, 0, -0.6], build: (d) => buildCowlR(side, rig.id, d) });
  }
  parts.push({ id: 'wing', kind: 'wing', label: 'リアウィング一式', mount: { slot: 'wing', side: 0, pos: [0, 0.6, -1.07] }, explode: [0, 1.25, -0.7], build: (d) => buildWing(d) });
  for (const side of [1, -1] as const) {
    const n = side > 0 ? 'R' : 'L';
    parts.push({ id: `pod${n}`, kind: 'pod', label: `ブーストポッド ${n}`, variant: rig.id, mount: { slot: 'pod', side, pos: [rig.rest[0] * side, rig.rest[1] - POD_H, rig.rest[2]] }, explode: [0.55 * side, 0.85, 0.15], build: (d) => buildPod(side, rig, d) });
  }
  return { id: `stella-${rig.id}`, name: 'STELLA', states: ['NORMAL', 'BOOST1', 'BOOST2', 'BOOST3'], palette: STELLA_PALETTES.wbr.palette, parts };
}
