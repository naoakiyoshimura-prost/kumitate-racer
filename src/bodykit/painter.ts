import * as THREE from 'three';
import { SLOT_INDEX, type Slot, type V3 } from './types';

// 三角形を色枠つきでためる道具。面は頂点を共有しない（＝フラットシェーディング、折れ目で光が切り替わる）。
// 裏表は材質を両面にして吸収するので、巻き方向は気にしなくてよい。
export class Painter {
  pos: number[] = [];
  slot: number[] = [];

  tri(a: V3, b: V3, c: V3, s: Slot) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) return; // つぶれた三角形は捨てる
    this.pos.push(...a, ...b, ...c);
    this.slot.push(SLOT_INDEX[s]);
  }
  quad(a: V3, b: V3, c: V3, d: V3, s: Slot) {
    this.tri(a, b, c, s);
    this.tri(a, c, d, s);
  }
  // 凸でなくてもよい平らな多角形（平面に投影して三角形分割）
  poly(pts: V3[], s: Slot) {
    if (pts.length < 3) return;
    if (pts.length === 3) return this.tri(pts[0], pts[1], pts[2], s);
    // Newell 法で法線 → 一番大きい成分の軸を落として 2D に
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const pr = ax >= ay && ax >= az ? (p: V3) => new THREE.Vector2(p[1], p[2]) : ay >= az ? (p: V3) => new THREE.Vector2(p[2], p[0]) : (p: V3) => new THREE.Vector2(p[0], p[1]);
    const faces = THREE.ShapeUtils.triangulateShape(pts.map(pr), []);
    for (const f of faces) this.tri(pts[f[0]], pts[f[1]], pts[f[2]], s);
  }
  // 断面の輪（点の数はそろえる）を順につなぐ。slot(seg, edge) で面ごとの色枠（null で面を作らない）
  loft(rings: V3[][], slot: (seg: number, edge: number) => Slot | null, o: { closed?: boolean; cap0?: Slot | null; cap1?: Slot | null } = {}) {
    const closed = o.closed ?? true;
    const n = rings[0].length;
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1];
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const j = (i + 1) % n;
        const s = slot(k, i);
        if (s) this.quad(A[i], A[j], B[j], B[i], s);
      }
    }
    if (closed && o.cap0) this.poly(rings[0], o.cap0);
    if (closed && o.cap1) this.poly(rings[rings.length - 1], o.cap1);
  }
  // 回転体: profile=[半径, 軸方向の位置][]、軸は 'x'|'y'|'z'、c=軸に垂直な2成分の中心
  lathe(axis: 'x' | 'y' | 'z', c: [number, number], profile: [number, number][], n: number, slot: (seg: number) => Slot | null, rot = Math.PI / n) {
    const map = (r: number, a: number, t: number): V3 => {
      const u = c[0] + Math.cos(a + rot) * r, v = c[1] + Math.sin(a + rot) * r;
      return axis === 'z' ? [u, v, t] : axis === 'x' ? [t, u, v] : [u, t, v];
    };
    for (let k = 0; k < profile.length - 1; k++) {
      const s = slot(k);
      if (!s) continue;
      const [r0, t0] = profile[k], [r1, t1] = profile[k + 1];
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        this.quad(map(r0, a0, t0), map(r0, a1, t0), map(r1, a1, t1), map(r1, a0, t1), s);
      }
    }
  }
  // 面取りした箱（中心 c、半分の大きさ h、b=面取り）。色は面ごとに指定できる
  box(c: V3, h: V3, s: Slot, b = 0) {
    const [x, y, z] = c, [a, e, f] = h;
    if (b <= 0) {
      const P = (i: number, j: number, k: number): V3 => [x + i * a, y + j * e, z + k * f];
      const F: [V3, V3, V3, V3][] = [
        [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
        [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
        [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)],
        [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
        [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
        [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)],
      ];
      for (const q of F) this.quad(q[0], q[1], q[2], q[3], s);
      return;
    }
    // 面取り: z 方向に 4 断面の八角形
    const ring = (dz: number, ins: number): V3[] => {
      const A = a - ins, E = e - ins;
      const bb = Math.min(b, A * 0.5, E * 0.5);
      return [
        [x - A + bb, y - E, z + dz], [x + A - bb, y - E, z + dz], [x + A, y - E + bb, z + dz], [x + A, y + E - bb, z + dz],
        [x + A - bb, y + E, z + dz], [x - A + bb, y + E, z + dz], [x - A, y + E - bb, z + dz], [x - A, y - E + bb, z + dz],
      ];
    };
    const bz = Math.min(b, f * 0.45);
    this.loft([ring(-f, bz), ring(-f + bz, 0), ring(f - bz, 0), ring(f, bz)], () => s, { cap0: s, cap1: s });
  }
  // 細い棒（a→b、太さ w×t の四角断面。up は断面の上向きの目安）
  beam(a: V3, b: V3, w: number, t: number, s: Slot, up: V3 = [0, 1, 0]) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const u = new THREE.Vector3(...up);
    const side = new THREE.Vector3().crossVectors(d, u).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const nu = new THREE.Vector3().crossVectors(side, d).normalize();
    const ring = (p: V3): V3[] =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([i, j]) => [p[0] + side.x * i * w * 0.5 + nu.x * j * t * 0.5, p[1] + side.y * i * w * 0.5 + nu.y * j * t * 0.5, p[2] + side.z * i * w * 0.5 + nu.z * j * t * 0.5] as V3);
    this.loft([ring(a), ring(b)], () => s, { cap0: s, cap1: s });
  }
  // x を反転（左側の部位を右側の形から作る）
  mirrorX(): Painter {
    const p = new Painter();
    p.pos = this.pos.map((v, i) => (i % 3 === 0 ? -v : v));
    p.slot = [...this.slot];
    return p;
  }
  append(o: Painter) {
    for (const v of o.pos) this.pos.push(v);
    for (const s of o.slot) this.slot.push(s);
  }
  get triangles() {
    return this.slot.length;
  }
}

// 折れ線の表を読む（[t, 値]… を t で線形補間）
export const tab = (t: [number, number][], x: number) => {
  const s = t[0][0] <= t[t.length - 1][0] ? t : [...t].reverse();
  if (x <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i][0]) {
      const k = (x - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * k;
    }
  }
  return s[s.length - 1][1];
};
// 左右対称の断面: 右半分（下の中心 → 上の中心）から全周
export const fullRing = (half: [number, number][], z: number): V3[] => {
  const r = half.map(([x, y]) => [x, y, z] as V3);
  const l = half.slice(1, -1).reverse().map(([x, y]) => [-x, y, z] as V3);
  return [...r, ...l];
};
