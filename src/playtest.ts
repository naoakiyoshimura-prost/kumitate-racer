import { presetBuilds } from './save';
import type { Build } from './setup';
import type { Layout, PieceSpec } from './editor/types';

// テストプレイ用（storage.ts PLAY）に出す3台。構成はオススメセットアップ（save.ts PRESETS）から選び、ドライバーを車ごとに固定する。
// どの3台・どのドライバーにするかは仮（店長の指定待ち）。実在の人物を元にしたドライバーは配布用に入れない
export const PLAY_CARS: { name: string; preset: number; driver: string; note: string }[] = [
  { name: 'マシンA 安定', preset: 0, driver: 'kenta', note: 'マシンA: 落ちにくい入門向け。まずはこれでコースを1周。' },
  { name: 'マシンB バランス', preset: 1, driver: 'anna', note: 'マシンB: 速さと安定の中間。' },
  { name: 'マシンC 最速', preset: 4, driver: 'kakeru', note: 'マシンC: いちばん速いが、ブーストしたままジャンプに入ると飛び出しやすい。' },
];
export const playBuild = (i: number): Build => {
  const c = PLAY_CARS[i] ?? PLAY_CARS[0];
  return { ...presetBuilds()[c.preset], driver: c.driver };
};

// テストプレイ用のコース: (1) エディタの3レーン部品で組んだテストコース（仮の並び）、(2) 大きいオーバル、(3) コースエディタで作ったコース
const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
export const PLAY_LAYOUT: Layout = {
  version: 1, name: 'テストコース', lanes: 3,
  pieces: [{ type: 'start' }, S, { type: 'hump' }, S, S, { type: 'bump' }, S, S, L, L, L, L, { type: 'laneChange' }, { type: 'wave' }, S, S, S, S, S, L, L, L, L],
};
export const PLAY_EVENT = 'free-oval-walled'; // 大きいオーバル（仕切りレーン）。CPU の構成もこの大会のものを使う
export type PlayCourse = 'test' | 'oval' | 'custom';
const COURSE_KEY = 'kumitate-racer.playCourse';
const CUSTOM_KEY = 'kumitate-racer.customCourse';
export const hasCustom = () => { try { return !!localStorage.getItem(CUSTOM_KEY); } catch { return false; } };
export function playCourse(): PlayCourse {
  try {
    // エディタの「走る」から来たとき（?course=custom）は、作ったコースを選んだことにする
    if (new URLSearchParams(location.search).get('course') === 'custom') localStorage.setItem(COURSE_KEY, 'custom');
    const v = localStorage.getItem(COURSE_KEY);
    return v === 'oval' ? 'oval' : v === 'custom' && hasCustom() ? 'custom' : 'test';
  } catch { return 'test'; }
}
// 選び直したら読み込み直す（コースは起動時に1回だけ組み立てるため）
export function setPlayCourse(c: PlayCourse) {
  try { localStorage.setItem(COURSE_KEY, c); } catch { /* */ }
  const u = new URL(location.href);
  u.searchParams.delete('course');
  location.href = u.toString();
}
