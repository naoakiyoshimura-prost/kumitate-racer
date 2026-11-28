// リバティーコア（＝AIチップ）のレベル。ストーリーの進み具合で上がるレベルキャップ（2026-11-13 店長決定・体系案 v02）
// コアLvが「お店で買える部品の★」と「改造の上限」を決める。お金では上がらない。
// レベルはセーブに持たず、「どの大会で1位を取ったか（cleared）」から毎回計算する（古いセーブも壊れない）。
// 上がる条件は仮: 今は大会のクラス（★1大会を全部1位→Lv2…）。街・章ができたら CORE_LEVELS の need を差し替える
import { CAREER } from './events';
import type { Tier } from './setup';

export interface CoreLevel {
  lv: number;
  maxStar: number; // お店で買える部品の★の上限
  maxUpgrade: number; // 改造の上限（+段階）
  need: Tier | null; // このクラスの大会を全部1位で到達（null＝最初から）
  label: string; // 仮の説明（街・章ができたら差し替え）
}
export const CORE_LEVELS: CoreLevel[] = [
  { lv: 1, maxStar: 1, maxUpgrade: 1, need: null, label: '1つ目の街 前半（仮）' },
  { lv: 2, maxStar: 2, maxUpgrade: 2, need: 'N', label: '1つ目の街 後半（★1大会を全部1位、仮）' },
  { lv: 3, maxStar: 3, maxUpgrade: 3, need: 'T', label: '1つ目の街クリア（★2大会を全部1位、仮）' },
  { lv: 4, maxStar: 4, maxUpgrade: 3, need: 'H', label: '2つ目の街 途中（★3大会を全部1位、仮）' },
  { lv: 5, maxStar: 5, maxUpgrade: 3, need: 'R', label: '2つ目の街クリア（★4大会を全部1位、仮）' },
];

// 今のコアLv。全開放（テスト用）なら最高
export function coreLevel(cleared: Record<string, true>, testMode = false): CoreLevel {
  if (testMode) return CORE_LEVELS[CORE_LEVELS.length - 1];
  let cur = CORE_LEVELS[0];
  for (const l of CORE_LEVELS) {
    if (!l.need) continue;
    const evs = CAREER.filter((e) => (e.class ?? 'N') === l.need);
    if (evs.length && evs.every((e) => cleared[e.id])) cur = l;
    else break;
  }
  return cur;
}
// その★の部品が買えるようになるコアLv
export const coreLvForStar = (star: number) => CORE_LEVELS.find((l) => l.maxStar >= star)?.lv ?? CORE_LEVELS.length;
export const coreLvForUpgrade = (n: number) => CORE_LEVELS.find((l) => l.maxUpgrade >= n)?.lv ?? CORE_LEVELS.length;
