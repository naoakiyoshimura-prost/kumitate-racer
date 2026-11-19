// スポンジブレーキの「ベンチ」: コース2枚を組み合わせた所にマシンを置き、真横から見て前後に動かす（ガレージの目安表示だけ）
// 2026-11-13 店長「直線→スロープ・直線→バンク・20度→20度・20度→スロープのようにコースを2枚組み合わせて、マシンを置いて前後に揺さぶる」
// 「真横からタイヤとブレーキ、シャーシの配置だけの簡略透過図で、ゆっくり動かして接触しているタイミングを赤く光らせる」
// 路面はエディタの部品の形（editor/geom の寸法）から作り、ゲームと同じ間隔の点＋同じスプライン（centripetal Catmull-Rom）でならす。
// 当たり量はゲームの car.ts spongeApproach と同じ式（近づく量 − 隙間）。なので走りの当たり方と一致する（点の並び方で±10%ほど揺れる）
import * as THREE from 'three';
import { spongePlaceMm, type Tuning } from './car';
import { Track } from './track';
import { brakeGuide, type BrakeEnd, type BrakeSet } from './setup';
import { build } from './editor/geom';
import { dim } from './editor/catalog';
import { bridgeOn, LCJ_SPAN } from './editor/view2d';
import type { PieceSpec } from './editor/types';

// 1つ目・2つ目のセクションを選ぶ（店長「基本は直線→スロープ、そこから変更」「角度がついてるやつは1セクション目と2セクション目選べるように」11-18）。
// 形はエディタの部品そのもの。40度＝20度→20度、20度＋30度＝20度→30度のように2つの組み合わせで作る。
// LCの橋・LCジャンプ台は中心線が平らな部品なので、ゲームの走りと同じ形（track.ts crossLift / rampLift）で渡るレーンの高さを足す
export type BenchPiece = 'straight' | 'slopeUp' | 'slopeDown' | 'steepUp' | 'steepDown' | 'dropUp' | 'dropDown' | 'mtnUp' | 'mtnDown'
  | 'bank20' | 'bank30' | 'bank45' | 'bankEnd' | 'gapJump' | 'lcBridge' | 'lcJump' | 'bumpA' | 'bumpB' | 'hump';
export const BENCH_PIECES: { id: BenchPiece; label: string; spec: PieceSpec; lastOnly?: boolean }[] = [
  { id: 'straight', label: '直線', spec: { type: 'straight', frac: 1 } },
  { id: 'slopeUp', label: 'スロープ上り', spec: { type: 'slopeUp' } },
  { id: 'slopeDown', label: 'スロープ下り', spec: { type: 'slopeDown' } },
  { id: 'steepUp', label: '急スロープ上り', spec: { type: 'slopeUp', steep: true } },
  { id: 'steepDown', label: '急スロープ下り', spec: { type: 'slopeDown', steep: true } },
  { id: 'dropUp', label: '大坂上り', spec: { type: 'slopeUp', drop: true } },
  { id: 'dropDown', label: '大坂下り', spec: { type: 'slopeDown', drop: true } },
  { id: 'mtnUp', label: '大山上り', spec: { type: 'slopeUp', mountain: true } },
  { id: 'mtnDown', label: '大山下り', spec: { type: 'slopeDown', mountain: true } },
  { id: 'bank20', label: 'バンク20度', spec: { type: 'bankApproach' } },
  { id: 'bank30', label: 'バンク30度', spec: { type: 'bankApproach', deg: 30 } },
  { id: 'bank45', label: 'バンク45度', spec: { type: 'bankApproach', deg: 45 } },
  { id: 'bankEnd', label: 'バンク終わり', spec: { type: 'bankApproach', end: true } },
  { id: 'gapJump', label: '切れ目ジャンプ台', spec: { type: 'gapJump' }, lastOnly: true },
  { id: 'lcBridge', label: 'LCの橋（渡るレーン）', spec: { type: 'laneChange' } },
  { id: 'lcJump', label: 'LCジャンプ台', spec: { type: 'laneChange', jump: true }, lastOnly: true },
  { id: 'bumpA', label: 'バウンドA', spec: { type: 'bump' } },
  { id: 'bumpB', label: 'バウンドB', spec: { type: 'bump', kind: 'B' } },
  { id: 'hump', label: 'こぶ', spec: { type: 'hump' } },
];
const MM = 0.020485; // ゲームの縮尺（tuning.brake.mmToGame と同じ）
const POINT_STEP_MM = 0.2 / MM; // ブレーキ判定の点の間隔（書き出しの FINE_STEP_M = 0.2m。2m だと点の並びで谷の深さがぶれた、2026-11-18）
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
  const rise = dim(3, 'laneChangeRise', undefined);
  let cut = Infinity; // ジャンプ台の先端（路面が切れる所）。そこまでしか動かさない
  for (const pc of placed) {
    const n = pc.samples.length - 1;
    const isLc = pc.spec.type === 'laneChange' && pc.index >= 2 && pc.index <= 3;
    pc.samples.forEach((f, j) => {
      const t = n ? j / n : 0;
      let lift = 0;
      if (isLc) lift = rise * bridgeOn(pc.spec, 3, undefined, t).h;
      const q: [number, number] = [Math.hypot(f.p[0], f.p[2]) * Math.sign(f.p[0] || 1), f.p[1] + lift];
      if (prev) {
        const d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        if (d < 1e-6) return;
        dist += d;
      }
      if (isLc && pc.spec.jump && t <= LCJ_SPAN[1]) cut = dist;
      if (pc.spec.type === 'gapJump' && pc.index === 3 && j === n) cut = Math.min(cut, dist - dim(3, 'straightLength', undefined));
      prof.push(q);
      prev = q;
    });
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
    // 1つ目の手前250mm〜2つ目の少し先（長い部品は全体で1400mmまで、ジャンプ台は先端まで）
    s0: (ends[1] - 250) * MM, s1: Math.min(ends[3] + 120, ends[1] + 1400, cut - 50) * MM,
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

// 11-18 店長「もっとシンプルに、バックさせずずっと前進方向でループ。ストレート→スロープだけでいい、どこなのかわからん」
// → 前進のみでループ。上に区間全体を固定で描いて車の居場所を見せ、下は車の寄り図。11-18 訂正でセクション選択は復活（既定は直線→スロープ上り）
//   バンクは図にせず「直線→20度バンク」で当たるかを文字の印だけ残す（合格条件: スロープで当たる・バンクで当たらない）
type Row = { s: number; F: number | null; R: number | null };
function trackOf(t: Tuning, b: Bench, sets: Record<BrakeEnd, BrakeSet | null>): Row[] {
  const k = t.brake!;
  const gaps = { F: sets.F ? brakeGuide(t, sets.F, 'F').gap : 0, R: sets.R ? brakeGuide(t, sets.R, 'R').gap : 0 };
  const rows: Row[] = [];
  for (let s = b.s0; s <= b.s1; s += STEP_MM * MM) {
    const row: Row = { s, F: null, R: null };
    for (const end of ['F', 'R'] as const) {
      const set = sets[end];
      if (set) row[end] = approach(t, b, end, spongePlaceMm(k, end === 'F' ? 'front' : 'rear', set), s) - gaps[end];
    }
    rows.push(row);
  }
  return rows;
}

export class BrakeBench {
  p1: BenchPiece = 'straight';
  p2: BenchPiece = 'slopeUp';
  pos = 0; // 0〜1（動かす範囲の中の位置）
  playing = true;
  private el: HTMLElement | null = null;
  private raf = 0;
  private last = 0;
  private t: Tuning | null = null;
  private sets: Record<BrakeEnd, BrakeSet | null> = { F: null, R: null };
  private active: BrakeEnd = 'F';
  private track: Row[] = [];
  private bank: Row[] = [];

  // 設定が変わったら当たり量の表を作り直す（範囲を STEP_MM ごと）
  update(t: Tuning, sets: Record<BrakeEnd, BrakeSet | null>, active: BrakeEnd) {
    this.t = t;
    this.sets = sets;
    this.active = active;
    this.track = trackOf(t, makeBench(this.p1, this.p2), sets);
    this.bank = trackOf(t, makeBench('straight', 'bank20'), sets);
  }

  html(): string {
    const sel = (n: 1 | 2) => `<label>${n}つ目<select data-bpiece="${n}">` +
      BENCH_PIECES.filter((p) => n === 2 || !p.lastOnly).map((p) => `<option value="${p.id}" ${p.id === (n === 1 ? this.p1 : this.p2) ? 'selected' : ''}>${p.label}</option>`).join('') + `</select></label>`;
    return `<div class="bbench"><div class="bcombos">${sel(1)}<span>→</span>${sel(2)}</div><div class="bctl"><button data-action="bplay">${this.playing ? '⏸ 止める' : '▶ 動かす'}</button><p class="bguide bsum">${this.summary()}</p></div>` +
      `<div class="bsvg">${this.svg()}</div></div>`;
  }

  // スロープで当たるか（主）と、バンクで当たらないか（文字の印だけ）
  private summary(): string {
    const name = (e: BrakeEnd) => (e === 'F' ? '前' : '後');
    const ends = (['F', 'R'] as const).filter((e) => this.sets[e]);
    if (!ends.length) return 'ブレーキが付いていません（付けた場合の設定で見るには「付ける」）';
    const hits = (rows: Row[], e: BrakeEnd) => rows.some((r) => (r[e] ?? -1) > 0);
    const slope = ends.map((e) => `${name(e)}${hits(this.track, e) ? '<b class="hit">当たる</b>' : '当たらない'}`).join('・');
    const bankHit = ends.some((e) => hits(this.bank, e));
    return `この組み合わせ：${slope}　<span class="bmark ${bankHit ? 'ng' : 'ok'}">バンク20度：${bankHit ? '当たる ✕' : '当たらない ✓'}</span>`;
  }

  private aspect = 200 / 360; // 図の縦横比（全画面のパネルでは置き場所に合わせて縦長にする）
  private svg(): string {
    const t = this.t;
    if (!t || !this.track.length) return '';
    const b = makeBench(this.p1, this.p2);
    const k = t.brake!;
    const i = Math.min(this.track.length - 1, Math.round(this.pos * (this.track.length - 1)));
    const row = this.track[i];
    const s = row.s;
    const half = (k.wheelbase * MM) / 2;
    const tireR = ((k.baseTireMm * t.car.diameter) / 2) * MM;
    const W = 360, H = Math.round(Math.min(520, Math.max(200, W * this.aspect))); // 上: 区間全体（固定） 下: 車の寄り図
    const OH = Math.round(Math.min(130, Math.max(58, H * 0.3)));
    const parts: string[] = [];
    // ---- 上: 直線→スロープの全体。カメラは動かさず、車がその上を進む ----
    const from = b.s0 - half - 20 * MM, to = b.s1 + half + 20 * MM;
    const pts: THREE.Vector3[] = [];
    for (let d = from; d <= to; d += 6 * MM) pts.push(frame(b, d).position);
    const minX = Math.min(...pts.map((v) => v.x)), maxX = Math.max(...pts.map((v) => v.x));
    const minY = Math.min(...pts.map((v) => v.y)), maxY = Math.max(...pts.map((v) => v.y));
    const sc = Math.min((W - 24) / (maxX - minX), (OH - 22) / Math.max(1e-6, maxY - minY));
    const O = (v: THREE.Vector3) => [12 + (v.x - minX) * sc, OH - 8 - (v.y - minY) * sc] as const;
    const OS = (v: THREE.Vector3) => O(v).map((n) => n.toFixed(1)).join(',');
    parts.push(`<rect x="0" y="0" width="${W}" height="${OH}" fill="#ffffff06"/>`);
    parts.push(`<polyline points="${pts.map(OS).join(' ')}" fill="none" stroke="#8fa3c0" stroke-width="3" stroke-linejoin="round"/>`);
    // 擦る所を赤く（ブレーキの先が路面に触れる位置）
    for (const end of ['F', 'R'] as const) {
      const set = this.sets[end];
      if (!set) continue;
      const sg = end === 'F' ? 1 : -1;
      const e = spongePlaceMm(k, end === 'F' ? 'front' : 'rear', set) * MM;
      for (const r of this.track) if ((r[end] ?? -1) > 0) {
        const [x, y] = O(frame(b, r.s + sg * (half + e)).position);
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#ff3b3b"/>`);
      }
    }
    // 車（小さな印）: 2輪と車体の線
    const rw = frame(b, s - half), fw = frame(b, s + half);
    const ro = rw.position.clone().addScaledVector(rw.up, tireR), fo = fw.position.clone().addScaledVector(fw.up, tireR);
    const tr = Math.max(2.5, tireR * sc);
    const [rx, ry] = O(rw.position), [fx, fy] = O(fw.position);
    const hotNow = (['F', 'R'] as const).some((e) => (row[e] ?? -1) > 0);
    parts.push(`<line x1="${rx.toFixed(1)}" y1="${(ry - tr).toFixed(1)}" x2="${fx.toFixed(1)}" y2="${(fy - tr).toFixed(1)}" stroke="${hotNow ? '#ff5050' : '#ffd23a'}" stroke-width="4" stroke-linecap="round"/>`);
    for (const c of [ro, fo]) { const [x, y] = O(c); parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${tr.toFixed(1)}" fill="#e6ebf5"/>`); }
    const lb = (id: BenchPiece) => BENCH_PIECES.find((x) => x.id === id)!.label;
    parts.push(`<text x="10" y="12" font-size="10" fill="#8892a6">${lb(this.p1)} → ${lb(this.p2)}（前へ進む・赤＝擦る所）</text>`);
    // ---- 下: 車の寄り図（実寸の比率、車について動く） ----
    const center = frame(b, s).position;
    const zoom = 1; // 横幅で決まる（後ろのブレーキまで入れるには1mm＝2pxが上限）
    const PXM = (2 * zoom) / MM; // 1mm＝2px（置き場所が縦に広いときは最大1.6倍）
    const cx = W / 2 + 20, cy = OH + (H - OH) * 0.55;
    const P = (v: THREE.Vector3) => `${(cx + (v.x - center.x) * PXM).toFixed(1)},${(cy - (v.y - center.y) * PXM).toFixed(1)}`;
    parts.push(`<defs><clipPath id="bfig"><rect x="0" y="${OH + 2}" width="${W}" height="${H - OH - 2}"/></clipPath></defs><g clip-path="url(#bfig)">`);
    const ground: string[] = [];
    for (let ds = -110; ds <= 110; ds += 2) ground.push(P(frame(b, s + ds * MM).position));
    parts.push(`<polyline points="${ground.join(' ')}" fill="none" stroke="#8fa3c0" stroke-width="3" stroke-linejoin="round"/>`);
    const rc = ro, fc = fo;
    const dirv = fc.clone().sub(rc).normalize();
    const upv = new THREE.Vector3(-dirv.y, dirv.x, 0);
    const deckY = tireR * 0.55;
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
      const e = spongePlaceMm(k, end === 'F' ? 'front' : 'rear', set) * MM;
      const g = brakeGuide(t, set, end).gap * MM;
      const near = end === 'F' ? fw : rw;
      const far = end === 'F' ? rw : fw;
      const out = near.position.clone().sub(far.position).normalize();
      const tip = near.position.clone().addScaledVector(out, e).addScaledVector(upv, g);
      const arm0 = (end === 'F' ? chB : chA).clone();
      const c = row[end] ?? -1;
      const hot = c > 0;
      const on = end === this.active;
      const [tx, ty] = P(tip).split(',').map(Number);
      const len = ((k as { spongeLengthMm?: number }).spongeLengthMm ?? 10) * MM;
      const inner = tip.clone().addScaledVector(out, -len);
      const thick = 4 * MM;
      const sponge = [tip, inner, inner.clone().addScaledVector(upv, thick), tip.clone().addScaledVector(upv, thick)].map(P).join(' ');
      const [ax, ay] = P(arm0).split(',');
      parts.push(`<g opacity="${on ? 1 : 0.55}"><line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty - 3}" stroke="#cfd6e4" stroke-width="2"/>` +
        (hot ? `<circle cx="${tx}" cy="${ty}" r="11" fill="#ff3030" opacity=".45"/>` : '') +
        `<polygon points="${sponge}" fill="${hot ? '#ff3b3b' : '#ffd23a'}"/>` +
        `<text x="${tx}" y="${ty + 16}" text-anchor="middle" font-size="10" fill="${hot ? '#ff6b6b' : '#aab3c5'}">${end === 'F' ? '前' : '後'} ${hot ? '当たり' : ''}</text></g>`);
    }
    parts.push('</g>');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
  }

  // ガレージが描き直したあとに呼ぶ。前へ進むだけでループ（毎秒200mm）
  attach(root: HTMLElement | null) {
    this.el = root?.querySelector('.bbench') ?? null;
    cancelAnimationFrame(this.raf);
    if (!this.el) return;
    for (const sel of Array.from(this.el.querySelectorAll<HTMLSelectElement>('select[data-bpiece]'))) {
      sel.addEventListener('pointerdown', (e) => e.stopPropagation());
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        if (sel.dataset.bpiece === '1') this.p1 = sel.value as BenchPiece;
        else this.p2 = sel.value as BenchPiece;
        this.pos = 0;
        if (this.t) this.update(this.t, this.sets, this.active);
        this.redraw();
        const sum = this.el?.querySelector('.bsum');
        if (sum) sum.innerHTML = this.summary();
      });
    }
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.el || !this.el.isConnected) return;
      const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
      if (this.playing) {
        const b = makeBench(this.p1, this.p2);
        this.pos = (this.pos + (dt * 200 * MM) / Math.max(1e-6, b.s1 - b.s0)) % 1; // 毎秒200mm（実寸）で前へ
        this.redraw();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private redraw() {
    const box = this.el?.querySelector('.bsvg');
    if (!box) return;
    const r = (box as HTMLElement).getBoundingClientRect();
    if (r.width > 50 && r.height > 50) this.aspect = r.height / r.width;
    box.innerHTML = this.svg();
  }
}

// 調査用（tools/brakeheight.ts）: 2つの部品の組み合わせで、ブレーキの点（車軸から eMm 外）が路面へ近づく量の最大（mm）
export function benchMaxApproach(t: Tuning, p1: BenchPiece, p2: BenchPiece, end: BrakeEnd, eMm: number): number {
  const b = makeBench(p1, p2);
  let max = -Infinity;
  for (let s = b.s0; s <= b.s1; s += STEP_MM * MM) max = Math.max(max, approach(t, b, end, eMm, s));
  return max;
}
