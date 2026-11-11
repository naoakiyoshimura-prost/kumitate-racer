import * as THREE from 'three';
import FX from './data/boostfx.json';

// ブーストの噴射演出（見た目だけ。走行計算には関わらない）。数値はすべて data/boostfx.json の jet。
// 1台につき描画は最大3回: 炎（全ノズルを1つの InstancedMesh）・輪と光（衝撃波リングと溜めの光）・線（火花・光の線・稲妻）。
// 炎の芯・外炎・ショックダイヤモンドはシェーダーで1枚の筒に描く（重ね描きを増やさない）。
// 粒と線は車の座標系で動かし、使い回しの配列に入れる（毎フレームの new なし）。
const J = FX.jet;

export interface Nozzle { anchor: THREE.Object3D; r: number }
export interface FxProfile { mini: boolean; cpu: boolean }
type Tier = (typeof J.tiers)[number];

/** fxScale が 0 なら新しい演出を使わず、従来の炎に戻す */
export const jetOn = () => J.fxScale > 0;

const col = (hex: string) => new THREE.Color(hex);

// 炎の筒: z=0（ノズル）から z=-1（先端）へ。半径は根元→ふくらみ→先端で細く
let flameGeo: THREE.BufferGeometry | null = null;
function flameGeometry() {
  if (flameGeo) return flameGeo;
  const S = J.shape;
  const R = S.radialSegments;
  const H = S.lengthSegments;
  const pos: number[] = [], nor: number[] = [], us: number[] = [], idx: number[] = [];
  const rad = (u: number) => (1 + (S.tipRadius - 1) * Math.pow(u, 0.85)) * (1 + S.bulge * Math.sin(Math.PI * Math.min(1, u * 1.6)));
  for (let i = 0; i <= H; i++) {
    const u = i / H;
    const r = rad(u);
    const slope = (rad(Math.min(1, u + 0.01)) - rad(Math.max(0, u - 0.01))) / 0.02;
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r, s * r, -u);
      const n = new THREE.Vector3(c, s, slope).normalize();
      nor.push(n.x, n.y, n.z);
      us.push(u);
    }
  }
  for (let i = 0; i < H; i++) for (let j = 0; j < R; j++) {
    const a = i * (R + 1) + j, b = a + R + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  g.setIndex(idx);
  return (flameGeo = g);
}

const FLAME_VS = /* glsl */ `
attribute float aU;
varying float vU; varying vec3 vN; varying vec3 vV; varying float vPhase; varying float vAxis;
void main() {
  #ifdef USE_INSTANCING
  mat4 mv = modelViewMatrix * instanceMatrix;
  #else
  mat4 mv = modelViewMatrix;
  #endif
  vec4 p = mv * vec4(position, 1.0);
  // 太さと長さの倍率が違うので、法線は倍率の2乗で割ってから回す（逆転置と同じ）
  #ifdef USE_INSTANCING
  vec3 sc = vec3(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz), dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz));
  vN = normalize(mat3(mv) * (normal / max(sc, vec3(1e-8))));
  #else
  vN = normalize(mat3(mv) * normal);
  #endif
  vV = normalize(-p.xyz);
  vU = aU;
  vPhase = float(gl_InstanceID) * 1.7;
  // 真後ろから見ると筒の側面は真横を向くので、軸と視線の近さも使う（後方カメラで炎が消えないように）
  vAxis = abs(dot(normalize(mat3(mv) * vec3(0.0, 0.0, 1.0)), vV));
  gl_Position = projectionMatrix * p;
}`;
const FLAME_FS = /* glsl */ `
uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uOuter; uniform vec3 uDiaColor;
uniform float uTime; uniform float uIntensity; uniform float uDia; uniform float uDiaCount;
uniform float uDiaStart; uniform float uDiaSpacing; uniform float uDiaWidth; uniform float uDiaDecay; uniform float uDiaShrink;
uniform float uCoreLen; uniform float uCoreWidth; uniform float uEdge; uniform float uRipple; uniform float uOcc; uniform float uGap;
varying float vU; varying vec3 vN; varying vec3 vV; varying float vPhase; varying float vAxis;
void main() {
  float f = max(abs(dot(normalize(vN), normalize(vV))), pow(vAxis, 3.0));
  float u = vU;
  float ripple = 1.0 - uRipple + uRipple * sin(u * 9.0 - uTime * 30.0 + vPhase * 3.0);
  float body = pow(f, uEdge) * pow(1.0 - u, 1.3) * ripple;
  float alpha = clamp(body * uOcc, 0.0, 1.0);
  body *= 1.0 - uGap * smoothstep(0.5, 1.0, f) * step(uDiaStart * 0.5, u);
  float core = smoothstep(uCoreWidth, 1.0, f) * (1.0 - smoothstep(0.0, uCoreLen, u));
  float dia = 0.0;
  for (int k = 0; k < 8; k++) {
    if (float(k) >= uDiaCount) break;
    float c = uDiaStart + float(k) * uDiaSpacing;
    float w = uDiaWidth * (1.0 + float(k) * 0.35);
    float d = (u - c) / w;
    dia += exp(-d * d) * pow(1.0 - uDiaDecay, float(k)) * smoothstep(uCoreWidth * (1.0 - float(k) * uDiaShrink), 1.0, f);
  }
  dia *= uDia;
  body *= 1.0 + uGap * min(dia, 1.0);
  vec3 c = mix(uMid, uOuter, clamp((u - 0.12) * 1.6 + (1.0 - f) * 0.2, 0.0, 1.0)) * body + uCore * core * 1.6 + mix(uMid, uDiaColor, 0.6) * dia;
  // 外炎は背景を少し隠す（加算だけだと灰色の路面の上で色が抜けて桃色っぽくなる）
  gl_FragColor = vec4(c * uIntensity, alpha);
}`;

// 輪（衝撃波リング）と光（溜めの光）: 正方形1枚。aKind 0=輪 1=光。輪は uBillboard でカメラへ向ける割合を決める
const RING_VS = /* glsl */ `
attribute vec4 aColor; attribute float aKind;
uniform float uBillboard;
varying vec2 vP; varying vec4 vC; varying float vKind;
void main() {
  mat4 mv = modelViewMatrix * instanceMatrix;
  vec4 c = mv * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 plane = (mv * vec4(position.xy, 0.0, 0.0)).xyz;
  float s = length((mv * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 bb = vec3(position.xy * s, 0.0);
  float k = aKind > 0.5 ? 1.0 : uBillboard;
  gl_Position = projectionMatrix * vec4(c.xyz + mix(plane, bb, k), 1.0);
  vP = position.xy; vC = aColor; vKind = aKind;
}`;
const RING_FS = /* glsl */ `
uniform float uThick;
varying vec2 vP; varying vec4 vC; varying float vKind;
void main() {
  float r = length(vP);
  float a;
  if (vKind < 0.5) {
    float d = (r - 0.82) / uThick;
    float d2 = (r - 0.82) / (uThick * 2.2);
    a = (exp(-d * d) + 0.3 * exp(-d2 * d2)) * smoothstep(1.0, 0.94, r);
  } else {
    a = (exp(-r * r * 6.0) + 0.5 * exp(-r * r * 30.0)) * smoothstep(1.0, 0.8, r);
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC.rgb * vC.a * a, 1.0);
}`;

// 線: 始点と終点を結ぶ細い帯。画面に向けて太さを付ける（線の太さが1pxに固定されない）
const LINE_VS = /* glsl */ `
attribute vec3 aA; attribute vec3 aB; attribute vec4 aColor; attribute float aWidth;
varying vec4 vC; varying float vSide; varying float vAlong;
void main() {
  vec4 a = modelViewMatrix * vec4(aA, 1.0);
  vec4 b = modelViewMatrix * vec4(aB, 1.0);
  vec4 p = mix(a, b, position.y);
  vec2 d = b.xy / min(-b.z, -0.01) - a.xy / min(-a.z, -0.01);
  float len = length(d);
  d = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  p.xy += vec2(-d.y, d.x) * position.x * aWidth;
  gl_Position = projectionMatrix * p;
  vC = aColor; vSide = position.x * 2.0; vAlong = position.y;
}`;
const LINE_FS = /* glsl */ `
varying vec4 vC; varying float vSide; varying float vAlong;
void main() {
  float a = (1.0 - vSide * vSide) * (0.25 + 0.75 * vAlong);
  gl_FragColor = vec4(vC.rgb * vC.a * a, 1.0);
}`;

let quadGeo: THREE.BufferGeometry | null = null;
const quad = () => (quadGeo ??= new THREE.PlaneGeometry(2, 2));

const KIND_SPARK = 0, KIND_LINE = 1, KIND_BOLT = 2;

export class BoostFx {
  readonly enabled = jetOn();
  private flames: THREE.InstancedMesh;
  private flameMat: THREE.ShaderMaterial;
  private rings: THREE.InstancedMesh;
  private ringMat: THREE.ShaderMaterial;
  private ringColor: THREE.InstancedBufferAttribute;
  private ringKind: THREE.InstancedBufferAttribute;
  private lines: THREE.Mesh;
  private lineGeo: THREE.InstancedBufferGeometry;
  private la: THREE.InstancedBufferAttribute;
  private lb: THREE.InstancedBufferAttribute;
  private lc: THREE.InstancedBufferAttribute;
  private lw: THREE.InstancedBufferAttribute;
  // 粒の使い回し（構造体の配列ではなく、項目ごとの配列）
  private cap: number;
  private P: Float32Array; // 位置 x,y,z
  private V: Float32Array; // 速度 x,y,z（稲妻は終点）
  private C: Float32Array; // 色 r,g,b,a
  private life: Float32Array;
  private maxLife: Float32Array;
  private width: Float32Array;
  private len: Float32Array;
  private kind: Uint8Array;
  private next = 0;
  private t = 0;
  private lastTime = -1;
  private rank = 0;
  private ringAt = -99;
  private ringTint = new THREE.Color();
  private pop = 0;
  private boltAt = -99;
  private sparkAcc = 0;
  private lineAcc = 0;
  private profile: FxProfile = { mini: false, cpu: false };
  // 毎フレームの作業用（new を避ける）
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private noz: { m: THREE.Matrix4; p: THREE.Vector3; d: THREE.Vector3; r: number }[];
  private tmpC = new THREE.Color();

  constructor(private root: THREE.Object3D, private nozzles: Nozzle[]) {
    const n = Math.max(1, nozzles.length);
    this.noz = nozzles.map(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), d: new THREE.Vector3(), r: 0 }));
    const add = THREE.AdditiveBlending;
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uCore: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uOuter: { value: new THREE.Color() }, uDiaColor: { value: col(J.diamond.color) },
        uTime: { value: 0 }, uIntensity: { value: 1 }, uDia: { value: 0 }, uDiaCount: { value: J.diamond.count },
        uDiaStart: { value: J.diamond.start }, uDiaSpacing: { value: J.diamond.spacing }, uDiaWidth: { value: J.diamond.width }, uDiaDecay: { value: J.diamond.decay }, uDiaShrink: { value: J.diamond.shrink },
        uCoreLen: { value: J.shape.coreLength }, uCoreWidth: { value: J.shape.coreWidth }, uEdge: { value: J.shape.edgeSoft }, uRipple: { value: J.shape.ripple },
        uOcc: { value: J.shape.occlusion }, uGap: { value: J.diamond.gap },
      },
    });
    this.flames = new THREE.InstancedMesh(flameGeometry(), this.flameMat, n);
    this.flames.frustumCulled = false;
    this.flames.visible = false;
    this.flames.renderOrder = 2;
    root.add(this.flames);

    const rg = quad().clone();
    this.ringColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.ringKind = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 1).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('aColor', this.ringColor);
    rg.setAttribute('aKind', this.ringKind);
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: add, side: THREE.DoubleSide,
      uniforms: { uBillboard: { value: J.ring.billboard }, uThick: { value: J.ring.thickness } },
    });
    this.rings = new THREE.InstancedMesh(rg, this.ringMat, n * 3);
    this.rings.frustumCulled = false;
    this.rings.visible = false;
    this.rings.renderOrder = 3;
    root.add(this.rings);

    const cap = (this.cap = J.pool.full);
    this.P = new Float32Array(cap * 3);
    this.V = new Float32Array(cap * 3);
    this.C = new Float32Array(cap * 4);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.width = new Float32Array(cap);
    this.len = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    const lg = (this.lineGeo = new THREE.InstancedBufferGeometry());
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    base.setIndex([0, 1, 2, 2, 1, 3]);
    lg.index = base.index;
    lg.setAttribute('position', base.getAttribute('position'));
    const dyn = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('aA', (this.la = dyn(3)));
    lg.setAttribute('aB', (this.lb = dyn(3)));
    lg.setAttribute('aColor', (this.lc = dyn(4)));
    lg.setAttribute('aWidth', (this.lw = dyn(1)));
    lg.instanceCount = 0;
    this.lines = new THREE.Mesh(lg, new THREE.ShaderMaterial({ vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: add, side: THREE.DoubleSide }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 3;
    root.add(this.lines);
  }

  /** 俯瞰モード（mini）・CPUの簡略版を選ぶ */
  setProfile(p: Partial<FxProfile>) {
    Object.assign(this.profile, p);
    const M = J.mini;
    this.ringMat.uniforms.uBillboard.value = this.profile.mini ? M.ringBillboard : J.ring.billboard;
    this.ringMat.uniforms.uThick.value = J.ring.thickness * (this.profile.mini ? M.ringThickness : 1);
  }

  private on(key: 'diamonds' | 'ring' | 'sparks' | 'bolts' | 'speedLines') {
    if (!J.enable[key]) return false;
    if (this.profile.cpu && !J.cpu[key]) return false;
    if (this.profile.mini && (key === 'diamonds' || key === 'bolts') && !J.mini[key]) return false;
    return true;
  }

  // ノズル → 車（root）の行列。ブースターの展開（格納・せり出し・腕・延長）を毎フレーム反映する
  private measure() {
    for (let i = 0; i < this.nozzles.length; i++) {
      const { anchor, r } = this.nozzles[i];
      const o = this.noz[i];
      anchor.updateMatrix();
      o.m.copy(anchor.matrix);
      let p = anchor.parent;
      while (p && p !== this.root) {
        p.updateMatrix();
        o.m.premultiply(p.matrix);
        p = p.parent;
      }
      o.m.decompose(o.p, this.q, this.s);
      o.d.set(0, 0, -1).applyQuaternion(this.q);
      o.r = r * this.s.x;
    }
  }

  /**
   * stage: 0=なし 1=ブースト 2=Wブースト2段目・トルネード / level: 多段ブーストの段（通常モードは1）/ charge: 溜め 0→1
   * time: setBoost と同じ時刻。dt を渡せばそれで動かす（俯瞰モードは走行計算の時間が速いので実時間を渡す）
   */
  update(stage: number, level: number, charge: number, time: number, dt?: number) {
    if (dt === undefined) dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.t += dt;
    const t = this.t;
    const k = Math.max(0, Math.min(1, J.fxScale));
    const tier: Tier | null = stage === 2 && level < 2 ? J.wboost : stage > 0 && level > 0 ? J.tiers[Math.min(J.tiers.length, level) - 1] : null;
    const rank = !tier ? 0 : tier === J.wboost ? 2.5 : level;
    this.measure();
    // 段が上がった瞬間: 衝撃波リングと、炎が一瞬明るくなる
    if (rank > this.rank && tier) {
      if (tier.ring > 0 && this.on('ring')) {
        this.ringAt = t;
        this.ringTint.set(tier.ringColor);
      }
      this.pop = J.ring.flash * k;
    }
    this.rank = rank;
    this.pop = Math.max(0, this.pop - (dt * J.ring.flash) / Math.max(0.01, J.ring.flashTime));
    const mini = this.profile.mini;
    const grow = (m: number) => 1 + (m - 1) * k;

    // 炎
    const showFlame = J.enable.flame && (!!tier || (charge > 0 && J.charge.flame > 0));
    this.flames.visible = showFlame;
    if (showFlame) {
      const u = this.flameMat.uniforms;
      const tr = tier ?? J.tiers[0];
      (u.uCore.value as THREE.Color).set(tier ? tr.core : J.charge.glowColor);
      (u.uMid.value as THREE.Color).set(tier ? tr.mid : J.charge.glowColor);
      (u.uOuter.value as THREE.Color).set(tier ? tr.outer : J.charge.glowColor);
      u.uTime.value = t;
      u.uIntensity.value = (tier ? tr.intensity : charge) * (1 + this.pop);
      u.uDia.value = tier && this.on('diamonds') ? tr.diamonds * k : 0;
      const lenMul = (tier ? grow(tr.length) : charge * J.charge.flame) * (mini ? J.mini.flameLength : 1);
      const wMul = (tier ? grow(tr.width) : 0.6) * (mini ? J.mini.flameWidth : 1);
      for (let i = 0; i < this.noz.length; i++) {
        const o = this.noz[i];
        const pulse = 1 + tr.pulseAmp * Math.sin(t * Math.PI * 2 * tr.pulseHz + i * 1.3) + 0.04 * Math.sin(t * 97 + i);
        const L = (J.shape.baseLength + J.shape.lengthPerRadius * this.nozzles[i].r) * lenMul * pulse;
        const w = this.nozzles[i].r * J.shape.startRadius * wMul;
        this.m2.makeScale(w, w, L);
        this.m.multiplyMatrices(o.m, this.m2);
        this.flames.setMatrixAt(i, this.m);
      }
      this.flames.count = this.noz.length;
      this.flames.instanceMatrix.needsUpdate = true;
    }

    // 輪（衝撃波リング）と溜めの光
    let ri = 0;
    const ringAge = (t - this.ringAt) / J.ring.life;
    const ringScale = mini ? J.mini.ringScale : 1;
    if (ringAge >= 0 && ringAge < 1) {
      const e = 1 - Math.pow(1 - ringAge, 3);
      const a = Math.pow(1 - ringAge, 1.5) * J.ring.alpha * k;
      for (let i = 0; i < this.noz.length; i++) {
        const o = this.noz[i];
        const rad = this.nozzles[i].r * (J.ring.startRadius + (J.ring.endRadius - J.ring.startRadius) * e) * ringScale;
        this.m2.makeScale(rad, rad, 1).setPosition(0, 0, -(J.ring.offset + J.ring.push * e));
        this.m.multiplyMatrices(o.m, this.m2);
        this.rings.setMatrixAt(ri, this.m);
        this.ringColor.setXYZW(ri, this.ringTint.r, this.ringTint.g, this.ringTint.b, a);
        this.ringKind.setX(ri, 0);
        ri++;
      }
    }
    // 噴射中のノズルの口の白い光（真後ろから見ても噴いているのが分かる）
    if (showFlame && tier && J.shape.mouthGlow > 0) {
      this.tmpC.set(tier.core);
      const a = J.shape.mouthGlow * tier.intensity * (1 + this.pop) * (0.9 + 0.1 * Math.sin(t * 60));
      for (let i = 0; i < this.noz.length; i++) {
        const g = this.nozzles[i].r * J.shape.mouthGlowSize * (mini ? J.mini.flameWidth : 1) * grow(tier.width);
        this.m2.makeScale(g, g, 1).setPosition(0, 0, -0.02);
        this.m.multiplyMatrices(this.noz[i].m, this.m2);
        this.rings.setMatrixAt(ri, this.m);
        this.ringColor.setXYZW(ri, this.tmpC.r, this.tmpC.g, this.tmpC.b, a);
        this.ringKind.setX(ri, 1);
        ri++;
      }
    }
    if (charge > 0 && J.enable.chargeGlow) {
      this.tmpC.set(J.charge.glowColor);
      const a = charge * J.charge.glowMax * (1 - J.charge.flicker + J.charge.flicker * Math.random());
      for (let i = 0; i < this.noz.length; i++) {
        const g = this.nozzles[i].r * J.charge.glowSize * (0.6 + 0.4 * charge);
        this.m2.makeScale(g, g, 1).setPosition(0, 0, -0.01);
        this.m.multiplyMatrices(this.noz[i].m, this.m2);
        this.rings.setMatrixAt(ri, this.m);
        this.ringColor.setXYZW(ri, this.tmpC.r, this.tmpC.g, this.tmpC.b, a);
        this.ringKind.setX(ri, 1);
        ri++;
      }
    }
    this.rings.visible = ri > 0;
    if (ri > 0) {
      this.rings.count = ri;
      this.rings.instanceMatrix.needsUpdate = true;
      this.ringColor.needsUpdate = true;
      this.ringKind.needsUpdate = true;
    }

    // 粒と線を出す
    if (tier) {
      const sp = this.on('sparks') ? tier.sparks * k * (mini ? J.mini.sparks : 1) : 0;
      this.sparkAcc += dt * sp;
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        this.emitSpark();
      }
      const ln = this.on('speedLines') ? tier.speedLines * k : 0;
      this.lineAcc += dt * ln;
      while (this.lineAcc >= 1) {
        this.lineAcc -= 1;
        this.emitLine(tier);
      }
      if (tier.bolts && this.on('bolts') && t - this.boltAt >= J.bolts.redraw) {
        this.boltAt = t;
        if (Math.random() < J.bolts.duty) this.emitBolts(tier, showFlame ? grow(tier.length) : 1);
      }
    } else this.sparkAcc = this.lineAcc = 0;
    this.step(dt);
  }

  private alloc() {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    return i;
  }

  private emitSpark() {
    if (!this.noz.length) return;
    const S = J.sparks;
    const o = this.noz[(Math.random() * this.noz.length) | 0];
    const i = this.alloc();
    const road = Math.random() < S.roadShare;
    const sp = S.speed * (0.6 + Math.random() * 0.6);
    const v = this.v.copy(o.d).multiplyScalar(sp);
    v.x += (Math.random() - 0.5) * 2 * S.spread * sp;
    v.y += road ? Math.random() * S.spread * sp * 1.5 : (Math.random() - 0.3) * S.spread * sp;
    v.z += (Math.random() - 0.5) * S.spread * sp * 0.5;
    this.P.set([o.p.x + (Math.random() - 0.5) * o.r, road ? 0.03 : o.p.y, o.p.z + (road ? 0.1 : 0)], i * 3);
    this.V.set([v.x, v.y, v.z], i * 3);
    this.tmpC.set(S.colors[(Math.random() * S.colors.length) | 0]);
    this.C.set([this.tmpC.r, this.tmpC.g, this.tmpC.b, 1], i * 4);
    this.life[i] = this.maxLife[i] = S.life * (0.6 + Math.random() * 0.8);
    this.width[i] = S.width * (this.profile.mini ? J.mini.sparkWidth : 1);
    this.len[i] = S.trail;
    this.kind[i] = KIND_SPARK;
  }

  private emitLine(tier: Tier) {
    const L = J.speedLines;
    const i = this.alloc();
    const side = Math.random() < 0.5 ? -1 : 1;
    const mini = this.profile.mini;
    this.P.set([side * (0.35 + Math.random() * (L.areaX - 0.35)), L.areaY[0] + Math.random() * (L.areaY[1] - L.areaY[0]), L.spawnZ[0] + Math.random() * (L.spawnZ[1] - L.spawnZ[0])], i * 3);
    this.V.set([0, 0, -L.speed * (0.8 + Math.random() * 0.4)], i * 3);
    this.tmpC.set(tier.lineColor);
    this.C.set([this.tmpC.r, this.tmpC.g, this.tmpC.b, L.alpha], i * 4);
    this.life[i] = this.maxLife[i] = L.life * (0.7 + Math.random() * 0.6);
    this.width[i] = L.width * (mini ? J.mini.lineWidth : 1);
    this.len[i] = L.length * (mini ? J.mini.lineLength : 1) * (0.6 + Math.random() * 0.8);
    this.kind[i] = KIND_LINE;
  }

  // 稲妻: ノズルの後ろ（炎のまわり）から外へ折れ曲がって走る短い線。描き直しの間だけ見える
  private emitBolts(tier: Tier, lenMul: number) {
    const B = J.bolts;
    this.tmpC.set(B.color);
    for (let b = 0; b < B.count && this.noz.length; b++) {
      const o = this.noz[(Math.random() * this.noz.length) | 0];
      const flameLen = (J.shape.baseLength + J.shape.lengthPerRadius * o.r) * lenMul;
      let x = o.p.x + o.d.x * flameLen * Math.random() * B.reach;
      let y = o.p.y + o.d.y * flameLen * Math.random() * B.reach;
      let z = o.p.z + o.d.z * flameLen * Math.random() * B.reach;
      const out = Math.random() < 0.5 ? -1 : 1;
      const up = Math.random() - 0.3;
      for (let s = 0; s < B.segments; s++) {
        const nx = x + out * (B.jag * (0.3 + Math.random())) + o.d.x * B.segLength;
        const ny = y + (up + (Math.random() - 0.5)) * B.jag;
        const nz = z + o.d.z * B.segLength * (0.4 + Math.random()) + (Math.random() - 0.5) * B.jag;
        const i = this.alloc();
        this.P.set([x, y, z], i * 3);
        this.V.set([nx, ny, nz], i * 3);
        this.C.set([this.tmpC.r, this.tmpC.g, this.tmpC.b, 1 - s / (B.segments + 1) * 0.6], i * 4);
        this.life[i] = this.maxLife[i] = B.redraw;
        this.width[i] = B.width * (1 - s / (B.segments * 1.5));
        this.len[i] = 0;
        this.kind[i] = KIND_BOLT;
        [x, y, z] = [nx, ny, nz];
      }
    }
  }

  // 粒を動かして線の配列へ書く
  private step(dt: number) {
    const { P, V, C, life } = this;
    const g = J.sparks.gravity;
    let n = 0;
    const A = this.la.array as Float32Array, B = this.lb.array as Float32Array, CC = this.lc.array as Float32Array, W = this.lw.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) continue;
      const j = i * 3;
      const fade = life[i] / this.maxLife[i];
      if (this.kind[i] === KIND_BOLT) {
        A.set([P[j], P[j + 1], P[j + 2]], n * 3);
        B.set([V[j], V[j + 1], V[j + 2]], n * 3);
      } else {
        if (this.kind[i] === KIND_SPARK) V[j + 1] -= g * dt;
        P[j] += V[j] * dt;
        P[j + 1] += V[j + 1] * dt;
        P[j + 2] += V[j + 2] * dt;
        if (this.kind[i] === KIND_SPARK && P[j + 1] < 0.01) {
          P[j + 1] = 0.01;
          V[j + 1] = Math.abs(V[j + 1]) * 0.35;
        }
        // 線は進む向きの後ろへ尾を引く。火花は速さ×trail、光の線は決まった長さ
        const sp = Math.hypot(V[j], V[j + 1], V[j + 2]) || 1;
        const tail = this.kind[i] === KIND_SPARK ? this.len[i] : this.len[i] / sp;
        A.set([P[j] - V[j] * tail, P[j + 1] - V[j + 1] * tail, P[j + 2] - V[j + 2] * tail], n * 3);
        B.set([P[j], P[j + 1], P[j + 2]], n * 3);
      }
      const a = this.kind[i] === KIND_LINE ? Math.sin(Math.PI * fade) : fade;
      CC.set([C[i * 4], C[i * 4 + 1], C[i * 4 + 2], C[i * 4 + 3] * a], n * 4);
      W[n] = this.width[i];
      n++;
    }
    this.lineGeo.instanceCount = n;
    this.lines.visible = n > 0;
    if (n > 0) {
      for (const at of [this.la, this.lb, this.lc, this.lw]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * at.itemSize);
        at.needsUpdate = true;
      }
    }
  }

  /** 演出の数（負荷の確認用）: 炎のノズル数、輪の数、線と粒の数 */
  stats() {
    return { flames: this.flames.visible ? this.flames.count : 0, rings: this.rings.visible ? this.rings.count : 0, lines: this.lineGeo.instanceCount };
  }
}
