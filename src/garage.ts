import type { Tuning } from './car';
import { type Build, CATEGORIES, applyCourse, MAX_UPGRADE, TIER_LABEL, applyBuild, buildCost, canUpgrade, defaultBuild, options, part, stats, upgradePrice, type Category, type PartOption } from './setup';
import { CAREER, EVENTS, eventById, prizeRate, type RaceEvent } from './events';
import { courseById } from './courses';
import { SLOT_COUNT, isOwned, loadSave, switchSlot, markOwned, setUpgrade, upgradeLevel, writeSave } from './save';

// ガレージ画面: 大会を選び、所持パーツでコスト内のマシンを組む。未所持パーツはここで買う
export class Garage {
  data = loadSave();
  private shop: { cat: Category; id: string } | null = null;
  // いま見ている部品の種類（null=全体）。3D表示のカメラもここに寄る
  focus: Category | null = null;
  // 3D表示への通知: 組み合わせが変わったか、見る場所が変わったか
  onView: (build: Build, changed: boolean, focus: Category | null) => void = () => {};
  // スピード演出（視野角・揺れ・集中線）。酔いやすい人向けに切れる
  fx = (() => {
    try {
      return localStorage.getItem('kumitate-racer.fx') !== 'off';
    } catch {
      return true;
    }
  })();

  private cardsOpen = true;
  private maker: string | null = null;
  private statsOpen = true;

  constructor(readonly el: HTMLElement, readonly base: Tuning, onStart: (t: Tuning, ev: RaceEvent) => void) {
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || btn.disabled) return;
      const before = JSON.stringify(this.data.build);
      if (btn.dataset.tab !== undefined) {
        const next = (btn.dataset.tab || null) as Category | null;
        // 選択中のタブをもう一度押すと下段を畳む／開く
        this.cardsOpen = next === this.focus ? !this.cardsOpen : true;
        this.focus = next;
        this.maker = null;
        this.shop = null;
      } else if (btn.dataset.maker !== undefined) {
        this.maker = btn.dataset.maker || null;
        this.shop = null;
      } else if (btn.dataset.action === 'fold') {
        this.cardsOpen = !this.cardsOpen;
      } else if (btn.dataset.action === 'stats') {
        this.statsOpen = !this.statsOpen;
      } else if (btn.dataset.event) {
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
        const price = this.data.testMode ? 0 : upgradePrice(cat, id, next);
        if (next > MAX_UPGRADE || this.data.coins < price) return;
        this.data.coins -= price;
        setUpgrade(this.data, cat, id, next);
      } else if (btn.dataset.action === 'start') {
        el.hidden = true;
        onStart(applyCourse(this.tuning, this.data.build, this.event.course), this.event);
        return;
      } else if (btn.dataset.action === 'fx') {
        this.fx = !this.fx;
        try {
          localStorage.setItem('kumitate-racer.fx', this.fx ? 'on' : 'off');
        } catch {
          // 保存できなくても切り替えは効く
        }
      } else if (btn.dataset.slot !== undefined) {
        switchSlot(this.data, Number(btn.dataset.slot));
        this.shop = null;
      } else if (btn.dataset.action === 'test') {
        this.data.testMode = !this.data.testMode;
        if (!this.data.testMode) switchSlot(this.data, this.data.slot);
        this.shop = null;
      } else if (btn.dataset.action === 'reset') {
        this.data.build = defaultBuild();
        this.shop = null;
      }
      writeSave(this.data);
      this.render();
      this.onView(this.data.build, JSON.stringify(this.data.build) !== before, this.focus);
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
    if (this.data.testMode) return true;
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
    this.onView(this.data.build, false, this.focus);
    this.el.hidden = false;
  }

  private render() {
    // 選び直しても横スクロールの位置を保つ
    const tabScroll = this.el.querySelector('.tabs')?.scrollLeft ?? 0;
    const cardScroll = this.el.querySelector('.cards')?.scrollLeft ?? 0;
    const sameFocus = this.el.dataset.focus === (this.focus ?? '');
    this.el.dataset.focus = this.focus ?? '';
    const ev = this.event;
    const course = courseById(ev.course);
    const { total, single } = buildCost(this.data.build);
    const overTotal = ev.costCap !== undefined && total > ev.costCap;
    const overSingle = ev.singleCap !== undefined && single > ev.singleCap;
    const rule = ev.free
      ? 'コスト制限なし・賞金なし'
      : `[${TIER_LABEL[ev.class ?? 'N']}クラス] コスト上限 ${ev.costCap}・単品 ${ev.singleCap}まで／賞金 1位 ${Math.round(ev.reward![0] * prizeRate(ev, this.data.cleared))}G` +
        (prizeRate(ev, this.data.cleared) < 1 ? '（格下のため減額）' : '');

    // 上段: 部品の種類（横スクロール）。先頭の「レース」で大会選び
    const tabs = `<div class="slider tabs"><button data-tab="" class="${this.focus ? '' : 'on'}"><span>レース</span></button>` +
      CATEGORIES.map((c) => `<button data-tab="${c.key}" class="${this.focus === c.key ? 'on' : ''}"><span>${c.label.replace('（EX技）', '')}</span></button>`).join('') + `<button data-action="fold" class="fold"><span>${this.cardsOpen ? '▼' : '▲'}</span></button></div>`;

    // 下段: 選んだ種類のパーツ（または大会）をカードで並べる
    let cards = '';
    let note = '';
    if (!this.focus) {
      cards = EVENTS.map((e) => {
        const locked = !this.unlocked(e);
        const mark = this.data.cleared[e.id] ? '★ ' : locked ? '🔒 ' : '';
        const sub = e.free ? 'フリー走行' : `${TIER_LABEL[e.class ?? 'N']}・上限${e.costCap}`;
        return `<button data-event="${e.id}" class="card t-${e.class ?? 'N'} ${e.id === ev.id ? 'on' : ''}" ${locked ? 'disabled' : ''}>` +
          `<b>${mark}${e.name.replace('フリー走行：', '')}</b><small>${sub}</small></button>`;
      }).join('');
      note = `${course.name}（${course.laps ?? 3}周）${rule}`;
    } else {
      const c = this.focus;
      const sel = part(c, this.data.build[c]);
      // メーカーがあるパーツ（モーター・ブースター）は、まずメーカーを選び、次にランクを選ぶ
      const all = options(c) as (PartOption & { maker?: string })[];
      const makers = [...new Set(all.map((o) => o.maker).filter((m): m is string => !!m))];
      const list = makers.length && this.maker ? all.filter((o) => o.maker === this.maker) : all;
      cards = makers.length && !this.maker
        ? makers.map((m) => {
          const first = all.find((o) => o.maker === m)!;
          const on = (sel as { maker?: string }).maker === m;
          return `<button data-maker="${m}" class="card maker ${on ? 'on' : ''}"><i>${(first as { kind?: string }).kind ?? ''}型</i><b>${m}</b>` +
            `<small>${first.note.split('製。')[1] ?? first.note}</small>${on ? `<em>装着中 ${sel.tier}</em>` : ''}</button>`;
        }).join('')
        : (makers.length ? `<button data-maker="" class="card back"><b>◀ 戻る</b><small>${this.maker}</small></button>` : '') +
          list.map((o) => {
        const owned = isOwned(this.data, c, o.id);
        const lv = upgradeLevel(this.data, c, o.id);
        const over = ev.singleCap !== undefined && o.cost > ev.singleCap;
        const cls = ['card', `t-${o.tier}`, o.id === sel.id ? 'on' : '', owned ? '' : 'locked', over ? 'over' : '',
          this.shop?.cat === c && this.shop.id === o.id ? 'pick' : ''].join(' ');
        return `<button data-cat="${c}" data-id="${o.id}" class="${cls}"><i>${o.tier}</i><b>${this.maker ? `${TIER_LABEL[o.tier]}` : o.name}${lv ? ` +${lv}` : ''}</b>` +
          `<small>${owned ? `コスト ${o.cost}` : `${o.price}G・コスト ${o.cost}`}</small></button>`;
          }).join('');
      note = sel.note;
      if (canUpgrade(c, sel.id)) {
        const lv = upgradeLevel(this.data, c, sel.id);
        if (lv < MAX_UPGRADE) {
          const price = this.data.testMode ? 0 : upgradePrice(c, sel.id, lv + 1);
          note += `<span class="shop"><button data-action="upgrade" data-cat2="${c}" ${this.data.coins >= price ? '' : 'disabled'}>改造+${lv + 1}（${price}G）</button></span>`;
        } else {
          note += '（改造MAX）';
        }
      }
      if (this.shop?.cat === c) {
        const p = part(c, this.shop.id);
        const can = this.data.coins >= p.price;
        note = `<span class="shop">[${TIER_LABEL[p.tier]}] ${p.name}：${p.note}（コスト${p.cost}）` +
          `<button data-action="buy" ${can ? '' : 'disabled'}>${p.price}Gで買う</button>${can ? '' : 'お金が足りない'}</span>`;
      }
    }

    const bars = stats(this.base, this.tuning)
      .map((s) => `<div class="stat"><span>${s.label}</span><div class="bar"><div style="width:${Math.min(100, s.value / 3)}%"></div></div>` +
        `<b class="${s.value > 100 ? 'up' : s.value < 100 ? 'down' : ''}">${s.value}</b></div>`)
      .join('');
    const warn = overTotal ? 'コスト上限オーバー' : overSingle ? `単品コスト${ev.singleCap}を超えるパーツがある` : '';
    this.el.innerHTML =
      `<div class="top"><div class="head"><h2>ガレージ</h2><span class="coins">${this.data.coins}G</span><span class="evname">${ev.name}</span><span class="slots">` +
      Array.from({ length: SLOT_COUNT }, (_, i) => `<button data-slot="${i}" class="${i === this.data.slot ? 'on' : ''}">${i + 1}</button>`).join('') +
      `</span></div>${tabs}</div>` +
      `<div class="side ${this.statsOpen ? '' : 'mini'}"><button data-action="stats" class="cost ${overTotal ? 'bad' : ''}">コスト ${total}${ev.costCap !== undefined ? ` / ${ev.costCap}` : ''}<span>${this.statsOpen ? '性能を畳む ▲' : '性能 ▼'}</span></button>` +
      (this.statsOpen ? `${bars}<p class="hint">フルノーマル＝100</p>` : '') +
      (warn ? `<p class="warn">${warn}</p>` : '') +
      `<button data-action="start" class="start" ${warn && !this.data.testMode ? 'disabled' : ''}>このマシンで走る</button>` +
      `<div class="tools"><button data-action="reset">初期パーツ</button>` +
      `<button data-action="fx">演出 ${this.fx ? 'ON' : 'OFF'}</button>` +
      `<button data-action="test" class="${this.data.testMode ? 'on' : ''}">全開放 ${this.data.testMode ? 'ON' : 'OFF'}</button></div></div>` +
      `<div class="bottom ${this.cardsOpen ? '' : 'folded'}"><div class="slider cards">${cards}</div><div class="note">${note}</div></div>`;
    this.el.querySelector('.tabs')!.scrollLeft = tabScroll;
    const cardsEl = this.el.querySelector('.cards') as HTMLElement;
    if (sameFocus) cardsEl.scrollLeft = cardScroll;
    else (cardsEl.querySelector('.on') as HTMLElement | null)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}
