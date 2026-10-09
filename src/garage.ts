import type { Tuning } from './car';
import { CATEGORIES, TIER_LABEL, applyBuild, buildCost, defaultBuild, options, part, stats, type Build, type Category } from './setup';
import { CAREER, EVENTS, eventById, type RaceEvent } from './events';
import { courseById } from './courses';
import { isOwned, loadSave, markOwned, writeSave } from './save';

// ガレージ画面: 大会を選び、所持パーツでコスト内のマシンを組む。未所持パーツはここで買う
export class Garage {
  data = loadSave();
  private shop: { cat: Category; id: string } | null = null;

  constructor(readonly el: HTMLElement, readonly base: Tuning, onStart: (t: Tuning, ev: RaceEvent) => void) {
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || btn.disabled) return;
      if (btn.dataset.event) {
        this.data.event = btn.dataset.event;
      } else if (btn.dataset.cat) {
        const cat = btn.dataset.cat as Category;
        const id = btn.dataset.id!;
        if (isOwned(this.data, cat, id)) {
          this.data.build[cat] = id;
          this.shop = null;
        } else {
          this.shop = { cat, id };
        }
      } else if (btn.dataset.action === 'buy' && this.shop) {
        const p = part(this.shop.cat, this.shop.id);
        if (this.data.coins < p.price) return;
        this.data.coins -= p.price;
        markOwned(this.data, this.shop.cat, this.shop.id);
        this.data.build[this.shop.cat] = this.shop.id;
        this.shop = null;
      } else if (btn.dataset.action === 'start') {
        el.hidden = true;
        onStart(this.tuning, this.event);
        return;
      } else if (btn.dataset.action === 'reset') {
        this.data.build = defaultBuild();
        this.shop = null;
      }
      writeSave(this.data);
      this.render();
    });
  }

  get tuning() {
    return applyBuild(this.base, this.data.build);
  }

  get event() {
    const ev = eventById(this.data.event);
    return this.unlocked(ev) ? ev : CAREER[0];
  }

  unlocked(ev: RaceEvent) {
    const i = CAREER.indexOf(ev);
    return i <= 0 || !!this.data.cleared[CAREER[i - 1].id];
  }

  // レース結果を反映。賞金と、1位なら次の大会の解放
  finish(ev: RaceEvent, position: number): string {
    if (ev.free || !ev.reward) return 'フリー走行（賞金なし）';
    const prize = ev.reward[position - 1] ?? 0;
    this.data.coins += prize;
    let text = `賞金 +${prize}G（所持 ${this.data.coins}G）`;
    if (position === 1 && !this.data.cleared[ev.id]) {
      this.data.cleared[ev.id] = true;
      const next = CAREER[CAREER.indexOf(ev) + 1];
      if (next) text += `　「${next.name}」解放！`;
    }
    writeSave(this.data);
    return text;
  }

  show() {
    this.render();
    this.el.hidden = false;
  }

  private render() {
    // 選び直しても一覧のスクロール位置を保つ
    const scroll = this.el.querySelector('.parts')?.scrollTop ?? 0;
    const ev = this.event;
    const course = courseById(ev.course);
    const { total, single } = buildCost(this.data.build);
    const overTotal = ev.costCap !== undefined && total > ev.costCap;
    const overSingle = ev.singleCap !== undefined && single > ev.singleCap;

    const eventChips = EVENTS.map((e) => {
      const locked = !this.unlocked(e);
      const mark = this.data.cleared[e.id] ? '★' : locked ? '🔒' : '';
      return `<button data-event="${e.id}" class="${e.id === ev.id ? 'on' : ''}" ${locked ? 'disabled' : ''}>${mark}${e.name}</button>`;
    }).join('');
    const rule = ev.free
      ? 'コスト制限なし・賞金なし'
      : `コスト上限 ${ev.costCap}・単品 ${ev.singleCap}まで／賞金 1位 ${ev.reward![0]}G・2位 ${ev.reward![1]}G`;
    const eventRow = `<div class="row course"><div class="cat">レース</div><div class="chips">${eventChips}</div><div class="note">${course.name}（${course.laps ?? 3}周）${rule}</div></div>`;

    const rows = CATEGORIES.map((c) => {
      const opts = options(c.key);
      const sel = part(c.key, this.data.build[c.key]);
      const chips = opts
        .map((o) => {
          const owned = isOwned(this.data, c.key, o.id);
          const cls = [o.id === sel.id ? 'on' : '', owned ? '' : 'locked', ev.singleCap !== undefined && o.cost > ev.singleCap ? 'over' : '',
            this.shop?.cat === c.key && this.shop.id === o.id ? 'pick' : ''].join(' ');
          return `<button data-cat="${c.key}" data-id="${o.id}" class="${cls}"><b>${o.tier}</b>${o.name}<small>${o.cost}</small></button>`;
        })
        .join('');
      let note = sel.note;
      if (this.shop?.cat === c.key) {
        const p = part(c.key, this.shop.id);
        const can = this.data.coins >= p.price;
        note = `<span class="shop">[${TIER_LABEL[p.tier]}] ${p.name}：${p.note}（コスト${p.cost}）` +
          `<button data-action="buy" ${can ? '' : 'disabled'}>${p.price}Gで買う</button>${can ? '' : 'お金が足りない'}</span>`;
      }
      return `<div class="row"><div class="cat">${c.label}</div><div class="chips">${chips}</div><div class="note">${note}</div></div>`;
    }).join('');

    const bars = stats(this.base, this.tuning)
      .map((s) => `<div class="stat"><span>${s.label}</span><div class="bar"><div style="width:${s.value}%"></div><i></i></div></div>`)
      .join('');
    const warn = overTotal ? 'コスト上限オーバー' : overSingle ? `単品コスト${ev.singleCap}を超えるパーツがある` : '';
    this.el.innerHTML =
      `<div class="parts"><h2>ガレージ <span class="coins">${this.data.coins}G</span></h2>${eventRow}${rows}</div>` +
      `<div class="side"><div class="cost ${overTotal ? 'bad' : ''}">コスト ${total}${ev.costCap !== undefined ? ` / ${ev.costCap}` : ''}</div>${bars}` +
      `<p class="hint">縦線＝初期マシン　チップ右の数字＝コスト</p>` +
      (warn ? `<p class="warn">${warn}</p>` : '') +
      `<button data-action="start" class="start" ${warn ? 'disabled' : ''}>このマシンで走る</button>` +
      `<button data-action="reset" class="reset">初期パーツに戻す</button></div>`;
    this.el.querySelector('.parts')!.scrollTop = scroll;
  }
}
