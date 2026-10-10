import * as THREE from 'three';
import type { Track } from './track';
import { checkerTexture, crowdTexture } from './textures';

// コースの周りの飾り（走りには関係しない）: スタートゲート、ゴールライン、観客席、木
// 返り値の decor（観客席・木）は「演出OFF」で隠せる。ゲートとゴールラインは常に出す
export function buildScenery(track: Track): { group: THREE.Group; decor: THREE.Group } {
  const g = new THREE.Group();
  const decor = new THREE.Group();
  g.add(decor);
  if (typeof document === 'undefined') return { group: g, decor };
  const hw = track.halfWidth;
  const s0 = track.frameAt(0);
  const yaw = Math.atan2(s0.tangent.x, s0.tangent.z);

  // ゴールライン: 路面に市松模様の帯
  const checker = checkerTexture()!;
  const lineTex = checker.clone();
  lineTex.repeat.set(hw, 1);
  lineTex.needsUpdate = true;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.2), new THREE.MeshBasicMaterial({ map: lineTex }));
  line.rotation.set(-Math.PI / 2, 0, yaw);
  line.position.copy(s0.position).setY(s0.position.y + 0.03);
  g.add(line);

  // スタートゲート: 両脇の柱と、上の市松バナー
  const gate = new THREE.Group();
  const post = new THREE.MeshLambertMaterial({ color: 0x30343c });
  const h = 7;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, h, 0.7), post);
    p.position.set(side * (hw + 1.2), h / 2 - 0.5, 0);
    gate.add(p);
  }
  const banTex = checker.clone();
  banTex.repeat.set(hw / 2, 1);
  banTex.needsUpdate = true;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 3.1, 1.4, 0.4), [post, post, post, post, new THREE.MeshLambertMaterial({ map: banTex }), new THREE.MeshLambertMaterial({ map: banTex })]);
  banner.position.y = h - 1;
  gate.add(banner);
  // ゲートの信号（飾り）
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  for (const x of [-1, 0, 1]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.15, 12), lampMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(x * 0.8, h - 2.1, -0.15);
    gate.add(lamp);
  }
  gate.position.copy(s0.position).setY(s0.position.y);
  gate.rotation.y = yaw;
  g.add(gate);

  // 観客席: スタート直後の右側に段々の席
  const crowd = crowdTexture()!;
  const seat = new THREE.MeshLambertMaterial({ color: 0x8c929c });
  for (const [from, side] of [[4, 1], [4, -1]] as const) {
    const len = 18;
    const f = track.frameAt(from + len / 2, side);
    const curved = track.curvatureAt(from + len / 2).k > 0.01;
    if (curved) continue; // 直線にだけ置く
    const stand = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const tex = crowd.clone();
      tex.repeat.set(len / 6, 1);
      tex.needsUpdate = true;
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 1.3), [seat, seat, seat, seat, new THREE.MeshLambertMaterial({ map: tex }), seat]);
      step.position.set(0, 0.45 + i * 0.9, -i * 1.3);
      stand.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.2, 6), new THREE.MeshLambertMaterial({ color: 0xd8dde4 }));
    roof.position.set(0, 5.4, -2.2);
    roof.rotation.x = -0.08;
    stand.add(roof);
    stand.position.copy(f.position).addScaledVector(f.normal, side * 6).setY(-0.5);
    // 席の正面をコース側へ向ける
    stand.rotation.y = Math.atan2(-side * f.normal.x, -side * f.normal.z);
    decor.add(stand);
  }

  // 木: コースから離れた場所に低ポリの円錐をまとめて置く
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s < track.length; s += 4) pts.push(track.frameAt(s).position);
  const box = new THREE.Box3().setFromPoints(pts).expandByScalar(40);
  const clear = hw + 10;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 900 && spots.length < 180; i++) {
    const x = box.min.x + rnd() * (box.max.x - box.min.x);
    const z = box.min.z + rnd() * (box.max.z - box.min.z);
    let near = Infinity;
    for (const p of pts) near = Math.min(near, (p.x - x) ** 2 + (p.z - z) ** 2);
    if (near < clear * clear) continue;
    spots.push(new THREE.Vector3(x, 0, z));
  }
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.5, 6), new THREE.MeshLambertMaterial({ color: 0x2f6b3a, flatShading: true }), spots.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.3, 1.4, 5), new THREE.MeshLambertMaterial({ color: 0x6b4a2e }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => {
    const k = 0.7 + rnd() * 0.7;
    m.makeScale(k, k, k).setPosition(p.x, -0.5 + 1.4 * k + 2.25 * k, p.z);
    leaves.setMatrixAt(i, m);
    m.makeScale(k, k, k).setPosition(p.x, -0.5 + 0.7 * k, p.z);
    trunks.setMatrixAt(i, m);
  });
  decor.add(leaves, trunks);
  return { group: g, decor };
}
