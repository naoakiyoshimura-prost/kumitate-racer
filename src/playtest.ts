import { presetBuilds } from './save';
import type { Build } from './setup';
import type { LaneCount, Layout, PieceSpec } from './editor/types';
import { PLAY_SET } from './storage';
import { TEST_COURSES, type TestCourseId } from './playCourses';

// テストプレイ用（storage.ts PLAY）に出す3台。構成はオススメセットアップ（save.ts PRESETS）から選び、ドライバーを車ごとに固定する。
// どの3台・どのドライバーにするかは仮（店長の指定待ち）。実在の人物を元にしたドライバーは配布用に入れない
type PlayCar = { name: string; preset: number; driver: string; note: string; brakeR?: string; noBrake?: boolean };
const BASE_CARS: PlayCar[] = [
  { name: 'マシンA 安定', preset: 0, driver: 'kenta', note: 'マシンA: 落ちにくい入門向け。まずはこれでコースを1周。' },
  // マシンB のリヤブレーキ: オススメの「中・弱・軸寄り」はスロープの谷にほぼ届かず効かなかった（店長指摘の既知の件）。
  // 「低・強・軸寄り」はバンクの入りでは当たらず谷で当たる（npm run brakesim の表）。飛距離 3.4→3.0枚（2026-11-12 測定、仮）
  { name: 'マシンB バランス', preset: 1, driver: 'anna', note: 'マシンB: 速さと安定の中間。', brakeR: 'low-strong-axle' },
  { name: 'マシンC 最速', preset: 4, driver: 'kakeru', note: 'マシンC: いちばん速いが、ブーストしたままジャンプに入ると飛び出しやすい。' },
];
// テストプレイ（セッティング）の5台（2026-11-19 店長「テストマシン5台、ブレーキセッティング可能、ブーストなし」）。オススメセットアップ5種そのままの構成で、
// ブレーキは外した状態から始める（最初から付けるかは数字を見て店長が決める）。ドライバーは顔の絵がある人物から（実在の人物は入れない）
const SET_CARS: PlayCar[] = [
  { name: 'マシンA 安定', preset: 0, driver: 'kenta', note: 'マシンA: 落ちにくい入門向け。', noBrake: true },
  { name: 'マシンB バランス', preset: 1, driver: 'anna', note: 'マシンB: 速さと安定の中間。', noBrake: true },
  { name: 'マシンC 加速', preset: 2, driver: 'mina', note: 'マシンC: 立ち上がりの加速が得意。', noBrake: true },
  { name: 'マシンD コーナー', preset: 3, driver: 'reina', note: 'マシンD: 高速コーナーが得意。', noBrake: true },
  { name: 'マシンE 最速', preset: 4, driver: 'kakeru', note: 'マシンE: いちばん速いが、ジャンプで飛び出しやすい。', noBrake: true },
];
export const PLAY_CARS: PlayCar[] = PLAY_SET ? SET_CARS : BASE_CARS;
// 確認用: ?brake=preset でオススメセットアップのブレーキを付けたまま始める（ブレーキあり・なしの比較を測るため）
const KEEP_BRAKE = (() => { try { return new URLSearchParams(location.search).get('brake') === 'preset'; } catch { return false; } })();
export const playBuild = (i: number): Build => {
  const c = PLAY_CARS[i] ?? PLAY_CARS[0];
  return { ...presetBuilds()[c.preset], driver: c.driver, ...(c.brakeR ? { brakeR: c.brakeR } : {}), ...(c.noBrake && !KEEP_BRAKE ? { brakeF: undefined, brakeR: undefined } : {}) };
};

// テストプレイ用のコース: (1) エディタの3レーン部品で組んだテストコース（仮の並び）、(2) 大きいオーバル、(3) コースエディタで作ったコース
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
export const PLAY_LAYOUT: Layout = {
  version: 1, name: 'テストコース', lanes: 3,
  pieces: [{ type: 'start' }, S, { type: 'hump' }, S, S, { type: 'bump' }, S, S, S, S, L, L, L, L, { type: 'laneChange' }, { type: 'wave' }, S, S, S, S, S, S, L, L, L, L],
};
export const PLAY_EVENT = 'free-oval-walled'; // 大きいオーバル（仕切りレーン）。CPU の構成もこの大会のものを使う
export type PlayCourse = 'test' | 'oval' | 'custom' | 'circuit' | 'circuitBig' | 'circuitBigW' | 'circuitGP' | TestCourseId;
const COURSE_KEY = 'kumitate-racer.playCourse';
const CUSTOM_KEY = 'kumitate-racer.customCourse';
export const hasCustom = () => { try { return !!localStorage.getItem(CUSTOM_KEY); } catch { return false; } };
export function playCourse(): PlayCourse {
  try {
    // エディタの「走る」から来たとき（?course=custom）は、作ったコースを選んだことにする
    if (new URLSearchParams(location.search).get('course') === 'custom') localStorage.setItem(COURSE_KEY, 'custom');
    const v = localStorage.getItem(COURSE_KEY);
    // テストプレイ（セッティング）はテストコース3種と作ったコースだけ（2026-11-19 店長「テストコースは3種くらいでいい」）
    if (PLAY_SET) return TEST_COURSES.some((c) => c.id === v) ? (v as TestCourseId) : v === 'custom' && hasCustom() ? 'custom' : 'tc1';
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
