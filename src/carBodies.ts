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
type Key = 'body' | 'black' | 'accent' | 'glass' | 'lamp';
type Station = { s: number; pts: P2[] };

// 共有の材質（車ごとに変わらないもの）
const BLACK = new THREE.MeshLambertMaterial({ color: 0x17191e });
const GLASS = new THREE.MeshLambertMaterial({ color: 0x0f1c28, emissive: 0x06121c, transparent: true, opacity: 0.84 });
// 車体色が黒いときは骨格をガンメタ、風防を少し明るい青にして、形が黒に沈まないようにする
const GUNMETAL = new THREE.MeshLambertMaterial({ color: 0x4a505b });
const GLASS_LIGHT = new THREE.MeshLambertMaterial({ color: 0x24425e, emissive: 0x0a1a2a, transparent: true, opacity: 0.86 });

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
      ? { body: ctx.bodyMat, black: GUNMETAL, accent: ctx.accent, glass: GLASS_LIGHT, lamp: ctx.tailMat }
      : { body: ctx.bodyMat, black: BLACK, accent: ctx.accent, glass: GLASS, lamp: ctx.tailMat },
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
  const fs = o.poly ? [-1.45, -0.45, 0.45, 1.45] : [-1, -0.88, -0.55, 0, 0.55, 0.88, 1];
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

// 動く部品のまとまり: 支点 pivot（車体座標）を原点にした Group を作る。parent があればその支点からの相対位置に置く
function rig(k: Kit, c: C, pivot: V3, parent?: { group: THREE.Group; pivot: V3 }) {
  const group = new THREE.Group();
  for (const m of k.meshes(c.mats, pivot)) group.add(m);
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
// エアロ: 尾びれが支柱で持ち上がって外へ倒れ、後輪の上で水平の翼になる。ノーズ両脇の小翼が開く
function slider(c: C): DesignedBody {
  const k = new Kit();
  const { b, Z } = c;
  // 矢じりのノーズ（中央の稜線が立つ）
  k.hull('body', [
    [1.34, 0.025, 0.012, 0.02, 0.05],
    [1.14, 0.16, 0.0, 0.05, 0.15],
    [0.88, 0.27, 0.0, 0.08, 0.25],
    [0.6, 0.3, 0.0, 0.1, 0.3],
    [0.32, 0.22, 0.02, 0.08, 0.2],
  ].map(([z, w, y0, e, yr]) => ({ z: Z(z), half: [[0, b + y0], [w, b + y0], [w, b + y0 + e], [w * 0.45, b + yr - 0.02], [0, b + yr]] as P2[] })));
  // 中央の黒い谷（ノーズの後ろから後端まで）
  k.hull('black', [
    [0.66, 0.16, 0.14, 0.11],
    [0.3, 0.22, 0.24, 0.2],
    [-0.5, 0.22, 0.24, 0.2],
    [-0.78, 0.2, 0.2, 0.16],
  ].map(([z, w, ys, yc]) => ({ z, half: [[0, b], [w, b], [w, b + ys], [0, b + yc]] as P2[] })));
  // 左右の肩（稜線を立てた折り紙の面）
  const sh = (z: number, xi: number, xo: number, y0: number, yS: number, xr: number, yR: number, yI: number) => ({
    s: z,
    pts: [[xi, b + y0], [xo - 0.03, b + y0], [xo, b + y0 + 0.05], [xo - 0.01, b + yS], [xr, b + yR], [xi, b + yI]] as P2[],
  });
  k.sweep('body', 'z', [
    sh(Z(1.08), 0.15, 0.22, 0.02, 0.05, 0.19, 0.09, 0.06),
    sh(Z(0.8), 0.19, 0.43, 0.04, 0.16, 0.33, 0.3, 0.2),
    sh(0.3, 0.2, 0.46, 0.06, 0.2, 0.35, 0.4, 0.27),
    sh(-0.3, 0.2, 0.46, 0.06, 0.2, 0.36, 0.4, 0.27),
    sh(-0.7, 0.22, 0.46, 0.06, 0.17, 0.37, 0.31, 0.23),
    sh(-0.88, 0.31, 0.46, 0.06, 0.14, 0.39, 0.25, 0.19),
  ], true);
  // 肩の下の黒い面（横から見たときの黒い切れ込み）
  k.sweep('black', 'z', [0.75, 0.2, -0.86].map((z) => ({ s: z, pts: [[0.3, b - 0.03], [0.41, b - 0.03], [0.455, b + 0.02], [0.455, b + 0.075], [0.3, b + 0.075]] as P2[] })), true);
  // 肩の差し色（稜線の金のライン）
  k.sweep('accent', 'z', [Z(0.8), 0.3, -0.3, -0.7].map((z, i) => {
    const R: P2 = [[0.33, 0.35, 0.36, 0.37][i], b + [0.3, 0.4, 0.4, 0.31][i]];
    const S: P2 = [[0.42, 0.45, 0.45, 0.45][i], b + [0.16, 0.2, 0.2, 0.17][i]];
    const L = (u: number): P2 => [S[0] + (R[0] - S[0]) * u, S[1] + (R[1] - S[1]) * u];
    return { s: z, pts: strip(L(0.62), L(0.92), 0.007) };
  }), true);
  // 風防（低い）
  k.hull('glass', [
    [0.36, 0.05, 0.24],
    [0.16, 0.17, 0.42],
    [-0.12, 0.18, 0.42],
    [-0.34, 0.1, 0.27],
  ].map(([z, w, t]) => ({ z, half: [[0, b + 0.19], [w, b + 0.19], [w * 0.7, b + t - 0.06], [0, b + t]] as P2[] })));
  // テールランプ（肩の後ろの面）
  k.box('lamp', 0.32, 0.44, b + 0.12, b + 0.17, -0.895, -0.878, 0.004, true);
  // 車軸の間の横の刃（後ろへ跳ね上がる面。タイヤに当たる所で切れる）
  pod(k, 'body', c, {
    zMin: c.gapR - 0.1, zMax: c.gapF + 0.1, mode: 'cut', gap: 0.03,
    bot: () => b - 0.035,
    top: (z) => b + tab([[c.gapF + 0.1, 0.06], [c.gapR - 0.1, 0.2]], z),
    sec: (_z, bot, t) => [[0.44, bot], [0.53, bot], [0.6, bot + (t - bot) * 0.35], [0.5, t], [0.44, t]],
  });

  // 尾びれ（左右）: 外側の付け根の線（z 方向）を軸に倒れる
  const finX = 0.463;
  const finY = b + 0.13;
  const fins = [-1, 1].map((side) => {
    const f = new Kit();
    const prof: P2[] = [[-0.28, finY], [-0.98, finY], [-1.06, b + 0.66], [-0.9, b + 0.56], [-0.62, b + 0.3]];
    f.plate('body', 'x', finX - 0.011, finX + 0.011, prof, 0.008);
    f.plate('accent', 'x', finX - 0.014, finX + 0.014, [[-0.95, finY + 0.03], [-0.99, finY + 0.03], [-1.065, b + 0.66], [-1.025, b + 0.62]], 0.005);
    if (side < 0) flipKitX(f);
    return { ...rig(f, c, [side * finX, finY, 0]), side };
  });
  // 尾びれの支柱（持ち上がるときに見える）
  const stays = fins.flatMap(({ side }) => [-0.45, -0.85].map((z) => {
    const s = strut(c, 0.03, 0.05);
    s.position.set(side * finX, finY, z);
    return s;
  }));
  const finLift = Math.max(0.12, 2 * c.rearR + 0.08 - finY);
  // ノーズ両脇の小翼: 前寄りの付け根で開く（閉じているときはノーズに沿って後ろ向き）
  const wz = Z(1.13);
  const tireAt = c.axles.some(([za, r]) => wz - 0.2 < za + r + 0.03 && wz + 0.05 > za - r - 0.03);
  const span = tireAt ? 0.26 : 0.38;
  const wings = [-1, 1].map((side) => {
    const w = new Kit();
    w.plate('accent', 'y', b + 0.035, b + 0.055, [[0.17, wz + 0.03], [0.17, wz - 0.1], [0.17 + span, wz - 0.17], [0.17 + span, wz - 0.11]], 0.006);
    if (side < 0) flipKitX(w);
    return { ...rig(w, c, [side * 0.17, b + 0.045, wz]), side };
  });
  const { group, tris } = finish(c, k, [...fins.map((f) => f.group), ...stays, ...wings.map((w) => w.group)], [...fins, ...wings], [[0.474, b + 0.17, -0.12, 0.12]]);
  const setAero = (a: number) => {
    const lift = ease(a * 1.7) * finLift;
    const fold = ease((a - 0.3) / 0.7);
    for (const f of fins) {
      f.group.position.y = finY + lift;
      f.group.rotation.z = -f.side * (Math.PI / 2) * fold;
    }
    for (const s of stays) {
      s.visible = lift > 0.005;
      s.scale.y = Math.max(0.001, lift);
    }
    for (const w of wings) w.group.rotation.y = w.side * (1.3 - 1.5 * ease(a));
  };
  setAero(0);
  return { group, setAero, bladeY: b + 0.31, canardY: () => 0, triangles: tris };
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

  // 背中の2連の筒（腕の先）。腕は後ろの付け根を軸に起きる
  const pv: V3 = [0, b + 0.33, -0.42];
  const r = new Kit();
  const nx = 0.25, ny = b + 0.52;
  r.tube('body', nx, ny, [[-0.465, 0.095], [-0.41, 0.135], [-0.07, 0.14], [0.0, 0.115]], 8, true);
  r.tube('black', nx, ny, [[0.0, 0.105], [0.022, 0.09]], 8, true); // 前の吸気口
  r.tube('black', nx, ny, [[-0.505, 0.075], [-0.46, 0.09]], 8, true); // 後ろの噴射口
  r.tube('accent', nx, ny, [[-0.3, 0.145], [-0.25, 0.145]], 8, true); // 白い帯
  // 腕（筒と胴をつなぐ黒い板）
  r.box('black', nx - 0.03, nx + 0.03, b + 0.28, ny - 0.1, -0.36, -0.14, 0.008, true);
  const rg = rig(r, c, pv);
  // 白い安定板（筒の外上、z 方向の軸で外へ開く）
  const stabs = [-1, 1].map((side) => {
    const s = new Kit();
    s.plate('accent', 'x', nx + 0.075, nx + 0.09, [[-0.06, ny + 0.09], [-0.36, ny + 0.09], [-0.42, ny + 0.28], [-0.26, ny + 0.24]], 0.005);
    if (side < 0) flipKitX(s);
    return { ...rig(s, c, [side * (nx + 0.082), ny + 0.09, 0], rg), side };
  });
  const { group, tris } = finish(c, k, [rg.group], [rg, ...stabs], [[0.455, b + 0.24, -0.3, 0.25]]);
  const setAero = (a: number) => {
    const e = ease(a);
    rg.group.position.y = pv[1] + 0.13 * e;
    rg.group.rotation.x = -0.3 * e;
    for (const s of stabs) s.group.rotation.z = -s.side * 1.15 * ease((a - 0.2) / 0.8);
  };
  setAero(0);
  return { group, setAero, bladeY: b + 0.34, canardY: (z) => (z > 0 ? c.arch(z) + 0.08 : 0), triangles: tris };
}

// ───────────────────────── サイクロン: 波（一筆書きの曲面） ─────────────────────────
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

  // 跳ね上げ（後端の翼）: 支柱で持ち上がり、幅が広がって迎え角がつく
  const dp: V3 = [0, b + 0.3, -0.62];
  const dk = new Kit();
  const dprof: P2[] = [[-0.5, b + 0.33], [-0.86, b + 0.41], [-0.9, b + 0.46], [-0.6, b + 0.38]];
  dk.sweep('body', 'x', [
    { s: -0.44, pts: inset(dprof, 0.015) },
    { s: -0.4, pts: dprof },
    { s: 0.4, pts: dprof },
    { s: 0.44, pts: inset(dprof, 0.015) },
  ]);
  dk.plate('accent', 'x', -0.4, 0.4, [[-0.86, b + 0.415], [-0.9, b + 0.46], [-0.906, b + 0.45], [-0.87, b + 0.404]], 0.004);
  const duck = rig(dk, c, dp);
  const dstays = [-0.2, 0.2].map((x) => {
    const s = strut(c, 0.025, 0.07);
    s.position.set(x, b + 0.3, -0.7);
    return s;
  });
  const wingLift = 0.42;
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
      return [[0.4, bot], [xm, bot], [xm, lip], [xo - 0.04, lip], [xo, lip + 0.04], [xo, t - 0.05], [xo - 0.05, t], [0.4, t]];
    },
  });
  // 下まわりの黒いガード（ガードの下の段）
  if (c.gapF - c.gapR > 0.1) k.box('black', 0.44, xo - 0.02, b - 0.04, b + 0.03, c.gapR, c.gapF, 0.01, true);
  k.box('lamp', 0.28, 0.4, b + 0.14, b + 0.2, -0.787, -0.768, 0.004, true);
  k.box('black', 0.06, 0.24, b + 0.13, b + 0.21, -0.787, -0.77, 0.004, true); // 後ろの通気口

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
  return { group, setAero, bladeY: b + 0.4, canardY: (z) => guardTop(z) + 0.03, triangles: tris };
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

  // 後ろ半分のカウル（肩の後半＋後ろのフェンダー）
  const rc = new Kit();
  rc.sweep('body', 'z', [
    sh(-0.08, 0.18, 0.46, 0.36, 0.36, 0.28),
    sh(-0.55, 0.2, 0.46, 0.37, 0.32, 0.25),
    sh(-0.72, 0.3, 0.46, 0.39, 0.27, 0.21),
    sh(-0.9, 0.33, 0.46, 0.4, 0.2, 0.15),
  ], true);
  rc.sweep('black', 'z', [-0.6, -0.86].map((z) => ({ s: z, pts: [[0.47, b + 0.005], [0.475, b + 0.005], [0.475, b + 0.05], [0.47, b + 0.05]] as P2[] })), true);
  for (const [za, r] of c.axles) if (za <= 0) fender(rc, za, r);
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
  return { group, setAero, bladeY: b + 0.36, canardY: (z) => c.arch(z) + 0.07, triangles: tris };
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
  const lift = c.boostKind === 'pod2' ? 0.05 : c.boostKind === 'pod4' ? 0.035 : 0.15;
  const { group, tris } = finish(c, k, [cowl.group], [cowl, ...feathers], [[xR + 0.004, (podTop(c.rearAxle) + c.tireR * 1.15) / 2 + 0.01, c.rearAxle, 0]], cowl);
  const setAero = (a: number) => {
    cowl.group.rotation.x = lift * ease(a);
    for (const f of feathers) f.group.rotation.z = f.side * f.open * ease((a - 0.25) / 0.75);
  };
  setAero(0);
  return { group, setAero, bladeY: b + 0.3, canardY: (z) => podTop(z) + 0.03, triangles: tris };
}

const DESIGNS: Record<string, (c: C) => DesignedBody> = { slider, twin, cyclone, wallrunner, shifter, stormShifter };
// 差し色（ボディごとに1つ）
export const ACCENT: Record<string, number> = {
  slider: 0xd9b25c, // シャンパンゴールド
  twin: 0xf2f2f2, // 白
  cyclone: 0x7fe3ff, // 氷の水色
  wallrunner: 0xf2c230, // 注意の黄色
  shifter: 0x1d2c6b, // 紺
  stormShifter: 0xb9c0ca, // チタン
};
// 車体色と近すぎるときの差し色（黄色の車体に黄色の注意帯、白い車体に白い板…にならないように）
const ACCENT_ALT: Record<string, number> = {
  slider: 0xc8ccd2, // 銀
  twin: 0x2a2c30, // 黒
  cyclone: 0x2f6fd6, // 青
  wallrunner: 0x26282d, // 黒（黄色の車体なら黒の注意帯）
  shifter: 0x58d8ff, // 水色
  stormShifter: 0x50565f, // ガンメタ
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
export function buildDesignedBody(id: string, ctx: BodyCtx): DesignedBody {
  ctx.accent.color.setHex(accentFor(id, ctx.color));
  return DESIGNS[id](derive(ctx));
}
