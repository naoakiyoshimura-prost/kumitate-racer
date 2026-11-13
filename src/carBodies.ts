import * as THREE from 'three';

// 既製の6ボディの作り込んだ形（ローポリ・面の折れ目で光が切り替わるトゥーン寄り）。
// 方針は docs/CAR-DESIGN-20261111.md。色は「車体色＋黒い骨格＋差し色1つ」、風防は暗い半透明。
// 面はすべて頂点から組み、材質ごとに1つの geometry へまとめる（動く部品だけ別の geometry）。
// 前が +z、x は +が右、原点は路面。車軸の位置（AXLES）からタイヤハウスを作るので、6輪・8輪でも破綻しない。
//
// 空けておく場所（ブースター・ローラーなど既存の部品が載る所。ボディはここへ入れない）:
//   後端の中央  |x|<0.36, z<-0.76（マフラー・集合部）、z<-0.88 は高さ deckY+0.7 まで（大型シングル）
//   背中の後ろ  z -0.5〜-0.95 は deckY+0.48 より下（小型4連ポッドのレール）
//   タイヤ      車軸ごとに半径 r+すき間 の円の内側、x 0.48〜0.48+トレッド幅

type P2 = [number, number];
type V3 = [number, number, number];
type Axis = 'x' | 'y' | 'z';
type Key = 'body' | 'black' | 'accent' | 'glass' | 'lamp' | 'head';
type Station = { s: number; pts: P2[] };

// 共有の材質（車ごとに変わらないもの）
const BLACK = new THREE.MeshLambertMaterial({ color: 0x17191e });
const GLASS = new THREE.MeshLambertMaterial({ color: 0x0f1c28, emissive: 0x06121c, transparent: true, opacity: 0.84 });
// 車体色が黒いときは骨格をガンメタ、風防を少し明るい青にして、形が黒に沈まないようにする
const GUNMETAL = new THREE.MeshLambertMaterial({ color: 0x4a505b });
const GLASS_LIGHT = new THREE.MeshLambertMaterial({ color: 0x24425e, emissive: 0x0a1a2a, transparent: true, opacity: 0.86 });
// 前照灯（海外6台で使う。白く少し光る）
const HEAD = new THREE.MeshLambertMaterial({ color: 0xe6f2ff, emissive: 0x6f8fae });

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ease = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const area = (p: P2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};
// 折れ線の表（[z, 値]…、z は降順でも昇順でもよい）を z で読む
const tab = (t: [number, number][], z: number) => {
  const s = [...t].sort((a, b) => a[0] - b[0]);
  if (z <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (z <= s[i][0]) {
      const k = (z - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * k;
    }
  }
  return s[s.length - 1][1];
};
// 多角形を重心へ少し縮める（板の縁の面取り用）
const inset = (p: P2[], d: number): P2[] => {
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  return p.map(([x, y]) => {
    const dx = cx - x, dy = cy - y;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.min(d, len * 0.4);
    return [x + (dx / len) * m, y + (dy / len) * m];
  });
};
// 左右対称の断面: 右半分（下の中心→外→上の中心）から全周を作る
const full = (half: P2[]): P2[] => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as P2)];

// 三角形を材質ごとにためる。sweep = 断面を軸に沿ってつなぐ（断面の点の数はそろえる）
class Kit {
  readonly buf = new Map<Key, number[]>();
  private tri(key: Key, a: V3, b: V3, c: V3, flip: boolean) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-12) return; // つぶれた三角形は捨てる
    let arr = this.buf.get(key);
    if (!arr) this.buf.set(key, (arr = []));
    if (flip) arr.push(...a, ...c, ...b);
    else arr.push(...a, ...b, ...c);
  }
  sweep(key: Key, axis: Axis, stations: Station[], mirror = false, caps = true) {
    if (stations.length < 2) return;
    let best = 0;
    for (const s of stations) {
      const A = area(s.pts);
      if (Math.abs(A) > Math.abs(best)) best = A;
    }
    const st = stations.map((s) => ({ s: s.s, pts: best < 0 ? [...s.pts].reverse() : s.pts })).sort((a, b) => a.s - b.s);
    const n = st[0].pts.length;
    // 軸 x・y は左手系の並べ方になるので面を裏返す
    const hand = axis !== 'z';
    const map = (p: P2, s: number): V3 => (axis === 'z' ? [p[0], p[1], s] : axis === 'x' ? [s, p[1], p[0]] : [p[0], s, p[1]]);
    for (const m of mirror ? [1, -1] : [1]) {
      const M = (v: V3): V3 => [v[0] * m, v[1], v[2]];
      const flip = hand !== m < 0;
      for (let k = 0; k < st.length - 1; k++) {
        const s0 = st[k], s1 = st[k + 1];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const A = M(map(s0.pts[i], s0.s)), B = M(map(s0.pts[j], s0.s));
          const C = M(map(s1.pts[j], s1.s)), D = M(map(s1.pts[i], s1.s));
          this.tri(key, A, B, C, flip);
          this.tri(key, A, C, D, flip);
        }
      }
      if (!caps) continue;
      for (const [cap, end] of [[st[0], false], [st[st.length - 1], true]] as const) {
        if (Math.abs(area(cap.pts)) < 1e-7) continue;
        const faces = THREE.ShapeUtils.triangulateShape(cap.pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
        for (const f of faces) {
          const a = cap.pts[f[0]];
          let b = cap.pts[f[1]], c = cap.pts[f[2]];
          if (area([a, b, c]) > 0 !== end) [b, c] = [c, b];
          this.tri(key, M(map(a, cap.s)), M(map(b, cap.s)), M(map(c, cap.s)), flip);
        }
      }
    }
  }
  // 左右対称の胴（z 方向）。half は右半分の断面
  hull(key: Key, rows: { z: number; half: P2[] }[]) {
    this.sweep(key, 'z', rows.map((r) => ({ s: r.z, pts: full(r.half) })));
  }
  // 縁を面取りした板: 輪郭 prof を軸方向に s0〜s1 の厚みで押し出す
  plate(key: Key, axis: Axis, s0: number, s1: number, prof: P2[], bevel = 0.01, mirror = false) {
    const t = s1 - s0;
    const b = Math.min(bevel, t * 0.45);
    const st: Station[] =
      t <= 2.2 * b + 1e-4
        ? [{ s: s0, pts: inset(prof, b) }, { s: (s0 + s1) / 2, pts: prof }, { s: s1, pts: inset(prof, b) }]
        : [{ s: s0, pts: inset(prof, b) }, { s: s0 + b, pts: prof }, { s: s1 - b, pts: prof }, { s: s1, pts: inset(prof, b) }];
    this.sweep(key, axis, st, mirror);
  }
  box(key: Key, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, bevel = 0.012, mirror = false) {
    this.plate(key, 'z', Math.min(z0, z1), Math.max(z0, z1), [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], bevel, mirror);
  }
  // z 方向の多角柱（筒）。断面は n 角形
  tube(key: Key, x: number, y: number, rows: [number, number][], n = 8, mirror = false, rot = Math.PI / n) {
    const ring = (r: number): P2[] => Array.from({ length: n }, (_, i) => [x + Math.cos(rot + (i / n) * Math.PI * 2) * r, y + Math.sin(rot + (i / n) * Math.PI * 2) * r]);
    this.sweep(key, 'z', rows.map(([z, r]) => ({ s: z, pts: ring(r) })), mirror);
  }
  get triangles() {
    let n = 0;
    for (const a of this.buf.values()) n += a.length / 9;
    return n;
  }
  // 材質ごとに1つのメッシュへ。origin を原点にした座標で作る（動く部品の支点）
  meshes(mats: Record<Key, THREE.Material>, origin: V3 = [0, 0, 0]): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, arr] of this.buf) {
      if (!arr.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.translate(-origin[0], -origin[1], -origin[2]);
      g.computeVertexNormals(); // 頂点を共有しないので面ごとの法線＝折れ目で光が切り替わる
      out.push(new THREE.Mesh(g, mats[key]));
    }
    return out;
  }
}

export interface BodyCtx {
  color: number; // 選んだ車体色
  axles: [number, number][];
  treadW: number;
  deckY: number;
  tireR: number;
  boostKind: string;
  bodyMat: THREE.Material;
  accent: THREE.MeshLambertMaterial;
  tailMat: THREE.Material;
  numberMat: THREE.Material | null;
}
export interface DesignedBody {
  group: THREE.Group;
  setAero(a: number): void;
  bladeY: number; // マフラー型ブースターのブレードを載せる高さ（ボディの背中の上）
  canardY(z: number): number; // カナードを付けられる最低の高さ（フェンダーの上）
  triangles: number;
  // ブースターの取付（種類ごと。carModel.ts solveMount が読む）。無い種類は形から自動で密着させる
  mount?: Partial<Record<string, Mount>>;
  // 格納したブースターが出るときのカバーの動き（0=閉じて格納、1=開いてせり出した）
  onDeploy?(k: number): void;
  // 取付の高さを測るときに無視する可動部（伏せた翼・背びれなど。ブースターはその上に載せない）
  mountIgnore?: THREE.Object3D[];
}
// dx/dy/dz=自動で決めた位置からのずれ、s=大きさ、podX=2連ポッドの横位置（中心からの距離）、
// stow=[下げる量, 前へ引っ込める量]（格納。null で格納しない）、anchor=一緒に動く可動部、auto=false で自動の位置合わせをしない
export interface Mount {
  dx?: number; dy?: number; dz?: number; s?: number; podX?: number;
  stow?: [number, number] | null; noStow?: boolean; anchor?: THREE.Object3D; auto?: boolean;
  pads?: [number, number, number, number, number, number][];
}

// 車軸から出す寸法（どのボディでも使う）
type C = BodyCtx & {
  b: number; // ボディの底（シャーシ板の上）
  wxOut: number; // タイヤの外側の面
  frontEdge: number;
  rearEdge: number;
  rearAxle: number;
  rearR: number;
  frontAxle: number;
  gapF: number; // 前のタイヤ群の後ろの端
  gapR: number; // 後ろのタイヤ群の前の端
  noseShift: number; // 6輪・8輪で前のタイヤが前へ出ているぶん、ノーズを伸ばす量
  Z: (z: number) => number;
  arch: (z: number, gap?: number, poly?: boolean) => number;
  axF: [number, number];
  axR: [number, number];
  peak: (z: number, gap?: number, skin?: number) => number;
  mats: Record<Key, THREE.Material>;
};
function derive(ctx: BodyCtx): C {
  const zs = ctx.axles.map(([z]) => z);
  const frontEdge = Math.max(...ctx.axles.map(([z, r]) => z + r));
  const rearEdge = Math.min(...ctx.axles.map(([z, r]) => z - r));
  const rearAxle = Math.min(...zs);
  const rearR = ctx.axles.find(([z]) => z === rearAxle)![1];
  const front = ctx.axles.filter(([z]) => z > 0);
  const rear = ctx.axles.filter(([z]) => z <= 0);
  const gapF = front.length ? Math.min(...front.map(([z, r]) => z - r - 0.04)) : 0.3;
  const gapR = rear.length ? Math.max(...rear.map(([z, r]) => z + r + 0.04)) : -0.3;
  const noseShift = Math.max(0, frontEdge + 0.04 - 1.32);
  // タイヤの円の上端の高さ。poly=角ばったアーチ（上が平ら、45度で下がる。円より必ず外側）
  const arch = (z: number, gap = 0.035, poly = false) => {
    let y = -Infinity;
    for (const [za, r] of ctx.axles) {
      const R = r + gap;
      const d = Math.abs(z - za);
      if (poly) {
        if (d < 1.45 * R) y = Math.max(y, r + Math.min(R, 1.45 * R - d));
      } else if (d < R) y = Math.max(y, r + Math.sqrt(R * R - d * d));
    }
    return y;
  };
  return {
    ...ctx,
    b: ctx.deckY + 0.03,
    wxOut: 0.48 + ctx.treadW,
    frontEdge,
    rearEdge,
    rearAxle,
    rearR,
    frontAxle: Math.max(...zs),
    gapF,
    gapR,
    noseShift,
    Z: (z: number) => (z > 0.5 ? z + noseShift * clamp01((z - 0.5) / 0.8) : z),
    arch,
    // 前・後ろのタイヤ群の車軸の範囲 [最小, 最大]
    axF: front.length ? [Math.min(...front.map(([z]) => z)), Math.max(...front.map(([z]) => z))] : [0.72, 0.72],
    axR: rear.length ? [Math.min(...rear.map(([z]) => z)), Math.max(...rear.map(([z]) => z))] : [-0.72, -0.72],
    // z に一番近い車軸のタイヤの上端＋すき間＋厚み（フェンダーの平らな上面の高さ）
    peak: (z: number, gap = 0.035, skin = 0.035) => {
      const [, r] = ctx.axles.reduce((m, a) => (Math.abs(a[0] - z) < Math.abs(m[0] - z) ? a : m));
      return 2 * r + gap + skin;
    },
    mats: dark(ctx.color)
      ? { body: ctx.bodyMat, black: GUNMETAL, accent: ctx.accent, glass: GLASS_LIGHT, lamp: ctx.tailMat, head: HEAD }
      : { body: ctx.bodyMat, black: BLACK, accent: ctx.accent, glass: GLASS, lamp: ctx.tailMat, head: HEAD },
  };
}

// タイヤハウス・サイドポッド: z に沿って断面をつなぐ。車軸ごとのタイヤの円（半径 r+gap）を避ける。
//   over = タイヤの上をまたぐ（上面はタイヤの円＋skin まで持ち上がる）
//   cut  = タイヤに当たる所で切れる（オープンホイールの間を埋める板）
type PodOpt = {
  zMin: number;
  zMax: number;
  mode: 'over' | 'cut';
  bot: (z: number) => number;
  top: (z: number) => number;
  sec: (z: number, bot: number, top: number) => P2[];
  gap?: number;
  skin?: number;
  minT?: number;
  step?: number;
  mirror?: boolean;
  poly?: boolean;
  coarse?: boolean; // 丸いアーチの刻みを粗くする（海外6台。既存6台は従来どおり）
};
function pod(k: Kit, key: Key, c: C, o: PodOpt) {
  const gap = o.gap ?? 0.035;
  const skin = o.skin ?? 0.035;
  const minT = o.minT ?? 0.025;
  const step = o.step ?? 0.18;
  const ev = (z: number) => {
    const a = c.arch(z, gap, o.poly);
    const bot = Math.max(o.bot(z), a);
    let top = o.top(z);
    if (o.mode === 'over') top = Math.max(top, a + skin, bot + minT);
    return { bot, top, ok: top - bot >= minT - 1e-6 };
  };
  const zs: number[] = [o.zMin, o.zMax];
  for (let z = o.zMin; z < o.zMax; z += step) zs.push(z);
  // アーチの刻み（作り込み第2弾で細かくした。丸いアーチは縁の近くほど細かく）
  const fs = o.poly
    ? [-1.45, -1.2, -0.45, 0, 0.45, 1.2, 1.45]
    : o.coarse
      ? [-1, -0.96, -0.82, -0.58, -0.3, 0, 0.3, 0.58, 0.82, 0.96, 1]
      : [-1, -0.97, -0.9, -0.75, -0.52, -0.26, 0, 0.26, 0.52, 0.75, 0.9, 0.97, 1];
  for (const [za, r] of c.axles) for (const f of fs) zs.push(za + (r + gap) * f);
  const list = zs.filter((z) => z >= o.zMin - 1e-6 && z <= o.zMax + 1e-6).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > 0.006);
  const runs: Station[][] = [];
  let cur: Station[] = [];
  const push = (z: number, bot: number, top: number) => cur.push({ s: z, pts: o.sec(z, bot, Math.max(top, bot + minT)) });
  const edge = (za: number, zb: number) => {
    // ok だった za と だめな zb の境目を二分法で探す
    for (let i = 0; i < 14; i++) {
      const m = (za + zb) / 2;
      if (ev(m).ok) za = m;
      else zb = m;
    }
    return za;
  };
  let prev: { z: number; ok: boolean } | null = null;
  for (const z of list) {
    const e = ev(z);
    if (prev && prev.ok !== e.ok) {
      const zb = prev.ok ? edge(prev.z, z) : edge(z, prev.z);
      const eb = ev(zb);
      push(zb, eb.bot, eb.bot + minT);
      if (prev.ok) {
        runs.push(cur);
        cur = [];
      }
    }
    if (e.ok) push(z, e.bot, e.top);
    prev = { z, ok: e.ok };
  }
  runs.push(cur);
  for (const r of runs) k.sweep(key, 'z', simplify(r), o.mirror ?? true);
}
// 前後の断面のあいだを直線で結んだのとほぼ同じ断面は省く（形を変えずに三角形を減らす）
function simplify(st: Station[], tol = 0.006): Station[] {
  if (st.length < 3) return st;
  const out = [st[0]];
  for (let i = 1; i < st.length - 1; i++) {
    const a = out[out.length - 1], m = st[i], b = st[i + 1];
    const k = (m.s - a.s) / (b.s - a.s || 1);
    const off = m.pts.some((p, j) => Math.hypot(p[0] - (a.pts[j][0] + (b.pts[j][0] - a.pts[j][0]) * k), p[1] - (a.pts[j][1] + (b.pts[j][1] - a.pts[j][1]) * k)) > tol);
    if (off) out.push(m);
  }
  out.push(st[st.length - 1]);
  return out;
}

// 面の上に貼る細い帯（差し色のライン）: 点 p→q の面に沿って、外向き n へ少し浮かせる
const strip = (p: P2, q: P2, w = 0.006): P2[] => {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = dy / l, ny = -dx / l; // 時計回りの外向き（右側の断面で外＝+x 上向きになるよう呼ぶ側で順番を決める）
  return [p, q, [q[0] + nx * w, q[1] + ny * w], [p[0] + nx * w, p[1] + ny * w]];
};

// ── 作り込み用の小物（第2弾） ──
// 翼の断面（前縁が丸く後縁が細い。z が前、y が上、chord=弦長、th=厚み）。lead=前縁の z、y0=下面の高さ、aoa=迎角（後ろが上がる正）
const foil = (lead: number, y0: number, chord: number, th: number, aoa = 0): P2[] => {
  const pts: P2[] = [[0, 0.35], [0.04, 0.85], [0.18, 1], [0.5, 0.8], [0.88, 0.32], [1, 0.05], [0.9, 0], [0.5, -0.05], [0.12, 0], [0.02, 0.1]];
  const ca = Math.cos(aoa), sa = Math.sin(aoa);
  return pts.map(([u, v]) => [lead - u * chord * ca, y0 + v * th + u * chord * sa] as P2);
};
// 翼（x 方向に x0〜x1、断面 foil）。端は少し絞る。端板 plate=[前, 後, 下, 上]（翼の下面基準の高さ）を付けられる
function wingX(k: Kit, key: Key, x0: number, x1: number, prof: P2[], endKey: Key | null = null, plate: [number, number, number, number] | null = null, mirror = false) {
  const t = Math.min(0.015, (x1 - x0) * 0.1);
  k.sweep(key, 'x', [{ s: x0, pts: inset(prof, 0.006) }, { s: x0 + t, pts: prof }, { s: x1 - t, pts: prof }, { s: x1, pts: inset(prof, 0.006) }], mirror);
  if (endKey && plate) {
    const [zf, zb, yb, yt] = plate;
    for (const x of [x0, x1]) k.plate(endKey, 'x', x - 0.008, x + 0.008, [[zf, yb + 0.02], [zf - 0.03, yb], [zb, yb], [zb, yt], [zf + 0.01, yt - 0.04]], 0.004, mirror);
  }
}
// ディフューザー: 後ろの下の黒い床と縦のフィン（xs の位置）
function diffuser(k: Kit, zFace: number, xs: number[], y0: number, y1: number, depth = 0.16, key: Key = 'black', mirror = true) {
  for (const x of xs) k.plate(key, 'x', x - 0.006, x + 0.006, [[zFace + 0.02, y0], [zFace - depth, y0], [zFace - depth, y0 + (y1 - y0) * 0.55], [zFace + 0.02, y1]], 0, mirror);
}
// 灯火のユニット（後ろ・前の面に貼る）: 黒い縁＋光る中＋細い仕切り。dir=+1 前向き、-1 後ろ向き
function lampUnit(k: Kit, key: Key, z: number, dir: number, x0: number, x1: number, y0: number, y1: number, bars = 1, mirror = true) {
  const zo = z + dir * 0.004;
  facePlate(k, 'black', z - 0.006, z + 0.006, [[x0 - 0.012, y0 - 0.01], [x1 + 0.012, y0 - 0.01], [x1 + 0.012, y1 + 0.01], [x0 - 0.012, y1 + 0.01]], mirror);
  facePlate(k, key, zo - 0.006, zo + 0.006, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], mirror);
  for (let i = 1; i <= bars; i++) {
    const x = x0 + ((x1 - x0) * i) / (bars + 1);
    facePlate(k, 'black', zo - 0.008 * dir - 0.001, zo + 0.008, [[x - 0.004, y0], [x + 0.004, y0], [x + 0.004, y1], [x - 0.004, y1]], mirror);
  }
}
// 横の面のスリット（通気口）: n 本の斜めの黒い溝
function slits(k: Kit, x: number, z0: number, z1: number, y0: number, y1: number, n: number, lean = 0.03, mirror = true) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
    const w = Math.abs(z1 - z0) / n * 0.4;
    k.plate('black', 'x', x, x + 0.008, [[z + w / 2, y0], [z - w / 2, y0], [z - w / 2 - lean, y1], [z + w / 2 - lean, y1]], 0, mirror);
  }
}

// 動く部品のまとまり: 支点 pivot（車体座標）を原点にした Group を作る。parent があればその支点からの相対位置に置く
// local=true のときは Kit を支点からの相対座標で作ったものとして扱う
function rig(k: Kit, c: C, pivot: V3, parent?: { group: THREE.Group; pivot: V3 }, local = false) {
  const group = new THREE.Group();
  for (const m of k.meshes(c.mats, local ? [0, 0, 0] : pivot)) group.add(m);
  if (parent) {
    group.position.set(pivot[0] - parent.pivot[0], pivot[1] - parent.pivot[1], pivot[2] - parent.pivot[2]);
    parent.group.add(group);
  } else group.position.set(...pivot);
  return { group, pivot, tris: k.triangles };
}
// 伸び縮みする黒い支柱（高さ1の柱を scale.y で伸ばす）
function strut(c: C, w: number, d: number) {
  const g = new THREE.BoxGeometry(w, 1, d);
  g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, c.mats.black);
  m.visible = false;
  return m;
}
const numberPlate = (c: C, x: number, y: number, z: number, tilt = 0) => {
  if (!c.numberMat) return null;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), c.numberMat);
  m.position.set(x, y, z);
  m.rotation.set(0, Math.sign(x) * (Math.PI / 2), 0);
  m.rotateX(-tilt);
  return m;
};
function finish(c: C, k: Kit, extra: THREE.Object3D[], movers: { tris: number }[], plates: [number, number, number, number?][], parent?: { group: THREE.Group; pivot: V3 }) {
  const group = new THREE.Group();
  for (const m of k.meshes(c.mats)) group.add(m);
  for (const o of extra) group.add(o);
  for (const [x, y, z, t] of plates) {
    for (const s of [-1, 1]) {
      const p = numberPlate(c, s * x, y, z, t ?? 0);
      if (!p) continue;
      if (parent) {
        p.position.sub(new THREE.Vector3(...parent.pivot));
        parent.group.add(p);
      } else group.add(p);
    }
  }
  return { group, tris: k.triangles + movers.reduce((s, m) => s + m.tris, 0) };
}

// ───────────────────────── スライダー: 翡翠の刃（折り紙のような鋭い面） ─────────────────────────
// 低い楔形。矢じり形のノーズ、中央に黒い谷、左右に立つ2枚の尾びれ。
// エアロ: 尾びれが支柱で持ち上がって内側へ倒れ、左右の先が中央で合わさって1枚の水平の翼になる（車幅の内側）。
// ノーズ両脇の小翼が開く。大型シングルは谷に沈めて格納し、ブーストで後ろへせり出す
function slider(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  // 矢じりのノーズ（中央の稜線が立つ。稜線の両脇に面取りを1段）
  k.hull('body', [
    [1.34, 0.025, 0.012, 0.02, 0.05],
    [1.24, 0.1, 0.0, 0.035, 0.1],
    [1.14, 0.16, 0.0, 0.05, 0.15],
    [0.88, 0.27, 0.0, 0.08, 0.25],
    [0.6, 0.3, 0.0, 0.1, 0.3],
    [0.32, 0.22, 0.02, 0.08, 0.2],
  ].map(([z, w, y0, e, yr]) => ({ z: Z(z), half: [[0, b + y0], [w, b + y0], [w, b + y0 + e], [w * 0.72, b + y0 + e + (yr - e - y0) * 0.45], [w * 0.4, b + yr - 0.025], [w * 0.12, b + yr - 0.004], [0, b + yr]] as P2[] })));
  // ノーズ先端の黒い段（鼻先の下）と前の黒いスプリッター（差し色の縁）
  k.hull('black', [[1.37, 0.06, 0.03], [1.2, 0.18, 0.03], [0.98, 0.26, 0.025]].map(([z, w, t]) => ({ z: Z(z), half: [[0, b - 0.035], [w, b - 0.035], [w, b - 0.035 + t], [0, b - 0.035 + t]] as P2[] })));
  k.plate('accent', 'y', b - 0.04, b - 0.032, [[0.06, Z(1.38)], [0.2, Z(1.22)], [0.3, Z(1.0)], [0.27, Z(0.98)], [0.17, Z(1.2)], [0.04, Z(1.355)]], 0, true);
  // 細い目（ノーズの面に沿う斜めの前照灯）
  {
    const z = Z(1.1);
    k.plate('head', 'y', b + 0.05, b + 0.058, [[0.12, z + 0.08], [0.2, z - 0.02], [0.22, z - 0.06], [0.14, z + 0.04]], 0, true);
  }
  // 中央の黒い谷（ノーズの後ろから後端まで）。谷底に細い溝を2本
  k.hull('black', [
    [0.66, 0.16, 0.14, 0.11],
    [0.3, 0.22, 0.24, 0.2],
    [-0.5, 0.22, 0.24, 0.2],
    [-0.78, 0.2, 0.2, 0.16],
  ].map(([z, w, ys, yc]) => ({ z, half: [[0, b], [w, b], [w, b + ys], [w * 0.55, b + yc + (ys - yc) * 0.3], [0, b + yc]] as P2[] })));
  // 左右の肩（稜線を立てた折り紙の面。外の縁に面取り）
  const sh = (z: number, xi: number, xo: number, y0: number, yS: number, xr: number, yR: number, yI: number) => ({
    s: z,
    pts: [[xi, b + y0], [xo - 0.03, b + y0], [xo, b + y0 + 0.05], [xo, b + yS - 0.03], [xo - 0.015, b + yS], [(xo + xr) / 2, b + (yS + yR) / 2 + 0.012], [xr, b + yR], [xr - 0.04, b + yR - 0.01], [xi, b + yI]] as P2[],
  });
  k.sweep('body', 'z', [
    sh(Z(1.08), 0.15, 0.22, 0.02, 0.06, 0.19, 0.09, 0.06),
    sh(Z(0.94), 0.17, 0.34, 0.03, 0.12, 0.27, 0.2, 0.14),
    sh(Z(0.8), 0.19, 0.43, 0.04, 0.16, 0.33, 0.3, 0.2),
    sh(0.3, 0.2, 0.46, 0.06, 0.2, 0.35, 0.4, 0.27),
    sh(-0.3, 0.2, 0.46, 0.06, 0.2, 0.36, 0.4, 0.27),
    sh(-0.7, 0.22, 0.46, 0.06, 0.17, 0.37, 0.31, 0.23),
    sh(-0.88, 0.31, 0.46, 0.06, 0.14, 0.39, 0.25, 0.19),
  ], true);
  // 肩の上の吸気口（黒い切れ込み、風防の横）
  k.sweep('black', 'z', [0.28, 0.02, -0.16].map((z, i) => ({ s: z, pts: [[0.36, b + 0.395], [0.43, b + 0.29 - i * 0.004], [0.44, b + 0.3 - i * 0.004], [0.37, b + 0.405]] as P2[] })), true);
  // 肩の下の黒い面（横から見たときの黒い切れ込み）
  k.sweep('black', 'z', [0.75, 0.2, -0.86].map((z) => ({ s: z, pts: [[0.3, b - 0.03], [0.41, b - 0.03], [0.455, b + 0.02], [0.455, b + 0.075], [0.3, b + 0.075]] as P2[] })), true);
  // 肩の差し色（稜線の金のライン）
  k.sweep('accent', 'z', [Z(0.8), 0.3, -0.3, -0.7].map((z, i) => {
    const R: P2 = [[0.33, 0.35, 0.36, 0.37][i], b + [0.3, 0.4, 0.4, 0.31][i]];
    const S: P2 = [[0.42, 0.45, 0.45, 0.45][i], b + [0.16, 0.2, 0.2, 0.17][i]];
    const L = (u: number): P2 => [S[0] + (R[0] - S[0]) * u, S[1] + (R[1] - S[1]) * u];
    return { s: z, pts: strip(L(0.62), L(0.92), 0.007) };
  }), true);
  // 風防（低い、折れ目を2本）と後ろのロールフープ
  k.hull('glass', [
    [0.4, 0.03, 0.22],
    [0.3, 0.12, 0.33],
    [0.16, 0.17, 0.42],
    [-0.12, 0.18, 0.42],
    [-0.34, 0.1, 0.27],
  ].map(([z, w, t]) => ({ z, half: [[0, b + 0.19], [w, b + 0.19], [w * 0.85, b + t - 0.09], [w * 0.55, b + t - 0.025], [0, b + t]] as P2[] })));
  k.hull('body', [[-0.26, 0.08, 0.36], [-0.36, 0.1, 0.34], [-0.52, 0.06, 0.26]].map(([z, w, t]) => ({ z, half: [[0, b + 0.2], [w, b + 0.2], [w, b + t - 0.04], [w * 0.5, b + t], [0, b + t + 0.004]] as P2[] })));
  k.box('black', -0.05, 0.05, b + 0.3, b + 0.345, -0.32, -0.38, 0.006); // フープの吸気口
  // テールランプ（肩の後ろの面、縁と仕切りつき）とディフューザーのフィン
  lampUnit(k, 'lamp', -0.885, -1, 0.33, 0.44, b + 0.115, b + 0.165, 1);
  diffuser(k, -0.86, [0.33, 0.395], b - 0.035, b + 0.07, 0.12);
  // 車軸の間の横の刃（後ろへ跳ね上がる面。タイヤに当たる所で切れる）。上に3本のスリット
  pod(k, 'body', c, {
    zMin: c.gapR - 0.1, zMax: c.gapF + 0.1, mode: 'cut', gap: 0.03,
    bot: () => b - 0.035,
    top: (z) => b + tab([[c.gapF + 0.1, 0.06], [c.gapR - 0.1, 0.2]], z),
    sec: (_z, bot, t) => [[0.44, bot], [0.53, bot], [0.58, bot + (t - bot) * 0.22], [0.6, bot + (t - bot) * 0.42], [0.56, t - 0.008], [0.5, t], [0.44, t]],
  });
  if (c.gapF - c.gapR > 0.4) slits(k, 0.6, c.gapF - 0.1, c.gapF - 0.34, b - 0.01, b + 0.04, 3, 0.02);

  // 尾びれ（左右）: 外側の付け根の線（z 方向）を軸に内側へ倒れる。高さは倒したとき先が中央で合わさる長さ
  const finX = 0.463;
  const finY = b + 0.13;
  const fh = finX - 0.012; // 倒したときの翼の半幅
  // 尾びれの付け根（肩の上に立つ台座）
  k.plate('black', 'x', finX - 0.024, finX + 0.024, [[-0.3, finY - 0.02], [-0.99, finY - 0.02], [-0.99, finY + 0.012], [-0.32, finY + 0.012]], 0.006, true);
  const fins = [-1, 1].map((side) => {
    const f = new Kit();
    const prof: P2[] = [[-0.3, finY], [-0.98, finY], [-1.06, finY + fh], [-0.94, finY + fh - 0.06], [-0.64, finY + fh * 0.42]];
    // 厚みのある尾びれ（中央が厚い2段の断面）
    f.sweep('body', 'x', [
      { s: finX - 0.016, pts: inset(prof, 0.012) },
      { s: finX - 0.008, pts: inset(prof, 0.003) },
      { s: finX + 0.008, pts: inset(prof, 0.003) },
      { s: finX + 0.016, pts: inset(prof, 0.012) },
    ]);
    f.plate('accent', 'x', finX - 0.018, finX + 0.018, [[-0.95, finY + 0.03], [-0.99, finY + 0.03], [-1.065, finY + fh], [-1.025, finY + fh - 0.04]], 0.005);
    // 前縁の差し色（倒したとき翼の前縁になる）
    f.plate('accent', 'x', finX - 0.019, finX + 0.019, [[-0.3, finY + 0.005], [-0.34, finY + 0.005], [-0.655, finY + fh * 0.42], [-0.635, finY + fh * 0.42]], 0.004);
    if (side < 0) flipKitX(f);
    return { ...rig(f, c, [side * finX, finY, 0]), side };
  });
  // 尾びれの支柱（持ち上がるときに見える）
  const stays = strutSet(c, [-1, 1].flatMap((side) => [-0.45, -0.85].map((z) => [side * finX, z] as [number, number])), 0.03, 0.05);
  stays.position.y = finY - 0.02;
  // 翼の高さ: 後輪より上。大型シングル・4連ポッドのときはその上を越える
  const wingY = c.boostKind === 'single' ? b + 0.6 : c.boostKind === 'pod4' ? b + 0.84 : Math.max(b + 0.42, 2 * c.rearR + 0.08);
  const finLift = Math.max(0.12, wingY - finY);
  // ノーズ両脇の小翼: 前寄りの付け根で開く（閉じているときはノーズに沿って後ろ向き）。厚みと端板つき
  const wz = Z(1.13);
  const tireAt = c.axles.some(([za, r]) => wz - 0.2 < za + r + 0.03 && wz + 0.05 > za - r - 0.03);
  const span = tireAt ? 0.26 : 0.38;
  const wings = [-1, 1].map((side) => {
    const w = new Kit();
    w.plate('accent', 'y', b + 0.03, b + 0.058, [[0.17, wz + 0.03], [0.17, wz - 0.1], [0.17 + span, wz - 0.17], [0.17 + span, wz - 0.11]], 0.008);
    w.plate('accent', 'x', 0.16 + span, 0.176 + span, [[wz - 0.1, b + 0.02], [wz - 0.18, b + 0.02], [wz - 0.18, b + 0.085], [wz - 0.12, b + 0.075]], 0.004);
    if (side < 0) flipKitX(w);
    return { ...rig(w, c, [side * 0.17, b + 0.045, wz]), side };
  });
  const { group, tris } = finish(c, k, [...fins.map((f) => f.group), stays, ...wings.map((w) => w.group)], [...fins, ...wings], [[0.474, b + 0.17, -0.12, 0.12]]);
  const setAero = (a: number) => {
    const lift = ease(a * 1.7) * finLift;
    const fold = ease((a - 0.3) / 0.7);
    for (const f of fins) {
      f.group.position.y = finY + lift;
      f.group.rotation.z = f.side * (Math.PI / 2) * fold; // 内側へ倒れる
    }
    stays.visible = lift > 0.005;
    stays.scale.y = Math.max(0.001, lift + 0.02);
    for (const w of wings) w.group.rotation.y = w.side * (1.3 - 1.5 * ease(a));
  };
  setAero(0);
  return {
    group, setAero, bladeY: b + 0.31, canardY: () => 0, triangles: tris,
    // 大型シングルは黒い谷に沈めて格納（ブーストで持ち上がりながら後ろへ出る）
    mount: { single: { stow: [-0.1, 0.22] } },
    mountIgnore: fins.map((f) => f.group),
  };
}

// Kit の中身を左右反転（左側の部品を右側の形から作る）
function flipKitX(k: Kit) {
  for (const arr of k.buf.values()) {
    for (let i = 0; i < arr.length; i += 9) {
      arr[i] = -arr[i];
      arr[i + 3] = -arr[i + 3];
      arr[i + 6] = -arr[i + 6];
      // 面の向きを戻す（2つ目と3つ目の頂点を入れ替え）
      for (let j = 0; j < 3; j++) [arr[i + 3 + j], arr[i + 6 + j]] = [arr[i + 6 + j], arr[i + 3 + j]];
    }
  }
}

// ───────────────────────── ツインバーナー: 働き蜂（重機の腕） ─────────────────────────
// 丸みのある前半（中央の黄色い舳先と黒い脇）、背中に腕で支えた2連の筒、白い板。
// エアロ: 腕が起きて筒が持ち上がり前上がりに、筒の外の白い安定板が左右へ開く
function twin(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const round = (w: number, y0: number, yS: number, yC: number): P2[] => [
    [0, b + y0], [w, b + y0], [w, b + yS], [w * 0.86, b + yS + (yC - yS) * 0.55], [w * 0.5, b + yC - 0.008], [0, b + yC],
  ];
  // 中央の舳先（丸く盛り上がる）
  k.hull('body', [
    [1.32, 0.09, 0.0, 0.03, 0.06],
    [1.12, 0.19, 0.0, 0.1, 0.17],
    [0.82, 0.22, 0.0, 0.18, 0.29],
    [0.5, 0.24, 0.0, 0.24, 0.34],
  ].map(([z, w, y0, yS, yC]) => ({ z: Z(z), half: round(w, y0, yS, yC) })));
  // 胴（キャビンから後端）
  k.hull('body', [
    [0.72, 0.3, 0.02, 0.12, 0.26],
    [0.42, 0.44, 0.0, 0.2, 0.34],
    [-0.1, 0.445, 0.0, 0.22, 0.36],
    [-0.5, 0.44, 0.0, 0.2, 0.32],
    [-0.77, 0.4, 0.0, 0.17, 0.27],
  ].map(([z, w, y0, yS, yC]) => ({ z, half: round(w, y0, yS, yC) })));
  // ノーズの黒い脇（舳先の左右の一段低い面）
  k.sweep('black', 'z', [
    [Z(1.24), 0.08, 0.13, 0.03],
    [Z(1.0), 0.17, 0.36, 0.07],
    [0.62, 0.2, 0.43, 0.1],
  ].map(([z, xi, xo, h]) => ({ s: z, pts: [[xi, b - 0.01], [xo, b - 0.01], [xo, b + h * 0.6], [xo - 0.04, b + h], [xi, b + h + 0.03]] as P2[] })), true);
  // 下まわりの黒いスカート
  k.sweep('black', 'z', [0.5, -0.77].map((z) => ({ s: z, pts: [[0.3, b - 0.03], [0.43, b - 0.03], [0.452, b + 0.02], [0.452, b + 0.06], [0.3, b + 0.06]] as P2[] })), true);
  // 横の白い板（斜めの平行四辺形）
  k.plate('accent', 'x', 0.443, 0.458, [[0.36, b + 0.07], [0.08, b + 0.07], [-0.3, b + 0.17], [0.02, b + 0.17]], 0.005, true);
  k.plate('accent', 'x', 0.443, 0.458, [[-0.36, b + 0.07], [-0.5, b + 0.07], [-0.7, b + 0.15], [-0.56, b + 0.15]], 0.005, true);
  // 風防
  k.hull('glass', [
    [0.66, 0.06, 0.33],
    [0.5, 0.18, 0.47],
    [0.24, 0.19, 0.5],
    [0.1, 0.12, 0.4],
  ].map(([z, w, t]) => ({ z, half: [[0, b + 0.28], [w, b + 0.28], [w * 0.8, b + t - 0.06], [w * 0.4, b + t - 0.01], [0, b + t]] as P2[] })));
  k.box('lamp', 0.24, 0.36, b + 0.12, b + 0.17, -0.785, -0.768, 0.004, true);
  // 前輪の上の小さなフェンダー（オープンホイールのまま、上だけ覆う）
  for (const [za, r] of c.axles) {
    if (za <= 0) continue;
    const R = r + 0.035;
    const xo = Math.min(0.88, c.wxOut + 0.02);
    pod(k, 'body', c, {
      zMin: za - R * 0.45, zMax: za + R + 0.05, mode: 'over', gap: 0.035, skin: 0.03,
      bot: () => r + 0.06, top: () => r + 0.09,
      sec: (_z, bot, t) => [[0.44, bot], [xo, bot], [xo, t - 0.02], [xo - 0.06, t], [0.44, t - 0.01]],
    });
    k.plate('accent', 'x', xo - 0.004, xo + 0.008, [[za + R * 0.2, 2 * r + 0.04], [za - R * 0.4, 2 * r + 0.02], [za - R * 0.4, 2 * r + 0.07], [za + R * 0.2, 2 * r + 0.075]], 0.003, true);
  }

  // ── 作り込み: 顔と後ろ ──
  // 舳先の黒い口と細い目、前の黒いスプリッター（白い縁）、後ろのランプの縁・ディフューザー・下の黒い段
  facePlate(k, 'black', Z(1.32) - 0.006, Z(1.32) + 0.006, [[0, b + 0.012], [0.07, b + 0.012], [0.08, b + 0.04], [0, b + 0.05]]);
  k.plate('head', 'y', b + 0.072, b + 0.08, [[0.1, Z(1.2)], [0.17, Z(1.12)], [0.19, Z(1.06)], [0.12, Z(1.15)]], 0, true);
  k.hull('black', [[Z(1.36), 0.12, 0.012], [Z(1.16), 0.3, 0.012], [Z(0.96), 0.4, 0.012]].map(([z, w, t]) => ({ z, half: [[0, b - 0.045], [w, b - 0.045], [w, b - 0.045 + t], [0, b - 0.045 + t]] as P2[] })));
  k.plate('accent', 'y', b - 0.046, b - 0.03, [[0.1, Z(1.365)], [0.29, Z(1.17)], [0.41, Z(0.97)], [0.38, Z(0.955)], [0.27, Z(1.16)], [0.08, Z(1.35)]], 0, true);
  lampUnit(k, 'lamp', -0.776, -1, 0.24, 0.36, b + 0.12, b + 0.17, 1);
  diffuser(k, -0.77, [0.1, 0.3, 0.4], b - 0.035, b + 0.07, 0.14);
  facePlate(k, 'black', -0.785, -0.772, [[0, b - 0.03], [0.4, b - 0.03], [0.4, b + 0.06], [0, b + 0.06]]);
  // 胴の肩の黒い吸気口（キャビンの後ろ）
  k.sweep('black', 'z', [0.0, -0.28].map((z) => ({ s: z, pts: [[0.3, b + 0.31], [0.38, b + 0.27], [0.4, b + 0.29], [0.32, b + 0.335]] as P2[] })), true);

  // 背中の2連の筒（腕の先）。腕は後ろの付け根を軸に起きる。大型2連ポッドのときは筒の代わりにポッドを腕に載せる
  const pv: V3 = [0, b + 0.33, -0.42];
  const r = new Kit();
  const nx = 0.25, ny = b + 0.52;
  const p2 = c.boostKind === 'pod2';
  if (!p2) {
    r.tube('body', nx, ny, [[-0.465, 0.095], [-0.43, 0.125], [-0.4, 0.135], [-0.1, 0.14], [-0.04, 0.135], [0.0, 0.115]], 12, true);
    r.tube('black', nx, ny, [[0.0, 0.105], [0.022, 0.09]], 12, true); // 前の吸気口
    r.tube('black', nx, ny, [[-0.505, 0.075], [-0.46, 0.09]], 12, true); // 後ろの噴射口
    r.tube('accent', nx, ny, [[-0.3, 0.145], [-0.25, 0.145]], 12, true); // 白い帯
    r.tube('accent', nx, ny, [[-0.06, 0.141], [-0.045, 0.141]], 12, true);
    r.tube('body', nx, ny, [[0.005, 0.03], [0.03, 0.05], [0.045, 0.02]], 6, true); // 吸気口の中心の円錐
  }
  // 腕（筒と胴をつなぐ黒い板）。下は胴の中まで伸ばし、持ち上がっても胴から離れない
  r.box('black', nx - 0.03, nx + 0.03, b + 0.12, ny - 0.1, -0.36, -0.14, 0.008, true);
  r.box('black', nx - 0.045, nx + 0.045, ny - 0.13, ny - 0.09, -0.4, -0.1, 0.006, true); // 筒（ポッド）を受ける鞍
  const rg = rig(r, c, pv);
  // 白い安定板（筒の外上、z 方向の軸で外へ開く）
  const stabs = [-1, 1].map((side) => {
    const s = new Kit();
    s.plate('accent', 'x', nx + 0.075, nx + 0.09, [[-0.06, ny + 0.09], [-0.36, ny + 0.09], [-0.42, ny + 0.28], [-0.26, ny + 0.24]], 0.005);
    if (side < 0) flipKitX(s);
    return { ...rig(s, c, [side * (nx + 0.082), ny + 0.09, 0], rg), side };
  });
  const { group, tris } = finish(c, k, [rg.group], [rg, ...stabs], [[0.455, b + 0.24, -0.3, 0.25]]);
  // 大型2連ポッドは背中の腕の鞍に載せ、腕と一緒に持ち上がる
  const podMount = { anchor: rg.group, podX: nx, auto: false, dy: ny - (2 * c.rearR + 0.16), dz: -0.24 - (c.rearAxle + 0.05) };
  const setAero = (a: number) => {
    const e = ease(a);
    rg.group.position.y = pv[1] + 0.13 * e;
    rg.group.rotation.x = -0.3 * e;
    for (const s of stabs) s.group.rotation.z = -s.side * 1.15 * ease((a - 0.2) / 0.8);
  };
  setAero(0);
  return { group, setAero, bladeY: b + 0.34, canardY: (z) => (z > 0 ? c.arch(z) + 0.08 : 0), triangles: tris, mount: { pod2: podMount } };
}

// ───────────────────────── タイフーン: 波（一筆書きの曲面） ─────────────────────────
// 前から後ろへ流れる稜線、えぐれた脇腹、後端と一体の跳ね上げ。フルカウル（タイヤの上半分の外側まで覆う）。
// エアロ: 跳ね上げが支柱で立ち上がり幅も広がって大きな翼に。脇腹の板が外へ開いて空気の通り道（黒）が見える
function cyclone(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  // 中央の胴（流れる稜線）
  k.hull('body', [
    [1.34, 0.2, 0.0, 0.03, 0.05, 0.06],
    [1.05, 0.34, 0.0, 0.09, 0.16, 0.2],
    [0.65, 0.4, 0.0, 0.14, 0.25, 0.32],
    [0.2, 0.4, 0.0, 0.16, 0.29, 0.37],
    [-0.3, 0.4, 0.0, 0.16, 0.3, 0.38],
    [-0.77, 0.38, 0.0, 0.14, 0.28, 0.34],
  ].map(([z, w, y0, yS, yM, yC]) => ({ z: Z(z), half: [[0, b + y0], [w, b + y0], [w, b + yS], [w * 0.62, b + yM], [0, b + yC]] as P2[] })));
  // フェンダーと脇腹: タイヤのまわりは外へふくらみ、車軸の間はえぐれる
  const xMax = Math.min(0.9, c.wxOut + 0.035);
  const xScoop = 0.5;
  const infl = (z: number) => Math.max(0, ...c.axles.map(([za, r]) => ease(1 - (Math.abs(z - za) - (r + 0.035) * 0.8) / 0.24)));
  const xOut = (z: number) => xScoop + (xMax - xScoop) * infl(z);
  const zMax = Math.max(Z(1.16), c.frontEdge + 0.05);
  const zMin = Math.min(-1.08, c.rearEdge - 0.05);
  const xm = c.wxOut + 0.008;
  // 上面の線: タイヤの上は平らに伸ばし（円に沿わせない）、ノーズへ流れ落ち、車軸の間でくぼむ
  const pF = c.peak(c.axF[1], 0.03, 0.035);
  const pR = c.peak(c.axR[0], 0.03, 0.035);
  const top = (z: number) =>
    tab([[zMax, pF - 0.19], [c.axF[1] + 0.16, pF], [c.axF[0] - 0.08, pF - 0.01], [(c.gapF + c.gapR) / 2, b + 0.2], [c.axR[1] + 0.08, pR], [c.axR[0] - 0.14, pR + 0.01], [zMin, pR - 0.04]], z);
  const podTop = (z: number) => Math.max(top(z), c.arch(z, 0.03) + 0.035);
  const sec = (z: number, bot: number, t: number): P2[] => {
    const xo = xOut(z);
    const xmm = Math.min(xm, xo - 0.04);
    const lip = Math.min(bot, Math.max(b - 0.02, c.tireR * 1.22));
    const ch = Math.min(0.1, (t - lip) * 0.45);
    return [[0.36, bot], [xmm, bot], [xmm, lip], [xo - 0.03, lip], [xo, lip + 0.04], [xo, t - ch * 0.7], [xo - ch, t], [0.36, t - 0.01]];
  };
  pod(k, 'body', c, { zMin, zMax, mode: 'over', bot: () => b - 0.02, top, sec, skin: 0.035, gap: 0.03 });
  // 差し色のライン: フェンダーの肩の折れ目に沿う細い帯（前のタイヤから前へ）
  const lineZs = [zMax - 0.03, (zMax + c.frontAxle) / 2, c.frontAxle, c.frontAxle - 0.2];
  k.sweep('accent', 'z', lineZs.map((z) => {
    const t = podTop(z);
    const xo = xOut(z);
    const ch = Math.min(0.1, (t - Math.max(b - 0.02, c.tireR * 1.22)) * 0.45);
    const P = (u: number): P2 => [xo - ch * u, t - ch * 0.7 + ch * 0.7 * u];
    return { s: z, pts: strip(P(0.08), P(0.6), 0.008) };
  }), true);
  // 脇腹の黒い通り道（車軸の間）
  const scoop = c.gapF - c.gapR > 0.18;
  const sz0 = c.gapR + 0.02, sz1 = c.gapF - 0.02;
  if (scoop) {
    k.sweep('black', 'z', [sz0, sz1].map((z) => ({ s: z, pts: [[0.42, b - 0.01], [xScoop + 0.03, b - 0.01], [xScoop + 0.03, b + 0.1], [xScoop - 0.01, b + 0.15], [0.42, b + 0.15]] as P2[] })), true);
  }
  // 後ろの黒いディフューザー（中央は空ける）
  k.box('black', 0.36, Math.min(0.7, c.wxOut), b - 0.03, b + 0.06, zMin + 0.02, -0.7, 0.01, true);
  // 風防（長い涙形）
  k.hull('glass', [
    [0.64, 0.05, 0.36],
    [0.42, 0.2, 0.52],
    [0.07, 0.23, 0.58],
    [-0.25, 0.2, 0.53],
    [-0.46, 0.08, 0.4],
  ].map(([z, w, t]) => ({ z, half: [[0, b + 0.3], [w, b + 0.3], [w * 0.85, b + t - 0.09], [w * 0.45, b + t - 0.015], [0, b + t]] as P2[] })));
  k.box('lamp', 0.2, 0.34, b + 0.2, b + 0.25, -0.785, -0.768, 0.004, true);
  // ── 作り込み: 顔と後ろ ──
  // 前: フェンダーの先の細い前照灯（縁つき）、ノーズの下の黒いスプリッターと差し色の縁、鼻先の左右の吸気口
  {
    const fz = zMax;
    const ty = pF - 0.19;
    lampUnit(k, 'head', fz + 0.004, 1, xMax - 0.24, xMax - 0.07, ty - 0.075, ty - 0.045, 0);
    facePlate(k, 'black', fz - 0.004, fz + 0.012, [[0.42, b - 0.015], [xMax - 0.06, b - 0.015], [xMax - 0.06, b + 0.05], [0.44, b + 0.07]]);
    for (const x of [0.52, 0.6, 0.68]) facePlate(k, 'body', fz + 0.01, fz + 0.016, [[x - 0.006, b - 0.01], [x + 0.006, b - 0.01], [x + 0.006, b + 0.055], [x - 0.006, b + 0.055]]);
    k.hull('black', [[Z(1.4), 0.16, 0.012], [Z(1.24), 0.3, 0.012], [Z(1.06), 0.38, 0.012]].map(([z, w, t]) => ({ z, half: [[0, b - 0.045], [w, b - 0.045], [w, b - 0.045 + t], [0, b - 0.045 + t]] as P2[] })));
    k.plate('accent', 'y', b - 0.046, b - 0.03, [[0.14, Z(1.405)], [0.32, Z(1.25)], [0.4, Z(1.07)], [0.37, Z(1.06)], [0.29, Z(1.24)], [0.12, Z(1.39)]], 0, true);
    facePlate(k, 'black', Z(1.34) - 0.004, Z(1.34) + 0.006, [[0.05, b + 0.01], [0.17, b + 0.01], [0.16, b + 0.04], [0.06, b + 0.045]]);
  }
  // 後ろ: フェンダーの後ろの面を折る（上に黒い通気口、横長のランプ、下に黒い排気の段）、中央の下にディフューザーのフィン
  {
    const rx = xMax - 0.05;
    const tz = zMin;
    facePlate(k, 'black', tz - 0.01, tz + 0.01, [[0.4, b + 0.0], [rx, b + 0.0], [rx, b + 0.12], [0.4, b + 0.12]]);
    lampUnit(k, 'lamp', tz - 0.006, -1, 0.44, rx - 0.02, pR - 0.16, pR - 0.12, 2);
    slits(k, rx - 0.002, tz + 0.05, tz + 0.2, pR - 0.1, pR - 0.03, 3, 0.0, true);
    diffuser(k, -0.77, [0.08, 0.36], b - 0.035, b + 0.07, 0.2);
  }

  // 跳ね上げ（後端の翼）: 支柱で持ち上がり、幅が広がって迎え角がつく。
  // 断面は厚みのある翼形（前縁が丸い）、左右の端に小さな端板、中央に差し色の切れ目
  const dp: V3 = [0, b + 0.3, -0.62];
  const dk = new Kit();
  const dprof: P2[] = [[-0.5, b + 0.335], [-0.56, b + 0.36], [-0.7, b + 0.395], [-0.86, b + 0.425], [-0.905, b + 0.465], [-0.885, b + 0.44], [-0.72, b + 0.37], [-0.56, b + 0.335]];
  for (const [x0, x1] of [[-0.44, -0.012], [0.012, 0.44]]) dk.sweep('body', 'x', [{ s: x0, pts: inset(dprof, 0.008) }, { s: x0 + 0.012, pts: dprof }, { s: x1 - 0.012, pts: dprof }, { s: x1, pts: inset(dprof, 0.008) }]);
  dk.plate('accent', 'x', -0.4, 0.4, [[-0.86, b + 0.428], [-0.905, b + 0.468], [-0.91, b + 0.458], [-0.87, b + 0.416]], 0.004);
  for (const sx of [-1, 1]) dk.plate('black', 'x', sx * 0.445 - 0.008, sx * 0.445 + 0.008, [[-0.6, b + 0.33], [-0.92, b + 0.4], [-0.93, b + 0.5], [-0.84, b + 0.48]], 0.004);
  // 翼の裏の支柱の付け根（翼に付いて一緒に動く）
  for (const sx of [-0.2, 0.2]) dk.box('black', sx - 0.02, sx + 0.02, b + 0.31, b + 0.37, -0.66, -0.74, 0.004);
  const duck = rig(dk, c, dp);
  const dstays = [-0.2, 0.2].map((x) => {
    const s = strut(c, 0.025, 0.07);
    s.position.set(x, b + 0.3, -0.7);
    return s;
  });
  // ポッド型はブーストで持ち上がるので、その上を越える高さまで上げる
  const wingLift = c.boostKind === 'pod2' || c.boostKind === 'pod4' ? 0.56 : 0.42;
  // 脇腹の板（前の縁を軸に外へ開く）
  const flaps = scoop
    ? [-1, 1].map((side) => {
        const f = new Kit();
        const len = Math.min(0.42, (sz1 - sz0) * 0.75);
        f.plate('body', 'x', xScoop + 0.035, xScoop + 0.055, [[sz1, b], [sz1 - len, b + 0.01], [sz1 - len, b + 0.12], [sz1, b + 0.15]], 0.006);
        if (side < 0) flipKitX(f);
        return { ...rig(f, c, [side * (xScoop + 0.045), b, sz1]), side };
      })
    : [];
  const { group, tris } = finish(c, k, [duck.group, ...dstays, ...flaps.map((f) => f.group)], [duck, ...flaps], [[xMax + 0.004, (podTop(c.rearAxle) + c.tireR * 1.22) / 2 + 0.01, c.rearAxle, 0]]);
  const setAero = (a: number) => {
    const e = ease(a);
    const lift = wingLift * ease(a * 1.4);
    duck.group.position.y = dp[1] + lift;
    duck.group.rotation.x = 0.22 * ease((a - 0.4) / 0.6);
    duck.group.scale.x = 1 + 0.6 * ease((a - 0.3) / 0.7);
    for (const s of dstays) {
      s.visible = lift > 0.005;
      s.scale.y = Math.max(0.001, lift + 0.02);
    }
    for (const f of flaps) f.group.rotation.y = -f.side * 0.7 * e;
  };
  setAero(0);
  return { group, setAero, bladeY: b + 0.3, canardY: (z) => podTop(z) + 0.03, triangles: tris };
}

// ───────────────────────── ウォールランナー: 装甲車（壁に当てて走る道具） ─────────────────────────
// 角ばった箱を面取りした装甲板、太いサイドガード（タイヤの上半分を覆う）、黄色の注意帯。
// エアロ: 左右の装甲板（盾）が外へせり出す。背中の装甲板が後ろへずれて少し持ち上がる
function wallrunner(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const chBox = (w: number, y0: number, yS: number, yT: number, ch: number): P2[] => [[0, b + y0], [w, b + y0], [w, b + yS], [w - ch, b + yT], [0, b + yT]];
  k.hull('body', [
    [1.3, 0.36, -0.01, 0.04, 0.1, 0.05],
    [1.02, 0.43, -0.02, 0.16, 0.26, 0.09],
    [0.62, 0.45, -0.02, 0.22, 0.32, 0.09],
    [-0.5, 0.45, -0.02, 0.22, 0.32, 0.09],
    [-0.77, 0.44, -0.02, 0.2, 0.29, 0.09],
  ].map(([z, w, y0, yS, yT, ch]) => ({ z: Z(z), half: chBox(w, y0, yS, yT, ch) })));
  // 前の黒い装甲（あご）
  k.hull('black', [[1.37, 0.3, -0.03, 0.02], [1.22, 0.4, -0.03, 0.06]].map(([z, w, y0, yT]) => ({ z: Z(z), half: [[0, b + y0], [w, b + y0], [w, b + yT], [0, b + yT]] as P2[] })));
  // 黄色の注意帯（ノーズの上面の斜め2本）
  const noseTop = (z: number) => b + tab([[Z(1.3), 0.1], [Z(1.02), 0.26], [0.62, 0.32]], z);
  for (const dz of [0, 0.1]) {
    const z = Z(0.92) - dz;
    k.plate('accent', 'z', z, z + 0.045, [[-0.28, noseTop(z) - 0.012], [0.28, noseTop(z) - 0.012], [0.28, noseTop(z) + 0.01], [-0.28, noseTop(z) + 0.01]], 0.003);
  }
  // 風防（角ばった窓）と黒い窓枠・ひさし
  k.hull('black', [[0.56, 0.22, 0.36], [-0.04, 0.24, 0.38]].map(([z, w, t]) => ({ z, half: [[0, b + 0.28], [w, b + 0.28], [w - 0.03, b + t], [0, b + t]] as P2[] })));
  k.hull('glass', [[0.5, 0.17, 0.43], [0.36, 0.2, 0.47], [0.0, 0.2, 0.47]].map(([z, w, t]) => ({ z, half: [[0, b + 0.35], [w + 0.005, b + 0.35], [w - 0.04, b + t], [0, b + t]] as P2[] })));
  k.box('black', -0.17, 0.17, b + 0.465, b + 0.485, 0.34, 0.02, 0.006); // 屋根の板
  k.box('black', -0.2, 0.2, b + 0.4, b + 0.42, 0.53, 0.47, 0.005); // 窓の格子
  // サイドガード: タイヤの上半分を外側まで覆う、太い面取りの箱
  const xo = Math.min(0.9, c.wxOut + 0.06);
  const xm = c.wxOut + 0.008;
  const zMax = Math.max(Z(1.2), c.frontEdge + 0.06);
  const zMin = Math.min(-1.06, c.rearEdge - 0.05);
  const gTop = (z: number) => b + tab([[zMax, 0.14], [zMax - 0.14, 0.27], [zMin + 0.1, 0.27], [zMin, 0.2]], z);
  const guardTop = (z: number) => Math.max(gTop(z), c.arch(z, 0.035, true) + 0.05);
  pod(k, 'body', c, {
    zMin, zMax, mode: 'over', gap: 0.035, skin: 0.05, poly: true,
    bot: () => b - 0.02,
    top: gTop,
    sec: (z, bot, t) => {
      const lip = Math.min(bot, Math.max(b - 0.02, c.tireR + 0.03));
      // 側面は2段の装甲（上の段を少し内へ引いて折れ目を作る）
      const mid = Math.min(t - 0.08, Math.max(lip + 0.06, b + 0.13));
      return [[0.4, bot], [xm, bot], [xm, lip], [xo - 0.04, lip], [xo, lip + 0.04], [xo, mid], [xo - 0.022, mid + 0.02], [xo - 0.022, t - 0.045], [xo - 0.065, t], [0.4, t]];
    },
  });
  // 下まわりの黒いガード（ガードの下の段）
  if (c.gapF - c.gapR > 0.1) k.box('black', 0.44, xo - 0.02, b - 0.04, b + 0.03, c.gapR, c.gapF, 0.01, true);
  k.box('lamp', 0.28, 0.4, b + 0.14, b + 0.2, -0.787, -0.768, 0.004, true);
  k.box('black', 0.06, 0.24, b + 0.13, b + 0.21, -0.787, -0.77, 0.004, true); // 後ろの通気口
  // ── 作り込み ──
  // 胴の上の縁の面取り（屋根の左右の黒い段）と窓の下の吸気口
  k.sweep('black', 'z', [0.58, -0.06].map((z) => ({ s: z, pts: [[0.24, b + 0.28], [0.36, b + 0.31], [0.36, b + 0.322], [0.24, b + 0.292]] as P2[] })), true);
  // 顔: 黒い格子のグリル（縦の差し色の棒）、4つの角い目（縁つき）、牽引のフック、ガードの前の面の通気口
  {
    const fz = Z(1.3);
    facePlate(k, 'black', fz - 0.006, fz + 0.012, [[0, b + 0.0], [0.2, b + 0.0], [0.2, b + 0.085], [0, b + 0.085]]);
    for (const x of [0.04, 0.1, 0.16]) facePlate(k, 'body', fz + 0.01, fz + 0.016, [[x - 0.008, b + 0.008], [x + 0.008, b + 0.008], [x + 0.008, b + 0.078], [x - 0.008, b + 0.078]]);
    lampUnit(k, 'head', fz + 0.004, 1, 0.22, 0.34, b + 0.03, b + 0.07, 1);
    k.box('accent', 0.2, 0.26, b - 0.04, b - 0.0, Z(1.38), Z(1.36), 0.004, true);
    const gz = zMax;
    facePlate(k, 'black', gz - 0.004, gz + 0.012, [[0.46, b + 0.02], [xo - 0.06, b + 0.02], [xo - 0.06, b + 0.11], [0.46, b + 0.11]]);
    for (const y of [0.045, 0.075]) facePlate(k, 'body', gz + 0.01, gz + 0.016, [[0.46, b + y], [xo - 0.06, b + y], [xo - 0.06, b + y + 0.01], [0.46, b + y + 0.01]]);
  }
  // ガードの上の段のスリット（前輪の後ろ）と、後ろの面のランプの縁・ディフューザー
  slits(k, xo - 0.022, c.gapF + 0.02, c.gapF + 0.2, b + 0.17, b + 0.24, 4, 0.0);
  lampUnit(k, 'lamp', -0.776, -1, 0.28, 0.4, b + 0.14, b + 0.2, 1);
  diffuser(k, -0.77, [0.08, 0.3, 0.42], b - 0.04, b + 0.08, 0.16);
  facePlate(k, 'black', zMin - 0.01, zMin + 0.01, [[0.46, b + 0.0], [xo - 0.05, b + 0.0], [xo - 0.05, b + 0.12], [0.46, b + 0.12]]);
  facePlate(k, 'lamp', zMin - 0.014, zMin + 0.01, [[0.5, b + 0.15], [xo - 0.08, b + 0.15], [xo - 0.08, b + 0.19], [0.5, b + 0.19]]);

  // 盾（サイドガードの外の板）: 車軸の間を中心に、外へせり出す
  const sz0 = c.gapR + 0.02;
  const sz1 = Math.max(sz0 + 0.2, c.gapF - 0.02);
  const sy0 = b - 0.01, sy1 = b + 0.25;
  const reach = Math.max(0.03, Math.min(0.12, 0.93 - (xo + 0.035)));
  const shields = [-1, 1].map((side) => {
    const s = new Kit();
    s.plate('body', 'x', xo - 0.005, xo + 0.03, [[sz1, sy0], [sz0, sy0], [sz0 - 0.05, (sy0 + sy1) / 2], [sz0, sy1], [sz1, sy1], [sz1 + 0.05, (sy0 + sy1) / 2]], 0.012);
    // 注意帯（斜めの黄色）
    for (let i = 0; i < 3; i++) {
      const z = sz1 - 0.12 - i * 0.12;
      s.plate('accent', 'x', xo + 0.026, xo + 0.036, [[z, sy0 + 0.015], [z - 0.05, sy0 + 0.015], [z - 0.02, sy1 - 0.015], [z + 0.03, sy1 - 0.015]], 0.003);
    }
    if (side < 0) flipKitX(s);
    return { ...rig(s, c, [side * xo, sy0, 0]), side };
  });
  // 背中の装甲板（左右2枚。中央は大型ブースターのために空ける）
  const backs = [-1, 1].map((side) => {
    const s = new Kit();
    s.sweep('body', 'z', [-0.12, -0.74].map((z) => ({ s: z, pts: [[0.19, b + 0.31], [0.44, b + 0.31], [0.44, b + 0.34], [0.41, b + 0.38], [0.19, b + 0.38]] as P2[] })));
    s.sweep('accent', 'z', [-0.16, -0.26].map((z) => ({ s: z, pts: [[0.21, b + 0.379], [0.4, b + 0.379], [0.4, b + 0.388], [0.21, b + 0.388]] as P2[] })));
    if (side < 0) flipKitX(s);
    return { ...rig(s, c, [side * 0.3, b + 0.31, -0.44]), side };
  });
  const { group, tris } = finish(c, k, [...shields.map((s) => s.group), ...backs.map((s) => s.group)], [...shields, ...backs], [[xo + 0.04, (sy0 + sy1) / 2, sz0 + 0.14, 0]]);
  // ゼッケンは盾と一緒に動かす
  const plates = group.children.filter((o) => (o as THREE.Mesh).material === c.numberMat);
  const setAero = (a: number) => {
    const e = ease(a);
    for (const s of shields) {
      s.group.position.x = s.side * (xo + reach * e);
      s.group.rotation.z = s.side * 0.12 * e; // 下を外へ開いて壁へ向ける
    }
    for (const p of plates) p.position.x = Math.sign(p.position.x) * (xo + 0.04 + reach * e);
    for (const s of backs) {
      s.group.position.z = -0.44 - 0.16 * ease((a - 0.2) / 0.8);
      s.group.position.y = b + 0.31 + 0.05 * e;
    }
  };
  setAero(0);
  // 大型2連ポッドは背中の装甲板の上に並べて載せ、板と一緒に後ろへずれる
  return { group, setAero, bladeY: b + 0.4, canardY: (z) => guardTop(z) + 0.03, triangles: tris, mount: { pod2: { anchor: backs[1].group, podX: 0.27 }, pod4: { anchor: backs[1].group } } };
}

// ───────────────────────── シフター: 剃刀（宝石のカット面） ─────────────────────────
// 多面体の風防、鋭い肩、細い背びれ。中央は差し色（紺）のパネル。ハーフカウル（タイヤの上だけ刃のようなフェンダー）。
// エアロ: カウルの後ろ半分（肩の後半と後ろのフェンダー）が後方へ大きく滑り、中の黒い骨格と吸気口が出る。背びれが立つ
function shifter(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  // 中央の紺のパネル（稜線つき）
  k.hull('accent', [
    [1.33, 0.04, 0.0, 0.02, 0.05],
    [1.02, 0.15, 0.0, 0.09, 0.17],
    [0.6, 0.2, 0.0, 0.18, 0.28],
    [-0.3, 0.2, 0.0, 0.2, 0.3],
    [-0.77, 0.18, 0.0, 0.16, 0.24],
  ].map(([z, w, y0, yS, yC]) => ({ z: Z(z), half: [[0, b + y0], [w, b + y0], [w, b + yS], [w * 0.4, b + yC - 0.01], [0, b + yC]] as P2[] })));
  const sh = (z: number, xi: number, xo: number, xr: number, yR: number, yI: number): Station => ({
    s: z,
    pts: [[xi, b], [xo - 0.02, b], [xo, b + 0.1], [xr, b + yR], [xi, b + yI]],
  });
  // 前の肩（ノーズの左右の牙から）
  k.sweep('body', 'z', [
    sh(Z(1.3), 0.12, 0.19, 0.16, 0.11, 0.08),
    sh(Z(1.0), 0.15, 0.4, 0.3, 0.22, 0.16),
    sh(0.6, 0.18, 0.46, 0.36, 0.34, 0.27),
    sh(-0.1, 0.18, 0.46, 0.36, 0.36, 0.28),
  ], true);
  // 前のフェンダー（刃の形）。後ろのフェンダーは滑るカウルに入れる
  const fender = (kit: Kit, za: number, r: number) => {
    const R = r + 0.035;
    const xo = Math.min(0.9, c.wxOut + 0.03);
    pod(kit, 'body', c, {
      zMin: za - R - 0.06, zMax: za + R + 0.1, mode: 'over', gap: 0.035, skin: 0.045,
      bot: () => r, top: () => r + 0.03,
      sec: (_z, bot, t) => [[0.42, bot], [xo, bot], [xo, t - 0.035], [xo - 0.09, t], [0.42, t - 0.02]],
    });
  };
  for (const [za, r] of c.axles) if (za > 0) fender(k, za, r);
  // 中の黒い骨格と吸気口（カウルが閉じているときは肩の中に隠れる）
  k.box('black', 0.2, 0.44, b - 0.02, b + 0.1, -0.08, -0.86, 0.01, true);
  k.sweep('black', 'z', [-0.12, -0.42].map((z, i) => ({ s: z, pts: [[0.22, b + 0.08], [0.42, b + 0.08], [0.42, b + 0.18 - i * 0.04], [0.3, b + 0.3 - i * 0.04], [0.22, b + 0.26 - i * 0.04]] as P2[] })), true);
  k.box('black', 0.26, 0.38, b + 0.19, b + 0.255, -0.425, -0.44, 0.003, true); // 吸気口の奥
  // 多面体の風防
  k.hull('glass', [
    [0.58, 0.05, 0.32],
    [0.38, 0.15, 0.44],
    [0.08, 0.17, 0.48],
    [-0.2, 0.15, 0.43],
    [-0.36, 0.06, 0.33],
  ].map(([z, w, t]) => ({ z, half: [[0, b + 0.26], [w, b + 0.26], [w * 0.75, b + t - 0.07], [0, b + t]] as P2[] })));
  k.box('lamp', 0.05, 0.16, b + 0.1, b + 0.15, -0.787, -0.768, 0.004, true);
  // ── 作り込み ──
  // 顔: 牙の先の細い目、紺のパネルの先の黒い口（3本の仕切り）、前の黒いスプリッター（紺の縁）
  k.plate('head', 'y', b + 0.09, b + 0.098, [[0.14, Z(1.24)], [0.24, Z(1.12)], [0.28, Z(1.04)], [0.17, Z(1.17)]], 0, true);
  facePlate(k, 'black', Z(1.33) - 0.006, Z(1.33) + 0.006, [[0, b + 0.005], [0.05, b + 0.005], [0.05, b + 0.045], [0, b + 0.045]]);
  k.hull('black', [[Z(1.36), 0.14, 0.012], [Z(1.14), 0.3, 0.012], [Z(0.9), 0.42, 0.012]].map(([z, w, t]) => ({ z, half: [[0, b - 0.045], [w, b - 0.045], [w, b - 0.045 + t], [0, b - 0.045 + t]] as P2[] })));
  k.plate('accent', 'y', b - 0.046, b - 0.03, [[0.12, Z(1.365)], [0.29, Z(1.15)], [0.43, Z(0.91)], [0.4, Z(0.895)], [0.27, Z(1.14)], [0.1, Z(1.35)]], 0, true);
  // 紺のパネルのカット面（ボンネットの左右の黒い吸気口）
  k.sweep('black', 'z', [Z(0.95), Z(0.7)].map((z, i) => ({ s: z, pts: [[0.1, b + 0.2 + i * 0.05], [0.17, b + 0.15 + i * 0.05], [0.18, b + 0.165 + i * 0.05], [0.11, b + 0.215 + i * 0.05]] as P2[] })), true);
  // 後ろ: 中央のランプの縁・ディフューザーのフィン
  lampUnit(k, 'lamp', -0.776, -1, 0.05, 0.16, b + 0.1, b + 0.15, 1);
  diffuser(k, -0.86, [0.24, 0.34, 0.42], b - 0.035, b + 0.07, 0.14);

  // 後ろ半分のカウル（肩の後半＋後ろのフェンダー）
  const rc = new Kit();
  rc.sweep('body', 'z', [
    sh(-0.08, 0.18, 0.46, 0.36, 0.36, 0.28),
    sh(-0.55, 0.2, 0.46, 0.37, 0.32, 0.25),
    sh(-0.72, 0.3, 0.46, 0.39, 0.27, 0.21),
    sh(-0.9, 0.33, 0.46, 0.4, 0.2, 0.15),
  ], true);
  rc.sweep('black', 'z', [-0.6, -0.86].map((z) => ({ s: z, pts: [[0.47, b + 0.005], [0.475, b + 0.005], [0.475, b + 0.05], [0.47, b + 0.05]] as P2[] })), true);
  // 後ろのフェンダーはタイヤの上に残す（以前はカウルと一緒に滑ってタイヤからずれて見えた）
  for (const [za, r] of c.axles) if (za <= 0) fender(k, za, r);
  const cowl = rig(rc, c, [0, b, 0]);
  const slide = 0.3;
  // 背びれ（ふだんは胴に沈んで稜線だけ見える）
  const fk = new Kit();
  fk.plate('body', 'x', -0.014, 0.014, [[-0.05, b + 0.2], [-0.45, b + 0.2], [-0.5, b + 0.54], [-0.36, b + 0.5]], 0.006);
  fk.plate('accent', 'x', -0.017, 0.017, [[-0.43, b + 0.43], [-0.49, b + 0.43], [-0.5, b + 0.54], [-0.45, b + 0.52]], 0.004);
  const fin = rig(fk, c, [0, b + 0.2, -0.45]);
  const finDown = 0.22;
  const { group, tris } = finish(c, k, [cowl.group, fin.group], [cowl, fin], [[0.421, b + 0.234, -0.32, 0.37]], cowl);
  const setAero = (a: number) => {
    cowl.group.position.z = -slide * ease(a * 1.25);
    fin.group.position.y = b + 0.2 - finDown * (1 - ease((a - 0.3) / 0.7));
    fin.group.rotation.x = 0.25 * (1 - ease((a - 0.3) / 0.7));
  };
  setAero(0);
  // 背中に載るブースター（4連ポッド・大型シングル）は滑るカウルに載せ、カウルと一緒に後ろへ動く
  return { group, setAero, bladeY: b + 0.36, canardY: (z) => c.arch(z) + 0.07, triangles: tris, mount: { pod4: { anchor: cowl.group }, single: { anchor: cowl.group } } };
}

// ───────────────────────── ストームシフター: 猛禽（耐久レーサー） ─────────────────────────
// 低いキャビン、背中を通る太い黒い背骨（後端は大型ブースターへつながる高さ）、張り出した後ろのフェンダー。
// エアロ: カウル全体が前を支点に持ち上がり、後ろのフェンダーの上の羽（3枚ずつ）が開く
function stormShifter(c: C): DesignedBody {
  const k = new Kit(); // 動かない下まわり
  const { b, Z } = c;
  k.hull('black', [[Z(1.2), 0.38], [-0.76, 0.44]].map(([z, w]) => ({ z, half: [[0, b - 0.035], [w, b - 0.035], [w, b + 0.05], [0, b + 0.05]] as P2[] })));
  const ck = new Kit(); // カウル（前を支点に持ち上がる）
  ck.hull('body', [
    [1.33, 0.12, 0.0, 0.04, 0.06],
    [1.06, 0.3, 0.0, 0.12, 0.16],
    [0.62, 0.42, 0.0, 0.19, 0.26],
    [0.0, 0.44, 0.0, 0.22, 0.3],
    [-0.5, 0.44, 0.0, 0.22, 0.3],
    [-0.77, 0.42, 0.0, 0.2, 0.28],
  ].map(([z, w, y0, yS, yC]) => ({ z: Z(z), half: [[0, b + y0], [w, b + y0], [w, b + yS], [w * 0.7, b + yC], [0, b + yC]] as P2[] })));
  // 背骨（黒）: 前半はノーズから風防の前まで、後半は風防の後ろから後端へ（後端はブースターの高さへ上がる）
  const spineF: [number, number, number, number][] = [[1.3, 0.05, 0.06, 0.08], [1.02, 0.11, 0.18, 0.24], [0.44, 0.13, 0.3, 0.36]];
  ck.hull('black', spineF.map(([z, w, yS, yT]) => ({ z: Z(z), half: [[0, b + 0.02], [w, b + 0.02], [w, b + yS], [w * 0.6, b + yT], [0, b + yT]] as P2[] })));
  // 小型4連ポッドはレールが背中の上を通るので、背骨の後端を低くする
  const sp = c.boostKind === 'pod4' ? 0.06 : 0;
  ck.hull('black', [[-0.02, 0.12, 0.32, 0.38], [-0.4, 0.13, 0.36 - sp, 0.42 - sp], [-0.8, 0.13, 0.38 - sp, 0.44 - sp]].map(([z, w, yS, yT]) => ({ z, half: [[0, b + 0.05], [w, b + 0.05], [w, b + yS], [w * 0.6, b + yT], [0, b + yT]] as P2[] })));
  // 背骨の差し色（チタンのスラット）
  for (const z0 of [0.98, 0.82, 0.66]) {
    const zz = Z(z0);
    const yT = b + tab(spineF.map(([z, , , y]) => [Z(z), y] as [number, number]), zz);
    ck.plate('accent', 'x', -0.085, 0.085, [[zz + 0.03, yT - 0.005], [zz - 0.01, yT - 0.005], [zz - 0.01, yT + 0.012], [zz + 0.03, yT + 0.012]], 0.004);
  }
  // 低い風防
  ck.hull('glass', [
    [0.48, 0.08, 0.34],
    [0.32, 0.2, 0.43],
    [0.06, 0.21, 0.45],
    [-0.06, 0.12, 0.37],
  ].map(([z, w, t]) => ({ z, half: [[0, b + 0.25], [w, b + 0.25], [w * 0.8, b + t - 0.05], [0, b + t]] as P2[] })));
  // フルカウルのフェンダー: 前は角ばり、後ろは外へ張り出す
  const xF = Math.min(0.88, c.wxOut + 0.04);
  const xR = Math.min(0.93, c.wxOut + 0.09);
  const zMax = Math.max(Z(1.18), c.frontEdge + 0.05);
  const zMin = Math.min(-1.1, c.rearEdge - 0.06);
  const xOut = (z: number) => tab([[zMax, xF - 0.06], [c.frontAxle, xF], [c.gapF, xF], [c.gapF - 0.06, 0.62], [c.gapR + 0.06, 0.62], [c.gapR, xR], [zMin, xR - 0.03]], z);
  const xm = c.wxOut + 0.008;
  const skin = c.boostKind === 'pod2' ? 0.02 : 0.035;
  const pF = c.peak(c.axF[1], 0.03, skin);
  const pR = c.peak(c.axR[0], 0.03, skin) + (c.boostKind === 'pod2' ? 0 : 0.04); // 後ろは張り出して高い（2連ポッドの下は空ける）
  const top = (z: number) =>
    tab([[zMax, pF - 0.17], [c.axF[1] + 0.12, pF], [c.axF[0] - 0.1, pF], [(c.gapF + c.gapR) / 2, b + 0.22], [c.axR[1] + 0.12, pR], [c.axR[0] - 0.1, pR], [zMin, pR - 0.05]], z);
  const podTop = (z: number) => Math.max(top(z), c.arch(z, 0.03, true) + skin);
  pod(ck, 'body', c, {
    zMin, zMax, mode: 'over', gap: 0.03, skin, poly: true,
    bot: () => b - 0.02,
    top,
    sec: (z, bot, t) => {
      const xo = xOut(z);
      const xmm = Math.min(xm, xo - 0.04);
      const lip = Math.min(bot, Math.max(b - 0.02, c.tireR * 1.15));
      const ch = Math.min(0.07, (t - lip) * 0.4);
      return [[0.38, bot], [xmm, bot], [xmm, lip], [xo - 0.05, lip], [xo, lip + 0.05], [xo, t - ch], [xo - ch, t], [0.38, t - 0.01]];
    },
  });
  // 車軸の間の黒い通気口とスラット
  if (c.gapF - c.gapR > 0.2) {
    ck.box('black', 0.56, 0.64, b + 0.0, b + 0.15, c.gapR + 0.05, c.gapF - 0.05, 0.01, true);
    for (const y of [0.04, 0.08, 0.12]) ck.box('accent', 0.636, 0.648, b + y, b + y + 0.012, c.gapR + 0.08, c.gapF - 0.08, 0.003, true);
  }
  ck.box('lamp', 0.18, 0.36, b + 0.11, b + 0.15, -0.787, -0.768, 0.004, true);
  // ── 作り込み ──
  // 顔: フェンダーの先の3連の目（縁つき）、背骨の先の黒い口、前の黒いスプリッター（チタンの縁）、鼻の左右の通気口
  lampUnit(ck, 'head', zMax + 0.004, 1, 0.5, xF - 0.1, pF - 0.26, pF - 0.225, 2);
  facePlate(ck, 'black', zMax - 0.004, zMax + 0.012, [[0.44, b - 0.015], [xF - 0.06, b - 0.015], [xF - 0.06, b + 0.07], [0.46, b + 0.08]]);
  ck.hull('black', [[Z(1.38), 0.16, 0.012], [Z(1.18), 0.34, 0.012], [Z(0.96), 0.44, 0.012]].map(([z, w, t]) => ({ z, half: [[0, b - 0.045], [w, b - 0.045], [w, b - 0.045 + t], [0, b - 0.045 + t]] as P2[] })));
  ck.plate('accent', 'y', b - 0.046, b - 0.03, [[0.14, Z(1.385)], [0.33, Z(1.19)], [0.45, Z(0.97)], [0.42, Z(0.955)], [0.31, Z(1.18)], [0.12, Z(1.37)]], 0, true);
  for (const z0 of [1.16, 1.08]) ck.box('black', 0.15, 0.26, b + 0.13 + (z0 - 1.08) * 0.3, b + 0.145 + (z0 - 1.08) * 0.3, Z(z0), Z(z0) - 0.05, 0.003, true);
  // 後ろ: 中央のランプの縁、背骨の下の黒いディフューザーのフィン、フェンダーの後ろの面のスリット
  lampUnit(ck, 'lamp', -0.776, -1, 0.18, 0.36, b + 0.11, b + 0.15, 2);
  diffuser(ck, -0.77, [0.12, 0.26, 0.38], b - 0.035, b + 0.08, 0.16);
  slits(ck, xR - 0.07, zMin + 0.03, zMin + 0.2, b + 0.0, b + 0.1, 3, 0.0);
  // フェンダーの後ろの面: 黒い排気口と横長のランプ
  ck.box('black', 0.42, xR - 0.06, b + 0.0, b + 0.12, zMin - 0.012, zMin + 0.01, 0.006, true);
  ck.box('lamp', 0.46, xR - 0.08, pR - 0.15, pR - 0.11, zMin - 0.012, zMin + 0.01, 0.004, true);
  const cp: V3 = [0, b, Z(1.25)];
  const cowl = rig(ck, c, cp);
  // 羽（後ろのフェンダーの上、内側の縁を軸に外上へ開く）
  const feathers = [-1, 1].flatMap((side) => [0.14, 0, -0.14].map((dz, i) => {
    const f = new Kit();
    const z = c.rearAxle + dz;
    const y = podTop(z) + 0.004;
    const x0 = 0.5;
    f.plate('accent', 'y', y, y + 0.015, [[x0, z + 0.05], [x0, z - 0.05], [x0 + 0.24, z - 0.1], [x0 + 0.24, z - 0.02]], 0.004);
    if (side < 0) flipKitX(f);
    return { ...rig(f, c, [side * x0, y, z], cowl), side, open: 0.55 + 0.25 * i };
  }));
  // カウルの持ち上げ量（ラジアン）。背中・後輪の上にポッドがあるときは当たらない程度に控える
  // ブースターはどの種類もカウルに載せて一緒に持ち上げるので、持ち上げ量は種類で変えない。
  // 以前は 0.15（後端が約0.3浮いて中が空に見えた）だったのを控え、後ろに2本の油圧の支柱を足す
  const lift = 0.07;
  const lz = -0.55;
  const jacks = strutSet(c, [[-0.3, lz], [0.3, lz]], 0.035, 0.035);
  jacks.position.y = b + 0.03;
  k.box('black', -0.36, 0.36, b + 0.0, b + 0.04, lz - 0.04, lz + 0.04, 0.005); // 支柱の受け
  const { group, tris } = finish(c, k, [cowl.group, jacks], [cowl, ...feathers], [[xR + 0.004, (podTop(c.rearAxle) + c.tireR * 1.15) / 2 + 0.01, c.rearAxle, 0]], cowl);
  const jackLen = (cp[2] - lz) * Math.sin(lift) + 0.02;
  const setAero = (a: number) => {
    cowl.group.rotation.x = lift * ease(a);
    jacks.visible = a > 0.01;
    jacks.scale.y = Math.max(0.001, 0.03 + jackLen * ease(a) + 0.2);
    for (const f of feathers) f.group.rotation.z = f.side * f.open * ease((a - 0.25) / 0.75);
  };
  setAero(0);
  const onCowl = { anchor: cowl.group };
  return {
    group, setAero, bladeY: b + 0.3, canardY: (z) => podTop(z) + 0.03, triangles: tris,
    // 大型2連ポッドは背骨の両わきに並べて載せる（後ろのフェンダーの間）。ほかの種類もカウルと一緒に動く
    mount: { pod2: { anchor: cowl.group, podX: 0.25 }, pod4: onCowl, single: onCowl, twin: onCowl, quad: onCowl },
  };
}

// ═════════════════════════ 海外6メーカー（見た目だけのデザイン見本。部品データにはまだ無い） ═════════════════════════
// 方針は docs/CAR-DESIGN-20261111.md の「海外6メーカー」。日本の6台より面の折れ・段差・吸気口・ランプを増やし、
// 正面と後ろに「顔」を持たせる。ブースターの空き（後端の中央・背中の後ろ）は上と同じ決まりで空ける。
// 2連ポッドの腕（後輪の少し前、deckY+0.4 付近を左右に渡る）と4連ポッドのレール（背中の後ろ）に当たらないよう、
// 後ろの背の高さはブースターの種類で少し下げる。

// 断面表 rows（[z, 値…]）を z で読む
const rowAt = (rows: number[][], z: number) => rows[0].slice(1).map((_, i) => tab(rows.map((r) => [r[0], r[i + 1]] as [number, number]), z));
// フルカウルのフェンダー（タイヤの上と外を覆う）。xOut(z)=外の面、top(z)=上面の線。断面は cyclone と同じ考え方
type CowlOpt = { zMin: number; zMax: number; xOut: (z: number) => number; top: (z: number) => number; xIn?: number; lipK?: number; ch?: number; gap?: number; skin?: number; poly?: boolean; key?: Key; mirror?: boolean };
function cowl(k: Kit, c: C, o: CowlOpt) {
  const xm = c.wxOut + 0.008;
  const xIn = o.xIn ?? 0.36;
  pod(k, o.key ?? 'body', c, {
    zMin: o.zMin, zMax: o.zMax, mode: 'over', gap: o.gap ?? 0.03, skin: o.skin ?? 0.035, poly: o.poly, mirror: o.mirror, coarse: true, step: 0.24,
    bot: () => c.b - 0.02,
    top: o.top,
    sec: (z, bot, t) => {
      const xo = o.xOut(z);
      const xmm = Math.min(xm, xo - 0.04);
      const lip = Math.min(bot, Math.max(c.b - 0.02, c.tireR * (o.lipK ?? 1.2)));
      const ch = Math.min(o.ch ?? 0.09, (t - lip) * 0.45);
      return [[xIn, bot], [xmm, bot], [xmm, lip], [xo - 0.03, lip], [xo, lip + 0.04], [xo, t - ch * 0.7], [xo - ch, t], [xIn, t - 0.01]];
    },
  });
}
// 上面に沿う細い帯（中央のストライプなど）。pts は [z, y]、x0〜x1 の幅、厚み t
const stripe = (k: Kit, key: Key, pts: [number, number][], x0: number, x1: number, t = 0.008, mirror = true) =>
  k.sweep(key, 'z', pts.map(([z, y]) => ({ s: z, pts: [[x0, y], [x1, y], [x1, y + t], [x0, y + t]] as P2[] })), mirror);
// 横の面（x 一定）に貼る板。prof は [z, y]
// （貼る板は縁の面取りをしない: 三角形が半分以下で済む）
const sidePlate = (k: Kit, key: Key, x: number, prof: P2[], t = 0.01, mirror = true) => k.plate(key, 'x', x, x + t, prof, 0, mirror);
// 前・後ろの面（z 一定）に貼る板。prof は [x, y]
const facePlate = (k: Kit, key: Key, z0: number, z1: number, prof: P2[], mirror = true) => k.plate(key, 'z', Math.min(z0, z1), Math.max(z0, z1), prof, 0, mirror);
// 伸び縮みする黒い支柱の組（高さ1の柱を scale.y で伸ばす。何本でも1つのメッシュ）
function strutSet(c: C, pts: [number, number][], w: number, d: number) {
  const k = new Kit();
  for (const [x, z] of pts) k.box('black', x - w / 2, x + w / 2, 0, 1, z - d / 2, z + d / 2, 0);
  const m = k.meshes(c.mats)[0];
  m.visible = false;
  return m;
}
// 稜線つきの胴の断面（右半分）: 外の縁 → 肩 → 中段 → 稜線の脇 → 中央
const ridge = ([w, yS, yM, yC]: number[], b: number): P2[] => [[0, b], [w, b], [w, b + yS], [w * 0.56, b + yM], [w * 0.18, b + yC - 0.012], [0, b + yC]];

// ───────────────────────── ベクター（FALKREUT）: 精密な鏃（夜間迎撃機） ─────────────────────────
// 低いフルカウル、中央に稜線の立つボンネット、大きな黒い風防、後ろのフェンダーに立つ2枚のひれ、脇の大きな吸気口。
// 差し色（ライム）は斜めの切り込み線として入れる。エアロ: ひれが持ち上がって内へ傾き、甲板に伏せていた翼が
// 後ろ上へ移ってひれの間に渡る（ひれが端板になる）。前の黒いスプリッターが前へせり出す
function vector(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const p2 = c.boostKind === 'pod2';
  const rows = [
    [1.37, 0.2, 0.03, 0.045, 0.06],
    [1.14, 0.3, 0.08, 0.14, 0.18],
    [0.8, 0.38, 0.14, 0.24, 0.29],
    [0.3, 0.4, 0.17, 0.29, 0.35],
    [-0.4, 0.4, 0.18, 0.3, 0.36],
    [-0.77, 0.38, 0.15, 0.26, 0.31],
  ].map(([z, ...v]) => [Z(z), ...v]);
  k.hull('body', rows.map(([z, ...v]) => ({ z, half: ridge(v, b) })));
  // ボンネットの V 字の差し色（前は外寄り、後ろほど稜線へ寄る）
  k.sweep('accent', 'z', [Z(1.3), Z(1.1), Z(0.9), Z(0.7)].map((z, i) => {
    const [w, , yM, yC] = rowAt(rows, z);
    const S: P2 = [w * 0.56, b + yM], R: P2 = [w * 0.18, b + yC - 0.012];
    const L = (u: number): P2 => [S[0] + (R[0] - S[0]) * u, S[1] + (R[1] - S[1]) * u];
    const u = [0.02, 0.2, 0.4, 0.6][i];
    return { s: z, pts: strip(L(u), L(u + 0.16), 0.007) };
  }), true);
  // フェンダー: 前は四角く張り、車軸の間は大きくえぐれ、後ろは高い
  const xMax = Math.min(0.9, c.wxOut + 0.05);
  const xW = 0.55;
  const zMax = Math.max(Z(1.18), c.frontEdge + 0.05);
  const zMin = Math.min(-1.08, c.rearEdge - 0.05);
  const xOut = (z: number) => tab([[zMax, xMax - 0.06], [c.axF[1], xMax], [c.gapF, xMax], [c.gapF - 0.1, xW], [c.gapR + 0.1, xW], [c.gapR, xMax], [zMin, xMax - 0.02]], z);
  const skin = p2 ? 0.02 : 0.035;
  const pF = c.peak(c.axF[1], 0.03, skin);
  const pR = c.peak(c.axR[0], 0.03, skin) + (p2 ? 0 : 0.035);
  const mid = (c.gapF + c.gapR) / 2;
  const top = (z: number) => tab([[zMax, b + 0.2], [c.axF[1] + 0.14, pF], [c.axF[0] - 0.12, pF - 0.02], [mid, b + 0.25], [c.axR[1] + 0.1, pR], [c.axR[0] - 0.1, pR + 0.01], [zMin, pR - 0.03]], z);
  const podTop = (z: number) => Math.max(top(z), c.arch(z, 0.03) + skin);
  cowl(k, c, { zMin, zMax, xOut, top, skin, ch: 0.1, xIn: 0.3 });
  // 脇の吸気口（黒）、その前のライムの斜線、下のライムの敷居
  const iz1 = c.gapF - 0.1, iz0 = c.gapR + 0.1;
  if (iz1 - iz0 > 0.1) {
    sidePlate(k, 'black', xW - 0.006, [[iz1, b + 0.215], [iz1 - 0.1, b + 0.03], [iz0, b + 0.03], [iz0, b + 0.215]], 0.022);
    for (const y of [0.09, 0.15]) sidePlate(k, 'black', xW + 0.016, [[iz1 - 0.1 + (y - 0.03) * 0.5, b + y], [iz0, b + y], [iz0, b + y + 0.014], [iz1 - 0.1 + (y + 0.01) * 0.55, b + y + 0.014]], 0.012);
    sidePlate(k, 'accent', xW + 0.016, [[iz1 + 0.02, b + 0.03], [iz1 - 0.04, b + 0.03], [iz1 - 0.15, b + 0.23], [iz1 - 0.09, b + 0.23]], 0.01);
    sidePlate(k, 'accent', xW, [[iz1, b - 0.02], [iz0, b - 0.02], [iz0, b + 0.006], [iz1, b + 0.006]], 0.024);
  }
  // 後ろのフェンダーの斜めのライム
  const zr = c.axR[1], lipY = c.tireR * 1.2;
  sidePlate(k, 'accent', xMax - 0.002, [[zr + 0.25, lipY + 0.03], [zr + 0.16, lipY + 0.03], [zr - 0.2, pR - 0.1], [zr - 0.11, pR - 0.1]], 0.01);
  // 顔: 斜めの細い前照灯、ライムで縁取った下の吸気口、ノーズ先端の黒いスリット
  const fx = xMax - 0.06;
  facePlate(k, 'head', zMax - 0.005, zMax + 0.012, [[0.42, b + 0.14], [fx - 0.02, b + 0.115], [fx - 0.02, b + 0.14], [0.45, b + 0.175]]);
  facePlate(k, 'black', zMax - 0.005, zMax + 0.01, [[0.4, b - 0.01], [fx - 0.03, b - 0.01], [fx - 0.03, b + 0.08], [0.42, b + 0.08]]);
  facePlate(k, 'accent', zMax - 0.005, zMax + 0.015, [[0.38, b - 0.03], [fx, b - 0.03], [fx, b + 0.1], [fx - 0.025, b + 0.1], [fx - 0.025, b - 0.008], [0.38, b - 0.008]]);
  facePlate(k, 'black', Z(1.37) - 0.01, Z(1.37) + 0.008, [[0, b + 0.008], [0.14, b + 0.008], [0.14, b + 0.035], [0, b + 0.035]]);
  // 大きな黒い風防と、その後ろの黒いエンジンカバー（3本の段）
  k.hull('glass', [[0.62, 0.06, 0.37], [0.42, 0.21, 0.53], [0.08, 0.235, 0.58], [-0.22, 0.2, 0.54], [-0.44, 0.08, 0.41]].map(([z, w, t]) => ({ z, half: [[0, b + 0.3], [w, b + 0.3], [w * 0.86, b + t - 0.09], [w * 0.45, b + t - 0.015], [0, b + t]] as P2[] })));
  for (const [z0, z1, y] of [[-0.4, -0.5, 0.362], [-0.52, -0.62, 0.35], [-0.64, -0.74, 0.335]]) {
    k.box('black', -0.13, 0.13, b + y - 0.02, b + y + 0.008, z0, z1, 0.006);
  }
  // 後ろ: 黒い枠、横一文字の赤いランプ、フェンダーの後ろの面（黒い排気口・ランプ・ライムの山形）
  k.box('black', 0, 0.38, b - 0.02, b + 0.205, -0.79, -0.768, 0.006, true);
  facePlate(k, 'accent', -0.796, -0.79, [[0.3, b + 0.02], [0.36, b + 0.02], [0.36, b + 0.13], [0.3, b + 0.09]]);
  k.box('lamp', 0.1, 0.38, b + 0.225, b + 0.255, -0.787, -0.768, 0.004, true);
  const rx = xMax - 0.05;
  facePlate(k, 'black', zMin - 0.012, zMin + 0.01, [[0.36, b], [rx, b], [rx, b + 0.13], [0.36, b + 0.13]]);
  facePlate(k, 'lamp', zMin - 0.014, zMin + 0.01, [[0.4, pR - 0.15], [rx, pR - 0.12], [rx, pR - 0.09], [0.4, pR - 0.12]]);
  facePlate(k, 'accent', zMin - 0.016, zMin + 0.01, [[0.44, b + 0.15], [rx, b + 0.2], [rx, b + 0.23], [0.44, b + 0.18]]);

  // ひれ（左右）: 付け根の線（z 方向）を軸に内へ傾く
  const finX = 0.5;
  const finY = podTop(-0.93) - 0.012;
  const fins = [-1, 1].map((side) => {
    const f = new Kit();
    const z0 = p2 ? -0.8 : -0.68;
    f.plate('body', 'x', finX - 0.02, finX + 0.02, [[z0, finY], [-1.06, finY], [-1.15, b + 0.72], [-1.03, b + 0.68], [z0 - 0.16, finY + 0.15]], 0.012);
    f.plate('accent', 'x', finX - 0.023, finX + 0.023, [[-1.01, b + 0.6], [-1.06, b + 0.6], [-1.155, b + 0.72], [-1.105, b + 0.7]], 0.005);
    if (side < 0) flipKitX(f);
    return { ...rig(f, c, [side * finX, finY, 0]), side };
  });
  // 翼: ふだんはエンジンカバーの上に伏せている。エアロで後ろ上（ブースターより高い所）へ移ってひれの間に渡る
  const wk = new Kit();
  const span = 0.43;
  const wprof: P2[] = [[0.12, 0], [-0.12, 0.018], [-0.13, 0.045], [0.1, 0.02]];
  wk.sweep('black', 'x', [{ s: -span, pts: inset(wprof, 0.01) }, { s: -span + 0.02, pts: wprof }, { s: span - 0.02, pts: wprof }, { s: span, pts: inset(wprof, 0.01) }]);
  wk.plate('accent', 'x', -span + 0.02, span - 0.02, [[-0.11, 0.022], [-0.13, 0.046], [-0.135, 0.04], [-0.115, 0.016]], 0.003);
  const w0: V3 = [0, b + 0.39, -0.58];
  const w1: V3 = [0, b + 0.76, -1.0];
  const wing = rig(wk, c, w0, undefined, true);
  // 前の黒いスプリッター（ライムの縁）。エアロで前へせり出す
  const sz = Z(1.16);
  const sk = new Kit();
  sk.plate('black', 'y', -0.012, 0.012, [[-0.44, 0], [0.44, 0], [0.4, 0.2], [-0.4, 0.2]], 0.005);
  sk.plate('accent', 'y', -0.014, 0.014, [[-0.4, 0.18], [0.4, 0.18], [0.39, 0.215], [-0.39, 0.215]], 0.004);
  const split = rig(sk, c, [0, b - 0.045, sz], undefined, true);
  const { group, tris } = finish(c, k, [...fins.map((f) => f.group), wing.group, split.group], [...fins, wing, split], [[xW + 0.03, b + 0.13, (iz0 + iz1) / 2 - 0.02, 0]]);
  const finLift = 0.1;
  const setAero = (a: number) => {
    const e1 = ease(a / 0.6);
    const e2 = ease((a - 0.25) / 0.75);
    for (const f of fins) {
      f.group.position.y = finY + finLift * e1;
      f.group.rotation.z = f.side * (-0.12 + 0.38 * e2); // ふだんは少し外へ開き、エアロで内へ傾く
    }
    wing.group.position.set(0, w0[1] + (w1[1] - w0[1]) * ease(a / 0.7), w0[2] + (w1[2] - w0[2]) * e2);
    wing.group.rotation.x = -0.16 * e2;
    split.group.position.z = sz + 0.12 * ease(a);
  };
  setAero(0);
  return { group, setAero, bladeY: pR + 0.03, canardY: (z) => podTop(z) + 0.03, triangles: tris, mountIgnore: [wing.group] };
}

// ───────────────────────── クリムゾン（VETRA）: 紅の隼（羽根を重ねた猛禽） ─────────────────────────
// 細い多面のノーズ、オープンホイール、背中のこぶ（後ろは黒いタービンの口）、胴の左右に重ねたクリーム色の羽根3枚ずつ。
// 機械の黒い脇腹をわざと見せる。エアロ: 羽根が1枚ずつ角度を変えて外へ開き、上の1枚は大きく持ち上がる（翼を広げる）
function crimson(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const p2 = c.boostKind === 'pod2';
  const p4 = c.boostKind === 'pod4';
  const rows = [
    [1.4, 0.05, 0.02, 0.04, 0.055],
    [1.18, 0.13, 0.06, 0.12, 0.15],
    [0.86, 0.19, 0.11, 0.2, 0.25],
    [0.46, 0.24, 0.15, 0.27, 0.33],
    [0.0, 0.27, 0.17, 0.3, 0.37],
    [-0.42, 0.27, 0.17, 0.3, 0.37],
    [-0.77, 0.23, 0.15, 0.26, 0.32],
  ].map(([z, ...v]) => [Z(z), ...v]);
  k.hull('body', rows.map(([z, ...v]) => ({ z, half: ridge(v, b) })));
  // ノーズの上の吸気ダクト（前の口は黒）
  const ductRows = [[Z(0.98), 0.055, 0.045], [0.72, 0.075, 0.075], [0.44, 0.085, 0.09]].map(([z, w, h]) => {
    const y = b + rowAt(rows, z)[3] - 0.02;
    return { z, half: [[0, y], [w, y], [w * 0.92, y + h], [w * 0.5, y + h + 0.012], [0, y + h + 0.015]] as P2[] };
  });
  k.hull('body', ductRows);
  const dy = b + rowAt(rows, Z(0.98))[3] - 0.02;
  facePlate(k, 'black', Z(0.98) - 0.004, Z(0.98) + 0.006, [[0, dy + 0.008], [0.04, dy + 0.008], [0.04, dy + 0.042], [0, dy + 0.05]]);
  // 鼻先の黒い口と、斜めの青白い目
  facePlate(k, 'black', Z(1.4) - 0.012, Z(1.4) + 0.006, [[0, b + 0.004], [0.04, b + 0.004], [0.04, b + 0.03], [0, b + 0.03]]);
  {
    const z = Z(1.2);
    const [w, yS] = rowAt(rows, z);
    sidePlate(k, 'head', w - 0.004, [[z + 0.05, b + yS * 0.4], [z - 0.06, b + yS * 0.75], [z - 0.07, b + yS * 0.95], [z + 0.04, b + yS * 0.7]], 0.012);
  }
  // 低い風防
  k.hull('glass', [[0.44, 0.05, 0.4], [0.3, 0.15, 0.48], [0.06, 0.16, 0.5], [-0.1, 0.1, 0.44]].map(([z, w, t]) => ({ z, half: [[0, b + 0.32], [w, b + 0.32], [w * 0.8, b + t - 0.05], [0, b + t]] as P2[] })));
  // 背中のこぶ（後ろは黒いタービンの口と赤い輪）。4連ポッド・2連ポッドのときは低くする
  const hy = p4 ? 0.44 : p2 ? 0.43 : 0.5;
  k.hull('body', [[-0.06, 0.1, 0.4], [-0.3, 0.2, hy], [-0.55, 0.22, Math.min(hy, 0.49)], [-0.77, 0.2, Math.min(hy, 0.46) - 0.02]].map(([z, w, t]) => ({ z, half: [[0, b + 0.24], [w, b + 0.24], [w, b + t - 0.1], [w * 0.62, b + t - 0.012], [0, b + t]] as P2[] })));
  stripe(k, 'accent', [[-0.08, b + 0.405], [-0.3, b + hy + 0.003], [-0.55, b + Math.min(hy, 0.49) + 0.003], [-0.77, b + Math.min(hy, 0.46) - 0.017]], 0, 0.02, 0.006);
  k.tube('lamp', 0, b + 0.3, [[-0.785, 0.145], [-0.77, 0.145]], 10);
  k.tube('black', 0, b + 0.3, [[-0.8, 0.115], [-0.77, 0.115]], 10);
  k.tube('black', 0, b + 0.3, [[-0.802, 0.05], [-0.79, 0.05]], 6);
  // 黒い機械の脇腹（車軸の間）とサスペンションの腕
  if (c.gapF - c.gapR > 0.15) {
    k.box('black', 0.22, 0.42, b - 0.03, b + 0.1, c.gapR, c.gapF, 0.012, true);
    k.box('black', 0.4, 0.46, b + 0.0, b + 0.07, c.gapR + 0.03, c.gapF - 0.03, 0.008, true);
  }
  // 前輪の上の刃のようなフェンダー（先がクリーム色）
  for (const [za, r] of c.axles) {
    if (za <= 0) continue;
    const R = r + 0.035;
    const xo = Math.min(0.82, c.wxOut + 0.03);
    pod(k, 'body', c, {
      zMin: za - R * 0.3, zMax: za + R * 0.85, mode: 'over', gap: 0.035, skin: 0.025,
      bot: () => r + 0.1, top: () => r + 0.12,
      sec: (_z, bot, t) => [[0.42, bot], [xo, bot], [xo + 0.015, t], [0.42, t + 0.015]],
    });
  }
  // 鼻の両脇の前へ突き出たクリーム色の爪
  k.plate('accent', 'y', b + 0.02, b + 0.045, [[0.1, Z(1.0)], [0.14, Z(0.94)], [0.4, Z(1.14)], [0.36, Z(1.22)]], 0.006, true);
  // 後輪の上へ下りる赤い刃（2連ポッドの腕と重なるので、そのときは付けない）
  if (!p2) {
    const ry = 2 * c.rearR + 0.05;
    k.sweep('body', 'z', [-0.32, -0.55, -0.74].map((z, i) => ({ s: z, pts: [[0.18, b + 0.4 - i * 0.02], [0.62 - i * 0.03, ry], [0.62 - i * 0.03, ry + 0.025], [0.18, b + 0.43 - i * 0.02]] as P2[] })), true);
  }
  k.box('lamp', 0.13, 0.22, b + 0.19, b + 0.23, -0.787, -0.768, 0.004, true);

  // 羽根（左右3枚ずつ）: 付け根を軸に、閉じているときは後ろへ寝て胴に沿い、エアロで外へ開く
  const S = c.gapF - c.gapR;
  const s = Math.min(1, Math.max(0.6, S / 0.76));
  const spec = [
    // 閉じた状態は胴の脇の面に沿わせる（以前は閉じていても上の2枚が斜め上へ突き出て、角のように見えた）。
    // 開いた状態も上の1枚は立てすぎない（以前は 1.05 rad でほぼ垂直の棘に見えた）
    { x: 0.2, y: b + 0.25, z: c.gapF - 0.01, len: 0.42 * s, chord: 0.28, yaw: [0.62, 0.12], roll: [0.12, 0.42] },
    { x: 0.23, y: b + 0.12, z: c.gapF - 0.3 * S, len: 0.36 * s, chord: 0.24, yaw: [0.66, 0.16], roll: [-0.12, -0.34] },
    { x: 0.16, y: b + 0.42, z: -0.02, len: 0.46 * s, chord: 0.28, yaw: [0.7, 0.2], roll: [0.18, 0.62] },
  ];
  const feathers = [-1, 1].flatMap((side) => spec.map((f) => {
    const fk = new Kit();
    fk.plate('accent', 'y', -0.013, 0.013, [[0, f.chord * 0.45], [0, -f.chord * 0.55], [f.len, -f.chord * 0.55 - 0.1], [f.len * 0.8, -0.03]], 0.006);
    if (side < 0) flipKitX(fk);
    return { ...rig(fk, c, [side * f.x, f.y, f.z], undefined, true), side, f };
  }));
  const { group, tris } = finish(c, k, feathers.map((f) => f.group), feathers, [[0.425, b + 0.06, (c.gapF + c.gapR) / 2 + 0.05, 0]]);
  const setAero = (a: number) => {
    feathers.forEach((fe, i) => {
      const e = ease((a - (i % 3) * 0.12) / 0.76);
      fe.group.rotation.set(0, fe.side * (fe.f.yaw[0] + (fe.f.yaw[1] - fe.f.yaw[0]) * e), fe.side * (fe.f.roll[0] + (fe.f.roll[1] - fe.f.roll[0]) * e));
    });
  };
  setAero(0);
  // 大型シングルは背中のこぶのタービンの口に通して格納（ブーストで口から後ろへせり出す）
  const turbine = { auto: false, dy: b + 0.3 - (c.deckY + 0.5), dz: 0.2, stow: [0, 0.5] as [number, number] };
  return { group, setAero, bladeY: b + 0.46, canardY: (z) => (z > 0 ? c.arch(z) + 0.11 : b + 0.47), triangles: tris, mount: { single: turbine } };
}

// ───────────────────────── パール（ORBEL）: 真珠の雫（風洞で磨いた卵） ─────────────────────────
// 角のない卵形の胴（前輪・後輪はむき出し）、後ろは水色の輪のノズル、背中を通る水色の1本線、脇の水色に縁取った吸気口。
// エアロ: 背中のこぶの殻が左右に割れて甲虫の羽のように持ち上がり（中の黒い芯が見える）、鼻の両脇の小翼が開く
function pearl(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const p2 = c.boostKind === 'pod2';
  const p4 = c.boostKind === 'pod4';
  // 卵の断面: [z, 半幅, 中心の高さ, 上の高さ, 下の高さ]。下は b-0.02 で平らに切る
  const hump = p4 ? 0.25 : p2 ? 0.21 : 0.34;
  // 11-13 店長「500系みたいにスタイリッシュに」→ 参考にしたのは「長く低い鼻先・丸い胴」という印象だけ（色・窓の並び・顔は写さない）。
  // 鼻先を長く低く伸ばし（車長の約4割で細くなる）、胴は丸みの強い断面に。卵形の頃より背を低く
  const eggRows = [
    [Z(1.45), 0.05, 0.06, 0.015, 0.04],
    [Z(1.38), 0.12, 0.065, 0.035, 0.055],
    [Z(1.26), 0.21, 0.075, 0.06, 0.07],
    [Z(1.08), 0.3, 0.1, 0.1, 0.1],
    [Z(0.86), 0.37, 0.13, 0.15, 0.13],
    [0.55, 0.42, 0.16, 0.21, 0.17],
    [0.25, 0.44, 0.18, 0.25, 0.19],
    [-0.05, 0.44, 0.19, 0.27, 0.2],
    [-0.35, 0.42, 0.2, p4 ? 0.26 : 0.28, 0.21],
    [-0.6, 0.37, 0.2, Math.min(hump, 0.26), 0.22],
    [-0.74, 0.3, 0.2, Math.min(hump, 0.22), 0.23],
  ];
  const N = 7; // 右半分の分割（下の中心〜上の中心）
  const arc = ([w, yc, hT, hB]: number[], i: number, off = 0): P2 => {
    const a = -Math.PI / 2 + (i / N) * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const e = 2 / 2.2; // 丸みの強い断面（ほぼ楕円）
    const x = w * Math.pow(Math.abs(ca), e) + off * ca;
    const y = b + yc + (sa >= 0 ? hT : hB) * Math.sign(sa) * Math.pow(Math.abs(sa), e) + off * sa;
    return [x, Math.max(y, b - 0.02)];
  };
  const ring = (v: number[], off = 0): P2[] => {
    const half = Array.from({ length: N + 1 }, (_, i) => arc(v, i, off));
    half[0][0] = 0;
    half[N][0] = 0;
    return full(half);
  };
  k.sweep('body', 'z', eggRows.map(([z, ...v]) => ({ s: z, pts: ring(v) })));
  const eggTop = (z: number) => {
    const [, yc, hT] = rowAt(eggRows, z);
    return b + yc + hT;
  };
  // 背中の水色の1本線（殻の割れる所は殻の上に載せる）
  stripe(k, 'accent', [Z(1.3), Z(1.12), Z(0.85), 0.5, 0.15, -0.1].map((z) => [z, eggTop(z) - 0.003] as [number, number]), 0, 0.032, 0.006);
  stripe(k, 'accent', [-0.66, -0.74].map((z) => [z, eggTop(z) - 0.004] as [number, number]), 0, 0.032, 0.006);
  // 後ろの輪のノズル（水色の輪＋黒い口）
  k.tube('accent', 0, b + 0.2, [[-0.76, 0.25], [-0.74, 0.25]], 16);
  k.tube('black', 0, b + 0.2, [[-0.775, 0.2], [-0.745, 0.2]], 16);
  k.tube('black', 0, b + 0.2, [[-0.78, 0.09], [-0.77, 0.09]], 8);
  // 顔: 鼻先は口を付けずに尖らせる。鼻の両脇に細い水色の灯りの切れ込み
  {
    const v = rowAt(eggRows, Z(1.3));
    const P = arc(v, 2);
    sidePlate(k, 'accent', P[0] - 0.02, [[Z(1.36), P[1] - 0.006], [Z(1.2), P[1] - 0.004], [Z(1.2), P[1] + 0.01], [Z(1.33), P[1] + 0.004]], 0.03);
  }
  // 風防（細長く低い暗い窓を、鼻の付け根から背中まで1枚で。窓を並べない）
  k.hull('glass', [Z(0.98), Z(0.82), 0.55, 0.25, 0.02].map((z, i) => {
    const t = eggTop(z) + 0.008;
    const w = [0.05, 0.15, 0.2, 0.19, 0.08][i];
    return { z, half: [[0, t - 0.05], [w, t - 0.05], [w * 0.75, t - 0.014], [0, t]] as P2[] };
  }));
  // 脇の吸気口は 11-13 の作り直しで外した（細い胴に合わず段になって見えたため）
  // 殻の下の黒い芯（殻が開くと見える）
  const shellZ = [-0.1, -0.4, -0.64];
  k.sweep('black', 'z', shellZ.map((z) => {
    const v = rowAt(eggRows, z);
    const out = [3, 4, 5, 6, 7].map((i) => arc(v, i, 0.004));
    const inn = [7, 6, 5, 4, 3].map((i) => arc(v, i, -0.01));
    out[4][0] = 0;
    inn[0][0] = 0;
    return { s: z, pts: [...out, ...inn] };
  }), true);
  // 殻（左右）: 背中の中央の線を軸に外上へ開く
  const hingeY = eggTop(-0.4) - 0.01;
  const shells = [-1, 1].map((side) => {
    const sk = new Kit();
    sk.sweep('body', 'z', shellZ.map((z) => {
      const v = rowAt(eggRows, z);
      const out = [3, 4, 5, 6, 7].map((i) => arc(v, i, 0.026));
      const inn = [7, 6, 5, 4, 3].map((i) => arc(v, i, 0.008));
      out[4][0] = 0.004;
      inn[0][0] = 0.004;
      return { s: z, pts: [...out, ...inn] };
    }));
    stripe(sk, 'accent', shellZ.map((z) => [z, eggTop(z) + 0.024] as [number, number]), 0.004, 0.032, 0.006, false);
    if (side < 0) flipKitX(sk);
    return { ...rig(sk, c, [side * 0.004, hingeY, 0]), side };
  });
  // 鼻の両脇の水色の小翼（閉じているときは胴に沿って後ろ向き）
  const wz = Z(1.02);
  const ww = rowAt(eggRows, wz)[0];
  const wings = [-1, 1].map((side) => {
    const w = new Kit();
    w.plate('accent', 'y', -0.01, 0.01, [[0, 0.04], [0, -0.08], [0.2, -0.14], [0.2, -0.09]], 0.005);
    if (side < 0) flipKitX(w);
    return { ...rig(w, c, [side * (ww - 0.02), b + 0.07, wz], undefined, true), side };
  });
  const open = p4 ? 0.4 : 1.05;
  const { group, tris } = finish(c, k, [...shells.map((s) => s.group), ...wings.map((w) => w.group)], [...shells, ...wings], [[0.445, b + 0.25, 0.05, 0.2]]);
  const setAero = (a: number) => {
    for (const s of shells) s.group.rotation.z = s.side * open * ease(a);
    for (const w of wings) w.group.rotation.y = w.side * (1.25 - 1.45 * ease((a - 0.2) / 0.8));
  };
  setAero(0);
  // 大型シングルは後ろの輪のノズルに通して卵の中へ格納（ブーストで輪から後ろへせり出す）
  const nozzle = { auto: false, dy: b + 0.2 - (c.deckY + 0.5), dz: 0.2, stow: [0, 0.5] as [number, number] };
  return { group, setAero, bladeY: eggTop(-0.6) + 0.04, canardY: (z) => (z > 0 ? c.arch(z) + 0.08 : eggTop(z) * 0.5 + 0.2), triangles: tris, mount: { single: nozzle } };
}

// ───────────────────────── クローバー（WESTMERE）: 街角のラリー小僧（ホットハッチ） ─────────────────────────
// 背の高い箱型のキャビン（大きなガラス）、短いボンネット、角ばったオーバーフェンダー、屋根の後ろの緑の翼、
// 中央を通る2本の緑のストライプ、ドアの斜めの帯、緑のミラー。後ろの中央はブースターの収まる箱型の凹み。
// エアロ: 左右の外板（フェンダーごと）が外へずれてワイドボディになり、屋根の翼が支柱で持ち上がって後ろへ伸びる
function clover(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const p4 = c.boostKind === 'pod4';
  // 中央の胴（幅はタイヤの内側まで）: ボンネット〜後ろの面
  const hw = 0.46;
  const rows = [
    [1.28, 0.2, 0.24],
    [1.14, 0.29, 0.33],
    [0.9, 0.33, 0.375],
    [0.66, 0.34, 0.385],
    [-0.6, 0.34, 0.42],
    [-0.77, 0.33, 0.41],
  ].map(([z, yS, yC]) => [Z(z), yS, yC]);
  k.hull('body', rows.map(([z, yS, yC]) => ({ z, half: [[0, b], [hw, b], [hw, b + yS], [hw - 0.06, b + yC - 0.01], [0, b + yC]] as P2[] })));
  // 2本の緑のストライプ（ボンネット・屋根・後ろの面）
  stripe(k, 'accent', rows.slice(0, 4).map(([z, , yC]) => [z, b + yC - 0.004] as [number, number]), 0.03, 0.1, 0.007);
  // キャビン: 大きなガラスと平らな屋根。4連ポッドのときは屋根を短くしてレールを避ける
  const rz = p4 ? -0.36 : -0.6;
  const roofY = 0.68;
  const cab = [[0.66, 0.42, 0.34, 0.39], [0.3, 0.47, 0.42, roofY], [rz, 0.47, 0.42, roofY], [p4 ? rz - 0.18 : -0.74, 0.45, 0.4, 0.45]];
  k.hull('glass', cab.map(([z, w0, w1, t]) => ({ z, half: [[0, b + 0.34], [w0, b + 0.34], [w1, b + t - 0.01], [0, b + t]] as P2[] })));
  const roof = [[0.32, 0.4], [rz + 0.01, 0.41]];
  k.hull('body', roof.map(([z, w]) => ({ z, half: [[0, b + roofY - 0.012], [w + 0.01, b + roofY - 0.012], [w - 0.02, b + roofY + 0.025], [0, b + roofY + 0.03]] as P2[] })));
  stripe(k, 'accent', roof.map(([z]) => [z, b + roofY + 0.028] as [number, number]), 0.03, 0.1, 0.006);
  // 柱（屋根と同じ色）: 窓の真ん中と後ろの角
  for (const [z0, z1] of [[-0.02, -0.09], [rz + 0.02, rz - 0.05]]) k.box('body', 0.405, 0.475, b + 0.34, b + roofY - 0.005, z0, z1, 0.008, true);
  k.box('black', 0.3, 0.44, b + roofY - 0.06, b + roofY - 0.01, 0.32, 0.28, 0.004, true); // 窓の上の黒い帯
  // 後ろの面: 2本のストライプ、ハッチの線、中央の黒いディフューザー（ブースターの凹み）
  facePlate(k, 'accent', -0.787, -0.768, [[0.03, b + 0.16], [0.1, b + 0.16], [0.1, b + 0.375], [0.03, b + 0.375]]);
  k.box('black', 0, 0.36, b - 0.03, b + 0.1, -0.795, -0.77, 0.006, true);
  for (const x of [0.1, 0.2, 0.3]) k.box('black', x - 0.012, x + 0.012, b - 0.06, b + 0.0, -0.8, -0.86, 0.004, true);
  // 顔: 中央の黒いハニカムのグリル（格子は差し色の細い棒）、丸みのある前照灯
  facePlate(k, 'black', Z(1.28) - 0.004, Z(1.28) + 0.012, [[0, b + 0.01], [0.3, b + 0.01], [0.33, b + 0.12], [0, b + 0.12]]);
  for (const y of [0.04, 0.08]) facePlate(k, 'body', Z(1.28) + 0.01, Z(1.28) + 0.016, [[0, b + y], [0.31, b + y], [0.31, b + y + 0.008], [0, b + y + 0.008]]);
  facePlate(k, 'black', Z(1.28) - 0.004, Z(1.28) + 0.01, [[0.3, b + 0.14], [0.45, b + 0.14], [0.45, b + 0.19], [0.32, b + 0.2]]);
  facePlate(k, 'head', Z(1.28) + 0.004, Z(1.28) + 0.016, [[0.34, b + 0.15], [0.43, b + 0.15], [0.43, b + 0.18], [0.35, b + 0.185]]);
  facePlate(k, 'accent', Z(1.28) - 0.004, Z(1.28) + 0.014, [[0.16, b - 0.03], [0.2, b - 0.03], [0.22, b + 0.03], [0.18, b + 0.03]]);
  // ボンネットの左右の黒い通気口
  {
    const z = Z(0.95);
    const y = b + tab(rows.map(([zz, , yC]) => [zz, yC] as [number, number]), z);
    k.box('black', 0.22, 0.32, y - 0.02, y + 0.004, z, z - 0.08, 0.004, true);
  }

  // 外板（左右）: フェンダーとドア。角ばったオーバーフェンダーがタイヤをまたぐ
  const xF = Math.min(0.88, c.wxOut + 0.06);
  const xD = 0.7;
  const zMax = Math.max(Z(1.26), c.frontEdge + 0.06);
  const zMin = Math.min(-1.04, c.rearEdge - 0.05);
  const xOut = (z: number) => tab([[zMax, xF - 0.05], [c.frontEdge - 0.08, xF], [c.gapF, xF], [c.gapF - 0.06, xD], [c.gapR + 0.06, xD], [c.gapR, xF], [zMin, xF - 0.02]], z);
  const top = (z: number) => tab([[zMax, b + 0.24], [zMax - 0.12, b + 0.33], [c.gapF, b + 0.35], [c.gapR, b + 0.36], [zMin + 0.1, b + 0.37], [zMin, b + 0.33]], z);
  const panelTop = (z: number) => Math.max(top(z), c.arch(z, 0.035, true) + 0.035);
  const panels = [-1, 1].map((side) => {
    const pk = new Kit();
    cowl(pk, c, { zMin, zMax, xOut, top, poly: true, skin: 0.035, gap: 0.035, ch: 0.05, lipK: 1.4, mirror: false });
    // ドアの斜めの緑の帯
    const z1 = c.gapF - 0.06, z0 = c.gapR + 0.06;
    if (z1 - z0 > 0.15) sidePlate(pk, 'accent', xD - 0.002, [[z1, b + 0.02], [z1, b + 0.07], [z0, b + 0.2], [z0, b + 0.12]], 0.01, false);
    // ミラー
    pk.box('accent', 0.5, 0.64, b + 0.38, b + 0.44, 0.62, 0.54, 0.012);
    // 後ろの角の縦長のテールランプ
    facePlate(pk, 'lamp', zMin - 0.012, zMin + 0.01, [[0.5, b + 0.14], [xF - 0.06, b + 0.14], [xF - 0.06, b + 0.32], [0.5, b + 0.32]], false);
    facePlate(pk, 'black', zMin - 0.008, zMin + 0.01, [[0.38, b - 0.02], [xF - 0.04, b - 0.02], [xF - 0.04, b + 0.08], [0.38, b + 0.08]], false);
    // 前の角の黒い吸気口
    facePlate(pk, 'black', zMax - 0.004, zMax + 0.01, [[0.48, b + 0.0], [xF - 0.1, b + 0.0], [xF - 0.1, b + 0.09], [0.48, b + 0.09]], false);
    if (side < 0) flipKitX(pk);
    return { ...rig(pk, c, [0, b, 0]), side };
  });
  // 屋根の後ろの緑の翼（端板つき）。エアロで支柱が伸びて持ち上がり、後ろへ伸びる
  const sp: V3 = [0, b + roofY + 0.03, rz + 0.05];
  const wk = new Kit();
  wk.plate('accent', 'y', 0, 0.022, [[-0.42, 0.05], [0.42, 0.05], [0.42, -0.12], [-0.42, -0.12]], 0.006);
  for (const s of [-1, 1]) wk.plate('accent', 'x', s * 0.42 - 0.014, s * 0.42 + 0.014, [[0.06, -0.025], [-0.13, -0.025], [-0.15, 0.08], [0.03, 0.065]], 0.005);
  const spoiler = rig(wk, c, sp, undefined, true);
  const stays = strutSet(c, [[-0.24, rz + 0.0], [0.24, rz + 0.0]], 0.03, 0.05);
  stays.position.set(0, sp[1] - 0.01, 0);
  const lift = p4 ? 0.2 : 0.15;
  const back = p4 ? 0.02 : 0.1;
  const { group, tris } = finish(c, k, [...panels.map((p) => p.group), spoiler.group, stays], [...panels, spoiler], [[xD + 0.004, b + 0.17, (c.gapF + c.gapR) / 2 + 0.05, 0]], panels[1]);
  // ゼッケンは外板と一緒に動く（finish が右の外板に付ける。左の分も右に入るので左へ移す）
  const plates = panels[1].group.children.filter((o) => (o as THREE.Mesh).material === c.numberMat && o.position.x < 0);
  for (const p of plates) {
    panels[1].group.remove(p);
    panels[0].group.add(p);
  }
  const reach = Math.max(0.02, Math.min(0.07, 0.93 - xF));
  const setAero = (a: number) => {
    const e = ease(a);
    for (const p of panels) p.group.position.x = p.side * reach * e;
    const e2 = ease((a - 0.15) / 0.85);
    spoiler.group.position.set(0, sp[1] + lift * e2, sp[2] - back * e2);
    spoiler.group.rotation.x = -0.22 * e2;
    stays.visible = e2 > 0.02;
    stays.position.z = -back * e2;
    stays.scale.y = Math.max(0.001, lift * e2 + 0.01);
  };
  setAero(0);
  // 大型シングルは屋根の上でなく、ハッチの後ろの甲板に寝かせて載せる（屋根の翼の下をくぐる高さ）
  const single = { auto: false, dy: b + 0.57 - (c.deckY + 0.5), dz: 0.3, pads: [[-0.075, 0.075, b + 0.38, b + 0.44, -0.95, -0.66]] as [number, number, number, number, number, number][] };
  return { group, setAero, bladeY: b + 0.42, canardY: (z) => panelTop(z) + 0.03, triangles: tris, mount: { single } };
}

// ───────────────────────── アイボリー（IRONRIDGE）: 大陸の白い弾丸（ロングノーズのGT） ─────────────────────────
// 長いボンネット（中央に盛り上がった吸気口と赤い帯）、後ろに寄せたキャビン、盛り上がった前後のフェンダー、
// 横一文字の黒いグリルと細い前照灯、フェンダーの黒い縦の通気口、後ろのダックテール、赤い細い線。
// エアロ: ボンネットの吸気口が前を上げて大きく口を開け、ダックテールが2本の腕で持ち上がって大きな翼になる
function ivory(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const p2 = c.boostKind === 'pod2';
  const p4 = c.boostKind === 'pod4';
  const deck = p2 ? 0.37 : 0.43;
  // 中央の胴: [z, 半幅, 肩, 中段, 中央]
  const rows = [
    [1.36, 0.4, 0.15, 0.185, 0.2],
    [1.2, 0.42, 0.21, 0.26, 0.28],
    [0.9, 0.42, 0.24, 0.3, 0.32],
    [0.3, 0.42, 0.26, 0.32, 0.34],
    [-0.5, 0.42, deck - 0.08, deck - 0.02, deck],
    [-0.77, 0.42, deck - 0.1, deck - 0.02, deck],
  ].map(([z, ...v]) => [Z(z), ...v]);
  k.hull('body', rows.map(([z, ...v]) => ({ z, half: ridge(v, b) })));
  const hoodY = (z: number) => b + rowAt(rows, z)[3];
  // フェンダー: 前後が盛り上がり、ドアの所でくびれる
  const xMax = Math.min(0.9, c.wxOut + 0.06);
  const xW = 0.66;
  const zMax = Math.max(Z(1.3), c.frontEdge + 0.05);
  const zMin = Math.min(-1.06, c.rearEdge - 0.05);
  const xOut = (z: number) => tab([[zMax, xMax - 0.04], [c.axF[1], xMax], [c.gapF, xMax], [c.gapF - 0.1, xW], [c.gapR + 0.1, xW], [c.gapR, xMax], [zMin, xMax - 0.03]], z);
  const skin = p2 ? 0.02 : 0.035;
  const pF = c.peak(c.axF[1], 0.03, skin);
  const pR = c.peak(c.axR[0], 0.03, skin) + (p2 ? 0 : 0.03);
  const top = (z: number) => tab([[zMax, b + 0.22], [c.axF[1] + 0.2, pF - 0.01], [c.axF[1], pF], [c.gapF - 0.06, b + 0.34], [c.gapR + 0.06, b + 0.35], [c.axR[1], pR], [c.axR[0] - 0.12, pR], [zMin, pR - 0.05]], z);
  const podTop = (z: number) => Math.max(top(z), c.arch(z, 0.03) + skin);
  cowl(k, c, { zMin, zMax, xOut, top, skin, ch: 0.11, xIn: 0.34 });
  // キャビン（後ろに寄せた低い温室）と屋根
  const cab = [[0.22, 0.44, 0.33, 0.36], [-0.02, 0.46, 0.37, 0.58], [-0.36, 0.46, 0.37, 0.58], [-0.6, 0.42, 0.32, deck + 0.03]];
  k.hull('glass', cab.map(([z, w0, w1, t]) => ({ z, half: [[0, b + 0.3], [w0, b + 0.3], [w1, b + t - 0.03], [w1 * 0.5, b + t - 0.005], [0, b + t]] as P2[] })));
  k.hull('body', [[-0.0, 0.35], [-0.38, 0.35]].map(([z, w]) => ({ z, half: [[0, b + 0.565], [w, b + 0.565], [w - 0.03, b + 0.592], [0, b + 0.598]] as P2[] })));
  // 顔: 横一文字の黒いグリル（左右へ回り込む）、上の細い前照灯、角の縦のスリット
  const fz = Z(1.36);
  facePlate(k, 'black', fz - 0.004, fz + 0.012, [[0, b + 0.02], [0.4, b + 0.02], [0.4, b + 0.135], [0, b + 0.15]]);
  for (const y of [0.05, 0.09]) facePlate(k, 'body', fz + 0.01, fz + 0.016, [[0, b + y], [0.38, b + y], [0.38, b + y + 0.007], [0, b + y + 0.007]]);
  facePlate(k, 'head', fz + 0.01, fz + 0.02, [[0.12, b + 0.12], [0.36, b + 0.115], [0.36, b + 0.13], [0.12, b + 0.136]]);
  facePlate(k, 'black', zMax - 0.004, zMax + 0.012, [[0.36, b + 0.02], [xMax - 0.12, b + 0.02], [xMax - 0.12, b + 0.13], [0.36, b + 0.135]]);
  facePlate(k, 'head', zMax + 0.008, zMax + 0.018, [[0.42, b + 0.115], [xMax - 0.14, b + 0.11], [xMax - 0.14, b + 0.124], [0.42, b + 0.13]]);
  facePlate(k, 'black', zMax - 0.004, zMax + 0.012, [[xMax - 0.1, b + 0.03], [xMax - 0.075, b + 0.03], [xMax - 0.075, b + 0.15], [xMax - 0.1, b + 0.15]]);
  // フェンダーの黒い縦の通気口（前輪の後ろ・後輪の前）と赤い細い線（肩・敷居）
  sidePlate(k, 'black', xMax - 0.003, [[c.gapF + 0.12, b + 0.14], [c.gapF + 0.06, b + 0.14], [c.gapF + 0.02, b + 0.3], [c.gapF + 0.08, b + 0.3]], 0.012);
  sidePlate(k, 'black', xMax - 0.003, [[c.gapR - 0.02, b + 0.14], [c.gapR - 0.07, b + 0.14], [c.gapR - 0.1, b + 0.3], [c.gapR - 0.05, b + 0.3]], 0.012);
  if (c.gapF - c.gapR > 0.3) {
    sidePlate(k, 'accent', xW - 0.003, [[c.gapF - 0.1, b + 0.03], [c.gapR + 0.1, b + 0.03], [c.gapR + 0.1, b + 0.048], [c.gapF - 0.1, b + 0.048]], 0.01);
    sidePlate(k, 'accent', xW - 0.003, [[c.gapF - 0.1, b + 0.225], [c.gapR + 0.1, b + 0.245], [c.gapR + 0.1, b + 0.258], [c.gapF - 0.1, b + 0.238]], 0.01);
  }
  // 吸気口の下の黒い穴（吸気口が持ち上がると見える）
  k.hull('black', [[Z(1.06), 0.12], [0.4, 0.14]].map(([z, w]) => ({ z, half: [[0, hoodY(z) - 0.01], [w, hoodY(z) - 0.01], [w, hoodY(z) + 0.004], [0, hoodY(z) + 0.006]] as P2[] })));
  // 後ろ: 横長の赤いランプ（中央とフェンダー）、黒い下の面、角の縦の通気口
  k.box('lamp', 0.1, 0.36, b + deck - 0.13, b + deck - 0.1, -0.787, -0.768, 0.004, true);
  k.box('black', 0, 0.42, b - 0.02, b + 0.14, -0.792, -0.768, 0.006, true);
  k.box('lamp', 0.16, 0.3, b + 0.07, b + 0.1, -0.797, -0.788, 0.003, true);
  const rx = xMax - 0.06;
  facePlate(k, 'lamp', zMin - 0.012, zMin + 0.01, [[0.38, pR - 0.16], [rx, pR - 0.16], [rx, pR - 0.13], [0.38, pR - 0.13]]);
  facePlate(k, 'black', zMin - 0.01, zMin + 0.01, [[0.36, b - 0.01], [rx + 0.02, b - 0.01], [rx + 0.02, b + 0.14], [0.36, b + 0.14]]);
  facePlate(k, 'black', zMin - 0.014, zMin + 0.01, [[rx - 0.02, b + 0.16], [rx + 0.005, b + 0.16], [rx + 0.005, pR - 0.18], [rx - 0.02, pR - 0.18]]);

  // ボンネットの吸気口（前を上げて口を開ける）
  const sz0 = Z(1.06), sz1 = 0.34;
  const sq = new Kit();
  sq.hull('body', [[sz0, 0.08, 0.035], [sz0 - 0.08, 0.13, 0.065], [sz1, 0.15, 0.075]].map(([z, w, h]) => {
    const y = hoodY(z) - 0.02;
    return { z, half: [[0, y], [w, y], [w, y + h * 0.7], [w * 0.7, y + h], [0, y + h + 0.004]] as P2[] };
  }));
  stripe(sq, 'accent', [[sz0 - 0.02, hoodY(sz0) + 0.017], [sz0 - 0.08, hoodY(sz0 - 0.08) + 0.048], [sz1 + 0.02, hoodY(sz1) + 0.057]], 0, 0.06, 0.006);
  facePlate(sq, 'black', sz0 - 0.004, sz0 + 0.004, [[0, hoodY(sz0) - 0.012], [0.07, hoodY(sz0) - 0.012], [0.07, hoodY(sz0) + 0.01], [0, hoodY(sz0) + 0.014]]);
  const scoop = rig(sq, c, [0, hoodY(sz1), sz1]);
  // ダックテール（後ろの甲板の跳ね上げ）。エアロで腕が伸びて持ち上がり、迎え角がつく
  const tw = p2 ? 0.24 : 0.6;
  const dp: V3 = [0, b + deck, -0.6];
  const dk = new Kit();
  const dprof: P2[] = [[0.0, 0.0], [-0.23, 0.0], [-0.27, 0.07], [-0.03, 0.022]];
  dk.sweep('body', 'x', [{ s: -tw, pts: inset(dprof, 0.012) }, { s: -tw + 0.02, pts: dprof }, { s: tw - 0.02, pts: dprof }, { s: tw, pts: inset(dprof, 0.012) }]);
  dk.plate('accent', 'x', -tw + 0.02, tw - 0.02, [[-0.24, 0.054], [-0.27, 0.072], [-0.276, 0.064], [-0.248, 0.046]], 0.003);
  const duck = rig(dk, c, dp, undefined, true);
  const arms = strutSet(c, [[-0.2, -0.7], [0.2, -0.7]], 0.03, 0.06);
  arms.position.set(0, dp[1] - 0.01, 0);
  const wingLift = p4 ? 0.33 : c.boostKind === 'single' ? 0.44 : 0.27; // 大型シングルのときはその上を越える
  const { group, tris } = finish(c, k, [scoop.group, duck.group, arms], [scoop, duck], [[xW + 0.004, b + 0.14, (c.gapF + c.gapR) / 2 + 0.04, 0]]);
  const setAero = (a: number) => {
    const e = ease(a);
    scoop.group.position.y = hoodY(sz1) + 0.03 * e;
    scoop.group.rotation.x = -0.2 * ease((a - 0.1) / 0.6);
    const l = wingLift * ease(a * 1.3);
    duck.group.position.y = dp[1] + l;
    duck.group.rotation.x = 0.2 * ease((a - 0.4) / 0.6);
    arms.visible = l > 0.005;
    arms.scale.y = Math.max(0.001, l + 0.015);
  };
  setAero(0);
  return { group, setAero, bladeY: Math.max(pR, b + deck) + 0.04, canardY: (z) => podTop(z) + 0.03, triangles: tris };
}

// ───────────────────────── リージェント（NORDVEIL）: 黒い近衛（北の夜を走る重厚なGT） ─────────────────────────
// 背の高いワイドボディのファストバック、角ばったオーバーフェンダー、金の六角の縁取りに縦格子のグリル、
// 屋根の金の2本線、前輪の後ろの金のエラ、敷居の金の刃。後ろは横一文字のランプと金の枠のディフューザー。
// エアロ: ドアがガルウイングのように上へ開いて（中の金の骨が見える）壁際の空気をつかみ、
// 背中の背びれが左右に割れて倒れ、翼になる
function regent(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  const p2 = c.boostKind === 'pod2';
  const p4 = c.boostKind === 'pod4';
  const deck = p2 ? 0.38 : 0.44;
  const rows = [
    [1.34, 0.4, 0.15, 0.2, 0.22],
    [1.16, 0.42, 0.22, 0.28, 0.3],
    [0.8, 0.42, 0.24, 0.31, 0.33],
    [0.3, 0.42, 0.25, 0.32, 0.34],
    [-0.5, 0.42, deck - 0.08, deck - 0.02, deck],
    [-0.77, 0.42, deck - 0.1, deck - 0.03, deck - 0.02],
  ].map(([z, ...v]) => [Z(z), ...v]);
  k.hull('body', rows.map(([z, ...v]) => ({ z, half: ridge(v, b) })));
  // ワイドボディ: 角ばったオーバーフェンダー
  const xMax = Math.min(0.9, c.wxOut + 0.08);
  const xW = 0.68;
  const zMax = Math.max(Z(1.3), c.frontEdge + 0.05);
  const zMin = Math.min(-1.06, c.rearEdge - 0.05);
  const xOut = (z: number) => tab([[zMax, xMax - 0.05], [c.axF[1], xMax], [c.gapF, xMax], [c.gapF - 0.08, xW], [c.gapR + 0.08, xW], [c.gapR, xMax], [zMin, xMax - 0.03]], z);
  const skin = p2 ? 0.02 : 0.045;
  const top = (z: number) => tab([[zMax, b + 0.22], [zMax - 0.15, b + 0.3], [c.gapF, b + 0.33], [c.gapR, b + 0.34], [zMin + 0.12, b + 0.35], [zMin, b + 0.3]], z);
  const podTop = (z: number) => Math.max(top(z), c.arch(z, 0.03, true) + skin);
  cowl(k, c, { zMin, zMax, xOut, top, skin, poly: true, ch: 0.08, xIn: 0.34, lipK: 1.12 });
  // キャビン: 背の高いファストバック。4連ポッドのときは後ろを早めに下げる
  const rz = p4 ? -0.28 : -0.38;
  const cab = [[0.44, 0.44, 0.34, 0.37], [0.18, 0.47, 0.38, 0.66], [rz, 0.47, 0.38, 0.67], [-0.68, 0.43, 0.32, deck + 0.02]];
  k.hull('glass', cab.map(([z, w0, w1, t]) => ({ z, half: [[0, b + 0.3], [w0, b + 0.3], [w1, b + t - 0.03], [w1 * 0.5, b + t - 0.005], [0, b + t]] as P2[] })));
  const roof = [[0.2, 0.36, 0.645], [rz, 0.37, 0.655], [-0.62, 0.3, deck + 0.025]];
  k.hull('body', roof.map(([z, w, y]) => ({ z, half: [[0, b + y - 0.01], [w, b + y - 0.01], [w - 0.03, b + y + 0.02], [0, b + y + 0.025]] as P2[] })));
  // 屋根の金の2本線（ファストバックの後ろまで）
  stripe(k, 'accent', roof.map(([z, w, y]) => [z, b + y + 0.012 - (w > 0.3 ? 0 : 0.004)] as [number, number]), 0.19, 0.22, 0.01);
  // 顔: 金の六角の縁＋黒い中＋金の縦格子、細い前照灯、金で縁取った角の吸気口
  const fz = Z(1.34);
  const hex = (d: number): P2[] => [[-0.22 + d, b + 0.02 + d], [0.22 - d, b + 0.02 + d], [0.29 - d, b + 0.115], [0.25 - d, b + 0.21 - d], [-0.25 + d, b + 0.21 - d], [-0.29 + d, b + 0.115]];
  facePlate(k, 'accent', fz - 0.004, fz + 0.012, hex(0), false);
  facePlate(k, 'black', fz + 0.004, fz + 0.02, hex(0.025), false);
  for (let i = -3; i <= 3; i++) facePlate(k, 'accent', fz + 0.016, fz + 0.026, [[i * 0.06 - 0.008, b + 0.06], [i * 0.06 + 0.008, b + 0.06], [i * 0.06 + 0.008, b + 0.175], [i * 0.06 - 0.008, b + 0.175]], false);
  facePlate(k, 'head', zMax - 0.004, zMax + 0.014, [[0.4, b + 0.2], [xMax - 0.08, b + 0.17], [xMax - 0.08, b + 0.19], [0.42, b + 0.222]]);
  facePlate(k, 'black', zMax - 0.004, zMax + 0.01, [[0.4, b + 0.0], [xMax - 0.08, b + 0.0], [xMax - 0.08, b + 0.12], [0.42, b + 0.12]]);
  facePlate(k, 'accent', zMax - 0.004, zMax + 0.016, [[0.38, b - 0.02], [0.44, b - 0.02], [0.44, b + 0.0], [0.4, b + 0.06], [0.38, b + 0.06]]);
  facePlate(k, 'accent', zMax - 0.004, zMax + 0.016, [[xMax - 0.14, b - 0.02], [xMax - 0.06, b - 0.02], [xMax - 0.06, b + 0.06], [xMax - 0.08, b + 0.06]]);
  // ボンネットの黒い吸気の盛り上がり
  {
    const hy = (z: number) => b + rowAt(rows, z)[3];
    k.hull('black', [[Z(1.02), 0.12, 0.0], [Z(0.9), 0.15, 0.03], [0.62, 0.15, 0.035]].map(([z, w, h]) => ({ z, half: [[0, hy(z) - 0.012], [w, hy(z) - 0.012], [w - 0.02, hy(z) + h], [0, hy(z) + h + 0.004]] as P2[] })));
  }
  // 前輪の後ろの金のエラ（3枚）と敷居の金の刃
  for (let i = 0; i < 3; i++) {
    const z = c.gapF + 0.13 - i * 0.045;
    sidePlate(k, 'accent', xMax - 0.004, [[z, b + 0.17], [z - 0.025, b + 0.17], [z - 0.045, b + 0.3], [z - 0.02, b + 0.3]], 0.014);
  }
  const dz1 = c.gapF - 0.08, dz0 = c.gapR + 0.08;
  if (dz1 - dz0 > 0.12) {
    sidePlate(k, 'accent', xW, [[dz1 + 0.02, b - 0.02], [dz0, b - 0.02], [dz0 + 0.04, b + 0.035], [dz1 - 0.04, b + 0.035]], 0.016);
    // ドアの下の黒い枠と金の骨（ドアが開くと見える）
    sidePlate(k, 'black', xW - 0.004, [[dz1, b + 0.31], [dz0, b + 0.31], [dz0, b + 0.06], [dz1 - 0.05, b + 0.06]], 0.012);
    for (let i = 1; i <= 3; i++) {
      const z = dz1 - ((dz1 - dz0) * i) / 4;
      sidePlate(k, 'accent', xW + 0.008, [[z + 0.012, b + 0.08], [z - 0.012, b + 0.08], [z - 0.012, b + 0.29], [z + 0.012, b + 0.29]], 0.006);
    }
  }
  // 後ろ: 横一文字のランプ、黒いディフューザーと金のΠ形の枠
  k.box('lamp', 0.06, 0.4, b + deck - 0.14, b + deck - 0.11, -0.787, -0.768, 0.004, true);
  k.box('black', 0, 0.42, b - 0.02, b + deck - 0.18, -0.792, -0.768, 0.006, true);
  const rx = xMax - 0.06;
  facePlate(k, 'lamp', zMin - 0.012, zMin + 0.01, [[0.36, b + 0.2], [rx, b + 0.215], [rx, b + 0.245], [0.36, b + 0.23]]);
  facePlate(k, 'black', zMin - 0.01, zMin + 0.01, [[0.36, b - 0.01], [rx + 0.02, b - 0.01], [rx + 0.02, b + 0.15], [0.36, b + 0.15]]);
  facePlate(k, 'accent', zMin - 0.016, zMin + 0.01, [[0.44, b - 0.01], [0.47, b - 0.01], [0.47, b + 0.1], [rx - 0.03, b + 0.1], [rx - 0.03, b - 0.01], [rx, b - 0.01], [rx, b + 0.13], [0.44, b + 0.13]]);

  // ドア（左右）: 上の縁を軸にガルウイングのように開く
  const doors = dz1 - dz0 > 0.12
    ? [-1, 1].map((side) => {
        const d = new Kit();
        d.plate('body', 'x', xW + 0.006, xW + 0.028, [[dz1 + 0.01, b + 0.31], [dz0, b + 0.31], [dz0, b + 0.055], [dz1 - 0.05, b + 0.055]], 0.008);
        d.plate('accent', 'x', xW + 0.026, xW + 0.032, [[dz1 - 0.06, b + 0.085], [dz0 + 0.04, b + 0.085], [dz0 + 0.04, b + 0.1], [dz1 - 0.07, b + 0.1]], 0.002);
        if (side < 0) flipKitX(d);
        return { ...rig(d, c, [side * (xW + 0.017), b + 0.31, 0]), side };
      })
    : [];
  // 背びれ（2枚を背中合わせ）: エアロで持ち上がり、左右へ倒れて翼になる
  const fy = b + deck + 0.01;
  const finH = 0.28;
  const halves = [-1, 1].map((side) => {
    const f = new Kit();
    f.plate('black', 'x', 0.0, 0.016, [[-0.42, 0], [-0.74, 0], [-0.76, finH], [-0.5, finH * 0.82]], 0.005);
    f.plate('accent', 'x', -0.002, 0.018, [[-0.74, finH * 0.86], [-0.76, finH * 0.86], [-0.762, finH + 0.004], [-0.69, finH * 0.98]], 0.003);
    if (side < 0) flipKitX(f);
    return { ...rig(f, c, [0, fy, 0], undefined, true), side };
  });
  const finLift = p4 ? 0.3 : 0.2;
  const stalk = strutSet(c, [[0, -0.6]], 0.03, 0.22);
  stalk.position.y = fy - 0.02;
  const { group, tris } = finish(c, k, [...doors.map((d) => d.group), ...halves.map((h) => h.group), stalk], [...doors, ...halves], [[xMax + 0.002, podTop(c.rearAxle) - 0.13, c.rearAxle, 0]]);
  const setAero = (a: number) => {
    const e = ease(a);
    for (const d of doors) d.group.rotation.z = d.side * 0.95 * e;
    const e1 = ease(a / 0.5);
    const e2 = ease((a - 0.35) / 0.65);
    for (const h of halves) {
      h.group.position.y = fy + finLift * e1;
      h.group.rotation.z = -h.side * (Math.PI / 2 - 0.12) * e2;
    }
    stalk.visible = e1 > 0.02;
    stalk.scale.y = Math.max(0.001, finLift * e1 + 0.02);
  };
  setAero(0);
  return { group, setAero, bladeY: Math.max(podTop(-0.9), b + deck) + 0.03, canardY: (z) => podTop(z) + 0.03, triangles: tris, mountIgnore: halves.map((h) => h.group),
    // 4連ポッドのレールは背びれ（z -0.42〜-0.76）より後ろへずらし、背びれがレールを突き抜けないようにする
    mount: { pod4: { dz: -0.2 } } };
}

const DESIGNS: Record<string, (c: C) => DesignedBody> = { slider, twin, cyclone, wallrunner, shifter, stormShifter, vector, crimson, pearl, clover, ivory, regent };
// 差し色（ボディごとに1つ）
export const ACCENT: Record<string, number> = {
  slider: 0xd9b25c, // シャンパンゴールド
  twin: 0xf2f2f2, // 白
  cyclone: 0x7fe3ff, // 氷の水色
  wallrunner: 0xf2c230, // 注意の黄色
  shifter: 0x1d2c6b, // 紺
  stormShifter: 0xb9c0ca, // チタン
  vector: 0xc6f23a, // ライム
  crimson: 0xeadcc6, // 骨のようなクリーム
  pearl: 0x2ec8ec, // 水色
  clover: 0x1f8f45, // 深い緑
  ivory: 0xa8142c, // 深い赤
  regent: 0xd2a447, // 金
};
// 車体色と近すぎるときの差し色（黄色の車体に黄色の注意帯、白い車体に白い板…にならないように）
const ACCENT_ALT: Record<string, number> = {
  slider: 0xc8ccd2, // 銀
  twin: 0x2a2c30, // 黒
  cyclone: 0x2f6fd6, // 青
  wallrunner: 0x26282d, // 黒（黄色の車体なら黒の注意帯）
  shifter: 0x58d8ff, // 水色
  stormShifter: 0x50565f, // ガンメタ
  vector: 0x3ad8ff, // 水色（黄・緑の車体）
  crimson: 0x2a2c30, // 黒（白い車体）
  pearl: 0xf2f4f6, // 白（青い車体）
  clover: 0xf2f4f6, // 白（緑の車体）
  ivory: 0xf2eee4, // アイボリー（赤い車体）
  regent: 0x26282d, // 黒（黄・橙の車体）
};
const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const dist = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const dark = (h: number) => {
  const [r, g, b] = rgb(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
};
export const accentFor = (id: string, color: number) => {
  const a = ACCENT[id] ?? 0xf2f2f2;
  return dist(a, color) < 110 ? ACCENT_ALT[id] ?? a : a;
};
export const isDesignedBody = (id: string) => id in DESIGNS;
// 固定ボディ（エアロで形を変えない車）。店長決定 2026-11-11: メーカー別の系譜で固定とされた6台は可動を外す。
// 可動の作り自体は各デザインに残してあり、この表から外せば元どおり動く。ブースターの格納・せり出しは別の仕組みなので固定車でも動く
export const FIXED_BODIES: ReadonlySet<string> = new Set(['wallrunner', 'vector', 'pearl', 'clover', 'ivory', 'regent']);
export const isFixedBody = (id: string) => FIXED_BODIES.has(id);
export function buildDesignedBody(id: string, ctx: BodyCtx): DesignedBody {
  ctx.accent.color.setHex(accentFor(id, ctx.color));
  const d = DESIGNS[id](derive(ctx));
  if (!isFixedBody(id)) return d;
  d.setAero(0);
  return { ...d, setAero: () => {} };
}
