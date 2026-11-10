import * as THREE from 'three';

export interface CameraTuning {
  distance: number;
  height: number;
  baseFov: number; // 止まっているときの視野角
  speedFov: number; // 速度で広がる分
  boostFov: number; // ブースト1段で広がる分
  shake: number; // 高速時の揺れ幅
  lookAhead: number;
  follow: number;
}

// 俯瞰（上から）視点の設定。進行方向が画面の上になる
export interface TopCameraTuning {
  fov: number;
  viewWidth: number; // 画面の横に映したい幅（m）。縦画面ではこの幅が入る高さまで上がる
  minHeight: number;
  maxHeight: number;
  back: number; // 車より後ろへ下げる量（先を広く見せる）
  lookAhead: number;
  follow: number;
  turn: number; // 向きの追従の速さ（小さいほどゆっくり回る＝酔いにくい）
  speedZoom: number; // 速いほど引く割合
  boostZoom: number; // ブースト1段ごとに引く割合
  shake: number;
  punch: number; // ブーストの段が上がった瞬間に寄る割合（0で無効）。展開ギミックを見せる
  punchTime: number; // 寄ってから戻るまでの秒数
}

export interface CameraTarget {
  position: THREE.Vector3;
  forward: THREE.Vector3;
}

// 車体から独立したカメラ部品。後方視点はプリセットの1つ（将来ここに視点を足す）
export class CameraRig {
  private readonly lookAt = new THREE.Vector3();
  private initialized = false;
  private fov = 0;
  private fx = { ratio: 0, stage: 0, time: 0, enabled: true };

  // スピード感の演出: 速度比（0〜1.5）とブースト段階で視野角と揺れを変える
  setSpeed(ratio: number, stage: number, time: number, enabled: boolean) {
    this.fx = { ratio, stage, time, enabled };
  }

  constructor(readonly camera: THREE.PerspectiveCamera, public tuning: CameraTuning) {}

  private topDir = new THREE.Vector3();
  private topZoom = 1;
  private punchLeft = 0;

  // ブーストの段が上がった瞬間に呼ぶ（俯瞰視点が一瞬だけ車に寄る）
  punch(time: number) {
    this.punchLeft = time;
  }

  // 俯瞰視点: 車の真上やや後ろから見下ろす。高速でも見失わないよう、速度とブーストで少し引く
  updateTop(target: CameraTarget, dt: number, t: TopCameraTuning) {
    const { ratio, stage, time, enabled } = this.fx;
    const flat = new THREE.Vector3(target.forward.x, 0, target.forward.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    if (!this.initialized) this.topDir.copy(flat);
    this.topDir.lerp(flat, 1 - Math.exp(-t.turn * dt)).normalize();
    this.punchLeft = Math.max(0, this.punchLeft - dt);
    const punch = enabled && t.punchTime > 0 ? t.punch * Math.sin(Math.PI * Math.min(1, this.punchLeft / t.punchTime)) : 0;
    const zoom = (1 + (enabled ? t.speedZoom * Math.min(ratio, 1.5) + t.boostZoom * stage : 0)) * (1 - punch);
    this.topZoom += (zoom - this.topZoom) * (1 - Math.exp(-(punch > 0 ? 9 : 3) * dt));
    const half = Math.tan((t.fov * Math.PI) / 360);
    const fit = t.viewWidth / (2 * half * Math.max(0.2, this.camera.aspect));
    const h = Math.min(t.maxHeight, Math.max(t.minHeight, fit)) * this.topZoom;
    const desired = target.position.clone().addScaledVector(this.topDir, -t.back).add(new THREE.Vector3(0, h, 0));
    const look = target.position.clone().addScaledVector(this.topDir, t.lookAhead);
    if (!this.initialized) {
      this.camera.position.copy(desired);
      this.lookAt.copy(look);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-t.follow * dt);
    this.camera.position.lerp(desired, k);
    this.lookAt.lerp(look, k);
    this.camera.up.copy(this.topDir);
    this.camera.lookAt(this.lookAt);
    if (Math.abs(this.camera.fov - t.fov) > 0.05) {
      this.camera.fov = t.fov;
      this.camera.updateProjectionMatrix();
    }
    if (enabled && stage > 0 && t.shake > 0) {
      this.camera.position.x += Math.sin(time * 47) * t.shake * stage * 0.5;
      this.camera.position.z += Math.sin(time * 61 + 1) * t.shake * stage * 0.5;
    }
  }

  update(target: CameraTarget, dt: number) {
    const t = this.tuning;
    const { ratio, stage, time, enabled } = this.fx;
    const fov = t.baseFov + (enabled ? t.speedFov * Math.min(ratio, 1.5) + t.boostFov * stage : 0);
    this.fov = this.fov ? this.fov + (fov - this.fov) * (1 - Math.exp(-4 * dt)) : fov;
    // 視野角が広がっても車の大きさが変わらないよう、そのぶんカメラを寄せる（周りだけが流れて見える）
    const rad = (d: number) => (d * Math.PI) / 360;
    const dist = t.distance * Math.tan(rad(t.baseFov)) / Math.tan(rad(this.fov));
    const desired = target.position.clone()
      .addScaledVector(target.forward, -dist)
      .add(new THREE.Vector3(0, t.height, 0));
    const look = target.position.clone().addScaledVector(target.forward, t.lookAhead);
    if (!this.initialized) {
      this.camera.position.copy(desired);
      this.lookAt.copy(look);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-t.follow * dt);
    this.camera.position.lerp(desired, k);
    this.lookAt.lerp(look, k);
    this.camera.lookAt(this.lookAt);

    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    if (enabled && ratio > 0.6) {
      // ブースト中の揺れは控えめ（以前の半分）
      const amp = t.shake * (ratio - 0.6) * (1 + stage) * (stage > 0 ? 0.5 : 1);
      this.camera.position.x += Math.sin(time * 53) * amp;
      this.camera.position.y += Math.sin(time * 71 + 1) * amp;
    }
  }
}
