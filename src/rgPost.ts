// レースゲームの仕上げの画面処理（高画質のときだけ。2026-11-27 店長「もう2段くらい盛っていい」、15 Pro Max でカクつかない確認済み）。
//  - 光のにじみ（明るい所だけ。ブーストの炎・空・白線が少し光る）
//  - 速いほど画面の周りが中心へ流れるブレ（真ん中の車はくっきり）。ブースト中は強め
//  - 色の仕上げ（少しだけ濃く・締まった色、画面の四隅を暗く）
//  - 映画のような明るさの圧縮（ACES）
// 走りの計算には関係しない。軽量画質ではこの処理を通さずに今までどおり描く
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const RadialBlur = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0 }, center: { value: new THREE.Vector2(0.5, 0.55) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float strength; uniform vec2 center; varying vec2 vUv;
    void main(){
      vec2 d = vUv - center;
      float w = smoothstep(0.12, 0.7, length(d)); // 真ん中はブレない
      vec2 step = d * strength * w / 8.0;
      vec4 c = vec4(0.0);
      for (int i = 0; i < 8; i++) c += texture2D(tDiffuse, vUv - step * float(i));
      gl_FragColor = c / 8.0;
    }`,
};
const Grade = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, sat: { value: 1.12 }, contrast: { value: 1.06 }, flash: { value: 0 }, flashCol: { value: new THREE.Color(0.55, 0.85, 1.0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float sat; uniform float contrast; uniform float flash; uniform vec3 flashCol; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(d, d) * 2.2;
      c.rgb += flash * flashCol * (0.4 + 0.6 * dot(d, d) * 4.0); // ブーストの段が上がった瞬間の光
      gl_FragColor = c;
    }`,
};

export class RgPost {
  private composer: EffectComposer;
  private blur: ShaderPass;
  private grade: ShaderPass;
  private bloom: UnrealBloomPass;
  private flash = 0;
  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.blur = new ShaderPass(RadialBlur);
    this.composer.addPass(this.blur);
    this.grade = new ShaderPass(Grade);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
  }
  resize() {
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
    this.bloom.resolution.set(s.x / 2, s.y / 2); // にじみは半分の細かさで（軽くする）
  }
  // 段が上がった瞬間に呼ぶ（一瞬画面が光る）
  // 段ごとの色（1=青、2=紫、3=金）。2026-11-28 店長「境目や発動演出が弱い」
  punch(stage = 1) {
    this.flash = 1;
    const c = [[0.55, 0.85, 1.0], [0.4, 0.75, 1.0], [1.0, 0.35, 0.9], [1.0, 0.8, 0.3]][stage] ?? [0.55, 0.85, 1.0];
    (this.grade.uniforms.flashCol.value as THREE.Color).setRGB(c[0], c[1], c[2]);
  }
  // speed01: 0〜1（700km/h で 1）。stage: 今のブーストの段（0=なし）
  render(dt: number, speed01: number, stage: number) {
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const want = Math.max(0, speed01 - 0.45) * 0.09 + stage * 0.025 + this.flash * 0.05;
    const u = this.blur.uniforms.strength;
    u.value += (want - u.value) * Math.min(1, dt * 6);
    this.grade.uniforms.flash.value = this.flash * 0.5;
    this.bloom.strength = 0.3 + stage * 0.08 + this.flash * 0.5;
    const tm = this.renderer.toneMapping, ex = this.renderer.toneMappingExposure;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.composer.render(dt);
    this.renderer.toneMapping = tm;
    this.renderer.toneMappingExposure = ex;
  }
  dispose() { this.composer.dispose(); }
}
