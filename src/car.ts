import * as THREE from 'three';
import type { Track } from './track';

export interface Tuning {
  car: { maxSpeed: number; accel: number; halfWidth: number; diameter: number; stability: number; ex: string; transform?: boolean };
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
    brakeCost: number;
    brakeTime: number;
    brakeDecel: number;
    brakeMinSpeed: number;
    laneChangeCost: number;
    duration: number;
    speedMul: number;
    accelMul: number;
  };
  air: { gravity: number; rampAngle: number; slopeGravity: number };
  tire: { wearRate: number; minGrip: number };
  aero: {
    transformTime: number; // 変形にかかる秒数
    minGauge: number; // 変形に必要なゲージ
    drain: number; // エアロモード中のゲージ消費（毎秒、回復は止まる）
    speedMul: number;
    downforce: number;
    stability: number;
    laneCostMul: number;
    laneSpeedMul: number;
    rollerDragMul: number; // 車幅が広がるので壁に当たると減速が大きい
  };
  ex: {
    cost: number;
    driftTime: number;
    driftSpeedMul: number;
    doubleExtra: number;
    doubleMul: number;
    startCooldown: number;
    wallStraight: number;
    tornadoRange: number;
    tornadoSpeedMul: number;
    wallMaxTime: number;
    wallLatRatio: number;
    wallLookAhead: number;
  };
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

export type CarCommand = 'left' | 'right' | 'boost' | 'transform' | 'ex' | 'brake';

// ボディごとのEX技
export type ExSkill = 'drift' | 'doubleBoost' | 'tornado' | 'wallRide';

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
  brakeTimer = 0; // ブレーキ中の残り秒数
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

  exActive: ExSkill | null = null;
  exTimer = 0;
  tornadoReady = false; // トルネードジャンプ発動済みで、ジャンプ台待ち
  tornadoAir = false; // トルネードで飛んでいる最中（着地が必ず決まる）
  wallSide = 0; // 壁走り中の壁の向き（+1=右, -1=左）
  cornerInside = 0; // 今いるコーナーの内側の向き（演出用）
  private doubleStage = 0; // ダブルブーストの追加加速が残っている秒数
  exUsedLap = 0; // EX技を使った周（1周1回まで）

  aeroTarget = false; // エアロモードへ変形中・変形済みなら true
  aero = 0; // 変形の進み具合 0=通常 1=エアロ。性能もこの割合で切り替わる

  get isAero() {
    return this.aero > 0.5;
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
    if (cmd === 'brake') {
      if (this.brakeTimer > 0 || this.gauge < b.brakeCost) return this.reject(now);
      this.gauge -= b.brakeCost;
      this.brakeTimer = b.brakeTime;
      this.boostTimer = 0;
      return true;
    }
    if (cmd === 'ex') {
      if (!this.canEx()) return this.reject(now);
      this.gauge -= this.t.ex.cost;
      this.startEx();
      return true;
    }
    if (cmd === 'transform') {
      if (!this.t.car.transform && !this.aeroTarget) return this.reject(now);
      if (!this.aeroTarget && this.gauge < this.t.aero.minGauge) return this.reject(now);
      this.aeroTarget = !this.aeroTarget;
      return true;
    }
    const n = this.t.lanes.count;
    const next = THREE.MathUtils.clamp(this.targetLane + (cmd === 'right' ? 1 : -1), 0, n - 1);
    if (next === this.targetLane) return false;
    const cost = b.laneChangeCost * (this.aeroTarget ? this.t.aero.laneCostMul : 1);
    if (this.gauge < cost) return this.reject(now);
    this.gauge -= cost;
    this.targetLane = next;
    return true;
  }

  get exSkill() {
    return this.t.car.ex as ExSkill;
  }

  // EX技が今使えるか（ゲージと、技ごとの条件）
  // この先 len メートルにコーナーがないか
  private straightAhead(len: number): boolean {
    for (let ahead = 0; ahead <= len; ahead += 2) {
      if (this.track.curvatureAt(this.distance + ahead).k > this.t.corner.threshold) return false;
    }
    return true;
  }

  // 演出用のブースト段階: 0=なし 1=ブースト 2=ダブルブーストの2段目
  get boostStage(): number {
    if (this.exActive === 'doubleBoost' && !this.isBoosting && this.doubleStage > 0) return 2;
    return this.isBoosting ? 1 : 0;
  }

  canEx(): boolean {
    if (this.isOut || this.airborne || this.exActive || this.tornadoReady || this.gauge < this.t.ex.cost) return false;
    // 1周1回まで。スタート直後はクールタイム
    if (this.exUsedLap === this.lap || this.time < this.t.ex.startCooldown) return false;
    if (this.exSkill === 'tornado') return this.track.jumpAhead(this.distance, this.t.ex.tornadoRange);
    if (this.exSkill === 'wallRide') return this.wallSideNow() !== 0;
    return true;
  }

  // 壁走りできる壁の向き。コーナー中かコーナー直前で、外側の壁寄りにいるときだけ
  private wallSideNow(): number {
    const ex = this.t.ex;
    for (let ahead = 0; ahead <= ex.wallLookAhead; ahead += 2) {
      const c = this.track.curvatureAt(this.distance + ahead);
      if (c.k > this.t.corner.threshold) {
        const outside = -c.inside;
        return this.lat * outside >= this.maxLat * ex.wallLatRatio ? outside : 0;
      }
    }
    return 0;
  }

  private startEx() {
    const ex = this.t.ex;
    this.exUsedLap = this.lap;
    switch (this.exSkill) {
      case 'drift':
        this.exActive = 'drift';
        this.exTimer = ex.driftTime;
        break;
      case 'doubleBoost':
        this.exActive = 'doubleBoost';
        this.boostTimer = this.t.boost.duration;
        this.doubleStage = ex.doubleExtra;
        this.exTimer = this.t.boost.duration + ex.doubleExtra;
        break;
      case 'tornado':
        this.tornadoReady = true;
        break;
      case 'wallRide':
        this.exActive = 'wallRide';
        this.wallSide = this.wallSideNow();
        this.exTimer = ex.wallMaxTime;
        break;
    }
  }

  private reject(now: number) {
    this.lastRejected = now;
    return false;
  }

  update(dt: number) {
    const { car, lanes, corner, boost, aero } = this.t;
    // エアロモード中はゲージを消費し続け、尽きたら自動で通常モードに戻る
    if (this.aeroTarget) {
      this.gauge -= aero.drain * dt;
      if (this.gauge <= 0) {
        this.gauge = 0;
        this.aeroTarget = false;
      }
    } else {
      this.gauge = Math.min(boost.gaugeMax, this.gauge + boost.regen * dt);
    }
    const step = dt / aero.transformTime;
    this.aero = this.aeroTarget ? Math.min(1, this.aero + step) : Math.max(0, this.aero - step);
    const a = this.aero;

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
    // ダブルブースト: 1回目のブーストが切れたら、追加加速に入る
    if (this.exActive === 'doubleBoost' && this.boostTimer <= 0 && this.doubleStage > 0) this.doubleStage -= dt;
    if (this.exActive) {
      this.exTimer -= dt;
      if (this.exTimer <= 0) this.endEx();
    }
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
    this.cornerInside = this.inCorner ? inside : 0;

    // ブースト中は最高速と加速が上がる。終わったら通常の最高速までゆっくり戻る
    const ex = this.t.ex;
    const doubleNow = this.exActive === 'doubleBoost' && !this.isBoosting && this.doubleStage > 0;
    const wall = this.exActive === 'wallRide';
    const boosted = this.isBoosting || doubleNow || wall;
    // 追加加速（ダブルブースト2段目）は1回目のブーストより強い
    const speedMul = doubleNow ? ex.doubleMul : boosted ? boost.speedMul : this.exActive === 'drift' ? ex.driftSpeedMul : 1;
    const top = car.maxSpeed * speedMul * (1 + (aero.speedMul - 1) * a);
    const accel = car.accel * (boosted ? boost.accelMul : 1);
    if (this.brakeTimer > 0) {
      // ブレーキ: 一定時間、強く減速する（加速はしない）
      this.brakeTimer = Math.max(0, this.brakeTimer - dt);
      this.speed = Math.max(boost.brakeMinSpeed, this.speed - boost.brakeDecel * dt);
    } else if (this.speed < top) this.speed = Math.min(top, this.speed + accel * dt);
    else this.speed = Math.max(top, this.speed - car.accel * dt);
    // 上り坂で減速、下り坂で加速
    this.speed = Math.max(0, this.speed - this.t.air.slopeGravity * this.track.frameAt(this.distance).slope * dt);

    // 壁走り: 壁に張り付いたまま、遠心力もローラーの減速も受けない。同じ向きのカーブが続く間は張り付き、まとまった直線に戻るかS字で向きが変わったら終わり
    if (wall) {
      this.lat = this.wallSide * this.maxLat;
      this.vLat = 0;
      this.onRoller = false;
      // S字で曲がる向きが変わったら（張り付いている壁が内側になったら）終わり
      const c = this.track.curvatureAt(this.distance + 2);
      const flipped = c.k > corner.threshold && -c.inside !== this.wallSide;
      if (flipped || (!this.inCorner && this.exTimer < ex.wallMaxTime - 0.5 && this.straightAhead(ex.wallStraight))) this.endEx();
      // 壁を走るので、外側でも直線と同じだけ進む
      const before = this.distance;
      this.advance(this.speed * dt);
      this.checkJump(before);
      return;
    }

    // 遠心力がグリップを超えた分だけ外側へ流される
    const grip = (corner.grip + (corner.downforce + aero.downforce * a) * this.speed * this.speed) * (this.t.tire.minGrip + (1 - this.t.tire.minGrip) * this.tireLife);
    // ドリフト中はアウトに膨らまない
    const pull = this.exActive === 'drift' ? Math.min(0, this.speed * this.speed * kLane - grip) : this.speed * this.speed * kLane - grip;
    const steerMax = lanes.changeSpeed * (this.inCorner ? lanes.cornerChangeFactor : 1) * (1 + (aero.laneSpeedMul - 1) * a);
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
        // ローラーが壁に当たった衝撃で減速する（よく回るローラーほど衝撃を逃がして減速が少ない）
        this.speed = Math.max(0, this.speed - impact * corner.impactDrag * Math.sqrt(corner.rollerDrag / 0.35));
        this.vLat = 0;
      }
      if (pull > 0 && side === -inside) {
        this.onRoller = true;
        this.speed = Math.max(0, this.speed - pull * corner.rollerDrag * (1 + (aero.rollerDragMul - 1) * a) * dt);
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
      if (this.tornadoReady) {
        this.tornadoReady = false;
        this.tornadoAir = true;
        this.speed *= this.t.ex.tornadoSpeedMul;
      }
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
    const excess = this.landingLoad(fallSpeed) - this.t.car.stability - this.t.aero.stability * this.aero;
    this.lastLandingTime = this.time;
    const tornado = this.tornadoAir;
    this.tornadoAir = false;
    if (excess <= 0 || tornado) {
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

  private endEx() {
    // 壁走りから降りたら、ブースト速度のまま次のコーナーに突っ込まないよう少し落とす
    if (this.exActive === 'wallRide') this.speed = Math.min(this.speed, this.t.car.maxSpeed * 1.1);
    this.exActive = null;
    this.exTimer = 0;
    this.doubleStage = 0;
    this.wallSide = 0;
  }

  private courseOut() {
    this.endEx();
    this.tornadoReady = false;
    this.tornadoAir = false;
    this.courseOutTimer = this.t.corner.respawnTime;
    this.aeroTarget = false;
    this.aero = 0;
    this.courseOuts++;
    this.boostTimer = 0;
    this.airborne = false;
    this.speed = 0;
    this.vLat = 0;
  }
}
