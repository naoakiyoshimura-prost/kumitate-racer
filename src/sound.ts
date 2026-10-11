// 効果音: 音声ファイルは使わず、Web Audio でその場で作る（容量ゼロ、権利の心配なし）
// ブラウザは最初のタップまで音を出せないので、最初の操作で準備する。設定は「音 ON/OFF」で切り替え、端末に保存
const KEY = 'kumitate-racer.sound';
const CFG_KEY = 'kumitate-racer.soundcfg';

// モーター音の種類。wave=基本の波形、wave2=重ねる音（ratio2倍の高さ、mix2の大きさ）、f0+f1×速さ=音程、cut=こもらせる強さ
type EngineType = { label: string; wave: OscillatorType; wave2: OscillatorType; ratio2: number; mix2: number; f0: number; f1: number; cut: number; vol: number };
export const ENGINE_TYPES: Record<string, EngineType> = {
  soft: { label: 'やわらか', wave: 'triangle', wave2: 'sine', ratio2: 2, mix2: 0.3, f0: 180, f1: 420, cut: 2.5, vol: 0.035 },
  whine: { label: '高いモーター音', wave: 'sine', wave2: 'triangle', ratio2: 3, mix2: 0.15, f0: 420, f1: 900, cut: 3, vol: 0.022 },
  hum: { label: '低いうなり', wave: 'triangle', wave2: 'sine', ratio2: 0.5, mix2: 0.5, f0: 90, f1: 220, cut: 3, vol: 0.05 },
  retro: { label: 'レトロ（前の音）', wave: 'sawtooth', wave2: 'square', ratio2: 2.01, mix2: 0.6, f0: 140, f1: 520, cut: 4, vol: 0.03 },
  off: { label: 'なし', wave: 'sine', wave2: 'sine', ratio2: 1, mix2: 0, f0: 0, f1: 0, cut: 1, vol: 0 },
};
export type SoundCfg = { engineType: string; engine: number; slide: number; master: number };
function loadCfg(): SoundCfg {
  const def: SoundCfg = { engineType: 'soft', engine: 0.6, slide: 0.8, master: 1 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(CFG_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(KEY) !== 'off';
    } catch {
      // 読めなければ ON
    }
    const unlock = () => {
      this.init();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 * this.cfg.master : 0;
    this.master.connect(this.ctx.destination);
    // ホワイトノイズ（ブースト・壁・コースアウトの「ザッ」）
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // 保存できなくても切り替えは効く
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 * this.cfg.master : 0, this.ctx.currentTime, 0.02);
  }

  // 一時停止中やガレージでは全部止める
  private paused = false;
  pause(p: boolean) {
    if (!this.ctx || p === this.paused) return;
    this.paused = p;
    if (p) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  ready() {
    return this.ctx && this.master && this.enabled && this.ctx.state === 'running' ? this.ctx : null;
  }

  // 単音（ピッ）
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'square', at = 0, slideTo?: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ノイズ（ザッ）。帯域を動かすと「シュワッ」
  private noise(dur: number, vol: number, f0: number, f1: number, q = 1) {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  redLight() {
    this.tone(523, 0.18, 0.25);
  }
  greenLight() {
    this.tone(1046, 0.5, 0.3);
  }
  rocket() {
    this.tone(784, 0.12, 0.2, 'square');
    this.tone(1175, 0.25, 0.2, 'square', 0.08);
  }
  boost() {
    this.noise(0.6, 0.35, 600, 3000, 0.8);
    this.tone(220, 0.5, 0.12, 'sawtooth', 0, 440);
  }
  wall() {
    this.noise(0.12, 0.25, 2500, 1500, 2);
  }
  landing(clean: boolean) {
    this.tone(90, 0.18, 0.4, 'sine', 0, 50);
    if (!clean) this.noise(0.2, 0.2, 800, 300);
  }
  courseOut() {
    this.noise(0.5, 0.35, 1200, 200);
    this.tone(400, 0.6, 0.18, 'sawtooth', 0, 80);
  }
  lap(final: boolean) {
    this.tone(880, 0.15, 0.2, 'triangle');
    this.tone(final ? 1318 : 1175, 0.3, 0.2, 'triangle', 0.12);
  }
  reject() {
    this.tone(160, 0.12, 0.15, 'square');
  }
  goal(win: boolean) {
    const notes = win ? [523, 659, 784, 1046] : [523, 494, 440];
    notes.forEach((n, i) => this.tone(n, i === notes.length - 1 ? 0.6 : 0.16, 0.22, 'triangle', i * 0.14));
  }

  // ---- 調整できる設定（サウンドテスト画面で切り替え、端末に保存） ----
  cfg: SoundCfg = loadCfg();
  setCfg(c: Partial<SoundCfg>) {
    Object.assign(this.cfg, c);
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(this.cfg));
    } catch {
      // 保存できなくても今回は効く
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.5 * this.cfg.master : 0, this.ctx.currentTime, 0.02);
    // 種類を変えたら作り直す
    if (c.engineType && this.engine) {
      this.engineOn(false);
      this.engineOn(true);
    }
  }

  // モーター音: 速さで音程が上がる。種類は ENGINE_TYPES から選ぶ（初期値は控えめな「やわらか」）
  engineOn(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const type = ENGINE_TYPES[this.cfg.engineType] ?? ENGINE_TYPES.soft;
    if (on && !this.engine && this.cfg.engineType !== 'off') {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const mix2 = ctx.createGain();
      osc.type = type.wave;
      osc2.type = type.wave2;
      mix2.gain.value = type.mix2;
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(mix2).connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, filter, gain };
    } else if (!on && this.engine) {
      const e = this.engine;
      e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => {
        e.osc.stop();
        e.osc2.stop();
      }, 300);
      this.engine = null;
    }
  }
  engineSpeed(speed: number, boosting: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const type = ENGINE_TYPES[this.cfg.engineType] ?? ENGINE_TYPES.soft;
    const t = ctx.currentTime;
    const sp = Math.max(0, Math.min(1.6, speed));
    const f = type.f0 + type.f1 * sp + (boosting ? type.f1 * 0.15 : 0);
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.06);
    this.engine.osc2.frequency.setTargetAtTime(f * type.ratio2, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(f * type.cut, t, 0.06);
    const vol = type.vol * this.cfg.engine * (0.35 + 0.65 * Math.min(1, sp));
    this.engine.gain.gain.setTargetAtTime(sp > 0.01 ? vol : vol * 0.3, t, 0.08);
  }

  // スライド音（ドリフト中・横に流されている間の「シャーッ」）。amount=0〜1
  private skid: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  slide(amount: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    if (!this.skid) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 1800;
      hp.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(gain).connect(this.master);
      src.start();
      this.skid = { src, gain };
    }
    this.skid.gain.gain.setTargetAtTime(0.12 * this.cfg.slide * Math.max(0, Math.min(1, amount)), ctx.currentTime, 0.06);
  }

  // サウンドテスト用: 加速して最高速まで上がるモーター音を数秒鳴らす
  previewEngine() {
    if (!this.ready()) return;
    this.engineOn(true);
    const start = performance.now();
    const step = () => {
      const k = (performance.now() - start) / 3000;
      if (k >= 1) {
        this.engineOn(false);
        return;
      }
      this.engineSpeed(k < 0.8 ? k / 0.8 : 1, k > 0.6);
      requestAnimationFrame(step);
    };
    step();
  }
  previewSlide() {
    if (!this.ready()) return;
    this.slide(1);
    setTimeout(() => this.slide(0), 1500);
  }
}

export const sound = new Sound();
