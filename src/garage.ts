import type { Tuning } from './car';
import { CATEGORIES, applyBuild, defaultBuild, options, stats, type Build } from './setup';

const KEY = 'kumitate-racer.build';

function load(): Build {
  const build = defaultBuild();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    for (const c of CATEGORIES) {
      if (options(c.key).some((o) => o.id === saved[c.key])) build[c.key] = saved[c.key];
    }
  } catch {
    // 保存なし・読めないときは標準セッティング
  }
  return build;
}

function save(build: Build) {
  try {
    localStorage.setItem(KEY, JSON.stringify(build));
  } catch {
    // 保存できなくても遊べる
  }
}

// ガレージ画面: パーツを選ぶと右側の性能バーがその場で変わる
export class Garage {
  build = load();

  constructor(readonly el: HTMLElement, readonly base: Tuning, onStart: (t: Tuning) => void) {
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      if (btn.dataset.cat) {
        this.build[btn.dataset.cat as keyof Build] = btn.dataset.id!;
        save(this.build);
        this.render();
      } else if (btn.dataset.action === 'start') {
        el.hidden = true;
        onStart(this.tuning);
      } else if (btn.dataset.action === 'reset') {
        this.build = defaultBuild();
        save(this.build);
        this.render();
      }
    });
  }

  get tuning() {
    return applyBuild(this.base, this.build);
  }

  show() {
    this.render();
    this.el.hidden = false;
  }

  private render() {
    const rows = CATEGORIES.map((c) => {
      const opts = options(c.key);
      const sel = opts.find((o) => o.id === this.build[c.key]) ?? opts[0];
      const chips = opts
        .map((o) => `<button data-cat="${c.key}" data-id="${o.id}" class="${o.id === sel.id ? 'on' : ''}">${o.name}</button>`)
        .join('');
      return `<div class="row"><div class="cat">${c.label}</div><div class="chips">${chips}</div><div class="note">${sel.note}</div></div>`;
    }).join('');
    const bars = stats(this.base, this.tuning)
      .map((s) => `<div class="stat"><span>${s.label}</span><div class="bar"><div style="width:${s.value}%"></div><i></i></div></div>`)
      .join('');
    this.el.innerHTML =
      `<div class="parts"><h2>ガレージ</h2>${rows}</div>` +
      `<div class="side">${bars}<p class="hint">縦線＝標準セッティング</p>` +
      `<button data-action="start" class="start">このマシンで走る</button>` +
      `<button data-action="reset" class="reset">標準に戻す</button></div>`;
  }
}
