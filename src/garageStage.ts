import * as THREE from 'three';
import { buildCarModel } from './carModel';
import { garageWallTexture } from './textures';
import type { Build, Category } from './setup';

// ガレージの3D表示: 真ん中に自分のマシン。選んだ部品の場所へカメラが寄り、交換すると車体が弾む
type Focus = { cam: [number, number, number]; look: [number, number, number]; shell: boolean; orbit?: boolean };
const VIEW: Record<string, Focus> = {
  all: { cam: [3.4, 1.9, 3.4], look: [0, 0.35, 0], shell: true, orbit: true },
  inside: { cam: [1.2, 2.9, 1.0], look: [0, 0.3, 0], shell: false },
  tire: { cam: [3.3, 0.8, 2.3], look: [0.5, 0.3, 0.5], shell: true },
  front: { cam: [1.6, 1.1, 3.4], look: [0, 0.3, 1.1], shell: true },
  rear: { cam: [1.6, 1.3, -3.4], look: [0, 0.4, -1.0], shell: true },
};
const FOCUS_OF: Partial<Record<Category, keyof typeof VIEW>> = {
  motor: 'inside', booster: 'rear', gear: 'inside', shaft: 'inside', layout: 'inside', chassis: 'inside', lightKit: 'inside', suspension: 'tire',
  compound: 'tire', tireSize: 'tire', tread: 'tire',
  rollerF: 'front', bumperF: 'front', wingF: 'front', damperF: 'front',
  rollerR: 'rear', bumperR: 'rear', wingR: 'rear', damperR: 'rear',
};

export class GarageStage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private car: ReturnType<typeof buildCarModel> | null = null;
  private view = VIEW.all;
  private angle = 0.8;
  private bounce = 0;
  private readonly look = new THREE.Vector3(0, 0.35, 0);
  // ターンテーブル: 車は台ごと水平にだけ回る。指で左右にドラッグすると回り、離すと少し惰性で回り続ける。
  // 触っていないときはゆっくり自動で回る。向きは部品の交換や改造で作り直しても保つ
  private drag: { x: number; y: number } | null = null;
  private spinVel = 0;
  private yaw = 0;
  private readonly turntable = new THREE.Group();

  // ガレージ表示中だけ呼ばれる
  attachDrag(el: HTMLElement, active: () => boolean) {
    el.addEventListener('pointerdown', (e) => {
      if (!active()) return;
      this.drag = { x: e.clientX, y: e.clientY };
      this.spinVel = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = (e.clientX - this.drag.x) * 0.012;
      this.yaw += dx;
      this.spinVel = dx * 60;
      this.drag = { x: e.clientX, y: e.clientY };
    });
    // ダブルタップで元の向きに戻す
    el.addEventListener('dblclick', () => {
      if (active()) {
        this.yaw = 0;
        this.spinVel = 0;
      }
    });
    const end = () => {
      this.drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  constructor() {
    this.scene.background = new THREE.Color(0x1a1e26);
    // 照明: 上からの主光を強め、環境光を弱めて陰影をはっきりさせる。後ろから青白い光を当てて輪郭を立てる
    // （材質は軽い Lambert のまま。光源は1つ増えるだけ）
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 0.85));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(4, 8, 5);
    const rim = new THREE.DirectionalLight(0x8fc4ff, 1.3);
    rim.position.set(-5, 3, -6);
    this.scene.add(key, rim);
    // 回転台と床のライン
    const table = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.7, 0.12, 48), new THREE.MeshLambertMaterial({ color: 0x3a404c }));
    table.position.y = -0.06;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: 0xff8a00 }));
    ring.rotation.x = Math.PI / 2;
    const floor = new THREE.GridHelper(30, 30, 0x2c3340, 0x2c3340);
    floor.position.y = -0.12;
    // 台の上の目印（回っているのが分かるように）
    const markMat = new THREE.MeshBasicMaterial({ color: 0x59606e });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.005, 0.06), markMat);
      mark.position.set(Math.cos(a) * 2.25, 0.003, Math.sin(a) * 2.25);
      mark.rotation.y = -a;
      this.turntable.add(mark);
    }
    // 車の下の丸い影（リアルタイムの影は重いので、ぼかした板で代用）
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    this.turntable.add(table, ring, shadow);
    this.scene.add(this.turntable, floor);
    // ピットの壁と天井のライト（ぐるっと囲むので、どの角度から見ても背景がある）
    const wallTex = garageWallTexture();
    if (wallTex) {
      wallTex.repeat.set(14, 1);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 5, 56, 1, true), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }));
      wall.position.y = 2.38;
      this.scene.add(wall);
    }
    const lamp = new THREE.MeshBasicMaterial({ color: 0xdff2ff });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.25), lamp);
      bar.position.set(Math.cos(a) * 6, 5.2, Math.sin(a) * 6);
      bar.rotation.y = -a + Math.PI / 2;
      this.scene.add(bar);
    }
    this.camera.position.set(...VIEW.all.cam);
  }

  setBuild(build: Build, changed: boolean, color = 0xd23c3c) {
    if (this.car) this.turntable.remove(this.car.group);
    this.car = buildCarModel(color, build);
    this.car.setShell(this.view.shell);
    this.turntable.add(this.car.group);
    if (changed) this.bounce = 1;
  }

  setFocus(cat: Category | null) {
    this.view = VIEW[(cat && FOCUS_OF[cat]) || 'all'];
    this.car?.setShell(this.view.shell);
  }

  // ガレージ画面のブースト表示（0=OFF, 1, 2）
  boost = 0;
  private time = 0;

  render(renderer: THREE.WebGLRenderer, dt: number) {
    this.time += dt;
    this.car?.setBoost(this.boost, false, this.time);
    const v = this.view;
    // ドラッグ中・惰性で回っている間は自動の回転を止める。部品を見ているときも止める
    const handled = this.drag !== null || Math.abs(this.spinVel) > 0.05;
    if (v.orbit && !handled) this.yaw += dt * 0.35;
    if (!this.drag) {
      this.yaw += this.spinVel * dt;
      this.spinVel *= Math.exp(-2.5 * dt);
    }
    this.turntable.rotation.y = this.yaw;
    // カメラは止めたまま、台が回る。部品表示はその場所へ寄る
    const desired = v.orbit
      ? new THREE.Vector3(Math.sin(this.angle) * 4.6, v.cam[1], Math.cos(this.angle) * 4.6)
      : new THREE.Vector3(...v.cam);
    const k = 1 - Math.exp(-5 * dt);
    this.camera.position.lerp(desired, k);
    this.look.lerp(new THREE.Vector3(...v.look), k);
    this.camera.lookAt(this.look);
    // 交換した瞬間に車体を弾ませる
    if (this.car) {
      this.bounce = Math.max(0, this.bounce - dt * 2.5);
      const b = Math.sin(this.bounce * Math.PI * 2) * this.bounce;
      this.car.group.position.y = b * 0.25;
      this.car.group.scale.setScalar(1 + b * 0.05);
      this.car.spin(this.bounce * 10, dt);
    }
    const size = renderer.getSize(new THREE.Vector2());
    if (this.camera.aspect !== size.x / size.y) {
      this.camera.aspect = size.x / size.y;
      this.camera.updateProjectionMatrix();
    }
    renderer.render(this.scene, this.camera);
  }
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 6, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
