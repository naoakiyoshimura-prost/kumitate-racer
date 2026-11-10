// 3D表示。影なしの軽い描画。路面の帯＋低い壁を samples から作る。
import * as THREE from 'three';
import type { Built, LaneCount } from './types';
import { right } from './geom';
import { trackWidth, dim } from './catalog';
import { TYPE_COLOR } from './view2d';

const WALL_H = 14; // mm（見た目用）

export class View3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 10, 80000);
  private group = new THREE.Group();
  private roadMats: THREE.MeshLambertMaterial[] = [];
  private otherMats: THREE.Material[] = []; // 壁・側板（作り直すたびに捨てる）
  private types: string[] = [];
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

  constructor(private host: HTMLElement) {
    this.scene.background = new THREE.Color(0x20252e);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.0));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(1, 2, 1.3); this.scene.add(dl);
    const grid = new THREE.GridHelper(8000, 40, 0x56627a, 0x333c4c); (grid.position.y = -1); this.scene.add(grid);
    this.scene.add(this.group);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false });
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
    this.requestRender();
  }
  resetView() { this.touched = false; this.yaw = 0.7; this.pitch = 0.85; this.fit(); this.requestRender(); }

  setData(built: Built, lanes: LaneCount, selected: number, dims?: Record<string, number>) {
    for (const o of [...this.group.children]) { this.group.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    for (const m of this.roadMats) m.dispose();
    for (const m of this.otherMats) m.dispose();
    this.roadMats = []; this.types = [];
    const w = trackWidth(lanes, dims);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xcfd6e2, side: THREE.DoubleSide });
    // 高い所（バンク・スロープの上）は、路面の外側の縁から床まで薄い側板を下ろして高さが分かるようにする（見た目だけ）
    const skirtMat = new THREE.MeshLambertMaterial({ color: 0x6b7486, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    this.otherMats = [wallMat, skirtMat];
    const box = new THREE.Box3();
    for (const p of built.placed) {
      const n = p.samples.length;
      const road: number[] = [], wl: number[] = [];
      const wallPts: number[][] = [[], []];
      for (const f of p.samples) {
        const r = right(f);
        for (const side of [-1, 1]) {
          const o = (side * w) / 2;
          const x = f.p[0] + r[0] * o, y = f.p[1] + r[1] * o, z = f.p[2] + r[2] * o;
          road.push(x + f.u[0] * 0.5, y + f.u[1] * 0.5, z + f.u[2] * 0.5);
          wallPts[side < 0 ? 0 : 1].push(x, y, z, x + f.u[0] * WALL_H, y + f.u[1] * WALL_H, z + f.u[2] * WALL_H);
          box.expandByPoint(new THREE.Vector3(x, y, z));
        }
      }
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(road, 3)); g.setIndex(idx); g.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: TYPE_COLOR[p.spec.type], side: THREE.DoubleSide });
      this.roadMats.push(mat); this.types.push(p.spec.type);
      this.group.add(new THREE.Mesh(g, mat));
      for (const pts of wallPts) {
        const wi: number[] = [];
        for (let i = 0; i < n - 1; i++) { const a = i * 2; wi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); wg.setIndex(wi); wg.computeVertexNormals();
        this.group.add(new THREE.Mesh(wg, wallMat));
      }
      void wl;
      if (p.maxY > 1) {
        for (const side of [-1, 1]) {
          const sk: number[] = [];
          for (const f of p.samples) {
            const r = right(f);
            const o = (side * w) / 2;
            const x = f.p[0] + r[0] * o, y = f.p[1] + r[1] * o, z = f.p[2] + r[2] * o;
            sk.push(x, y, z, x, 0, z);
          }
          const si: number[] = [];
          for (let i = 0; i < n - 1; i++) { const a = i * 2; si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3)); sg.setIndex(si); sg.computeVertexNormals();
          this.group.add(new THREE.Mesh(sg, skirtMat));
        }
      }
    }
    // スタート印: start 部品があればチェッカー柄の帯、無ければ最初の部品の入口に今までどおりの白い棒
    const sp = built.placed.find((p) => p.spec.type === 'start');
    if (sp) {
      const f = sp.start, r = right(f);
      const inner = w - 2 * dim(lanes, 'wallThickness', dims);
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 12;
      const cx = cv.getContext('2d')!;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 12; j++) { cx.fillStyle = (i + j) % 2 ? '#fff' : '#111'; cx.fillRect(i, j, 1, 1); }
      const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(60, inner), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      // 平面の x=進行方向、y=右、z=路面の上
      const fv = new THREE.Vector3(...f.f), rv = new THREE.Vector3(...r), uv = new THREE.Vector3(...f.u);
      m.matrix.makeBasis(fv, rv, uv).setPosition(f.p[0] + f.f[0] * 70 + f.u[0] * 3, f.p[1] + f.f[1] * 70 + f.u[1] * 3, f.p[2] + f.f[2] * 70 + f.u[2] * 3);
      m.matrixAutoUpdate = false;
      this.group.add(m);
    } else if (built.placed.length) {
      const f = built.placed[0].start;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w + 20, 6, 14), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      m.position.set(f.p[0], f.p[1] + 4, f.p[2]);
      m.rotation.y = Math.atan2(-f.f[2], f.f[0]);
      this.group.add(m);
    }
    this.selected = -1; this.setSelected(selected);
    if (!box.isEmpty()) {
      box.getCenter(this.target); this.boxSize = box.getSize(new THREE.Vector3()).length();
      if (!this.touched) this.fit();
    }
    this.requestRender();
  }
  private boxSize = 3000;
  private fit() { this.dist = Math.max(600, this.boxSize * 1.15); }

  setSelected(i: number) {
    this.selected = i;
    this.roadMats.forEach((m, k) => m.color.set(k === i ? '#ffe14a' : TYPE_COLOR[this.types[k] as keyof typeof TYPE_COLOR]));
    this.requestRender();
  }

  requestRender() {
    if (this.raf || !this.renderer || !this.visible) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const c = this.camera, t = this.target, cp = Math.cos(this.pitch);
      c.position.set(t.x + this.dist * cp * Math.sin(this.yaw), t.y + this.dist * Math.sin(this.pitch), t.z + this.dist * cp * Math.cos(this.yaw));
      c.lookAt(t);
      this.renderer!.render(this.scene, c);
    });
  }
}
