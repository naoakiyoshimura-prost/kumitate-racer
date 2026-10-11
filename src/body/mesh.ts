import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { blockGeometry, blockMatrix, colorHex, isMirrored, itemMatrix, type BlockColor, type BodyData2 } from './blocks';

// 自作ボディを色ごとに1つのメッシュへまとめる（描画は最大4回）。ゲームのレース・ガレージ用
// 差し色（accent）は渡されたマテリアルを使い、ブースト中に光らせる
export function buildBodyMesh(body: BodyData2, paint: number, accentMat: THREE.Material): THREE.Group {
  const lists = new Map<BlockColor, THREE.BufferGeometry[]>();
  for (const it of body.items) {
    const im = itemMatrix(it);
    for (const b of it.blocks) {
      for (const mirror of isMirrored(b) ? [false, true] : [false]) {
        let g = blockGeometry(b);
        if (g.index) g = g.toNonIndexed();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        const m = blockMatrix(b, mirror).premultiply(im);
        g.applyMatrix4(m);
        if (m.determinant() < 0) flipWinding(g);
        if (!lists.has(b.c)) lists.set(b.c, []);
        lists.get(b.c)!.push(g);
      }
    }
  }
  const group = new THREE.Group();
  for (const [c, geos] of lists) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mat = c === 'accent' ? accentMat : new THREE.MeshLambertMaterial({ color: colorHex(c, paint) });
    group.add(new THREE.Mesh(merged, mat));
  }
  return group;
}
// 左右反転した形は面の向きが裏返るので、三角形の頂点の順番を入れ替えて表に戻す
function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) {
      const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, z);
    }
  }
}
