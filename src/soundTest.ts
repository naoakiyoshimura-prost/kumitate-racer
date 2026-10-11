import { ENGINE_TYPES, sound } from './sound';

// サウンドテスト: 音の種類と大きさを自分で切り替えて聞き比べる画面（ガレージの「🔊 音の調整」から開く）
let panel: HTMLElement | null = null;
export function openSoundTest() {
  sound.ready(); // 押したタップで音を出せる状態になっている
  panel?.remove();
  panel = document.createElement('div');
  panel.id = 'soundtest';
  const c = sound.cfg;
  const slider = (key: 'engine' | 'slide' | 'master', label: string) =>
    `<label>${label}<input type="range" min="0" max="1.5" step="0.05" value="${c[key]}" data-k="${key}"><b>${Math.round(c[key] * 100)}%</b></label>`;
  panel.innerHTML =
    `<div class="box"><h3>🔊 音の調整</h3>` +
    `<div class="row">モーター音の種類</div><div class="types">` +
    Object.entries(ENGINE_TYPES).map(([id, t]) => `<button data-type="${id}" class="${c.engineType === id ? 'on' : ''}">${t.label}</button>`).join('') +
    `</div>` + slider('engine', 'モーター音の大きさ') + slider('slide', 'スライド音の大きさ') + slider('master', '全体の大きさ') +
    `<div class="row">試しに鳴らす</div><div class="play">` +
    [['engine', 'モーター（加速）'], ['slide', 'スライド'], ['boost', 'ブースト'], ['signal', 'シグナル'], ['rocket', 'ロケット'], ['wall', '壁'], ['landing', '着地'], ['out', 'コースアウト'], ['goal', 'ゴール']]
      .map(([k, l]) => `<button data-play="${k}">${l}</button>`).join('') +
    `</div><button class="close">閉じる</button></div>`;
  document.body.append(panel);
  panel.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.k) return;
    sound.setCfg({ [el.dataset.k]: Number(el.value) });
    el.nextElementSibling!.textContent = `${Math.round(Number(el.value) * 100)}%`;
  });
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.classList.contains('close') || el === panel) {
      panel?.remove();
      panel = null;
      return;
    }
    if (el.dataset.type) {
      sound.setCfg({ engineType: el.dataset.type });
      panel!.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', b === el));
      sound.previewEngine();
    }
    const k = el.dataset.play;
    if (!k) return;
    if (k === 'engine') sound.previewEngine();
    if (k === 'slide') sound.previewSlide();
    if (k === 'boost') sound.boost();
    if (k === 'signal') {
      [0, 800, 1600].forEach((d) => setTimeout(() => sound.redLight(), d));
      setTimeout(() => sound.greenLight(), 2800);
    }
    if (k === 'rocket') sound.rocket();
    if (k === 'wall') sound.wall();
    if (k === 'landing') sound.landing(true);
    if (k === 'out') sound.courseOut();
    if (k === 'goal') sound.goal(true);
  });
}
