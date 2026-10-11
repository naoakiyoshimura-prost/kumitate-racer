// 効果音: 音声ファイルは使わず、Web Audio でその場で作る（容量ゼロ、権利の心配なし）
// ブラウザは最初のタップまで音を出せないので、最初の操作で準備する。設定は「音 ON/OFF」で切り替え、端末に保存
const KEY = 'kumitate-racer.sound';

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
    this.master.gain.value = this.enabled ? 0.5 : 0;
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.02);
  }

  // 一時停止中やガレージでは全部止める
  private paused = false;
  pause(p: boolean) {
    if (!this.ctx || p === this.paused) return;
    this.paused = p;
    if (p) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private ready() {
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

  // モーター音: 速さで音程が上がる「ウィーン」。speed=0〜1.6（最高速=1）
  engineOn(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (on && !this.engine) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'square';
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
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
    const t = ctx.currentTime;
    const f = 140 + 520 * speed + (boosting ? 120 : 0);
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(900 + 1800 * speed, t, 0.05);
    this.engine.gain.gain.setTargetAtTime(speed > 0.01 ? 0.05 + 0.04 * Math.min(1, speed) : 0.015, t, 0.05);
  }
}

export const sound = new Sound();
