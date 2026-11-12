import cfg from './data/mini.json';
import './mini.css';
import type { CarState } from './car';
import { PLAY } from './storage';

// 俯瞰モード: 縦画面優先・上からの俯瞰・自動レーン走行。プレイヤーの操作はブーストとEXだけ。
// 既存のレース（クラシック）は既定のまま残し、URL ?mode=mini か、ガレージのモード切替で入る。
const KEY = 'kumitate-racer.mode';
const param = new URLSearchParams(location.search).get('mode');
if (param === 'mini' || param === 'classic') {
  try { localStorage.setItem(KEY, param); } catch { /* 保存できなくても動く */ }
}
const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
// プレビュー配布用: ページ側で window.__defaultMode = 'mini' と書いておくと、保存が無いときの既定になる
const fallback = (globalThis as { __defaultMode?: string }).__defaultMode;
export const MINI = PLAY || (param ?? stored ?? fallback) === 'mini';
export const miniCfg = cfg;

// 俯瞰カメラの種類（レース中のボタンで切り替え、端末に保存）
const CAM_KEY = 'kumitate-racer.cam2'; // 2: 既定を「斜め後ろ」に変えたので、前の選択は引き継がない
const ZOOM_KEY = 'kumitate-racer.camZoom';
const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;
const CAM_MODES = ['diag', 'fixed', 'whole', 'heading', 'onboard'] as const;
const CAM_LABEL = { diag: '📷 斜め後ろ', fixed: '📷 追う', whole: '📷 全体', heading: '📷 進行方向', onboard: '📷 車載' };
export type CamMode = (typeof CAM_MODES)[number];

const STAGE_COLOR = ['#ff9a1f', '#3fc8ff', '#ff4fd8'];

export class MiniHud {
  private root = document.createElement('div');
  private pips: HTMLElement[] = [];
  private label = document.createElement('div');
  private chain = document.createElement('i');
  private lastKey = '';
  camMode: CamMode = cfg.camera.mode as CamMode;
  rate = 1; // 再生速度（1 = 等速）。走行計算は同じまま、時間の進み方だけを遅くする。保存しない（開き直すと等速に戻る）
  camZoom = 1; // カメラの距離の倍率（ホイール・ピンチで変える）
  private span = 1; // 受付時間の最大値（バーの満タン）
  private spanLevel = -1;

  constructor(private boostBtn: HTMLElement) {
    document.body.classList.add('mini');
    this.root.id = 'mini-boost';
    const row = document.createElement('div');
    row.className = 'pips';
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('b');
      p.style.setProperty('--col', STAGE_COLOR[i]);
      p.innerHTML = `<span>${i + 1}</span>`;
      row.appendChild(p);
      this.pips.push(p);
    }
    const bar = document.createElement('div');
    bar.className = 'chain';
    bar.appendChild(this.chain);
    this.label.className = 'label';
    this.root.append(this.label, row, bar);
    document.body.appendChild(this.root);
    try {
      const saved = localStorage.getItem(CAM_KEY) as CamMode | null;
      if (saved && CAM_MODES.includes(saved)) this.camMode = saved;
    } catch { /* */ }
    const cam = document.createElement('button');
    cam.id = 'mini-cam';
    cam.textContent = CAM_LABEL[this.camMode];
    cam.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.camMode = CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length];
      cam.textContent = CAM_LABEL[this.camMode];
      try { localStorage.setItem(CAM_KEY, this.camMode); } catch { /* */ }
    });
    document.body.appendChild(cam);
    // 再生速度: 押すたびに 100 → 50 → 25 → 10% → 100%。コースの確認や動画用のスロー
    const RATES = [1, 0.5, 0.25, 0.1];
    const rate = document.createElement('button');
    rate.id = 'mini-rate';
    rate.textContent = '⏱ 100%';
    rate.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.rate = RATES[(RATES.indexOf(this.rate) + 1) % RATES.length];
      rate.textContent = `⏱ ${Math.round(this.rate * 100)}%`;
      rate.classList.toggle('slow', this.rate < 1);
    });
    document.body.appendChild(rate);
    // カメラの距離: マウスホイール、または画面（ボタン以外）を2本指でつまむ。次回も同じ距離で始まる
    try {
      const z = Number(localStorage.getItem(ZOOM_KEY));
      if (z >= ZOOM_MIN && z <= ZOOM_MAX) this.camZoom = z;
    } catch { /* */ }
    const setZoom = (z: number) => {
      this.camZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      try { localStorage.setItem(ZOOM_KEY, this.camZoom.toFixed(3)); } catch { /* */ }
    };
    window.addEventListener('wheel', (e) => { if ((e.target as HTMLElement)?.tagName === 'CANVAS') setZoom(this.camZoom * Math.exp(e.deltaY * 0.0012)); }, { passive: true });
    const pts = new Map<number, [number, number]>();
    let pinch0 = 0, zoom0 = 1;
    const span = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || (e.target as HTMLElement)?.tagName !== 'CANVAS') return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { pinch0 = span(); zoom0 = this.camZoom; }
    });
    window.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch0 > 10) setZoom((zoom0 * pinch0) / Math.max(10, span()));
    });
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch0 = 0; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // 毎フレーム: 今の段・次の段のチャージ量・受付の残り時間を表示する
  update(s: CarState, racing: boolean, launched: boolean) {
    this.root.hidden = !racing || s.exActive === 'revolver';
    if (s.exActive === 'revolver') { this.lastKey = ''; return; }
    const level = s.boostLevel;
    const next = s.multiNext;
    const charge = s.multiCharge;
    const stages = s.multiStages;
    this.pips.forEach((p, i) => {
      p.hidden = i >= stages;
      const n = i + 1;
      p.classList.toggle('on', n <= Math.max(level, next - 1)); // 切れた直後の受付中も、撃ち終えた段は点けたまま
      p.classList.toggle('now', n === level && s.isBoosting);
      p.classList.toggle('next', n === next);
      p.style.setProperty('--c', n === next ? charge.toFixed(3) : n <= Math.max(level, next - 1) ? '1' : '0');
    });
    // 次の段を受け付ける残り時間（1段目を撃つ前は出さない）
    if (level !== this.spanLevel) {
      this.spanLevel = level;
      this.span = Math.max(0.01, s.chainLeft);
    }
    this.span = Math.max(this.span, s.chainLeft);
    const win = level > 0 && next > 0 ? Math.min(1, s.chainLeft / this.span) : 0;
    this.chain.style.width = `${win * 100}%`;
    this.chain.style.background = STAGE_COLOR[Math.min(2, Math.max(0, next - 1))];
    const text = !racing ? '' : !launched ? '' : s.isOut ? '' : next === 0
      ? (level >= stages && s.isBoosting ? 'MAX!' : level > 0 ? `${level}段目` : 'ゲージ不足')
      : charge > 0 ? `${next}段目 チャージ中…` : level > 0 ? `もう一度押して${next}段目！` : '押してチャージ';
    const btn = !racing ? 'GOAL' : !launched ? 'START' : next === 0 ? (s.isBoosting ? `${level}段\nON` : 'BOOST') : charge > 0 ? 'CHARGE' : `PUSH\n${next}段`;
    const key = text + '|' + btn + '|' + level + '|' + next;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.label.textContent = text;
      this.boostBtn.innerText = btn;
      this.boostBtn.dataset.text = btn;
      this.boostBtn.style.setProperty('--stage', STAGE_COLOR[Math.min(2, Math.max(0, (next || level || 1) - 1))]);
    }
    this.boostBtn.style.setProperty('--c', charge.toFixed(3));
    this.boostBtn.classList.toggle('charging', charge > 0);
    this.boostBtn.classList.toggle('ready', next > 0 && launched);
    this.boostBtn.classList.toggle('active', s.isBoosting && next === 0);
  }
}

// ガレージ画面に出すモード切替（押すと保存して読み込み直す）
export function mountModeSwitch() {
  const box = document.createElement('div');
  box.id = 'mode-switch';
  const b = document.createElement('button');
  b.textContent = MINI ? 'モード: 俯瞰（縦OK）' : 'モード: クラシック';
  b.hidden = PLAY; // テストプレイ用は俯瞰モード固定
  b.addEventListener('click', () => {
    try { localStorage.setItem(KEY, MINI ? 'classic' : 'mini'); } catch { /* */ }
    const u = new URL(location.href);
    u.searchParams.delete('mode');
    location.href = u.toString();
  });
  // コースエディタへの入口
  const a = document.createElement('a');
  a.href = './editor.html';
  a.textContent = '🛣 コースエディタ';
  box.append(b, a);
  if (customCourseOn() && !PLAY) {
    const c = document.createElement('button');
    c.textContent = '✕ 自作コースをやめる';
    c.addEventListener('click', () => {
      try { localStorage.removeItem(USE_CUSTOM_KEY); } catch { /* */ }
      const u = new URL(location.href);
      u.searchParams.delete('course');
      location.href = u.toString();
    });
    box.appendChild(c);
  }
  document.body.appendChild(box);
}

// エディタで作ったコース（?course=custom のときだけ使う）
export const CUSTOM_KEY = 'kumitate-racer.customCourse';
const USE_CUSTOM_KEY = 'kumitate-racer.useCustom';
export function customCourseOn(): boolean {
  try {
    const flagged = new URLSearchParams(location.search).get('course') === 'custom' || localStorage.getItem(USE_CUSTOM_KEY) === '1';
    return flagged && !!localStorage.getItem(CUSTOM_KEY);
  } catch { return false; }
}
