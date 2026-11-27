// コースエディタの画面。幾何は geom.ts、寸法は catalog.ts、ゲームへの書き出しは export.ts。
import '../i18n'; // 英語版のときだけ画面の文字を置き換える
import type { Built, Layout, LaneCount, PieceSpec, RaceSettings } from './types';
import { raceDefaults } from './types';
import { CATALOG, dim, dimKey, validDimValue } from './catalog';
import { build, pieceLabel, emptyLayout, sampleOval, sampleBankValley, canAddPiece, mirrorLayout, reverseLayout, parseLayout, bankDims, slopeDims } from './geom';
import { toCourse, bankDeg } from './export';
import { View2D, TYPE_COLOR, type AddMode } from './view2d';
import { View3D } from './view3d';
import { drawSheet, savePdf, savePng } from './printSheet';
import { findClosers, describe } from './closer';
import type { SourceKind, Dim } from './types';
import { PLAY, homeHref } from '../storage';
import { decodeCourse, encodeCourse, shareText } from './share';

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
// 保存できたか（プライベートブラウズや保存の制限で失敗することがある）。失敗しても動きは続ける
function saveStore(): boolean {
  store.draft = layout;
  try {
    const s = JSON.stringify(store);
    localStorage.setItem(KEY, s);
    return localStorage.getItem(KEY) === s;
  } catch { return false; }
}

// ---------- 状態 ----------
const store = loadStore();
const legacyAtStart = legacyOnLoad;
const legacyBankAtStart = legacyBankOnLoad;
// テストプレイ用は3レーンだけ（5レーンは寸法が未確認のため出さない）
let layout: Layout = PLAY && store.draft.lanes !== 3 ? sampleOval(3) : store.draft;
if (PLAY) $('laneSeg').querySelector<HTMLElement>('[data-lanes="5"]')!.hidden = true;
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
interface PalItem { name: string; spec: PieceSpec; svg: string; group?: PalGroup; hidden?: boolean }
type PalGroup = 'big' | 'tornado' | 'lc' | 'corner' | 'bank' | 'slope' | 'straight';
const PAL_GROUPS: [PalGroup, string][] = [['big', '大半径コーナー'], ['tornado', 'トルネードバンク'], ['lc', '特殊LC'], ['corner', '特殊コーナー'], ['bank', '特殊バンク'], ['slope', '特殊スロープ'], ['straight', 'その他の直線']];
const P = (d: string, w = 5, extra = '') => `<path d="${d}" fill="none" stroke-width="${w}" ${extra}/>`;
const PALETTE: PalItem[] = [
  // よく使う部品（2026-11-22 店長「頻度高いのはストレート、左右のコーナー、スロープ上り下り、20度バンク、ウェーブ」）
  { name: 'スタート', spec: { type: 'start' }, svg: P('M2 10H30') + '<path d="M20 3V17" stroke-width="4" stroke="#fff" fill="none"/><path d="M20 3V17" stroke-width="4" stroke="#111" fill="none" stroke-dasharray="3 3"/>' },
  { name: '直線1', spec: { type: 'straight', frac: 1 }, svg: P('M2 10H30') },
  { name: '左45°', spec: { type: 'corner', dir: 'L' }, svg: P('M3 16H12Q22 16 28 5') },
  { name: '右45°', spec: { type: 'corner', dir: 'R' }, svg: P('M3 4H12Q22 4 28 15') },
  { name: '上りスロープ', spec: { type: 'slopeUp' }, svg: '<path d="M2 17L30 17L30 4Z" stroke="none"/>' },
  { name: '下りスロープ', spec: { type: 'slopeDown' }, svg: '<path d="M2 4L2 17L30 17Z" stroke="none"/>' },
  { name: '20°バンク', spec: { type: 'bankApproach' }, svg: '<path d="M2 17H8Q24 17 30 5V17Z" stroke="none"/>' },
  { name: 'バンク終わり', spec: { type: 'bankApproach', end: true }, svg: '<path d="M2 17Q10 6 24 5H30V17Z" stroke="none"/>' },
  { name: 'ウェーブ', spec: { type: 'wave' }, svg: P('M2 10C6 4 10 4 13 10S19 16 22 10S27 6 30 10') },
  { name: 'ウェーブ反転', spec: { type: 'wave', flip: true }, svg: P('M2 10C6 16 10 16 13 10S19 4 22 10S27 14 30 10') },
  { name: 'レーンチェンジ', spec: { type: 'laneChange' }, svg: P('M2 5H8L24 15H30', 3) + P('M2 15H8L24 5H30', 3) },
  // 大半径コーナー（2026-11-22 店長「今のRの2倍3倍4倍まで」）: 45度1枚。トルネードバンクの3倍・4倍（今のトルネードは2倍）
  { name: '左45°R×2', spec: { type: 'corner', dir: 'L', big: 2 }, svg: P('M3 16H8Q22 16 29 10'), group: 'big' },
  { name: '右45°R×2', spec: { type: 'corner', dir: 'R', big: 2 }, svg: P('M3 4H8Q22 4 29 10'), group: 'big' },
  { name: '左45°R×3', spec: { type: 'corner', dir: 'L', big: 3 }, svg: P('M3 16H8Q22 16 29 11'), group: 'big' },
  { name: '右45°R×3', spec: { type: 'corner', dir: 'R', big: 3 }, svg: P('M3 4H8Q22 4 29 9'), group: 'big' },
  { name: '左45°R×4', spec: { type: 'corner', dir: 'L', big: 4 }, svg: P('M3 16H8Q22 16 29 12'), group: 'big' },
  { name: '右45°R×4', spec: { type: 'corner', dir: 'R', big: 4 }, svg: P('M3 4H8Q22 4 29 8'), group: 'big' },
  { name: 'TB2倍左ノボリ', spec: { type: 'corner', dir: 'L', tornado: true, rise: 1 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8') , group: 'tornado' },
  { name: 'TB2倍右ノボリ', spec: { type: 'corner', dir: 'R', tornado: true, rise: 1 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8') , group: 'tornado' },
  { name: 'TB2倍左フラット', spec: { type: 'corner', dir: 'L', tornado: true, rise: 0 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8') , group: 'tornado' },
  { name: 'TB2倍右フラット', spec: { type: 'corner', dir: 'R', tornado: true, rise: 0 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8') , group: 'tornado' },
  { name: 'TB2倍左クダリ', spec: { type: 'corner', dir: 'L', tornado: true, rise: -1 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8M20 6l2 3') , group: 'tornado' },
  { name: 'TB2倍右クダリ', spec: { type: 'corner', dir: 'R', tornado: true, rise: -1 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8M20 14l2-3') , group: 'tornado' },
  { name: 'TB3倍左ノボリ', spec: { type: 'corner', dir: 'L', tornado: true, rise: 1, big: 3 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8'), group: 'tornado' },
  { name: 'TB3倍右ノボリ', spec: { type: 'corner', dir: 'R', tornado: true, rise: 1, big: 3 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8'), group: 'tornado' },
  { name: 'TB3倍左フラット', spec: { type: 'corner', dir: 'L', tornado: true, rise: 0, big: 3 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8'), group: 'tornado' },
  { name: 'TB3倍右フラット', spec: { type: 'corner', dir: 'R', tornado: true, rise: 0, big: 3 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8'), group: 'tornado' },
  { name: 'TB3倍左クダリ', spec: { type: 'corner', dir: 'L', tornado: true, rise: -1, big: 3 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8M20 6l2 3'), group: 'tornado' },
  { name: 'TB3倍右クダリ', spec: { type: 'corner', dir: 'R', tornado: true, rise: -1, big: 3 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8M20 14l2-3'), group: 'tornado' },
  { name: 'TB4倍左ノボリ', spec: { type: 'corner', dir: 'L', tornado: true, rise: 1, big: 4 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8'), group: 'tornado' },
  { name: 'TB4倍右ノボリ', spec: { type: 'corner', dir: 'R', tornado: true, rise: 1, big: 4 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8'), group: 'tornado' },
  { name: 'TB4倍左フラット', spec: { type: 'corner', dir: 'L', tornado: true, rise: 0, big: 4 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8'), group: 'tornado' },
  { name: 'TB4倍右フラット', spec: { type: 'corner', dir: 'R', tornado: true, rise: 0, big: 4 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8'), group: 'tornado' },
  { name: 'TB4倍左クダリ', spec: { type: 'corner', dir: 'L', tornado: true, rise: -1, big: 4 }, svg: P('M3 18H14A8 8 0 0 0 14 2H8M20 6l2 3'), group: 'tornado' },
  { name: 'TB4倍右クダリ', spec: { type: 'corner', dir: 'R', tornado: true, rise: -1, big: 4 }, svg: P('M3 2H14A8 8 0 0 1 14 18H8M20 14l2-3'), group: 'tornado' },
  // 特殊LC（開閉式のまとめ）
  { name: 'LCジャンプ', spec: { type: 'laneChange', jump: true }, svg: P('M2 5H8L13 8', 3) + P('M19 12L24 15H30', 3) + P('M2 15H8L24 5H30', 3) , group: 'lc' },
  { name: 'Uチェンジ左', spec: { type: 'bankChange', dir: 'L' }, svg: P('M2 16H18A5.5 5.5 0 0 0 18 5H2', 3) , group: 'lc' },
  { name: 'Uチェンジ右', spec: { type: 'bankChange', dir: 'R' }, svg: P('M2 4H18A5.5 5.5 0 0 1 18 15H2', 3) , group: 'lc' },
  { name: '急角度45左', spec: { type: 'bankChange', dir: 'L', tilt: 45 }, svg: P('M2 16H18A5.5 5.5 0 0 0 18 5H2', 3) + P('M24 4L28 16', 1) , group: 'lc' },
  { name: '急角度60左', spec: { type: 'bankChange', dir: 'L', tilt: 60 }, svg: P('M2 16H18A5.5 5.5 0 0 0 18 5H2', 3) + P('M25 3L27 17', 1) , group: 'lc' },
  { name: '角チェンジ左', spec: { type: 'cornerChange', dir: 'L' }, svg: P('M3 16H10Q20 16 20 6V2', 3) , group: 'lc' },
  { name: '角チェンジ右', spec: { type: 'cornerChange', dir: 'R' }, svg: P('M3 4H14Q22 4 22 12V18', 3) , group: 'lc' },
  { name: 'ねじれ輪', spec: { type: 'twistChange' }, svg: '<path d="M3 15C9 15 12 5 20 5A5 5 0 0 1 20 15C12 15 9 5 3 5" fill="none" stroke-width="3"/>' , group: 'lc' },
  { name: '分岐路', spec: { type: 'forkRoad' }, svg: P('M2 10H8Q12 4 16 4H22Q26 4 30 10', 3) + P('M8 10Q12 16 16 16H22Q26 16 30 10', 3) , group: 'lc' },
  // 特殊コーナー（開閉式のまとめ）
  { name: 'ローリングライズ左', spec: { type: 'corner', dir: 'L', rise: 1 }, svg: P('M3 18H10Q20 16 28 3') , group: 'corner' },
  { name: 'ローリングライズ右', spec: { type: 'corner', dir: 'R', rise: 1 }, svg: P('M3 2H10Q20 4 28 17') , group: 'corner' },
  { name: 'ローリングフォール左', spec: { type: 'corner', dir: 'L', rise: -1 }, svg: P('M3 10H10Q20 12 28 3') , group: 'corner' },
  { name: 'ローリングフォール右', spec: { type: 'corner', dir: 'R', rise: -1 }, svg: P('M3 10H10Q20 8 28 17') , group: 'corner' },
  { name: 'ループ左', spec: { type: 'loop', dir: 'L' }, svg: '<path d="M2 16H14A6 6 0 1 0 14 4A6 6 0 1 0 20 16H30" fill="none" stroke-width="3"/>' , group: 'corner' },
  { name: 'ループ右', spec: { type: 'loop', dir: 'R' }, svg: '<path d="M2 16H14A6 6 0 1 0 14 4A6 6 0 1 0 20 16H30" fill="none" stroke-width="3"/>' , group: 'corner' },
  // 特殊バンク（開閉式のまとめ）
  { name: '30°バンク', spec: { type: 'bankApproach', deg: 30 }, svg: '<path d="M2 17H8Q22 17 26 2H30V17Z" stroke="none"/>' , group: 'bank' },
  { name: '15°バンク', spec: { type: 'bankApproach', deg: 15 }, svg: '<path d="M2 17H8Q24 17 30 9V17Z" stroke="none"/>' , group: 'bank' },
  { name: '45°バンク', spec: { type: 'bankApproach', deg: 45 }, svg: '<path d="M2 17H6Q18 17 22 1H30V17Z" stroke="none"/>' , group: 'bank' },
  { name: '逆バンク10°', spec: { type: 'bankApproach', deg: 10, end: true }, svg: '<path d="M2 11Q12 11 30 16V17H2Z" stroke="none"/>' , group: 'bank' },
  // 特殊スロープ（開閉式のまとめ）
  { name: '急スロープ上り', spec: { type: 'slopeUp', steep: true }, svg: '<path d="M2 17H6Q12 17 18 9Q23 3 30 3V17Z" stroke="none"/>' , group: 'slope' },
  { name: '急スロープ下り', spec: { type: 'slopeDown', steep: true }, svg: '<path d="M2 3Q9 3 14 9Q20 17 26 17H30H2Z" stroke="none"/>' , group: 'slope' },
  { name: '大山上り', spec: { type: 'slopeUp', mountain: true }, svg: '<path d="M2 17Q12 15 22 5Q26 2 30 2V17Z" stroke="none"/>' , group: 'slope' },
  { name: '大山下り', spec: { type: 'slopeDown', mountain: true }, svg: '<path d="M2 2Q6 2 10 5Q16 17 22 17H30V17H2Z" stroke="none"/>' , group: 'slope' },
  { name: '大坂上り', spec: { type: 'slopeUp', drop: true }, svg: '<path d="M2 17H5Q10 17 20 4Q24 1 30 1V17Z" stroke="none"/>' , group: 'slope' },
  { name: '大坂下り', spec: { type: 'slopeDown', drop: true }, svg: '<path d="M2 1Q8 1 12 4Q22 17 27 17H30H2Z" stroke="none"/>' , group: 'slope' },
  { name: 'バウンドA', spec: { type: 'bump' }, svg: '<path d="M2 17H6Q16 15 21 6Q25 17 30 17Z" stroke="none"/>' , group: 'slope' },
  { name: 'バウンドB', spec: { type: 'bump', kind: 'B' }, svg: '<path d="M2 17Q7 17 11 6Q16 15 26 17H30Z" stroke="none"/>' , group: 'slope' },
  { name: 'こぶ', spec: { type: 'hump' }, svg: '<path d="M2 17Q9 17 16 7Q23 17 30 17Z" stroke="none"/>' , group: 'slope' },
  { name: '切れ目ジャンプ', spec: { type: 'gapJump' }, svg: '<path d="M2 17H4Q10 17 18 9H21V17Z" stroke="none"/><path d="M26 9H30V17H26Z" stroke="none"/>' , group: 'slope' },
  // その他の直線（開閉式のまとめ）
  { name: '直線1/2', spec: { type: 'straight', frac: 0.5 }, svg: P('M9 10H23') , group: 'straight' },
  { name: '直線1/4', spec: { type: 'straight', frac: 0.25 }, svg: P('M13 10H19') , group: 'straight' },
  { name: '洗濯板', spec: { type: 'washboard' }, svg: P('M2 14H30', 4) + P('M5 10V14M9 10V14M13 10V14M17 10V14M21 10V14M25 10V14M29 10V14', 2) , group: 'straight' },
  { name: 'ユニバーサル', spec: { type: 'universal' }, svg: P('M2 14H7C16 14 16 6 25 6H30') + '<circle cx="30" cy="6" r="2" stroke="none"/>' , group: 'straight' },
  // 2026-11-22 店長「シフトチェンジや飛び移りがちょっとおかしいから、いったんさげといて」: 選べなくするだけ（保存・共有コードの読み込みと走りは残す）
  { name: 'シフトチェンジ', spec: { type: 'shiftChange', dir: 'R' }, svg: P('M2 5H8C16 5 16 15 24 15H30', 3) , hidden: true },
  { name: '飛び移り', spec: { type: 'hopChange' }, svg: P('M2 15H8L13 11', 3) + P('M18 8L24 5H30', 3) + P('M2 5H30', 1) , hidden: true },
];
const pal = $('palette');
const palBtns: HTMLButtonElement[] = [];
PALETTE.forEach((it, k) => {
  if (it.hidden) return;
  const b = document.createElement('button');
  b.innerHTML = `<svg viewBox="0 0 32 20" stroke="${TYPE_COLOR[it.spec.type]}" fill="${TYPE_COLOR[it.spec.type]}">${it.svg}</svg><span>${it.name}</span>`;
  b.title = it.name; b.dataset.k = String(k);
  if (it.spec.end && it.spec.deg === 10) b.title = '逆バンク10度（路面を下へ10度曲げる上に凸の部品。この後の180度コーナーは外側が低く傾き、回り終えたらもう1枚の逆バンク10°で水平に戻る。角度は仮）';
  else if (it.spec.end) b.title = 'バンク終わり（路面を下へ20度曲げる、上に凸の部品。バンクのすぐ後ろに置くと水平に戻る。形は推定）';
  else if (it.spec.deg === 15) b.title = '15度バンク（部品の大きさは20度と同じで、路面を上へ15度曲げる。緩いバンクの連続に。仮の部品）';
  else if (it.spec.deg === 45) b.title = '45度バンク（部品の大きさは20度と同じで、路面を上へ45度曲げる。傾いた面で180度回ってからもう1枚で水平に戻る。仮の部品・ブレーキやローラーの当たりは未確認）';
  else if (it.spec.deg === 30) b.title = '30度バンク（部品の大きさは20度と同じで、路面を上へ30度曲げる。傾いた面で180度回ってからもう1枚で水平に戻る。仮の部品）';
  else if (it.spec.type === 'gapJump') b.title = '切れ目ジャンプ（上りスロープ1個＋直線1枚。頂上で路面が200mm切れて先の直線に着地。長さはスロープ＋直線1枚なのでコースが閉じやすい。ゲームでは頂上で必ず飛ぶ）';
  else if (it.spec.mountain) b.title = '大山（上りは直線3.5枚・下りは5レーン直線1枚／3レーン2枚で、5レーンは660mm・3レーンは330mm上がる・下がる。高さは設定値で、実物の1200mmまで上げられる。頂上に45度バンクを置くと大会の大山に近い形。長さ・角度は仮）';
  else if (it.spec.drop) b.title = '大坂（5レーンは直線2枚の長さで600mm上がる・下がる、高さは公表値。3レーンは330mm・角度40度などすべて仮。急な下りや大きな山に）';
  else if (it.spec.type === 'bankChange' && it.spec.tilt) b.title = `急角度チェンジ${it.spec.tilt}度（Uターンチェンジと同じ形で、180度のターンを${it.spec.tilt}度傾けて回りながらレーンが入れ替わる。前後の直線で傾きと高さをつける。角度は公式60度・公式戦は45度の伝聞で食い違うので両方。右回りは左右反転で）`;
  else if (it.spec.type === 'forkRoad') b.title = '分岐路（直線4枚ぶん。5レーンは左3本が左へ500mmずれて220mm上がり、右2本は右へずれる。3レーンは2本と1本。終わりで合流。走りは同じレーンのまま。寸法は仮で、実物のように別々の形のコースに分かれるわけではない）';
  else if (it.spec.type === 'hopChange') b.title = '飛び移りチェンジ（レーンチェンジと同じ長さ。橋の真ん中に切れ目（仮250mm）があり、端のレーンの車が飛び越えて反対の端のレーンへ。遅すぎると切れ目に落ち、ブースト中などで速すぎると飛び出すことがある。寸法は仮）';
  else if (it.spec.type === 'twistChange') b.title = 'ねじれ輪チェンジ（直線3枚ぶん、5レーンは2枚ぶん。右端のレーンから透明な1レーンの輪に乗って一周し、左端のレーンへ降りる。通るとレーンが1つずれる。形と寸法は写真からの推定）';
  else if (it.spec.type === 'washboard') b.title = '洗濯板（直線1枚ぶん。路面に細かい段差が並ぶ。ゲームでは最高速が落ちる低速区間として走る。段差の数値は公式の部品から、効き方は仮）';
  else if (it.spec.type === 'universal') b.title = 'ユニバーサル（最後に1個。前の出口からスタートまで、位置と向きのずれを自動でつなぐ。実物には無い帳尻合わせ用）';
  else if (it.spec.type === 'bankApproach') b.title = 'バンクアプローチ（路面を上へ20度曲げる。2枚で40度。傾いた面で180度回ってからもう1枚で水平に戻る）';
  b.onclick = () => addPiece(it.spec);
  if (it.group) b.dataset.g = it.group;
  palBtns.push(b);
});
// 並べる: よく使う部品 → まとめごとに見出し（押すと開く・閉じる。開いているまとめはこの端末に覚える）
const PAL_OPEN_KEY = 'kumitate-editor.palOpen';
const palOpen = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(PAL_OPEN_KEY) || '[]') as string[]; } catch { return []; } })());
function renderPalette() {
  pal.textContent = '';
  for (const b of palBtns) if (!b.dataset.g) pal.appendChild(b);
  for (const [g, name] of PAL_GROUPS) {
    const list = palBtns.filter((b) => b.dataset.g === g);
    const h = document.createElement('button');
    const open = palOpen.has(g);
    h.className = 'palGroup' + (open ? ' open' : '');
    h.innerHTML = `<b>${open ? '▼' : '▶'} ${list.length}</b><span>${name}</span>`; h.title = `${name}（${list.length}個）を${open ? '閉じる' : '開く'}`;
    h.onclick = () => { if (open) palOpen.delete(g); else palOpen.add(g); try { localStorage.setItem(PAL_OPEN_KEY, JSON.stringify([...palOpen])); } catch { /* 保存できなくても動く */ } renderPalette(); };
    pal.appendChild(h);
    if (open) for (const b of list) pal.appendChild(b);
  }
}
renderPalette();

let toastTimer = 0;
function toast(text: string) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, 3200);
}

function addPiece(spec: PieceSpec) {
  const why = canAddPiece(layout, spec);
  if (why) { toast(why); return; }
  const s: PieceSpec = { ...spec };
  const n = layout.pieces.length;
  const uniLast = n > 0 && layout.pieces[n - 1].type === 'universal';
  commit(() => {
    // ユニバーサルはいつも最後。ほかの部品を最後に足すときは、ユニバーサルの手前に入れる
    if (s.type === 'universal') { layout.pieces.push(s); selected = layout.pieces.length - 1; }
    else if (uniLast && (mode !== 'start') && !(mode === 'insert' && selected >= 0 && selected < n - 1)) { layout.pieces.splice(n - 1, 0, s); selected = n - 1; }
    else if (mode === 'start') { layout.pieces.unshift(s); selected = 0; }
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
// 全消しは1回確認を挟む: 1回目で「本当に消す？」に変わり、3秒以内にもう1回押すと消す
let clearArmed = 0;
const clearBtn = $('clearBtn') as HTMLButtonElement;
const disarmClear = () => { clearTimeout(clearArmed); clearArmed = 0; clearBtn.textContent = '全消し'; clearBtn.classList.remove('armed'); };
clearBtn.onclick = () => {
  if (!layout.pieces.length) return;
  if (!clearArmed) {
    clearBtn.textContent = '本当に消す？'; clearBtn.classList.add('armed');
    clearArmed = window.setTimeout(disarmClear, 3000);
    toast('もう1回押すと全部消します（3秒でキャンセル）');
    return;
  }
  disarmClear();
  commit(() => { layout.pieces = []; delete layout.origin; selected = -1; });
  toast('全部消しました（「戻す」で戻せます）');
};
// 周回を閉じる案（2026-11-27 店長「あとこれとこれを使えばきっちりスタートに戻れます、というのを出せないか」「実際何センチの直線があればきれいにつながるか」）
let closeHalf = false;
let thumbView: View2D | null = null;
function closeSheetOpen() {
  if (!layout.pieces.length) { toast('部品を置いてから使ってください'); return; }
  openSheet('周回を閉じる案', (b) => {
    const wait = document.createElement('small'); wait.textContent = '探しています…'; b.append(wait);
    setTimeout(() => fillCloseSheet(b), 30);
  });
}
function fillCloseSheet(b: HTMLElement) {
  b.innerHTML = '';
  const t0 = performance.now();
  const r = findClosers(layout, { half: closeHalf });
  const head = document.createElement('small');
  const S = dim(layout.lanes, 'straightLength', layout.dims);
  head.textContent = `今の出口からスタートの入口まで、直線（${S}mm）・左45°・右45°${closeHalf ? '・直線1/2' : ''}だけでつなぐ並びを探しました（${Math.round(performance.now() - t0)}ms）。黄色の枠が足す部品です。押すと最後に足します（「戻す」で取り消せます）。` + (r.note ? `\n${r.note}` : '');
  head.style.whiteSpace = 'pre-line';
  b.append(head);
  const tog = btn(closeHalf ? '☑ 直線1/2も使う（押すと外す）' : '☐ 直線1/2も使う', () => { closeHalf = !closeHalf; closeSheetOpen(); });
  b.append(tog);
  thumbView ??= new View2D(document.createElement('canvas'), () => {});
  r.candidates.forEach((c, i) => {
    const from = layout.pieces.length - c.removed;
    thumbView!.setData(c.built, layout.lanes, -1, 'end', layout.dims);
    const cv = document.createElement('canvas'); cv.width = 520; cv.height = 300;
    thumbView!.renderTo(cv, 1.3, from);
    const img = document.createElement('img'); img.src = cv.toDataURL('image/png'); img.className = 'close-thumb'; img.alt = '';
    const title = c.custom
      ? `案${i + 1}（長さ合わせの直線 ${c.custom.mm}mm を1本${c.custom.diagonal ? '・斜めの向き' : ''}）　+${c.newCount}個　1周 ${c.lengthM.toFixed(2)}m`
      : `案${i + 1}（標準の部品だけ）　+${c.newCount}個　1周 ${c.lengthM.toFixed(2)}m`;
    const x = btn(`<span><b>${esc(title)}</b><br>${esc(describe(c.pieces, (p) => pieceLabel(p, layout.lanes, layout.dims)))}${c.removed ? '<br>（最後のユニバーサルを外して、代わりにこの並びを入れます）' : ''}</span>`, () => {
      commit(() => { layout.pieces = [...layout.pieces.slice(0, from), ...c.pieces.map((p) => ({ ...p }))]; selected = -1; });
      closeSheet();
      toast(`案${i + 1}を足しました（「戻す」で取り消せます）`);
    }, 'close-cand');
    x.prepend(img);
    b.append(x);
  });
  b.append(btn('閉じる', closeSheet));
}
$('closeBtn').onclick = closeSheetOpen;
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
// 走らせたコースの控え（2026-11-20 店長: エディタで作って走らせたらブラウザから外れて消えた →「容量的に余裕なら補完しといて」）。
// 走るたびに直近10件をこの端末に残し、共有コードもクリップボードへ写す（アプリ内表示などで保存が消えても、コードを貼れば戻せる）
const HIST_KEY = 'kumitate-racer.runHistory';
type RunHist = { t: number; layout: Layout };
function loadHist(): RunHist[] {
  try { const j = JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]'); return Array.isArray(j) ? j.filter((h) => h && validLayout(h.layout)) : []; } catch { return []; }
}
function pushHist(l: Layout) {
  try {
    const s = JSON.stringify(l);
    const h = loadHist().filter((x) => JSON.stringify(x.layout) !== s); // 同じ形は最新の1件だけ
    h.unshift({ t: Date.now(), layout: JSON.parse(s) });
    localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 10)));
  } catch { /* 保存できない環境 */ }
}
async function copyRunCode(l: Layout) {
  try {
    const code = await encodeCourse(l);
    await Promise.race([navigator.clipboard.writeText(shareText(l, code)), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 800))]);
    return true;
  } catch { return false; }
}
$('runBtn').onclick = async () => {
  if (!built.check.closed) return;
  pushHist(layout);
  if (await copyRunCode(layout)) { toast('共有コードをコピーしました（消えたときは「共有コードを読み込む」に貼ると戻せます）'); await new Promise((r) => setTimeout(r, 700)); }
  try {
    const course = toCourse(layout, 'custom');
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(course));
    // URLの印が落ちる環境（埋め込み表示など）でも自作コースで走れるよう、保存にも印を残す
    try { localStorage.setItem('kumitate-racer.useCustom', '1'); localStorage.setItem('kumitate-racer.mode', 'mini'); localStorage.setItem('kumitate-racer.playCourse', 'custom'); } catch { /* */ }
    location.href = homeHref() + '?mode=mini&course=custom';
  } catch (e) {
    toast('ゲームに渡せませんでした: ' + (e instanceof Error ? e.message : String(e)));
  }
};
$('modeSeg').onclick = (e) => {
  const m = (e.target as HTMLElement).closest('button')?.dataset.mode as AddMode | undefined;
  if (m) { mode = m; refresh(false); }
};
$('laneSeg').onclick = (e) => {
  const n = Number((e.target as HTMLElement).closest('button')?.dataset.lanes) as LaneCount;
  if ((n === 3 || (n === 5 && !PLAY)) && n !== layout.lanes) commit(() => { layout.lanes = n; });
};
$('viewSeg').onclick = (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.view as '2d' | '3d' | undefined;
  if (v) setView(v);
};
$('fitBtn').onclick = () => (viewKind === '2d' ? view2d.resetView() : view3d.resetView());
// コース名: 入力欄の画面で変える（2026-11-21 店長「名前変えるところ押しても反応しない」: 埋め込み表示では prompt/confirm が使えず、何も出なかった）
$('nameBtn').onclick = () => renameSheet();
function renameSheet(after?: () => void) {
  openSheet('コース名を変える', (b) => {
    const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 40; inp.value = layout.name; inp.className = 'nameinput';
    inp.style.cssText = 'width:100%;box-sizing:border-box;font-size:16px;padding:10px;border-radius:8px;border:1px solid #888;margin:4px 0 8px';
    const ok = () => { const n = inp.value.trim(); if (n && n !== layout.name) commit(() => { layout.name = n.slice(0, 40); }); if (after) after(); else closeSheet(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    b.append(inp, btn('決定', ok), btn(after ? '← 戻る' : 'やめる', () => (after ? after() : closeSheet())));
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}
// 確かめる画面（confirm の代わり。埋め込み表示では confirm が出ずに「いいえ」扱いになるため）
function askSheet(title: string, text: string, yes: string, onYes: () => void, back: () => void) {
  openSheet(title, (b) => {
    const note = document.createElement('small'); note.textContent = text;
    b.append(note, btn(yes, onYes), btn('← やめる', back));
  });
}
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
  if (PLAY && l.lanes !== 3) { toast('テストプレイ版は3レーンのコースだけ使えます'); return; }
  commit(() => { layout = JSON.parse(JSON.stringify(l)); selected = -1; });
  view2d.resetView(); view3d.resetView();
}
const slotLabel = (l: Layout | null, i: number) => `<span>枠${i + 1}　${l ? l.name : '（空）'}</span><small>${l ? `${l.lanes}レーン・${l.pieces.length}個` : ''}</small>`;

// レース設定（2026-11-22 店長了承）: ブースト方式（なし/回数制/ゲージ式）・回数・使える段・周回数。決めていない項目はコースの種類の既定（3・5レーン=1回・1段目・3周）
function menuRace() {
  const d = raceDefaults(true);
  const cur = { ...d, ...(layout.race ?? {}) };
  const set = (k: keyof RaceSettings, v: RaceSettings[keyof RaceSettings]) => {
    commit(() => { const r: RaceSettings = { ...(layout.race ?? {}), [k]: v }; if (r[k] === d[k]) delete r[k]; layout.race = Object.keys(r).length ? r : undefined; if (!layout.race) delete layout.race; });
    menuRace();
  };
  const row = (title: string, opts: [string, () => void, boolean][]) => {
    const h = document.createElement('div'); h.className = 'sep'; h.textContent = title;
    const w = document.createElement('div'); w.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    for (const [t, fn, on] of opts) { const b = btn(t, fn, on ? 'on' : ''); b.style.flex = '1 0 auto'; if (on) b.style.outline = '2px solid #4af'; w.append(b); }
    return [h, w];
  };
  openSheet('レース設定', (b) => {
    const note = document.createElement('p'); note.className = 'note';
    note.textContent = 'テストプレイでこのコースを走るときの設定です。共有コードにも入ります。何も変えなければ既定（1レース1回・1段目・3周）。';
    b.append(note,
      ...row('ブースト', ([['なし', 'none'], ['回数制', 'count'], ['ゲージ式', 'energy']] as const).map(([t, v]) => [t, () => set('boost', v), cur.boost === v] as [string, () => void, boolean])),
      ...(cur.boost === 'count' ? row('1レースの回数', [1, 2, 3, 5].map((n) => [`${n}回`, () => set('boostCount', n), cur.boostCount === n] as [string, () => void, boolean])) : []),
      ...(cur.boost !== 'none' ? row('使える段', [1, 2, 3].map((n) => [n === 1 ? '1段目だけ' : `${n}段目まで`, () => set('boostStages', n), cur.boostStages === n] as [string, () => void, boolean])) : []),
      ...row('周回数', [1, 3, 5, 10].map((n) => [`${n}周`, () => set('laps', n), cur.laps === n] as [string, () => void, boolean])),
      btn('既定に戻す', () => { commit(() => { delete layout.race; }); menuRace(); }),
      btn('閉じる', closeSheet),
    );
  });
}
function menuMain() {
  openSheet('メニュー', (b) => {
    b.append(
      btn('新規（空のコース）', () => { const go = () => { setLayout(emptyLayout(layout.lanes)); closeSheet(); }; if (!layout.pieces.length) go(); else askSheet('新規', '今のコースを消して新規にします。よいですか？（「戻す」で戻せます）', '消して新規にする', go, menuMain); }),
      btn('見本を読み込む（周回できる楕円）', () => { setLayout(sampleOval(layout.lanes)); closeSheet(); }),
      btn('見本: 定番の並び（バンク→谷→スロープ、3レーン）', () => { setLayout(sampleBankValley(3)); closeSheet(); }),
      btn('保存枠から読む', menuLoad),
      btn('保存枠に保存', menuSave),
      btn('🕘 走らせたコースの履歴（直近10件）', menuHist),
      btn('📤 コースを送る（共有コード）', menuShare),
      btn('📥 共有コードを読み込む', menuReceive),
      btn('🏁 レース設定（周回・ブースト）', menuRace),
      btn('🖨 A4横で印刷用に書き出す（全体図＋パーツ数・PDF/PNG）', menuPrint),
      btn('JSON書き出し・読み込み', menuJson),
      ...(PLAY ? [] : [btn('寸法の調整', menuDims)]), // テストプレイ用は出さない（出典の説明に他社の製品ページの話が入るため）
      btn('コース全体を左右反転（鏡写し）', () => { setLayout(mirrorLayout(layout)); closeSheet(); }),
      btn('コース全体を逆走にする（走る向きを逆に）', () => { setLayout(reverseLayout(layout)); closeSheet(); }),
      btn('ゲームへ戻る', () => { location.href = homeHref(); }),
    );
  });
}
// 印刷用シート（2026-11-27 店長「A4横で印刷したい。全体図と必要なパーツ数一覧で」「PDFかPNGでダウンロード」）
function menuPrint() {
  if (!built.placed.length) { toast('部品がありません'); return; }
  const cv = drawSheet(view2d, layout, built);
  view2d.requestDraw();
  openSheet('A4横で印刷用に書き出す', (b) => {
    const img = document.createElement('img');
    img.src = cv.toDataURL('image/png'); img.alt = 'コース図とパーツ数'; img.className = 'print-preview';
    const note = document.createElement('small');
    note.textContent = 'A4横・1枚。保存したファイルを「用紙 A4・横・ページに合わせる」で印刷してください。ダウンロードできないときは、この画像を長押し（右クリック）して保存できます。';
    const fail = (e: unknown) => { console.error(e); toast('保存できませんでした。画像を長押しで保存してください'); };
    b.append(img, note,
      btn('📄 PDFで保存', () => { savePdf(cv, layout).catch(fail); }),
      btn('🖼 PNGで保存', () => { savePng(cv, layout).catch(fail); }),
      btn('← メニューへ', menuMain));
  });
}
function menuHist() {
  openSheet('走らせたコースの履歴', (b) => {
    const h = loadHist();
    const note = document.createElement('small');
    note.textContent = h.length ? '「走る」を押したコースが新しい順に並びます（この端末の中だけ）。押すと今のコースと置き換わります（「戻す」で戻せます）。' : 'まだありません。「走る」を押すと、ここに控えが残ります。';
    b.append(note);
    h.forEach((x) => {
      const d = new Date(x.t);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      b.append(btn(`<span>${when}　${esc(x.layout.name)}</span><small>${x.layout.lanes}レーン・${x.layout.pieces.length}個</small>`, () => { const l = validLayout(x.layout); if (l) { setLayout(l); closeSheet(); toast(`「${l.name}」（${when}）を読み込みました`); } }));
    });
    b.append(btn('← メニューへ', menuMain));
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
    const note = document.createElement('small'); note.textContent = `保存する名前: ${layout.name}`;
    b.append(note, btn('✎ 名前を変えてから保存', () => renameSheet(menuSave)));
    store.slots.forEach((l, i) => b.append(btn(slotLabel(l, i), () => {
      const doSave = () => {
        store.slots[i] = JSON.parse(JSON.stringify(layout));
        const ok = saveStore(); menuSave();
        toast(ok ? `枠${i + 1}に保存しました（このブラウザの中だけ。閲覧データを消すと消えます）` : '保存できませんでした。プライベートブラウズなど、保存できない状態かもしれません。「コースを送る」の共有コードを控えておいてください');
      };
      if (l) askSheet('上書きの確認', `枠${i + 1}「${l.name}」を上書きします。よいですか？`, '上書きする', doSave, menuSave); else doSave();
    })));
    b.append(btn('← メニューへ', menuMain));
  });
}
// コースを送る: 共有コードを作って、コピー・スマホの共有メニュー・手で選択のどれかで渡す
function menuShare() {
  openSheet('コースを送る（共有コード）', (b) => {
    const note = document.createElement('small');
    note.textContent = '共有コードを作っています…';
    const ta = document.createElement('textarea'); ta.readOnly = true; ta.spellcheck = false; ta.className = 'sharecode';
    ta.onfocus = () => ta.select();
    const row = document.createElement('div'); row.className = 'btns';
    b.append(note, ta, row, btn('← メニューへ', menuMain));
    if (!built.check.closed) note.textContent = '※ まだ周回がつながっていないコースです（このままでも送れます）。';
    encodeCourse(layout).then((code) => {
      const text = shareText(layout, code);
      ta.value = text;
      note.textContent = `共有コードができました（${code.length}文字）。下のボタンで送ってください。サーバーには何も送りません。`;
      row.append(
        btn('コピー', async () => {
          try { await navigator.clipboard.writeText(text); note.textContent = 'コピーしました。LINE などに貼り付けて送ってください。'; }
          catch { ta.focus(); ta.select(); note.textContent = 'この画面ではコピーボタンが使えません。文字が選ばれた状態なので、長押し（右クリック）で「コピー」してください。'; }
        }),
        ...(typeof navigator.share === 'function' ? [btn('共有メニュー（LINE など）', async () => {
          try { await navigator.share({ text }); note.textContent = '共有メニューを開きました。'; }
          catch (e) { if ((e as Error)?.name !== 'AbortError') { ta.focus(); ta.select(); note.textContent = 'この画面では共有メニューが使えません。コピーで送ってください。'; } }
        })] : []),
        btn('全部選ぶ', () => { ta.focus(); ta.select(); }),
      );
    }).catch((e) => { note.textContent = '共有コードを作れませんでした: ' + (e instanceof Error ? e.message : String(e)); });
  });
}
// 共有コードを読み込む: 受け取った文をそのまま貼り付ける（前後の説明文が付いていてもよい）
function menuReceive() {
  openSheet('共有コードを読み込む', (b) => {
    const ta = document.createElement('textarea'); ta.spellcheck = false; ta.placeholder = 'ここに受け取った文（KR1… の共有コード）を貼り付け';
    const note = document.createElement('small');
    note.textContent = '読み込むと今のコースと置き換わります（「戻す」で戻せます）。残したいときは、読み込んだあと「保存枠に保存」してください。';
    const row = document.createElement('div'); row.className = 'btns';
    row.append(
      btn('貼り付け', async () => { try { ta.value = await navigator.clipboard.readText(); } catch { ta.focus(); note.textContent = 'この画面では貼り付けボタンが使えません。入力欄を長押しして「ペースト」してください。'; } }),
      btn('このコースを読み込む', async () => {
        try {
          legacyOnLoad = 0; legacyBankOnLoad = 0;
          const l = validLayout(await decodeCourse(ta.value));
          if (!l) throw new Error('コースの形式が違います');
          if (PLAY && l.lanes !== 3) throw new Error('テストプレイ版は3レーンのコースだけ読み込めます');
          setLayout(l); closeSheet();
          toast(`「${l.name}」を読み込みました。残したいときは保存枠に保存してください`);
        } catch (e) { note.textContent = '読み込めません: ' + (e instanceof Error ? e.message : String(e)); }
      }),
    );
    b.append(ta, note, row, btn('← メニューへ', menuMain));
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
  { key: 'slopeAngle', name: 'スロープの斜面の角度' },
  { key: 'slopeEntryFlat', name: 'スロープの登り口の平らな長さ' },
  { key: 'waveLength', name: 'ウェーブの長さ' },
  { key: 'waveSwing', name: 'ウェーブの左右の振れ幅（片側）' },
  { key: 'waveCount', name: 'ウェーブの往復の回数' },
  { key: 'laneChangeLength', name: '立体交差の長さ' },
  { key: 'laneChangeRise', name: '立体交差の高さ' },
  { key: 'shiftLength', name: 'シフトチェンジの長さ' },
  { key: 'shiftOffset', name: 'シフトチェンジの横ずれ' },
  { key: 'bumpRise', name: 'バウンドの高さ' },
  { key: 'humpRise', name: 'こぶの高さ' },
  { key: 'steepRise', name: '急スロープの高さ' },
  { key: 'steepAngle', name: '急スロープの斜面の角度' },
  { key: 'mtnRise', name: '大山の高さ（実物は1200mm）' },
  { key: 'dropRise', name: '大坂の高さ' },
  { key: 'gapLength', name: '切れ目ジャンプの切れ目' },
  { key: 'hopGap', name: '飛び移りチェンジの切れ目' },
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
  if (key === 'slopeBendRadius' || key === 'slopeAngle' || key === 'slopeEntryFlat' || key === 'slopeRise' || key === 'slopeLength') {
    const d = slopeDims(lanes, ov);
    const avg = Math.atan2(dimOfLayout(lanes, 'slopeRise'), dimOfLayout(lanes, 'slopeLength')) * 180 / Math.PI;
    return `計算（推定）: 斜面の角度 ${(d.angleRad * 180 / Math.PI).toFixed(1)}°（平均の勾配 ${avg.toFixed(1)}° が下限）・斜面${Math.round(d.slopeLen)}mm${d.shrunk ? `（半径を${Math.round(d.radius)}mm・${Math.round(d.radius2 ?? d.radius)}mmに縮める）` : ''}`;
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
// 保存できない環境（プライベートブラウズ・保存の制限）なら最初に知らせる
if (!saveStore()) toast('このブラウザでは保存できない状態です。作ったコースは「メニュー →コースを送る」の共有コードで控えてください');
