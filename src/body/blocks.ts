import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 自作ボディ＝ブロックの一覧。ゲームとボディ工房（builder.html）の両方がこのファイルを使う
// 座標は車体と同じ（前が +z、原点は路面の高さ）。p はブロックの中心、s は回す前の幅・高さ・長さ
export type BlockType = 'box' | 'wedge' | 'trap' | 'halfcyl' | 'qcyl' | 'cyl' | 'cone' | 'dome' | 'rbox' | 'plate' | 'pipe' | 'ring' | 'harch';
export type BlockColor = 'body' | 'dark' | 'accent' | 'black';
export type Vec3 = [number, number, number];
export interface Block {
  t: BlockType;
  p: Vec3;
  s: Vec3;
  r: Vec3; // 90度刻みの回転回数（x, y, z）
  c: BlockColor;
  m?: boolean; // 左右対称（中心線上なら1個だけ）
  k?: number; // 種類ごとの追加の値（台形の上面比率、円錐台の先端比率、中空の肉厚、角丸の段階）
  a?: number; // 板の傾き（度、15度刻み）
}
export type BodyLine = 'edge' | 'stream' | 'balance';
export interface BodyData {
  v: 1;
  name: string;
  line: BodyLine;
  blocks: Block[];
}

export const MAX_BLOCKS = 60;
export const GRID = 0.01; // 位置・大きさの最小の刻み（バーの小矢印1回分）
export const SIZE_MIN = 0.05;
export const SIZE_MAX = 1.6;
export const PLATE_T = 0.03;

type Def = {
  label: string;
  s: Vec3;
  dims: [string, string, string]; // スライダーの名前（空なら出さない）
  k?: { label: string; min: number; max: number; step: number; def: number };
  tilt?: boolean;
  hollow?: boolean;
};
export const BLOCKS: Record<BlockType, Def> = {
  box: { label: '箱', s: [0.6, 0.2, 0.6], dims: ['幅', '高さ', '長さ'] },
  wedge: { label: 'くさび', s: [0.6, 0.2, 0.5], dims: ['幅', '高さ', '長さ'] },
  trap: { label: '台形', s: [0.6, 0.2, 0.5], dims: ['幅', '高さ', '長さ'], k: { label: '上面の幅', min: 0.2, max: 1, step: 0.1, def: 0.6 } },
  halfcyl: { label: '半円筒', s: [0.3, 0.3, 0.7], dims: ['幅', '高さ', '長さ'] },
  qcyl: { label: '1/4円筒', s: [0.3, 0.25, 0.4], dims: ['幅', '高さ', '長さ'] },
  cyl: { label: '円筒', s: [0.2, 0.2, 0.5], dims: ['幅', '高さ', '長さ'] },
  cone: { label: '円錐台', s: [0.25, 0.25, 0.4], dims: ['幅', '高さ', '長さ'], k: { label: '前の太さ', min: 0, max: 1, step: 0.1, def: 0.5 } },
  dome: { label: 'ドーム', s: [0.5, 0.2, 0.6], dims: ['幅', '高さ', '長さ'] },
  rbox: { label: '角丸の箱', s: [0.6, 0.2, 0.6], dims: ['幅', '高さ', '長さ'], k: { label: '角の丸み', min: 1, max: 3, step: 1, def: 2 } },
  plate: { label: '板', s: [0.6, PLATE_T, 0.3], dims: ['幅', '', '長さ'], tilt: true },
  pipe: { label: 'パイプ', s: [0.25, 0.25, 0.5], dims: ['幅', '高さ', '長さ'], k: { label: '肉厚', min: 0.02, max: 0.2, step: 0.01, def: 0.04 }, hollow: true },
  ring: { label: 'ドーナツ', s: [0.4, 0.4, 0.08], dims: ['外径(横)', '外径(縦)', ''], k: { label: '太さ', min: 0.03, max: 0.3, step: 0.01, def: 0.08 }, hollow: true },
  harch: { label: '中空の半円筒', s: [0.3, 0.38, 0.8], dims: ['幅', '高さ', '長さ'], k: { label: '肉厚', min: 0.02, max: 0.2, step: 0.01, def: 0.06 }, hollow: true },
};
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

export const snap = (v: number, g = GRID) => Math.round(v / g) * g;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const kOf = (b: Block) => b.k ?? BLOCKS[b.t].k?.def ?? 0;
// ドーナツの奥行きは太さと同じ
export const sizeOf = (b: Block): Vec3 => (b.t === 'ring' ? [b.s[0], b.s[1], kOf(b)] : b.t === 'plate' ? [b.s[0], PLATE_T, b.s[2]] : b.s);

export function newBlock(t: BlockType, p: Vec3 = [0, 0.6, 0]): Block {
  const d = BLOCKS[t];
  const b: Block = { t, p: [...p], s: [...d.s], r: [0, 0, 0], c: 'body', m: true };
  if (d.k) b.k = d.k.def;
  if (d.tilt) b.a = 0;
  return b;
}

// 数字を刻みに丸める（同じボディは同じ文字列になる）
export function normalize(b: Block): Block {
  const out: Block = {
    t: b.t,
    p: b.p.map((v) => r3(snap(v))) as Vec3,
    s: b.s.map((v) => r3(Math.min(SIZE_MAX, Math.max(SIZE_MIN, snap(v))))) as Vec3,
    r: b.r.map((v) => ((Math.round(v) % 4) + 4) % 4) as Vec3,
    c: b.c,
  };
  if (b.m) out.m = true;
  const kd = BLOCKS[b.t].k;
  if (kd) out.k = r3(Math.min(kd.max, Math.max(kd.min, Math.round(kOf(b) / kd.step) * kd.step)));
  if (BLOCKS[b.t].tilt) out.a = Math.max(-90, Math.min(90, Math.round((b.a ?? 0) / 15) * 15));
  return out;
}

export const isMirrored = (b: Block) => !!b.m && Math.abs(b.p[0]) >= 0.025;
export const blockCount = (blocks: Block[]) => blocks.reduce((n, b) => n + (isMirrored(b) ? 2 : 1), 0);

// ---- 形 ----
// 横から見た輪郭（u=前後, v=高さ）を幅 w だけ押し出す
function prism(shape: THREE.Shape, w: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 14 });
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2, 0, 0);
  return g;
}
// 正面から見た輪郭（x, y）を長さ l だけ前後に押し出す
function extrudeZ(shape: THREE.Shape, l: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false, curveSegments: 18 });
  g.translate(0, 0, -l / 2);
  return g;
}
const halfEllipse = (sh: THREE.Path, cx: number, cy: number, rx: number, ry: number, from: number, to: number, cw: boolean) =>
  sh.absellipse(cx, cy, rx, ry, from, to, cw, 0);

export function blockGeometry(b: Block): THREE.BufferGeometry {
  const [w, h, l] = sizeOf(b);
  const k = kOf(b);
  switch (b.t) {
    case 'box':
      return new THREE.BoxGeometry(w, h, l);
    case 'plate':
      return new THREE.BoxGeometry(w, PLATE_T, l);
    case 'rbox':
      return new RoundedBoxGeometry(w, h, l, 3, Math.min(w, h, l) * [0.12, 0.25, 0.45][Math.round(k) - 1]);
    case 'wedge': {
      // 前が低く、後ろが高い（向きは回転で変える）
      const s = new THREE.Shape();
      s.moveTo(l / 2, -h / 2);
      s.lineTo(-l / 2, -h / 2);
      s.lineTo(-l / 2, h / 2);
      s.closePath();
      return prism(s, w);
    }
    case 'trap': {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, -h / 2);
      s.lineTo(w / 2, -h / 2);
      s.lineTo((k * w) / 2, h / 2);
      s.lineTo((-k * w) / 2, h / 2);
      s.closePath();
      return extrudeZ(s, l);
    }
    case 'halfcyl': {
      const s = new THREE.Shape();
      s.moveTo(l / 2, -h / 2);
      halfEllipse(s, 0, -h / 2, l / 2, h, 0, Math.PI, false);
      s.closePath();
      return prism(s, w);
    }
    case 'harch': {
      const t = Math.min(k, l / 2 - 0.01, h - 0.01);
      const s = new THREE.Shape();
      s.moveTo(l / 2, -h / 2);
      halfEllipse(s, 0, -h / 2, l / 2, h, 0, Math.PI, false);
      s.lineTo(-(l / 2 - t), -h / 2);
      halfEllipse(s, 0, -h / 2, l / 2 - t, h - t, Math.PI, 0, true);
      s.closePath();
      return prism(s, w);
    }
    case 'qcyl': {
      // 前上の角が丸い
      const s = new THREE.Shape();
      s.moveTo(-l / 2, -h / 2);
      s.lineTo(l / 2, -h / 2);
      halfEllipse(s, -l / 2, -h / 2, l, h, 0, Math.PI / 2, false);
      s.closePath();
      return prism(s, w);
    }
    case 'cyl': {
      const s = new THREE.Shape();
      s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
      return extrudeZ(s, l);
    }
    case 'pipe': {
      const t = Math.min(k, w / 2 - 0.01, h / 2 - 0.01);
      const s = new THREE.Shape();
      s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
      const hole = new THREE.Path();
      hole.absellipse(0, 0, w / 2 - t, h / 2 - t, 0, Math.PI * 2, true, 0);
      s.holes.push(hole);
      return extrudeZ(s, l);
    }
    case 'cone': {
      // 後ろが太く、前が細い（k=前の太さの比率）
      const g = new THREE.CylinderGeometry(Math.max(0.001, k * 0.5), 0.5, 1, 18);
      g.rotateX(Math.PI / 2);
      g.scale(w, h, l);
      return g;
    }
    case 'dome': {
      const top = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const cap = new THREE.CircleGeometry(1, 18);
      cap.rotateX(Math.PI / 2);
      const g = mergeGeometries([top, cap])!;
      g.scale(w / 2, h, l / 2);
      g.translate(0, -h / 2, 0);
      return g;
    }
    case 'ring': {
      // 正面を向いた輪。太さ k、外径 w×h
      return ringGeometry(w, h, k);
    }
  }
}
// ドーナツ: 楕円の中心線にそって丸い断面を回す
function ringGeometry(w: number, h: number, k: number): THREE.BufferGeometry {
  const rx = Math.max(0.01, (w - k) / 2);
  const ry = Math.max(0.01, (h - k) / 2);
  const path = new THREE.EllipseCurve(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  const pts = path.getPoints(40).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts, true);
  return new THREE.TubeGeometry(curve, 40, k / 2, 8, true);
}

// ブロックの姿勢（ワールドへの行列）。左右対称の片割れは x を反転する
export function blockMatrix(b: Block, mirror = false): THREE.Matrix4 {
  const e = new THREE.Euler((b.r[0] * Math.PI) / 2 + ((b.a ?? 0) * Math.PI) / 180, (b.r[1] * Math.PI) / 2, (b.r[2] * Math.PI) / 2, 'YXZ');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.p), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
  if (mirror) m.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  return m;
}

// 点がブロックの中にあるか（ローカル座標）。干渉チェック用。形が単純なので式で判定する
export function insideLocal(b: Block, x: number, y: number, z: number): boolean {
  const [w, h, l] = sizeOf(b);
  const k = kOf(b);
  const inBox = Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2 && Math.abs(z) <= l / 2;
  const v = (y + h / 2) / h; // 0=底 1=上
  const ell = (a: number, b2: number) => a * a + b2 * b2 <= 1;
  switch (b.t) {
    case 'box':
    case 'rbox':
    case 'plate':
      return inBox;
    case 'wedge':
      return inBox && v <= (l / 2 - z) / l;
    case 'trap':
      return inBox && Math.abs(x) <= (w / 2) * (1 - (1 - k) * v);
    case 'halfcyl':
      return inBox && ell(z / (l / 2), v);
    case 'harch': {
      const t = Math.min(k, l / 2 - 0.01, h - 0.01);
      return inBox && ell(z / (l / 2), v) && !ell(z / (l / 2 - t), (y + h / 2) / (h - t));
    }
    case 'qcyl':
      return inBox && ell((z + l / 2) / l, v);
    case 'dome':
      return y >= -h / 2 && ell(Math.hypot(x / (w / 2), z / (l / 2)), v);
    case 'cyl':
      return Math.abs(z) <= l / 2 && ell(x / (w / 2), y / (h / 2));
    case 'pipe': {
      const t = Math.min(k, w / 2 - 0.01, h / 2 - 0.01);
      return Math.abs(z) <= l / 2 && ell(x / (w / 2), y / (h / 2)) && !ell(x / (w / 2 - t), y / (h / 2 - t));
    }
    case 'cone': {
      if (Math.abs(z) > l / 2) return false;
      const ratio = 1 + (k - 1) * (z / l + 0.5); // 後ろ=1、前=k
      return ell(x / ((w / 2) * ratio), y / ((h / 2) * ratio));
    }
    case 'ring': {
      // 中心線（楕円）からの距離が太さの半分以内
      const rx = (w - k) / 2;
      const ry = (h - k) / 2;
      const ang = Math.atan2(y / Math.max(ry, 1e-3), x / Math.max(rx, 1e-3));
      const d = Math.hypot(x - rx * Math.cos(ang), y - ry * Math.sin(ang), z);
      return d <= k / 2;
    }
  }
}

// ---- 色・メッシュ ----
export const colorHex = (c: BlockColor, paint: number) =>
  c === 'body' ? paint : c === 'dark' ? new THREE.Color(paint).multiplyScalar(0.45).getHex() : c === 'accent' ? 0xf2f2f2 : 0x1c1d20;

export function parseBody(json: unknown): BodyData | null {
  const d = json as BodyData;
  if (!d || d.v !== 1 || !Array.isArray(d.blocks)) return null;
  const blocks = d.blocks.filter((b) => b && b.t in BLOCKS && Array.isArray(b.p) && Array.isArray(b.s)).map((b) => normalize({ ...b, r: Array.isArray(b.r) ? b.r : [0, 0, 0] }));
  return { v: 1, name: String(d.name ?? 'マイボディ').slice(0, 20), line: (['edge', 'stream', 'balance'] as const).includes(d.line) ? d.line : 'balance', blocks };
}

// ---- 部位（パーツ）とボディの組立て（v2） ----
// 部位＝ブロックの小さなまとまり（フロントバンパー、ボンネットなど）。部位を作って保存し、ボディには部位を並べて大きさを変えて使う
export const PART_KINDS = [
  ['main', 'メインボディ'],
  ['frontBumper', 'フロントバンパー'],
  ['bonnet', 'ボンネット'],
  ['frontFender', 'フロントフェンダー'],
  ['sideFender', 'サイドフェンダー'],
  ['rearFender', 'リヤフェンダー'],
  ['rearBumper', 'リヤバンパー'],
  ['rearWing', 'リヤウイング'],
  ['cockpit', '運転席'],
  ['aeroFront', '変形フロント翼'],
  ['aeroRear', '変形リヤ翼'],
  ['other', 'その他'],
] as const;
export type PartKind = (typeof PART_KINDS)[number][0];
export const kindLabel = (k: PartKind) => PART_KINDS.find(([id]) => id === k)?.[1] ?? 'その他';
export const MAX_PART_BLOCKS = 20; // 1部位あたり
export const MAX_PER_KIND = 3; // 1ボディに同じ部位は3個まで
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.6;

export interface PartData {
  v: 1;
  id: string;
  name: string;
  kind: PartKind;
  blocks: Block[];
  after?: Block[]; // 変形部位だけ: 変形後の形（空なら変形前の形がそのまま動く）
}
// ボディに置いた部位。ブロックは写しを持つ（部位を後で直しても、置いたボディは変わらない）
export interface BodyItem {
  kind: PartKind;
  name: string;
  blocks: Block[];
  after?: Block[]; // 変形部位だけ: 変形後の形
  p: Vec3; // 作ったときの位置からのずれ
  sc: Vec3; // 幅・高さ・長さの倍率（部位の中心を基準に）
}
export interface BodyData2 {
  v: 2;
  name: string;
  line: BodyLine;
  items: BodyItem[];
}

export const isAeroKind = (k: PartKind) => k === 'aeroFront' || k === 'aeroRear';
const isKind = (k: unknown): k is PartKind => PART_KINDS.some(([id]) => id === k);
const vec = (v: unknown, def: number): Vec3 => (Array.isArray(v) && v.length === 3 ? (v.map((x) => Number(x) || def) as Vec3) : [def, def, def]);
const cleanBlocks = (bs: unknown): Block[] =>
  Array.isArray(bs) ? bs.filter((b) => b && b.t in BLOCKS && Array.isArray(b.p) && Array.isArray(b.s)).map((b) => normalize({ ...b, r: Array.isArray(b.r) ? b.r : [0, 0, 0] })) : [];

export function parsePart(json: unknown): PartData | null {
  const d = json as PartData;
  if (!d || d.v !== 1 || !Array.isArray(d.blocks)) return null;
  const p: PartData = { v: 1, id: String(d.id ?? Date.now()), name: String(d.name ?? '部位').slice(0, 16), kind: isKind(d.kind) ? d.kind : 'other', blocks: cleanBlocks(d.blocks).slice(0, MAX_PART_BLOCKS) };
  const after = cleanBlocks(d.after).slice(0, MAX_PART_BLOCKS);
  if (isAeroKind(p.kind) && after.length) p.after = after;
  return p;
}
// v1（ブロックの一覧だけ）も読めるようにし、1つの「その他」部位として扱う
export function parseBody2(json: unknown): BodyData2 | null {
  const d = json as { v?: number; name?: string; line?: BodyLine; items?: unknown[] };
  if (!d) return null;
  const line = (['edge', 'stream', 'balance'] as const).includes(d.line as BodyLine) ? (d.line as BodyLine) : 'balance';
  const name = String(d.name ?? 'マイボディ').slice(0, 20);
  if (d.v === 1) {
    const v1 = parseBody(d);
    return v1 && { v: 2, name, line, items: v1.blocks.length ? [{ kind: 'other', name: v1.name, blocks: v1.blocks, p: [0, 0, 0], sc: [1, 1, 1] }] : [] };
  }
  if (d.v !== 2 || !Array.isArray(d.items)) return null;
  const items = d.items.map((raw) => {
    const it = raw as BodyItem;
    const out = { kind: isKind(it?.kind) ? it.kind : 'other', name: String(it?.name ?? '部位').slice(0, 16), blocks: cleanBlocks(it?.blocks), p: vec(it?.p, 0), sc: vec(it?.sc, 1) } as BodyItem;
    const after = cleanBlocks(it?.after).slice(0, MAX_PART_BLOCKS);
    if (isAeroKind(out.kind) && after.length) out.after = after;
    return out;
  });
  return { v: 2, name, line, items };
}

// 部位の中心（大きさを変えるときの基準）。ブロックの外箱の中心
export function partCenter(blocks: Block[]): THREE.Vector3 {
  const box = new THREE.Box3();
  for (const b of blocks) {
    const [w, h, l] = sizeOf(b);
    const local = new THREE.Box3(new THREE.Vector3(-w / 2, -h / 2, -l / 2), new THREE.Vector3(w / 2, h / 2, l / 2));
    box.union(local.clone().applyMatrix4(blockMatrix(b)));
    if (isMirrored(b)) box.union(local.clone().applyMatrix4(blockMatrix(b, true)));
  }
  return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
}
export function itemMatrix(it: BodyItem, px = it.p[0]): THREE.Matrix4 {
  const c = partCenter(it.blocks);
  return new THREE.Matrix4()
    .makeTranslation(px + c.x, it.p[1] + c.y, it.p[2] + c.z)
    .multiply(new THREE.Matrix4().makeScale(...it.sc))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
}
// 左右対称のブロックを含む部位は、組立ての「左右」を左右の間隔として扱う。
// 右側を動かした分だけ左側は逆へ動き、いつでも左右対称のまま（中心線上のブロックは中心から動かない）
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
export const isSymItem = (it: { blocks: Block[] }) => it.blocks.some(isMirrored);
// 部位の中の1ブロックを車体の座標に置いた姿勢（左右対称なら2つ）。xSign は「左右」を増やしたときに動く向き
export function itemBlockMatrices(it: BodyItem, b: Block): { m: THREE.Matrix4; xSign: number }[] {
  if (!isSymItem(it)) {
    const im = itemMatrix(it);
    return (isMirrored(b) ? [false, true] : [false]).map((mir) => ({ m: blockMatrix(b, mir).premultiply(im), xSign: 1 }));
  }
  if (!isMirrored(b)) return [{ m: blockMatrix(b).premultiply(itemMatrix(it, 0)), xSign: 0 }];
  const s = Math.sign(b.p[0]);
  const m = blockMatrix(b).premultiply(itemMatrix(it, s * it.p[0]));
  return [{ m, xSign: s }, { m: m.clone().premultiply(MIRROR_X), xSign: -s }];
}
export const bodyBlockCount = (b: BodyData2) => b.items.reduce((n, it) => n + blockCount(it.blocks), 0);

// ---- 形から性能を測る（体積・前から見た面積・上から見た面積） ----
// 0.05m の格子点がどれかのブロックの中にあるかを数える。重なったブロックは1回だけ数える
export type BodyMetrics = { volume: number; front: number; top: number };
export function bodyMetrics(body: BodyData2, step = 0.05): BodyMetrics {
  const inst: { b: Block; inv: THREE.Matrix4; box: THREE.Box3 }[] = [];
  for (const it of body.items) {
    for (const b of it.blocks) {
      for (const { m } of itemBlockMatrices(it, b)) {
        const [w, h, l] = sizeOf(b);
        const box = new THREE.Box3(new THREE.Vector3(-w / 2, -h / 2, -l / 2), new THREE.Vector3(w / 2, h / 2, l / 2)).applyMatrix4(m);
        inst.push({ b, inv: m.clone().invert(), box });
      }
    }
  }
  const all = new THREE.Box3();
  for (const i of inst) all.union(i.box);
  if (all.isEmpty()) return { volume: 0, front: 0, top: 0 };
  const front = new Set<number>();
  const top = new Set<number>();
  let n = 0;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const nx = Math.ceil((all.max.x - all.min.x) / step);
  const ny = Math.ceil((all.max.y - all.min.y) / step);
  const nz = Math.ceil((all.max.z - all.min.z) / step);
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        p.set(all.min.x + (ix + 0.5) * step, all.min.y + (iy + 0.5) * step, all.min.z + (iz + 0.5) * step);
        for (const i of inst) {
          if (!i.box.containsPoint(p)) continue;
          q.copy(p).applyMatrix4(i.inv);
          if (insideLocal(i.b, q.x, q.y, q.z)) {
            n++;
            front.add(ix * 1000 + iy);
            top.add(ix * 1000 + iz);
            break;
          }
        }
      }
    }
  }
  return { volume: n * step ** 3, front: front.size * step ** 2, top: top.size * step ** 2 };
}
