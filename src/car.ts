import * as THREE from 'three';
import type { Track } from './track';

export interface Tuning {
  car: { maxSpeed: number; accel: number; halfWidth: number; diameter: number; stability: number };
  lanes: { count: number; changeSpeed: number; cornerChangeFactor: number };
  corner: {
    threshold: number;
    grip: number;
    slideFactor: number;
    rollerDrag: number;
    courseOutImpact: number;
    impactDrag: number;
    respawnTime: number;
    downforce: number; // 速度の2乗に比例してグリップが増える（ウィング）
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
  air: { gravity: number; rampAngle: number; slopeGravity: number };
  tire: { wearRate: number; minGrip: number };
  landing: {
    vyFactor: number;
    speedFactor: number;
    outMargin: number;
    outRange: number;
    maxOutChance: number;
    speedLoss: number;
    wobble: number;
  };
}

export type Landing = 'clean' | 'wobble' | 'out';

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
  tireLife = 1; // 1=新品。コーナーで無理をするほど減り、グリップが落ちる
  wearLoad = 0; // 調整用: 遠心力の超過分の積算
  airborne = false;
  airY = 0; // 空中にいるときの高さ（絶対値）
  private vy = 0;
  lastLanding: Landing | null = null;
  lastLandingTime = 0;
  time = 0; // この車の経過時間（演出用）
  gauge: number;
  boostTimer = 0;
  lastRejected = 0; // ゲージ不足で操作が通らなかった時刻（画面の点滅用）

  constructor(
    readonly track: Track,
    readonly t: Tuning,
    lane = 0,
    readonly rand: () => number = Math.random,
  ) {
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

    this.time += dt;
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.airborne) {
      this.updateAir(dt);
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
    const top = car.maxSpeed * (this.isBoosting ? boost.speedMul : 1);
    const accel = car.accel * (this.isBoosting ? boost.accelMul : 1);
    if (this.speed < top) this.speed = Math.min(top, this.speed + accel * dt);
    else this.speed = Math.max(top, this.speed - car.accel * dt);
    // 上り坂で減速、下り坂で加速
    this.speed = Math.max(0, this.speed - this.t.air.slopeGravity * this.track.frameAt(this.distance).slope * dt);

    // 遠心力がグリップを超えた分だけ外側へ流される
    const grip = (corner.grip + corner.downforce * this.speed * this.speed) * (this.t.tire.minGrip + (1 - this.t.tire.minGrip) * this.tireLife);
    const pull = this.speed * this.speed * kLane - grip;
    const steerMax = lanes.changeSpeed * (this.inCorner ? lanes.cornerChangeFactor : 1);
    const steerVel = THREE.MathUtils.clamp((this.laneLat(this.targetLane) - this.lat) * 4, -steerMax, steerMax);
    if (pull > 0) {
      this.wearLoad += pull * dt;
      this.tireLife = Math.max(0, this.tireLife - this.t.tire.wearRate * pull * dt);
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
    const before = this.distance;
    this.advance((this.speed * dt) / denom);
    this.checkJump(before);
  }

  private advance(ds: number) {
    this.distance += ds;
    if (this.distance >= this.track.length) {
      this.distance -= this.track.length;
      this.lap++;
    }
  }

  // ジャンプ台を通過したら空中へ。速いほど高く遠くへ飛ぶ
  private checkJump(before: number) {
    for (const j of this.track.jumps) {
      const crossed = before < j.at ? this.distance >= j.at || this.distance < before : false;
      if (!crossed) continue;
      this.airborne = true;
      this.airY = this.track.frameAt(this.distance).position.y + 0.8;
      this.vy = this.speed * Math.tan(((j.angle ?? this.t.air.rampAngle) * Math.PI) / 180);
      this.onRoller = false;
      return;
    }
  }

  // 空中ではハンドルもローラーも効かない
  private updateAir(dt: number) {
    this.vy -= this.t.air.gravity * dt;
    this.airY += this.vy * dt;
    this.advance(this.speed * dt);
    const ground = this.track.frameAt(this.distance).position.y;
    if (this.vy < 0 && this.airY <= ground) {
      this.airborne = false;
      this.land(-this.vy);
    }
  }

  // 着地の衝撃（落下の速さ・車速・タイヤ径）が着地安定性を超えると乱れる。
  // 超えた量が大きいほど、コースアウトする確率が上がる
  landingLoad(fallSpeed: number) {
    const l = this.t.landing;
    return fallSpeed * l.vyFactor + this.speed * l.speedFactor * this.t.car.diameter;
  }

  private land(fallSpeed: number) {
    const l = this.t.landing;
    const excess = this.landingLoad(fallSpeed) - this.t.car.stability;
    this.lastLandingTime = this.time;
    if (excess <= 0) {
      this.lastLanding = 'clean';
      this.speed *= 0.97;
      return;
    }
    const outChance = Math.min(l.maxOutChance, Math.max(0, (excess - l.outMargin) / l.outRange));
    if (this.rand() < outChance) {
      this.lastLanding = 'out';
      this.courseOut();
      return;
    }
    // バランスを崩して減速し、横に振られる（壁に当たればローラーの出番）
    this.lastLanding = 'wobble';
    this.speed *= 1 - Math.min(0.35, excess * l.speedLoss);
    this.vLat = (this.rand() * 2 - 1) * excess * l.wobble;
  }

  private courseOut() {
    this.courseOutTimer = this.t.corner.respawnTime;
    this.courseOuts++;
    this.boostTimer = 0;
    this.airborne = false;
    this.speed = 0;
    this.vLat = 0;
  }
}
