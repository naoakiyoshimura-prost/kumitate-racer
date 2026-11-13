import * as THREE from 'three';
import { SLOTS, SLOT_INDEX, type CarKit, type Detail, type Motion, type Palette, type PartDef, type Pose, type Unit, type V3 } from './types';

// 部位キットを組み上げて THREE のメッシュにする。
//   merge（既定）: 部位をまたいで「同じ動きをする単位」を1つのメッシュへまとめる（draw call を減らす）。
//                 固定の部分は全部位で1メッシュ＋ガラス1＋ライト1。左右のポッドの同じ可動部も1メッシュ。
//   split       : 部位ごとに別のグループ（分解表示・工房用）。メッシュ数は増える。
// low の細かさでは、ガラスとライトも不透明メッシュへ入れる（材質を1つに）。
// 色は頂点色。色枠（slot）と部位番号を頂点ごとに覚えておき、setPalette で塗り直す。

const OPAQUE = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
// 白い面が影側で灰色に沈まないよう、頂点色の一部を自己発光として足す（照明はゲーム本体のまま。この材質だけ）[仮: 0.14]
const SELF_LIT = 0.14;
OPAQUE.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', `vec3 totalEmissiveRadiance = emissive + vColor.rgb * ${SELF_LIT.toFixed(2)};`);
};
OPAQUE.customProgramCacheKey = () => 'bodykit-selflit';
const GLASS = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
type Bucket = 'opaque' | 'glass' | 'glow';
const GLASS_I = SLOT_INDEX.glass;
const LAMP_I = [SLOT_INDEX.lamp, SLOT_INDEX.lamp2];

interface NodeRec {
  key: string;
  parentKey: string | null;
  motion: Motion | null;
  pivot: V3; // 車体座標（split のときは部位の取付点基準）
  obj: THREE.Object3D;
  base: THREE.Vector3;
  buckets: Record<Bucket, { pos: number[]; slot: number[]; part: number[] }>;
  units: string[];
}
export interface PaintedMesh {
  mesh: THREE.Mesh;
  slot: Uint8Array; // 三角形ごと
  part: Uint8Array;
}
export interface Assembled {
  group: THREE.Group;
  detail: Detail;
  split: boolean;
  setState(s: number): void;
  setPalette(p: Partial<Palette>, partIds?: string[]): void;
  setExplode(k: number): void;
  partRoots: Map<string, THREE.Object3D>;
  // 単位に付けた目印（噴射口など）。部位 id・目印 id・一緒に動く Object3D・半径
  marks: { part: string; id: string; obj: THREE.Object3D; r: number }[];
  // 単位が載っている動きのまとまり（組み上げ後の Object3D）。外から少し足して動かすとき用（例: ウィングの角度）
  nodeOf(partId: string, unitId: string): THREE.Object3D | null;
  stats: { triangles: number; meshes: number; perPart: Record<string, number> };
  dispose(): void;
}

const pivotKey = (m: Motion, p: V3) => {
  const r = (v: number) => v.toFixed(3);
  if (m.kind === 'translate') return '';
  if (m.kind === 'rotX') return `@${r(p[1])},${r(p[2])}`;
  return `@${r(p[0])},${r(p[1])},${r(p[2])}`;
};

export function assemble(kit: CarKit, opt: { detail: Detail; split?: boolean; partPalettes?: Record<string, Partial<Palette>> }): Assembled {
  const { detail } = opt;
  const split = !!opt.split;
  const group = new THREE.Group();
  group.name = `kit:${kit.id}`;
  const nodes = new Map<string, NodeRec>();
  const order: NodeRec[] = [];
  const partRoots = new Map<string, THREE.Object3D>();
  const palettes: Palette[] = kit.parts.map((p) => ({ ...kit.palette, ...(opt.partPalettes?.[p.id] ?? {}) }));
  const perPart: Record<string, number> = {};
  const marks: Assembled['marks'] = [];
  const unitNode = new Map<string, NodeRec>();

  const newNode = (key: string, parentKey: string | null, motion: Motion | null, pivot: V3, obj?: THREE.Object3D): NodeRec => {
    const n: NodeRec = {
      key, parentKey, motion, pivot, obj: obj ?? new THREE.Group(), base: new THREE.Vector3(),
      buckets: { opaque: { pos: [], slot: [], part: [] }, glass: { pos: [], slot: [], part: [] }, glow: { pos: [], slot: [], part: [] } },
      units: [],
    };
    nodes.set(key, n);
    order.push(n);
    return n;
  };
  if (!split) newNode('root', null, null, [0, 0, 0], group);

  kit.parts.forEach((part: PartDef, pi) => {
    const units = part.build(detail);
    const m = part.mount.pos;
    let rootKey = 'root';
    if (split) {
      rootKey = `p:${part.id}`;
      const root = new THREE.Group();
      root.name = part.id;
      root.userData = { partId: part.id, kind: part.kind, mount: part.mount };
      newNode(rootKey, null, null, [0, 0, 0], root);
      root.position.set(m[0], m[1], m[2]);
      group.add(root);
      partRoots.set(part.id, root);
    }
    const off: V3 = split ? m : [0, 0, 0];
    const unitKey = new Map<string, string>();
    let tris = 0;
    for (const u of units as Unit[]) {
      const pk = u.parent ? unitKey.get(u.parent) : rootKey;
      if (pk === undefined) throw new Error(`${part.id}/${u.id}: 親 ${u.parent} が先に無い`);
      let key = pk;
      if (u.motion) {
        const pv = u.pivot ?? [0, 0, 0];
        const local: V3 = [pv[0] - off[0], pv[1] - off[1], pv[2] - off[2]];
        key = `${pk}/${u.motion.id}${pivotKey(u.motion, local)}`;
        if (!nodes.has(key)) newNode(key, pk, u.motion, local);
      }
      unitKey.set(u.id, key);
      const n = nodes.get(key)!;
      n.units.push(`${part.id}/${u.id}`);
      unitNode.set(`${part.id}/${u.id}`, n);
      for (const mk of u.marks ?? []) {
        const o = new THREE.Object3D();
        o.name = `mark:${part.id}/${mk.id}`;
        o.position.set(mk.pos[0] - off[0] - n.pivot[0], mk.pos[1] - off[1] - n.pivot[1], mk.pos[2] - off[2] - n.pivot[2]);
        n.obj.add(o);
        marks.push({ part: part.id, id: mk.id, obj: o, r: mk.r });
      }
      const P = u.paint;
      tris += P.slot.length;
      for (let t = 0; t < P.slot.length; t++) {
        const s = P.slot[t];
        const b: Bucket = detail === 'low' ? 'opaque' : s === GLASS_I ? 'glass' : LAMP_I.includes(s) ? 'glow' : 'opaque';
        const B = n.buckets[b];
        for (let v = 0; v < 9; v++) B.pos.push(P.pos[t * 9 + v] - off[v % 3] - n.pivot[v % 3]);
        B.slot.push(s);
        B.part.push(pi);
      }
    }
    perPart[part.id] = tris;
  });

  // 親子をつないで、メッシュを作る
  const painted: PaintedMesh[] = [];
  for (const n of order) {
    if (n.parentKey) {
      const p = nodes.get(n.parentKey)!;
      p.obj.add(n.obj);
      n.base.set(n.pivot[0] - p.pivot[0], n.pivot[1] - p.pivot[1], n.pivot[2] - p.pivot[2]);
      n.obj.position.copy(n.base);
      n.obj.name = n.key;
    }
    for (const b of ['opaque', 'glass', 'glow'] as Bucket[]) {
      const B = n.buckets[b];
      if (!B.slot.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(B.pos.length), 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, b === 'glass' ? GLASS : b === 'glow' ? GLOW : OPAQUE);
      mesh.name = `${n.key}:${b}`;
      mesh.userData.units = n.units;
      if (b === 'glass') mesh.renderOrder = 2;
      n.obj.add(mesh);
      painted.push({ mesh, slot: Uint8Array.from(B.slot), part: Uint8Array.from(B.part) });
    }
  }

  const tmp = new THREE.Color();
  const repaint = () => {
    // 部位ごと・色枠ごとの色を先に作る（色空間の変換は THREE.Color に任せる）
    const lin = palettes.map((p) => SLOTS.map((s) => tmp.setHex(p[s]).toArray() as number[]));
    for (const pm of painted) {
      const c = pm.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const arr = c.array as Float32Array;
      for (let t = 0; t < pm.slot.length; t++) {
        const col = lin[pm.part[t]][pm.slot[t]];
        for (let v = 0; v < 3; v++) {
          arr[t * 9 + v * 3] = col[0];
          arr[t * 9 + v * 3 + 1] = col[1];
          arr[t * 9 + v * 3 + 2] = col[2];
        }
      }
      c.needsUpdate = true;
    }
  };
  repaint();

  const pose: Pose = { p: [0, 0, 0], r: [0, 0, 0], sc: 1, vis: true };
  const setState = (s: number) => {
    for (const n of order) {
      if (!n.motion) continue;
      pose.p[0] = pose.p[1] = pose.p[2] = 0;
      pose.r[0] = pose.r[1] = pose.r[2] = 0;
      pose.sc = 1;
      pose.vis = true;
      n.motion.at(s, pose);
      n.obj.position.set(n.base.x + pose.p[0], n.base.y + pose.p[1], n.base.z + pose.p[2]);
      n.obj.rotation.set(pose.r[0], pose.r[1], pose.r[2]);
      n.obj.scale.setScalar(Math.max(1e-3, pose.sc));
      n.obj.visible = pose.vis;
    }
  };
  setState(0);

  let triangles = 0;
  for (const pm of painted) triangles += pm.slot.length;

  return {
    group,
    detail,
    split,
    setState,
    setPalette(p, partIds) {
      kit.parts.forEach((part, i) => {
        if (!partIds || partIds.includes(part.id)) palettes[i] = { ...palettes[i], ...p };
      });
      repaint();
    },
    setExplode(k) {
      if (!split) return;
      for (const part of kit.parts) {
        const r = partRoots.get(part.id)!;
        const m = part.mount.pos, e = part.explode;
        r.position.set(m[0] + e[0] * k, m[1] + e[1] * k, m[2] + e[2] * k);
      }
    },
    partRoots,
    marks,
    nodeOf: (partId, unitId) => unitNode.get(`${partId}/${unitId}`)?.obj ?? null,
    stats: { triangles, meshes: painted.length, perPart },
    dispose() {
      for (const pm of painted) pm.mesh.geometry.dispose();
    },
  };
}

// 部位キットをデータとして取り出す（工房・保存用）。形そのものは含めず、部位・取付・色枠・動く単位の一覧
export function describeKit(kit: CarKit) {
  return {
    id: kit.id,
    name: kit.name,
    states: kit.states,
    slots: SLOTS,
    palette: kit.palette,
    parts: kit.parts.map((p) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      variant: p.variant ?? null,
      mount: p.mount,
      explode: p.explode,
      units: p.build('high').map((u) => ({ id: u.id, label: u.label, parent: u.parent ?? null, motion: u.motion?.id ?? null, triangles: u.paint.triangles })),
    })),
  };
}
