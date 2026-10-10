import * as THREE from 'three';
import type { Build } from './setup';

// 車体の見た目（仮のカクカク版）。セッティングに合わせてタイヤの数・大きさ・幅、モーター位置が変わる
// 前が +z。原点は路面の高さ
const TIRE_R: Record<string, number> = { small: 0.27, standard: 0.3, large: 0.34 };
const TREAD_W: Record<string, number> = { narrow: 0.18, normal: 0.24, wide: 0.32 };
const MOTOR_Z: Record<string, number> = { front: 0.55, mid: 0, rear: -0.6 };

// シャーシごとの車軸: [前後位置, タイヤ半径の倍率]
const AXLES: Record<string, [number, number][]> = {
  std4: [[0.72, 1], [-0.72, 1]],
  front6: [[1.0, 0.72], [0.5, 0.72], [-0.72, 1]],
  rear6: [[0.72, 1], [-0.5, 0.9], [-1.0, 0.9]],
  eight: [[1.0, 0.8], [0.5, 0.8], [-0.5, 0.8], [-1.0, 0.8]],
};

export function buildCarModel(color: number, build: Build) {
  const group = new THREE.Group();
  const tireR = TIRE_R[build.tireSize] ?? 0.3;
  const treadW = TREAD_W[build.tread] ?? 0.24;
  const deckY = tireR * 0.75;

  // シャーシ: ラジコンのフレームのような平たい板と左右のレール
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 2.3), frameMat);
  plate.position.y = deckY;
  group.add(plate);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 2.1), frameMat);
    rail.position.set(side * 0.44, deckY + 0.08, 0);
    group.add(rail);
  }

  // タイヤとホイール（走行中に回す）
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xd9d9d9 });
  const wheels: { mesh: THREE.Group; r: number }[] = [];
  for (const [z, k] of AXLES[build.chassis] ?? AXLES.std4) {
    const r = tireR * k;
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, treadW, 14), tireMat);
      tire.rotation.z = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.BoxGeometry(treadW + 0.02, r * 1.1, r * 0.35), hubMat);
      wheel.add(tire, hub);
      wheel.position.set(side * (0.45 + treadW / 2 + 0.03), r, z);
      group.add(wheel);
      wheels.push({ mesh: wheel, r });
    }
  }

  // モーター: 銀色の缶。フロント/ミッド/リヤで搭載位置が変わる
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), new THREE.MeshLambertMaterial({ color: 0xbfc6cf }));
  motor.rotation.x = Math.PI / 2;
  motor.position.set(0, deckY + 0.2, MOTOR_Z[build.layout] ?? 0);
  group.add(motor);

  // ガイドローラー: 前後4か所
  const rollerMat = new THREE.MeshLambertMaterial({ color: 0xf2c230, emissive: 0x000000 });
  for (const z of [1.25, -1.2]) {
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 12), rollerMat);
      r.position.set(side * 0.72, deckY, z);
      group.add(r);
    }
  }

  // ボディ: 横から見た形を押し出したシンプルなシェル（EX技ごとの形は後で差し替える）
  const shape = new THREE.Shape();
  const profile: [number, number][] = [[1.2, 0], [1.15, 0.12], [0.35, 0.28], [0.1, 0.48], [-0.55, 0.48], [-0.95, 0.34], [-1.1, 0.12], [-1.1, 0]];
  shape.moveTo(profile[0][0], profile[0][1]);
  for (const [z, y] of profile.slice(1)) shape.lineTo(z, y);
  const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.82, bevelEnabled: false });
  shellGeo.rotateY(-Math.PI / 2);
  shellGeo.translate(0.41, 0, 0);
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshLambertMaterial({ color }));
  shell.position.y = deckY + 0.04;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0x1b2a3a }));
  canopy.position.set(0, deckY + 0.5, -0.15);
  group.add(shell, canopy);

  // バンパー（前後）: FRPは白、カーボンは黒、ハードカーボンは黒＋金の縁
  const BUMPER: Record<string, number> = { frp: 0xeeeeee, carbon: 0x222222, hardCarbon: 0x333333 };
  for (const [key, z] of [['bumperF', 1.32], ['bumperR', -1.28]] as const) {
    const id = build[key];
    if (!BUMPER[id]) continue;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: BUMPER[id], emissive: id === 'hardCarbon' ? 0x332200 : 0 }));
    bar.position.set(0, deckY + 0.06, z);
    group.add(bar);
  }
  // ウィング（前後）: 大きさは小・大で変える
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x3a3f48 });
  const WING: Record<string, number> = { small: 0.9, large: 1.3 };
  if (WING[build.wingF]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(WING[build.wingF], 0.04, 0.3), wingMat);
    w.position.set(0, deckY + 0.12, 1.12);
    group.add(w);
  }
  if (WING[build.wingR]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(WING[build.wingR], 0.05, 0.36), wingMat);
    w.position.set(0, deckY + 0.78, -0.95);
    for (const side of [-1, 1]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.12), wingMat);
      stay.position.set(side * 0.3, deckY + 0.6, -0.95);
      group.add(stay);
    }
    group.add(w);
  }
  // マスダンパー: 重いほど大きい金色の円柱。EX提灯はぶら下がる形
  const DAMPER: Record<string, number> = { light: 0.08, medium: 0.1, heavy: 0.12, superHeavy: 0.14, chochin: 0.12 };
  const damperMat = new THREE.MeshLambertMaterial({ color: 0xd9a826 });
  for (const [key, z] of [['damperF', 1.0], ['damperR', -1.05]] as const) {
    const r = DAMPER[build[key]];
    if (!r) continue;
    for (const side of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 10), damperMat);
      d.position.set(side * 0.38, deckY + (build[key] === 'chochin' ? 0.62 : 0.12), z);
      group.add(d);
    }
  }

  return {
    group,
    rollerMat,
    // ガレージで中身を見せるときはボディを外す
    setShell(visible: boolean) {
      shell.visible = visible;
      canopy.visible = visible;
    },
    // 速度に合わせてタイヤを回す
    spin(speed: number, dt: number) {
      for (const w of wheels) w.mesh.rotation.x += (speed / w.r) * dt;
    },
  };
}
