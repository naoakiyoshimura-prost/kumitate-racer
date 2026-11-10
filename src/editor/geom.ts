// コースエディタの幾何: 部品の並び → 位置・姿勢・点列・外形・チェック。three に依存しない純粋なTS（node でテストできる）。
// 単位は mm、座標は右手系で y が上。姿勢は Frame（位置 p・進行方向 f・路面の上 u）で持ち、
// 部品ごとに「部品の座標系（前 f・上 u・右 r）での変換」を掛けて次の部品へ渡す（3次元の回転。水平専用の式にしない）。
import type { Built, Check, CheckMessage, Frame, LaneCount, Layout, PieceSpec, Placed, Vec3 } from './types';
import { dim, trackWidth } from './catalog';

// ---- ベクトル ----
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const angleDeg = (a: Vec3, b: Vec3) => (Math.atan2(len(cross(a, b)), dot(a, b)) * 180) / Math.PI;
const RAD = Math.PI / 180;

// 右向き = 進行方向 × 上（f=+x, u=+y なら右は +z）
export function right(f: Frame): Vec3 {
  return norm(cross(f.f, f.u));
}

const ORIGIN: Frame = { p: [0, 0, 0], f: [1, 0, 0], u: [0, 1, 0] };

// 部品の座標系での1点: pos = [前, 上, 右] の成分、f/u も同じ基底の成分
interface Local {
  pos: Vec3;
  f: Vec3;
  u: Vec3;
}
interface Shape {
  length: number; // 中心線の長さ
  at: (t: number) => Local; // t: 0〜1
  error?: string;
}

function toWorld(base: Frame, l: Local): Frame {
  const r = right(base);
  const w = (v: Vec3): Vec3 => add(add(mul(base.f, v[0]), mul(base.u, v[1])), mul(r, v[2]));
  return { p: add(base.p, w(l.pos)), f: norm(w(l.f)), u: norm(w(l.u)) };
}

// 水平面では向きを45度の倍数にスナップし、u を真上に揃える（丸め誤差をためない）
function snap(fr: Frame): Frame {
  const { f, u } = fr;
  if (1 - u[1] > 1e-9 || Math.abs(f[1]) > 1e-9) return fr;
  const a = Math.atan2(f[2], f[0]);
  const k = Math.round(a / (Math.PI / 4));
  let nf: Vec3 = norm([f[0], 0, f[2]]);
  if (Math.abs(a - k * (Math.PI / 4)) < 1e-7) {
    const m = ((k % 8) + 8) % 8;
    const s = Math.SQRT1_2;
    const table: Vec3[] = [[1, 0, 0], [s, 0, s], [0, 0, 1], [-s, 0, s], [-1, 0, 0], [-s, 0, -s], [0, 0, -1], [s, 0, -s]];
    nf = table[m];
  }
  return { p: fr.p, f: nf, u: [0, 1, 0] };
}

// 縦断（前と上の面の中）の曲線 h(x) を部品にする。入口・出口で傾き0なら f は元に戻る
function profile(L: number, h: (t: number) => number, dh: (t: number) => number): Shape {
  // 長さは数値積分（細かめに）
  let length = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    length += (L / N) * Math.hypot(1, dh(t));
  }
  return {
    length,
    at: (t) => {
      const g = dh(t); // dh/dx
      const k = 1 / Math.hypot(1, g);
      return { pos: [t * L, h(t), 0], f: [k, g * k, 0], u: [-g * k, k, 0] };
    },
  };
}

// 右向きの軸まわりに a（ラジアン、+で機首上げ）だけ回す、長さ L の円弧
function pitchArc(L: number, a: number): Shape {
  if (Math.abs(a) < 1e-12) return { length: L, at: (t) => ({ pos: [t * L, 0, 0], f: [1, 0, 0], u: [0, 1, 0] }) };
  const R = L / Math.abs(a);
  const sg = Math.sign(a);
  return {
    length: L,
    at: (t) => {
      const th = t * a;
      return { pos: [R * Math.sin(Math.abs(th)), sg * R * (1 - Math.cos(th)), 0], f: [Math.cos(th), Math.sin(th), 0], u: [-Math.sin(th), Math.cos(th), 0] };
    },
  };
}

const BANK_ERROR = 'この向きではバンクを戻せません（コーナーを180度ぶん置いてから戻してください）';

function shapeOf(spec: PieceSpec, lanes: LaneCount, start: Frame): Shape {
  switch (spec.type) {
    case 'straight': {
      const L = dim(lanes, 'straightLength') * (spec.frac ?? 1);
      return { length: L, at: (t) => ({ pos: [t * L, 0, 0], f: [1, 0, 0], u: [0, 1, 0] }) };
    }
    case 'corner': {
      // 路面の上 u を軸に回る円弧。位置は入口の姿勢からの閉じた式（sin/cos）で求めるので刻みの誤差はたまらない
      const R = dim(lanes, 'cornerCenterRadius');
      const A = dim(lanes, 'cornerAngle') * RAD;
      const side = spec.dir === 'R' ? 1 : -1; // 右 = +r
      return {
        length: R * A,
        at: (t) => {
          const th = t * A;
          return { pos: [R * Math.sin(th), 0, side * R * (1 - Math.cos(th))], f: [Math.cos(th), 0, side * Math.sin(th)], u: [0, 1, 0] };
        },
      };
    }
    case 'slopeUp':
    case 'slopeDown': {
      const L = dim(lanes, 'slopeLength');
      const H = dim(lanes, 'slopeRise') * (spec.type === 'slopeUp' ? 1 : -1);
      // なだらかなS字: h = H(1−cos πt)/2
      return profile(L, (t) => (H * (1 - Math.cos(Math.PI * t))) / 2, (t) => ((H * Math.PI) / (2 * L)) * Math.sin(Math.PI * t));
    }
    case 'wave': {
      const L = dim(lanes, 'waveLength');
      const H = dim(lanes, 'waveHeight');
      // 山が2つ続く（床より下には下がらない）。前の山が高く後ろの山が低い。flip は部品を逆向きに置いた形（低い山が先）
      // h = k·H(1−cos 4πt)/2 は t=0, 0.5, 1 で高さ0・傾き0。実物の断面は未確認なので仮の形
      const k = (t: number) => ((t < 0.5) !== !!spec.flip ? 1 : 0.5);
      return profile(L, (t) => (k(t) * H * (1 - Math.cos(4 * Math.PI * t))) / 2, (t) => k(t) * ((2 * Math.PI * H) / L) * Math.sin(4 * Math.PI * t));
    }
    case 'laneChange': {
      // 中心線は平らな直線として扱う（橋は部品の中の立体交差。入口と出口は同じ高さ・姿勢）
      const L = dim(lanes, 'laneChangeLength');
      return { length: L, at: (t) => ({ pos: [t * L, 0, 0], f: [1, 0, 0], u: [0, 1, 0] }) };
    }
    case 'bankIn':
      return pitchArc(dim(lanes, 'bankLength'), dim(lanes, 'bankAngle') * RAD);
    case 'bankOut': {
      // 右向きの軸まわりに α 回すと u_y(α) = cosα·u_y − sinα·f_y。u_y を最大（できれば1）にする α を選ぶ
      const a = Math.atan2(-start.f[1], start.u[1]);
      const shape = pitchArc(dim(lanes, 'bankLength'), a);
      const r = right(start);
      // 右向きの軸が水平でなければ、その軸の回転だけでは u を真上に戻せない
      if (Math.abs(r[1]) > Math.sin(0.1 * RAD)) shape.error = BANK_ERROR;
      return shape;
    }
  }
}

export function pieceLabel(spec: PieceSpec): string {
  switch (spec.type) {
    case 'straight':
      return spec.frac === 0.5 ? '直線1/2' : spec.frac === 0.25 ? '直線1/4' : '直線';
    case 'corner':
      return spec.dir === 'R' ? '右45°' : '左45°';
    case 'wave':
      return spec.flip ? 'ウェーブ(反転)' : 'ウェーブ';
    case 'laneChange':
      return 'レーンチェンジ';
    case 'slopeUp':
      return '上りスロープ';
    case 'slopeDown':
      return '下りスロープ';
    case 'bankIn':
      return 'バンク入口';
    case 'bankOut':
      return 'バンク戻り';
  }
}

export function emptyLayout(lanes: LaneCount): Layout {
  return { version: 1, name: '新しいコース', lanes, pieces: [] };
}

// 必ず閉じる見本: 直線2＋左コーナー4＋直線2＋左コーナー4
export function sampleOval(lanes: LaneCount): Layout {
  const S: PieceSpec = { type: 'straight', frac: 1 };
  const C: PieceSpec = { type: 'corner', dir: 'L' };
  return { version: 1, name: `オーバル（${lanes}レーン）`, lanes, pieces: [S, S, C, C, C, C, S, S, C, C, C, C].map((p) => ({ ...p })) };
}

// ---- 配置 ----
const SAMPLE_STEP = 30; // mm

function place(index: number, spec: PieceSpec, lanes: LaneCount, start: Frame, halfW: number): { placed: Placed; error?: string } {
  const shape = shapeOf(spec, lanes, start);
  const n = Math.max(1, Math.ceil(shape.length / SAMPLE_STEP));
  const samples: Frame[] = [];
  for (let i = 0; i <= n; i++) samples.push(i === 0 ? start : toWorld(start, shape.at(i / n)));
  const end = snap(samples[n]);
  samples[n] = end;
  const left: [number, number][] = [];
  const rightSide: [number, number][] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of samples) {
    const r = right(s);
    left.push([s.p[0] - r[0] * halfW, s.p[2] - r[2] * halfW]);
    rightSide.push([s.p[0] + r[0] * halfW, s.p[2] + r[2] * halfW]);
    minY = Math.min(minY, s.p[1]);
    maxY = Math.max(maxY, s.p[1]);
  }
  const outline = [...left, ...rightSide.reverse()];
  return { placed: { index, spec, start, end, samples, outline, length: shape.length, minY, maxY }, error: shape.error };
}

// ---- 外形の交差 ----
type P2 = [number, number];
function segCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function inside(p: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function bbox(poly: P2[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0, z0, x1, z1 };
}
function polysIntersect(a: P2[], b: P2[]): boolean {
  const A = bbox(a);
  const B = bbox(b);
  if (A.x1 < B.x0 || B.x1 < A.x0 || A.z1 < B.z0 || B.z1 < A.z0) return false;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) if (segCross(a1, a2, b[j], b[(j + 1) % b.length])) return true;
  }
  return inside(a[0], b) || inside(b[0], a);
}

// 外形が交差する2部品で、上から見て幅以内に近づく所の高さの差の最小値
function minHeightGap(a: Placed, b: Placed, w: number): number {
  let best = Infinity;
  for (const s of a.samples)
    for (const t of b.samples) {
      if (Math.hypot(s.p[0] - t.p[0], s.p[2] - t.p[2]) < w) best = Math.min(best, Math.abs(s.p[1] - t.p[1]));
    }
  return best;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

// ---- 本体 ----
export function build(layout: Layout): Built {
  const lanes = layout.lanes;
  const W = trackWidth(lanes);
  const placed: Placed[] = [];
  const messages: CheckMessage[] = [];
  let fr: Frame = ORIGIN;
  layout.pieces.forEach((spec, i) => {
    const { placed: p, error } = place(i, spec, lanes, fr, W / 2);
    placed.push(p);
    if (error) messages.push({ level: 'error', text: `${i + 1}番目（${pieceLabel(spec)}）: ${error}`, piece: i });
    fr = p.end;
  });

  const n = placed.length;
  const end = n ? placed[n - 1].end : ORIGIN;
  const d = sub(end.p, ORIGIN.p);
  const gapMm = len(d);
  const headingDeg = angleDeg(end.f, ORIGIN.f);
  const heightMm = Math.abs(d[1]);
  const tiltDeg = angleDeg(end.u, ORIGIN.u);
  const closed = n > 0 && gapMm <= 1 && headingDeg <= 0.1 && heightMm <= 1 && tiltDeg <= 0.1;
  const laneShift = layout.pieces.filter((p) => p.type === 'laneChange').length;
  const lapsToReturn = laneShift % lanes === 0 ? 1 : lanes / gcd(lanes, laneShift % lanes);
  const totalLengthMm = placed.reduce((s, p) => s + p.length, 0);

  // 床に潜っている部品
  const underground = placed.filter((p) => p.minY < -1).map((p) => p.index);
  for (const i of underground)
    messages.push({ level: 'error', text: `${i + 1}番目（${pieceLabel(placed[i].spec)}）が床より下に潜っています（最低 ${f1(placed[i].minY)}mm）`, piece: i });

  // 重なり（隣り合う部品と、周回なら最後と最初は除く。高さの差が壁高＋20mm 以上なら立体交差として許す）
  const clearance = dim(lanes, 'wallHeight') + 20;
  const overlaps: [number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (closed && i === 0 && j === n - 1) continue;
      if (!polysIntersect(placed[i].outline, placed[j].outline)) continue;
      if (minHeightGap(placed[i], placed[j], W) < clearance) {
        overlaps.push([i, j]);
        messages.push({ level: 'error', text: `${i + 1}番目（${pieceLabel(placed[i].spec)}）と${j + 1}番目（${pieceLabel(placed[j].spec)}）が重なっています`, piece: j });
      }
    }

  if (n === 0) {
    messages.push({ level: 'warn', text: '部品がありません。直線やコーナーを置いてください' });
  } else if (closed) {
    messages.unshift({ level: 'ok', text: `周回がつながっています（1周 ${(totalLengthMm / 1000).toFixed(2)}m）` });
  } else {
    const horiz = Math.hypot(d[0], d[2]);
    const parts = [`位置 ${f1(gapMm)}mm（水平 ${f1(horiz)}mm・高さ ${f1(d[1])}mm）`];
    if (headingDeg > 0.1) parts.push(`向き ${f1(headingDeg)}度`);
    if (tiltDeg > 0.1) parts.push(`傾き ${f1(tiltDeg)}度`);
    messages.unshift({ level: 'warn', text: `最後の出口がスタートにつながっていません。ずれ: ${parts.join('、')}`, piece: n - 1 });
  }
  if (laneShift > 0)
    messages.push({ level: 'ok', text: `レーンチェンジ ${laneShift}個: 1周でレーンが${laneShift}つずれ、元のレーンに戻るまで${lapsToReturn}周` });

  const check: Check = { closed, gapMm, headingDeg, heightMm, tiltDeg, laneShift, lapsToReturn, totalLengthMm, overlaps, underground, messages };
  return { placed, check };
}
