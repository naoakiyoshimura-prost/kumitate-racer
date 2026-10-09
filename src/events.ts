import type { Build } from './setup';
import events from './data/events.json';

// レース（大会）。free はフリー走行（コスト上限なし・賞金なし）
export interface RaceEvent {
  id: string;
  name: string;
  course: string;
  free?: boolean;
  costCap?: number; // マシン合計コストの上限
  singleCap?: number; // パーツ1つあたりのコスト上限
  reward?: [number, number]; // 1位, 2位の賞金
  cpu?: Partial<Build>; // CPUのセッティング（標準からの差分）
}

export const EVENTS = events as RaceEvent[];
export const eventById = (id: string) => EVENTS.find((e) => e.id === id) ?? EVENTS[0];
// フリー走行以外の大会（並び順＝解放順）
export const CAREER = EVENTS.filter((e) => !e.free);
