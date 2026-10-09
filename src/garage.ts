import type { Tuning } from './car';
import { CATEGORIES, applyBuild, defaultBuild, options, stats, type Build } from './setup';
import { COURSES } from './courses';

const KEY = 'kumitate-racer.build';
const COURSE_KEY = 'kumitate-racer.course';

function loadCourse(): string {
  try {
    const id = localStorage.getItem(COURSE_KEY);
    if (COURSES.some((c) => c.id === id)) return id!;
  } catch {
    // 保存なし
  }
  return COURSES[0].id;
}

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

function save(build: Build, course: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(build));
    localStorage.setItem(COURSE_KEY, course);
  } catch {
    // 保存できなくても遊べる
  }
}

// ガレージ画面: パーツを選ぶと右側の性能バーがその場で変わる
export class Garage {
  build = load();
  course = loadCourse();

  constructor(readonly el: HTMLElement, readonly base: Tuning, onStart: (t: Tuning, courseId: string) => void) {
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      if (btn.dataset.course) {
        this.course = btn.dataset.course;
        save(this.build, this.course);
        this.render();
      } else if (btn.dataset.cat) {
        this.build[btn.dataset.cat as keyof Build] = btn.dataset.id!;
        save(this.build, this.course);
        this.render();
      } else if (btn.dataset.action === 'start') {
        el.hidden = true;
        onStart(this.tuning, this.course);
      } else if (btn.dataset.action === 'reset') {
        this.build = defaultBuild();
        save(this.build, this.course);
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
    const course = COURSES.find((c) => c.id === this.course) ?? COURSES[0];
    const courseChips = COURSES.map(
      (c) => `<button data-course="${c.id}" class="${c.id === course.id ? 'on' : ''}">${c.name}</button>`,
    ).join('');
    const courseRow = `<div class="row course"><div class="cat">コース</div><div class="chips">${courseChips}</div><div class="note">${course.note ?? ''}（${course.laps ?? 3}周）</div></div>`;
    const rows = courseRow + CATEGORIES.map((c) => {
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
