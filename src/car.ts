import * as THREE from 'three';
import type { Track } from './track';

export interface Tuning {
  car: { maxSpeed: number; accel: number; halfWidth: number };
  lanes: { count: number; changeSpeed: number; cornerChangeFactor: number };
  corner: {
    threshold: number;
    grip: number;
    slideFactor: number;
    rollerDrag: number;
    courseOutImpact: number;
    impactDrag: number;
    respawnTime: number;
  };
  boost: {
    gaugeMax: number;
    regen: number;
    boostCost: number;
    laneChangeCost: number;
    duration: number;
    speedMul: number;
    accelMul: number;
  };
}

export type CarCommand = 'left' | 'right' | 'boost';

// 1台分の走行状態。見た目を持たない純粋な計算（CPUも同じものを使う）
export class CarState {
  distance = 0; // 中心線に沿った進んだ距離 (m)
  lap = 1;
  speed = 0;
  lat = 0; // 中心線からの横位置 (m)。+が進行方向の右
  vLat = 0; // 横方向の速度 (m/s)
  targetLane: number;
  onRoller = false;
  inCorner = false;
  courseOutTimer = 0;
  courseOuts = 0;
  gauge: number;
  boostTimer = 0;
  lastRejected = 0; // ゲージ不足で操作が通らなかった時刻（画面の点滅用）

  constructor(readonly track: Track, readonly t: Tuning, lane = 0) {
    this.targetLane = lane;
    this.gauge = t.boost.gaugeMax;
    this.lat = this.laneLat(lane);
  }

  get maxLat() {
    return this.track.halfWidth - this.t.car.halfWidth;
  }

  // レーン番号 (0=左端) → 横位置
  laneLat(lane: number) {
    const n = this.t.lanes.count;
    if (n <= 1) return 0;
    const usable = this.maxLat * 0.9;
    return -usable + (2 * usable * lane) / (n - 1);
  }

  get isOut() {
    return this.courseOutTimer > 0;
  }

  get isBoosting() {
    return this.boostTimer > 0;
  }

  // 操作命令を受け付けたら true。ゲージ不足なら false
  command(cmd: CarCommand, now = 0): boolean {
    if (this.isOut) return false;
    const b = this.t.boost;
    if (cmd === 'boost') {
      if (this.isBoosting || this.gauge < b.boostCost) return this.reject(now);
      this.gauge -= b.boostCost;
      this.boostTimer = b.duration;
      return true;
    }
    const n = this.t.lanes.count;
    const next = THREE.MathUtils.clamp(this.targetLane + (cmd === 'right' ? 1 : -1), 0, n - 1);
    if (next === this.targetLane) return false;
    if (this.gauge < b.laneChangeCost) return this.reject(now);
    this.gauge -= b.laneChangeCost;
    this.targetLane = next;
    return true;
  }

  private reject(now: number) {
    this.lastRejected = now;
    return false;
  }

  update(dt: number) {
    const { car, lanes, corner, boost } = this.t;
    this.gauge = Math.min(boost.gaugeMax, this.gauge + boost.regen * dt);

    if (this.isOut) {
      this.courseOutTimer -= dt;
      if (this.courseOutTimer <= 0) {
        this.courseOutTimer = 0;
        this.lat = this.laneLat(this.targetLane);
        this.vLat = 0;
        this.speed = car.maxSpeed * 0.3;
      }
      return;
    }

    const c = this.track.curvatureAt(this.distance);
    // inside: 曲がる内側が +右なら +1、左なら -1
    const inside = c.inside;
    // このレーン位置での実際の曲率（内側ほどきつい）
    const denom = Math.max(0.2, 1 - c.k * this.lat * inside);
    const kLane = c.k / denom;
    this.inCorner = c.k > corner.threshold;

    // ブースト中は最高速と加速が上がる。終わったら通常の最高速までゆっくり戻る
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    const top = car.maxSpeed * (this.isBoosting ? boost.speedMul : 1);
    const accel = car.accel * (this.isBoosting ? boost.accelMul : 1);
    if (this.speed < top) this.speed = Math.min(top, this.speed + accel * dt);
    else this.speed = Math.max(top, this.speed - car.accel * dt);

    // 遠心力がグリップを超えた分だけ外側へ流される
    const pull = this.speed * this.speed * kLane - corner.grip;
    const steerMax = lanes.changeSpeed * (this.inCorner ? lanes.cornerChangeFactor : 1);
    const steerVel = THREE.MathUtils.clamp((this.laneLat(this.targetLane) - this.lat) * 4, -steerMax, steerMax);
    if (pull > 0) {
      this.vLat += -inside * pull * corner.slideFactor * dt;
      // 流されている最中もハンドルは少しだけ効く
      this.vLat += steerVel * 0.5 * dt;
    } else {
      this.vLat += (steerVel - this.vLat) * (1 - Math.exp(-10 * dt));
    }
    this.lat += this.vLat * dt;

    // 壁に当たったらローラーで受け止める。勢いが強すぎるとコースアウト
    this.onRoller = false;
    if (Math.abs(this.lat) >= this.maxLat) {
      const side = Math.sign(this.lat);
      const impact = this.vLat * side;
      this.lat = side * this.maxLat;
      if (impact > corner.courseOutImpact) {
        this.courseOut();
        return;
      }
      if (impact > 0) {
        // ローラーが壁に当たった衝撃で減速する
        this.speed = Math.max(0, this.speed - impact * corner.impactDrag);
        this.vLat = 0;
      }
      if (pull > 0 && side === -inside) {
        this.onRoller = true;
        this.speed = Math.max(0, this.speed - pull * corner.rollerDrag * dt);
      }
    }

    // 内側を走るほど中心線換算で多く進む（距離が短い）
    this.distance += (this.speed * dt) / denom;
    if (this.distance >= this.track.length) {
      this.distance -= this.track.length;
      this.lap++;
    }
  }

  private courseOut() {
    this.courseOutTimer = this.t.corner.respawnTime;
    this.courseOuts++;
    this.boostTimer = 0;
    this.speed = 0;
    this.vLat = 0;
  }
}
