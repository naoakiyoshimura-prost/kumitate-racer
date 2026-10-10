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
      const amp = t.shake * (ratio - 0.6) * (1 + stage);
      this.camera.position.x += Math.sin(time * 53) * amp;
      this.camera.position.y += Math.sin(time * 71 + 1) * amp;
    }
  }
}
