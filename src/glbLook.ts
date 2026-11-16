import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Build } from './setup';
import { axlesOf } from './carModel';

// 外部で作った車体の3Dデータ（GLB）を「見た目だけ」載せる試験（2026-11-15 店長「これでどう？」TRIPO で作った車体）。
// 性能は build（内部の設定データ）のまま。GLB には性能を持たせない。変形・ブースターは対象外。
// GLB ファイルはリポジトリに入れない（素材台帳で商用利用の確認が取れるまで）。試作ページの横に置いた tripo-test.glb を読みに行き、
// 無ければ今までの形のまま走る。
// 読み込む GLB の約束（scratchpad の opt.mjs で軽量化したもの）: 前が +Z、上が +Y、
// タイヤは wheel_FR/FL/RR/RL、ローラーは roller_FR/FL/RR/RL という名前のノード。それ以外は動かない部品としてまとめてある
export const GLB_LOOK = 'tripo';
// 試作ページは .glb を置けないので、base64 にした文字ファイルで置く（中身は同じ GLB）
const GLB_URL = 'tripo-test.b64.txt';

let loading: Promise<THREE.Group | null> | null = null;
function loadGlb() {
  if (!loading)
    loading = fetch(GLB_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((b64) => {
        const bin = atob(b64.trim());
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return new GLTFLoader().parseAsync(buf.buffer, '');
      })
      .then((g) => g.scene)
      .catch((e) => {
        console.warn('[glbLook] 読み込めなかったので今までの形で走ります', e);
        return null;
      });
  return loading;
}

type Spinner = { mesh: THREE.Object3D; r: number };
type Model = { group: THREE.Group; wheels: Spinner[] };

// model の見た目を GLB に差し替える（非同期。読み込めるまでは今までの形）
export function applyGlbLook(model: Model, build: Build) {
  return loadGlb().then((src) => {
    if (!src) return;
    const car = src.clone(true);
    // 元の形は消さずに、見えない入れ物へ移す（ブーストの炎などが後から表示に切り替わっても出てこないように）
    const orig = new THREE.Group();
    orig.visible = false;
    for (const c of [...model.group.children]) orig.add(c);
    model.group.add(orig);

    // タイヤ4本の中心から、GLB の前後の車軸位置とタイヤ半径を読む
    const box = new THREE.Box3();
    const center = (o: THREE.Object3D) => box.setFromObject(o).getCenter(new THREE.Vector3());
    const wheels = ['wheel_FR', 'wheel_FL', 'wheel_RR', 'wheel_RL'].map((n) => car.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    const rollers = ['roller_FR', 'roller_FL', 'roller_RR', 'roller_RL'].map((n) => car.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    if (wheels.length < 4) console.warn('[glbLook] タイヤの名前が4本そろっていません', wheels.length);
    const wz = wheels.map((w) => center(w).z);
    const glbFront = Math.max(...wz), glbRear = Math.min(...wz);
    // ゲーム側の一番前と一番後ろの車軸に合わせて縮尺を決める（6輪・8輪でも前後端の車軸に合わせる）
    const az = axlesOf(build).map(([z]) => z);
    const gFront = Math.max(...az), gRear = Math.min(...az);
    const s = (gFront - gRear) / Math.max(1e-3, glbFront - glbRear);
    const bottom = new THREE.Box3().setFromObject(car).min.y;
    // 回る部品は中心に回転軸の入れ物を作って入れ直す（GLB の部品は原点まわりに置かれているため）。
    // 縮尺をかける前に測るので、寸法は GLB のまま（半径にだけ s を掛ける）
    car.updateMatrixWorld(true);
    const pivotOf = (o: THREE.Object3D) => {
      const parent = o.parent!;
      const c = parent.worldToLocal(center(o));
      const p = new THREE.Group();
      p.position.copy(c);
      parent.add(p);
      o.position.sub(c);
      p.add(o);
      return p;
    };
    const spin: Spinner[] = [];
    for (const w of wheels) {
      const size = box.setFromObject(w).getSize(new THREE.Vector3());
      spin.push({ mesh: pivotOf(w), r: (Math.max(size.y, size.z) / 2) * s });
    }
    for (const rl of rollers) {
      const size = box.setFromObject(rl).getSize(new THREE.Vector3());
      // ローラーは縦軸で回る: 横に90度倒した入れ物の中で x 回転させると縦軸まわりになる。部品自体は逆に倒して見た目の向きを保つ
      const p = pivotOf(rl);
      const tilt = new THREE.Group();
      tilt.position.copy(p.position);
      tilt.rotation.z = Math.PI / 2;
      p.parent!.add(tilt);
      p.position.set(0, 0, 0);
      tilt.add(p);
      rl.rotation.z = -Math.PI / 2;
      rl.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
      spin.push({ mesh: p, r: (Math.max(size.x, size.z) / 2) * s * 3 }); // 仮: 壁に当たっていなくても速度の1/3で回す
    }
    car.scale.setScalar(s);
    car.position.set(0, -bottom * s, (gFront + gRear) / 2 - ((glbFront + glbRear) / 2) * s);
    model.group.add(car);
    // 元のタイヤ（見えない）は回す対象から外して、GLB のタイヤとローラーに入れ替える
    model.wheels.length = 0;
    model.wheels.push(...spin);
  });
}
