import { openSoundTest } from './soundTest';
import { DRIVER_ART, faceHtml } from './face';
import { sound } from './sound';
import type { Tuning } from './car';
import { type Build, CATEGORIES, applyCourse, MAX_UPGRADE, STAR, gauge, starOf, partName, applyBuild, buildCost, isTransformBuild, FIXED_TIRE, brandName, canUpgrade, defaultBuild, MOTOR_TUNES, options, part, stats, upgradePrice, type Category, type PartOption } from './setup';
import { CAREER, EVENTS, entryCheck, eventById, prizeRate, type RaceEvent } from './events';
import { courseById } from './courses';
import { PAINTS } from './paint';
import { SLOT_COUNT, isOwned, kitOwned, loadSave, switchSlot, markKit, markOwned, setTune, setUpgrade, tuneOf, upgradeLevel, writeSave } from './save';
import { TESTER, keepQuery } from './storage';

// 大会カードの右上に出すコースの形（上から見た線）。コースごとに1回だけ作る
const iconCache = new Map<string, string>();
function courseIcon(id: string): string {
  const hit = iconCache.get(id);
  if (hit) return hit;
  const pts = courseById(id).points;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
  const k = 26 / Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0, 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) * k + 2).toFixed(1)} ${((p[1] - z0) * k + 2).toFixed(1)}`).join('') + 'Z';
  const svg = `<svg class="cicon" viewBox="0 0 30 30"><path d="${d}"/></svg>`;
  iconCache.set(id, svg);
  return svg;
}

// ガレージ画面: 大会を選び、所持パーツでコスト内のマシンを組む。未所持パーツはここで買う
export class Garage {
  data = loadSave();
  // タッチして見ているパーツ（右の「説明」に出す）。もう一度タッチか［付ける］で付け替える。未所持なら［買って付ける］
  private pick: { cat: Category; id: string } | null = null;
  // 右パネルのページ（性能／説明）
  private sidePage: 'stats' | 'info' = 'stats';
  // いま見ている部品の種類（null=全体）。3D表示のカメラもここに寄る
  focus: Category | null = null;
  // 3D表示への通知: 組み合わせが変わったか、見る場所が変わったか
  onView: (build: Build, changed: boolean, focus: Category | null) => void = () => {};
  // スピード演出（視野角・揺れ・集中線）。酔いやすい人向けに切れる
  // ガレージでブーストの見た目を確かめる（0=OFF, 1=1段目, 2=Wブースト2段目）
  boostPreview = 0;
  private boostTimer: ReturnType<typeof setTimeout> | undefined;
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
        this.pick = null;
      } else if (btn.dataset.maker !== undefined) {
        this.maker = btn.dataset.maker || null;
        this.pick = null;
      } else if (btn.dataset.action === 'fold') {
        this.cardsOpen = !this.cardsOpen;
      } else if (btn.dataset.action === 'stats') {
        this.statsOpen = !this.statsOpen;
      } else if (btn.dataset.event) {
        this.data.event = btn.dataset.event;
      } else if (btn.dataset.cat) {
        const cat = btn.dataset.cat as Category;
        const id = btn.dataset.id!;
        // 1回目のタッチは説明と変更前→変更後を見るだけ。同じパーツをもう一度タッチしたら付ける（持っているときだけ）
        const again = this.pick?.cat === cat && this.pick.id === id;
        this.pick = { cat, id };
        this.sidePage = 'info';
        this.statsOpen = true;
        if (again && isOwned(this.data, cat, id)) this.equip(cat, id);
      } else if (btn.dataset.action === 'equip' && this.pick) {
        const { cat, id } = this.pick;
        if (!isOwned(this.data, cat, id)) {
          const p = part(cat, id);
          if (this.data.coins < p.price) return;
          this.data.coins -= p.price;
          markOwned(this.data, cat, id);
        }
        this.equip(cat, id);
      } else if (btn.dataset.side) {
        this.sidePage = btn.dataset.side as 'stats' | 'info';
        this.statsOpen = true;
      } else if (btn.dataset.action === 'upgrade') {
        const cat = btn.dataset.cat2 as Category;
        const id = this.data.build[cat];
        const next = upgradeLevel(this.data, cat, id) + 1;
        const price = this.data.testMode ? 0 : upgradePrice(cat, id, next);
        if (next > MAX_UPGRADE || this.data.coins < price) return;
        this.data.coins -= price;
        setUpgrade(this.data, cat, id, next);
      } else if (btn.dataset.kit) {
        // チューンキット: 持っていれば今のモーターに付ける。持っていなければ買って付ける
        const kit = MOTOR_TUNES.find((k) => k.id === btn.dataset.kit)!;
        if (!kitOwned(this.data, kit.id)) {
          if (this.data.coins < (kit.price ?? 0)) return;
          this.data.coins -= kit.price ?? 0;
          markKit(this.data, kit.id);
        }
        setTune(this.data, 'motor', this.data.build.motor, kit.id);
      } else if (btn.dataset.action === 'start') {
        el.hidden = true;
        onStart(applyCourse(this.tuning, this.data.build, this.event.course), this.event);
        return;
      } else if (btn.dataset.action === 'boostfx') {
        this.boostPreview = (this.boostPreview + 1) % 3;
        // 3秒たったら自動でOFFに戻す（押し直すとまた3秒）
        clearTimeout(this.boostTimer);
        if (this.boostPreview) {
          this.boostTimer = setTimeout(() => {
            this.boostPreview = 0;
            this.render();
          }, 3000);
        }
      } else if (btn.dataset.action === 'soundtest') {
        openSoundTest();
      } else if (btn.dataset.action === 'sound') {
        sound.setEnabled(!sound.enabled);
      } else if (btn.dataset.action === 'fx') {
        this.fx = !this.fx;
        try {
          localStorage.setItem('kumitate-racer.fx', this.fx ? 'on' : 'off');
        } catch {
          // 保存できなくても切り替えは効く
        }
      } else if (btn.dataset.slot !== undefined) {
        switchSlot(this.data, Number(btn.dataset.slot));
        this.pick = null;
      } else if (btn.dataset.action === 'test') {
        this.data.testMode = !this.data.testMode;
        if (!this.data.testMode) switchSlot(this.data, this.data.slot);
        this.pick = null;
      } else if (btn.dataset.paint !== undefined) {
        this.data.colors[this.data.slot] = Number(btn.dataset.paint);
      } else if (btn.dataset.action === 'reset') {
        this.data.build = defaultBuild();
        this.pick = null;
      }
      writeSave(this.data);
      this.render();
      // タッチして見ているパーツは、3D表示で試しに付けて見せる（付けるまではセーブに入らない）
      const view = this.pick && this.data.build[this.pick.cat] !== this.pick.id ? this.tuningWith(this.pick.cat, this.pick.id).build : this.data.build;
      this.onView(view, JSON.stringify(view) !== before, this.focus);
    });
  }

  private equip(cat: Category, id: string) {
    this.data.build[cat] = id;
    // 変形マシンにしたらカナードは外す（コストにも数えない）
    if (isTransformBuild(this.data.build)) { this.data.build.wingF = 'none'; this.data.build.wingR = 'none'; }
  }

  // 付け替えたらどうなるか（説明ページの変更後の数字用）
  private tuningWith(cat: Category, id: string) {
    const b = { ...this.data.build, [cat]: id };
    if (isTransformBuild(b)) { b.wingF = 'none'; b.wingR = 'none'; }
    return { build: b, tuning: applyBuild(this.base, b, (c, i) => upgradeLevel(this.data, c, i), (c, i) => tuneOf(this.data, c, i)) };
  }

  get tuning() {
    return applyBuild(this.base, this.data.build, (c, id) => upgradeLevel(this.data, c, id), (c, id) => tuneOf(this.data, c, id));
  }

  get event() {
    const ev = eventById(this.data.event);
    return this.unlocked(ev) ? ev : CAREER[0];
  }

  unlocked(ev: RaceEvent) {
    if (this.data.testMode) return true;
    const i = CAREER.indexOf(ev);
    // 1つ前の大会で1位なら解放。後から間に大会を足しても、クリア済みの大会は選べるまま
    return i <= 0 || !!this.data.cleared[CAREER[i - 1].id] || !!this.data.cleared[ev.id];
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

  // 右の「説明」ページ: タッチしたパーツの説明と、今の装着品から付け替えたときの 変更前→変更後
  private infoPage(c: Category, sel: PartOption): string {
    const id = this.pick?.cat === c ? this.pick.id : sel.id;
    const t = part(c, id) as PartOption & { brand?: string; driftStar?: number };
    const owned = isOwned(this.data, c, id);
    const lv = upgradeLevel(this.data, c, id);
    const brand = c === 'chassis' ? brandName(t.brand) : undefined;
    const title = `<p class="ititle"><i class="t-${t.tier}">${starOf(t.tier)}</i><b>${partName(t)}${lv ? ` +${lv}` : ''}</b>${id === sel.id ? '<em>装着中</em>' : ''}</p>`;
    let desc = `<p class="idesc">${brand ? `【${brand}】` : ''}${t.note}`;
    if (c === 'chassis') {
      const star = t.driftStar ?? 0;
      desc += `<br>ドリフト適性 <b class="gauge">${gauge(star)}</b>${star <= 0 ? '（EXドリフトでもほとんど滑らない）' : star >= 3 ? '（コーナー手前でイン側をタップでドリフト姿勢）' : ''}`;
    }
    if (c === 'tireSize' && FIXED_TIRE[this.data.build.chassis]) desc += '<br>今のシャーシは径を選べません（4輪に戻したときに使われます）';
    if (c === 'motor') {
      const kit = MOTOR_TUNES.find((k) => k.id === (tuneOf(this.data, 'motor', id) ?? 'std'))!;
      const pct = (v = 0) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
      desc += `<br>キット ${kit.name}：＋1段ごとに 最高速${pct(kit.rpm)}・加速${pct(kit.torque)}・回復${pct(kit.regen)}`;
    }
    desc += '</p>';
    if (id === sel.id) {
      if (c === 'battery' || c === 'booster' || c === 'motor') {
        const b = this.tuning.boost;
        desc += `<p class="idesc">今のマシン：容量 ${b.gaugeMax}・回復 ${b.regen.toFixed(1)}/秒・ブースト ${Math.round(b.boostCost)}・EX ${this.tuning.ex.cost}</p>`;
      }
      return title + desc;
    }
    // 変更前→変更後（変わる項目だけ）。上がる値は緑▲、下がる値は赤▼。説明文はその下
    const after = this.tuningWith(c, id);
    const now = stats(this.base, this.tuning);
    const next = stats(this.base, after.tuning);
    const cost0 = buildCost(this.data.build).total;
    const cost1 = buildCost(after.build).total;
    const row = (label: string, a: number, b: number, lowerIsBetter = false) => {
      const cls = (b > a) !== lowerIsBetter ? 'up' : 'down';
      return `<div class="cmp ${cls}"><span>${label}</span><b>${a}</b><i>→</i><b>${b}</b><em>${b > a ? '▲' : '▼'}</em></div>`;
    };
    const rows = now.filter((s, i) => s.value !== next[i].value).map((s) => row(s.label, s.value, next[now.indexOf(s)].value));
    if (cost0 !== cost1) rows.push(row('コスト', cost0, cost1, true));
    const st0 = buildCost(this.data.build).star;
    const st1 = buildCost(after.build).star;
    if (st0 !== st1) rows.push(row('マシンの★', st0, st1, true));
    const price = part(c, id).price;
    const can = owned || this.data.coins >= price;
    // 付けると今の大会に出られなくなるなら、付ける前に警告する（付けること自体はできる）
    const ev = this.event;
    const chk = entryCheck(ev, after.build);
    const breaks = !chk.ok && entryCheck(ev, this.data.build).ok;
    const why = [chk.starOver ? `マシンが★${chk.star}になる（★${chk.maxStar}まで）` : '', chk.costOver ? `コストが${chk.total}になる（${ev.costCap}まで）` : ''].filter(Boolean).join('、');
    return title + `<div class="cmps">${rows.join('') || '<p class="idesc">性能の数字は変わりません</p>'}</div>` +
      (breaks ? `<p class="warn">付けると「${ev.name}」に出られなくなります：${why}</p>` : '') +
      `<button data-action="equip" class="equip${breaks ? ' risky' : ''}" ${can ? '' : 'disabled'}>${breaks ? 'それでも' : ''}${owned ? '付ける' : `${price}Gで買って付ける`}</button>` +
      (can ? '' : '<p class="warn">お金が足りない</p>') + desc;
  }

  private render() {
    // 選び直しても横スクロールの位置を保つ
    const tabScroll = this.el.querySelector('.tabs')?.scrollLeft ?? 0;
    const cardScroll = this.el.querySelector('.cards')?.scrollLeft ?? 0;
    const sameFocus = this.el.dataset.focus === (this.focus ?? '');
    this.el.dataset.focus = this.focus ?? '';
    const ev = this.event;
    const course = courseById(ev.course);
    const chk = entryCheck(ev, this.data.build);
    const total = chk.total;
    const overTotal = chk.costOver;
    const rule = ev.free
      ? 'コスト制限なし・賞金なし'
      : `出場条件：マシン★${chk.maxStar}まで・コスト${ev.costCap}まで／賞金 1位 ${Math.round(ev.reward![0] * prizeRate(ev, this.data.cleared))}G` +
        (prizeRate(ev, this.data.cleared) < 1 ? '（格下のため減額）' : '');

    // 上段: 部品の種類（横スクロール）。先頭の「レース」で大会選び
    const tabs = `<div class="slider tabs"><button data-tab="" class="${this.focus ? '' : 'on'}"><span>レース</span></button>` +
      CATEGORIES.filter((c) => !c.hidden).map((c) => `<button data-tab="${c.key}" class="${this.focus === c.key ? 'on' : ''}"><span>${c.label.replace('（EX技）', '')}</span></button>`).join('') + `<button data-action="fold" class="fold"><span>${this.cardsOpen ? '▼' : '▲'}</span></button></div>`;

    // 下段: 選んだ種類のパーツ（または大会）をカードで並べる
    let cards = '';
    let note = '';
    let info = '';
    if (!this.focus) {
      cards = EVENTS.map((e) => {
        const locked = !this.unlocked(e);
        const mark = this.data.cleared[e.id] ? '★ ' : locked ? '🔒 ' : '';
        const mode = e.mode === 'walled' ? '・壁あり' : e.mode === 'laneless' ? '・レーンなし' : '';
        const sub = (e.free ? 'フリー走行' : `${starOf(e.class)}まで・コスト${e.costCap}`) + mode;
        return `<button data-event="${e.id}" class="card t-${e.class ?? 'N'} ${e.id === ev.id ? 'on' : ''}" ${locked ? 'disabled' : ''}>` +
          `${courseIcon(e.course)}<b>${mark}${e.name.replace('フリー走行：', '')}</b><small>${sub}</small></button>`;
      }).join('');
      const modeNote = ev.mode === 'walled' ? '　壁で仕切った3レーン（レーン変更なし、立体交差でレーンが入れ替わる）' : ev.mode === 'laneless' ? '　レーンなし' : '';
      note = `${course.name}（${course.laps ?? 3}周）${rule}${modeNote}`;
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
            `<small>${first.note.split('製。')[1] ?? first.note}</small>${on ? `<em>装着中 ${starOf(sel.tier)}</em>` : ''}</button>`;
        }).join('')
        : (makers.length ? `<button data-maker="" class="card back"><b>◀ 戻る</b><small>${this.maker}</small></button>` : '') +
          list.map((o) => {
        const owned = isOwned(this.data, c, o.id);
        const lv = upgradeLevel(this.data, c, o.id);
        const over = !ev.free && STAR[o.tier] > chk.maxStar;
        const noCanard = (c === 'wingF' || c === 'wingR') && o.id !== 'none' && isTransformBuild(this.data.build);
        const cls = ['card', `t-${o.tier}`, o.id === sel.id ? 'on' : '', owned ? '' : 'locked', over ? 'over' : '',
          this.pick?.cat === c && this.pick.id === o.id && o.id !== sel.id ? 'pick' : ''].join(' ');
        return `<button data-cat="${c}" data-id="${o.id}" class="${cls}" ${noCanard ? 'disabled' : ''}><i>${starOf(o.tier)}</i><b>${partName(o)}${lv ? ` +${lv}` : ''}</b>` +
          `<small>${owned ? `コスト ${o.cost}` : `${o.price}G・コスト ${o.cost}`}</small>${c === 'driver' && faceHtml(o.id) ? `<span class="face">${faceHtml(o.id)}</span>` : ''}</button>`;
          }).join('');
      // 下段は操作だけ（改造・チューンキット）。パーツの説明は右の「説明」ページに出す
      if ((c === 'wingF' || c === 'wingR') && isTransformBuild(this.data.build)) note = '変形マシンはカナードを付けられません（変形翼が代わりに働きます）';
      if (canUpgrade(c, sel.id)) {
        const lv = upgradeLevel(this.data, c, sel.id);
        if (lv < MAX_UPGRADE) {
          const price = this.data.testMode ? 0 : upgradePrice(c, sel.id, lv + 1);
          note += `<span class="shop"><button data-action="upgrade" data-cat2="${c}" ${this.data.coins >= price ? '' : 'disabled'}>${partName(sel)} 改造+${lv + 1}（${price}G）</button></span>`;
        } else {
          note += `${partName(sel)}（改造MAX）`;
        }
      }
      if (c === 'motor') {
        // チューンキット（2層目）: 方向を1つ選ぶ。＋段階がその方向の改造量を決める（＋0では効かない）
        const cur = tuneOf(this.data, 'motor', sel.id) ?? 'std';
        note += `<span class="shop kits">キット：` + MOTOR_TUNES.map((k) => {
          const owned = kitOwned(this.data, k.id);
          return `<button data-kit="${k.id}" class="${k.id === cur ? 'on' : ''}" ${owned || this.data.coins >= (k.price ?? 0) ? '' : 'disabled'}>${k.name}${owned ? '' : `（${k.price}G）`}</button>`;
        }).join('') + `</span>`;
      }
      if (!note) note = '<span class="hint">パーツをタッチすると右に説明。もう一度タッチで付け替え</span>';
      info = this.infoPage(c, sel);
    }

    const bars = stats(this.base, this.tuning)
      .map((s) => `<div class="stat"><span>${s.label}</span><div class="bar"><div style="width:${Math.min(100, s.value / 3)}%"></div></div>` +
        `<b class="${s.value > 100 ? 'up' : s.value < 100 ? 'down' : ''}">${s.value}</b></div>`)
      .join('');
    const warn = [chk.starOver ? `マシンが★${chk.star}（この大会は★${chk.maxStar}まで）` : '', overTotal ? 'コスト上限オーバー' : ''].filter(Boolean).join('・');
    // ドライバー欄を開いているときは、選んだドライバーの立ち絵を左に出す（画像のあるドライバーだけ）
    const art = this.focus === 'driver' ? DRIVER_ART[this.data.build.driver]?.art : undefined;
    this.el.innerHTML = (art ? `<img class="driver-art" src="${art}" alt="">` : '') +
      `<div class="top"><div class="head"><h2>ガレージ</h2>${TESTER ? '<span class="tester">テスト版</span>' : ''}<span class="coins">${this.data.coins}G</span><span class="evname">${ev.name}</span><span class="slots">` +
      Array.from({ length: SLOT_COUNT }, (_, i) => `<button data-slot="${i}" class="${i === this.data.slot ? 'on' : ''}">${i + 1}</button>`).join('') +
      `</span></div>${tabs}</div>` +
      `<div class="side ${this.statsOpen ? '' : 'mini'}"><button data-action="stats" class="cost ${overTotal || chk.starOver ? 'bad' : ''}">★${chk.star} コスト ${total}${ev.costCap !== undefined ? `/${ev.costCap}` : ''}<span>${this.statsOpen ? '性能を畳む ▲' : '性能 ▼'}</span></button>` +
      (this.statsOpen && info ? `<div class="sidetabs"><button data-side="stats" class="${this.sidePage === 'stats' ? 'on' : ''}">性能</button><button data-side="info" class="${this.sidePage === 'info' ? 'on' : ''}">説明</button></div>` : '') +
      (this.statsOpen ? (info && this.sidePage === 'info' ? `<div class="info">${info}</div>` : `${bars}<p class="hint">フルノーマル＝100</p>`) : '') +
      (warn ? `<p class="warn">${warn}</p>` : '') +
      `<button data-action="start" class="start" ${warn && !this.data.testMode ? 'disabled' : ''}>このマシンで走る</button>` +
      `<div class="paint">${PAINTS.map((c, i) => `<button data-paint="${i}" title="${c.name}" class="${this.data.colors[this.data.slot] === i ? 'on' : ''}" style="background:#${c.hex.toString(16).padStart(6, '0')}"></button>`).join('')}</div>` +
      `<div class="tools"><button data-action="reset">初期パーツ</button>` +
      `<button data-action="fx">演出 ${this.fx ? 'ON' : 'OFF'}</button>` +
      `<button data-action="sound">音 ${sound.enabled ? 'ON' : 'OFF'}</button>` +
      `<button data-action="soundtest">🔊 音の調整</button>` +
      `<button data-action="test" class="${this.data.testMode ? 'on' : ''}">全開放 ${this.data.testMode ? 'ON' : 'OFF'}</button></div></div>` +
      `<button data-action="boostfx" class="boostfx s${this.boostPreview}">🔥 ブースト ${['OFF', '1段目', '2段目'][this.boostPreview]}</button>` +
      `<a class="bodyshop" href="${keepQuery('./builder.html')}">🛠 ボディ工房</a>` +
      `<div class="bottom ${this.cardsOpen ? '' : 'folded'}"><div class="slider cards">${cards}</div><div class="note">${note}</div></div>`;
    this.el.querySelector('.tabs')!.scrollLeft = tabScroll;
    const cardsEl = this.el.querySelector('.cards') as HTMLElement;
    if (sameFocus) cardsEl.scrollLeft = cardScroll;
    else (cardsEl.querySelector('.on') as HTMLElement | null)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}
