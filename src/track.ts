import type { Piece } from './pieces';
import * as THREE from 'three';
import { roadTexture, wallTexture } from './textures';

export interface CourseData {
  id: string;
  // ブレーキの当たり判定用の細かい中心線 [x, z, 高さ] の並び（エディタの書き出しだけ。無ければ points のスプラインで計算）
  fine?: number[];
  name: string;
  note?: string;
  laps?: number;
  // レーン数（省略時は tuning.lanes.count）
  lanes?: number;
  // 壁で仕切られたレーン数（指定するとレーン変更不可。各車は自分のレーンの壁の間だけを走る）
  walledLanes?: number;
  // レーンなし: 横位置は細かい刻み（lanes 個）で、コーナーで流されたらその位置にとどまる（元のレーンへ吸い戻さない）。目安線も引かない
  laneless?: boolean;
  // 立体交差: at から length の区間で、レーンが 1→2→3→1 と1つずつずれる。最後のレーンは橋で反対側へ渡る
  crossover?: CrossData;
  // 2か所目以降の立体交差（エディタのコース用）。reverse: 橋は一番左のレーンから一番右へ渡る（ほかのレーンは左隣へ）
  crossovers?: CrossData[];
  // ジャンプ台（LCジャンプ・シフトチェンジの右端レーンの台。エディタの書き出し）。at〜at+length で高さ 0→height に上り、端で切れる。reverse は左端のレーン（無ければ右端）
  ramps?: { at: number; length: number; height: number; reverse?: boolean }[];
  // 大会で「壁あり」（mode: walled）にしたときに使う立体交差（候補は npm run coursecheck）。無いコースは壁ありにできない
  walledCrossover?: { at: number; length: number; height?: number };

  width: number;
  wallHeight: number;
  points: ([number, number] | [number, number, number])[]; // [x, z, 高さ]
  // ピースで書いたコース（src/pieces.ts）。points が無いときは courses.ts でここから points を作る
  pieces?: Piece[];
  jumps?: JumpData[];
  // 低速区間（路面の抵抗が大きく、最高速が tuning.air.slowMul 倍になる）
  slow?: SlowZone[];
  // 分岐路: 区間の中で、左の split 本のレーンの組が左へ sep ずれて rise 上がり、残りは右へ sep ずれる（走りの計算は同じレーンのまま。見た目と高さだけ）
  forks?: ForkData[];
  // 路面の横傾き（度）。points と同じ並びで1点に1つ、点の間はなめらかにつなぐ。+ は進行方向の右側が高い。
  // 無いコースは水平（今までどおり）。コースエディタのバンクが書き出す
  bank?: number[];
  // 坂の頂上で、速さと路面の曲がり具合から自然に浮く（数値は tuning air.crest）。無いコースはジャンプ台でしか飛ばない
  crestTakeoff?: boolean;
  // サーキット式（circuit.ts toCircuit）: レーンを仕切る壁が無く内外の壁だけの広い1本道。走りは laneless と同じで、倍率は mini.json circuit
  circuit?: boolean;
  circuitKind?: 'std' | 'big' | 'bigWide';
  // 縦のループ（エディタの部品）。at から length の区間は逆さまになるので、路面の向きは専用に求め、走りも専用（car.ts updateLoop）。
  // radius はループの半径 (m)。lane=true はレーンチェンジのループ（仕切りレーンのとき、通るとレーンが1つずれる）
  loops?: { at: number; length: number; radius: number; lane?: boolean }[];
}

export interface SlowZone {
  at: number;
  length: number;
}

// ジャンプ台: at（スタートからの距離 m）で飛ぶ。angle を省くと tuning の rampAngle
// 立体交差（レーンチェンジ）。ring があれば、渡るレーンの車は橋ではなくこの輪の上を通る（ねじれ輪チェンジ、src/editor/ring.ts）
export interface CrossData {
  at: number;
  length: number;
  height?: number;
  reverse?: boolean;
  gap?: number; // 飛び移りチェンジ: 橋の真ん中（進み具合 0.5 を中心）の切れ目の幅（交差の長さに対する割合）
  ring?: { pts: [number, number, number][]; bank: number[]; length: number }; // pts = 入口の姿勢で [前, 上, 右]（m）、bank = 横傾き（度、+ で右が高い）、length = 輪の長さ（m）
}

export interface ForkData {
  at: number;
  length: number;
  split: number;
  sep: number;
  rise: number;
}

export interface JumpData {
  at: number;
  angle?: number;
  wave?: boolean; // ウェーブの山（台は描かない。トルネードの飛び立ち地点にもしない）
  gap?: number; // 切れ目ジャンプ: at の先の路面の無い長さ（ゲーム単位）。台は描かず、切れ目を暗く塗る
}

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3; // 進行方向に対して右向き
  slope: number; // 上り坂が + （高さ / 進んだ距離）
  bank: number; // 路面の横傾き（ラジアン、+ で右側が高い）。CourseData.bank の無いコースは常に0
  // ループの中だけ: 立体の進行方向と路面の上向き（逆さまにもなる）。tangent・normal は入口の水平の向きのまま、slope と bank は0
  loop?: { tangent: THREE.Vector3; up: THREE.Vector3; progress: number; index: number };
}

const UP = new THREE.Vector3(0, 1, 0);

// 見えないレール（中心線のスプライン）と、その上に敷く路面・壁
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly halfWidth: number;
  readonly mesh = new THREE.Group();
  // トルネードで飛び立てる地点（ジャンプ台・コーナーの入口・立体交差の入口）
  entries: number[] = [];

  constructor(readonly data: CourseData) {
    const pts = data.points.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    const f = data.fine;
    if (f && f.length >= 12) {
      const fp: THREE.Vector3[] = [];
      for (let i = 0; i + 2 < f.length; i += 3) fp.push(new THREE.Vector3(f[i], f[i + 2], f[i + 1]));
      this.fineCurve = new THREE.CatmullRomCurve3(fp, true, 'centripetal');
      this.fineCurve.arcLengthDivisions = fp.length * 4; // 距離→位置の対応を細かく（既定の200では点が多いと粗い）
      this.fineLength = this.fineCurve.getLength();
    }
    this.halfWidth = data.width / 2;
    // ループの右向き = 入口のすぐ手前の水平の右向き
    this.loopRight = (data.loops ?? []).map((l) => {
      const u = ((((l.at - 0.05) % this.length) + this.length) % this.length) / this.length;
      const tg = this.curve.getTangentAt(u).setY(0).normalize();
      return new THREE.Vector3().crossVectors(tg, UP).normalize();
    });
    this.entries = this.findEntries();
    this.build();
  }

  // ブレーキの当たり判定用の中心線（細かい点列があればそれ、無ければ通常のスプライン）。距離は周の長さの割合で対応させる
  private fineCurve: THREE.CatmullRomCurve3 | null = null;
  private fineLength = 0;
  brakePoint(s: number): { position: THREE.Vector3; tangent: THREE.Vector3 } | null {
    if (!this.fineCurve) return null;
    const u = (((s % this.length) + this.length) % this.length) / this.length;
    return { position: this.fineCurve.getPointAt(u), tangent: this.fineCurve.getTangentAt(u) };
  }

  // 距離 s（m）と横オフセット（-1=左端, +1=右端）からレール上の位置を返す
  frameAt(s: number, offset = 0): TrackFrame {
    const u = (((s % this.length) + this.length) % this.length) / this.length;
    const t3 = this.curve.getTangentAt(u);
    const lp = this.loopAt(s);
    if (lp) {
      // ループの中: 右向きは入口の右向きのまま（ループは横へほとんど振れない）、上向きは 右×進行方向
      // 回りながら横へずれるぶん進行方向に横の成分があるので、右向きは進行方向に直交する成分だけにする
      const tan = t3.clone();
      const base = this.loopRight[lp.index];
      const right = base.clone().addScaledVector(tan, -base.dot(tan)).normalize();
      const up = new THREE.Vector3().crossVectors(right, tan).normalize();
      const position = this.curve.getPointAt(u).addScaledVector(right, offset * this.halfWidth);
      const flat = new THREE.Vector3().crossVectors(UP, base).normalize(); // 入口の水平の進行方向
      return { position, tangent: flat, normal: right, slope: 0, bank: 0, loop: { tangent: tan, up, progress: lp.progress, index: lp.index } };
    }
    const slope = t3.y / Math.max(0.01, Math.hypot(t3.x, t3.z));
    const tangent = t3.setY(0).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    const bank = this.bankAtU(u);
    const position = this.curve.getPointAt(u);
    // 横傾きのある所は、横位置を傾いた路面に沿って取る（水平な所は今までどおり）
    if (bank === 0) position.addScaledVector(normal, offset * this.halfWidth);
    else position.addScaledVector(Track.surface(tangent, normal, slope, bank).right, offset * this.halfWidth);
    return { position, tangent, normal, slope, bank };
  }

  // ループの中なら、その番号と進み具合（0〜1）
  private loopRight: THREE.Vector3[] = [];
  loopAt(s: number): { index: number; progress: number; radius: number; lane: boolean; length: number } | null {
    const ls = this.data.loops;
    if (!ls) return null;
    for (let i = 0; i < ls.length; i++) {
      const d = (((s - ls[i].at) % this.length) + this.length) % this.length;
      if (d < ls[i].length) return { index: i, progress: d / ls[i].length, radius: ls[i].radius, lane: !!ls[i].lane, length: ls[i].length };
    }
    return null;
  }

  // 距離 s の路面の横傾き（ラジアン、+ で右側が高い）
  bankAt(s: number): number {
    if (!this.data.bank || this.loopAt(s)) return 0;
    return this.bankAtU((((s % this.length) + this.length) % this.length) / this.length);
  }

  // u（0〜1、長さの割合）での横傾き。CourseData.bank は点ごとの値なので、曲線の媒介変数（点 i が i/N）で点の間を線形につなぐ
  private bankAtU(u: number): number {
    const b = this.data.bank;
    if (!b || b.length !== this.data.points.length) return 0;
    const n = b.length;
    const x = this.curve.getUtoTmapping(u, 0) * n; // 第2引数0は「u（長さの割合）で探す」
    const i = Math.floor(x) % n;
    const f = x - Math.floor(x);
    const deg = b[i] + (b[(i + 1) % n] - b[i]) * f;
    return (deg * Math.PI) / 180;
  }

  // 路面の向き: right=傾いた路面に沿った右向き、up=路面の上向き（坂と横傾きの両方を含む単位ベクトル）
  static surface(tangent: THREE.Vector3, normal: THREE.Vector3, slope: number, bank: number): { right: THREE.Vector3; up: THREE.Vector3 } {
    const along = tangent.clone().addScaledVector(UP, slope).normalize(); // 坂を含む進行方向
    const lift = new THREE.Vector3().crossVectors(normal, along); // 横傾きなしの路面の上向き
    const c = Math.cos(bank);
    const sn = Math.sin(bank);
    return {
      right: normal.clone().multiplyScalar(c).addScaledVector(lift, sn),
      up: lift.clone().multiplyScalar(c).addScaledVector(normal, -sn),
    };
  }
  surfaceAt(s: number): { right: THREE.Vector3; up: THREE.Vector3 } {
    const f = this.frameAt(s);
    if (f.loop) return { right: f.normal.clone(), up: f.loop.up.clone() };
    return Track.surface(f.tangent, f.normal, f.slope, f.bank);
  }

  // 中心線の曲率 k (1/m) と、曲がる内側が右(+1)か左(-1)か
  curvatureAt(s: number): { k: number; inside: number } {
    if (this.loopAt(s)) return { k: 0, inside: 1 }; // ループはコーナーとして扱わない（走りは専用）
    const d = 2;
    const a = this.frameAt(s - d);
    const b = this.frameAt(s + d);
    const dt = b.tangent.clone().sub(a.tangent).divideScalar(2 * d);
    const k = dt.length();
    const inside = dt.dot(this.frameAt(s).normal) >= 0 ? 1 : -1;
    return { k, inside };
  }

  // 仕切りレーン i の中心の横位置 (m)
  chanCenter(i: number): number {
    const n = this.data.walledLanes ?? 1;
    const w = (2 * this.halfWidth) / n;
    return -this.halfWidth + w * (i + 0.5);
  }

  // 分岐路の区間と進み具合（区間外は null）
  forkAt(s: number): { f: ForkData; p: number } | null {
    for (const f of this.data.forks ?? []) {
      const d = (((s - f.at) % this.length) + this.length) % this.length;
      if (d <= f.length) return { f, p: d / f.length };
    }
    return null;
  }
  // 分かれ具合 0〜1（最初の1/4で分かれ、最後の1/4で合流）。エディタの fork.ts forkE と同じ式
  static forkE(p: number): number {
    const sm = (x: number) => { const v = THREE.MathUtils.clamp(x, 0, 1); return v * v * (3 - 2 * v); };
    return sm(p / 0.25) * (1 - sm((p - 0.75) / 0.25));
  }
  // 仕切りレーン chan の、分岐路での横のずれ（m）と高さ
  forkOffset(s: number, chan: number): { lat: number; y: number } {
    const fa = this.forkAt(s);
    if (!fa) return { lat: 0, y: 0 };
    const e = Track.forkE(fa.p);
    return chan < fa.f.split ? { lat: -fa.f.sep * e, y: fa.f.rise * e } : { lat: fa.f.sep * e, y: 0 };
  }

  // 立体交差区間の進み具合 0〜1（区間外は -1）
  crossProgress(s: number): number {
    for (const c of this.crosses) {
      const d = (((s - c.at) % this.length) + this.length) % this.length;
      if (d <= c.length) return d / c.length;
    }
    return -1;
  }
  // 立体交差の一覧（crossover と crossovers をまとめたもの）
  get crosses(): CrossData[] {
    const d = this.data;
    return d.crossover ? [d.crossover, ...(d.crossovers ?? [])] : d.crossovers ?? [];
  }
  // 距離 s を含む立体交差（無ければ undefined）
  crossAt(s: number) {
    return this.crosses.find((c) => (((s - c.at) % this.length) + this.length) % this.length <= c.length);
  }

  // 距離 s を含むジャンプ台と、その中の進み具合（0〜1）
  rampAt(s: number): { at: number; length: number; height: number; reverse?: boolean; p: number } | undefined {
    for (const r of this.data.ramps ?? []) {
      const d = (((s - r.at) % this.length) + this.length) % this.length;
      if (d <= r.length) return { ...r, p: d / r.length };
    }
    return undefined;
  }
  // 台の上の高さ（入口でも少し高い＝エディタの形 0.05〜0.8 の割合に合わせる）
  static rampLift(p: number, height: number) {
    return height * (0.0625 + 0.9375 * p);
  }

  // 立体交差での横移動（前後1/4は橋の上り下りだけで、横には動かない）と橋の高さ
  static crossShift(p: number): number {
    const x = THREE.MathUtils.clamp((p - 0.25) / 0.5, 0, 1);
    return x * x * (3 - 2 * x);
  }
  crossLift(p: number, height = this.data.crossover?.height ?? 2.6): number {
    const x = THREE.MathUtils.clamp(Math.min(p, 1 - p) / 0.25, 0, 1);
    return height * x * x * (3 - 2 * x);
  }

  // ショートカットで飛び立てる「跳ねる所」: ジャンプ台、立体交差の入口、上り坂の入口、下り坂の入口（頂上）
  private findEntries(): number[] {
    const out = this.jumps.filter((j) => !j.wave).map((j) => j.at);
    for (const c of this.crosses) out.push(c.at);
    // 小さな起伏では飛ばない: 6m 先まで続くはっきりした坂だけ
    const th = 0.07;
    const sl = (s: number) => this.frameAt(s).slope;
    let prev = sl(this.length - 1);
    for (let s = 0; s < this.length; s += 1) {
      const now = sl(s);
      if (now > th && prev <= th && sl(s + 6) > th) out.push(s);
      if (now < -th && prev >= -th && sl(s + 6) < -th) out.push(s);
      prev = now;
    }
    // 近すぎる入口はまとめる
    out.sort((a, b) => a - b);
    return out.filter((s, i) => i === 0 || s - out[i - 1] > 20);
  }

  // 距離 s から range (m) 先までにある、トルネードで飛び立てる地点
  entryAhead(s: number, range: number): number | undefined {
    return this.entries.find((at) => {
      const d = (((at - s) % this.length) + this.length) % this.length;
      return d > 0 && d <= range;
    });
  }

  // at から飛び立って、水平距離 reach 以内で一番先まで進める着地点（コースの距離）を探す。
  // 飛び出しは正面寄り、着地はコースの向きに逆らわない所だけ
  landingFrom(at: number, reach: number): number {
    const a = this.frameAt(at);
    let best = at + Math.min(reach, 40);
    for (let d = 20; d < this.length * 0.6; d += 2) {
      const b = this.frameAt(at + d);
      const dir = b.position.clone().sub(a.position).setY(0);
      const gap = dir.length();
      if (gap > reach) continue;
      dir.normalize();
      if (dir.dot(a.tangent) < 0.3 || b.tangent.dot(dir) < 0.3) continue;
      best = at + d;
    }
    return best;
  }

  get jumps(): JumpData[] {
    return this.data.jumps ?? [];
  }

  // 距離 s から range (m) 先までにジャンプ台があるか
  jumpAhead(s: number, range: number): boolean {
    return this.jumps.some((j) => {
      const d = (((j.at - s) % this.length) + this.length) % this.length;
      return d < range;
    });
  }

  // 距離 s から range (m) 先までにある最初のジャンプ台の位置
  jumpAt(s: number, range: number): number | undefined {
    return this.jumps.find((j) => {
      if (j.wave) return false;
      const d = (((j.at - s) % this.length) + this.length) % this.length;
      return d > 0 && d < range;
    })?.at;
  }

  // 距離 s が低速区間の中か
  slowAt(s: number): boolean {
    return (this.data.slow ?? []).some((z) => {
      const d = (((s - z.at) % this.length) + this.length) % this.length;
      return d <= z.length;
    });
  }

  // 横位置 lat (m) の線をなぞる点列（レーン表示用）
  linePoints(lat: number, step = 1.5): THREE.Vector3[] {
    const n = Math.ceil(this.length / step);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = this.frameAt((i / n) * this.length, lat / this.halfWidth).position;
      pts.push(p.setY(p.y + 0.02));
    }
    return pts;
  }

  private build() {
    const segments = Math.ceil(this.length / 1.5);
    const road: number[] = [];
    const wallL: number[] = [];
    const wallR: number[] = [];
    const roadUv: number[] = [];
    const wallLUv: number[] = [];
    const wallRUv: number[] = [];
    const h = this.data.wallHeight;
    for (let i = 0; i <= segments; i++) {
      const s = (i / segments) * this.length;
      const l = this.frameAt(s, -1).position;
      const r = this.frameAt(s, 1).position;
      const fa = this.forkAt(s);
      if (fa && fa.p > 0 && fa.p < 1) {
        // 分岐路の中: 1本の路面と外壁は消して（地面の下へつぶす）、組ごとの路面を buildForks で描く
        road.push(l.x, -1, l.z, l.x, -1, l.z);
        wallL.push(l.x, -1, l.z, l.x, -1, l.z);
        wallR.push(r.x, -1, r.z, r.x, -1, r.z);
        roadUv.push(0, s / 6, 1, s / 6); wallLUv.push(s / 4, 0, s / 4, 1); wallRUv.push(s / 4, 1, s / 4, 0);
        continue;
      }
      road.push(l.x, l.y, l.z, r.x, r.y, r.z);
      // 壁は地面から立ち上げる（高架部分が浮いて見えないように）。横傾きのある所は、壁の上端を路面に垂直な向きへ倒す
      const bank = this.bankAt(s);
      if (this.loopAt(s)) {
        // ループの壁は路面から路面の上向きへ立てる（地面までは下ろさない）
        const up = this.surfaceAt(s).up;
        wallL.push(l.x, l.y, l.z, l.x + up.x * h, l.y + up.y * h, l.z + up.z * h);
        wallR.push(r.x + up.x * h, r.y + up.y * h, r.z + up.z * h, r.x, r.y, r.z);
      } else if (bank === 0) {
        wallL.push(l.x, -0.5, l.z, l.x, l.y + h, l.z);
        wallR.push(r.x, r.y + h, r.z, r.x, -0.5, r.z);
      } else {
        const up = this.surfaceAt(s).up;
        wallL.push(l.x, -0.5, l.z, l.x + up.x * h, l.y + up.y * h, l.z + up.z * h);
        wallR.push(r.x + up.x * h, r.y + up.y * h, r.z + up.z * h, r.x, -0.5, r.z);
      }
      // 模様の繰り返し: 路面は6mごと、壁は4mごと。壁の模様は上端に合わせる
      roadUv.push(0, s / 6, 1, s / 6);
      wallLUv.push(s / 4, (l.y + 0.5) / -h, s / 4, 1);
      wallRUv.push(s / 4, 1, s / 4, (r.y + 0.5) / -h);
    }
    for (const j of this.jumps) if (!j.wave) this.buildJump(j);
    for (const f of this.data.forks ?? []) this.buildFork(f);
    for (const z of this.data.slow ?? []) this.buildSlow(z);
    if (this.data.walledLanes) this.buildDividers(segments);
    this.mesh.add(
      ribbon(road, segments, 0xffffff, roadUv, roadTexture(!this.data.walledLanes)),
      ribbon(wallL, segments, 0xffffff, wallLUv, wallTexture()),
      ribbon(wallR, segments, 0xffffff, wallRUv, wallTexture()),
    );
  }

  // 分岐路: レーンの組ごとの路面と両側の壁（壁は地面から立ち上げる。上がる組は台の上を走る見た目）
  private buildFork(f: ForkData) {
    const n = this.data.walledLanes ?? 1;
    const w = (2 * this.halfWidth) / n, h = this.data.wallHeight;
    const m = Math.max(4, Math.ceil(f.length / 1.5));
    for (const [c0, c1] of [[0, f.split], [f.split, n]]) {
      const road: number[] = [], wl: number[] = [], wr: number[] = [], uv: number[] = [];
      for (let i = 0; i <= m; i++) {
        const s = f.at + (f.length * i) / m;
        const o = this.forkOffset(s, c0);
        const l = this.frameAt(s, (-this.halfWidth + w * c0 + o.lat) / this.halfWidth).position;
        const r = this.frameAt(s, (-this.halfWidth + w * c1 + o.lat) / this.halfWidth).position;
        l.y += o.y; r.y += o.y;
        road.push(l.x, l.y, l.z, r.x, r.y, r.z);
        wl.push(l.x, -0.5, l.z, l.x, l.y + h, l.z);
        wr.push(r.x, r.y + h, r.z, r.x, -0.5, r.z);
        uv.push(c0 / n, s / 6, c1 / n, s / 6);
      }
      this.mesh.add(ribbon(road, m, 0xffffff, uv, roadTexture(!this.data.walledLanes)), ribbon(wl, m, 0x3aa0a0), ribbon(wr, m, 0x3aa0a0));
    }
  }

  // 低速区間: 路面に赤白のしま模様（2mごと）
  private buildSlow(z: SlowZone) {
    for (let s = z.at, i = 0; s < z.at + z.length; s += 2, i++) {
      const verts: number[] = [];
      for (const t of [s, Math.min(s + 2, z.at + z.length)]) {
        const l = this.frameAt(t, -0.98).position;
        const r = this.frameAt(t, 0.98).position;
        verts.push(l.x, l.y + 0.02, l.z, r.x, r.y + 0.02, r.z);
      }
      this.mesh.add(ribbon(verts, 1, i % 2 ? 0xf4f4f4 : 0xd23c3c));
    }
  }

  // 仕切り壁（低め）と立体交差の橋
  private buildDividers(segments: number) {
    const n = this.data.walledLanes!;
    const w = (2 * this.halfWidth) / n;
    const wallH = 0.5;
    const pos = (s: number, lat: number, lift = 0) => {
      const p = this.frameAt(s, lat / this.halfWidth).position;
      p.y += lift;
      return p;
    };
    // 仕切り k（左から k 本目）
    for (let k = 1; k < n; k++) {
      const verts: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const s = (i / segments) * this.length;
        const p = this.crossProgress(s);
        // 立体交差の区間は下の2レーンを仕切らない（壁を床に沈める）。分岐路では組と一緒にずらし、組の境目は buildFork の壁に任せる
        const fo = this.forkOffset(s, k - 1);
        const fa = this.forkAt(s);
        const edge = !!fa && fa.p > 0 && fa.p < 1 && k === fa.f.split;
        const a = pos(s, -this.halfWidth + w * k + fo.lat, fo.y);
        const top = p >= 0 || edge ? 0 : wallH;
        // 横傾きのある所は、路面に垂直な向きへ立てる
        const up = this.bankAt(s) === 0 && !this.loopAt(s) ? UP : this.surfaceAt(s).up;
        verts.push(a.x, a.y, a.z, a.x + up.x * top, a.y + up.y * top, a.z + up.z * top);
      }
      this.mesh.add(ribbon(verts, segments, 0xd8dde6));
    }
    for (const c of this.crosses) {
    if (c.ring) { this.buildRing(c, w, wallH); continue; }
    // 橋: 一番右のレーンが持ち上がり、地上のレーンをまたいで一番左へ渡る（reverse は左から右へ）
    const m = Math.ceil(c.length / 0.75);
    const from = this.chanCenter(c.reverse ? 0 : n - 1);
    const to = this.chanCenter(c.reverse ? n - 1 : 0);
    // 飛び移りチェンジは切れ目の前後で2本に分ける
    const g = (c.gap ?? 0) / 2;
    for (const [p0, p1] of (g > 0 ? [[0, 0.5 - g], [0.5 + g, 1]] : [[0, 1]])) {
    const mm = Math.max(2, Math.ceil(m * (p1 - p0)));
    const deck: number[] = [];
    const railL: number[] = [];
    const railR: number[] = [];
    for (let i = 0; i <= mm; i++) {
      const p = p0 + ((p1 - p0) * i) / mm;
      const s = c.at + c.length * p;
      const center = from + (to - from) * Track.crossShift(p);
      const lift = this.crossLift(p, c.height ?? 2.6) - 0.08;
      const l = pos(s, center - w / 2, lift);
      const r = pos(s, center + w / 2, lift);
      deck.push(l.x, l.y, l.z, r.x, r.y, r.z);
      railL.push(l.x, l.y, l.z, l.x, l.y + wallH, l.z);
      railR.push(r.x, r.y, r.z, r.x, r.y + wallH, r.z);
    }
    this.mesh.add(ribbon(deck, mm, g > 0 ? 0x6a5a50 : 0x5d6470), ribbon(railL, mm, g > 0 ? 0xe07a2a : 0x2f8fff), ribbon(railR, mm, g > 0 ? 0xe07a2a : 0x2f8fff));
    }
    }
    // ジャンプ台: 端のレーンの上に上り坂の板（端で切れる）
    for (const r of this.data.ramps ?? []) {
      const m = Math.max(2, Math.ceil(r.length / 0.75));
      const deck: number[] = [];
      const c = this.chanCenter(r.reverse ? 0 : n - 1);
      for (let i = 0; i <= m; i++) {
        const p = i / m;
        const s = r.at + r.length * p;
        const lift = Track.rampLift(p, r.height) - 0.06;
        const l = pos(s, c - w / 2 + 0.1, lift);
        const rr = pos(s, c + w / 2 - 0.1, lift);
        deck.push(l.x, l.y, l.z, rr.x, rr.y, rr.z);
      }
      this.mesh.add(ribbon(deck, m, 0xf2c230));
    }
  }

  // ねじれ輪チェンジの輪の上の姿勢。p = 立体交差の中の進み具合（0〜1、輪の長さに沿って等間隔とみなす）
  ringPose(c: CrossData, p: number): { position: THREE.Vector3; tangent: THREE.Vector3; up: THREE.Vector3 } {
    const ring = c.ring!;
    const base = this.frameAt(c.at);
    const f = base.tangent, r = base.normal;
    const at = (i: number) => {
      const q = ring.pts[Math.max(0, Math.min(ring.pts.length - 1, i))];
      return base.position.clone().addScaledVector(f, q[0]).addScaledVector(UP, q[1]).addScaledVector(r, (c.reverse ? -1 : 1) * q[2]);
    };
    const x = THREE.MathUtils.clamp(p, 0, 1) * (ring.pts.length - 1);
    const i = Math.floor(x), u = x - i;
    const position = at(i).lerp(at(i + 1), u);
    const tangent = at(i + 1).sub(at(i - 1 < 0 ? 0 : i)).normalize();
    if (tangent.lengthSq() < 1e-9) tangent.copy(f);
    const right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    const b = (((ring.bank[i] ?? 0) * (1 - u) + (ring.bank[i + 1] ?? ring.bank[i] ?? 0) * u) * Math.PI) / 180 * (c.reverse ? -1 : 1);
    up.applyAxisAngle(tangent, b);
    return { position, tangent, up };
  }

  // ねじれ輪チェンジの輪（透明なピンクの1レーン: 床と両側の壁）
  private buildRing(c: CrossData, w: number, wallH: number) {
    const m = c.ring!.pts.length - 1;
    const deck: number[] = [], railL: number[] = [], railR: number[] = [];
    for (let i = 0; i <= m; i++) {
      const { position: p, tangent, up } = this.ringPose(c, i / m);
      const rr = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const l = p.clone().addScaledVector(rr, -w / 2).addScaledVector(up, -0.08);
      const r = p.clone().addScaledVector(rr, w / 2).addScaledVector(up, -0.08);
      deck.push(l.x, l.y, l.z, r.x, r.y, r.z);
      railL.push(l.x, l.y, l.z, l.x + up.x * wallH, l.y + up.y * wallH, l.z + up.z * wallH);
      railR.push(r.x, r.y, r.z, r.x + up.x * wallH, r.y + up.y * wallH, r.z + up.z * wallH);
    }
    const glass = (verts: number[], color: number, op: number) => {
      const mesh = ribbon(verts, m, color);
      const mat = mesh.material as THREE.MeshLambertMaterial;
      mat.transparent = true; mat.opacity = op; mat.depthWrite = false;
      return mesh;
    };
    this.mesh.add(glass(deck, 0xff5fb0, 0.55), glass(railL, 0xff3fa0, 0.7), glass(railR, 0xff3fa0, 0.7));
  }

  // ジャンプ台（黄色）を路面に描く
  private buildJump(j: JumpData) {
    const strip = (from: number, to: number, color: number, lift: number) => {
      const verts: number[] = [];
      const n = Math.max(1, Math.ceil((to - from) / 1));
      for (let i = 0; i <= n; i++) {
        const s = from + ((to - from) * i) / n;
        const l = this.frameAt(s, -0.98).position;
        const r = this.frameAt(s, 0.98).position;
        const y = lift * (i / n);
        verts.push(l.x, l.y + 0.03 + y, l.z, r.x, r.y + 0.03 + y, r.z);
      }
      this.mesh.add(ribbon(verts, n, color));
    };
    if (j.gap) {
      strip(j.at, j.at + j.gap, 0x141824, 0); // 切れ目（路面の無い所）
      strip(j.at - 0.6, j.at, 0xf2c230, 0); // 縁の黄色い線
      return;
    }
    strip(j.at - 3, j.at, 0xf2c230, 0.8);
  }
}

// 2頂点ずつ並んだ帯状のメッシュを作る
function ribbon(verts: number[], segments: number, color: number, uv?: number[], map?: THREE.Texture): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...(map ? { map } : {}) }));
}
