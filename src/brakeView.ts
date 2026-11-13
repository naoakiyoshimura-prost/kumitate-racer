// スポンジブレーキの「ベンチ」: コース2枚を組み合わせた所にマシンを置き、真横から見て前後に動かす（ガレージの目安表示だけ）
// 2026-11-13 店長「直線→スロープ・直線→バンク・20度→20度・20度→スロープのようにコースを2枚組み合わせて、マシンを置いて前後に揺さぶる」
// 「真横からタイヤとブレーキ、シャーシの配置だけの簡略透過図で、ゆっくり動かして接触しているタイミングを赤く光らせる」
// 路面はエディタの部品の形（editor/geom の寸法）から作り、ゲームと同じ間隔の点＋同じスプライン（centripetal Catmull-Rom）でならす。
// 当たり量はゲームの car.ts spongeApproach と同じ式（近づく量 − 隙間）。なので走りの当たり方と一致する（点の並び方で±10%ほど揺れる）
import * as THREE from 'three';
import type { Tuning } from './car';
import { Track } from './track';
import { brakeGuide, type BrakeEnd, type BrakeSet } from './setup';
import { build } from './editor/geom';
import type { PieceSpec } from './editor/types';

// 1つ目・2つ目のセクションを選ぶ（店長「基本は直線→スロープ、そこから変更」）。形はエディタの部品そのもの
export type BenchPiece = 'straight' | 'slopeUp' | 'slopeDown' | 'bank20' | 'bank30' | 'bankEnd' | 'bumpA' | 'bumpB' | 'hump';
export const BENCH_PIECES: { id: BenchPiece; label: string; spec: PieceSpec }[] = [
  { id: 'straight', label: '直線', spec: { type: 'straight', frac: 1 } },
  { id: 'slopeUp', label: 'スロープ上り', spec: { type: 'slopeUp' } },
  { id: 'slopeDown', label: 'スロープ下り', spec: { type: 'slopeDown' } },
  { id: 'bank20', label: '20度', spec: { type: 'bankApproach' } },
  { id: 'bank30', label: '30度', spec: { type: 'bankApproach', deg: 30 } },
  { id: 'bankEnd', label: 'バンク終わり', spec: { type: 'bankApproach', end: true } },
  { id: 'bumpA', label: 'バウンドA', spec: { type: 'bump' } },
  { id: 'bumpB', label: 'バウンドB', spec: { type: 'bump', kind: 'B' } },
  { id: 'hump', label: 'こぶ', spec: { type: 'hump' } },
];
const MM = 0.020485; // ゲームの縮尺（tuning.brake.mmToGame と同じ）
const POINT_STEP_MM = 2 / MM; // ゲームの点の間隔（書き出しの POINT_STEP_M = 2m）
const STEP_MM = 3; // ベンチで動かす刻み
const UP = new THREE.Vector3(0, 1, 0);

interface Bench { curve: THREE.CatmullRomCurve3; length: number; s0: number; s1: number; joint: number }
const cache = new Map<string, Bench>();
function makeBench(p1: BenchPiece, p2: BenchPiece): Bench {
  const key = `${p1}>${p2}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = (id: BenchPiece) => ({ ...BENCH_PIECES.find((x) => x.id === id)!.spec });
  const S: PieceSpec = { type: 'straight', frac: 1 };
  const placed = build({ version: 1, name: 'bench', lanes: 3, pieces: [S, S, spec(p1), spec(p2), S, S] }).placed;
  // 中心線を真横から見た形（x: 前, y: 上、mm）と、部品の切れ目の距離
  const prof: [number, number][] = [];
  const ends: number[] = [];
  let dist = 0;
  let prev: [number, number] | null = null;
  for (const pc of placed) {
    for (const f of pc.samples) {
      const q: [number, number] = [Math.hypot(f.p[0], f.p[2]) * Math.sign(f.p[0] || 1), f.p[1]];
      if (prev) {
        const d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        if (d < 1e-6) continue;
        dist += d;
      }
      prof.push(q);
      prev = q;
    }
    ends.push(dist);
  }
  // ゲームと同じ間隔で点を取り、閉じたスプラインにするため大回りで戻す（戻り道はベンチの範囲から遠いので影響しない）
  const pts: THREE.Vector3[] = [];
  let acc = 0, last = -Infinity;
  for (let i = 0; i < prof.length; i++) {
    if (i) acc += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
    if (acc - last >= POINT_STEP_MM - 1e-6) { pts.push(new THREE.Vector3(prof[i][0] * MM, prof[i][1] * MM, 0)); last = acc; }
  }
  const [ex, ey] = prof[prof.length - 1];
  const far = 3000 * MM;
  pts.push(new THREE.Vector3(ex * MM + far, ey * MM, 0), new THREE.Vector3(ex * MM + far, ey * MM, far), new THREE.Vector3(-far, 0, far), new THREE.Vector3(-far, 0, 0));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  // 動かす範囲: 1つ目の少し手前〜2つ目の少し先（長い直線は手前250mmまで）。車の中心の距離（ゲームの m）
  const b: Bench = {
    curve, length: curve.getLength(), joint: ends[2] * MM,
    s0: Math.max(ends[1] - 60, ends[2] - 300) * MM, s1: Math.min(ends[3] + 80, ends[2] + 700) * MM,
  };
  cache.set(key, b);
  return b;
}
function frame(b: Bench, s: number) {
  const u = (((s % b.length) + b.length) % b.length) / b.length;
  const t3 = b.curve.getTangentAt(u);
  const slope = t3.y / Math.max(0.01, Math.hypot(t3.x, t3.z));
  const tangent = t3.clone().setY(0).normalize();
  const normal = new THREE.Vector3().crossVectors(tangent, UP).normalize();
  return { position: b.curve.getPointAt(u), up: Track.surface(tangent, normal, slope, 0).up };
}
// car.ts spongeApproach と同じ式（mm）
function approach(t: Tuning, b: Bench, end: BrakeEnd, e: number, s: number): number {
  const k = t.brake!;
  const sg = end === 'F' ? 1 : -1;
  const half = (k.wheelbase * MM) / 2;
  const ee = e * MM;
  const near = frame(b, s + sg * half).position;
  const farP = frame(b, s - sg * half).position;
  const tip = near.clone().addScaledVector(near.clone().sub(farP).normalize(), ee);
  const f = frame(b, s + sg * (half + ee));
  return f.position.sub(tip).dot(f.up) / MM;
}

export class BrakeBench {
  p1: BenchPiece = 'straight';
  p2: BenchPiece = 'slopeUp';
  pos = 0; // 0〜1（動かす範囲の中の位置）
  playing = true;
  private dir = 1;
  private el: HTMLElement | null = null;
  private raf = 0;
  private last = 0;
  private t: Tuning | null = null;
  private sets: Record<BrakeEnd, BrakeSet | null> = { F: null, R: null };
  private active: BrakeEnd = 'F';
  private track: { s: number; F: number | null; R: number | null }[] = [];

  // 設定が変わったら当たり量の表を作り直す（範囲を STEP_MM ごと）
  update(t: Tuning, sets: Record<BrakeEnd, BrakeSet | null>, active: BrakeEnd) {
    this.t = t;
    this.sets = sets;
    this.active = active;
    const b = makeBench(this.p1, this.p2);
    const k = t.brake!;
    const gaps = { F: sets.F ? brakeGuide(t, sets.F, 'F').gap : 0, R: sets.R ? brakeGuide(t, sets.R, 'R').gap : 0 };
    this.track = [];
    for (let s = b.s0; s <= b.s1; s += STEP_MM * MM) {
      const row = { s, F: null as number | null, R: null as number | null };
      for (const end of ['F', 'R'] as const) {
        const set = sets[end];
        if (set) row[end] = approach(t, b, end, k.place[end === 'F' ? 'front' : 'rear'][set.place], s) - gaps[end];
      }
      this.track.push(row);
    }
  }

  html(): string {
    const sel = (n: 1 | 2) => `<label>${n}つ目<select data-bpiece="${n}">` +
      BENCH_PIECES.map((p) => `<option value="${p.id}" ${p.id === (n === 1 ? this.p1 : this.p2) ? 'selected' : ''}>${p.label}</option>`).join('') + `</select></label>`;
    const tabs = sel(1) + '<span>→</span>' + sel(2);
    return `<div class="bbench"><div class="bcombos">${tabs}</div><div class="bsvg">${this.svg()}</div>` +
      `<div class="bctl"><button data-action="bplay">${this.playing ? '⏸ 止める' : '▶ 動かす'}</button>` +
      `<input class="bslide" type="range" min="0" max="1000" value="${Math.round(this.pos * 1000)}"></div>` +
      `<p class="bguide bsum">${this.summary()}</p></div>`;
  }

  // どこで当たるか（範囲の中で当たる区間の長さ）
  private summary(): string {
    const name = (e: BrakeEnd) => (e === 'F' ? 'フロント' : 'リヤ');
    const out: string[] = [];
    for (const end of ['F', 'R'] as const) {
      if (!this.sets[end]) continue;
      const rows = this.track.filter((r) => (r[end] ?? -1) > 0);
      const max = Math.max(0, ...this.track.map((r) => r[end] ?? -9));
      out.push(rows.length ? `${name(end)}：<b class="hit">当たる</b>（約${rows.length * STEP_MM}mmの間、最大${max.toFixed(2)}mm）` : `${name(end)}：当たらない（あと${(-Math.max(...this.track.map((r) => r[end] ?? -9))).toFixed(2)}mm）`);
    }
    return out.length ? out.join('　') : 'ブレーキが付いていません（付けた場合の設定で見るには「付ける」）';
  }

  private svg(): string {
    const t = this.t;
    if (!t || !this.track.length) return '';
    const b = makeBench(this.p1, this.p2);
    const k = t.brake!;
    const i = Math.min(this.track.length - 1, Math.round(this.pos * (this.track.length - 1)));
    const row = this.track[i];
    const s = row.s;
    const W = 360, H = 190, G = 46; // 図・帯グラフの高さ
    const center = frame(b, s).position;
    const PXM = 2 / MM; // 1m(ゲーム) あたり px（1mm＝2px）
    const cx = W / 2 + 20, cy = 88;
    const P = (v: THREE.Vector3) => `${(cx + (v.x - center.x) * PXM).toFixed(1)},${(cy - (v.y - center.y) * PXM).toFixed(1)}`;
    const parts: string[] = [`<defs><clipPath id="bfig"><rect x="0" y="0" width="${W}" height="${H - G - 4}"/></clipPath></defs><g clip-path="url(#bfig)">`];
    // 路面（へこみの色）
    const ground: string[] = [];
    for (let ds = -110; ds <= 110; ds += 2) ground.push(P(frame(b, s + ds * MM).position));
    parts.push(`<polyline points="${ground.join(' ')}" fill="none" stroke="#8fa3c0" stroke-width="3" stroke-linejoin="round"/>`);
    // 2枚のつなぎ目
    const jd = (b.joint - s) / MM;
    if (Math.abs(jd) < 100) {
      const j = frame(b, b.joint);
      const a = j.position.clone(), c = j.position.clone().addScaledVector(j.up, -14 * MM);
      parts.push(`<line x1="${P(a).split(',')[0]}" y1="${P(a).split(',')[1]}" x2="${P(c).split(',')[0]}" y2="${P(c).split(',')[1]}" stroke="#ffffff55" stroke-width="2"/>`);
    }
    // 車（透過の簡略図）: タイヤ2つ・シャーシの線・ブレーキの腕と板
    const half = (k.wheelbase * MM) / 2;
    const tireR = ((k.baseTireMm * t.car.diameter) / 2) * MM;
    const rearG = frame(b, s - half), frontG = frame(b, s + half);
    const rc = rearG.position.clone().addScaledVector(rearG.up, tireR);
    const fc = frontG.position.clone().addScaledVector(frontG.up, tireR);
    const dirv = fc.clone().sub(rc).normalize();
    const upv = new THREE.Vector3(-dirv.y, dirv.x, 0); // 車体の上向き
    const deckY = tireR * 0.55; // シャーシの底面（車軸より下の高さ、見た目だけ）
    const chA = rc.clone().addScaledVector(dirv, -24 * MM).addScaledVector(upv, -deckY * 0.6);
    const chB = fc.clone().addScaledVector(dirv, 22 * MM).addScaledVector(upv, -deckY * 0.6);
    parts.push(`<line x1="${P(chA).split(',')[0]}" y1="${P(chA).split(',')[1]}" x2="${P(chB).split(',')[0]}" y2="${P(chB).split(',')[1]}" stroke="#7fd0ff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/>`);
    for (const c of [rc, fc]) {
      const [px, py] = P(c).split(',');
      parts.push(`<circle cx="${px}" cy="${py}" r="${(tireR * PXM).toFixed(1)}" fill="#ffffff10" stroke="#e6ebf5" stroke-width="2"/><circle cx="${px}" cy="${py}" r="2" fill="#e6ebf5"/>`);
    }
    for (const end of ['R', 'F'] as const) {
      const set = this.sets[end];
      if (!set) continue;
      const e = k.place[end === 'F' ? 'front' : 'rear'][set.place] * MM;
      const g = brakeGuide(t, set, end).gap * MM;
      const near = end === 'F' ? frontG : rearG;
      const far = end === 'F' ? rearG : frontG;
      const out = near.position.clone().sub(far.position).normalize();
      const tip = near.position.clone().addScaledVector(out, e).addScaledVector(upv, g); // ブレーキの下面
      const arm0 = (end === 'F' ? chB : chA).clone();
      const c = row[end] ?? -1;
      const hot = c > 0;
      const on = end === this.active;
      const [tx, ty] = P(tip).split(',').map(Number);
      // スポンジの板: 外側の端が place、内側へ長さ10mm・厚み4mm（店長情報。見た目だけ、当たりは外側の端で計算）
      const len = ((k as { spongeLengthMm?: number }).spongeLengthMm ?? 10) * MM;
      const inner = tip.clone().addScaledVector(out, -len);
      const thick = 4 * MM;
      const sponge = [tip, inner, inner.clone().addScaledVector(upv, thick), tip.clone().addScaledVector(upv, thick)].map(P).join(' ');
      const [ax, ay] = P(arm0).split(',');
      parts.push(`<g opacity="${on ? 1 : 0.55}"><line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty - 3}" stroke="#cfd6e4" stroke-width="2"/>` +
        (hot ? `<circle cx="${tx}" cy="${ty}" r="11" fill="#ff3030" opacity=".45"/>` : '') +
        `<polygon points="${sponge}" fill="${hot ? '#ff3b3b' : '#ffd23a'}"/>` +
        `<text x="${tx}" y="${ty + 16}" text-anchor="middle" font-size="10" fill="${hot ? '#ff6b6b' : '#aab3c5'}">${end === 'F' ? '前' : '後'} ${hot ? `当たり${c.toFixed(2)}mm` : `あと${(-c).toFixed(2)}`}</text></g>`);
    }
    parts.push('</g>');
    // 帯グラフ: 範囲全体での当たり量（0より上＝当たる）。今の位置に縦線
    const gy0 = H - 8, gh = G - 10;
    const maxAbs = Math.max(0.5, ...this.track.flatMap((r) => [Math.abs(r.F ?? 0), Math.abs(r.R ?? 0)]));
    const gx = (j: number) => (6 + (j / (this.track.length - 1)) * (W - 12)).toFixed(1);
    const gyv = (v: number) => (gy0 - gh / 2 - (Math.max(-maxAbs, Math.min(maxAbs, v)) / maxAbs) * (gh / 2)).toFixed(1);
    parts.push(`<rect x="0" y="${gy0 - gh - 2}" width="${W}" height="${gh + 6}" fill="#ffffff08"/>`);
    parts.push(`<line x1="6" y1="${gyv(0)}" x2="${W - 6}" y2="${gyv(0)}" stroke="#ffffff40" stroke-dasharray="3 3"/>`);
    for (const end of ['R', 'F'] as const) {
      if (!this.sets[end]) continue;
      const line = this.track.map((r, j) => `${gx(j)},${gyv(r[end] ?? 0)}`).join(' ');
      parts.push(`<polyline points="${line}" fill="none" stroke="${end === 'F' ? '#ffd23a' : '#7fd0ff'}" stroke-width="1.5"/>`);
      // 当たる所を赤く塗る
      this.track.forEach((r, j) => {
        if ((r[end] ?? -1) > 0) parts.push(`<line x1="${gx(j)}" y1="${gyv(0)}" x2="${gx(j)}" y2="${gyv(r[end]!)}" stroke="#ff3b3b" stroke-width="2"/>`);
      });
    }
    // つなぎ目の位置
    const jj = this.track.findIndex((r) => r.s >= b.joint);
    if (jj >= 0) parts.push(`<line x1="${gx(jj)}" y1="${gy0 - gh}" x2="${gx(jj)}" y2="${gy0 + 2}" stroke="#ffffff55"/>`);
    parts.push(`<line x1="${gx(i)}" y1="${gy0 - gh - 2}" x2="${gx(i)}" y2="${gy0 + 4}" stroke="#fff" stroke-width="2"/>`);
    parts.push(`<text x="6" y="12" font-size="10" fill="#8892a6">前 →　真横（実寸の比率）</text><text x="${W - 6}" y="${gy0 - gh - 5}" text-anchor="end" font-size="9" fill="#8892a6">当たり量（黄=前・水色=後・赤=当たる）</text>`);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
  }

  // ガレージが描き直したあとに呼ぶ。自動で動かす・つまみで動かす
  attach(root: HTMLElement | null) {
    this.el = root?.querySelector('.bbench') ?? null;
    cancelAnimationFrame(this.raf);
    if (!this.el) return;
    const slide = this.el.querySelector<HTMLInputElement>('.bslide');
    slide?.addEventListener('input', () => {
      this.pos = Number(slide.value) / 1000;
      this.playing = false;
      const btn = this.el?.querySelector<HTMLButtonElement>('[data-action="bplay"]');
      if (btn) btn.textContent = '▶ 動かす';
      this.redraw();
    });
    slide?.addEventListener('pointerdown', (e) => e.stopPropagation());
    // セクションを選び直したら作り直す（ガレージ全体は描き直さない）
    for (const sel of Array.from(this.el.querySelectorAll<HTMLSelectElement>('select[data-bpiece]'))) {
      sel.addEventListener('pointerdown', (e) => e.stopPropagation());
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        if (sel.dataset.bpiece === '1') this.p1 = sel.value as BenchPiece;
        else this.p2 = sel.value as BenchPiece;
        this.pos = 0;
        this.dir = 1;
        if (this.t) this.update(this.t, this.sets, this.active);
        this.redraw();
        const sum = this.el?.querySelector('.bsum');
        if (sum) sum.innerHTML = this.summary();
      });
    }
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.el || !this.el.isConnected) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.playing) {
        // 往復 約8秒（ゆっくり）
        this.pos += this.dir * dt / 4;
        if (this.pos > 1) { this.pos = 1; this.dir = -1; }
        if (this.pos < 0) { this.pos = 0; this.dir = 1; }
        this.redraw();
        if (slide) slide.value = String(Math.round(this.pos * 1000));
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private redraw() {
    const box = this.el?.querySelector('.bsvg');
    if (box) box.innerHTML = this.svg();
  }
}
