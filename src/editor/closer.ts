// 周回を閉じる案（2026-11-27 店長「45度カーブと直線を混ぜると、特殊な部品なしでスタートに戻すのがすごく難しい」
// 「あとこれとこれを使えばきっちりスタートに戻れます、というのを出せないか」「ハーフストレートでも合わないことが多い」
// 「実際何センチの直線があればきれいにつながるか。斜めにつなげたくない」）。
//
// やり方: 今の出口（最後の部品の出口）から前へ、スタートの入口から後ろへ、標準の部品（直線・左45°・右45°）を並べた形を全部たどり、
// 真ん中で位置と向きがぴったり合う組を探す（両側から探すので 20個前後の並びまで速く探せる）。
// 位置の合い方は実寸の計算（geom.ts の部品の形そのもの）で確かめ、最後に build で周回・重なりを確かめた案だけ出す。
// ぴったり合う案が無いとき（45度の向きでは位置が「整数＋整数×√2」の組になり、直線の長さの整数倍では埋まらないことがある）は、
// 「この向きの直線を○mm にすればぴったり閉じる」案を出す。斜めの向きに置く案は後回し（店長「斜めにつなげたくない」）。
import type { Built, Layout, PieceSpec } from './types';
import { build } from './geom';
import { dim } from './catalog';

interface Pose { x: number; z: number; yaw: number } // yaw: +x から +z（右）へ回る角度（ラジアン）
interface Move { spec: PieceSpec; dx: number; dz: number; dyaw: number; key: string }

export interface CloseCandidate {
  pieces: PieceSpec[]; // 今の部品の後ろに足す並び
  removed: number; // 末尾から外す部品の数（ユニバーサル）
  custom?: { mm: number; diagonal: boolean }; // 長さを合わせた直線（1本ぶんの端数）
  built: Built;
  newCount: number;
  lengthM: number;
}
export interface CloseResult { candidates: CloseCandidate[]; note: string }

const TAU = Math.PI * 2;
const normYaw = (a: number) => ((a % TAU) + TAU) % TAU;

function moveOf(layout: Layout, spec: PieceSpec, key: string): Move {
  const b = build({ version: 1, name: '', lanes: layout.lanes, dims: layout.dims, pieces: [spec] });
  const e = b.placed[0].end;
  return { spec, dx: e.p[0], dz: e.p[2], dyaw: Math.atan2(e.f[2], e.f[0]), key };
}
const apply = (p: Pose, m: Move): Pose => {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + m.dx * c - m.dz * s, z: p.z + m.dx * s + m.dz * c, yaw: normYaw(p.yaw + m.dyaw) };
};
// Q のあとに m を置くと p に着く Q
const unapply = (p: Pose, m: Move): Pose => {
  const yaw = normYaw(p.yaw - m.dyaw), c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: p.x - (m.dx * c - m.dz * s), z: p.z - (m.dx * s + m.dz * c), yaw };
};
const yawKey = (y: number) => Math.round((normYaw(y) * 180) / Math.PI * 100) % 36000;

interface Node { pose: Pose; seq: number[] }
// 幅優先で depth 個まで。同じ位置・向きは最初に着いた（短い）並びだけ残す
function expand(start: Pose, moves: Move[], depth: number, back: boolean, cap: number): Node[] {
  const seen = new Set<string>();
  const k = (p: Pose) => `${Math.round(p.x * 10)},${Math.round(p.z * 10)},${yawKey(p.yaw)}`;
  let level: Node[] = [{ pose: start, seq: [] }];
  seen.add(k(start));
  const all: Node[] = [...level];
  for (let d = 0; d < depth && all.length < cap; d++) {
    const next: Node[] = [];
    for (const n of level)
      for (let i = 0; i < moves.length; i++) {
        const pose = back ? unapply(n.pose, moves[i]) : apply(n.pose, moves[i]);
        const kk = k(pose);
        if (seen.has(kk)) continue;
        seen.add(kk);
        next.push({ pose, seq: back ? [i, ...n.seq] : [...n.seq, i] });
      }
    all.push(...next);
    level = next;
  }
  return all;
}

const flat = (u: number[]) => Math.abs(u[1] - 1) < 1e-4;

export function findClosers(layout: Layout, opts: { half?: boolean; max?: number } = {}): CloseResult {
  const max = opts.max ?? 5;
  // 末尾のユニバーサルは外して考える（その代わりを標準の部品で作る）
  let removed = 0;
  while (removed < layout.pieces.length && layout.pieces[layout.pieces.length - 1 - removed].type === 'universal') removed++;
  const base: Layout = { ...layout, pieces: layout.pieces.slice(0, layout.pieces.length - removed) };
  if (!base.pieces.length) return { candidates: [], note: '部品を置いてから使ってください。' };
  const bb = build(base);
  if (bb.check.closed) return { candidates: [], note: removed ? '' : 'もう周回がつながっています。' };
  const E = bb.placed[bb.placed.length - 1].end, T = bb.placed[0].start;
  if (!flat(E.u) || !flat(T.u)) return { candidates: [], note: '出口かスタートが傾いた面の上（バンクの途中など）なので使えません。平らな所で終わる形にしてください。' };

  const S = dim(layout.lanes, 'straightLength', layout.dims);
  const rise = dim(layout.lanes, 'slopeRise', layout.dims);
  const moves: Move[] = [
    moveOf(layout, { type: 'straight', frac: 1 }, 'S'),
    moveOf(layout, { type: 'corner', dir: 'L' }, 'L'),
    moveOf(layout, { type: 'corner', dir: 'R' }, 'R'),
  ];
  if (opts.half) moves.push(moveOf(layout, { type: 'straight', frac: 0.5 }, 'H'));
  // 高さの差はスロープで埋める（スロープは上から見た長さが直線1枚と同じときだけ。違うときは高さが合う案は出さない）
  const dy = E.p[1] - T.p[1];
  const nSlope = Math.round(dy / rise);
  const slopeOk = Math.abs(dy - nSlope * rise) < 1 && (nSlope === 0 || Math.abs(dim(layout.lanes, 'slopeLength', layout.dims) - S) < 0.5);
  if (!slopeOk) return { candidates: [], note: `出口とスタートの高さの差（${Math.round(dy)}mm）がスロープ1段（${rise}mm）の倍数ではないので、平らな部品だけでは閉じられません。` };

  const from: Pose = { x: E.p[0], z: E.p[2], yaw: Math.atan2(E.f[2], E.f[0]) };
  const to: Pose = { x: T.p[0], z: T.p[2], yaw: Math.atan2(T.f[2], T.f[0]) };
  const depth = opts.half ? 7 : 9;
  const cap = 400_000;
  const fw = expand(from, moves, depth, false, cap);
  const bw = expand(to, moves, depth, true, cap);

  // (1) ぴったり合う組: 位置 0.5mm・向き 0.01度
  const cell = (p: Pose) => `${Math.floor(p.x)},${Math.floor(p.z)},${yawKey(p.yaw)}`;
  const grid = new Map<string, Node[]>();
  for (const n of fw) { const c = cell(n.pose); const a = grid.get(c); if (a) a.push(n); else grid.set(c, [n]); }
  const exact: number[][] = [];
  for (const b of bw) {
    const yk = yawKey(b.pose.yaw);
    for (let ix = -1; ix <= 1; ix++)
      for (let iz = -1; iz <= 1; iz++) {
        const a = grid.get(`${Math.floor(b.pose.x) + ix},${Math.floor(b.pose.z) + iz},${yk}`);
        if (!a) continue;
        for (const f of a) if (Math.hypot(f.pose.x - b.pose.x, f.pose.z - b.pose.z) < 0.5) exact.push([...f.seq, ...b.seq]);
      }
  }
  // (2) 長さを合わせた直線1本で閉じる組: 前の並びの出口と後ろの並びの入口が同じ向き・同じ線の上にあり、間が前向きに 30mm 以上
  const lineKey = (p: Pose) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { k: `${yawKey(p.yaw)},${Math.round(-p.x * s + p.z * c)}`, along: p.x * c + p.z * s, lat: -p.x * s + p.z * c }; };
  const lines = new Map<string, { n: Node; along: number; lat: number }[]>();
  for (const n of fw) { const l = lineKey(n.pose); const a = lines.get(l.k); const v = { n, along: l.along, lat: l.lat }; if (a) a.push(v); else lines.set(l.k, [v]); }
  const near: { seq: number[]; at: number; gap: number; diagonal: boolean }[] = [];
  for (const b of bw) {
    const l = lineKey(b.pose);
    const yk = yawKey(b.pose.yaw);
    const diagonal = yk % 9000 !== 0;
    for (const dl of [-1, 0, 1]) {
      const a = lines.get(`${yk},${Math.round(l.lat) + dl}`);
      if (!a) continue;
      for (const f of a) {
        if (Math.abs(f.lat - l.lat) > 0.5) continue;
        const gap = l.along - f.along;
        if (gap < 30 || gap > S * 3) continue;
        if (near.length < 50_000) near.push({ seq: [...f.n.seq, ...b.seq], at: f.n.seq.length, gap, diagonal });
      }
    }
  }

  const toSpecs = (seq: number[]) => seq.map((i) => ({ ...moves[i].spec }));
  // 高さ: 直線をスロープに置き換える（最初の直線から順に）
  const withSlopes = (ps: PieceSpec[]): PieceSpec[] | null => {
    if (!nSlope) return ps;
    let left = Math.abs(nSlope);
    const out = ps.map((p) => {
      if (left > 0 && p.type === 'straight' && (p.frac ?? 1) === 1) { left--; return { type: nSlope > 0 ? 'slopeDown' : 'slopeUp' } as PieceSpec; }
      return p;
    });
    return left ? null : out;
  };
  const baseOverlaps = new Set(bb.check.overlaps.map(([i, j]) => `${i},${j}`));
  const n0 = base.pieces.length;
  const tryOne = (ps: PieceSpec[] | null, custom?: CloseCandidate['custom']): CloseCandidate | null => {
    if (!ps) return null;
    const lay: Layout = { ...base, pieces: [...base.pieces, ...ps] };
    const b = build(lay);
    if (!b.check.closed) return null;
    if (b.check.overlaps.some(([i, j]) => (i >= n0 || j >= n0) && !baseOverlaps.has(`${i},${j}`))) return null; // 足した部品が今のコースや自分と重なる
    if (b.check.underground.some((i) => i >= n0)) return null;
    return { pieces: ps, removed, custom, built: b, newCount: ps.length, lengthM: b.check.totalLengthMm / 1000 };
  };
  const turns = (seq: number[]) => seq.reduce((a, v, i) => a + (i && moves[v].key !== moves[seq[i - 1]].key ? 1 : 0), 0);
  const uniq = <X>(xs: X[], key: (x: X) => string) => { const s = new Set<string>(); return xs.filter((x) => { const k = key(x); if (s.has(k)) return false; s.add(k); return true; }); };

  const out: CloseCandidate[] = [];
  const exactSorted = uniq(exact, (s) => s.join('')).sort((a, b) => a.length - b.length || turns(a) - turns(b));
  for (const seq of exactSorted.slice(0, 300)) {
    const c = tryOne(withSlopes(toSpecs(seq)));
    if (c) out.push(c);
    if (out.length >= max) break;
  }
  // 端数の直線の案（ぴったり案が少ないときに足す）。斜めでない向きを先に、部品が少ない順
  const customs: CloseCandidate[] = [];
  {
    const nearSorted = uniq(near, (n) => `${n.seq.join('')}@${n.at}`).sort((a, b) => Number(a.diagonal) - Number(b.diagonal) || a.seq.length - b.seq.length || turns(a.seq) - turns(b.seq));
    for (const n of nearSorted.slice(0, 400)) {
      const ps = toSpecs(n.seq);
      // 端数ぶんの直線: 540mm の倍数はふつうの直線、残りを1本（0.05〜1枚）
      let rest = n.gap;
      const add: PieceSpec[] = [];
      while (rest > S + 0.01) { add.push({ type: 'straight', frac: 1 }); rest -= S; }
      const frac = Math.round((rest / S) * 10000) / 10000;
      if (frac < 0.05 || frac > 0.998) continue; // ほぼ0やちょうど1枚はぴったり案と同じ
      add.push({ type: 'straight', frac: Math.min(1, frac) });
      ps.splice(n.at, 0, ...add);
      const c = tryOne(withSlopes(ps), { mm: Math.round(rest * 10) / 10, diagonal: n.diagonal });
      if (c && !customs.some((x) => JSON.stringify(x.pieces) === JSON.stringify(c.pieces))) customs.push(c);
      if (customs.length >= 3) break;
    }
  }
  const note = out.length ? '' : customs.length ? `直線・45°カーブ${opts.half ? '・直線1/2' : ''}だけでぴったり閉じる並びは、${depth * 2}個以内では見つかりませんでした。長さを合わせた直線を1本使う案を出します。` : `${depth * 2}個以内の並びでは閉じる案が見つかりませんでした（足した部品が今のコースと重なる案は外しています）。`;
  // ぴったり案があるときは、それより部品が少ない端数の案だけ添える
  const best = out.length ? Math.min(...out.map((c) => c.newCount)) : Infinity;
  return { candidates: [...out, ...customs.filter((c) => c.newCount < best).slice(0, out.length ? 2 : 3)], note };
}

// 並びを短い文に（同じ部品が続くところは ×n）
export function describe(ps: PieceSpec[], label: (p: PieceSpec) => string): string {
  const out: string[] = [];
  let prev = '', n = 0;
  const flush = () => { if (n) out.push(n > 1 ? `${prev}×${n}` : prev); };
  for (const p of ps) { const l = label(p); if (l === prev) n++; else { flush(); prev = l; n = 1; } }
  flush();
  return out.join(' → ');
}
