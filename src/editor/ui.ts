// コースエディタの画面。幾何は geom.ts、寸法は catalog.ts、ゲームへの書き出しは export.ts。
import type { Built, Layout, LaneCount, PieceSpec } from './types';
import { CATALOG, dim, dimKey, validDimValue } from './catalog';
import { build, pieceLabel, emptyLayout, sampleOval, sampleBankValley, canAddPiece, mirrorLayout, reverseLayout, parseLayout, bankDims, slopeDims } from './geom';
import { toCourse, bankDeg } from './export';
import { View2D, TYPE_COLOR, type AddMode } from './view2d';
import { View3D } from './view3d';
import type { SourceKind, Dim } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'kumitate-racer.courses.v1';
const CUSTOM_KEY = 'kumitate-racer.customCourse';

// ---------- 保存 ----------
interface Store { version: 1; slots: (Layout | null)[]; draft: Layout }
// 読み込みは geom.ts parseLayout（旧部品 bankIn / bankOut は直線1枚に、F12 の bankUp / bankDown はバンクアプローチ1枚に置き換える）。
// 置き換えた数は起動時・JSON読み込み時に知らせる
let legacyOnLoad = 0;
let legacyBankOnLoad = 0;
function validLayout(x: unknown): Layout | null {
  const r = parseLayout(x);
  if (!r) return null;
  legacyOnLoad += r.legacy;
  legacyBankOnLoad += r.legacyBank;
  return r.layout;
}
const LEGACY_MSG = (n: number, nb: number) =>
  [
    n ? `廃止した旧バンク部品（横に傾くバンク）${n}個を直線1枚に置き換えました` : '',
    nb ? `廃止したバンク上り・下り${nb}個をバンクアプローチ1枚ずつに置き換えました（形が変わるので周回が閉じなくなることがあります）` : '',
  ].filter(Boolean).join('。');
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
const legacyAtStart = legacyOnLoad;
const legacyBankAtStart = legacyBankOnLoad;
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
  { name: 'スタート', spec: { type: 'start' }, svg: P('M2 10H30') + '<path d="M20 3V17" stroke-width="4" stroke="#fff" fill="none"/><path d="M20 3V17" stroke-width="4" stroke="#111" fill="none" stroke-dasharray="3 3"/>' },
  { name: '直線1', spec: { type: 'straight', frac: 1 }, svg: P('M2 10H30') },
  { name: '直線1/2', spec: { type: 'straight', frac: 0.5 }, svg: P('M9 10H23') },
  { name: '直線1/4', spec: { type: 'straight', frac: 0.25 }, svg: P('M13 10H19') },
  { name: '左45°', spec: { type: 'corner', dir: 'L' }, svg: P('M3 16H12Q22 16 28 5') },
  { name: '右45°', spec: { type: 'corner', dir: 'R' }, svg: P('M3 4H12Q22 4 28 15') },
  { name: 'ウェーブ', spec: { type: 'wave' }, svg: P('M2 10C6 4 10 4 13 10S19 16 22 10S27 6 30 10') },
  { name: 'ウェーブ反転', spec: { type: 'wave', flip: true }, svg: P('M2 10C6 16 10 16 13 10S19 4 22 10S27 14 30 10') },
  { name: 'レーンチェンジ', spec: { type: 'laneChange' }, svg: P('M2 5H8L24 15H30', 3) + P('M2 15H8L24 5H30', 3) },
  { name: '上りスロープ', spec: { type: 'slopeUp' }, svg: '<path d="M2 17L30 17L30 4Z" stroke="none"/>' },
  { name: '下りスロープ', spec: { type: 'slopeDown' }, svg: '<path d="M2 4L2 17L30 17Z" stroke="none"/>' },
  // バンクアプローチ: 下から上へ反り上がる円弧（へこむ向き）
  { name: 'バンク', spec: { type: 'bankApproach' }, svg: '<path d="M2 17H8Q24 17 30 5V17Z" stroke="none"/>' },
  { name: '30°バンク', spec: { type: 'bankApproach', deg: 30 }, svg: '<path d="M2 17H8Q22 17 26 2H30V17Z" stroke="none"/>' },
];
const pal = $('palette');
PALETTE.forEach((it, k) => {
  const b = document.createElement('button');
  b.innerHTML = `<svg viewBox="0 0 32 20" stroke="${TYPE_COLOR[it.spec.type]}" fill="${TYPE_COLOR[it.spec.type]}">${it.svg}</svg><span>${it.name}</span>`;
  b.title = it.name; b.dataset.k = String(k);
  if (it.spec.deg === 30) b.title = '30度バンク（部品の大きさは20度と同じで、路面を上へ30度曲げる。傾いた面で180度回ってからもう1枚で水平に戻る。仮の部品）';
  else if (it.spec.type === 'bankApproach') b.title = 'バンクアプローチ（路面を上へ20度曲げる。2枚で40度。傾いた面で180度回ってからもう1枚で水平に戻る）';
  b.onclick = () => addPiece(it.spec);
  pal.appendChild(b);
});

let toastTimer = 0;
function toast(text: string) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, 3200);
}

function addPiece(spec: PieceSpec) {
  const why = canAddPiece(layout, spec);
  if (why) { toast(why); return; }
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
$('clearBtn').onclick = () => {
  if (!layout.pieces.length) return;
  commit(() => { layout.pieces = []; delete layout.origin; selected = -1; });
  toast('全部消しました（「戻す」で戻せます）');
};
$('revBtn').onclick = () => {
  if (!layout.pieces.length) return;
  const keep = layout.name;
  commit(() => { const r = reverseLayout(layout); layout.pieces = r.pieces; layout.origin = r.origin; layout.name = keep; selected = -1; });
  toast('スタートの向きを逆にしました（同じコースを逆回り）');
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
  else { view3d.resize(); if (dirty3d) { view3d.setData(built, layout.lanes, selected, layout.dims); dirty3d = false; } view3d.requestRender(); }
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
    const e = p.end;
    // 傾き=横傾き（+は右が高い、書き出しと同じ export.ts bankDeg）、坂=進行方向の上向きの角度
    const tilt = bankDeg(e);
    const pitch = Math.atan2(e.f[1], Math.hypot(e.f[0], e.f[2])) * 180 / Math.PI;
    const h0 = pl.length ? heading(pl[0].start.f) : 0;
    $('stSel').textContent = `選択 ${p.index + 1}番 ${pieceLabel(p.spec)}　出口 向き${Math.round(norm(heading(e.f) - h0))}°・高さ${Math.round(e.p[1])}mm・坂${Math.round(pitch)}°・傾き${Math.round(tilt)}°`;
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
  view2d.setData(built, layout.lanes, selected, mode, layout.dims);
  if (viewKind === '3d') {
    if (dirty3d) { view3d.setData(built, layout.lanes, selected, layout.dims); dirty3d = false; } else view3d.setSelected(selected);
  }
  $('nameBtn').textContent = layout.name;
  $('hint').hidden = layout.pieces.length > 0;
  document.querySelectorAll<HTMLElement>('#laneSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.lanes) === layout.lanes));
  document.querySelectorAll<HTMLElement>('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === viewKind));
  document.querySelectorAll<HTMLElement>('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const p = layout.pieces[selected];
  ($('delBtn') as HTMLButtonElement).disabled = !p;
  const fb = $('flipBtn') as HTMLButtonElement;
  fb.disabled = !p || (p.type !== 'corner' && p.type !== 'wave');
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
      btn('見本: 定番の並び（バンク→谷→スロープ、3レーン）', () => { setLayout(sampleBankValley(3)); closeSheet(); }),
      btn('保存枠から読む', menuLoad),
      btn('保存枠に保存', menuSave),
      btn('JSON書き出し・読み込み', menuJson),
      btn('寸法の調整', menuDims),
      btn('コース全体を左右反転（鏡写し）', () => { setLayout(mirrorLayout(layout)); closeSheet(); }),
      btn('コース全体を逆走にする（走る向きを逆に）', () => { setLayout(reverseLayout(layout)); closeSheet(); }),
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
          legacyOnLoad = 0; legacyBankOnLoad = 0;
          const l = validLayout(JSON.parse(ta.value));
          if (!l) throw new Error('形式が違います');
          setLayout(l); closeSheet();
          if (legacyOnLoad || legacyBankOnLoad) toast(LEGACY_MSG(legacyOnLoad, legacyBankOnLoad));
        } catch (e) { note.textContent = '読み込めません: ' + (e instanceof Error ? e.message : String(e)); }
      }),
    );
    b.append(ta, note, row, file, btn('← メニューへ', menuMain));
  });
}
const SRC: Record<SourceKind, string> = { official: '公式', measured: '実測', estimated: '推定', provisional: '仮' };
// 寸法画面の項目（日本語名つき。cornerAngle は部品の前提なので変えられない）
const DIM_ITEMS: { key: string; name: string; fixed?: boolean; fixedNote?: string }[] = [
  { key: 'laneWidth', name: 'レーン幅（1レーン）' },
  { key: 'wallHeight', name: 'フェンスの高さ' },
  { key: 'wallThickness', name: '外壁の厚み' },
  { key: 'straightLength', name: '直線1枚の長さ' },
  { key: 'cornerCenterRadius', name: 'コーナーの半径（中心線）' },
  { key: 'cornerAngle', name: 'コーナー1枚の角度', fixed: true },
  { key: 'slopeRise', name: 'スロープ1段の高さ（落差）' },
  { key: 'slopeLength', name: 'スロープの長さ（上から見た長さ）' },
  { key: 'slopeBendRadius', name: 'スロープの折れ目の半径' },
  { key: 'waveLength', name: 'ウェーブの長さ' },
  { key: 'waveSwing', name: 'ウェーブの左右の振れ幅（片側）' },
  { key: 'waveCount', name: 'ウェーブの往復の回数' },
  { key: 'laneChangeLength', name: '立体交差の長さ' },
  { key: 'laneChangeRise', name: '立体交差の高さ' },
  { key: 'bankAngle', name: 'バンクアプローチ1枚の角度', fixed: true, fixedNote: '※部品の前提のため変更できません（2枚続けて置くと40度）' },
  { key: 'bankBendRadius', name: 'バンクアプローチの半径（縦の丸み）' },
];
const UNIT: Record<Dim['unit'], string> = { mm: 'mm', deg: '°', count: '個' };

function setDim(lanes: LaneCount, key: string, v: number | null) {
  commit(() => {
    const d = { ...(layout.dims ?? {}) };
    if (v == null) delete d[dimKey(lanes, key)]; else d[dimKey(lanes, key)] = v;
    if (Object.keys(d).length) layout.dims = d; else delete layout.dims;
  });
}

function menuDims() {
  const lanes = layout.lanes;
  openSheet(`寸法の調整（${lanes}レーン）`, (b) => {
    const top = document.createElement('div'); top.className = 'dimtop';
    const st = document.createElement('div'); st.className = 'dimstate';
    const lg = document.createElement('div'); lg.className = 'dimlegend';
    lg.innerHTML = (Object.keys(SRC) as SourceKind[]).map((k) => `<span class="badge ${k}">${SRC[k]}</span>`).join(' ') + ' <span class="badge measured">実測（店長入力）</span>';
    const info = document.createElement('small');
    info.textContent = `このコースの${lanes}レーンの表です。数値を入れると、このコースだけ上書きします（3レーンと5レーンは別）。値を変えると周回が閉じなくなることがあります（自動では直しません）。`;
    top.append(st, lg, info);
    b.append(top);
    const sync = () => {
      const c = built.check;
      st.className = 'dimstate ' + (layout.pieces.length === 0 ? '' : c.closed ? 'ok' : 'ng');
      st.textContent = layout.pieces.length === 0 ? 'コースは空です' : c.closed ? `✔ 周回OK　1周 ${(c.totalLengthMm / 1000).toFixed(2)}m` : `✖ 閉じていません（あと${Math.round(c.gapMm)}mm・向き${Math.round(c.headingDeg)}°・高さ${Math.round(c.heightMm)}mm）`;
    };
    sync();
    const list = document.createElement('div'); list.className = 'dimlist';
    b.append(list);
    for (const it of DIM_ITEMS) {
      const d = CATALOG[lanes][it.key];
      if (!d) continue;
      const k = dimKey(lanes, it.key);
      const ov = layout.dims?.[k];
      const over = validDimValue(it.key, ov);
      const card = document.createElement('div'); card.className = 'dimcard' + (over ? ' over' : '');
      const badges = over
        ? `<span class="badge measured">実測（店長入力）</span>${d.source === 'official' ? '<span class="badge changed">公式値から変更</span>' : ''}`
        : `<span class="badge ${d.source}">${SRC[d.source]}</span>`;
      card.innerHTML = `<div class="dimhead"><b>${esc(it.name)}</b><span class="bgs">${badges}</span></div>`;
      const row = document.createElement('div'); row.className = 'dimrow';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = String(over ? ov : d.value); inp.disabled = !!it.fixed;
      inp.setAttribute('aria-label', it.name);
      const unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = UNIT[d.unit];
      const err = document.createElement('div'); err.className = 'dimerr'; err.hidden = true;
      const apply = () => {
        const t = inp.value.trim().replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String(c.charCodeAt(0) - 0xff10)));
        const v = t === '' ? NaN : Number(t);
        if (!validDimValue(it.key, v)) {
          err.hidden = false;
          err.textContent = it.key === 'waveCount' ? '1〜20の整数を入れてください' : '0より大きい数を入れてください';
          inp.classList.add('bad');
          return;
        }
        const cur = over ? ov : d.value;
        if (v === cur) { inp.value = String(v); err.hidden = true; inp.classList.remove('bad'); return; }
        setDim(lanes, it.key, v === d.value ? null : v);
        keepScroll(() => menuDims());
      };
      inp.addEventListener('change', apply);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('input', () => { err.hidden = true; inp.classList.remove('bad'); });
      row.append(inp, unit);
      if (!it.fixed) {
        const rs = document.createElement('button'); rs.className = 'reset'; rs.textContent = '表の値に戻す'; rs.disabled = !over;
        rs.onclick = () => { setDim(lanes, it.key, null); keepScroll(() => menuDims()); };
        row.append(rs);
      }
      card.append(row, err);
      const note = document.createElement('div'); note.className = 'dimnote';
      note.textContent = `表の値 ${d.value}${UNIT[d.unit]}（${SRC[d.source]}）${it.fixed ? '　' + (it.fixedNote ?? '※部品の前提のため変更できません') : ''}　${d.note.replace(/https?:\/\/\S+/g, '（出典はコード内の表に記載）')}`;
      card.append(note);
      const calc = calcLine(lanes, it.key);
      if (calc) { const c = document.createElement('div'); c.className = 'dimcalc'; c.textContent = calc; card.append(c); }
      list.append(card);
    }
    b.append(btn('← メニューへ', menuMain));
  });
}
// 寸法から計算した形（斜面の長さ・角度）。今のコースの上書きを反映
function calcLine(lanes: LaneCount, key: string): string {
  const ov = layout.dims;
  if (key === 'bankAngle' || key === 'bankBendRadius') {
    const d = bankDims(lanes, ov);
    // 2枚続けたとき（40度）: 1枚目の出口から2枚目が同じ半径で続くので、中心角2倍の1つの円弧と同じ
    const R = d.radius, a2 = d.angleRad * 2;
    return `計算: 1枚 弦${Math.round(d.chord)}mm・前へ${Math.round(d.forward)}mm・上へ${Math.round(d.rise)}mm・中心線${Math.round(d.length)}mm / 2枚（40°） 前へ${Math.round(R * Math.sin(a2))}mm・上へ${Math.round(R * (1 - Math.cos(a2)))}mm`;
  }
  if (key === 'slopeBendRadius' || key === 'slopeRise' || key === 'slopeLength') {
    const d = slopeDims(lanes, ov);
    const avg = Math.atan2(dimOfLayout(lanes, 'slopeRise'), dimOfLayout(lanes, 'slopeLength')) * 180 / Math.PI;
    return `計算（推定）: 斜面の角度 ${(d.angleRad * 180 / Math.PI).toFixed(1)}°（平均の勾配 ${avg.toFixed(1)}° が下限）・斜面${Math.round(d.slopeLen)}mm${d.shrunk ? `（半径を${Math.round(d.radius)}mmに縮める）` : ''}`;
  }
  return '';
}
function dimOfLayout(lanes: LaneCount, key: string) { return dim(lanes, key, layout.dims); }
function keepScroll(fn: () => void) { const y = sheetBody.scrollTop; fn(); sheetBody.scrollTop = y; }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
$('menuBtn').onclick = menuMain;

// ---------- 起動 ----------
refresh(true);
setView('2d');
if (legacyAtStart || legacyBankAtStart) toast(LEGACY_MSG(legacyAtStart, legacyBankAtStart));
(window as unknown as { __editor: unknown }).__editor = { get layout() { return layout; }, get built() { return built; }, get view3d() { return view3d; }, get view2d() { return view2d; } };
