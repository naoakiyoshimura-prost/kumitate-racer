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
  // 斜め後ろ（diag）: 離れた斜め後ろ上から見る。向きはゆっくりだけ車に付いていく（速く回すと酔う）
  diagTilt?: number; // 真上からの倒し角（度）
  diagYaw?: number; // 真後ろから横へ回す角（度）
  diagDist?: number; // 俯瞰の距離に対する倍率
  diagTurn?: number; // 向きが車に付いていく速さ（小さいほどゆっくり）
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
  wholeMargin: number; // 全体表示の余白（1で隙間なし）
  viewWidthFactor: number; // 映す幅をコース幅の何倍にするか（狭いコースでは寄って車を大きく見せる）
  viewWidthMin: number;
  slack: number; // 向き固定のとき、車が画面のこの割合ぶん動くまではカメラを動かさない（ゆるく追う。0でぴったり追う）
  tilt: number; // 真上から手前へ倒す角度（度）。斜めから見て立体感を出す。0で真上
  wholeTilt: number; // 全体表示のときの倒す角度
}

// 俯瞰の種類: fixed=向きを固定して車を追う / whole=コース全体を映して追わない / heading=進行方向が上
export type TopMode = 'fixed' | 'whole' | 'heading' | 'diag';
// コースの範囲（上から見た中心と大きさ）
export interface TopBounds { cx: number; cz: number; sx: number; sz: number; y: number; width: number }

export interface CameraTarget {
  position: THREE.Vector3;
  forward: THREE.Vector3;
}

// 車体から独立したカメラ部品。後方視点はプリセットの1つ（将来ここに視点を足す）
export class CameraRig {
  private readonly lookAt = new THREE.Vector3();
  private initialized = false;
  private fov = 0;
  viewDist = 0; // 「全体」のときのカメラから注視点までの距離（main.ts が遠い面と霧をこれに合わせる。0 = ふだんどおり）
  private fx = { ratio: 0, stage: 0, time: 0, enabled: true };

  // スピード感の演出: 速度比（0〜1.5）とブースト段階で視野角と揺れを変える
  setSpeed(ratio: number, stage: number, time: number, enabled: boolean) {
    this.fx = { ratio, stage, time, enabled };
  }

  constructor(readonly camera: THREE.PerspectiveCamera, public tuning: CameraTuning) {}

  private topDir = new THREE.Vector3();
  private topZoom = 1;
  private anchor = new THREE.Vector3();
  private punchLeft = 0;

  // ブーストの段が上がった瞬間に呼ぶ（俯瞰視点が一瞬だけ車に寄る）
  punch(time: number) {
    this.punchLeft = time;
  }

  // 俯瞰視点: 車の真上やや後ろから見下ろす。高速でも見失わないよう、速度とブーストで少し引く
  topUserZoom = 1; // 利用者が決める距離の倍率（ホイール・ピンチ）。「全体」は0.5〜1.4倍、車載は1より大きいと後ろから追う

  // 車載カメラ: 屋根の少し上・少し後ろから前を見る。車の傾き（坂・バンク・ループ）に付いていく。
  // 向きは少しだけならして、細かい揺れで酔いにくくする
  private obFwd = new THREE.Vector3();
  private obUp = new THREE.Vector3();
  private obOn = false;
  // zoom: ピンチ・ホイールの倍率。1 より大きいと後ろへ下がって車を後ろから追う、1 より小さいと画角を狭めて寄る
  updateOnboard(pos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, dt: number, zoom = 1) {
    const u = up.clone().normalize();
    const f = forward.clone().addScaledVector(u, -forward.dot(u));
    if (f.lengthSq() < 1e-6) f.copy(forward);
    f.normalize();
    const k = this.obOn ? 1 - Math.exp(-14 * dt) : 1;
    this.obFwd.lerp(f, k).normalize();
    this.obUp.lerp(u, k).normalize();
    this.obOn = true;
    this.viewDist = 0;
    this.initialized = false; // 俯瞰へ戻したときは、その場から作り直す
    const away = Math.max(0, zoom - 1); // 0〜1.5
    this.camera.position.copy(pos).addScaledVector(this.obUp, 1.5 + away * 1.6).addScaledVector(this.obFwd, -0.2 - away * 5);
    this.camera.up.copy(this.obUp);
    this.camera.lookAt(pos.clone().addScaledVector(this.obFwd, 14).addScaledVector(this.obUp, 0.6));
    const fov = 72 * Math.min(1, Math.max(0.55, zoom));
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  updateTop(target: CameraTarget, dt: number, t: TopCameraTuning, mode: TopMode = 'heading', bounds?: TopBounds) {
    this.obOn = false;
    this.viewDist = 0;
    const { ratio, stage, time, enabled } = this.fx;
    const flat = new THREE.Vector3(target.forward.x, 0, target.forward.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const half0 = Math.tan((t.fov * Math.PI) / 360);
    if (mode === 'diag') {
      if (!this.initialized) this.topDir.copy(flat);
      this.topDir.lerp(flat, 1 - Math.exp(-(t.diagTurn ?? 1.2) * dt)).normalize();
    } else if (mode !== 'heading' && bounds) {
      // 向きは固定。コースの長い辺が画面の長い辺に合う向きを選ぶ（縦画面なら長い辺が上下）
      const longX = bounds.sx > bounds.sz;
      const portrait = this.camera.aspect < 1;
      const dir = longX === portrait ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
      this.topDir.copy(dir);
      if (mode === 'whole') {
        // コース全体が入る高さから見下ろし、車を追わない
        const along = longX === portrait ? bounds.sx : bounds.sz;
        const across = longX === portrait ? bounds.sz : bounds.sx;
        // 「全体」もピンチ・ホイールで少しだけ寄る・引く（0.5〜1.4倍。引きすぎて地面が消えないよう遠い面は main.ts が合わせる）
        const hh = Math.max(along / (2 * half0), across / (2 * half0 * this.camera.aspect)) * t.wholeMargin * Math.min(1.4, Math.max(0.5, this.topUserZoom));
        this.viewDist = hh;
        const wt = (t.wholeTilt * Math.PI) / 180;
        const pos = new THREE.Vector3(bounds.cx, bounds.y + hh * Math.cos(wt), bounds.cz).addScaledVector(this.topDir, -hh * Math.sin(wt));
        const look = new THREE.Vector3(bounds.cx, bounds.y, bounds.cz);
        const kk = this.initialized ? 1 - Math.exp(-4 * dt) : 1;
        this.camera.position.lerp(pos, kk);
        this.lookAt.lerp(look, kk);
        this.initialized = true;
        this.camera.up.copy(this.topDir);
        this.camera.lookAt(this.lookAt);
        if (Math.abs(this.camera.fov - t.fov) > 0.05) {
          this.camera.fov = t.fov;
          this.camera.updateProjectionMatrix();
        }
        return;
      }
    } else {
      if (!this.initialized) this.topDir.copy(flat);
      this.topDir.lerp(flat, 1 - Math.exp(-t.turn * dt)).normalize();
    }
    this.punchLeft = Math.max(0, this.punchLeft - dt);
    const punch = enabled && t.punchTime > 0 ? t.punch * Math.sin(Math.PI * Math.min(1, this.punchLeft / t.punchTime)) : 0;
    const zoom = (1 + (enabled ? t.speedZoom * Math.min(ratio, 1.5) + t.boostZoom * stage : 0)) * (1 - punch);
    this.topZoom += (zoom - this.topZoom) * (1 - Math.exp(-(punch > 0 ? 9 : 3) * dt));
    const half = Math.tan((t.fov * Math.PI) / 360);
    const vw = bounds ? Math.max(t.viewWidthMin, Math.min(t.viewWidth, bounds.width * t.viewWidthFactor)) : t.viewWidth;
    const fit = vw / (2 * half * Math.max(0.2, this.camera.aspect));
    const h = Math.min(t.maxHeight, Math.max(t.minHeight, fit)) * this.topZoom * this.topUserZoom;
    // 向き固定のときは、進む先が少し広く見えるよう進行方向へずらす（カメラは回さない）
    const lead = mode === 'heading' ? this.topDir : flat;
    const back = mode === 'heading' ? t.back : 0.01;
    const aimAt = target.position.clone().addScaledVector(lead, t.lookAhead);
    let look = aimAt;
    if (mode !== 'heading' && t.slack > 0) {
      // ゆるく追う: 車が枠（画面の slack の割合）から出たぶんだけ、カメラの狙いを動かす
      if (!this.initialized) this.anchor.copy(aimAt);
      const side = new THREE.Vector3(-this.topDir.z, 0, this.topDir.x);
      const d = aimAt.clone().sub(this.anchor);
      const across = (vw / 2) * t.slack;
      const along = (vw / Math.max(0.2, this.camera.aspect) / 2) * t.slack;
      const da = d.dot(this.topDir);
      const ds = d.dot(side);
      this.anchor.addScaledVector(this.topDir, da - THREE.MathUtils.clamp(da, -along, along));
      this.anchor.addScaledVector(side, ds - THREE.MathUtils.clamp(ds, -across, across));
      this.anchor.y = aimAt.y;
      look = this.anchor.clone();
    }
    // 向き固定のときは手前へ倒して斜めから見下ろす（距離は同じ h のまま）
    const tilt = mode === 'heading' ? 0 : (t.tilt * Math.PI) / 180;
    if (mode === 'diag') {
      // 車の少し先を、斜め後ろ上から見る。カメラの上は常に空（画面が回らない）
      const dt2 = ((t.diagTilt ?? 52) * Math.PI) / 180, yw = ((t.diagYaw ?? 28) * Math.PI) / 180;
      const c = Math.cos(yw), s = Math.sin(yw);
      const dir = new THREE.Vector3(this.topDir.x * c - this.topDir.z * s, 0, this.topDir.x * s + this.topDir.z * c);
      const hd = h * (t.diagDist ?? 1.25);
      const aim = target.position.clone().addScaledVector(this.topDir, t.lookAhead);
      const want = aim.clone().addScaledVector(dir, -hd * Math.sin(dt2)).add(new THREE.Vector3(0, hd * Math.cos(dt2), 0));
      const kd = this.initialized ? 1 - Math.exp(-t.follow * dt) : 1;
      this.camera.position.lerp(want, kd);
      this.lookAt.lerp(aim, kd);
      this.initialized = true;
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.lookAt);
      if (Math.abs(this.camera.fov - t.fov) > 0.05) {
        this.camera.fov = t.fov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }
    const desired = look.clone().addScaledVector(this.topDir, -back - (mode === 'heading' ? t.lookAhead : 0) - h * Math.sin(tilt)).add(new THREE.Vector3(0, h * Math.cos(tilt), 0));
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
