import cfg from './data/mini.json';
import './mini.css';
import type { CarState } from './car';

// ミニ四駆風モード: 縦画面優先・上からの俯瞰・自動レーン走行。プレイヤーの操作はブーストとEXだけ。
// 既存のレース（クラシック）は既定のまま残し、URL ?mode=mini か、ガレージのモード切替で入る。
const KEY = 'kumitate-racer.mode';
const param = new URLSearchParams(location.search).get('mode');
if (param === 'mini' || param === 'classic') {
  try { localStorage.setItem(KEY, param); } catch { /* 保存できなくても動く */ }
}
const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
export const MINI = (param ?? stored) === 'mini';
export const miniCfg = cfg;

const STAGE_COLOR = ['#ff9a1f', '#3fc8ff', '#ff4fd8'];

export class MiniHud {
  private root = document.createElement('div');
  private pips: HTMLElement[] = [];
  private label = document.createElement('div');
  private chain = document.createElement('i');
  private lastKey = '';
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
      : charge > 0 ? `${next}段目 チャージ` : level > 0 ? `連打で${next}段目！` : '連打でブースト';
    const btn = !racing ? 'GOAL' : !launched ? 'START' : next === 0 ? (s.isBoosting ? `${level}段\nON` : 'BOOST') : `TAP!\n${next}段`;
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
  const b = document.createElement('button');
  b.id = 'mode-switch';
  b.textContent = MINI ? 'モード: ミニ四駆風（縦・俯瞰）' : 'モード: クラシック（横・後方視点）';
  b.addEventListener('click', () => {
    try { localStorage.setItem(KEY, MINI ? 'classic' : 'mini'); } catch { /* */ }
    const u = new URL(location.href);
    u.searchParams.delete('mode');
    location.href = u.toString();
  });
  document.body.appendChild(b);
}
