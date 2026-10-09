import type { Tuning } from './car';
import { CATEGORIES, MAX_UPGRADE, TIER_LABEL, applyBuild, buildCost, canUpgrade, defaultBuild, options, part, stats, upgradePrice, type Category } from './setup';
import { CAREER, EVENTS, eventById, prizeRate, type RaceEvent } from './events';
import { courseById } from './courses';
import { isOwned, loadSave, markOwned, setUpgrade, upgradeLevel, writeSave } from './save';

// ガレージ画面: 大会を選び、所持パーツでコスト内のマシンを組む。未所持パーツはここで買う
export class Garage {
  data = loadSave();
  private shop: { cat: Category; id: string } | null = null;
  // スピード演出（視野角・揺れ・集中線）。酔いやすい人向けに切れる
  fx = (() => {
    try {
      return localStorage.getItem('kumitate-racer.fx') !== 'off';
    } catch {
      return true;
    }
  })();

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
      } else if (btn.dataset.action === 'upgrade') {
        const cat = btn.dataset.cat2 as Category;
        const id = this.data.build[cat];
        const next = upgradeLevel(this.data, cat, id) + 1;
        const price = upgradePrice(cat, id, next);
        if (next > MAX_UPGRADE || this.data.coins < price) return;
        this.data.coins -= price;
        setUpgrade(this.data, cat, id, next);
      } else if (btn.dataset.action === 'start') {
        el.hidden = true;
        onStart(this.tuning, this.event);
        return;
      } else if (btn.dataset.action === 'fx') {
        this.fx = !this.fx;
        try {
          localStorage.setItem('kumitate-racer.fx', this.fx ? 'on' : 'off');
        } catch {
          // 保存できなくても切り替えは効く
        }
      } else if (btn.dataset.action === 'reset') {
        this.data.build = defaultBuild();
        this.shop = null;
      }
      writeSave(this.data);
      this.render();
    });
  }

  get tuning() {
    return applyBuild(this.base, this.data.build, (c, id) => upgradeLevel(this.data, c, id));
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
    const rate = prizeRate(ev, this.data.cleared);
    const prize = Math.round((ev.reward[position - 1] ?? 0) * rate);
    this.data.coins += prize;
    let text = `賞金 +${prize}G${rate < 1 ? `（格下大会のため×${rate}）` : ''}　所持 ${this.data.coins}G`;
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
      : `[${TIER_LABEL[ev.class ?? 'N']}クラス] コスト上限 ${ev.costCap}・単品 ${ev.singleCap}まで／賞金 1位 ${Math.round(ev.reward![0] * prizeRate(ev, this.data.cleared))}G` +
        (prizeRate(ev, this.data.cleared) < 1 ? '（格下のため減額）' : '');
    const eventRow = `<div class="row course"><div class="cat">レース</div><div class="chips">${eventChips}</div><div class="note">${course.name}（${course.laps ?? 3}周）${rule}</div></div>`;

    const rows = CATEGORIES.map((c) => {
      const opts = options(c.key);
      const sel = part(c.key, this.data.build[c.key]);
      const chips = opts
        .map((o) => {
          const owned = isOwned(this.data, c.key, o.id);
          const cls = [o.id === sel.id ? 'on' : '', owned ? '' : 'locked', ev.singleCap !== undefined && o.cost > ev.singleCap ? 'over' : '',
            this.shop?.cat === c.key && this.shop.id === o.id ? 'pick' : ''].join(' ');
          return `<button data-cat="${c.key}" data-id="${o.id}" class="${cls}"><b>${o.tier}</b>${o.name}${upgradeLevel(this.data, c.key, o.id) ? `+${upgradeLevel(this.data, c.key, o.id)}` : ''}<small>${o.cost}</small></button>`;
        })
        .join('');
      let note = sel.note;
      if (canUpgrade(c.key, sel.id)) {
        const lv = upgradeLevel(this.data, c.key, sel.id);
        if (lv < MAX_UPGRADE) {
          const price = upgradePrice(c.key, sel.id, lv + 1);
          note += `<span class="shop"><button data-action="upgrade" data-cat2="${c.key}" ${this.data.coins >= price ? '' : 'disabled'}>改造+${lv + 1}（${price}G）</button></span>`;
        } else {
          note += '（改造MAX）';
        }
      }
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
      `<button data-action="reset" class="reset">初期パーツに戻す</button>` +
      `<button data-action="fx" class="fx">スピード演出：${this.fx ? 'ON' : 'OFF（酔いやすい人向け）'}</button></div>`;
    this.el.querySelector('.parts')!.scrollTop = scroll;
  }
}
