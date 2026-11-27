// レースゲームモードの操作と表示（2026-11-26 店長）:
// 「基本オートアクセル。ハンドルの右左はジョイスティック式。ブレーキボタンあり」
// 「ブーストボタンを押すと展開、必要なら1段目タメ、発動。カウントダウン式で2の発動5秒前からカウントダウン。3も3秒前から」
// 「どっかに2のブーストチャージ状況をインジケーターでカッコよく表示したい」
// ドリフトの入れ方は店長未決。仮に2方式を切り替えられるようにした: 短押し式（ブレーキを短く押した時にスティックを倒していればドリフト、長押しは普通のブレーキ）と専用ボタン式
// 画面は横を基本にし（両親指: 左にスティック、右にブースト・ブレーキ・ドリフト）、縦でも同じボタンで遊べる
import type { CarState } from './car';
import { rgCfg } from './raceGame';

type DriftMode = 'tap' | 'button';
const MODE_KEY = 'kumitate-racer.rgDrift';
const METER_KEY = 'kumitate-racer.rgMeter';
// メーター（2026-11-26 店長「サイバーパンクな感じをいれつつ近未来なデザイン、アナログメーターなどもある、デジタル・アナログ選べる」）: 意匠はオリジナル
const METER_MAX = 800; // アナログの目盛りの上限（km/h）
const ARC0 = -225, ARC1 = 45; // 針の角度（度、真上が −90）: 左下から右下まで270度
function arcPath(r: number, a0: number, a1: number): string {
  const p = (a: number) => [100 + r * Math.cos((a * Math.PI) / 180), 100 + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
function analogSvg(): string {
  let ticks = '';
  for (let v = 0; v <= METER_MAX; v += 50) {
    const a = ((ARC0 + ((ARC1 - ARC0) * v) / METER_MAX) * Math.PI) / 180;
    const big = v % 100 === 0;
    const r0 = big ? 70 : 76, r1 = 84;
    ticks += `<line x1="${(100 + r0 * Math.cos(a)).toFixed(1)}" y1="${(100 + r0 * Math.sin(a)).toFixed(1)}" x2="${(100 + r1 * Math.cos(a)).toFixed(1)}" y2="${(100 + r1 * Math.sin(a)).toFixed(1)}" class="${v >= 600 ? 'red' : ''}${big ? ' big' : ''}"/>`;
    if (big) ticks += `<text x="${(100 + 58 * Math.cos(a)).toFixed(1)}" y="${(104 + 58 * Math.sin(a)).toFixed(1)}">${v / 100}</text>`;
  }
  return `<svg viewBox="0 0 200 200"><path class="rim" d="${arcPath(90, ARC0, ARC1)}"/><path class="en" d="${arcPath(95, ARC0, ARC1)}" pathLength="100"/>${ticks}` +
    `<g class="needle"><line x1="100" y1="100" x2="100" y2="26"/><circle cx="100" cy="100" r="7"/></g><text class="unit" x="100" y="140">×100 km/h</text><text class="num" x="100" y="168">0</text></svg>`;
}

export class RgControls {
  readonly root: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private brakeBtn: HTMLButtonElement;
  private driftBtn: HTMLButtonElement;
  private modeBtn: HTMLButtonElement;
  private count: HTMLDivElement;
  private meter: HTMLDivElement;
  private bars: HTMLDivElement[] = [];
  private stickId = -1;
  private stickX = 0;
  private keyL = false;
  private keyR = false;
  private brakeDown = false;
  private brakeAt = 0;
  private driftHeld = false;
  private tapDrift = 0; // 短押し式で始めたドリフトの向き（0=なし）
  private now = 0;
  private lastCount = '';
  mode: DriftMode = 'tap';
  meterMode: 'digital' | 'analog' = 'digital';
  private speedo!: HTMLDivElement;
  private digNum!: HTMLElement;
  private digEn!: HTMLElement;
  private digStage!: HTMLElement;
  private needle!: SVGGElement;
  private anaNum!: SVGTextElement;
  private anaEn!: SVGPathElement;
  private meterBtn!: HTMLButtonElement;
  private shownKmh = -1;
  private qualityBtn!: HTMLButtonElement;
  onQuality?: () => void;
  setQualityLabel(q: 'high' | 'low') { this.qualityBtn.textContent = q === 'high' ? '画質: 高画質' : '画質: 軽量'; }

  constructor(private simScale: number) {
    try { if (localStorage.getItem(MODE_KEY) === 'button') this.mode = 'button'; } catch { /* なし */ }
    const root = (this.root = document.createElement('div'));
    root.id = 'rg-ui';
    root.hidden = true;
    root.innerHTML =
      `<div class="rg-stick"><div class="rg-knob"></div></div>` +
      `<button class="rg-brake" type="button">BRAKE</button>` +
      `<button class="rg-drift" type="button">DRIFT</button>` +
      `<button class="rg-mode" type="button"></button>` +
      `<div class="rg-count"></div>` +
      `<div class="rg-meter"><div class="rg-seg" data-s="2"><i></i><b>BOOST 2</b></div><div class="rg-seg" data-s="3"><i></i><b>BOOST 3</b></div></div>` +
      `<div class="rg-rotate">横画面がおすすめ</div>` +
      `<div class="rg-speedo"><div class="rg-digital"><b>0</b><span>KM/H</span><div class="rg-en"><i></i></div><small class="rg-stage"></small></div><div class="rg-analog">${analogSvg()}</div></div>` +
      `<button class="rg-meter-mode" type="button"></button>` +
      `<button class="rg-quality" type="button"></button>`;
    document.body.appendChild(root);
    this.base = root.querySelector('.rg-stick')!;
    this.knob = root.querySelector('.rg-knob')!;
    this.brakeBtn = root.querySelector('.rg-brake')!;
    this.driftBtn = root.querySelector('.rg-drift')!;
    this.modeBtn = root.querySelector('.rg-mode')!;
    this.count = root.querySelector('.rg-count')!;
    this.meter = root.querySelector('.rg-meter')!;
    this.bars = Array.from(root.querySelectorAll<HTMLDivElement>('.rg-seg'));
    this.applyMode();
    this.speedo = root.querySelector('.rg-speedo')!;
    this.digNum = root.querySelector('.rg-digital b')!;
    this.digEn = root.querySelector('.rg-en i')!;
    this.digStage = root.querySelector('.rg-stage')!;
    this.needle = root.querySelector('.needle')!;
    this.anaNum = root.querySelector('.rg-analog .num')!;
    this.anaEn = root.querySelector('.rg-analog .en')!;
    this.meterBtn = root.querySelector('.rg-meter-mode')!;
    try { if (localStorage.getItem(METER_KEY) === 'analog') this.meterMode = 'analog'; } catch { /* なし */ }
    this.applyMeter();
    this.meterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.meterMode = this.meterMode === 'digital' ? 'analog' : 'digital';
      try { localStorage.setItem(METER_KEY, this.meterMode); } catch { /* なし */ }
      this.applyMeter();
    });

    // 画質（高画質／軽量）: 見た目だけ。走りの結果は変わらない
    this.qualityBtn = root.querySelector('.rg-quality')!;
    this.qualityBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onQuality?.(); });

    // スティック: 押した所から左右へ倒した量（土台の半径で割る）。離すと真ん中へ戻る
    const move = (e: PointerEvent) => {
      const r = this.base.getBoundingClientRect();
      const half = r.width / 2;
      this.stickX = Math.max(-1, Math.min(1, (e.clientX - (r.left + half)) / half));
      this.knob.style.transform = `translateX(${this.stickX * half * 0.6}px)`;
    };
    this.base.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.stickId = e.pointerId; this.base.setPointerCapture(e.pointerId); move(e); });
    this.base.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== this.stickId) return; this.stickId = -1; this.stickX = 0; this.knob.style.transform = ''; };
    this.base.addEventListener('pointerup', end);
    this.base.addEventListener('pointercancel', end);

    const hold = (el: HTMLElement, on: (v: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); on(true); el.classList.add('on'); });
      const off = () => { on(false); el.classList.remove('on'); };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold(this.brakeBtn, (v) => this.setBrake(v));
    hold(this.driftBtn, (v) => { this.driftHeld = v; });
    this.modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.mode = this.mode === 'tap' ? 'button' : 'tap';
      try { localStorage.setItem(MODE_KEY, this.mode); } catch { /* なし */ }
      this.applyMode();
    });
    // キーボード（PCで試す用）: ←→ハンドル、↓/S ブレーキ、X ドリフト（専用ボタン式のとき）
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.keyL = true;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keyR = true;
      if (e.key === 'ArrowDown' || e.key === 's') this.setBrake(true);
      if (e.key === 'x') this.driftHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') this.keyL = false;
      if (e.key === 'ArrowRight' || e.key === 'd') this.keyR = false;
      if (e.key === 'ArrowDown' || e.key === 's') this.setBrake(false);
      if (e.key === 'x') this.driftHeld = false;
    });
  }

  private applyMeter() {
    this.speedo.classList.toggle('analog', this.meterMode === 'analog');
    this.meterBtn.textContent = this.meterMode === 'digital' ? 'メーター: デジタル' : 'メーター: アナログ';
  }

  // 速度計（kmh は画面に出す km/h）。ENの残りとブーストの段も一緒に出す
  speed(kmh: number, s: CarState) {
    const en = s.gauge / Math.max(1, s.gaugeCap);
    const stage = s.isBoosting ? s.rgStage : 0;
    this.speedo.dataset.stage = String(stage);
    if (kmh !== this.shownKmh) {
      this.shownKmh = kmh;
      this.digNum.textContent = String(kmh);
      this.anaNum.textContent = String(kmh);
      const a = ARC0 + ((ARC1 - ARC0) * Math.min(METER_MAX, kmh)) / METER_MAX;
      this.needle.style.transform = `rotate(${a + 90}deg)`;
    }
    this.digEn.style.width = `${(en * 100).toFixed(1)}%`;
    this.anaEn.style.strokeDasharray = `${(en * 100).toFixed(1)} 100`;
    this.digStage.textContent = stage ? `BOOST ${stage}` : `EN ${Math.round(en * 100)}%`;
  }

  private applyMode() {
    this.modeBtn.textContent = this.mode === 'tap' ? 'ドリフト: 短押し式' : 'ドリフト: 専用ボタン';
    this.root.classList.toggle('drift-button', this.mode === 'button');
  }

  // ブレーキを離した時、短押しでスティックを倒していればドリフト開始（短押し式）
  private setBrake(v: boolean) {
    if (v === this.brakeDown) return;
    this.brakeDown = v;
    if (v) { this.brakeAt = this.now; return; }
    const steer = this.steer;
    if (this.mode === 'tap' && this.now - this.brakeAt < rgCfg.driftTap && Math.abs(steer) > 0.4) this.tapDrift = Math.sign(steer);
  }

  get steer(): number {
    if (this.stickId >= 0) return this.stickX;
    return (this.keyR ? 1 : 0) - (this.keyL ? 1 : 0);
  }

  show(on: boolean) {
    this.root.hidden = !on;
  }

  // 毎フレーム: 操作を車へ入れ、カウントダウンと段の溜まり具合を表示する。dt は壁時計の秒
  update(s: CarState, dt: number, racing: boolean) {
    this.now += dt;
    const steer = racing ? this.steer : 0;
    s.rgManual = true;
    s.rgSteer = steer;
    // 短押し式: ドリフトはスティックを同じ向きに倒している間だけ続く
    if (this.tapDrift && (Math.sign(steer) !== this.tapDrift || Math.abs(steer) < 0.3)) this.tapDrift = 0;
    const longBrake = this.brakeDown && (this.mode === 'button' || this.now - this.brakeAt >= rgCfg.driftTap);
    s.rgBraking = racing && longBrake;
    s.rgDrifting = racing && (this.mode === 'button' ? this.driftHeld : this.tapDrift !== 0);
    this.driftBtn.classList.toggle('active', s.rgDrifting);

    // カウントダウン: 2段目は使えるようになる5秒前から、3段目は3秒前から
    const rg = s.t.boost.rg;
    let text = '';
    const fills = [0, 0];
    if (rg && s.rgKick > 0 && s.isBoosting && racing) text = 'DRIFT BOOST!';
    else if (rg && s.isBoosting && racing) {
      const st = s.rgStage;
      for (let k = 0; k < 2; k++) {
        if (k + 2 > rg.stages) continue;
        if (st > k + 1) fills[k] = 1;
        else if (st === k + 1) fills[k] = Math.min(1, s.rgStageTime / rg.unlock[k]);
      }
      if (st < rg.stages && s.rgCharge <= 0) {
        const left = (rg.unlock[st - 1] - s.rgStageTime) / this.simScale;
        const from = rgCfg.countdown[st - 1] ?? 3;
        if (left > 0 && left <= from) text = String(Math.ceil(left));
        else if (left <= 0) text = `BOOST ${st + 1}`;
      }
    }
    this.bars.forEach((b, k) => {
      b.hidden = !rg || k + 2 > rg.stages;
      b.style.setProperty('--f', fills[k].toFixed(3));
      b.classList.toggle('full', fills[k] >= 1);
    });
    this.meter.classList.toggle('live', !!rg && s.isBoosting);
    if (text !== this.lastCount) {
      this.lastCount = text;
      this.count.textContent = text;
      this.count.classList.toggle('go', text.startsWith('BOOST') || text.startsWith('DRIFT'));
      // 数字が変わるたびに弾ませる
      this.count.classList.remove('pop');
      void this.count.offsetWidth;
      if (text) this.count.classList.add('pop');
    }
  }
}
