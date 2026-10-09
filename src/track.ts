import * as THREE from 'three';

export interface CourseData {
  name: string;
  width: number;
  wallHeight: number;
  points: [number, number][];
}

export interface TrackFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3; // 進行方向に対して右向き
}

const UP = new THREE.Vector3(0, 1, 0);

// 見えないレール（中心線のスプライン）と、その上に敷く路面・壁
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly halfWidth: number;
  readonly mesh = new THREE.Group();

  constructor(readonly data: CourseData) {
    const pts = data.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    this.halfWidth = data.width / 2;
    this.build();
  }

  // 距離 s（m）と横オフセット（-1=左端, +1=右端）からレール上の位置を返す
  frameAt(s: number, offset = 0): TrackFrame {
    const u = (((s % this.length) + this.length) % this.length) / this.length;
    const tangent = this.curve.getTangentAt(u).setY(0).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    const position = this.curve.getPointAt(u).addScaledVector(normal, offset * this.halfWidth);
    return { position, tangent, normal };
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

  // 横位置 lat (m) の線をなぞる点列（レーン表示用）
  linePoints(lat: number, step = 1.5): THREE.Vector3[] {
    const n = Math.ceil(this.length / step);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      pts.push(this.frameAt((i / n) * this.length, lat / this.halfWidth).position.setY(0.02));
    }
    return pts;
  }

  private build() {
    const segments = Math.ceil(this.length / 1.5);
    const road: number[] = [];
    const wallL: number[] = [];
    const wallR: number[] = [];
    const h = this.data.wallHeight;
    for (let i = 0; i <= segments; i++) {
      const s = (i / segments) * this.length;
      const l = this.frameAt(s, -1).position;
      const r = this.frameAt(s, 1).position;
      road.push(l.x, 0, l.z, r.x, 0, r.z);
      wallL.push(l.x, 0, l.z, l.x, h, l.z);
      wallR.push(r.x, h, r.z, r.x, 0, r.z);
    }
    this.mesh.add(
      ribbon(road, segments, 0x3a3f47),
      ribbon(wallL, segments, 0xe8e2d0),
      ribbon(wallR, segments, 0xe8e2d0),
    );
  }
}

// 2頂点ずつ並んだ帯状のメッシュを作る
function ribbon(verts: number[], segments: number, color: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}
