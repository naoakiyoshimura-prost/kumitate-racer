// コースエディタの幾何: 部品の並び → 位置・姿勢・点列・外形・チェック。three に依存しない純粋なTS（node でテストできる）。
// 単位は mm、座標は右手系で y が上。姿勢は Frame（位置 p・進行方向 f・路面の上 u）で持ち、
// 部品ごとに「部品の座標系（前 f・上 u・右 r）での変換」を掛けて次の部品へ渡す（3次元の回転。水平専用の式にしない）。
import type { Built, Check, CheckMessage, Frame, LaneCount, Layout, PieceSpec, PieceType, Placed, Vec3 } from './types';
import { CATALOG, dim as dimOf, dimKey, trackWidth, validDimValue } from './catalog';

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
  warn?: string;
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

// ---- 坂（スロープ）: 入口の丸み（円弧）→ 一定角度の斜面 → 出口の丸み（円弧）→ 水平 ----
// 上り（sg=+1）: 入口はへこむ向きの円弧（中心が上）、出口はふくらむ向きの円弧。下り（sg=−1）はその逆。
// 角度 a（ラジアン）・高さ H・折れ目の半径 R のとき（どちらの丸みも同じ R）:
//   丸み1つの水平 ax = R·sin a、高さ ah = R·(1 − cos a)、中心線の長さ R·a
//   斜面の中心線の長さ Ls = (H − 2·ah) / sin a、水平の長さ X = 2·ax + Ls·cos a、中心線の全長 2·R·a + Ls
// H < 2·ah（半径が大きすぎて丸みだけで高さを超える）なら R を H / (2(1 − cos a)) に縮める（Ls = 0）
export interface RampDims {
  angleRad: number;
  rise: number;
  radius: number; // 実際に使った半径（縮めた場合はその値）
  slopeLen: number; // 斜面（一定角度の部分）の中心線の長さ
  horizontal: number; // 上から見た長さ
  length: number; // 中心線の長さ
  shrunk: boolean; // 半径を縮めたか
}
export function rampByAngle(angleRad: number, rise: number, radius: number): RampDims {
  const a = angleRad;
  let R = radius;
  let shrunk = false;
  if (rise < 2 * R * (1 - Math.cos(a))) {
    R = rise / (2 * (1 - Math.cos(a)));
    shrunk = true;
  }
  const ah = R * (1 - Math.cos(a));
  const Ls = Math.max(0, (rise - 2 * ah) / Math.sin(a));
  return { angleRad: a, rise, radius: R, slopeLen: Ls, horizontal: 2 * R * Math.sin(a) + Ls * Math.cos(a), length: 2 * R * a + Ls, shrunk };
}
// 水平の長さ X と高さ H と半径 R から角度を決める（スロープ用: 長さと高さは表の値のまま）。
// 角度 a での水平の長さ X(a) = 2R·sin a + (H − 2R(1−cos a))/tan a は a に対して減っていくので、二分法で X(a) = X を解く。
// 半径が大きすぎて解が無いときは、丸み2つだけでつながる半径 R = X / (2 sin a)、a = 2·atan(H/X) に縮める
export function rampByLength(horizontal: number, rise: number, radius: number): RampDims {
  const X = horizontal;
  const H = rise;
  const aMax = 2 * Math.atan(H / X); // 丸み2つだけでつながる角度
  const Rmax = X / (2 * Math.sin(aMax));
  if (radius >= Rmax) return { angleRad: aMax, rise: H, radius: Rmax, slopeLen: 0, horizontal: X, length: 2 * Rmax * aMax, shrunk: radius > Rmax };
  const R = radius;
  const xOf = (a: number) => 2 * R * Math.sin(a) + (H - 2 * R * (1 - Math.cos(a))) / Math.tan(a);
  let lo = 1e-9;
  let hi = Math.PI / 2 - 1e-9;
  // 斜面の長さが負にならない範囲に hi を寄せる（H = 2R(1 − cos a) となる角度）
  hi = Math.min(hi, Math.acos(Math.max(-1, 1 - H / (2 * R))));
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (xOf(m) > X) lo = m;
    else hi = m;
  }
  const a = (lo + hi) / 2;
  const d = rampByAngle(a, H, R);
  return { ...d, horizontal: X };
}

function rampShape(d: RampDims, sg: 1 | -1): Shape {
  const { angleRad: a, rise: H, radius: R, slopeLen: Ls } = d;
  const arc = R * a;
  const total = 2 * arc + Ls;
  const ax = R * Math.sin(a);
  const ah = R * (1 - Math.cos(a));
  const X = d.horizontal;
  const frame = (x: number, y: number, phi: number): Local => ({ pos: [x, y, 0], f: [Math.cos(phi), Math.sin(phi), 0], u: [-Math.sin(phi), Math.cos(phi), 0] });
  return {
    length: total,
    at: (t) => {
      if (t >= 1) return frame(X, sg * H, 0); // 出口はちょうど水平・高さ H（丸め誤差を残さない）
      const s = t * total;
      if (s < arc) {
        const th = s / R;
        return frame(R * Math.sin(th), sg * R * (1 - Math.cos(th)), sg * th);
      }
      if (s < arc + Ls) {
        const q = s - arc;
        return frame(ax + q * Math.cos(a), sg * (ah + q * Math.sin(a)), sg * a);
      }
      const ps = (total - s) / R; // 出口までの残りの角度
      return frame(X - R * Math.sin(ps), sg * (H - R * (1 - Math.cos(ps))), sg * ps);
    },
  };
}

// バンクアプローチ1枚の形: 進行方向と上の面の中で、へこむ向き（中心が上）に曲がる円弧。中心角 A = bankAngle、半径 R = bankBendRadius。
// 入口の姿勢の右向き軸まわりに f と u を A だけ起こした姿勢が出口。横には傾けない。
//   入口からの位置 = R·sin θ（前）、R·(1 − cos θ)（上）、θ = 0〜A。弦の長さ 2R·sin(A/2)、中心線の長さ R·A
export interface BankDims {
  angleRad: number;
  radius: number;
  chord: number; // 弦の長さ（入口から出口までの直線距離）
  forward: number; // 入口の向きで測った前への長さ R·sin A
  rise: number; // 入口の向きで測った上への長さ R·(1 − cos A)
  length: number; // 中心線の長さ R·A
}
// deg30: 30度バンク（仮の部品）。弦の長さを20度の部品と同じにして、中心角を30度にする → 半径 = R20·sin(A20/2)/sin(15°)
export function bankDims(lanes: LaneCount, ov?: Record<string, number>, deg30 = false): BankDims {
  const a20 = dimOf(lanes, 'bankAngle', ov) * RAD;
  const R20 = dimOf(lanes, 'bankBendRadius', ov);
  const a = deg30 ? 30 * RAD : a20;
  const R = deg30 ? (R20 * Math.sin(a20 / 2)) / Math.sin(a / 2) : R20;
  return { angleRad: a, radius: R, chord: 2 * R * Math.sin(a / 2), forward: R * Math.sin(a), rise: R * (1 - Math.cos(a)), length: R * a };
}
// スロープ1個の形の寸法
export function slopeDims(lanes: LaneCount, ov?: Record<string, number>): RampDims {
  return rampByLength(dimOf(lanes, 'slopeLength', ov), dimOf(lanes, 'slopeRise', ov), dimOf(lanes, 'slopeBendRadius', ov));
}

function shapeOf(spec: PieceSpec, lanes: LaneCount, ov?: Record<string, number>): Shape {
  const dim = (l: LaneCount, k: string) => dimOf(l, k, ov);
  switch (spec.type) {
    case 'start': // 長さは直線1枚と同じ
    case 'straight': {
      const L = dim(lanes, 'straightLength') * (spec.type === 'start' ? 1 : spec.frac ?? 1);
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
      // 円弧→斜面→円弧。上から見た長さ slopeLength・高さ slopeRise は表の値のまま、角度を折れ目の半径 slopeBendRadius から決める
      const d = slopeDims(lanes, ov);
      const sh = rampShape(d, spec.type === 'slopeUp' ? 1 : -1);
      if (d.shrunk) sh.warn = `スロープの折れ目の半径が大きすぎるため ${Math.round(d.radius)}mm に縮めて置きました`;
      return sh;
    }
    case 'wave': {
      // 路面は平らなまま、中心線が左右に蛇行する（公式の説明「マシンが左右に激しく振られる」）。
      // z = A·sin(2πN·t)·sin²(π·t): 入口と出口で横ずれ0・向きもまっすぐ（前後の部品となめらかにつながる）。
      // 往復の数 N・振れ幅 A は公表値が無いので仮。flip は左右が逆
      const L = dim(lanes, 'waveLength');
      const A = dim(lanes, 'waveSwing') * (spec.flip ? -1 : 1);
      const N = dim(lanes, 'waveCount');
      const w = 2 * Math.PI * N;
      const z = (t: number) => A * Math.sin(w * t) * Math.sin(Math.PI * t) ** 2;
      const dz = (t: number) => (A / L) * (w * Math.cos(w * t) * Math.sin(Math.PI * t) ** 2 + Math.sin(w * t) * Math.PI * Math.sin(2 * Math.PI * t)); // dz/dx
      let length = 0;
      const M = 400;
      for (let i = 0; i < M; i++) length += (L / M) * Math.hypot(1, dz((i + 0.5) / M));
      return {
        length,
        at: (t) => {
          const g = dz(t), k = 1 / Math.hypot(1, g);
          return { pos: [t * L, 0, z(t)], f: [k, 0, g * k], u: [0, 1, 0] };
        },
      };
    }
    case 'laneChange': {
      // 中心線は平らな直線として扱う（橋は部品の中の立体交差。入口と出口は同じ高さ・姿勢）
      const L = dim(lanes, 'laneChangeLength');
      return { length: L, at: (t) => ({ pos: [t * L, 0, 0], f: [1, 0, 0], u: [0, 1, 0] }) };
    }
    case 'bankApproach': {
      // 円弧で上へ bankAngle だけ曲がる（へこむ向き）。入口の姿勢の座標系で書くので、傾いた面の上・下り坂の途中に置いても同じ形
      const d = bankDims(lanes, ov, spec.deg === 30);
      const R = d.radius;
      return {
        length: d.length,
        at: (t) => {
          const th = t * d.angleRad;
          return { pos: [R * Math.sin(th), R * (1 - Math.cos(th)), 0], f: [Math.cos(th), Math.sin(th), 0], u: [-Math.sin(th), Math.cos(th), 0] };
        },
      };
    }
  }
}

export function pieceLabel(spec: PieceSpec): string {
  switch (spec.type) {
    case 'start':
      return 'スタート';
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
    case 'bankApproach':
      return spec.deg === 30 ? '30°バンク' : 'バンクアプローチ';
  }
}

// 部品を置けるか。置けないときは理由（日本語）を返す。スタートは1コースに1個まで
export function canAddPiece(layout: Layout, spec: PieceSpec): string | null {
  if (spec.type === 'start' && layout.pieces.some((p) => p.type === 'start'))
    return 'スタートは1つのコースに1個だけです。置いてあるスタートを削除してから置いてください。';
  return null;
}

// 左右反転: 鏡写しのコース（左コーナーと右コーナーを入れ替える）。並びはそのまま
export function mirrorLayout(layout: Layout): Layout {
  const flipDir = (p: PieceSpec): PieceSpec => (p.type === 'corner' ? { ...p, dir: p.dir === 'L' ? 'R' : 'L' } : p.type === 'wave' ? { type: 'wave', ...(p.flip ? {} : { flip: true }) } : { ...p });
  return { ...layout, pieces: layout.pieces.map(flipDir) };
}

// 逆走: 同じコースを逆向きに走る。並びを逆順にし、後ろから通ると意味が逆になる部品を入れ替える
// （左↔右コーナー、上り↔下りスロープ）。スタートは同じ場所のまま（入口と出口が入れ替わる）
// スロープは入口と出口の丸みが同じ半径なので、後ろから通った形は逆の部品の形と同じ。
// バンクアプローチはそのまま: へこむ向きの円弧は後ろから通っても「進行方向が上へ起きる」へこむ向きの円弧なので、同じ部品になる（並びが逆になるだけ）
export function reverseLayout(layout: Layout): Layout {
  const SWAP: Partial<Record<PieceSpec['type'], PieceSpec['type']>> = { slopeUp: 'slopeDown', slopeDown: 'slopeUp' };
  const rev = (p: PieceSpec): PieceSpec => {
    if (p.type === 'corner') return { ...p, dir: p.dir === 'L' ? 'R' : 'L' };
    return SWAP[p.type] ? { ...p, type: SWAP[p.type]! } : { ...p };
  };
  // コースをその場に残す: 新しい最初の入口 = 今の最後の出口（向きは逆）。出口が水平でないときは向きの水平成分だけ使う
  const out: Layout = { ...layout, pieces: layout.pieces.slice().reverse().map(rev) };
  const pl = build(layout).placed;
  if (pl.length) {
    const e = pl[pl.length - 1].end;
    const q = (v: number) => Math.round(v * 1e6) / 1e6;
    const q0 = (v: number) => q(v) + 0; // -0 を 0 に
    const yaw = q0(Math.atan2(-e.f[2], -e.f[0]) / RAD);
    const p: Vec3 = [q0(e.p[0]), q0(e.p[1]), q0(e.p[2])];
    // 原点から +x 向き（既定）と同じなら持たない（2回反転で元の形に戻る）
    if (Math.hypot(...p) < 1e-3 && Math.abs(yaw) < 1e-3) delete out.origin;
    else out.origin = { p, yawDeg: yaw };
  }
  return out;
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

// 見本: 定番の並び（3レーン用。寸法は表のまま、5レーンでも閉じる）。
// スタート＋直線3 → バンクアプローチ（20度上へ）→ 左180度コーナー（20度傾いた面の上）→ バンクアプローチ（下り20度から水平へ）→
// スロープ上り → 直線4枚（着地）→ 左180度コーナー（スロープの高さで平ら）→ スロープ下り → スタートへ戻る。
// 閉じる理由: 傾いた面の上の180度コーナーは、上から見ると前への張り出しが cos(傾き) 倍に縮むが、180度回ると前への変位は0に戻り
// 横への変位は 2·半径 のまま（傾いた面の右向き軸は水平なので）。前後のアプローチ2枚の前への変位 ±R·sin(傾き) と高さ ±R(1−cos) も打ち消すので、
// 「アプローチ→コーナー×4→アプローチ」は上から見て平らなコーナー×4と同じ所へ出る。直線側は行き（スロープ下り＋スタート＋直線3）と
// 帰り（スロープ上り＋直線4）がどちらも直線5枚ぶん（スロープ1個＝直線1枚の長さ）なので、調整用の直線なしで閉じる。
// approaches=2 は各アプローチを2枚重ねた 40度版（シミュ用）
export function sampleBankValley(lanes: LaneCount = 3, approaches: 1 | 2 = 1): Layout {
  const S: PieceSpec = { type: 'straight', frac: 1 };
  const C: PieceSpec = { type: 'corner', dir: 'L' };
  const A: PieceSpec[] = Array.from({ length: approaches }, () => ({ type: 'bankApproach' }));
  const pieces: PieceSpec[] = [
    { type: 'start' }, S, S, S,
    ...A, C, C, C, C, ...A,
    { type: 'slopeUp' }, S, S, S, S, C, C, C, C,
    { type: 'slopeDown' },
  ];
  const deg = approaches * 20;
  return { version: 1, name: `定番の並び（バンク${deg}°・${lanes}レーン）`, lanes, pieces: pieces.map((p) => ({ ...p })) };
}

// ---- 保存データの読み込み ----
const TYPES: PieceType[] = ['start', 'straight', 'corner', 'wave', 'laneChange', 'slopeUp', 'slopeDown', 'bankApproach'];
// 廃止した部品1: 横に傾くバンク（bankIn / bankOut）。読み込み時に直線1枚へ置き換える（従来どおり）: 旧部品1個の中心線の長さ（bankLength）は
// 直線1枚と同じ（3レーン540・5レーン600、どちらも仮値）だったので、定番の使い方（直線→バンク入口→コーナー180度→バンク戻り→直線）の周回は
// 平らな楕円として閉じたまま読める
const LEGACY_TO_STRAIGHT = ['bankIn', 'bankOut'];
// 廃止した部品2: F12 の「バンク上り / バンク下り」（bankUp / bankDown、高さ bankRise と角度で決まる長い坂）。バンクアプローチ1枚へ置き換える:
// どちらも「バンクの入口・出口に1個ずつ置く部品」で、実物の構成（アプローチ2個＋コーナーを支える台）でも入口・出口に1個ずつなので数を合わせる。
// 角度（angle）は捨てる（アプローチは1枚20度）。形（長さ・高さ）が変わるので周回が閉じなくなることがある（画面で知らせる）
const LEGACY_TO_APPROACH = ['bankUp', 'bankDown'];

// 保存・貼り付けられた JSON → Layout（形が違えば null）。legacy = 直線に置き換えた旧部品の数、legacyBank = アプローチに置き換えた F12 の部品の数
export function parseLayout(x: unknown): { layout: Layout; legacy: number; legacyBank: number } | null {
  const o = x as Layout;
  if (!o || typeof o !== 'object' || o.version !== 1 || (o.lanes !== 3 && o.lanes !== 5) || !Array.isArray(o.pieces)) return null;
  const pieces: PieceSpec[] = [];
  let legacy = 0;
  let legacyBank = 0;
  for (const raw of o.pieces as unknown[]) {
    const p = raw as PieceSpec;
    if (p && LEGACY_TO_STRAIGHT.includes(p.type as string)) {
      pieces.push({ type: 'straight', frac: 1 });
      legacy++;
      continue;
    }
    if (p && LEGACY_TO_APPROACH.includes(p.type as string)) {
      pieces.push({ type: 'bankApproach' });
      legacyBank++;
      continue;
    }
    if (!p || !TYPES.includes(p.type)) return null;
    if (p.type === 'start' && pieces.some((q) => q.type === 'start')) return null; // スタートは1個まで
    const s: PieceSpec = { type: p.type };
    if (p.type === 'straight') s.frac = p.frac === 0.5 || p.frac === 0.25 ? p.frac : 1;
    if (p.type === 'corner') s.dir = p.dir === 'R' ? 'R' : 'L';
    if (p.type === 'wave' && p.flip) s.flip = true;
    if (p.type === 'bankApproach' && p.deg === 30) s.deg = 30;
    pieces.push(s);
  }
  const out: Layout = { version: 1, name: typeof o.name === 'string' ? o.name.slice(0, 40) : 'コース', lanes: o.lanes, pieces };
  const og = o.origin;
  if (og && Array.isArray(og.p) && og.p.length === 3 && og.p.every((v) => Number.isFinite(v)) && Number.isFinite(og.yawDeg)) out.origin = { p: [og.p[0], og.p[1], og.p[2]], yawDeg: og.yawDeg };
  // 寸法の上書き（無い・壊れた項目、変えられない項目、廃止した項目 bankLength・bankRise などは捨てる）
  if (o.dims && typeof o.dims === 'object') {
    const dims: Record<string, number> = {};
    for (const n of [3, 5] as LaneCount[])
      for (const key of Object.keys(CATALOG[n])) {
        const v = (o.dims as Record<string, unknown>)[dimKey(n, key)];
        if (!FIXED_DIMS.includes(key) && validDimValue(key, v)) dims[dimKey(n, key)] = v;
      }
    if (Object.keys(dims).length) out.dims = dims;
  }
  return { layout: out, legacy, legacyBank };
}
// 寸法画面で変えられない項目（部品の前提）
export const FIXED_DIMS = ['cornerAngle', 'bankAngle'];

// ---- 配置 ----
const SAMPLE_STEP = 30; // mm

function place(index: number, spec: PieceSpec, lanes: LaneCount, start: Frame, halfW: number, ov?: Record<string, number>): { placed: Placed; error?: string; warn?: string } {
  const shape = shapeOf(spec, lanes, ov);
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
    // 最低の高さは中心線と路面の両端で見る（傾いた面の上のコーナーは、片側の端が中心線より低い）
    minY = Math.min(minY, s.p[1], s.p[1] - Math.abs(r[1]) * halfW);
    maxY = Math.max(maxY, s.p[1]);
  }
  const outline = [...left, ...rightSide.reverse()];
  return { placed: { index, spec, start, end, samples, outline, length: shape.length, minY, maxY }, error: shape.error, warn: shape.warn };
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
  const ov = layout.dims;
  const dim = (l: LaneCount, k: string) => dimOf(l, k, ov);
  const W = trackWidth(lanes, ov);
  const placed: Placed[] = [];
  const messages: CheckMessage[] = [];
  // 最初の入口（layout.origin があればその位置と向き）
  const yw = (layout.origin?.yawDeg ?? 0) * RAD;
  const START: Frame = layout.origin ? { p: [...layout.origin.p] as Vec3, f: [Math.cos(yw), 0, Math.sin(yw)], u: [0, 1, 0] } : ORIGIN;
  let fr: Frame = START;
  layout.pieces.forEach((spec, i) => {
    const { placed: p, error, warn } = place(i, spec, lanes, fr, W / 2, ov);
    placed.push(p);
    if (error) messages.push({ level: 'error', text: `${i + 1}番目（${pieceLabel(spec)}）: ${error}`, piece: i });
    if (warn) messages.push({ level: 'warn', text: `${i + 1}番目（${pieceLabel(spec)}）: ${warn}`, piece: i });
    fr = p.end;
  });

  const n = placed.length;
  const end = n ? placed[n - 1].end : START;
  const d = sub(end.p, START.p);
  const gapMm = len(d);
  const headingDeg = angleDeg(end.f, START.f);
  const heightMm = Math.abs(d[1]);
  const tiltDeg = angleDeg(end.u, START.u);
  const closed = n > 0 && gapMm <= 1 && headingDeg <= 0.1 && heightMm <= 1 && tiltDeg <= 0.1;
  const laneShift = layout.pieces.filter((p) => p.type === 'laneChange').length;
  const lapsToReturn = laneShift % lanes === 0 ? 1 : lanes / gcd(lanes, laneShift % lanes);
  const totalLengthMm = placed.reduce((s, p) => s + p.length, 0);

  // 床に潜っている部品（中心線か路面の端が床より下）
  const underground = placed.filter((p) => p.minY < -1).map((p) => p.index);
  for (const i of underground)
    messages.push({ level: 'error', text: `${i + 1}番目（${pieceLabel(placed[i].spec)}）が床より下に潜っています（路面の端を含む最低 ${f1(placed[i].minY)}mm）`, piece: i });

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
