import * as THREE from 'three';
import { roadTexture, wallTexture } from './textures';

export interface CourseData {
  id: string;
  name: string;
  note?: string;
  laps?: number;
  // レーン数（省略時は tuning.lanes.count）
  lanes?: number;
  width: number;
  wallHeight: number;
  points: ([number, number] | [number, number, number])[]; // [x, z, 高さ]
  jumps?: JumpData[];
}

// ジャンプ台: at（スタートからの距離 m）で飛ぶ。angle を省くと tuning の rampAngle
export interface JumpData {
  at: number;
  angle?: number;
}

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3; // 進行方向に対して右向き
  slope: number; // 上り坂が + （高さ / 進んだ距離）
}

const UP = new THREE.Vector3(0, 1, 0);

// 見えないレール（中心線のスプライン）と、その上に敷く路面・壁
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly halfWidth: number;
  readonly mesh = new THREE.Group();

  constructor(readonly data: CourseData) {
    const pts = data.points.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    this.halfWidth = data.width / 2;
    this.build();
  }

  // 距離 s（m）と横オフセット（-1=左端, +1=右端）からレール上の位置を返す
  frameAt(s: number, offset = 0): TrackFrame {
    const u = (((s % this.length) + this.length) % this.length) / this.length;
    const t3 = this.curve.getTangentAt(u);
    const slope = t3.y / Math.max(0.01, Math.hypot(t3.x, t3.z));
    const tangent = t3.setY(0).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    const position = this.curve.getPointAt(u).addScaledVector(normal, offset * this.halfWidth);
    return { position, tangent, normal, slope };
  }

  // 中心線の曲率 k (1/m) と、曲がる内側が右(+1)か左(-1)か
  curvatureAt(s: number): { k: number; inside: number } {
    const d = 2;
    const a = this.frameAt(s - d);
    const b = this.frameAt(s + d);
    const dt = b.tangent.clone().sub(a.tangent).divideScalar(2 * d);
    const k = dt.length();
    const inside = dt.dot(this.frameAt(s).normal) >= 0 ? 1 : -1;
    return { k, inside };
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
      road.push(l.x, l.y, l.z, r.x, r.y, r.z);
      // 壁は地面から立ち上げる（高架部分が浮いて見えないように）
      wallL.push(l.x, -0.5, l.z, l.x, l.y + h, l.z);
      wallR.push(r.x, r.y + h, r.z, r.x, -0.5, r.z);
      // 模様の繰り返し: 路面は6mごと、壁は4mごと。壁の模様は上端に合わせる
      roadUv.push(0, s / 6, 1, s / 6);
      wallLUv.push(s / 4, (l.y + 0.5) / -h, s / 4, 1);
      wallRUv.push(s / 4, 1, s / 4, (r.y + 0.5) / -h);
    }
    for (const j of this.jumps) this.buildJump(j);
    this.mesh.add(
      ribbon(road, segments, 0xffffff, roadUv, roadTexture()),
      ribbon(wallL, segments, 0xffffff, wallLUv, wallTexture()),
      ribbon(wallR, segments, 0xffffff, wallRUv, wallTexture()),
    );
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
