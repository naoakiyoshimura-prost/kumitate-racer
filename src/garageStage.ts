import * as THREE from 'three';
import { buildCarModel } from './carModel';
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

  constructor() {
    this.scene.background = new THREE.Color(0x1a1e26);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 8, 5);
    this.scene.add(key);
    // 回転台と床のライン
    const table = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.7, 0.12, 48), new THREE.MeshLambertMaterial({ color: 0x3a404c }));
    table.position.y = -0.06;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: 0xff8a00 }));
    ring.rotation.x = Math.PI / 2;
    const floor = new THREE.GridHelper(30, 30, 0x2c3340, 0x2c3340);
    floor.position.y = -0.12;
    this.scene.add(table, ring, floor);
    this.camera.position.set(...VIEW.all.cam);
  }

  setBuild(build: Build, changed: boolean) {
    if (this.car) this.scene.remove(this.car.group);
    this.car = buildCarModel(0xd23c3c, build);
    this.car.setShell(this.view.shell);
    this.scene.add(this.car.group);
    if (changed) this.bounce = 1;
  }

  setFocus(cat: Category | null) {
    this.view = VIEW[(cat && FOCUS_OF[cat]) || 'all'];
    this.car?.setShell(this.view.shell);
  }

  render(renderer: THREE.WebGLRenderer, dt: number) {
    const v = this.view;
    if (v.orbit) this.angle += dt * 0.35;
    // 全体表示はぐるっと回る。部品表示はその場所へ寄る
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
