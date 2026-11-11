import { Painter, fullRing } from './painter';
import { ease, type CarKit, type Detail, type Motion, type Palette, type PartDef, type Slot, type Unit, type V3 } from './types';

// CRIMSON（紅の隼。羽根を重ねた猛禽）を部位キットで作る。部位キットの2台目。
// 参考: 設定画の前・横・後ろの3面（形そのものは写さず、要素＝細い多面のノーズ・背中の吸気口つきのこぶ・
// 後ろの黒いタービンと輪・胴の脇に重ねた羽根・クリーム色の先端 を使う）。
//
// 部位: コア（ノーズ〜胴）/ タービン一式（外筒・背中のこぶ・ノズルの輪）/ 翼 左右（羽根3枚ずつ）/ 爪 左右
// 状態: 0=NORMAL（羽根は胴の脇に重ねてたたむ）
//       1=BOOST1（羽根が持ち上がってから斜め前へ開く。前の1枚から順に）
//       2=BOOST2（背中のこぶが上がって吸気口が開き、ノズルの輪が後ろへ伸びる）
//       3=BOOST3（羽根がさらに前へ・上へ広がり、鼻の爪が外へ開く）
//
// 翼の動き（系譜の「小型化して斜め前へ展開」を出発点に、当たらないよう決めたこと）[仮]:
//  ・羽根は設定画より短い（最長でも 0.50 = 車長の約15%）。前後のタイヤの間（z -0.42〜+0.42）で開くので、
//    開いた先端が前のタイヤに当たらない長さにした
//  ・付け根は前側。たたむと先端は後ろ向きで、外の縁を下げた「瓦」の角度で胴の脇に重なる
//  ・開くときは「先に持ち上げて面を水平に寝かせる → 回して外・斜め前へ」の順。
//    いちばん上の長い羽根は後ろのタイヤの上を通るので、回り始める前にタイヤの上端（y 0.60）より上へ上げる
//  ・3枚は付け根を前後・上下・外へ少しずつずらし、開く角度も変える（扇形に広がる）
// 寸法は STELLA と同じ標準シャーシ基準: 車軸 z=±0.72、タイヤ半径 0.3、タイヤの内側 x=0.48、シャーシ板の上面 y≈0.255。

const k1 = (s: number) => ease(s);
const k2 = (s: number) => ease(s - 1);
const k3 = (s: number) => ease(s - 2);
const DEG = Math.PI / 180;
const unit = (id: string, label: string, paint: Painter, o: Partial<Unit> = {}): Unit => ({ id, label, paint, ...o });

// 羽根（刃）: 付け根が原点、長さは dir（-1=後ろ向き、+1=前向き）へ、幅は +x へ。菱形の断面で中央に稜線。先端 35% は sub（クリーム）
function blade(c: number, L: number, t: number, dir: number, tipSlot: Slot = 'sub'): Painter {
  const P = new Painter();
  const sec = (f: number, x0: number, x1: number, tt: number): V3[] => {
    const xm = x0 + (x1 - x0) * 0.42;
    return [[x0, 0, dir * L * f], [xm, tt, dir * L * f], [x1, 0, dir * L * f], [xm, -tt * 0.45, dir * L * f]];
  };
  const rings = [sec(-0.03, 0, c * 0.55, t * 0.8), sec(0.12, 0, c, t), sec(0.64, 0.01, c * 0.9, t * 0.8), sec(1, c * 0.3, c * 0.36, t * 0.2)];
  P.loft(rings, (k, e) => (k === 2 ? tipSlot : e >= 2 ? 'line' : 'base'), { cap0: 'frame', cap1: tipSlot });
  return P;
}
// 形を回して動かす（z 軸まわり→ y 軸まわり→ 平行移動）。爪など動かない羽根の角度を形に焼き込む
function placed(p: Painter, rz: number, ry: number, at: V3): Painter {
  const q = new Painter();
  q.slot = [...p.slot];
  const cz = Math.cos(rz), sz = Math.sin(rz), cy = Math.cos(ry), sy = Math.sin(ry);
  for (let i = 0; i < p.pos.length; i += 3) {
    const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
    const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    q.pos.push(x1 * cy + z * sy + at[0], y1 + at[1], -x1 * sy + z * cy + at[2]);
  }
  return q;
}

// ══ コア（ノーズ〜胴） ══════════════════════════════════════
// 断面（右半分）: [z, 底の半幅, 底, 肩の半幅, 肩の高さ, 上の半幅, 上の高さ, 中心の高さ] [推]
const ROWS: number[][] = [
  [1.38, 0.03, 0.272, 0.04, 0.29, 0.022, 0.305, 0.31],
  [1.16, 0.07, 0.262, 0.1, 0.31, 0.05, 0.36, 0.375],
  [0.8, 0.11, 0.26, 0.17, 0.34, 0.085, 0.445, 0.465],
  [0.4, 0.15, 0.26, 0.225, 0.38, 0.115, 0.545, 0.57],
  [0.0, 0.17, 0.26, 0.25, 0.42, 0.13, 0.635, 0.66],
  [-0.3, 0.17, 0.26, 0.25, 0.46, 0.13, 0.69, 0.715],
  [-0.52, 0.16, 0.26, 0.22, 0.48, 0.11, 0.66, 0.68],
];
function buildCore(detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  const rows = hi ? ROWS : [ROWS[0], ROWS[2], ROWS[4], ROWS[6]];
  P.loft(
    rows.map((r) => fullRing([[0, r[2]], [r[1], r[2]], [r[3], r[4]], [r[5], r[6]], [0, r[7]]], r[0])),
    (k, e) => {
      const re = e < 4 ? e : 7 - e;
      const z = (rows[k][0] + rows[k + 1][0]) / 2;
      if (re === 0) return 'frame';
      if (re === 1) return z > 0.9 ? 'base' : 'frame'; // 脇腹は黒い機械、鼻先は赤
      return 'base';
    },
    { cap0: 'frame', cap1: 'frame' },
  );
  // 鼻先の黒い口と青い目
  P.box([0, 0.288, 1.385], [0.02, 0.01, 0.006], 'frame');
  for (const sx of [-1, 1]) P.quad([sx * 0.062, 0.325, 1.2], [sx * 0.092, 0.322, 1.1], [sx * 0.1, 0.308, 1.1], [sx * 0.072, 0.31, 1.2], sx > 0 ? 'lamp2' : 'lamp');
  if (hi) {
    // ノーズの上の小さな吸気口と、こぶの手前の段
    P.box([0, 0.552, 0.36], [0.045, 0.012, 0.05], 'frame', 0.005);
    P.box([0, 0.64, -0.02], [0.07, 0.014, 0.07], 'line', 0.006);
    // 脇腹の黒い機械（筒と箱）
    for (const sx of [-1, 1]) {
      P.box([sx * 0.2, 0.33, 0.1], [0.045, 0.06, 0.34], 'frame', 0.012);
      P.lathe('x', [0.36, -0.12], [[0.05, sx * 0.19], [0.05, sx * 0.26], [0.03, sx * 0.265]], 8, (k) => (k === 0 ? 'frame' : 'metal'));
      P.lathe('x', [0.33, 0.3], [[0.035, sx * 0.19], [0.035, sx * 0.255], [0.02, sx * 0.26]], 8, () => 'frame');
      P.box([sx * 0.215, 0.44, -0.3], [0.035, 0.035, 0.12], 'frame', 0.01);
    }
  }
  return [unit('core', 'コア', P)];
}

// ══ タービン一式（外筒・背中のこぶ・ノズルの輪） ══════════════════════
const HUMP_UP = 0.07, RING_EXT = 0.1;
const HUMP: Motion = { id: 'crimson.hump', kind: 'translate', at: (s, o) => { const k = k2(s); o.p[1] = HUMP_UP * k; o.p[2] = -0.03 * k; } };
const RING: Motion = { id: 'crimson.ring', kind: 'translate', at: (s, o) => void (o.p[2] = -RING_EXT * k2(s)) };
function buildTurbine(detail: Detail): Unit[] {
  const hi = detail === 'high';
  const n = hi ? 14 : 8;
  const C: [number, number] = [0, 0.5];
  const shell = new Painter();
  shell.lathe('z', C, [[0.12, -0.44], [0.215, -0.52], [0.235, -0.62], [0.235, -1.04], [0.21, -1.1], [0.14, -1.1]], n, (k) => (k === 2 ? 'frame' : k === 0 ? 'line' : 'frame'));
  shell.lathe('z', C, [[0.238, -0.7], [0.244, -0.72], [0.244, -0.78], [0.238, -0.8]], n, () => 'base'); // 赤い帯
  // 筒の左右のクリーム色の牙（後ろ姿）
  for (const sx of [-1, 1]) {
    shell.append(placed(blade(0.07, 0.22, 0.018, -1), sx * 100 * DEG, sx > 0 ? -10 * DEG : 10 * DEG, [sx * 0.25, 0.44, -0.9]));
  }
  // 背中のこぶ: 前は黒い吸気口、後ろへ細く低くなる楔。BOOST2 で上がって口が大きく開く
  const hump = new Painter();
  const HR: number[][] = [[-0.3, 0.12, 0.7, 0.79], [-0.44, 0.17, 0.69, 0.845], [-0.8, 0.15, 0.7, 0.8], [-1.06, 0.07, 0.71, 0.74]];
  hump.loft(
    HR.map(([z, w, b, t]) => fullRing([[0, b], [w * 0.8, b], [w, (b + t) / 2], [w * 0.6, t], [0, t + 0.012]], z)),
    (_k, e) => ((e < 4 ? e : 7 - e) === 0 ? 'frame' : 'base'),
    { cap0: 'frame', cap1: 'line' },
  );
  if (hi) {
    // 吸気口の縁と、こぶの下の黒い首（上がったときに見える）
    hump.box([0, 0.7, -0.33], [0.1, 0.008, 0.03], 'line');
    hump.box([0, 0.66, -0.62], [0.06, 0.05, 0.2], 'frame', 0.01);
  }
  // ノズルの輪: 金物の輪と赤い縁、奥は黒
  const ring = new Painter();
  ring.lathe('z', C, [[0.2, -1.08], [0.2, -1.2], [0.185, -1.3], [0.15, -1.3], [0.13, -1.12], [0, -1.12]], n, (k) => (k === 0 ? 'base' : k < 3 ? 'metal' : 'frame'));
  return [
    unit('shell', 'タービンの外筒', shell),
    unit('hump', '背中のこぶ', hump, { pivot: [0, 0.7, -0.6], motion: HUMP }),
    unit('ring', 'ノズルの輪', ring, { pivot: [0, 0.5, -1.1], motion: RING, marks: [{ id: 'jet', pos: [0, 0.5, -1.3], r: 0.15 }] }),
  ];
}

// ══ 翼（羽根3枚。前の低い1枚 → 中 → 後ろの高い長い1枚） ══════════════════
//   付け根 / 幅 / 長さ / たたんだときの瓦の角度 / 開く角度（後ろ向きから外回りに）/ 上反角 / 開く順（s の遅れ）
interface Feather { p: V3; c: number; L: number; fold: number; yaw: number; yaw3: number; dih: number; dih3: number; t0: number }
const FEATHERS: Feather[] = [
  { p: [0.275, 0.41, 0.1], c: 0.15, L: 0.34, fold: 50, yaw: 110, yaw3: 120, dih: 7, dih3: 11, t0: 0 },
  { p: [0.29, 0.505, -0.07], c: 0.19, L: 0.44, fold: 46, yaw: 103, yaw3: 113, dih: 14, dih3: 21, t0: 0.1 },
  { p: [0.3, 0.6, -0.26], c: 0.23, L: 0.52, fold: 42, yaw: 96, yaw3: 106, dih: 21, dih3: 30, t0: 0.2 },
];
function buildWing(side: number, detail: Detail): Unit[] {
  const hi = detail === 'high';
  const n = side > 0 ? 'R' : 'L';
  const units: Unit[] = [];
  FEATHERS.forEach((f, i) => {
    const piv: V3 = [f.p[0] * side, f.p[1], f.p[2]];
    // 先に上げる（上反角）→ 回す → 寝かせる
    const up = (s: number) => ease((s - f.t0) / 0.4);
    const sw = (s: number) => ease((s - f.t0 - 0.22) / 0.58);
    const lift: Motion = { id: `crimson.lift${n}${i}`, kind: 'general', at: (s, o) => void (o.r[2] = side * (f.dih * up(s) + (f.dih3 - f.dih) * k3(s)) * DEG) };
    const swing: Motion = {
      id: `crimson.swing${n}${i}`, kind: 'general',
      at: (s, o) => {
        const k = sw(s);
        o.r[1] = -side * (f.yaw * k + (f.yaw3 - f.yaw) * k3(s)) * DEG;
        o.r[2] = -side * f.fold * (1 - up(s)) * DEG; // 寝かせるのは回す前（たたんだ角度のまま回すと外の縁が後ろのタイヤに当たる）
      },
    };
    // 付け根の黒い関節（上反角で動く台）
    const hinge = new Painter();
    hinge.box([piv[0] - side * 0.02, piv[1] - 0.01, piv[2]], [0.03, 0.022, 0.035], 'frame', 0.008);
    if (hi) hinge.lathe('y', [piv[0], piv[2]], [[0.022, piv[1] - 0.03], [0.022, piv[1] + 0.02], [0.012, piv[1] + 0.026]], 8, (k) => (k === 0 ? 'metal' : 'frame'));
    const b = blade(f.c, f.L, 0.02, -1);
    const bp = side > 0 ? b : b.mirrorX();
    const moved = new Painter();
    moved.slot = bp.slot;
    moved.pos = bp.pos.map((v, j) => v + piv[j % 3]);
    units.push(unit(`hinge${i}`, `羽根${i + 1}の関節`, hinge, { pivot: piv, motion: lift }));
    units.push(unit(`blade${i}`, `羽根${i + 1}`, moved, { parent: `hinge${i}`, pivot: piv, motion: swing }));
  });
  return units;
}

// ══ 爪（鼻の両脇。BOOST3 で外へ開く） ═══════════════════════════════
function buildClaw(side: number, detail: Detail): Unit[] {
  const hi = detail === 'high';
  const P = new Painter();
  const piv: V3 = [0.17 * side, 0.33, 0.82];
  const mk = (c: number, L: number, rz: number, ry: number, at: V3) => {
    const b = placed(blade(c, L, 0.018, 1), -rz * DEG, -ry * DEG, at);
    return side > 0 ? b : b.mirrorX();
  };
  P.append(mk(0.085, 0.4, 38, 8, [0.15, 0.335, 0.84])); // 下の長い爪（先はクリーム）
  if (hi) P.append(mk(0.07, 0.26, 55, 14, [0.19, 0.39, 0.62])); // 上の短い爪
  const FLARE: Motion = { id: `crimson.claw${side > 0 ? 'R' : 'L'}`, kind: 'general', at: (s, o) => void (o.r[1] = side * 16 * DEG * k3(s)) };
  return [unit('claw', side > 0 ? '右の爪' : '左の爪', P, { pivot: piv, motion: FLARE })];
}

export const CRIMSON_PALETTES: Record<string, { label: string; palette: Palette }> = {
  rc: { label: '紅×クリーム', palette: { base: 0xc8141e, sub: 0xeadcc6, line: 0x7d0c15, frame: 0x1b1c20, glass: 0x101216, metal: 0xb9bcc4, lamp: 0x4fd8ff, lamp2: 0x4fd8ff } },
  bk: { label: '黒×金', palette: { base: 0x202227, sub: 0xd9b24a, line: 0x0f1013, frame: 0x121316, glass: 0x101216, metal: 0xe8bb45, lamp: 0xffd26a, lamp2: 0xffd26a } },
  wb: { label: '白×青', palette: { base: 0xf1f3f6, sub: 0x1d4ed8, line: 0xb9c2d0, frame: 0x1b1c20, glass: 0x101216, metal: 0xb9bcc4, lamp: 0x4fd8ff, lamp2: 0x4fd8ff } },
};

export function crimsonKit(): CarKit {
  const parts: PartDef[] = [
    { id: 'core', kind: 'core', label: 'コア（ノーズ〜胴）', mount: { slot: 'core', side: 0, pos: [0, 0.26, 0] }, explode: [0, 0, 0.3], build: (d) => buildCore(d) },
    { id: 'turbine', kind: 'pod', label: 'タービン一式', mount: { slot: 'pod', side: 0, pos: [0, 0.5, -0.8] }, explode: [0, 0.5, -0.8], build: (d) => buildTurbine(d) },
  ];
  for (const side of [1, -1] as const) {
    const n = side > 0 ? 'R' : 'L';
    parts.push({ id: `wing${n}`, kind: 'wing', label: `翼 ${n}（羽根3枚）`, mount: { slot: 'wing', side, pos: [0.28 * side, 0.45, 0.05] }, explode: [0.8 * side, 0.25, 0], build: (d) => buildWing(side, d) });
    parts.push({ id: `claw${n}`, kind: 'fenderF', label: `爪 ${n}`, mount: { slot: 'fenderF', side, pos: [0.17 * side, 0.33, 0.82] }, explode: [0.55 * side, 0, 0.6], build: (d) => buildClaw(side, d) });
  }
  return { id: 'crimson', name: 'CRIMSON', states: ['NORMAL', 'BOOST1', 'BOOST2', 'BOOST3'], palette: CRIMSON_PALETTES.rc.palette, parts };
}
