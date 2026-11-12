// 図面（2D）。placed[].outline を塗って、種類ごとに色分けする。
import type { Built, PieceType, PieceSpec, Placed, Frame } from './types';
import { right } from './geom';
import { trackWidth, dim } from './catalog';
import type { LaneCount } from './types';

export type AddMode = 'end' | 'start' | 'insert';

export const TYPE_COLOR: Record<PieceType, string> = {
  start: '#3f9e8f',
  straight: '#6f7f99',
  corner: '#2f93d6',
  wave: '#e0a030',
  laneChange: '#b45fc8',
  slopeUp: '#e0624a',
  slopeDown: '#3aa86f',
  bankApproach: '#c8487e',
  universal: '#d9d24a',
  loop: '#ff7a3a',
  laneLoop: '#c05cff',
  bankChange: '#d0508c',
  cornerChange: '#a060d0',
  shiftChange: '#8a6ae0',
  bump: '#e58a2e',
  hump: '#58b0a0',
};
// コースに置いた部品の色（下のパレットは TYPE_COLOR のまま）。店長指定 2026-11-12:
// 直線・スタートは白、コーナーは薄い青、ウェーブは薄い緑、高さが変わる部品（スロープ・急スロープ・バンク/バンク終わり）は
// 実際の進む向きで上りが赤・下りが青。Uチェンジは赤と紛れないよう紫寄りに寄せる
const PLACED_COLOR: Partial<Record<PieceType, string>> = {
  start: '#f4f6f9',
  straight: '#f7f8fa',
  corner: '#7fc1ee',
  wave: '#8fd6a0',
  bankChange: '#c88ad8',
};
export const RISE_COLOR = { up: '#e2453c', down: '#2e6ad6' };
function placedColor(p: Placed): string {
  const t = p.spec.type;
  if (t === 'slopeUp' || t === 'slopeDown' || t === 'bankApproach') {
    const s0 = p.samples[0].p[1], s1 = p.samples[p.samples.length - 1].p[1];
    if (s1 > s0 + 0.5) return RISE_COLOR.up;
    if (s1 < s0 - 0.5) return RISE_COLOR.down;
  }
  return PLACED_COLOR[t] ?? TYPE_COLOR[t];
}

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
const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
// レーンチェンジの橋（表示用の簡易表現）: 最後のレーンの中心から最初のレーンの中心へ斜めに横切り、途中で壁より高く持ち上がる。
// lat = 橋の中心の横位置（mm、右が+）、h = 持ち上がりの割合（0〜1。実寸は laneChangeRise）。2D と 3D で同じ形を使う
export function bridgeAt(lanes: LaneCount, ov: Record<string, number> | undefined, t: number): { lat: number; h: number } {
  const lw = dim(lanes, 'laneWidth', ov), inner = lanes * lw;
  const from = inner / 2 - lw / 2, to = -inner / 2 + lw / 2;
  return { lat: from + (to - from) * smooth(0.25, 0.75, t), h: smooth(0.08, 0.3, t) * (1 - smooth(0.7, 0.92, t)) };
}
// 通常のレーンチェンジ（店長 2026-11-12: 直線3本ぶん。前後にLCジャンプのような坂、その間が立体交差）。
// 店長の参考画像（リポジトリ外）の構造: 入口はまっすぐな上り坂、頂上の手前からゆるいS字で残りのレーンをまたぎ、カーブしながら下りて反対側の端のレーンへ。
// 割合・高さ（laneChangeRise）・坂の角度は推定（画像から寸法は取れない）
export function lcBridgeAt(lanes: LaneCount, ov: Record<string, number> | undefined, t: number): { lat: number; h: number } {
  const lw = dim(lanes, 'laneWidth', ov), inner = lanes * lw;
  const from = inner / 2 - lw / 2, to = -inner / 2 + lw / 2;
  return { lat: from + (to - from) * smooth(0.28, 0.85, t), h: smooth(0.02, 0.4, t) * (1 - smooth(0.62, 0.98, t)) };
}
// 部品の中の橋の一覧（部品の長さに対する割合 t0〜t1）。reverse = 最初のレーンから最後のレーンへ渡る（右回りのチェンジ）。gap = 橋の真ん中に切れ目（ジャンプ）
export interface BridgeSpan { t0: number; t1: number; reverse?: boolean; ramp?: boolean; lc?: boolean } // lc = 通常のレーンチェンジ（前1/3で坂を上り、中1/3で横切り、後1/3で坂を下りる） // ramp = ジャンプ台（右端のレーンが上りながら途中で切れる。レーンは入れ替わらない）
export function bridgesOf(spec: PieceSpec): BridgeSpan[] {
  switch (spec.type) {
    case 'laneChange': return spec.jump ? [{ t0: 0.3, t1: 0.78, ramp: true }] : [{ t0: 0, t1: 1, lc: true }];
    case 'bankChange':
    case 'cornerChange': return [{ t0: 0, t1: 1, reverse: spec.dir === 'R' }];
    case 'shiftChange': return [{ t0: 0.12, t1: 0.3, ramp: true }, { t0: 0.4, t1: 1, reverse: spec.dir === 'L' }];
    default: return [];
  }
}
// 部品の割合 t の所の橋（無ければ h = 0）
export function bridgeOn(spec: PieceSpec, lanes: LaneCount, ov: Record<string, number> | undefined, t: number): { lat: number; h: number } {
  for (const b of bridgesOf(spec)) {
    if (t < b.t0 || t > b.t1) continue;
    const u = (t - b.t0) / (b.t1 - b.t0);
    if (b.ramp) { const lw = dim(lanes, 'laneWidth', ov); return { lat: (lanes * lw) / 2 - lw / 2, h: 0.05 + 0.75 * u }; }
    const r = b.lc ? lcBridgeAt(lanes, ov, u) : bridgeAt(lanes, ov, u);
    return { lat: b.reverse ? -r.lat : r.lat, h: r.h };
  }
  return { lat: 0, h: 0 };
}
// 高さ→影のずれ（mm）。右下（+x, +z）へ高さに比例
const SHADOW_K = 0.9;
// バンクアプローチ・スロープは上り方向へ明るくなる。傾いた面の上にある部品（路面の上向きが真上でない＝バンクの上のコーナーなど）は外側（高い側）ほど明るくする
const isTilted = (p: Placed) => p.spec.type !== 'bankApproach' && p.samples.some((s) => Math.abs(right(s)[1]) > 0.02);

export class View2D {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private built: Built | null = null;
  private lanes: LaneCount = 3;
  private dims: Record<string, number> | undefined;
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

  setData(built: Built, lanes: LaneCount, selected: number, mode: AddMode, dims?: Record<string, number>) {
    this.built = built; this.lanes = lanes; this.dims = dims; this.selected = selected; this.mode = mode;
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
    c.fillStyle = '#3b4456'; c.fillRect(0, 0, this.w, this.h); // 濃い背景（白い直線・薄い色のパーツが溶けないように。2026-11-12）
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
    const w = trackWidth(this.lanes, this.dims);
    const wt = dim(this.lanes, 'wallThickness', this.dims);
    const inner = w - 2 * wt;
    const k = this.s * this.zoom; // mm → px
    // 路面の横位置 off（mm）に沿った線の点列（傾いた面でも右向きの水平成分で上から見た位置を出す）
    const lat = (p: Placed, off: (i: number) => number, lo = 0, hi = p.samples.length - 1): [number, number][] =>
      p.samples.slice(lo, hi + 1).map((f, j) => { const r = right(f), o = off(lo + j); return [this.sx(f.p[0] + r[0] * o), this.sy(f.p[2] + r[2] * o)]; });
    const poly = (pts: [number, number][]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); };
    for (const p of order) {
      // (a) 落ち影: 路面の各点を高さに比例して右下へずらした半透明の影（自分の路面で隠れる。先に描く）
      if (p.maxY > 3) {
        const n = p.samples.length;
        c.beginPath();
        p.outline.forEach(([x, z], i) => {
          const y = p.samples[i < n ? i : 2 * n - 1 - i].p[1];
          const X = this.sx(x + y * SHADOW_K), Y = this.sy(z + y * SHADOW_K);
          i ? c.lineTo(X, Y) : c.moveTo(X, Y);
        });
        c.closePath(); c.fillStyle = 'rgba(10,14,24,.45)'; c.fill();
      }
      // (d) 高い部品ほど明るく（低い所は種類の色のまま、高さの割合で白へ寄せる）
      let col = placedColor(p);
      const isRise = col === RISE_COLOR.up || col === RISE_COLOR.down; // 上り赤・下り青は白い帯で薄めすぎない
      const t = maxH > 1 ? Math.min(1, Math.max(0, avgY(p) / maxH)) : 0;
      col = mix(col, '#ffffff', 0.04 + 0.22 * t);
      path(p); c.fillStyle = col; c.fill();
      c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineWidth = 1.5; c.stroke();
      c.save(); path(p); c.clip();
      const sm = p.samples, s0 = sm[0], s1 = sm[sm.length - 1];
      const spec = p.spec.type;
      const up = s1.p[1] > s0.p[1] + 0.5 ? 1 : s1.p[1] < s0.p[1] - 0.5 ? -1 : 0; // 上りの向き（進行方向なら +1）
      // (c) スロープ・バンクアプローチ: 上り方向へ明るくなるグラデーションと、上りを向く矢羽根
      if ((spec === 'slopeUp' || spec === 'slopeDown' || spec === 'bankApproach') && up !== 0) {
        const lo = up > 0 ? s0 : s1, hi = up > 0 ? s1 : s0;
        const g = c.createLinearGradient(this.sx(lo.p[0]), this.sy(lo.p[2]), this.sx(hi.p[0]), this.sy(hi.p[2]));
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.35)');
        c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
        c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5; c.lineJoin = 'miter';
        const step = 4; // 点列の間隔（サンプル数）
        for (let i = (step >> 1); i < sm.length; i += step) {
          const f = sm[i], r = right(f);
          const dx = f.f[0] * up, dz = f.f[2] * up, l = Math.hypot(dx, dz) || 1;
          const ux = dx / l, uz = dz / l, b = Math.max(10, 40 * k * 0.1); // 矢羽根の後ろへの長さ（px）
          for (const side of [-1, 1]) { // 左右に1つずつ（中央は番号のため空ける）
            const o = side * inner * 0.3;
            const x = this.sx(f.p[0] + r[0] * o), y = this.sy(f.p[2] + r[2] * o);
            c.beginPath(); c.moveTo(x - ux * b * 0.5 - uz * b * 0.6, y - uz * b * 0.5 + ux * b * 0.6); c.lineTo(x + ux * b * 0.4, y + uz * b * 0.4); c.lineTo(x - ux * b * 0.5 + uz * b * 0.6, y - uz * b * 0.5 - ux * b * 0.6); c.stroke();
          }
        }
      }
      // 傾いた面の上（バンクのコーナー）: 高い側（外側）ほど明るい帯。高い側の壁は白く太く
      if (isTilted(p)) {
        const nb = 6;
        const mid = sm[sm.length >> 1], ry = right(mid)[1];
        for (let bnd = 0; bnd < nb; bnd++) {
          const o0 = -inner / 2 + (inner * bnd) / nb, o1 = o0 + inner / nb, om = (o0 + o1) / 2;
          const a = Math.min(0.5, Math.max(0, (ry * om) / (0.35 * inner / 2) * 0.25 + 0.25)) * (isRise ? 0.35 : 1);
          poly([...lat(p, () => o0), ...lat(p, () => o1).reverse()]); c.closePath();
          c.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; c.fill();
        }
        c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3;
        const hs = ry >= 0 ? 1 : -1;
        poly(lat(p, () => hs * (inner / 2 - 2))); c.stroke();
      }
      // レーンチェンジの橋: 斜めに横切る帯（明るい=高い）
      if (bridgesOf(p.spec).length) {
        const n = sm.length - 1, lw = dim(this.lanes, 'laneWidth', this.dims) * 0.46;
        const br = sm.map((_, i) => bridgeOn(p.spec, this.lanes, this.dims, i / n));
        // 橋が出ている所（h > 0）ごとに帯を描く
        let a = -1;
        for (let i = 0; i <= n + 1; i++) {
          const on = i <= n && br[i].h > 0.01;
          if (on && a < 0) a = i;
          if (!on && a >= 0) {
            const idx = Array.from({ length: i - a }, (_, k) => a + k);
            const all = lat(p, (q) => br[q].lat - lw), allR = lat(p, (q) => br[q].lat + lw);
            const L = idx.map((q) => all[q]), Rr = idx.map((q) => allR[q]);
            if (L.length > 1) {
              poly([...L, ...Rr.slice().reverse()]); c.closePath();
              c.fillStyle = 'rgba(255,255,255,.4)'; c.fill();
              c.strokeStyle = 'rgba(40,40,60,.7)'; c.lineWidth = 1.2;
              poly(L); c.stroke(); poly(Rr); c.stroke();
            }
            a = -1;
          }
        }
      }
      c.restore();
      // (b) 仕切り（細い実線）と壁（外側の太い線）
      c.strokeStyle = 'rgba(30,38,56,.65)'; c.lineWidth = 1;
      for (let i = 1; i < this.lanes; i++) { poly(lat(p, () => -inner / 2 + (inner * i) / this.lanes)); c.stroke(); }
      c.lineCap = 'butt';
      for (const side of [-1, 1]) {
        const o = side * (inner / 2 + wt / 2);
        poly(lat(p, () => o)); c.strokeStyle = '#2b3347'; c.lineWidth = Math.max(2, wt * k); c.stroke();
        poly(lat(p, () => side * (inner / 2 + wt * 0.15))); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.8; c.stroke();
      }
    }
    // 重なり・地下
    for (const p of pl) {
      if (under.has(p.index)) { path(p); c.fillStyle = 'rgba(140,60,200,.5)'; c.fill(); c.strokeStyle = '#7a2fc0'; c.lineWidth = 3; c.stroke(); }
      if (over.has(p.index)) { path(p); c.fillStyle = 'rgba(255,40,40,.35)'; c.fill(); c.strokeStyle = '#e01818'; c.lineWidth = 3; c.stroke(); }
    }
    // 番号・高さ（周回方向の矢印は各部品から外し、スタートに1つだけ置く。店長 2026-11-12）
    const px = (this.s * this.zoom);
    for (const p of pl) {
      const m = p.samples[Math.floor(p.samples.length / 2)] ?? p.start;
      const x = this.sx(m.p[0]), y = this.sy(m.p[2]);
      if (p.length * px > 26) {
        c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
        this.label(String(p.index + 1), x, y - 11, '#fff');
        if (p.maxY > 1) this.label('+' + Math.round(p.maxY), x, y + 12, '#fff');
      }
    }
    // 選択
    const sel = pl[this.selected];
    if (sel) { path(sel); c.strokeStyle = '#111'; c.lineWidth = 6; c.stroke(); c.strokeStyle = '#ffe14a'; c.lineWidth = 3.5; c.stroke(); }
    // スタート印: start 部品があればチェッカー柄の帯と S、無ければ最初の部品の入口に今までどおりの印
    const sp = pl.find((p) => p.spec.type === 'start');
    if (sp) { this.checker(sp.start, w); this.startMark(sp.start, w); }
    else this.startMark(pl[0].start, w);
    // 周回方向: スタートの少し先に矢印を1つ。大きさは画面上の px で固定（縮小しても大きくならない）
    {
      const f = (sp ?? pl[0]).start, d = Math.min(26, Math.max(12, 160 * k));
      this.arrow(this.sx(f.p[0]) + f.f[0] * d, this.sy(f.p[2]) + f.f[2] * d, f.f[0], f.f[2], 8, '#111', '#fff');
    }
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
  // スタートライン: 入口から 40〜100mm の所に 2列のチェッカー（壁の内側いっぱい）
  private checker(f: Frame, w: number) {
    const c = this.ctx, r = right(f);
    const inner = w - 2 * dim(this.lanes, 'wallThickness', this.dims);
    const cols = 12, rows = 2, d0 = 40, d1 = 100;
    const cw = inner / cols, rh = (d1 - d0) / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const a0 = -inner / 2 + i * cw, a1 = a0 + cw, b0 = d0 + j * rh, b1 = b0 + rh;
        const pt = (a: number, b: number): [number, number] => [this.sx(f.p[0] + r[0] * a + f.f[0] * b), this.sy(f.p[2] + r[2] * a + f.f[2] * b)];
        c.beginPath();
        [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)].forEach(([x, y], n) => (n ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath(); c.fillStyle = (i + j) % 2 ? '#fff' : '#111'; c.fill();
      }
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
