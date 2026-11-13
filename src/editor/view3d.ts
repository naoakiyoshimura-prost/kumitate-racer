// 3D表示。実物の組立てコースに寄せた見た目:
//  - 路面は明るい樹脂色（種類の色はうっすら）、部品ごとの継ぎ目の線
//  - 両側の壁（高さ wallHeight）とレーンの仕切り（同じ高さの薄い板）、レーンチェンジは仕切りの上をまたぐ橋
//  - 高い所は床から立つ支え（台）。床には高さに応じてずれる落ち影の帯（影マップは使わない）
//  - スタートはチェッカーの線とゲート
// draw call を抑えるため、路面・壁／支え／橋・影・継ぎ目はそれぞれ1つにまとめたジオメトリ。再構築のたびに前のものを dispose する。
import * as THREE from 'three';
import type { Built, Frame, LaneCount, Placed, Vec3 } from './types';
import { right } from './geom';
import { trackWidth, dim } from './catalog';
import { TYPE_COLOR, bridgeOn, bridgesOf } from './view2d';

const BG = 0xcdc6b8; // 床と背景の色（地平線を作らない）
const ROAD_BASE = new THREE.Color(0xc4cad3);
const SEL = new THREE.Color(0xffe14a);
const SHADOW_K = 0.9; // 高さ→影のずれ（2D と同じ向き: +x, +z）

// ---- ベクトル ----
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

type RGB = [number, number, number];
const rgbOf = (hex: number): RGB => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// 面ごとに頂点を持つ（平らな陰影）ジオメトリの溜め場。向きは「内側の点」から外向きに揃える
class Buf {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  get count() { return this.pos.length / 3; }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ins: Vec3, rgb: RGB) {
    let n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) { n = cross(sub(c, a), sub(d, a)); if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return; }
    const m: Vec3 = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
    if (dot(n, sub(m, ins)) < 0) { [b, d] = [d, b]; n = [-n[0], -n[1], -n[2]]; }
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of [a, b, c, a, c, d]) { this.pos.push(v[0], v[1], v[2]); this.nor.push(n[0] / nl, n[1] / nl, n[2] / nl); this.col.push(rgb[0], rgb[1], rgb[2]); }
  }
  // 断面（4点: 下a・下b・上b・上a）を2つつないだ角柱。bottom=false で下の面を省く
  prism(c0: Vec3[], c1: Vec3[], rgb: RGB, bottom = false, cap0 = false, cap1 = false) {
    const ins: Vec3 = [0, 0, 0];
    for (const v of [...c0, ...c1]) { ins[0] += v[0] / 8; ins[1] += v[1] / 8; ins[2] += v[2] / 8; }
    for (let k = bottom ? 0 : 1; k < 4; k++) this.quad(c0[k], c0[(k + 1) % 4], c1[(k + 1) % 4], c1[k], ins, rgb);
    if (cap0) this.quad(c0[0], c0[1], c0[2], c0[3], ins, rgb);
    if (cap1) this.quad(c1[0], c1[1], c1[2], c1[3], ins, rgb);
  }
  // 軸に平行な（ワールド座標の）箱
  box(cx: number, y0: number, cz: number, sx: number, h: number, sz: number, rgb: RGB) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + h;
    this.prism([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], rgb, false, true, true);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function checkerTexture(cols: number, rows: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
  const cx = cv.getContext('2d')!;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { cx.fillStyle = (i + j) % 2 ? '#fff' : '#15181e'; cx.fillRect(i, j, 1, 1); }
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class View3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 10, 80000);
  private group = new THREE.Group(); // 作り直すたびに中身を捨てる
  private disposables: { dispose(): void }[] = [];
  // 色の書き換え（選択の強調）用: 部品ごとの頂点の範囲と、元の色
  private roadGeo: THREE.BufferGeometry | null = null;
  private structGeo: THREE.BufferGeometry | null = null;
  private roadRange: [number, number][] = [];
  private structRange: [number, number][] = [];
  private roadBase: Float32Array = new Float32Array(0);
  private structBase: Float32Array = new Float32Array(0);
  private roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private structMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private shadowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  private seamMat = new THREE.LineBasicMaterial({ color: 0x6f7784 });
  private target = new THREE.Vector3();
  private yaw = 0.7;
  private pitch = 0.85;
  private dist = 3000;
  private touched = false;
  private selected = -1;
  private raf = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  visible = false;
  info: { calls: number; triangles: number } | null = null; // 直前の描画の draw call 数（確認用）

  constructor(private host: HTMLElement) {
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 4000, 20000); // 床の遠くを背景の色へ溶かす（地平線を作らない）。距離は描画のたびに合わせる
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc9cdd6, 2.4));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(-1, 2.2, -0.8); this.scene.add(dl);
    // 床: 机か体育館の床のような単色のマット＋薄いグリッド
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshLambertMaterial({ color: 0xb2aa9b }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1; this.scene.add(floor);
    const grid = new THREE.GridHelper(20000, 80, 0xa59d8e, 0xaaa294); grid.position.y = -0.6;
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.7;
    this.scene.add(grid);
    this.scene.add(this.group);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.appendChild(this.renderer.domElement);
    } catch {
      host.innerHTML = '<div class="nogl">この端末では3D表示を使えません。2D表示をお使いください。</div>';
    }
    const el = this.renderer?.domElement;
    if (el) {
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.ptrs.size === 2) this.pinch = this.pd(); });
      el.addEventListener('pointermove', (e) => this.move(e));
      const end = (e: PointerEvent) => this.ptrs.delete(e.pointerId);
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    }
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private pd() { const [a, b] = [...this.ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  private move(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId); if (!p) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (this.ptrs.size === 1) {
      this.yaw -= (cur.x - p.x) * 0.008;
      this.pitch = Math.min(1.5, Math.max(0.1, this.pitch + (cur.y - p.y) * 0.008));
      this.touched = true; this.requestRender();
    } else if (this.ptrs.size === 2) {
      this.ptrs.set(e.pointerId, cur);
      const d = this.pd(); this.zoom(this.pinch / d); this.pinch = d; return;
    }
    this.ptrs.set(e.pointerId, cur);
  }
  private zoom(k: number) { this.dist = Math.min(40000, Math.max(300, this.dist * k)); this.touched = true; this.requestRender(); }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (!this.touched) this.fit();
    this.requestRender();
  }
  resetView() { this.touched = false; this.yaw = 0.7; this.pitch = 0.85; this.fit(); this.requestRender(); }

  private clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.roadGeo = this.structGeo = null; this.roadRange = []; this.structRange = [];
  }

  setData(built: Built, lanes: LaneCount, selected: number, dims?: Record<string, number>) {
    this.clear();
    const w = trackWidth(lanes, dims);
    const wt = dim(lanes, 'wallThickness', dims);
    const wallH = dim(lanes, 'wallHeight', dims);
    const laneW = dim(lanes, 'laneWidth', dims);
    const inner = lanes * laneW;
    const rise = dim(lanes, 'laneChangeRise', dims);
    const box = new THREE.Box3();
    const road = new Buf();
    const st = new Buf();
    const roadIdx: number[] = [];
    const shPos: number[] = [], shCol: number[] = [];
    const seam: number[] = [];
    const cWall = rgbOf(0xf6f7f9), cDiv = rgbOf(0xeceef2), cPier = rgbOf(0xb4bac4), cDeck = rgbOf(0xc4c9d1), cGate = rgbOf(0x3a4150);
    const P = (f: Frame, r: Vec3, lat: number, h: number): Vec3 => [f.p[0] + r[0] * lat + f.u[0] * h, f.p[1] + r[1] * lat + f.u[1] * h, f.p[2] + r[2] * lat + f.u[2] * h];

    // 路面は頂点色（部品ごとの範囲）。壁・支えなども同じ範囲の記録を持ち、選択で色を変える
    const roadColors: number[] = [];
    const wallStrip = (p: Placed, rs: Vec3[], a: number, b: number, h: number, rgb: RGB) => {
      const n = p.samples.length;
      const cs = p.samples.map((f, i) => [P(f, rs[i], a, 0), P(f, rs[i], b, 0), P(f, rs[i], b, h), P(f, rs[i], a, h)]);
      for (let i = 0; i < n - 1; i++) st.prism(cs[i], cs[i + 1], rgb, false, i === 0, i === n - 2);
    };

    // 支えの真下を別の部品のコースが通っているか（またぐ所）。通っていれば支えを出さない（コースに刺さるため）
    const crossesBelow = (self: Placed, x: number, z: number, top: number) => {
      const reach = w / 2 + 24;
      for (const q of built.placed) {
        if (q === self || q.minY > top - 30) continue;
        for (const s of q.samples) if (s.p[1] < top - 30 && Math.hypot(s.p[0] - x, s.p[2] - z) < reach) return true;
      }
      return false;
    };
    for (const p of built.placed) {
      const n = p.samples.length;
      const rs = p.samples.map((f) => right(f));
      const s0 = st.count;
      // 路面（継ぎ目で部品ごとに別の頂点）
      const base = roadColors.length / 3;
      const tc = new THREE.Color(TYPE_COLOR[p.spec.type]);
      const rc = ROAD_BASE.clone().lerp(tc, 0.16);
      for (let i = 0; i < n; i++) {
        const f = p.samples[i], r = rs[i];
        for (const side of [-1, 1]) {
          const o = (side * w) / 2;
          road.pos.push(f.p[0] + r[0] * o + f.u[0] * 0.5, f.p[1] + r[1] * o + f.u[1] * 0.5, f.p[2] + r[2] * o + f.u[2] * 0.5);
          road.nor.push(f.u[0], f.u[1], f.u[2]);
          roadColors.push(rc.r, rc.g, rc.b);
          box.expandByPoint(new THREE.Vector3(f.p[0] + r[0] * o, f.p[1] + r[1] * o, f.p[2] + r[2] * o));
        }
      }
      for (let i = 0; i < n - 1; i++) { const a = base + i * 2; roadIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      this.roadRange.push([base, base + n * 2]);
      // 継ぎ目: 部品の入口と出口（路面の幅の全部）
      for (const [f, r] of [[p.samples[0], rs[0]], [p.samples[n - 1], rs[n - 1]]] as [Frame, Vec3][]) {
        const a = P(f, r, -inner / 2, 1.2), b = P(f, r, inner / 2, 1.2);
        seam.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
      // 外側の壁と、レーンの仕切り
      wallStrip(p, rs, inner / 2, inner / 2 + wt, wallH, cWall);
      wallStrip(p, rs, -inner / 2 - wt, -inner / 2, wallH, cWall);
      for (let i = 1; i < lanes; i++) { const x = -inner / 2 + (inner * i) / lanes; wallStrip(p, rs, x - 1.5, x + 1.5, wallH, cDiv); }
      // 高い所の支え: 路面の裏から床まで届く台（幅は路面の7割、奥行き28mm）。数は約240mmごとに1つ
      if (p.maxY > 10 && p.spec.type !== 'loop' && p.spec.type !== 'laneLoop') {
        const hw = w * 0.35, dd = 14;
        for (let i = 2; i < n - 1; i += 8) {
          const f = p.samples[i], r = rs[i];
          const hz = Math.hypot(f.f[0], f.f[2]) || 1, fx = f.f[0] / hz, fz = f.f[2] / hz;
          const ya = Math.max(0, f.p[1] + r[1] * -hw - 3), yb = Math.max(0, f.p[1] + r[1] * hw - 3);
          if (Math.max(ya, yb) < 8) continue;
          if (crossesBelow(p, f.p[0], f.p[2], f.p[1])) continue;
          const xa = f.p[0] + r[0] * -hw, za = f.p[2] + r[2] * -hw, xb = f.p[0] + r[0] * hw, zb = f.p[2] + r[2] * hw;
          const face = (s: number): Vec3[] => [[xa + fx * dd * s, 0, za + fz * dd * s], [xb + fx * dd * s, 0, zb + fz * dd * s], [xb + fx * dd * s, yb, zb + fz * dd * s], [xa + fx * dd * s, ya, za + fz * dd * s]];
          st.prism(face(-1), face(1), cPier, false, true, true);
        }
      }
      // レーンチェンジ: 最後のレーンから最初のレーンへ斜めに横切る橋（仕切りの上を通る。支えは2か所）
      if (bridgesOf(p.spec).length) {
        const hwd = laneW * 0.46, th = 6;
        const br = p.samples.map((_, i) => bridgeOn(p.spec, lanes, dims, i / (n - 1)));
        const deck = (i: number, a: number, b: number, y0: number, y1: number): Vec3[] => {
          const f = p.samples[i], r = rs[i], y = f.p[1] + br[i].h * rise;
          const q = (l: number, h: number): Vec3 => [f.p[0] + r[0] * l, y + h, f.p[2] + r[2] * l];
          return [q(br[i].lat + a, y0), q(br[i].lat + b, y0), q(br[i].lat + b, y1), q(br[i].lat + a, y1)];
        };
        for (let i = 0; i < n - 1; i++) {
          if (br[i].h < 0.01 && br[i + 1].h < 0.01) continue;
          const last = i === n - 2 || (br[i + 1].h < 0.01);
          st.prism(deck(i, -hwd, hwd, -th, 0), deck(i + 1, -hwd, hwd, -th, 0), cDeck, true, i === 0 || br[i].h < 0.01, last);
          st.prism(deck(i, -hwd, -hwd + 3, 0, wallH), deck(i + 1, -hwd, -hwd + 3, 0, wallH), cWall, false, true, true);
          st.prism(deck(i, hwd - 3, hwd, 0, wallH), deck(i + 1, hwd - 3, hwd, 0, wallH), cWall, false, true, true);
        }
        for (const t of bridgesOf(p.spec).filter((b) => !b.ramp).flatMap((b) => [b.t0 + (b.t1 - b.t0) * 0.38, b.t0 + (b.t1 - b.t0) * 0.62])) {
          const i = Math.round(t * (n - 1)), f = p.samples[i], r = rs[i];
          const x = f.p[0] + r[0] * br[i].lat, z = f.p[2] + r[2] * br[i].lat;
          st.box(x, 0, z, 14, f.p[1] + br[i].h * rise - th, 14, cPier);
        }
      }
      // 落ち影: 高さに比例して右下へずらした床の帯（半透明）。低い所は出さない
      if (p.maxY > 2) {
        const col = (a: number) => [0.08, 0.1, 0.16, a];
        for (let i = 0; i < n - 1; i++) {
          const f0 = p.samples[i], f1 = p.samples[i + 1];
          if (f0.p[1] < 1.5 && f1.p[1] < 1.5) continue;
          const corner = (f: Frame, r: Vec3, o: number): [number, number, number] => {
            const y = f.p[1] + r[1] * o, s = Math.max(0, y) * SHADOW_K;
            return [f.p[0] + r[0] * o + s, 0.3, f.p[2] + r[2] * o + s];
          };
          const q = [corner(f0, rs[i], -w / 2), corner(f0, rs[i], w / 2), corner(f1, rs[i + 1], -w / 2), corner(f1, rs[i + 1], w / 2)];
          const al = Math.min(0.22, 0.07 + Math.max(f0.p[1], f1.p[1]) / 700);
          for (const k of [0, 1, 2, 1, 3, 2]) { shPos.push(...q[k]); shCol.push(...col(al)); }
        }
      }
      this.structRange.push([s0, st.count]);
    }

    // スタート: 路面の上のチェッカーの線と、入口のゲート（柱2本＋チェッカーの梁）。無ければ最初の部品の入口に白い棒
    const sp = built.placed.find((p) => p.spec.type === 'start');
    const f0 = (sp ?? built.placed[0])?.start;
    const gate: THREE.Mesh[] = [];
    if (sp && f0) {
      const r = right(f0), fv = new THREE.Vector3(...f0.f), rv = new THREE.Vector3(...r), uv = new THREE.Vector3(...f0.u);
      const place = (m: THREE.Mesh, ahead: number, h: number) => {
        m.matrix.makeBasis(fv, rv, uv).setPosition(f0.p[0] + f0.f[0] * ahead + f0.u[0] * h, f0.p[1] + f0.f[1] * ahead + f0.u[1] * h, f0.p[2] + f0.f[2] * ahead + f0.u[2] * h);
        m.matrixAutoUpdate = false;
      };
      const tex = checkerTexture(2, 12), tex2 = checkerTexture(24, 2);
      const plane = new THREE.PlaneGeometry(60, inner); // 平面の x=進行方向、y=右、z=路面の上
      const line = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      place(line, 70, 1.6); gate.push(line);
      const barGeo = new THREE.PlaneGeometry(inner + 2 * wt, 26), barMat = new THREE.MeshBasicMaterial({ map: tex2, side: THREE.DoubleSide });
      // 梁の面は進行方向を向く（x 軸 = 右、y 軸 = 上、法線 = 後ろ向き）。前後の2面に貼る
      const gh = wallH + 75, nf = fv.clone().negate();
      for (const ahead of [14, 20.5]) {
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.matrix.makeBasis(rv, uv, nf).setPosition(f0.p[0] + f0.f[0] * ahead + f0.u[0] * gh, f0.p[1] + f0.f[1] * ahead + f0.u[1] * gh, f0.p[2] + f0.f[2] * ahead + f0.u[2] * gh);
        bar.matrixAutoUpdate = false; gate.push(bar);
      }
      this.disposables.push(plane, line.material as THREE.Material, barGeo, barMat, tex, tex2);
      // 柱と梁の裏打ち（暗い色の箱。ワールド座標の軸に合わせず、断面の角柱で作る）
      for (const side of [-1, 1]) {
        const lat = side * (inner / 2 + wt / 2);
        const c = (a: number, b: number, h: number): Vec3[] => { const x = lat + a, y = lat + b; return [P(f0, r, x, 0), P(f0, r, y, 0), P(f0, r, y, h), P(f0, r, x, h)]; };
        const sh = (ahead: number) => (cs: Vec3[]) => cs.map((v): Vec3 => [v[0] + f0.f[0] * ahead, v[1] + f0.f[1] * ahead, v[2] + f0.f[2] * ahead]);
        st.prism(sh(8)(c(-wt / 2 - 2, wt / 2 + 2, gh + 13)), sh(20)(c(-wt / 2 - 2, wt / 2 + 2, gh + 13)), cGate, false, true, true);
      }
      { // 梁の裏側の板（厚み6mm）
        const c = (ahead: number): Vec3[] => [P(f0, r, -inner / 2 - wt, gh - 12), P(f0, r, inner / 2 + wt, gh - 12), P(f0, r, inner / 2 + wt, gh + 13), P(f0, r, -inner / 2 - wt, gh + 13)].map((v): Vec3 => [v[0] + f0.f[0] * ahead, v[1] + f0.f[1] * ahead, v[2] + f0.f[2] * ahead]);
        st.prism(c(14.5), c(20), cGate, true, true, true);
      }
    } else if (f0) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w + 20, 6, 14), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      m.position.set(f0.p[0], f0.p[1] + 4, f0.p[2]);
      m.rotation.y = Math.atan2(-f0.f[2], f0.f[0]);
      gate.push(m); this.disposables.push(m.geometry, m.material as THREE.Material);
    }

    // 組み立て
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(road.pos, 3));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(road.nor, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(roadColors, 3));
    rg.setIndex(roadIdx); rg.computeVertexNormals();
    this.roadGeo = rg; this.roadBase = new Float32Array(roadColors);
    const sg = st.geometry();
    this.structGeo = sg; this.structBase = new Float32Array(st.col);
    this.group.add(new THREE.Mesh(rg, this.roadMat), new THREE.Mesh(sg, this.structMat));
    this.disposables.push(rg, sg);
    if (seam.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(seam, 3));
      this.group.add(new THREE.LineSegments(g, this.seamMat)); this.disposables.push(g);
    }
    if (shPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(shCol, 4));
      const m = new THREE.Mesh(g, this.shadowMat); m.renderOrder = 1;
      this.group.add(m); this.disposables.push(g);
    }
    for (const m of gate) this.group.add(m);
    this.selected = -1; this.setSelected(selected);
    if (!box.isEmpty()) {
      box.getCenter(this.target); this.boxSize = box.getSize(new THREE.Vector3()).length();
      if (!this.touched) this.fit();
    }
    this.requestRender();
  }
  private boxSize = 3000;
  // 縦長の画面（スマホ縦持ち）では横の画角が狭いので、そのぶん離れてコース全体を入れる
  private fit() { this.dist = Math.max(600, (this.boxSize * 1.15) / Math.min(1, this.camera.aspect)); }

  // 選択の強調: 路面をはっきり黄色に、壁・支えも黄色寄りに。それ以外は元の色（種類の色はうっすら）
  setSelected(i: number) {
    this.selected = i;
    const apply = (geo: THREE.BufferGeometry | null, base: Float32Array, ranges: [number, number][], mix: number) => {
      if (!geo) return;
      const attr = geo.getAttribute('color') as THREE.BufferAttribute;
      const a = attr.array as Float32Array;
      a.set(base);
      const r = ranges[i];
      if (r) for (let v = r[0]; v < r[1]; v++) {
        a[v * 3] += (SEL.r - a[v * 3]) * mix; a[v * 3 + 1] += (SEL.g - a[v * 3 + 1]) * mix; a[v * 3 + 2] += (SEL.b - a[v * 3 + 2]) * mix;
      }
      attr.needsUpdate = true;
    };
    apply(this.roadGeo, this.roadBase, this.roadRange, 1);
    apply(this.structGeo, this.structBase, this.structRange, 0.55);
    this.requestRender();
  }

  requestRender() {
    if (this.raf || !this.renderer || !this.visible) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const c = this.camera, t = this.target, cp = Math.cos(this.pitch);
      c.position.set(t.x + this.dist * cp * Math.sin(this.yaw), t.y + this.dist * Math.sin(this.pitch), t.z + this.dist * cp * Math.cos(this.yaw));
      // 近い面の深度の精度（継ぎ目の線を路面から1mm浮かせるため）: 距離に合わせて近・遠の面を寄せる
      c.near = Math.max(10, this.dist * 0.03); c.far = this.dist * 40 + 20000; c.updateProjectionMatrix();
      c.lookAt(t);
      const fog = this.scene.fog as THREE.Fog; fog.near = this.dist * 1.6; fog.far = this.dist * 7;
      this.renderer!.render(this.scene, c);
      const i = this.renderer!.info.render; this.info = { calls: i.calls, triangles: i.triangles };
    });
  }
}
