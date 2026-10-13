import * as THREE from 'three';
import { Track } from './track';

export interface Tuning {
  car: { maxSpeed: number; accel: number; halfWidth: number; diameter: number; stability: number; reaccel: number; reaccelBelow: number; ex: string; transform?: boolean };
  // freeDriftDrag: レーンなしコースで、ドリフト★(0〜5)ごとのローラー減速の倍率。freeRepeat: 矢印を押し続けたときの横移動の間隔(秒)
  lanes: { count: number; changeSpeed: number; cornerChangeFactor: number; freeDriftDrag?: number[]; freeRepeat?: number };
  corner: {
    threshold: number;
    grip: number;
    slideFactor: number;
    wideK: number;
    tightK: number;
    gripTight: number;
    gripWide: number;
    slideTight: number;
    rollerDrag: number;
    courseOutImpact: number;
    impactDrag: number;
    respawnTime: number;
    downforce: number; // 速度の2乗に比例してグリップが増える（ウィング）
    // グリップを超えたときの崩れ方（駆動方式で決まる）
    under?: number; // アンダー: 外へ流される量を、超えた分に応じて増やす割合
    underTight?: number; // アンダーが出る場所 1=低速コーナーだけ 0=高速コーナーだけ 0.5=どこでも
    spin?: number; // スピンのしやすさ（グリップを大きく超えるとたまる）
    spinDrift?: number; // EXドリフト中にスピンがたまる速さ（毎秒）
    spinBoost?: number; // ブースト中、コーナーでスピンがたまる速さ（毎秒）
    boostGrip?: number; // ブースト中のグリップの倍率（ブースト安定。1より小さいとふらつく）
    driftMul?: number; // EXドリフトの効き（速さの上乗せの倍率）
    driftStar?: number; // ドリフトの★。3以上ならドリフトモーション（見た目だけ）ができ、★が多いほど角度がきつい
  };
  // スピン: たまり具合が1を超えると、くるっと回って大きく減速する（コースアウトにはしない）
  spin?: { threshold: number; gain: number; recover: number; speedKeep: number; time: number; warn: number };
  boost: {
    gaugeMax: number;
    startGauge?: number; // スタート時のゲージ（走り出してからたまる）
    regen: number;
    boostCost: number;
    brakeCost: number;
    brakeTime: number;
    brakeDecel: number;
    brakeMinSpeed: number;
    laneChangeCost: number;
    duration: number;
    speedMul: number; // ブースターの最高速の伸び（1.35=標準マシンで35%ぶん）。実際に足すのは speedAdd
    accelMul: number;
    speedAdd?: number; // ブースト中に足す最高速。どのマシンも同じ量（setup.ts で決める）
    doubleAdd?: number; // ダブルブースト2段目でさらに足す最高速
  };
  air: { gravity: number; rampAngle: number; slopeGravity: number; slowMul?: number; waveLoad?: number }; // slowMul: 低速区間での最高速の倍率、waveLoad: ウェーブの着地の衝撃の倍率
  tire: { wearRate: number; minGrip: number };
  aero: {
    transformTime: number; // 変形にかかる秒数
    cost: number; // エアロモードへ変形するときに使うゲージ
    cooldown: number; // エアロモードへ変形してから、次に変形できるまでの秒数
    speedMul: number;
    downforce: number;
    stability: number;
    laneCostMul: number;
    laneSpeedMul: number;
    rollerDragMul: number; // 車幅が広がるので壁に当たると減速が大きい
  };
  ex: {
    cost: number;
    chargeTime?: number; // ハイパーチャージ: ゲージが超回復する秒数
    chargeMul?: number; // ハイパーチャージ中のゲージ回復の倍率
    capTime?: number; // スーパーキャパシタ: 効いている秒数
    capAdd?: number; // スーパーキャパシタ中にゲージ上限へ足す量（固定値。発動でここまで満タン）
    capRegen?: number; // スーパーキャパシタ中のゲージ回復の倍率
    hangTime?: number; // ハングオン走法の秒数
    hangGrip?: number; // ハングオン中のグリップの倍率（片輪で踏ん張る）
    airCooldown?: number; // エアードリフトターン: 次に使えるまでの秒数（1周1回の制限なし）
    revShots?: number; // リボルバーブースト: 弾の数（発動で1発目、残りはブーストボタンで1発ずつ）
    revShotTime?: number; // リボルバーブースト: 1発の秒数（強さはふつうのブーストと同じ）
    revLimit?: number; // リボルバーブースト: 発動から撃ち切るまでの期限（秒）
    qtTime?: number; // クイックターン: 効いている秒数
    qtGrip?: number; // クイックターン中のグリップの倍率
    qtKick?: number; // クイックターン: 連続コーナーの切り返しで足す速さの割合
    qtKicks?: number; // クイックターン: 1回の発動で切り返し加速できる回数
    qtGap?: number; // クイックターン: 前のコーナーからこの距離 (m) 以内に逆向きのコーナーが来たら切り返し（短い直線をはさむS字も含む）
    airGap?: number; // エアードリフト: コースの内側の端から、さらに内側へ出る幅 (m)。空中の「0番レーン」
    airLatSpeed?: number; // 空中レーンへ横に動く速さ (m/s)。遅いとコースを横切っている間にコーナーが終わる
    airHeight?: number; // 空中レーンの高さ (m)
    airRise?: number; // 空中レーンへ上がる速さ (m/秒)。壁の外へ出る前に柵より高くなるように
    airMaxTime?: number; // 空中にいられる最長の秒数
    driftTime: number;
    driftSpeedMul: number;
    doubleExtra: number;
    doubleMul: number; // ダブルブースト2段目: 標準マシンのブースト速度の何割を足すか（1.15 = さらに+15%ぶん）
    doubleAccel?: number; // ダブルブースト2段目: 加速をふつうのブーストよりさらに何倍にするか
    startCooldown: number;
    tornadoRange: number;
    tornadoSpeedMul: number;
    tornadoDistance: number;
    tornadoMinAir: number;
    tornadoMaxAir: number;
    tornadoHeight: number;
    tornadoBrakeAhead: number;
    tornadoBrakeDecel: number;
    tornadoDropGravity: number;
    cutMinAir: number;
    cutMaxAir: number;
    cutMaxReach: number;
    cutSpeedMul: number;
    tornadoReach: number;
    cutHeight: number;
    guardTime: number;
    doubleWindow: number;
    driftKick: number;
    driftPush: number;
    wallJumpTime: number;
    wallJumpSpeed: number;
    regenMul: number;
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
export type ExSkill = 'none' | 'drift' | 'doubleBoost' | 'tornado' | 'tornadoCut' | 'wallRide' | 'guard' | 'hyperCharge' | 'hangOn' | 'airDrift' | 'capacitor' | 'revolver' | 'quickTurn';

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
  private airGravity = 0;
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
    this.gauge = t.boost.startGauge ?? t.boost.gaugeMax;
    this.chan = Math.min(lane, Math.max(0, this.walled - 1));
    this.lat = this.laneLat(lane);
    this.prevCenter = this.wallCenter;
  }

  // 壁で仕切られたレーンのコース: 自分のレーン番号（立体交差を通るたびに1つずれる）
  chan = 0;
  private prevCenter = 0;
  private crossing = false;
  get walled() {
    return this.track.data.walledLanes ?? 0;
  }

  // 今いる区間の壁の中心と、中心から壁までの余裕 (m)
  get wallCenter() {
    if (!this.walled) return 0;
    const c0 = this.track.chanCenter(this.chan);
    const p = this.track.crossProgress(this.distance);
    if (p < 0) return c0;
    const last = this.chan === this.walled - 1;
    // 最後のレーンは橋で一番左へ、ほかは右隣へ
    const c1 = this.track.chanCenter(last ? 0 : this.chan + 1);
    return c0 + (c1 - c0) * Track.crossShift(p);
  }
  get wallHalf() {
    return this.walled ? this.track.halfWidth / this.walled - this.t.car.halfWidth : this.maxLat;
  }
  // 橋の上にいる高さ
  get lift() {
    if (!this.walled || this.chan !== this.walled - 1) return 0;
    const p = this.track.crossProgress(this.distance);
    return p < 0 ? 0 : this.track.crossLift(p);
  }

  get maxLat() {
    return this.track.halfWidth - this.t.car.halfWidth;
  }

  // レーン番号 (0=左端) → 横位置
  // このコースのレーン数
  get laneCount() {
    if (this.walled) return this.walled;
    return this.track.data.lanes ?? this.t.lanes.count;
  }

  laneLat(lane: number) {
    if (this.walled) return this.track.chanCenter(Math.min(lane, this.walled - 1));
    const n = this.laneCount;
    if (n <= 1) return 0;
    const usable = this.maxLat * 0.9;
    return -usable + (2 * usable * lane) / (n - 1);
  }

  get laneless() {
    return !!this.track.data.laneless;
  }

  get isOut() {
    return this.courseOutTimer > 0;
  }

  exActive: ExSkill | null = null;
  exTimer = 0;
  tornadoReady = false; // トルネードジャンプ発動済みで、ジャンプ台待ち
  tornadoAir = false; // トルネードで飛んでいる最中（着地が必ず決まる）
  shortcutReady: number | null = null; // トルネード発動済みで、飛び立つ地点（コースの距離）待ち
  // ショートカット飛行中: コースをまたいで from から to へまっすぐ飛ぶ
  flight: { from: THREE.Vector3; to: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; t: number; dur: number; toDist: number; h: number } | null = null;
  wallSide = 0; // 壁走り中の壁の向き（+1=右, -1=左）
  wallJump = 0; // S字で反対の壁へ飛び移っている残り秒数
  private wallFrom = 0;
  cornerInside = 0; // 今いるコーナーの内側の向き（演出用）
  // ドリフトモーション（見た目だけ、性能は変わらない）: コーナー進入でイン側の矢印をタップすると車体を流す。
  // 0.3秒以内にもう一度タップすると、モーションのままイン側へレーンをスライド。プレイヤーの車だけ
  allowDriftMotion = false;
  // レーンなしコースのコーナーで外へ流されている最中（ドリフト姿勢で見せる。ドリフト★が高いほど減速が少ない）
  freeSlide = false;
  driftMotion = 0; // 流している向き（コーナーの内側）。0 ならしていない
  private driftMotionTap = -1;
  private driftMotionIn = false;
  private driftMotionTime = 0;
  private doubleStage = 0; // ダブルブーストの追加加速が残っている秒数
  private doubleUsed = false; // 2段目を使ったか
  exUsedLap = 0; // EX技を使った周（1周1回まで）
  cutUsed = false; // トルネードカットは1レース1回
  airDriftAt = 0; // エアードリフトターンが次に使える時刻
  revShots = 0; // リボルバーブーストの残りの弾
  qtSign = 0; // クイックターン: 直前のコーナーの内側の向き
  qtLastDist = 0; // クイックターン: 直前のコーナーにいた距離
  qtKicks = 0; // クイックターン: この発動で使った切り返し加速の回数
  airSide = 0; // エアードリフトで出る側（イン側の端からなら内側、アウト側の端からなら外側）
  airTurn = 0; // エアードリフトで回るコーナーの内側の向き
  airEntered = false; // エアードリフト中にコーナーへ入ったか
  airLanding = false; // コーナーを抜けて、コースへ戻っている途中
  airTime = 0;
  waveAir = false; // ウェーブの山で跳ねている
  airLift = 0; // エアードリフトで浮いている高さ（見た目）
  spinMeter = 0; // スピンのたまり具合（1でスピン）
  spinTimer = 0; // スピン中の残り秒数
  spins = 0;

  aeroTarget = false; // エアロモードへ変形中・変形済みなら true（false はサーキットモード）
  aeroCooldown = 0; // エアロモードへ再変形できるまでの秒数
  aero = 0; // 変形の進み具合 0=通常 1=エアロ。性能もこの割合で切り替わる

  get isAero() {
    return this.aero > 0.5;
  }

  get isBoosting() {
    return this.boostTimer > 0;
  }

  // スタートダッシュ: ゲージを使わずにブーストを secs 秒だけ効かせる（ロケットスタート＝最大、遅れるほど短い）
  // gauge はスタートダッシュのボーナス（ゲージに足す）
  launch(secs: number, gauge = 0) {
    if (secs > 0) this.boostTimer = secs;
    this.gauge = Math.min(this.gaugeCap, this.gauge + gauge);
  }

  // 操作命令を受け付けたら true。ゲージ不足なら false
  command(cmd: CarCommand, now = 0): boolean {
    if (this.isOut) return false;
    const b = this.t.boost;
    if (cmd === 'boost') {
      // リボルバーブースト中はブーストボタンが残りの弾を1発ずつ撃つ（ゲージは使わない）
      if (this.exActive === 'revolver') return this.fireRevolver() || this.reject(now);
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
      // ダブルブースト: 1段目が切れてから1秒以内にもう一度押すと2段目
      if (this.doubleReady) {
        this.doubleUsed = true;
        this.doubleStage = this.t.ex.doubleExtra;
        this.exTimer = this.t.ex.doubleExtra;
        return true;
      }
      if (this.exActive === 'revolver') return this.fireRevolver() || this.reject(now);
      if (!this.canEx()) return this.reject(now);
      this.gauge -= this.t.ex.cost;
      this.startEx();
      return true;
    }
    if (cmd === 'transform') {
      // サーキットモードへ戻すのはいつでも無料。エアロモードへはゲージを使い、一度なると7秒は再変形できない
      if (this.aeroTarget) {
        this.aeroTarget = false;
        return true;
      }
      if (!this.t.car.transform || this.aeroCooldown > 0 || this.gauge < this.t.aero.cost) return this.reject(now);
      this.gauge -= this.t.aero.cost;
      this.aeroTarget = true;
      this.aeroCooldown = this.t.aero.cooldown;
      return true;
    }
    const dir = cmd === 'right' ? 1 : -1;
    if (this.allowDriftMotion && !this.exActive && !this.airborne && (this.t.corner.driftStar ?? 0) >= 3) {
      const turn = this.inCorner ? this.cornerInside : this.cornerAhead();
      if (turn !== 0 && dir === turn) {
        const second = this.driftMotion === turn && now - this.driftMotionTap < 0.3;
        if (!second) {
          // 1回目のタップ: モーションだけ（レーンは変えない、ゲージも使わない）
          this.driftMotion = turn;
          this.driftMotionTap = now;
          this.driftMotionIn = this.inCorner;
          this.driftMotionTime = 0;
          return true;
        }
        // 2回目のタップ: 下のふつうのレーン変更へ（モーションは続ける）
        this.driftMotionTap = -1;
      }
    }
    const n = this.laneCount;
    // 仕切りレーンのコースではレーン変更できない
    if (this.walled) return false;
    const next = THREE.MathUtils.clamp(this.targetLane + (cmd === 'right' ? 1 : -1), 0, n - 1);
    if (next === this.targetLane) return false;
    // レーンなしコースは1回の移動が小さいので、ゲージも半分
    const cost = b.laneChangeCost * (this.aeroTarget ? this.t.aero.laneCostMul : 1) * (this.laneless ? 0.5 : 1);
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
    if (this.tornadoAir) return 2;
    return this.isBoosting ? 1 : 0;
  }

  // 飛び移りの進み具合 0→1（なめらかに）
  get wallJumpProgress(): number {
    const p = 1 - this.wallJump / this.t.ex.wallJumpTime;
    return p * p * (3 - 2 * p);
  }

  // 壁走りの車体の傾き（ラジアン）。飛び移り中は反対側へ回り込む
  get wallAngle(): number {
    if (this.wallJump > 0) return -(this.wallFrom + (this.wallSide - this.wallFrom) * this.wallJumpProgress) * Math.PI / 2;
    return -this.wallSide * Math.PI / 2;
  }

  // ダブルブーストの2段目を押せる1秒間
  get doubleReady(): boolean {
    return this.exActive === 'doubleBoost' && !this.doubleUsed && this.boostTimer <= 0;
  }

  // EXボタンに出すカウントダウン（1段目の残り → 2段目を押せる残り → 2段目の残り）
  get exCountdown(): number {
    if (this.exActive === 'doubleBoost' && this.boostTimer > 0) return this.boostTimer;
    return this.exActive ? this.exTimer : 0;
  }

  // トルネードで飛べるショートカットの入口が、あと1.5秒以内に来るか
  get shortcutWindow() {
    if (this.exSkill !== 'tornadoCut' || this.cutUsed || !this.exBasicReady()) return undefined;
    return this.track.entryAhead(this.distance, Math.max(this.speed, 5) * 1.5);
  }

  private exBasicReady(): boolean {
    if (this.exSkill === 'none' || this.isOut || this.airborne || this.exActive || this.tornadoReady || this.shortcutReady || this.gauge < this.t.ex.cost) return false;
    // 1周1回まで（エアードリフトターンはクールタイムだけ）。スタート直後はクールタイム
    if (this.exSkill === 'airDrift') return this.time >= Math.max(this.airDriftAt, this.t.ex.startCooldown);
    return this.exUsedLap !== this.lap && this.time >= this.t.ex.startCooldown;
  }

  // d から先 len m の曲がり具合の平均（内側の向き付き）。コースの曲率は細かく揺れるので、ならして見る
  turnAt(d: number, len = 12): number {
    let sum = 0;
    let n = 0;
    for (let x = 0; x <= len; x += 2, n++) {
      const c = this.track.curvatureAt(d + x);
      sum += c.k * c.inside;
    }
    return sum / n;
  }

  // ブーストで足す最高速（全車同じ量）。古い数値だけの tuning では、標準どおり最高速×(倍率−1)
  boostSpeedAdd(): number {
    return this.t.boost.speedAdd ?? this.t.car.maxSpeed * (this.t.boost.speedMul - 1);
  }

  // この先（約1.5秒以内）に始まる、ある程度長いコーナーの内側の向き。なければ 0
  // （コーナーの終わりぎわや短い切り返しでは使えない）
  cornerAhead(): number {
    const range = Math.max(this.speed * 1.5, 10);
    const th = this.t.corner.threshold;
    for (let ahead = 0; ahead <= range; ahead += 2) {
      const t = this.turnAt(this.distance + ahead);
      if (Math.abs(t) > th) return Math.sign(t);
    }
    return 0;
  }

  canEx(): boolean {
    if (!this.exBasicReady()) return false;
    if (this.exSkill === 'tornadoCut') return this.shortcutWindow !== undefined;
    if (this.exSkill === 'airDrift') {
      // 端のレーンにいるときだけ。イン側の端なら内側の空中、アウト側の端なら外側の空中へ飛び出す
      return this.cornerAhead() !== 0 && this.edgeSide() !== 0;
    }
    if (this.exSkill === 'tornado') return this.track.jumpAt(this.distance, this.t.ex.tornadoRange) !== undefined;
    if (this.exSkill === 'wallRide') return this.wallSideNow() !== 0;
    // クイックターンはコーナー中か、コーナーの手前だけ
    if (this.exSkill === 'quickTurn') return this.inCorner || this.cornerAhead() !== 0;
    return true;
  }

  // 壁走りできる壁の向き。コーナー中かコーナー直前で、外側の壁寄りにいるときだけ
  private wallSideNow(): number {
    const ex = this.t.ex;
    for (let ahead = 0; ahead <= ex.wallLookAhead; ahead += 2) {
      const c = this.track.curvatureAt(this.distance + ahead);
      if (c.k > this.t.corner.threshold) {
        const outside = -c.inside;
        return (this.lat - this.wallCenter) * outside >= this.wallHalf * ex.wallLatRatio ? outside : 0;
      }
    }
    return 0;
  }

  private startEx() {
    const ex = this.t.ex;
    // ゲージを払った後なので、入口の近さだけを見る
    const sc = this.exSkill === 'tornadoCut' ? this.track.entryAhead(this.distance, Math.max(this.speed * 1.5, ex.tornadoRange)) ?? null : null;
    this.exUsedLap = this.lap;
    switch (this.exSkill) {
      case 'drift':
        this.exActive = 'drift';
        this.exTimer = ex.driftTime;
        break;
      case 'doubleBoost':
        this.exActive = 'doubleBoost';
        this.boostTimer = this.t.boost.duration;
        this.doubleStage = 0;
        this.doubleUsed = false;
        this.exTimer = this.t.boost.duration + ex.doubleWindow;
        break;
      case 'tornado':
        // 次のジャンプ台から、コースをまたいで飛ぶ（1周1回、飛距離はツバサより短い）
        this.shortcutReady = this.track.jumpAt(this.distance, ex.tornadoRange) ?? null;
        break;
      case 'tornadoCut':
        // 飛び立つ地点（ジャンプ台・コーナー入口・立体交差入口）で発進する。1レース1回
        this.cutUsed = true;
        if (sc !== null) this.shortcutReady = sc;
        break;
      case 'hyperCharge':
        // ハイパーチャージ（星那）: しばらくブーストゲージが超回復する。その間はブーストを連発できる
        this.exActive = 'hyperCharge';
        this.exTimer = ex.chargeTime ?? 6;
        break;
      case 'capacitor':
        // スーパーキャパシタ（アズパカ）: ゲージが伸びた上限まで一気に満タン。しばらく回復も速い
        this.exActive = 'capacitor';
        this.exTimer = ex.capTime ?? 8;
        this.gauge = this.gaugeCap;
        break;
      case 'hangOn':
        // ハングオン走法（チビセナ）: 強烈なインリフトで片輪グリップ走行。コーナーで流されにくい
        this.exActive = 'hangOn';
        this.exTimer = ex.hangTime ?? 6;
        break;
      case 'airDrift':
        // エアードリフトターン（宮本直也、id hayato）: コーナー入口から内側を空中ドリフトで飛び越える。クールタイムごとに何度でも
        this.airDriftAt = this.time + (ex.airCooldown ?? 10);
        this.exActive = 'airDrift';
        // 終わりはコーナーを抜けたか、最大秒数で決める（updateAirDrift）。ボタンの残り秒表示用に、着地にかかる分の余裕を足しておく
        this.exTimer = (ex.airMaxTime ?? 5) + 1;
        this.airTurn = this.cornerAhead();
        this.airSide = this.edgeSide();
        this.airEntered = false;
        this.airLanding = false;
        this.airTime = 0;
        break;
      case 'revolver':
        // リボルバーブースト（山田健太）: 決まった量（EXの消費）で6発。1発目はすぐ撃ち、残りはブーストボタンで1発ずつ
        this.exActive = 'revolver';
        this.exTimer = ex.revLimit ?? 20;
        this.revShots = ex.revShots ?? 6;
        this.fireRevolver();
        break;
      case 'quickTurn':
        // クイックターン（アンナ・ウェーバー）: 短い間グリップが上がり、連続コーナーの切り返しで一瞬加速
        this.exActive = 'quickTurn';
        this.exTimer = ex.qtTime ?? 3;
        this.qtSign = Math.sign(this.turnAt(this.distance, 6)) || this.cornerAhead();
        this.qtLastDist = this.distance;
        this.qtKicks = 0;
        break;
      case 'guard':
        // アイアンガード: しばらく壁の衝撃でも着地でもコースアウトしない
        this.exActive = 'guard';
        this.exTimer = ex.guardTime;
        break;
      case 'wallRide':
        this.exActive = 'wallRide';
        this.wallSide = this.wallSideNow();
        this.exTimer = ex.wallMaxTime;
        break;
    }
  }

  // リボルバーブーストの弾を1発撃つ。前の弾が効いている間は撃てない
  private fireRevolver(): boolean {
    if (this.revShots <= 0 || this.isBoosting) return false;
    this.revShots--;
    this.boostTimer = this.t.ex.revShotTime ?? 0.5;
    return true;
  }

  // この先（約1.5秒以内）にS字の切り返しが来るか（クイックターンの使いどき。表示とシミュ用）
  sBendAhead(): boolean {
    const gap = this.t.ex.qtGap ?? 40;
    const range = Math.max(this.speed * 1.5, 20);
    let sign = 0;
    let last = -1e9;
    for (let ahead = 0; ahead <= range + gap; ahead += 2) {
      const t = this.turnAt(this.distance + ahead, 6);
      if (Math.abs(t) <= this.t.corner.threshold) continue;
      if (sign !== 0 && Math.sign(t) !== sign && ahead - last <= gap) return true;
      if (ahead > range && sign === 0) return false;
      sign = Math.sign(t);
      last = ahead;
    }
    return false;
  }

  // クイックターン: 曲がる向きが逆になった瞬間（S字の切り返し）に速さを足す
  private updateQuickTurn() {
    const ex = this.t.ex;
    const t = this.turnAt(this.distance, 6);
    if (Math.abs(t) <= this.t.corner.threshold) return;
    const sign = Math.sign(t);
    if (this.qtSign !== 0 && sign !== this.qtSign && this.distance - this.qtLastDist <= (ex.qtGap ?? 15) && this.qtKicks < (ex.qtKicks ?? 2)) {
      this.qtKicks++;
      this.speed *= 1 + (ex.qtKick ?? 0.06);
    }
    this.qtSign = sign;
    this.qtLastDist = this.distance;
  }

  // ゲージの上限。スーパーキャパシタ中だけ capAdd 伸びる（固定量。バッテリーの容量に比例させない）
  get gaugeCap() {
    return this.t.boost.gaugeMax + (this.exActive === 'capacitor' ? this.t.ex.capAdd ?? 50 : 0);
  }

  private reject(now: number) {
    this.lastRejected = now;
    return false;
  }

  update(dt: number) {
    const { car, lanes, corner, boost, aero } = this.t;
    this.aeroCooldown = Math.max(0, this.aeroCooldown - dt);
    // EX技の最中はゲージの回復が半分（ドリフト中にブーストを連発できないように）
    const exMul = this.exActive === 'hyperCharge' ? this.t.ex.chargeMul ?? 6 : this.exActive === 'capacitor' ? this.t.ex.capRegen ?? 1.4 : this.exActive || this.tornadoReady || this.shortcutReady ? this.t.ex.regenMul : 1;
    this.gauge = Math.min(this.gaugeCap, this.gauge + boost.regen * exMul * dt);
    const step = dt / aero.transformTime;
    this.aero = this.aeroTarget ? Math.min(1, this.aero + step) : Math.max(0, this.aero - step);
    const a = this.aero;

    if (this.isOut) {
      this.courseOutTimer -= dt;
      if (this.courseOutTimer <= 0) {
        this.courseOutTimer = 0;
        this.lat = this.walled ? this.wallCenter : this.laneLat(this.targetLane);
        this.prevCenter = this.wallCenter;
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
      // リボルバーブーストは撃ち切って最後の弾が終わったら終わり
      else if (this.exActive === 'revolver' && this.revShots <= 0 && !this.isBoosting) this.endEx();
      else if (this.exActive === 'quickTurn') this.updateQuickTurn();
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
    if (this.driftMotion) {
      // ドリフトモーションはコーナーを抜けたら（向きが変わったら）終わり。入らないまま3秒たっても終わり
      this.driftMotionTime += dt;
      if (this.inCorner) this.driftMotionIn = true;
      const out = this.driftMotionIn && Math.abs(this.turnAt(this.distance)) < corner.threshold * 0.7;
      const flipped = this.inCorner && inside !== this.driftMotion;
      if (out || flipped || this.exActive || (!this.driftMotionIn && this.driftMotionTime > 3)) this.driftMotion = 0;
    }

    // スピン中: 操作は効かず、その場で回りながら進む。減速はスピンの瞬間に済ませている
    if (this.spinTimer > 0) {
      this.spinTimer = Math.max(0, this.spinTimer - dt);
      this.vLat = 0;
      this.onRoller = false;
      const before = this.distance;
      this.advance((this.speed * dt) / denom);
      this.checkJump(before);
      return;
    }

    // ブースト中は最高速と加速が上がる。終わったら通常の最高速までゆっくり戻る
    const ex = this.t.ex;
    const doubleNow = this.exActive === 'doubleBoost' && !this.isBoosting && this.doubleStage > 0;
    const wall = this.exActive === 'wallRide';
    // エアードリフト中もブースト並みの速さで飛ぶ（内側はショートカット、外側は遠回りをこの速さで取り返す）
    const boosted = this.isBoosting || doubleNow || wall || this.exActive === 'airDrift';
    // ブーストは最高速に決まった量（全車同じkm/h）を足し、加速を上げる。
    // ダブルブースト: 1段目はふつうのブーストと同じ。2段目はさらに最高速を足し、加速ももう一段上げる
    const add = this.boostSpeedAdd() + (doubleNow ? boost.doubleAdd ?? 0 : 0);
    const mul = boosted ? 1 : this.exActive === 'drift' ? 1 + (ex.driftSpeedMul - 1) * (this.t.corner.driftMul ?? 1) : 1;
    const slow = this.track.slowAt(this.distance) ? this.t.air.slowMul ?? 0.65 : 1;
    const top = (car.maxSpeed * mul + (boosted ? add : 0)) * (1 + (aero.speedMul - 1) * a) * slow;
    // 減速した後の立ち上がり（最高速の90%未満）は、駆動方式ごとの再加速力が乗る（4WDが得意）
    const accel = car.accel * (boosted ? boost.accelMul * (doubleNow ? ex.doubleAccel ?? 1 : 1) : 1) * (this.speed < top * car.reaccelBelow ? car.reaccel : 1);
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
      this.vLat = 0;
      this.onRoller = false;
      if (this.wallJump > 0) {
        // 反対の壁へローリングしながら飛び移る途中
        this.wallJump = Math.max(0, this.wallJump - dt);
        this.lat = this.wallCenter + this.wallHalf * (this.wallFrom + (this.wallSide - this.wallFrom) * this.wallJumpProgress);
      } else {
        this.lat = this.wallCenter + this.wallSide * this.wallHalf;
        // S字で曲がる向きが変わったら（張り付いている壁が内側になったら）反対の壁へ飛び移る
        const c = this.track.curvatureAt(this.distance + 2);
        const flipped = c.k > corner.threshold && -c.inside !== this.wallSide;
        if (flipped) {
          this.wallFrom = this.wallSide;
          this.wallSide = -this.wallSide;
          this.wallJump = ex.wallJumpTime;
          // 飛び移りは勢いを少し削る
          this.speed *= ex.wallJumpSpeed;
        }
      }
      // 壁を走るので、外側でも直線と同じだけ進む
      const before = this.distance;
      this.advance(this.speed * dt);
      this.checkJump(before);
      return;
    }

    if (this.exActive === 'airDrift') {
      this.updateAirDrift(dt, c.k, inside);
      return;
    }
    this.airLift = Math.max(0, this.airLift - dt * 2);

    // 遠心力がグリップを超えた分だけ外側へ流される
    // 低速コーナー（きつい）ほど gripTight、高速コーナー（ゆるい）ほど gripWide が効く
    const tight = THREE.MathUtils.clamp((kLane - corner.wideK) / (corner.tightK - corner.wideK), 0, 1);
    const gripMul = corner.gripWide + (corner.gripTight - corner.gripWide) * tight;
    const slideMul = 1 + (corner.slideTight - 1) * tight;
    const hang = (this.exActive === 'hangOn' ? this.t.ex.hangGrip ?? 1.4 : this.exActive === 'quickTurn' ? this.t.ex.qtGrip ?? 1.3 : 1) * (this.isBoosting ? corner.boostGrip ?? 1 : 1);
    const grip = hang * (corner.grip * gripMul + (corner.downforce + aero.downforce * a) * this.speed * this.speed) * (this.t.tire.minGrip + (1 - this.t.tire.minGrip) * this.tireLife);
    // ドリフト中はアウトに膨らまない
    const pull = this.exActive === 'drift' ? Math.min(0, this.speed * this.speed * kLane - grip) : this.speed * this.speed * kLane - grip;
    // グリップを超えた割合。アンダー（外へ膨らむ）とスピン（後ろが出て回る）のもと
    const excess = pull > 0 ? pull / Math.max(grip, 1e-3) : 0;
    this.freeSlide = this.laneless && this.inCorner && pull > 0 && !this.exActive;
    if (this.updateSpin(dt, excess)) return;
    const underAt = corner.underTight ?? 0.5;
    const underW = Math.min(1, underAt * tight * 2 + (1 - underAt) * (1 - tight) * 2);
    const underMul = 1 + (corner.under ?? 0) * underW * Math.min(1, excess * 2);
    const steerMax = lanes.changeSpeed * (this.inCorner ? lanes.cornerChangeFactor : 1) * (1 + (aero.laneSpeedMul - 1) * a);
    const aim = this.walled ? this.wallCenter : this.laneLat(this.targetLane);
    const steerVel = THREE.MathUtils.clamp((aim - this.lat) * 4, -steerMax, steerMax);
    // EXドリフトは遠心力で流されず（pull が0以下）、コーナーでも減速せずにストレート並みの速さでレーンどおりに抜ける
    if (pull > 0) {
      this.wearLoad += pull * dt;
      this.tireLife = Math.max(0, this.tireLife - this.t.tire.wearRate * pull * dt);
      // アンダーは外へ膨らむ勢いを少し強め（強すぎるとコースアウトだらけになる）、主に壁に押し付けられたときの減速で効かせる
      this.vLat += -inside * pull * corner.slideFactor * slideMul * (1 + (underMul - 1) * 0.3) * dt;
      // 流されている最中もハンドルは少しだけ効く
      this.vLat += steerVel * 0.5 * dt;
      // レーンなし: 流された先がそのまま自分のライン（元の位置へ吸い戻さない）
      if (this.laneless) this.targetLane = this.nearestLane(this.lat + this.vLat * dt);
    } else {
      this.vLat += (steerVel - this.vLat) * (1 - Math.exp(-10 * dt));
    }
    this.lat += this.vLat * dt;

    // 壁に当たったらローラーで受け止める。勢いが強すぎるとコースアウト
    this.onRoller = false;
    const wc = this.wallCenter;
    const half = this.wallHalf;
    if (Math.abs(this.lat - wc) >= half) {
      const side = Math.sign(this.lat - wc);
      const impact = this.vLat * side;
      this.lat = wc + side * half;
      // ドリフト中に壁に触れたらドリフト終了
      if (this.exActive === 'drift') this.endEx();
      if (impact > corner.courseOutImpact && this.exActive !== 'guard') {
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
        // レーンなしコースでは、ドリフト★が高いほど壁沿いに流れても速さを保てる
        const free = this.laneless ? lanes.freeDriftDrag?.[corner.driftStar ?? 3] ?? 1 : 1;
        this.speed = Math.max(0, this.speed - pull * corner.rollerDrag * underMul * free * (1 + (aero.rollerDragMul - 1) * a) * dt);
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
    if (!this.walled) return;
    // 立体交差を抜けたらレーン番号を1つずらす（最後のレーンは一番左へ）
    const inCross = this.track.crossProgress(this.distance) >= 0;
    if (this.crossing && !inCross) {
      this.chan = (this.chan + 1) % this.walled;
      this.targetLane = this.chan;
    }
    this.crossing = inCross;
    // レーンの壁が横にずれた分だけ、車も一緒に運ぶ
    const c = this.wallCenter;
    this.lat += c - this.prevCenter;
    this.prevCenter = c;
  }

  // ジャンプ台を通過したら空中へ。速いほど高く遠くへ飛ぶ
  private checkJump(before: number) {
    const sc = this.shortcutReady;
    if (sc !== null && (before < sc ? this.distance >= sc || this.distance < before : false)) {
      this.startFlight(sc);
      return;
    }
    for (const j of this.track.jumps) {
      const crossed = before < j.at ? this.distance >= j.at || this.distance < before : false;
      if (!crossed) continue;
      this.airborne = true;
      this.waveAir = !!j.wave;
      this.airY = this.track.frameAt(this.distance).position.y + (j.wave ? 0.1 : 0.8);
      this.vy = this.speed * Math.tan(((j.angle ?? this.t.air.rampAngle) * Math.PI) / 180);
      this.airGravity = this.t.air.gravity;
      if (this.tornadoReady) {
        // トルネード: ブースト以上の速度で飛び出し、同じ速度の通常ジャンプの tornadoDistance 倍の距離を飛ぶ
        this.tornadoReady = false;
        this.tornadoAir = true;
        const ex = this.t.ex;
        // 滞空は通常ジャンプの tornadoDistance 倍。ただし速度に関係なく tornadoMinAir〜tornadoMaxAir 秒は飛ぶ
        const normalAir = (2 * this.vy) / this.t.air.gravity;
        const air = Math.min(ex.tornadoMaxAir, Math.max(ex.tornadoMinAir, normalAir * ex.tornadoDistance));
        this.speed = Math.max(this.speed, this.t.car.maxSpeed + this.boostSpeedAdd()) * ex.tornadoSpeedMul;
        // 頂点の高さ tornadoHeight で、air 秒後に元の高さへ戻る放物線
        this.vy = (4 * ex.tornadoHeight) / air;
        this.airGravity = (8 * ex.tornadoHeight) / (air * air);
      }
      this.onRoller = false;
      return;
    }
  }

  // トルネード: ブースト以上の速度で飛び出し、速度で決まる飛距離の範囲で一番先の着地点へコースをまたいで飛ぶ
  private startFlight(at: number) {
    const ex = this.t.ex;
    this.shortcutReady = null;
    const cut = this.exSkill === 'tornadoCut';
    const maxAir = cut ? ex.cutMaxAir : ex.tornadoMaxAir;
    const minAir = cut ? ex.cutMinAir : ex.tornadoMinAir;
    this.speed = Math.max(this.speed, this.t.car.maxSpeed + this.boostSpeedAdd()) * (cut ? ex.cutSpeedMul : ex.tornadoSpeedMul);
    // 最長 maxAir 秒ぶん飛べる。速いほど遠くへ届くが、最大飛距離 (m) で頭打ち
    const reach = Math.min(this.speed * maxAir, cut ? ex.cutMaxReach : ex.tornadoReach);
    let land = this.track.landingFrom(at, reach);
    // 仕切りレーンのコース: 立体交差を飛び越えたらレーンも入れ替わる。着地は自分のレーンの真ん中
    let landLat = this.lat;
    if (this.walled) {
      const c = this.track.data.crossover;
      // 立体交差の途中には降りない
      if (c && this.track.crossProgress(land) >= 0) land = c.at + c.length + 1;
      if (c && at <= c.at + c.length && land > c.at + c.length) this.chan = (this.chan + 1) % this.walled;
      this.targetLane = this.chan;
      landLat = this.track.chanCenter(this.chan);
    }
    const a = this.track.frameAt(at, this.lat / this.track.halfWidth);
    const b = this.track.frameAt(land, landLat / this.track.halfWidth);
    const from = a.position;
    const to = b.position;
    const gap = from.distanceTo(to);
    const dur = Math.min(maxAir, Math.max(minAir, gap / this.speed));
    this.flightLat = landLat;
    // 正面へ飛び出し、着地点のコースの向きにそろえて降りる曲線
    this.flight = { from, to, t0: a.tangent.clone().multiplyScalar(gap), t1: b.tangent.clone().multiplyScalar(gap), t: 0, dur, toDist: land % this.track.length, h: cut ? ex.cutHeight : ex.tornadoHeight };
    this.airborne = true;
    this.tornadoAir = true;
    this.onRoller = false;
    this.vLat = 0;
  }

  private flightLat = 0;

  // 飛行中の位置と向き（描画・カメラ用）
  get flightPos(): THREE.Vector3 | null {
    const f = this.flight;
    if (!f) return null;
    const p = Math.min(1, f.t / f.dur);
    const pos = hermite(f, p, false);
    pos.y = f.from.y + (f.to.y - f.from.y) * p + f.h * 4 * p * (1 - p);
    return pos;
  }
  get flightDir(): THREE.Vector3 {
    const f = this.flight!;
    return hermite(f, Math.min(1, f.t / f.dur), true).setY(0).normalize();
  }

  // 空中ではハンドルもローラーも効かない
  private updateAir(dt: number) {
    const f = this.flight;
    if (f) {
      f.t += dt;
      this.airY = this.flightPos!.y;
      if (f.t >= f.dur) {
        if (f.toDist < this.distance) this.lap++;
        this.distance = f.toDist;
        this.lat = this.flightLat;
        this.crossing = this.track.crossProgress(this.distance) >= 0;
        // 着地したら通常の最高速まで落とす（ブースト速度のまま次のコーナーへ突っ込まない）
        this.speed = Math.min(this.speed, this.t.car.maxSpeed);
        this.flight = null;
        this.airborne = false;
        this.land(0);
        this.prevCenter = this.wallCenter;
      }
      return;
    }
    // トルネード: コーナーが近づいたら一気に減速して、強めに落ちて着地へ向かう
    if (this.tornadoAir) {
      const ex = this.t.ex;
      if (this.track.curvatureAt(this.distance + ex.tornadoBrakeAhead).k > this.t.corner.threshold) {
        this.speed = Math.max(this.t.car.maxSpeed * 0.8, this.speed - ex.tornadoBrakeDecel * dt);
        this.airGravity = Math.max(this.airGravity, this.t.air.gravity * ex.tornadoDropGravity);
      }
    }
    this.vy -= this.airGravity * dt;
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
    // ウェーブは次の山に着地するので、同じ跳ね方でも衝撃が大きい
    const load = this.landingLoad(fallSpeed) * (this.waveAir ? this.t.air.waveLoad ?? 1.6 : 1);
    this.waveAir = false;
    const excess = load - this.t.car.stability - this.t.aero.stability * this.aero;
    this.lastLandingTime = this.time;
    const tornado = this.tornadoAir;
    this.tornadoAir = false;
    if (excess <= 0 || tornado) {
      this.lastLanding = 'clean';
      this.speed *= 0.97;
      return;
    }
    const outChance = Math.min(l.maxOutChance, Math.max(0, (excess - l.outMargin) / l.outRange));
    if (this.rand() < outChance && this.exActive !== 'guard') {
      this.lastLanding = 'out';
      this.courseOut();
      return;
    }
    // バランスを崩して減速し、横に振られる（壁に当たればローラーの出番）
    this.lastLanding = 'wobble';
    this.speed *= 1 - Math.min(0.35, excess * l.speedLoss);
    this.vLat = (this.rand() * 2 - 1) * excess * l.wobble;
  }

  // エアードリフトターン: コースの内側の端よりさらに内側の空中（0番レーン）をドリフトしながら回る。
  // 壁もローラーも遠心力も関係なし、減速もしない。内側ほど中心線換算で多く進む（＝ショートカット）
  // 横位置にいちばん近いレーン番号
  private nearestLane(lat: number): number {
    let best = this.targetLane;
    for (let l = 0; l < this.laneCount; l++) if (Math.abs(this.laneLat(l) - lat) < Math.abs(this.laneLat(best) - lat)) best = l;
    return best;
  }

  // 今いる端のレーンの向き（右端=+1、左端=-1、端でなければ0）
  private edgeSide(): number {
    const n = this.laneCount;
    if (n < 2) return 0;
    return this.targetLane === n - 1 ? 1 : this.targetLane === 0 ? -1 : 0;
  }

  private updateAirDrift(dt: number, k: number, inside: number) {
    const ex = this.t.ex;
    this.onRoller = false;
    this.vLat = 0;
    this.airTime += dt;
    // 同じ向きのコーナーが今か少し先（6m）に続いている間は空中のまま。抜けたら（または時間切れで）コースへ戻る
    // （S字の切り返しでは、次の逆向きコーナーへ入る前に戻る）
    const still = this.turnAt(this.distance - 2) * this.airTurn > this.t.corner.threshold * 0.7;
    if (still) this.airEntered = true;
    else if (this.airEntered) this.airLanding = true;
    if (this.airTime > (ex.airMaxTime ?? 3)) this.airLanding = true;
    const edge = this.walled ? this.wallCenter + this.airSide * this.wallHalf : this.airSide * this.maxLat;
    // 柵より高く上がるまでは壁の内側で待つ（柵の中を通り抜けて見えないように）
    const high = this.airLift >= (ex.airHeight ?? 0.5) * 0.8;
    const target = this.airLanding || this.walled || !high ? edge : this.airSide * (this.track.halfWidth + (ex.airGap ?? 1.5));
    const step = (ex.airLatSpeed ?? 8) * dt;
    this.lat += THREE.MathUtils.clamp(target - this.lat, -step, step);
    this.airLift = this.airLanding ? Math.max(0, this.airLift - dt * 2) : Math.min(ex.airHeight ?? 0.5, this.airLift + dt * (ex.airRise ?? 2));
    if (this.airLanding && Math.abs(this.lat - edge) < 0.01) {
      // 着地: 飛び出した側の端のレーンへ
      if (!this.walled) {
        const lanes = [0, this.laneCount - 1];
        this.targetLane = lanes.find((l) => Math.sign(this.laneLat(l)) === this.airSide) ?? this.targetLane;
      }
      // ブースト速度のまま次のコーナーへ突っ込まないよう、通常の最高速まで落とす
      this.speed = Math.min(this.speed, this.t.car.maxSpeed);
      this.endEx();
    }
    const denom = Math.max(0.35, 1 - k * this.lat * inside);
    const before = this.distance;
    this.advance((this.speed * dt) / denom);
    this.checkJump(before);
  }

  private endEx() {
    // 壁走りから降りたら、ブースト速度のまま次のコーナーに突っ込まないよう少し落とす
    if (this.exActive === 'wallRide') this.speed = Math.min(this.speed, this.t.car.maxSpeed * 1.1);
    this.exActive = null;
    // スーパーキャパシタが切れたら、上限を超えていた分は消える
    this.gauge = Math.min(this.gauge, this.gaugeCap);
    this.exTimer = 0;
    this.doubleStage = 0;
    this.doubleUsed = false;
    this.wallSide = 0;
    this.wallJump = 0;
    this.revShots = 0;
  }

  // スピンのたまり具合を進め、たまったらスピンさせる。スピンしたら true
  private updateSpin(dt: number, excess: number): boolean {
    const sp = this.t.spin;
    const corner = this.t.corner;
    if (!sp) return false;
    let gain = (corner.spin ?? 0) * Math.max(0, excess - sp.threshold) * sp.gain;
    if (this.exActive === 'drift' && this.inCorner) gain += corner.spinDrift ?? 0;
    if (this.isBoosting && this.inCorner) gain += corner.spinBoost ?? 0;
    if (gain > 0) this.spinMeter += gain * dt;
    else this.spinMeter = Math.max(0, this.spinMeter - sp.recover * dt);
    if (this.spinMeter < 1) return false;
    this.spinMeter = 0;
    this.spinTimer = sp.time;
    this.driftMotion = 0;
    this.spins++;
    this.speed *= sp.speedKeep;
    this.vLat = 0;
    if (this.exActive === 'drift') this.endEx();
    return true;
  }
  // スピンしそう（見た目で車体を震わせる）
  get spinWarn(): number {
    const w = this.t.spin?.warn ?? 0.6;
    return this.spinMeter > w ? (this.spinMeter - w) / (1 - w) : 0;
  }
  get spinProgress(): number {
    const t = this.t.spin?.time ?? 1;
    return this.spinTimer > 0 ? 1 - this.spinTimer / t : 0;
  }

  private courseOut() {
    this.endEx();
    this.tornadoReady = false;
    this.tornadoAir = false;
    this.driftMotion = 0;
    this.shortcutReady = null;
    this.flight = null;
    this.courseOutTimer = this.t.corner.respawnTime;
    this.aeroTarget = false;
    this.aero = 0;
    this.courseOuts++;
    this.spinMeter = 0;
    this.spinTimer = 0;
    this.boostTimer = 0;
    this.airborne = false;
    this.speed = 0;
    this.vLat = 0;
  }
}

// エルミート曲線: 始点の向き t0 で出て、終点の向き t1 で着く（deriv=true で接線）
function hermite(f: { from: THREE.Vector3; to: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3 }, p: number, deriv: boolean): THREE.Vector3 {
  const p2 = p * p;
  const p3 = p2 * p;
  const [h00, h10, h01, h11] = deriv
    ? [6 * p2 - 6 * p, 3 * p2 - 4 * p + 1, -6 * p2 + 6 * p, 3 * p2 - 2 * p]
    : [2 * p3 - 3 * p2 + 1, p3 - 2 * p2 + p, -2 * p3 + 3 * p2, p3 - p2];
  return f.from.clone().multiplyScalar(h00).addScaledVector(f.t0, h10).addScaledVector(f.to, h01).addScaledVector(f.t1, h11);
}
