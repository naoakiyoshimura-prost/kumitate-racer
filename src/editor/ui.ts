// コースエディタの画面。幾何は geom.ts、寸法は catalog.ts、ゲームへの書き出しは export.ts。
import type { Built, Layout, LaneCount, PieceSpec, PieceType } from './types';
import { CATALOG, dim } from './catalog';
import { build, pieceLabel, emptyLayout, sampleOval, right } from './geom';
import { toCourse } from './export';
import { View2D, TYPE_COLOR, type AddMode } from './view2d';
import { View3D } from './view3d';
import type { SourceKind } from './types';

void dim;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'kumitate-racer.courses.v1';
const CUSTOM_KEY = 'kumitate-racer.customCourse';

// ---------- 保存 ----------
interface Store { version: 1; slots: (Layout | null)[]; draft: Layout }
const TYPES: PieceType[] = ['straight', 'corner', 'wave', 'laneChange', 'slopeUp', 'slopeDown', 'bankIn', 'bankOut'];

function validLayout(x: unknown): Layout | null {
  const o = x as Layout;
  if (!o || typeof o !== 'object' || o.version !== 1 || (o.lanes !== 3 && o.lanes !== 5) || !Array.isArray(o.pieces)) return null;
  const pieces: PieceSpec[] = [];
  for (const p of o.pieces) {
    if (!p || !TYPES.includes(p.type)) return null;
    const s: PieceSpec = { type: p.type };
    if (p.type === 'straight') s.frac = p.frac === 0.5 || p.frac === 0.25 ? p.frac : 1;
    if (p.type === 'corner') s.dir = p.dir === 'R' ? 'R' : 'L';
    if (p.type === 'wave' && p.flip) s.flip = true;
    pieces.push(s);
  }
  return { version: 1, name: typeof o.name === 'string' ? o.name.slice(0, 40) : 'コース', lanes: o.lanes, pieces };
}
function loadStore(): Store {
  const fresh = (): Store => ({ version: 1, slots: [null, null, null, null, null], draft: sampleOval(3) });
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const j = JSON.parse(raw);
    if (!j || j.version !== 1 || !Array.isArray(j.slots)) return fresh();
    const draft = validLayout(j.draft);
    if (!draft) return fresh();
    const slots: (Layout | null)[] = [];
    for (let i = 0; i < 5; i++) slots.push(j.slots[i] ? validLayout(j.slots[i]) : null);
    return { version: 1, slots, draft };
  } catch { return fresh(); }
}
function saveStore() {
  store.draft = layout;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* 保存できなくても動かす */ }
}

// ---------- 状態 ----------
const store = loadStore();
let layout: Layout = store.draft;
let built: Built;
let selected = -1;
let mode: AddMode = 'end';
let viewKind: '2d' | '3d' = '2d';
let undoStack: string[] = [];
let redoStack: string[] = [];
let msgIdx = 0;
let lastMsgKey = '';
let dirty3d = true;

const view2d = new View2D($('c2d') as HTMLCanvasElement, (i) => { selected = i; refresh(false); });
const view3d = new View3D($('c3d'));

function commit(mut: () => void) {
  undoStack.push(JSON.stringify(layout));
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  mut();
  refresh(true);
}
function restore(json: string) { layout = JSON.parse(json) as Layout; }

// ---------- 部品パレット ----------
interface PalItem { name: string; spec: PieceSpec; svg: string }
const P = (d: string, w = 5, extra = '') => `<path d="${d}" fill="none" stroke-width="${w}" ${extra}/>`;
const PALETTE: PalItem[] = [
  { name: '直線1', spec: { type: 'straight', frac: 1 }, svg: P('M2 10H30') },
  { name: '直線1/2', spec: { type: 'straight', frac: 0.5 }, svg: P('M9 10H23') },
  { name: '直線1/4', spec: { type: 'straight', frac: 0.25 }, svg: P('M13 10H19') },
  { name: '左45°', spec: { type: 'corner', dir: 'L' }, svg: P('M3 16H12Q22 16 28 5') },
  { name: '右45°', spec: { type: 'corner', dir: 'R' }, svg: P('M3 4H12Q22 4 28 15') },
  { name: 'ウェーブ', spec: { type: 'wave' }, svg: P('M2 10C8 2 12 2 16 10S24 18 30 10') },
  { name: 'ウェーブ反転', spec: { type: 'wave', flip: true }, svg: P('M2 10C8 18 12 18 16 10S24 2 30 10') },
  { name: 'レーンチェンジ', spec: { type: 'laneChange' }, svg: P('M2 5H8L24 15H30', 3) + P('M2 15H8L24 5H30', 3) },
  { name: '上りスロープ', spec: { type: 'slopeUp' }, svg: '<path d="M2 17L30 17L30 4Z" stroke="none"/>' },
  { name: '下りスロープ', spec: { type: 'slopeDown' }, svg: '<path d="M2 4L2 17L30 17Z" stroke="none"/>' },
  { name: 'バンク入口', spec: { type: 'bankIn' }, svg: P('M2 15H10L30 5') },
  { name: 'バンク戻り', spec: { type: 'bankOut' }, svg: P('M2 5L22 15H30') },
];
const pal = $('palette');
PALETTE.forEach((it, k) => {
  const b = document.createElement('button');
  b.innerHTML = `<svg viewBox="0 0 32 20" stroke="${TYPE_COLOR[it.spec.type]}" fill="${TYPE_COLOR[it.spec.type]}">${it.svg}</svg><span>${it.name}</span>`;
  b.title = it.name; b.dataset.k = String(k);
  b.onclick = () => addPiece(it.spec);
  pal.appendChild(b);
});

function addPiece(spec: PieceSpec) {
  const s: PieceSpec = { ...spec };
  commit(() => {
    if (mode === 'start') { layout.pieces.unshift(s); selected = 0; }
    else if (mode === 'insert' && selected >= 0) { layout.pieces.splice(selected + 1, 0, s); selected = selected + 1; }
    else { layout.pieces.push(s); selected = layout.pieces.length - 1; }
  });
}

// ---------- 操作 ----------
$('delBtn').onclick = () => {
  if (selected < 0) return;
  commit(() => { layout.pieces.splice(selected, 1); selected = Math.min(selected, layout.pieces.length - 1); });
};
$('flipBtn').onclick = () => {
  const p = layout.pieces[selected];
  if (!p || (p.type !== 'corner' && p.type !== 'wave')) return;
  commit(() => {
    if (p.type === 'corner') p.dir = p.dir === 'R' ? 'L' : 'R';
    else p.flip = !p.flip;
  });
};
$('undoBtn').onclick = () => {
  const j = undoStack.pop(); if (j == null) return;
  redoStack.push(JSON.stringify(layout)); restore(j); refresh(true);
};
$('redoBtn').onclick = () => {
  const j = redoStack.pop(); if (j == null) return;
  undoStack.push(JSON.stringify(layout)); restore(j); refresh(true);
};
$('runBtn').onclick = () => {
  if (!built.check.closed) return;
  try {
    const course = toCourse(layout, 'custom');
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(course));
    // URLの印が落ちる環境（埋め込み表示など）でも自作コースで走れるよう、保存にも印を残す
    try { localStorage.setItem('kumitate-racer.useCustom', '1'); localStorage.setItem('kumitate-racer.mode', 'mini'); } catch { /* */ }
    location.href = './index.html?mode=mini&course=custom';
  } catch (e) {
    alert('ゲームに渡せませんでした: ' + (e instanceof Error ? e.message : String(e)));
  }
};
$('modeSeg').onclick = (e) => {
  const m = (e.target as HTMLElement).closest('button')?.dataset.mode as AddMode | undefined;
  if (m) { mode = m; refresh(false); }
};
$('laneSeg').onclick = (e) => {
  const n = Number((e.target as HTMLElement).closest('button')?.dataset.lanes) as LaneCount;
  if ((n === 3 || n === 5) && n !== layout.lanes) commit(() => { layout.lanes = n; });
};
$('viewSeg').onclick = (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.view as '2d' | '3d' | undefined;
  if (v) setView(v);
};
$('fitBtn').onclick = () => (viewKind === '2d' ? view2d.resetView() : view3d.resetView());
$('nameBtn').onclick = () => {
  const n = prompt('コース名', layout.name);
  if (n != null && n.trim() && n.trim() !== layout.name) commit(() => { layout.name = n.trim().slice(0, 40); });
};
$('stMsg').onclick = () => {
  const ms = msgs();
  if (!ms.length) return;
  msgIdx = (msgIdx + 1) % ms.length;
  const m = ms[msgIdx];
  if (m.piece != null && m.piece >= 0 && m.piece < layout.pieces.length) selected = m.piece;
  refresh(false);
};
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
  if (e.key === 'Delete' || e.key === 'Backspace') $('delBtn').click();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? 'redoBtn' : 'undoBtn').click(); }
});

function setView(v: '2d' | '3d') {
  viewKind = v;
  $('c2d').hidden = v !== '2d';
  $('c3d').hidden = v !== '3d';
  view2d.visible = v === '2d'; view3d.visible = v === '3d';
  if (v === '2d') { view2d.resize(); }
  else { view3d.resize(); if (dirty3d) { view3d.setData(built, layout.lanes, selected); dirty3d = false; } view3d.requestRender(); }
  refresh(false);
}

// ---------- 状態の帯 ----------
function msgs() { return built.check.messages.filter((m) => m.level !== 'ok'); }
const heading = (f: number[]) => Math.atan2(f[0], -f[2]) * 180 / Math.PI;
const norm = (d: number) => { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };

function updateStatus() {
  const c = built.check, pl = built.placed;
  const el = $('stClosed');
  if (pl.length === 0) { el.className = ''; el.textContent = '部品がありません。下のボタンで追加してください'; }
  else if (c.closed) {
    el.className = 'ok';
    el.textContent = `✔ 周回OK　1周 ${(c.totalLengthMm / 1000).toFixed(2)}m　レーンずれ${c.laneShift}（${c.lapsToReturn}周で戻る）`;
  } else {
    el.className = 'ng';
    el.textContent = `✖ 未接続 あと${Math.round(c.gapMm)}mm 向き${Math.round(c.headingDeg)}° 高さ${Math.round(c.heightMm)}mm${c.tiltDeg > 0.5 ? ' 傾き' + Math.round(c.tiltDeg) + '°' : ''}`;
  }
  const p = pl[selected];
  if (p) {
    const e = p.end, r = right(e);
    const tilt = Math.atan2(e.u[0] * r[0] + e.u[1] * r[1] + e.u[2] * r[2], e.u[1]) * 180 / Math.PI;
    const h0 = pl.length ? heading(pl[0].start.f) : 0;
    $('stSel').textContent = `選択 ${p.index + 1}番 ${pieceLabel(p.spec)}　出口 向き${Math.round(norm(heading(e.f) - h0))}°・高さ${Math.round(e.p[1])}mm・傾き${Math.round(tilt)}°`;
  } else $('stSel').textContent = pl.length ? '部品をタップすると選べます' : '';
  const ms = msgs(), key = ms.map((m) => m.text).join('|');
  if (key !== lastMsgKey) { lastMsgKey = key; msgIdx = 0; }
  const mb = $('stMsg');
  if (!ms.length) mb.hidden = true;
  else {
    msgIdx = Math.min(msgIdx, ms.length - 1);
    const m = ms[msgIdx];
    mb.hidden = false; mb.className = m.level;
    mb.textContent = `${m.level === 'error' ? '⛔' : '⚠'} ${msgIdx + 1}/${ms.length} ${m.text}${ms.length > 1 ? '（タップで次）' : ''}`;
  }
}

// ---------- 再描画 ----------
function refresh(layoutChanged: boolean) {
  if (layoutChanged || !built) {
    try { built = build(layout); } catch (e) { console.error(e); built = built ?? { placed: [], check: { closed: false, gapMm: 0, headingDeg: 0, heightMm: 0, tiltDeg: 0, laneShift: 0, lapsToReturn: 1, totalLengthMm: 0, overlaps: [], underground: [], messages: [] } }; }
    if (selected >= layout.pieces.length) selected = layout.pieces.length - 1;
    saveStore();
    dirty3d = true;
  }
  view2d.setData(built, layout.lanes, selected, mode);
  if (viewKind === '3d') {
    if (dirty3d) { view3d.setData(built, layout.lanes, selected); dirty3d = false; } else view3d.setSelected(selected);
  }
  $('nameBtn').textContent = layout.name;
  $('hint').hidden = layout.pieces.length > 0;
  document.querySelectorAll<HTMLElement>('#laneSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.lanes) === layout.lanes));
  document.querySelectorAll<HTMLElement>('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === viewKind));
  document.querySelectorAll<HTMLElement>('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const p = layout.pieces[selected];
  ($('delBtn') as HTMLButtonElement).disabled = !p;
  ($('flipBtn') as HTMLButtonElement).disabled = !p || (p.type !== 'corner' && p.type !== 'wave');
  ($('undoBtn') as HTMLButtonElement).disabled = undoStack.length === 0;
  ($('redoBtn') as HTMLButtonElement).disabled = redoStack.length === 0;
  const run = $('runBtn') as HTMLButtonElement;
  run.disabled = !built.check.closed || layout.pieces.length === 0;
  run.title = run.disabled ? '周回がつながると走れます' : '';
  updateStatus();
}

// ---------- メニュー・シート ----------
const sheet = $('sheet'), sheetBody = $('sheetBody');
function openSheet(title: string, fill: (body: HTMLElement) => void) {
  $('sheetTitle').textContent = title; sheetBody.innerHTML = ''; fill(sheetBody); sheet.hidden = false; sheetBody.scrollTop = 0;
}
const closeSheet = () => { sheet.hidden = true; };
$('sheetClose').onclick = closeSheet;
sheet.addEventListener('pointerdown', (e) => { if (e.target === sheet) closeSheet(); });
function btn(text: string, fn: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.className = 'item ' + cls; b.innerHTML = text; b.onclick = fn; return b;
}
function setLayout(l: Layout) {
  commit(() => { layout = JSON.parse(JSON.stringify(l)); selected = -1; });
  view2d.resetView(); view3d.resetView();
}
const slotLabel = (l: Layout | null, i: number) => `<span>枠${i + 1}　${l ? l.name : '（空）'}</span><small>${l ? `${l.lanes}レーン・${l.pieces.length}個` : ''}</small>`;

function menuMain() {
  openSheet('メニュー', (b) => {
    b.append(
      btn('新規（空のコース）', () => { if (!layout.pieces.length || confirm('今のコースを消して新規にします。よいですか？（「戻す」で戻せます）')) { setLayout(emptyLayout(layout.lanes)); closeSheet(); } }),
      btn('見本を読み込む（周回できる楕円）', () => { setLayout(sampleOval(layout.lanes)); closeSheet(); }),
      btn('保存枠から読む', menuLoad),
      btn('保存枠に保存', menuSave),
      btn('JSON書き出し・読み込み', menuJson),
      btn('寸法表を見る', menuDims),
      btn('ゲームへ戻る', () => { location.href = './index.html'; }),
    );
  });
}
function menuLoad() {
  openSheet('保存枠から読む', (b) => {
    store.slots.forEach((l, i) => { const x = btn(slotLabel(l, i), () => { if (l) { setLayout(l); closeSheet(); } }); x.disabled = !l; b.append(x); });
    b.append(btn('← メニューへ', menuMain));
  });
}
function menuSave() {
  openSheet('保存枠に保存', (b) => {
    store.slots.forEach((l, i) => b.append(btn(slotLabel(l, i), () => {
      if (l && !confirm(`枠${i + 1}「${l.name}」を上書きします。よいですか？`)) return;
      store.slots[i] = JSON.parse(JSON.stringify(layout)); saveStore(); menuSave();
    })));
    b.append(btn('← メニューへ', menuMain));
  });
}
function menuJson() {
  openSheet('JSON書き出し・読み込み', (b) => {
    const ta = document.createElement('textarea'); ta.value = JSON.stringify(layout, null, 1); ta.spellcheck = false;
    const note = document.createElement('small');
    note.textContent = '上は今のコース。貼り付けて「この内容を読み込む」で置き換えられます。';
    const row = document.createElement('div'); row.className = 'btns';
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    file.onchange = async () => { const f = file.files?.[0]; if (f) { ta.value = await f.text(); note.textContent = 'ファイルを読み込みました。「この内容を読み込む」を押してください。'; } };
    row.append(
      btn('コピー', async () => { try { await navigator.clipboard.writeText(ta.value); note.textContent = 'コピーしました。'; } catch { ta.select(); note.textContent = '選択しました。コピーしてください。'; } }),
      btn('ファイルに保存', () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ta.value], { type: 'application/json' }));
        a.download = (layout.name || 'course') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }),
      btn('ファイルを選ぶ', () => file.click()),
      btn('この内容を読み込む', () => {
        try {
          const l = validLayout(JSON.parse(ta.value));
          if (!l) throw new Error('形式が違います');
          setLayout(l); closeSheet();
        } catch (e) { note.textContent = '読み込めません: ' + (e instanceof Error ? e.message : String(e)); }
      }),
    );
    b.append(ta, note, row, file, btn('← メニューへ', menuMain));
  });
}
const SRC: Record<SourceKind, string> = { official: '公式', measured: '実測', estimated: '推定', provisional: '仮' };
function menuDims() {
  openSheet('寸法表', (b) => {
    const lg = document.createElement('div');
    lg.innerHTML = (Object.keys(SRC) as SourceKind[]).map((k) => `<span class="badge ${k}">${SRC[k]}</span>`).join(' ') + ' <small>出典の区分</small>';
    b.append(lg);
    for (const lanes of [3, 5] as LaneCount[]) {
      const h = document.createElement('h4'); h.textContent = `${lanes}レーン`;
      const w = document.createElement('div'); w.className = 'tablewrap';
      const rows = Object.entries(CATALOG[lanes] ?? {}).map(([k, d]) =>
        `<tr><td>${esc(k)}</td><td class="num">${d.value}${d.unit === 'deg' ? '°' : 'mm'}</td><td><span class="badge ${d.source}">${SRC[d.source]}</span></td><td class="note">${esc(d.note)}</td></tr>`).join('');
      w.innerHTML = `<table class="dims"><tr><th>項目</th><th>値</th><th>出典</th><th>根拠</th></tr>${rows}</table>`;
      b.append(h, w);
    }
    b.append(btn('← メニューへ', menuMain));
  });
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
$('menuBtn').onclick = menuMain;

// ---------- 起動 ----------
refresh(true);
setView('2d');
(window as unknown as { __editor: unknown }).__editor = { get layout() { return layout; }, get built() { return built; } };
