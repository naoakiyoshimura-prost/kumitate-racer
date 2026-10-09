import * as THREE from 'three';

export interface CameraTuning {
  distance: number;
  height: number;
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

  constructor(readonly camera: THREE.PerspectiveCamera, public tuning: CameraTuning) {}

  update(target: CameraTarget, dt: number) {
    const t = this.tuning;
    const desired = target.position.clone()
      .addScaledVector(target.forward, -t.distance)
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
  }
}
