import { STAR, buildCost, type Build, type Tier } from './setup';
import type { CourseMode } from './courses';
import events from './data/events.json';

// レース（大会）。free はフリー走行（コスト上限なし・賞金なし）
export interface RaceEvent {
  id: string;
  name: string;
  course: string;
  mode?: CourseMode; // コース形式（省略=open）。同じコースでも壁あり・レーンなしの大会にできる
  free?: boolean;
  costCap?: number; // マシン合計コストの上限
  singleCap?: number; // 旧: パーツ1つあたりのコスト上限（★上限に置き換えたので出場判定には使わない）
  class?: Tier; // 大会のクラス＝出られるマシンの★上限（N=★1 … EX=★5）。自分のクラスより下の大会は賞金が減る
  reward?: [number, number]; // 1位, 2位の賞金
  cpu?: Partial<Build>; // CPUのセッティング（標準からの差分）
  cpuLevel?: number; // CPUパーツの改造段階
}

export const EVENTS = events as RaceEvent[];
export const eventById = (id: string) => EVENTS.find((e) => e.id === id) ?? EVENTS[0];
// フリー走行以外の大会（並び順＝解放順）
export const CAREER = EVENTS.filter((e) => !e.free);

const CLASS_ORDER: Tier[] = ['N', 'T', 'H', 'R', 'EX'];

// いま挑戦できる一番上の大会のクラス
export function playerClass(cleared: Record<string, true>): Tier {
  let i = 0;
  while (i < CAREER.length - 1 && cleared[CAREER[i].id]) i++;
  return CAREER[i].class ?? 'N';
}

// 賞金の倍率: 自分より1クラス下は半分、2クラス下は1/4…（下位大会での荒稼ぎを効率悪くする）
export function prizeRate(ev: RaceEvent, cleared: Record<string, true>) {
  const diff = CLASS_ORDER.indexOf(playerClass(cleared)) - CLASS_ORDER.indexOf(ev.class ?? 'N');
  return diff <= 0 ? 1 : Math.max(0.1, 0.5 ** diff);
}

// 出場条件: マシンの★（装着パーツの★の最高値）が大会の★以下、かつ合計コストが上限以下。フリー走行は条件なし
export function entryCheck(ev: RaceEvent, build: Build) {
  const { total, star } = buildCost(build);
  const maxStar = ev.free ? 5 : STAR[ev.class ?? 'N'];
  const starOver = !ev.free && star > maxStar;
  const costOver = !ev.free && ev.costCap !== undefined && total > ev.costCap;
  return { ok: !starOver && !costOver, star, maxStar, total, starOver, costOver };
}
