// 図面（2D）。placed[].outline を塗って、種類ごとに色分けする。
import type { Built, PieceType, Placed, Frame } from './types';
import { right } from './geom';
import { trackWidth } from './catalog';
import type { LaneCount } from './types';

export type AddMode = 'end' | 'start' | 'insert';

export const TYPE_COLOR: Record<PieceType, string> = {
  straight: '#6f7f99',
  corner: '#2f93d6',
  wave: '#e0a030',
  laneChange: '#b45fc8',
  slopeUp: '#e0624a',
  slopeDown: '#3aa86f',
  bankIn: '#c8b830',
  bankOut: '#8fa83a',
};

function mix(hex: string, to: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
function inPoly(x: number, y: number, poly: [number, number][]): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const avgY = (p: Placed) => (p.minY + p.maxY) / 2;
const isBank = (p: Placed) => p.spec.type === 'bankIn' || p.spec.type === 'bankOut' || p.samples.some((s) => s.u[1] < 0.98);

export class View2D {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private built: Built | null = null;
  private lanes: LaneCount = 3;
  private selected = -1;
  private mode: AddMode = 'end';
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private cx = 0;
  private cz = 0;
  private s = 0.1;
  private ptrs = new Map<number, { x: number; y: number }>();
  private moved = false;
  private startPt = { x: 0, y: 0 };
  private pinch = 0;
  private raf = 0;
  visible = true;

  constructor(private canvas: HTMLCanvasElement, private onPick: (i: number) => void) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  setData(built: Built, lanes: LaneCount, selected: number, mode: AddMode) {
    this.built = built; this.lanes = lanes; this.selected = selected; this.mode = mode;
    this.requestDraw();
  }
  resetView() { this.zoom = 1; this.panX = 0; this.panY = 0; this.requestDraw(); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.requestDraw();
  }
  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.visible) this.draw(); });
  }

  private sx(x: number) { return this.w / 2 + this.panX + (x - this.cx) * this.s * this.zoom; }
  private sy(z: number) { return this.h / 2 + this.panY + (z - this.cz) * this.s * this.zoom; }

  private updateFit() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x: number, z: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    const pl = this.built?.placed ?? [];
    for (const p of pl) for (const [x, z] of p.outline) add(x, z);
    if (pl.length) { add(pl[0].start.p[0], pl[0].start.p[2]); add(pl[pl.length - 1].end.p[0], pl[pl.length - 1].end.p[2]); }
    if (!isFinite(x0)) { x0 = -500; x1 = 500; z0 = -500; z1 = 500; }
    const m = 22 + 50 * 0; // 余白(px)。出口の矢印ぶんも見込む
    const bw = Math.max(x1 - x0, 100), bh = Math.max(z1 - z0, 100);
    this.s = Math.min((this.w - 2 * m) / bw, (this.h - 2 * m) / bh);
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2;
  }

  // ---- 入力 ----
  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.ptrs.size === 1) { this.moved = false; this.startPt = { x: e.offsetX, y: e.offsetY }; }
    if (this.ptrs.size === 2) { this.moved = true; this.pinch = this.pinchDist(); }
  }
  private pinchDist() { const [a, b] = [...this.ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  private move(e: PointerEvent) {
    const prev = this.ptrs.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.offsetX, y: e.offsetY };
    if (this.ptrs.size === 1) {
      if (!this.moved && Math.hypot(cur.x - this.startPt.x, cur.y - this.startPt.y) > 8) this.moved = true;
      if (this.moved) { this.panX += cur.x - prev.x; this.panY += cur.y - prev.y; this.requestDraw(); }
      this.ptrs.set(e.pointerId, cur);
    } else if (this.ptrs.size === 2) {
      this.ptrs.set(e.pointerId, cur);
      const [a, b] = [...this.ptrs.values()];
      const d = this.pinchDist();
      this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch);
      this.pinch = d;
    }
  }
  private up(e: PointerEvent) {
    const had = this.ptrs.delete(e.pointerId);
    if (had && !this.moved && this.ptrs.size === 0) this.tap(e.offsetX, e.offsetY);
  }
  private zoomAt(px: number, py: number, k: number) {
    const nz = Math.min(12, Math.max(0.3, this.zoom * k)); k = nz / this.zoom;
    this.panX = px - this.w / 2 - (px - this.w / 2 - this.panX) * k;
    this.panY = py - this.h / 2 - (py - this.h / 2 - this.panY) * k;
    this.zoom = nz; this.requestDraw();
  }
  private tap(px: number, py: number) {
    const k = this.s * this.zoom;
    const x = (px - this.w / 2 - this.panX) / k + this.cx, z = (py - this.h / 2 - this.panY) / k + this.cz;
    let best = -1;
    for (const p of this.built?.placed ?? []) {
      if (!inPoly(x, z, p.outline)) continue;
      if (best < 0 || avgY(p) >= avgY(this.built!.placed[best])) best = p.index;
    }
    this.onPick(best);
  }

  // ---- 描画 ----
  draw() {
    const c = this.ctx, b = this.built;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#dfe5ee'; c.fillRect(0, 0, this.w, this.h);
    if (!b || b.placed.length === 0) return;
    this.updateFit();
    const pl = b.placed;
    const maxH = Math.max(...pl.map((p) => p.maxY), 0);
    const over = new Set<number>(), under = new Set<number>(b.check.underground);
    for (const [i, j] of b.check.overlaps) { over.add(i); over.add(j); }
    const path = (p: Placed) => {
      c.beginPath();
      p.outline.forEach(([x, z], i) => (i ? c.lineTo(this.sx(x), this.sy(z)) : c.moveTo(this.sx(x), this.sy(z))));
      c.closePath();
    };
    const order = [...pl].sort((a, b2) => avgY(a) - avgY(b2) || a.index - b2.index);
    const w = trackWidth(this.lanes);
    for (const p of order) {
      let col = TYPE_COLOR[p.spec.type];
      if (maxH > 1) {
        const t = Math.min(1, Math.max(0, avgY(p) / maxH));
        col = t > 0.02 ? mix(col, '#000000', t * 0.5) : mix(col, '#ffffff', 0.3);
      }
      path(p); c.fillStyle = col; c.fill();
      c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1; c.stroke();
      if (isBank(p)) {
        c.save(); path(p); c.clip();
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, z] of p.outline) { x0 = Math.min(x0, this.sx(x)); x1 = Math.max(x1, this.sx(x)); y0 = Math.min(y0, this.sy(z)); y1 = Math.max(y1, this.sy(z)); }
        c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.5; c.beginPath();
        for (let k = x0 - (y1 - y0); k < x1; k += 7) { c.moveTo(k, y1); c.lineTo(k + (y1 - y0), y0); }
        c.stroke(); c.restore();
      }
      // レーン線
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath();
      for (let i = 1; i < this.lanes; i++) {
        const off = -w / 2 + (w * i) / this.lanes;
        p.samples.forEach((f, k) => {
          const r = right(f);
          const x = this.sx(f.p[0] + r[0] * off), y = this.sy(f.p[2] + r[2] * off);
          k ? c.lineTo(x, y) : c.moveTo(x, y);
        });
      }
      c.stroke(); c.setLineDash([]);
    }
    // 重なり・地下
    for (const p of pl) {
      if (under.has(p.index)) { path(p); c.fillStyle = 'rgba(140,60,200,.5)'; c.fill(); c.strokeStyle = '#7a2fc0'; c.lineWidth = 3; c.stroke(); }
      if (over.has(p.index)) { path(p); c.fillStyle = 'rgba(255,40,40,.35)'; c.fill(); c.strokeStyle = '#e01818'; c.lineWidth = 3; c.stroke(); }
    }
    // 矢印・番号・高さ
    const px = (this.s * this.zoom);
    for (const p of pl) {
      const m = p.samples[Math.floor(p.samples.length / 2)] ?? p.start;
      const x = this.sx(m.p[0]), y = this.sy(m.p[2]);
      this.arrow(x, y, m.f[0], m.f[2], 6, 'rgba(255,255,255,.92)', 'rgba(0,0,0,.6)');
      if (p.length * px > 26) {
        c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
        this.label(String(p.index + 1), x, y - 11, '#fff');
        if (p.maxY > 1) this.label('+' + Math.round(p.maxY), x, y + 12, '#fff');
      }
    }
    // 選択
    const sel = pl[this.selected];
    if (sel) { path(sel); c.strokeStyle = '#111'; c.lineWidth = 6; c.stroke(); c.strokeStyle = '#ffe14a'; c.lineWidth = 3.5; c.stroke(); }
    // スタート印
    const s0 = pl[0].start;
    this.startMark(s0, w);
    // 出口の印
    let tf: Frame | null = null, dirSign = 1, col = '#1fae5b';
    if (this.mode === 'end') tf = pl[pl.length - 1].end;
    else if (this.mode === 'start') { tf = pl[0].start; dirSign = -1; col = '#f08a1c'; }
    else tf = (sel ?? pl[pl.length - 1]).end;
    if (tf) {
      const fx = tf.f[0] * dirSign, fz = tf.f[2] * dirSign, x = this.sx(tf.p[0]), y = this.sy(tf.p[2]);
      c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = col; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
      const l = Math.hypot(fx, fz) || 1;
      this.arrow(x + (fx / l) * 14, y + (fz / l) * 14, fx, fz, 11, col, '#fff');
    }
    // 閉じていない: 出口→入口
    if (!b.check.closed) {
      const e = pl[pl.length - 1].end.p, s = pl[0].start.p;
      const x0 = this.sx(e[0]), y0 = this.sy(e[2]), x1 = this.sx(s[0]), y1 = this.sy(s[2]);
      c.strokeStyle = '#e01818'; c.lineWidth = 2.5; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.setLineDash([]);
      c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      this.label(Math.round(b.check.gapMm) + 'mm', (x0 + x1) / 2, (y0 + y1) / 2 - 10, '#ff4a4a', 'rgba(255,255,255,.95)');
    }
  }

  private label(t: string, x: number, y: number, fill: string, halo = 'rgba(0,0,0,.75)') {
    const c = this.ctx; c.lineWidth = 3; c.lineJoin = 'round'; c.strokeStyle = halo; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y);
  }
  private arrow(x: number, y: number, dx: number, dz: number, r: number, fill: string, stroke: string) {
    const c = this.ctx, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    c.beginPath();
    c.moveTo(x + ux * r, y + uz * r);
    c.lineTo(x - ux * r * 0.7 - uz * r * 0.7, y - uz * r * 0.7 + ux * r * 0.7);
    c.lineTo(x - ux * r * 0.7 + uz * r * 0.7, y - uz * r * 0.7 - ux * r * 0.7);
    c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke();
  }
  private startMark(f: Frame, w: number) {
    const c = this.ctx, r = right(f);
    const ax = this.sx(f.p[0] - r[0] * w / 2), ay = this.sy(f.p[2] - r[2] * w / 2);
    const bx = this.sx(f.p[0] + r[0] * w / 2), by = this.sy(f.p[2] + r[2] * w / 2);
    c.lineCap = 'butt';
    c.strokeStyle = '#fff'; c.lineWidth = 6; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    c.strokeStyle = '#111'; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]);
    c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    this.label('S', (ax + bx) / 2 - f.f[0] * 14, (ay + by) / 2 - f.f[2] * 14, '#fff');
  }
}
