import { isRebuilt } from './courses';
import { presetBuilds } from './save';
import type { Build } from './setup';
import type { LaneCount, Layout, PieceSpec } from './editor/types';
import { PLAY_SET } from './storage';
import { TEST_COURSES, type TestCourseId } from './playCourses';

// テストプレイ用（storage.ts PLAY）に出す3台。構成はオススメセットアップ（save.ts PRESETS）から選び、ドライバーを車ごとに固定する。
// どの3台・どのドライバーにするかは仮（店長の指定待ち）。実在の人物を元にしたドライバーは配布用に入れない
type PlayCar = { name: string; preset: number; driver: string; note: string; brakeF?: string; brakeR?: string; noBrake?: boolean; build?: Partial<Build> };
const BASE_CARS: PlayCar[] = [
  { name: 'マシンA 安定', preset: 0, driver: 'kenta', note: 'マシンA: 落ちにくい入門向け。まずはこれでコースを1周。' },
  // マシンB のリヤブレーキ: オススメの「中・弱・軸寄り」はスロープの谷にほぼ届かず効かなかった（店長指摘の既知の件）。
  // 「低・強・軸寄り」はバンクの入りでは当たらず谷で当たる（npm run brakesim の表）。飛距離 3.4→3.0枚（2026-11-12 測定、仮）
  { name: 'マシンB バランス', preset: 1, driver: 'anna', note: 'マシンB: 速さと安定の中間。', brakeR: 'low-strong-axle' },
  { name: 'マシンC 最速', preset: 4, driver: 'kakeru', note: 'マシンC: いちばん速いが、ブーストしたままジャンプに入ると飛び出しやすい。' },
];
// テストプレイ（セッティング）の5台（2026-11-19 店長「1〜3段階は明確に速度差、4は24mm両軸で安定感と加速力・最高速のバランスに優れジャンプに強い、
// 5は22mm片軸超高回転・軽量で圧倒的に平面路面が速い」）。土台はオススメセットアップ（preset）で、build で部位を上書きする。ブレーキは外した状態から。
// 測定は tools/setcars.ts（3レーン・ブーストなし）。両軸＝中央モーターの C型4WD、片軸＝後ろ置きモーターの RR型4WD で表す（ゲームのシャーシの中で一番近いもの）
export const SET_CARS: PlayCar[] = [
  // 2026-11-19 店長「4でもまだ加速力ありすぎる、このセットアップで26秒ぴったり」「4を詰めた構成で25.0秒」: 実物寄りの速度感（mini.json realFeel）。最高速が下がったぶん1〜3はギヤ（5:1/4.5:1/4:1）で段差を付けた。
  // 2026-11-19 店長「店長のコースを3周で、テストマシン3が29〜30秒、4と5が25.8〜26.5秒くらいの速度感」: 時間の倍率（mini.json speed.setRatio）と構成で合わせた。
  // 店長のコースはコーナーが多く、今の計算ではコーナーの速さの上限（シャーシの低速コーナーの得意不得意）でタイムがほぼ決まる。1〜3は同じシャーシ（FR）でモーターとギヤとローラーだけ変えて段差を付けた
  { name: 'マシン1 入門', preset: 0, driver: 'kenta', note: 'マシン1: いちばん遅いが素直。まずはこれで1周。', noBrake: true,
    build: { body: 'cyclone', chassis: 'fr', motor: 'bal1', gear: 'g50', rollerF: 'plastic', rollerR: 'plastic', compound: 'soft', battery: 'quick', shaft: 'bushing', wingF: 'none', wingR: 'small', damperF: 'medium', damperR: 'light' } },
  { name: 'マシン2 中級', preset: 0, driver: 'anna', note: 'マシン2: マシン1より一段速い。', noBrake: true,
    build: { body: 'cyclone', chassis: 'fr', motor: 'bal1', gear: 'g45', rollerF: 'bearing', rollerR: 'lowFriction', battery: 'quick', shaft: 'bushing', wingF: 'none', wingR: 'small', damperF: 'medium', damperR: 'light' } },
  { name: 'マシン3 上級', preset: 0, driver: 'mina', note: 'マシン3: さらに一段速い。', noBrake: true,
    build: { body: 'cyclone', chassis: 'fr', motor: 'bal1', gear: 'g40', rollerF: 'bearing', rollerR: 'lowFriction', battery: 'quick', shaft: 'bushing', wingF: 'none', wingR: 'small', damperF: 'medium', damperR: 'light' } },
  { name: 'マシン4 両軸24mm', preset: 2, driver: 'reina', note: 'マシン4: 24mmタイヤの両軸（中央モーター）。安定・加速・最高速のバランス型で、ジャンプに強い。', noBrake: true,
    // 2026-11-19 店長「4・5は★4装備、タイヤはエクストラハード（低摩擦）、この装備をベースに再調整、今23秒くらいなのでまだ10%ぐらい遅くしていい」: ★4まで（R）の部品で組み、realFeel で約1割遅くした
    build: { chassis: 'std4', motor: 'bal4', gear: 'g32', compound: 'extraHard', tireSize: 'small', tireMm: '24', rollerF: 'superLowFriction', rollerR: 'superLowFriction', bumperF: 'hardCarbon', bumperR: 'hardCarbon', wingF: 'none', wingR: 'none', damperF: 'heavy', damperR: 'medium', suspension: 'sport', thrust: '5', rollerStage: '2', rollerRing: '1', stabi: '1' } },
  { name: 'マシン5 片軸22mm', preset: 4, driver: 'kakeru', note: 'マシン5: 22mmタイヤの片軸（後ろ置きモーター）超高回転・軽量。最高速がいちばん高く平らな所は圧倒的だが、ジャンプの着地で跳ねやすい。ブレーキは前後とも最初から付けてある（外すと下りでコースアウトしやすい）。', brakeF: 'mid-mid-mid', brakeR: 'mid-mid-mid',
    // 2026-11-19 店長「（5は）いったん（ブレーキを）設定しておいて」→★4装備にしたとき前後 中・中・中（強だと4より遅くなる）。店長のコースでコースアウト0
    build: { body: 'twin', chassis: 'rr4', motor: 'spd4', gear: 'g32', compound: 'extraHard', tireSize: 'tiny', tireMm: '22', rollerF: 'superLowFriction', rollerR: 'superLowFriction', rollerRing: '1', thrust: '7', wingF: 'none', wingR: 'none', damperF: 'heavy', damperR: 'heavy', suspension: 'none', shaft: 'bushing', bumperF: 'hardCarbon', bumperR: 'hardCarbon' } },
];
export const PLAY_CARS: PlayCar[] = PLAY_SET ? SET_CARS : BASE_CARS;
// 確認用: ?brake=preset でオススメセットアップのブレーキを付けたまま始める（ブレーキあり・なしの比較を測るため）
// 確認用: ?brakes=高さ-強さ-場所 で前後とも同じブレーキを付けて始める（店長の実走の条件を再現して測るため）
const BRAKES = (() => { try { return new URLSearchParams(location.search).get('brakes') ?? ''; } catch { return ''; } })();
// 確認用: ?over={"motor":"spd5",...} で構成の一部を上書きして始める（店長の組んだ構成を測るため）
const OVER = (() => { try { return JSON.parse(new URLSearchParams(location.search).get('over') ?? '{}') as Partial<Build>; } catch { return {}; } })();
const KEEP_BRAKE = (() => { try { return new URLSearchParams(location.search).get('brake') === 'preset'; } catch { return false; } })();
// セッティングの車の構成（測定ツール用にも出す）
export const setBuild = (i: number): Build => {
  const c = SET_CARS[i] ?? SET_CARS[0];
  return { ...presetBuilds()[c.preset], ...(c.build ?? {}), driver: c.driver, brakeF: undefined, brakeR: undefined } as Build;
};
export const playBuild = (i: number): Build => {
  const c = PLAY_CARS[i] ?? PLAY_CARS[0];
  return { ...presetBuilds()[c.preset], ...(c.build ?? {}), driver: c.driver, ...(c.brakeF ? { brakeF: c.brakeF } : {}), ...(c.brakeR ? { brakeR: c.brakeR } : {}), ...(c.noBrake && !KEEP_BRAKE ? { brakeF: undefined, brakeR: undefined } : {}), ...(BRAKES ? { brakeF: BRAKES, brakeR: BRAKES } : {}), ...OVER };
};

// テストプレイ用のコース: (1) エディタの3レーン部品で組んだテストコース（仮の並び）、(2) 大きいオーバル、(3) コースエディタで作ったコース
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
export const PLAY_LAYOUT: Layout = {
  version: 1, name: 'テストコース', lanes: 3,
  pieces: [{ type: 'start' }, S, { type: 'hump' }, S, S, { type: 'bump' }, S, S, S, S, L, L, L, L, { type: 'laneChange' }, { type: 'wave' }, S, S, S, S, S, S, L, L, L, L],
};
export const PLAY_EVENT = 'free-oval-walled'; // 大きいオーバル（仕切りレーン）。CPU の構成もこの大会のものを使う
export type PlayCourse = 'test' | 'oval' | 'custom' | 'stechal2026' | 'circuit' | 'circuitBig' | 'circuitBigW' | 'circuitGP' | TestCourseId | `r3${string}`;
const COURSE_KEY = 'kumitate-racer.playCourse';
const CUSTOM_KEY = 'kumitate-racer.customCourse';
export const hasCustom = () => { try { return !!localStorage.getItem(CUSTOM_KEY); } catch { return false; } };
export function playCourse(): PlayCourse {
  try {
    // エディタの「走る」から来たとき（?course=custom）は、作ったコースを選んだことにする
    if (new URLSearchParams(location.search).get('course') === 'custom') localStorage.setItem(COURSE_KEY, 'custom');
    const v = localStorage.getItem(COURSE_KEY);
    // テストプレイ（セッティング）はテストコース3種・2026チャレンジコース・前回の配布版のコース（テストコース、大きいオーバル）・作ったコース（2026-11-20 店長「前回と同じく何種類かいれとく」）
    if (PLAY_SET && isRebuilt(v)) return v as PlayCourse;
    if (PLAY_SET) return TEST_COURSES.some((c) => c.id === v) ? (v as TestCourseId) : v === 'stechal2026' || v === 'test' || v === 'oval' ? v : v === 'custom' && hasCustom() ? 'custom' : 'tc1';
    return v === 'oval' ? 'oval' : v === 'circuit' || v === 'circuitBig' || v === 'circuitGP' ? v : v === 'circuitBigW' ? 'circuitBig' : v === 'custom' && hasCustom() ? 'custom' : 'test';
  } catch { return 'test'; }
}
// 選び直したら読み込み直す（コースは起動時に1回だけ組み立てるため）
export function setPlayCourse(c: PlayCourse) {
  try { localStorage.setItem(COURSE_KEY, c); } catch { /* */ }
  const u = new URL(location.href);
  u.searchParams.delete('course');
  location.href = u.toString();
}

// コースアウトの重さ（mini.json courseOut.levels のキー）。テストプレイで選び、ブラウザに覚えておく
const OUT_KEY = 'kumitate-racer.outLevel';
export const OUT_LEVELS: [string, string][] = [['old', '今まで'], ['light', '軽'], ['mid', '中'], ['hard', '重（リタイア）']];
export function outLevel(): string {
  try { const v = localStorage.getItem(OUT_KEY); if (v && OUT_LEVELS.some(([k]) => k === v)) return v; } catch { /* */ }
  return 'mid';
}
export function setOutLevel(v: string) { try { localStorage.setItem(OUT_KEY, v); } catch { /* */ } }

// テストコースのレーン数（3 / 5）。ブラウザに覚えておき、変えたら読み込み直す
const LANES_KEY = 'kumitate-racer.playLanes';
export function playLanes(): LaneCount {
  try { return localStorage.getItem(LANES_KEY) === '5' ? 5 : 3; } catch { return 3; }
}
export function setPlayLanes(n: LaneCount) {
  try { localStorage.setItem(LANES_KEY, String(n)); } catch { /* */ }
  location.reload();
}

// コースの色（2026-11-19 店長「circuit風カラーと模型風カラーに分ける」）。model=模型風（部品ごとの基準色）、straight=直線・ウェーブ・LCの色。変えたら読み込み直す
const LOOK_KEY = 'kumitate-racer.courseLook';
const STRAIGHT_KEY = 'kumitate-racer.straightColor';
export function courseLook(): { model: boolean; straight: string } {
  try { return { model: localStorage.getItem(LOOK_KEY) !== 'circuit', straight: localStorage.getItem(STRAIGHT_KEY) ?? 'white' }; } catch { return { model: true, straight: 'white' }; }
}
export function setCourseLook(model: boolean | null, straight?: string) {
  try {
    if (model !== null) localStorage.setItem(LOOK_KEY, model ? 'model' : 'circuit');
    if (straight) localStorage.setItem(STRAIGHT_KEY, straight);
  } catch { /* */ }
  location.reload();
}
