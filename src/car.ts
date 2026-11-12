import * as THREE from 'three';
import { Track } from './track';

// スポンジブレーキの設定（setup.ts の BrakeSet と同じ形。car.ts は setup.ts を読まないのでここにも書く）
export interface SpongeSet { height: 'high' | 'mid' | 'low'; strength: 'weak' | 'mid' | 'strong'; place: 'axle' | 'mid' | 'out' }
export type SpongeEnd = 'front' | 'rear';

export interface Tuning {
  // brakeF / brakeR: スポンジブレーキ（付けた車だけ。無ければ今までどおりの計算）
  car: { maxSpeed: number; accel: number; halfWidth: number; diameter: number; stability: number; reaccel: number; reaccelBelow: number; ex: string; transform?: boolean; brakeF?: SpongeSet; brakeR?: SpongeSet; weight?: number; absorb?: number };
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
    driftHold?: number; // EXドリフト中に外へ膨らむ力を消す割合（1=全部消す）
    driftStar?: number; // ドリフトの★。3以上ならドリフトモーション（見た目だけ）ができ、★が多いほど角度がきつい
  };
  // スピン: たまり具合が1を超えると、くるっと回って大きく減速する（コースアウトにはしない）
  spin?: { threshold: number; gain: number; recover: number; speedKeep: number; time: number; warn: number; drag?: number }; // drag: スピン中も毎秒この割合で減速（無ければ減速しない）
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
    chargeTime?: number; // ブーストの溜め（押してから発動まで、秒）
    perfectWindow?: number; // コーナーを抜けてから何秒以内の発動をジャストにするか
    perfectAccel?: number; // ジャストで発動したブーストの加速の上乗せ（0.05=+5%）。今後ドライバーの能力「ブースト」でここを変える
    // 3段ブースト（CarState.multiBoost=true の車だけ）。配列は段ごと（[1段目, 2段目, 3段目]）
    multi?: {
      mode: 'tap' | 'time' | string; // tap=連打でチャージ、time=押したら chargeTime 秒溜めて発動
      taps: number[]; // tap: その段の発動に必要なタップ数
      tapDecay: number; // tap: 押さないときにチャージが減る速さ（タップ/秒相当）
      chargeTime: number[]; // time: その段の溜め時間（秒）
      cost: number[]; // ゲージ消費の比（1段目は boostCost そのもの、n段目は boostCost×cost[n]/cost[0]）
      speedAddMul: number[]; // ブーストの最高速の上乗せ（speedAdd）の倍率
      accelMul: number[]; // ブーストの加速倍率にさらに掛ける倍率
      duration: number[]; // 持続時間の比（n段目は duration×duration[n]/duration[0]）
      chainWindow: number; // その段が切れてから次の段をチャージできる秒数
    };
  };
  air: {
    gravity: number;
    flightGravityMul?: number; // 飛んでいる間の重力の倍率（俯瞰モードだけ。離陸の判定には使わない。無ければ1）
    airSpeedMul?: number; // 飛んでいる間に前へ進む速さの倍率（俯瞰モードだけ。無ければ1）
    rampAngle: number;
    slopeGravity: number;
    slowMul?: number; // 低速区間での最高速の倍率
    waveLoad?: number; // ウェーブの着地の衝撃の倍率
    bankGravity?: number; // 横傾き（バンク）の路面で、低い側へ引く重力の強さ。横向きの力は bankGravity×sin(傾き)。仮設定
    // 坂の頂上での自然な離陸（CourseData.crestTakeoff のコースだけ）。数値はすべて仮設定
    // 空中ではコースに沿って曲がれない: 飛んでいる間にコースが曲がると、まっすぐ飛ぶ車は横へずれていく。
    // ずれが width (m) を超えたらコースの外へ飛び出す（コースアウト）。超えなくても、ずれの割合×load を着地の衝撃に足す。仮設定。無ければ今までどおり
    flyOut?: { width: number; load: number };
    steep?: { climbMin: number; noCrestSlope: number; noCrestUp: number };
    loop?: { gravity: number; hold: number }; // 縦のループ（説明は tuning.json air.loop） // 急な坂の計算（俯瞰モードだけ。説明は mini.json steep）
    crest?: {
      gravity: number; // 離陸の判定と、離陸後に落ちる重力
      margin: number; // 路面が車から離れていく加速度が gravity×margin を超えたら浮く
      span: number; // 路面の曲がり具合を見る前後の距離 (m)
      back: number; // この距離 (m) 手前から…
      minRise: number; // …この高さ (m) 以上上ってきた所でだけ浮く（ウェーブなど小さな起伏では浮かない）
    };
  };
  // compoundGrip: タイヤの種類のグリップ（ミディアム=1）。gripFeel（俯瞰モードだけ、仮設定）があると、
  // ハイグリップはコーナーで引きずって少し減速（scrub）するかわりに立ち上がりの加速が増え（exitAccel）、
  // ローグリップは最高速の spinBelow 未満からの加速で少し空転する（spin）
  tire: { wearRate: number; minGrip: number; compoundGrip?: number; gripFeel?: { scrub: number; exitAccel: number; spin: number; spinBelow: number } };
  // スポンジブレーキの数値（すべて仮設定。説明は tuning.json brake._note）。長さは実寸mm。高さ・場所・強さはフロント/リヤ別の表
  brake?: {
    mmToGame: number; // 実寸1mmがゲームで何m か（車体の縮尺 3.38m/165mm）
    wheelbase: number; // ホイールベース (mm)
    baseTireMm: number; // タイヤ径の倍率1.0が何mmか
    height: Record<SpongeEnd, Record<SpongeSet['height'], number>>; // 中径タイヤでの路面との隙間 (mm)
    tireGap: number; // タイヤ径1mmあたり隙間が増える量 (mm)
    minGap: number; // 隙間の下限 (mm)。平らな所では当たらない
    place: Record<SpongeEnd, Record<SpongeSet['place'], number>>; // 車軸からブレーキまでの前後の距離 (mm)
    strength: Record<SpongeEnd, Record<SpongeSet['strength'], number>>; // 当たり量1mmあたりの減速 (m/s²、refSpeed のとき)
    refSpeed: number;
    speedExp: number;
    frontDrag: number; // フロントは同じ当たり量でも減速（引きずりの損）をこの割合だけ多く
    poseHold: number; // リヤが離れてから姿勢の効果が消えるまでの秒数
    poseMul: Record<SpongeSet['place'], number>; // リヤの場所ごとの姿勢の効き
    poseLift: number; // 姿勢の効き1で、離陸の縦の速さを抑える割合
    poseStability: number; // 姿勢の効き1で、着地安定性に足す量
    guideBankR: number; // ガレージの目安: バンクアプローチのへこみがゲームの路面でどの半径に見えるか (mm、brakesim の推定)
    guideSlopeR: number; // ガレージの目安: スロープの折れ目（谷）のへこみがゲームの路面でどの半径に見えるか (mm、同)
  };
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
    revShots?: number; // リボルバーブースト: 弾の数（EXで装填、ブーストボタンで1発ずつ溜めなしで撃つ）
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
    // 着地のバウンド（俯瞰モードだけ。説明は mini.json bounce）。あるときは car.stability にマスダンパー・サスの分を含めない（miniTune が外す）
    bounce?: { weightPow: number; absorbMul: number; hopMin: number; hop: number; hopMax: number; hopSpeedLoss: number };
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
  wheelSpin = false; // ローグリップのタイヤが立ち上がりで空転している（gripFeel があるときだけ）
  courseOutTimer = 0;
  courseOuts = 0;
  tireLife = 1; // 1=新品。コーナーで無理をするほど減り、グリップが落ちる
  wearLoad = 0; // 調整用: 遠心力の超過分の積算
  airborne = false;
  crestTakeoffs = 0; // 坂の頂上で自然に浮いた回数（CourseData.crestTakeoff のコースだけ。シミュ用）
  crestAir = false; // 坂の頂上で浮いて飛んでいる最中
  bounced = false; // 着地のバウンドで跳ね返って飛んでいる最中（次の着地では跳ねない）
  lastBounce = 0; // 直前の着地のバウンド値（吸収しきれなかった衝撃。表示・確認用）
  bounces = 0; // 跳ね返った回数
  airY = 0; // 空中にいるときの高さ（絶対値）
  private vy = 0;
  private airGravity = 0;
  lastLanding: Landing | null = null;
  lastLandingTime = 0;
  time = 0; // この車の経過時間（演出用）
  gauge: number;
  boostTimer = 0;
  // ブーストの溜め: 押してから chargeTime 秒たつと発動する（ゲージは発動の瞬間に減る）。'double' はダブルブーストの1段目
  boostCharge = 0;
  chargeKind: 'boost' | 'double' = 'boost';
  // コーナーの立ち上がり（コーナーを抜けて perfectWindow 秒以内）に発動したブーストは加速が上がる
  boostPerfect = false;
  perfectAt = -1; // 最後にジャストで発動した時刻（演出用）
  private cornerExitAt = -1e9;
  brakeTimer = 0; // ブレーキ中の残り秒数
  // 3段ブースト（オプトイン）。false の車は従来どおりの1段ブースト
  multiBoost = false;
  private mStage = 0; // 今の連鎖で発動した段（0=なし、1〜3）
  private mCharge = 0; // 次の段のチャージ 0〜1
  private mCharging = false; // time モード: 溜め中
  private mChain = 0; // 段が切れてから次の段を受け付ける残り秒
  lastRejected = 0; // ゲージ不足で操作が通らなかった時刻（画面の点滅用）
  // スポンジブレーキ（観測用）: いま路面に当たっているか、当たり量 (mm)、累計の当たり時間 (秒)
  spongeTouchF = false;
  spongeTouchR = false;
  spongeContactF = 0;
  spongeContactR = 0;
  spongeTimeF = 0;
  spongeTimeR = 0;
  spongeLoss = 0; // ブレーキで失った速さの累計 (m/s)
  spongePose = 0; // リヤの姿勢の効き（当たると1、離れると poseHold 秒で0へ）
  spongePoseAir = 0; // 今の飛び出しで効いている姿勢（場所の倍率込み）。着地で0に戻す

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
    // 最後のレーンは橋で一番左へ、ほかは右隣へ（reverse の立体交差は逆: 最初のレーンが橋で一番右へ、ほかは左隣へ）
    const c1 = this.track.chanCenter(this.crossNext());
    return c0 + (c1 - c0) * Track.crossShift(p);
  }
  // 今いる立体交差を抜けたあとのレーン番号
  private crossNext(): number {
    const n = this.walled;
    return this.track.crossAt(this.distance)?.reverse ? (this.chan + n - 1) % n : (this.chan + 1) % n;
  }
  private crossRev = false;
  get wallHalf() {
    return this.walled ? this.track.halfWidth / this.walled - this.t.car.halfWidth : this.maxLat;
  }
  // 橋の上にいる高さ
  get lift() {
    if (!this.walled) return 0;
    const c = this.track.crossAt(this.distance);
    if (!c || this.chan !== (c.reverse ? 0 : this.walled - 1)) return 0;
    return this.track.crossLift(this.track.crossProgress(this.distance), c.height ?? 2.6);
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
    this.boostPerfect = false;
    this.resetMulti();
    this.gauge = Math.min(this.gaugeCap, this.gauge + gauge);
  }

  // 操作命令を受け付けたら true。ゲージ不足なら false
  command(cmd: CarCommand, now = 0): boolean {
    if (this.isOut) return false;
    const b = this.t.boost;
    if (cmd === 'boost') {
      // リボルバーブースト中はブーストボタンが残りの弾を1発ずつ撃つ（ゲージは使わない）
      if (this.exActive === 'revolver') return this.fireRevolver() || this.reject(now);
      // 3段ブースト（ダブルブースト中は従来の動作）
      if (this.multiActive) return this.multiCommand(now);
      if (this.isBoosting || this.boostCharge > 0 || this.gauge < b.boostCost) return this.reject(now);
      this.boostCharge = b.chargeTime ?? 0;
      this.chargeKind = 'boost';
      if (this.boostCharge <= 0) this.fireBoost();
      return true;
    }
    if (cmd === 'brake') {
      if (this.brakeTimer > 0 || this.gauge < b.brakeCost) return this.reject(now);
      this.gauge -= b.brakeCost;
      this.brakeTimer = b.brakeTime;
      // ダブルブーストの1段目の溜めをブレーキで消したら、2段目も撃てない（EXごと終わり）
      if (this.exActive === 'doubleBoost' && this.chargeKind === 'double' && this.boostCharge > 0) this.endEx();
      this.boostTimer = 0;
      this.boostCharge = 0;
      this.resetMulti();
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
    if (this.allowDriftMotion && !this.exActive && !this.airborne) {
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
    return this.exActive === 'doubleBoost' && !this.doubleUsed && this.boostTimer <= 0 && this.boostCharge <= 0;
  }

  // EXボタンに出すカウントダウン（1段目の残り → 2段目を押せる残り → 2段目の残り）
  get exCountdown(): number {
    if (this.exActive === 'doubleBoost' && this.boostCharge > 0) return this.boostCharge + this.t.boost.duration;
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
        // 1段目も通常ブーストと同じく溜めてから発動（ゲージはEXで払い済み）
        this.exActive = 'doubleBoost';
        this.boostCharge = this.t.boost.chargeTime ?? 0;
        this.chargeKind = 'double';
        if (this.boostCharge <= 0) this.fireBoost();
        this.doubleStage = 0;
        this.doubleUsed = false;
        this.exTimer = this.boostCharge + this.t.boost.duration + ex.doubleWindow;
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
        // リボルバーブースト（山田健太）: 決まった量（EXの消費）で6発を装填。ブーストボタンで1発ずつ、溜めなしで撃つ
        this.exActive = 'revolver';
        this.exTimer = ex.revLimit ?? 20;
        this.revShots = ex.revShots ?? 6;
        this.boostCharge = 0;
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
    this.markPerfect();
    return true;
  }

  // 溜め終わりのブースト発動。ゲージはここで減る（溜めている間にレーン変更で足りなくなったら不発）
  private fireBoost() {
    if (this.chargeKind === 'boost') {
      if (this.isBoosting || this.gauge < this.t.boost.boostCost) return;
      this.gauge -= this.t.boost.boostCost;
    }
    this.boostTimer = this.t.boost.duration;
    this.markPerfect();
  }

  // ---- 3段ブースト ----
  // 多段ブーストが使える状態か（ダブルブーストの最中は従来の1段ブースト。リボルバーは command で先に処理）
  private get multiActive(): boolean {
    return this.multiBoost && !!this.t.boost.multi && this.exActive !== 'doubleBoost' && this.doubleStage <= 0;
  }
  maxStages = 0; // 多段ブーストの段数の上限（0 = 制限なし。テストプレイ用は1）
  get multiStages(): number {
    const n = this.t.boost.multi?.taps.length ?? 0;
    return this.maxStages > 0 ? Math.min(n, this.maxStages) : n;
  }
  // 今効いている段（0〜3）。multiBoost でない車は、ブースト中なら1
  get boostLevel(): number {
    if (!this.isBoosting) return 0;
    return this.multiBoost ? Math.max(1, this.mStage) : 1;
  }
  // 次にチャージできる段（1〜3）。できないときは 0
  get multiNext(): number {
    if (!this.multiActive || this.exActive === 'revolver' || this.isOut) return 0;
    if (this.mStage === 0) return this.isBoosting ? 0 : 1;
    if (this.mStage >= this.multiStages) return 0;
    return this.isBoosting || this.mChain > 0 ? this.mStage + 1 : 0;
  }
  // 次の段のチャージ量 0〜1
  get multiCharge(): number {
    return this.mCharge;
  }
  // 次の段を受け付ける残り秒（発動中は boostTimer + chainWindow）。0 なら不可
  get chainLeft(): number {
    const m = this.t.boost.multi;
    if (!m || !this.multiBoost || this.mStage === 0 || this.mStage >= this.multiStages) return 0;
    return this.isBoosting ? this.boostTimer + m.chainWindow : Math.max(0, this.mChain);
  }
  // stage 段目（1〜3）を発動するときのゲージ消費。1段目はブースターの boostCost、2段目以降はその比
  multiCostOf(stage: number): number {
    const m = this.t.boost.multi;
    const bc = this.t.boost.boostCost;
    if (!m || stage <= 1) return bc;
    return (bc * m.cost[stage - 1]) / m.cost[0];
  }
  private multiDurationOf(stage: number): number {
    const m = this.t.boost.multi;
    const d = this.t.boost.duration;
    if (!m || stage <= 1) return d;
    return (d * m.duration[stage - 1]) / m.duration[0];
  }
  private multiCommand(now: number): boolean {
    const m = this.t.boost.multi!;
    const next = this.multiNext;
    if (next === 0 || this.gauge < this.multiCostOf(next)) return this.reject(now);
    if (m.mode === 'time') {
      if (this.mCharging) return this.reject(now);
      this.mCharging = true;
      this.mCharge = 0;
      if ((m.chargeTime[next - 1] ?? 0) <= 0) this.fireMulti(next);
      return true;
    }
    this.mCharge = Math.min(1, this.mCharge + 1 / Math.max(1, m.taps[next - 1]));
    if (this.mCharge >= 1) this.fireMulti(next);
    return true;
  }
  // stage 段目を発動。ゲージはここで減る（time モードの溜め中に足りなくなったら不発）
  private fireMulti(stage: number) {
    this.mCharge = 0;
    this.mCharging = false;
    const cost = this.multiCostOf(stage);
    if (this.gauge < cost) return;
    this.gauge -= cost;
    this.mStage = stage;
    this.mChain = 0;
    this.boostTimer = this.multiDurationOf(stage);
    this.markPerfect();
  }
  private resetMulti() {
    this.mStage = 0;
    this.mCharge = 0;
    this.mCharging = false;
    this.mChain = 0;
  }
  // 毎フレーム: 連鎖の受付窓、タップのチャージの減り、time モードの溜め
  private updateMulti(dt: number) {
    const m = this.t.boost.multi;
    if (!m) return;
    if (this.mStage > 0) {
      // 発動中は窓を満タンに保ち、切れてから chainWindow 秒で段を0に戻す。最後の段は切れたらすぐ戻す
      if (this.isBoosting) this.mChain = m.chainWindow;
      else if (this.mStage >= this.multiStages) this.resetMulti();
      else {
        this.mChain -= dt;
        if (this.mChain <= 0) this.resetMulti();
      }
    }
    const next = this.multiNext;
    if (next === 0) {
      this.mCharge = 0;
      this.mCharging = false;
      return;
    }
    if (m.mode === 'time') {
      if (!this.mCharging) return;
      const ct = m.chargeTime[next - 1] ?? 0;
      this.mCharge = ct > 0 ? Math.min(1, this.mCharge + dt / ct) : 1;
      if (this.mCharge >= 1) this.fireMulti(next);
    } else if (this.mCharge > 0) {
      this.mCharge = Math.max(0, this.mCharge - (m.tapDecay / Math.max(1, m.taps[next - 1])) * dt);
    }
  }

  // コーナーを抜けた直後（車体がまっすぐに戻ったところ）の発動ならジャスト
  private markPerfect() {
    this.boostPerfect = !this.inCorner && this.time - this.cornerExitAt <= (this.t.boost.perfectWindow ?? 0);
    if (this.boostPerfect) this.perfectAt = this.time;
  }

  // 溜めの進み具合 0→1（演出用。溜めていなければ0）
  get chargeProgress(): number {
    const c = this.t.boost.chargeTime ?? 0;
    return this.boostCharge > 0 && c > 0 ? 1 - this.boostCharge / c : 0;
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
    // 空中では加速しない（updateAir は速さを上げない）ので、ブーストの残り時間を減らすと払ったゲージが無駄になる。
    // 多段ブーストの車だけ、空中では残り時間を止めて着地後に使い切れるようにする。
    // 従来の車は今までどおり空中でも減らす（既存モードのバランスとシミュの結果を変えないため）
    if (!(this.multiBoost && this.airborne)) this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.boostCharge > 0) {
      this.boostCharge -= dt;
      if (this.boostCharge <= 0) {
        this.boostCharge = 0;
        this.fireBoost();
      }
    }
    if (this.multiBoost) this.updateMulti(dt);
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
    this.flyTurn = this.flyDev = 0;
    this.flewOut = false;
    const lp = this.track.loopAt(this.distance);
    if (lp) {
      this.updateLoop(dt, lp);
      return;
    }
    this.loopFrom = -1;
    this.inLoop = false;

    const c = this.track.curvatureAt(this.distance);
    // inside: 曲がる内側が +右なら +1、左なら -1
    const inside = c.inside;
    // このレーン位置での実際の曲率（内側ほどきつい）
    const denom = Math.max(0.2, 1 - c.k * this.lat * inside);
    const kLane = c.k / denom;
    const wasInCorner = this.inCorner;
    this.inCorner = c.k > corner.threshold;
    if (wasInCorner && !this.inCorner) this.cornerExitAt = this.time;
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
      const drag = this.t.spin?.drag ?? 0;
      if (drag > 0) this.speed *= Math.exp(-drag * dt);
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
    // 3段ブースト: 今の段の倍率（multiBoost でない車は常に1で、従来と同じ）
    const mIdx = this.multiBoost && this.isBoosting && this.mStage > 0 && boost.multi ? this.mStage - 1 : -1;
    const mSpeed = mIdx >= 0 ? boost.multi!.speedAddMul[mIdx] ?? 1 : 1;
    const mAccel = mIdx >= 0 ? boost.multi!.accelMul[mIdx] ?? 1 : 1;
    const add = (mIdx >= 0 ? this.boostSpeedAdd() * mSpeed : this.boostSpeedAdd()) + (doubleNow ? boost.doubleAdd ?? 0 : 0);
    const mul = boosted ? 1 : this.exActive === 'drift' ? 1 + (ex.driftSpeedMul - 1) * (this.t.corner.driftMul ?? 1) : 1;
    const slow = this.track.slowAt(this.distance) ? this.t.air.slowMul ?? 0.65 : 1;
    const top = (car.maxSpeed * mul + (boosted ? add : 0)) * (1 + (aero.speedMul - 1) * a) * slow;
    // 減速した後の立ち上がり（最高速の90%未満）は、駆動方式ごとの再加速力が乗る（4WDが得意）
    const accel = car.accel * (boosted ? (mIdx >= 0 ? boost.accelMul * mAccel : boost.accelMul) * (doubleNow ? ex.doubleAccel ?? 1 : 1) * (this.boostPerfect && this.isBoosting ? 1 + (boost.perfectAccel ?? 0) : 1) : 1) * (this.speed < top * car.reaccelBelow ? car.reaccel : 1);
    const gf = this.t.tire.gripFeel;
    const gLv = (this.t.tire.compoundGrip ?? 1) - 1;
    let feel = 1;
    this.wheelSpin = false;
    if (gf && gLv > 0 && !this.inCorner) feel = 1 + gf.exitAccel * gLv;
    else if (gf && gLv < 0 && !boosted && this.speed < top * gf.spinBelow) { feel = Math.max(0.3, 1 + gf.spin * gLv); this.wheelSpin = true; }
    if (this.brakeTimer > 0) {
      // ブレーキ: 一定時間、強く減速する（加速はしない）
      this.brakeTimer = Math.max(0, this.brakeTimer - dt);
      this.speed = Math.max(boost.brakeMinSpeed, this.speed - boost.brakeDecel * dt);
    } else if (this.speed < top) this.speed = Math.min(top, this.speed + accel * feel * dt);
    else this.speed = Math.max(top, this.speed - car.accel * dt);
    if (gf && gLv > 0 && this.inCorner) this.speed = Math.max(0, this.speed - gf.scrub * gLv * this.speed * dt);
    // 上り坂で減速、下り坂で加速
    // slope は「高さ / 水平に進んだ距離」（tan）。急な坂（エディタのバンク80度など）では tan が何倍にもなって止まってしまうので、
    // steep があるとき（俯瞰モード）は斜面に沿った重力の成分（sin）で計算し、上りで止まり切らないよう最低の速さ climbMin を残す（ゲーム補正）
    const sl = this.track.frameAt(this.distance).slope;
    const steep = this.t.air.steep;
    if (steep) {
      this.speed = Math.max(sl > 0 ? Math.min(this.speed, steep.climbMin) : 0, this.speed - this.t.air.slopeGravity * (sl / Math.hypot(1, sl)) * dt);
    } else this.speed = Math.max(0, this.speed - this.t.air.slopeGravity * sl * dt);
    // スポンジブレーキ（付けた車だけ）
    if (this.t.brake && (this.t.car.brakeF || this.t.car.brakeR)) this.updateSponge(dt);

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
    // バンク（路面の横傾き）: 低い側へ引く重力の成分が、外へ流す遠心力を打ち消す（外側が高いバンク）。
    // 外へ流れる向き（pushIn は流れる先の反対＝内側）も、遠心力と重力を合わせた向きで決める。横傾きの無い所は今までどおり
    const bank = this.track.bankAt(this.distance);
    let pushIn = inside;
    let rawPull: number;
    if (bank === 0) rawPull = this.speed * this.speed * kLane - grip;
    else {
      // 右向きを + とした横向きの加速度: 遠心力は外（-inside）へ、重力は低い側（右が高いなら左）へ
      const side = -inside * this.speed * this.speed * kLane - (this.t.air.bankGravity ?? this.t.air.slopeGravity) * Math.sin(bank);
      pushIn = side >= 0 ? -1 : 1;
      rawPull = Math.abs(side) - grip;
    }
    // ドリフト中はアウトに膨らまない
    const pull = this.exActive === 'drift' && rawPull > 0 ? rawPull * (1 - (corner.driftHold ?? 1)) : rawPull;
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
      this.vLat += -pushIn * pull * corner.slideFactor * slideMul * (1 + (underMul - 1) * 0.3) * dt;
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
      if (pull > 0 && side === -pushIn) {
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
    if (!this.airborne && this.track.data.crestTakeoff) this.checkCrest();
  }

  // 坂の頂上での自然な離陸（CourseData.crestTakeoff のコースだけ）。
  // 路面が下へ曲がっていく所で、車が路面に沿うのに必要な「下向きの加速度」（速さ²×路面の曲がり）が重力を超えたら浮く。
  // 曲がり具合は中心線の3点（前後 span m）の2階差分を路面の上向きに投影して見るので、バンクの傾いた面の上のコーナー（面の中の円）では浮かない
  private checkCrest() {
    const cr = this.t.air.crest;
    if (!cr || this.tornadoReady || this.shortcutReady !== null || this.track.crossProgress(this.distance) >= 0) return;
    const s = this.distance;
    const p1 = this.track.frameAt(s).position;
    // ある程度上ってきた所だけ（小さな起伏・ウェーブでは浮かない）
    if (p1.y - this.track.frameAt(s - cr.back).position.y < cr.minRise) return;
    // 急な面（壁のようなバンク）の上では浮かせない: 浮いたあとの計算（真上へ飛んで落ちる）が急な面では成り立たず、面の上のコーナーでコースアウトになる
    const st = this.t.air.steep;
    const up0 = this.track.surfaceAt(s).up; // 路面の上向き。真上からの傾きが大きい面（横に大きく傾いた面の上のコーナーも含む）は対象外
    if (st && (Math.abs(this.track.frameAt(s).slope) > st.noCrestSlope || up0.y < st.noCrestUp)) return;
    const d = cr.span;
    const acc = this.track.frameAt(s + d).position.add(this.track.frameAt(s - d).position).addScaledVector(p1, -2).divideScalar(d * d);
    const up = this.track.surfaceAt(s).up;
    // 路面から離れる向きに必要な加速度と、重力のうち路面へ押し付ける成分
    const need = -acc.dot(up) * this.speed * this.speed;
    if (need <= cr.gravity * up.y * cr.margin) return;
    const slope = this.track.frameAt(s).slope;
    this.airborne = true;
    this.crestAir = true;
    this.waveAir = false;
    this.crestTakeoffs++;
    this.airY = p1.y;
    this.vy = (this.speed * slope) / Math.hypot(1, slope); // 坂に沿った速さの上向きの成分
    this.airGravity = cr.gravity * (this.t.air.flightGravityMul ?? 1);
    this.onRoller = false;
    this.spongeTakeoff();
  }

  // ---- スポンジブレーキ（数値は tuning.json brake、すべて仮設定） ----
  // 路面との隙間 (mm): 設定高さ（フロント/リヤ別の表、中径タイヤでの値）＋タイヤ径の差の分。平らな所では当たらないよう minGap 未満にしない
  spongeGap(b: SpongeSet, end: SpongeEnd): number {
    const k = this.t.brake!;
    return Math.max(k.minGap, k.height[end][b.height] + (this.t.car.diameter * k.baseTireMm - k.baseTireMm) * k.tireGap);
  }
  // 車体の中心が距離 s のとき、車軸から e mm 外（フロントは前、リヤは後ろ）のブレーキの点が路面へ近づく量 (mm、+ が近づく)。
  // 幾何で直接出す: 前後の車軸の真下の路面の点（中心線の距離 s±ホイールベース/2）を結ぶ線を車体の線とみなし、
  // その線を車軸から e だけ外へ延ばした点と、その先の路面の点（距離 s±(ホイールベース/2+e)）の差を、そこの路面の上向きで測る。
  // へこむ所（下り→上りの谷、坂の入口）で +、頂上（ふくらむ所）や平らな所では 0 以下。
  // 路面の上向きで測るので、バンクの傾いた面の中で曲がるコーナー（面の中の円）ではほぼ0。
  // 近似: タイヤの接地点は車軸の真下とし、タイヤ径による接地点のずれは見ない。路面は Track のスプライン（書き出しの点は約2m間隔）のまま
  spongeApproach(end: SpongeEnd, e: number, s = this.distance): number {
    const k = this.t.brake!;
    const sg = end === 'front' ? 1 : -1;
    const half = (k.wheelbase * k.mmToGame) / 2;
    const ee = e * k.mmToGame;
    const near = this.track.frameAt(s + sg * half).position; // ブレーキ側の車軸
    const far = this.track.frameAt(s - sg * half).position; // 反対側の車軸
    const tip = near.clone().addScaledVector(near.clone().sub(far).normalize(), ee);
    const f = this.track.frameAt(s + sg * (half + ee));
    const up = Track.surface(f.tangent, f.normal, f.slope, f.bank).up;
    return f.position.sub(tip).dot(up) / k.mmToGame;
  }
  private updateSponge(dt: number) {
    const k = this.t.brake!;
    const v = this.speed;
    let loss = 0;
    for (const end of ['F', 'R'] as const) {
      const b = end === 'F' ? this.t.car.brakeF : this.t.car.brakeR;
      const side: SpongeEnd = end === 'F' ? 'front' : 'rear';
      let c = 0;
      if (b) {
        // 当たり量 = 近づく量 − 隙間（フロントが先に、リヤが後から当たる）
        c = Math.max(0, this.spongeApproach(side, k.place[side][b.place]) - this.spongeGap(b, side));
        if (c > 0) loss += c * k.strength[side][b.strength] * (end === 'F' ? 1 + k.frontDrag : 1);
      }
      if (end === 'F') {
        this.spongeContactF = c;
        this.spongeTouchF = c > 0;
        if (c > 0) this.spongeTimeF += dt;
      } else {
        this.spongeContactR = c;
        this.spongeTouchR = c > 0;
        if (c > 0) this.spongeTimeR += dt;
      }
    }
    // リヤが当たると姿勢が整う（離れても poseHold 秒かけて薄れる）
    if (this.spongeTouchR) this.spongePose = 1;
    else this.spongePose = Math.max(0, this.spongePose - dt / k.poseHold);
    if (loss > 0) {
      // 速いほど強く当たる（へこみで車体が路面へ押し付けられる力は速さの2乗で増える）
      const dv = Math.min(v, loss * (v / k.refSpeed) ** k.speedExp * dt);
      this.speed -= dv;
      this.spongeLoss += dv;
    }
  }
  // 離陸の瞬間: リヤブレーキが当たっていた（姿勢が残っている）なら、飛び上がりを抑えて着地を安定させる。外寄りほど効く
  private spongeTakeoff() {
    const b = this.t.car.brakeR;
    const k = this.t.brake;
    if (!b || !k || this.spongePose <= 0) return;
    this.spongePoseAir = this.spongePose * k.poseMul[b.place];
    if (this.vy > 0) this.vy *= 1 - this.spongePoseAir * k.poseLift;
  }

  private advance(ds: number) {
    this.distance += ds;
    if (this.distance >= this.track.length) {
      this.distance -= this.track.length;
      this.lap++;
    }
    if (!this.walled) return;
    // 立体交差を抜けたらレーン番号を1つずらす（最後のレーンは一番左へ）
    const cx = this.track.crossAt(this.distance);
    const inCross = !!cx;
    if (this.crossing && !inCross) {
      this.chan = (this.chan + (this.crossRev ? this.walled - 1 : 1)) % this.walled;
      this.targetLane = this.chan;
    }
    if (cx) this.crossRev = !!cx.reverse;
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
      this.airGravity = this.t.air.gravity * (this.t.air.flightGravityMul ?? 1);
      if (this.t.car.brakeR) this.spongeTakeoff();
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
  flewOut = false; // 空中でコースから外れてコースアウトした（見た目をまっすぐ飛ばすため）
  flyTurn = 0; // 空中にいる間にコースが曲がった角度（ラジアン、符号つき）
  flyDev = 0; // まっすぐ飛んだ車のコース中心からの横ずれ (m)

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
    const fo = this.t.air.flyOut;
    if (fo && !this.tornadoAir) {
      // 飛んでいる間のコースの曲がり（向きの変化）と、まっすぐ飛ぶ車の横ずれ
      const cv = this.track.curvatureAt(this.distance);
      const v = this.speed * (this.t.air.airSpeedMul ?? 1);
      this.flyTurn += cv.k * cv.inside * v * dt;
      this.flyDev += v * Math.sin(this.flyTurn) * dt;
      if (Math.abs(this.flyDev) > fo.width && this.exActive !== 'guard') {
        this.flewOut = true;
        this.lastLanding = 'out';
        this.lastLandingTime = this.time;
        this.courseOut();
        return;
      }
    }
    this.advance(this.speed * (this.tornadoAir ? 1 : this.t.air.airSpeedMul ?? 1) * dt);
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
    this.crestAir = false;
    let excess = load - this.t.car.stability - this.t.aero.stability * this.aero;
    // 着地のバウンド: 衝撃×車重の係数のうち、マスダンパーとサスペンションで吸収しきれなかった分（bounce）が残る。
    // 残りは従来の「安定」（ダンパー・サス以外の分）と比べて乱れを決め、ある程度より大きければ小さく跳ね返る
    const bc = l.bounce;
    const canHop = !this.bounced;
    this.bounced = false;
    let hop = 0;
    if (bc && !this.tornadoAir) {
      const lw = load * Math.pow(this.t.car.weight ?? 1, bc.weightPow);
      const bounce = lw - Math.min(lw, (this.t.car.absorb ?? 0) * bc.absorbMul);
      this.lastBounce = bounce;
      excess = bounce - this.t.car.stability - this.t.aero.stability * this.aero;
      if (canHop && bounce > bc.hopMin) hop = Math.min(bc.hopMax, (bounce - bc.hopMin) * bc.hop);
    }
    // 曲がっている所へ斜めに降りた分（空中での横ずれの割合）
    const fo = this.t.air.flyOut;
    if (fo && !this.tornadoAir) excess += (Math.abs(this.flyDev) / fo.width) * fo.load;
    this.flyTurn = this.flyDev = 0;
    // リヤブレーキの姿勢の効き（付けていない車は 0 のまま、計算に入れない）
    if (this.spongePoseAir > 0) {
      excess -= this.spongePoseAir * (this.t.brake?.poseStability ?? 0);
      this.spongePoseAir = 0;
    }
    this.lastLandingTime = this.time;
    const tornado = this.tornadoAir;
    this.tornadoAir = false;
    if (excess <= 0 || tornado) {
      this.lastLanding = 'clean';
      this.speed *= 0.97;
      if (hop > 0) this.bounceUp(hop);
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
    if (hop > 0) this.bounceUp(hop);
  }

  // 着地で跳ね返る: 小さく真上へ飛び直す（次の着地では跳ねない）
  private bounceUp(vy: number) {
    this.airborne = true;
    this.bounced = true;
    this.bounces++;
    this.vy = vy;
    this.airY = this.track.frameAt(this.distance).position.y;
    this.airGravity = (this.t.air.crest?.gravity ?? this.t.air.gravity) * (this.t.air.flightGravityMul ?? 1);
    this.speed *= 1 - (this.t.landing.bounce?.hopSpeedLoss ?? 0);
    this.onRoller = false;
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

  // 縦のループの中の専用の走り: 決まった線を通り、横には流れない。速さは重力（上りで減り、下りで増える）とモーターの加速で変わる。
  // 上半分では、路面に押し付ける力（速さ²÷半径）が重力の路面から離れる成分より小さくなったら落ちる（コースアウト）。数値は tuning.json air.loop（仮）
  inLoop = false;
  private loopFrom = -1; // レーンチェンジのループに入ったときのレーン（仕切りレーン）
  private updateLoop(dt: number, lp: { index: number; progress: number; radius: number; lane: boolean; length: number }) {
    const k = this.t.air.loop ?? { gravity: this.t.air.slopeGravity, hold: 1 };
    const th = lp.progress * Math.PI * 2;
    this.inLoop = true;
    this.inCorner = false;
    this.onRoller = false;
    this.vLat = 0;
    const top = this.t.car.maxSpeed + (this.isBoosting ? this.boostSpeedAdd() : 0);
    if (this.speed < top) this.speed = Math.min(top, this.speed + this.t.car.accel * dt);
    this.speed = Math.max(0, this.speed - k.gravity * Math.sin(th) * dt);
    // 落ちる判定: cos が負（上半分）のとき、速さ²/半径 が 重力×(−cos)×hold より小さい
    const need = -Math.cos(th) * k.gravity * k.hold;
    if (need > 0 && (this.speed * this.speed) / lp.radius < need && this.exActive !== 'guard') {
      this.inLoop = false;
      // 復帰はループの出口から（ループの途中に速さ0で戻すと、また落ちる）
      this.advance((1 - lp.progress) * lp.length + 0.5);
      this.flewOut = true;
      this.lastLanding = 'out';
      this.lastLandingTime = this.time;
      this.courseOut();
      return;
    }
    // レーンチェンジのループ: 回りながら隣のレーンへ（最後のレーンは最初のレーンへ）
    if (lp.lane && this.walled) {
      if (this.loopFrom < 0) this.loopFrom = this.chan;
      const to = (this.loopFrom + 1) % this.walled;
      const x = lp.progress * lp.progress * (3 - 2 * lp.progress);
      this.lat = this.track.chanCenter(this.loopFrom) + (this.track.chanCenter(to) - this.track.chanCenter(this.loopFrom)) * x;
      if (lp.progress > 0.5) { this.chan = to; this.targetLane = to; }
    }
    this.advance(this.speed * dt);
  }
  // ほかの車に追いつかれた: その場でコースアウト（俯瞰モードの決まり。飛行中・ガード中・すでにコースアウト中は対象外）
  knockOut(): boolean {
    if (this.isOut || this.flight || this.exActive === 'guard') return false;
    this.lastLanding = 'out';
    this.lastLandingTime = this.time;
    this.courseOut();
    return true;
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
    this.boostCharge = 0;
    this.resetMulti();
    this.airborne = false;
    this.crestAir = false;
    this.spongePose = 0;
    this.spongePoseAir = 0;
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
