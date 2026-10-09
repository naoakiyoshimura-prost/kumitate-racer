import type { Build, Tier } from './setup';
import events from './data/events.json';

// レース（大会）。free はフリー走行（コスト上限なし・賞金なし）
export interface RaceEvent {
  id: string;
  name: string;
  course: string;
  free?: boolean;
  costCap?: number; // マシン合計コストの上限
  singleCap?: number; // パーツ1つあたりのコスト上限
  class?: Tier; // 大会のクラス。自分のクラスより下の大会は賞金が減る
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
