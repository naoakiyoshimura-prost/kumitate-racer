import { CATEGORIES, defaultBuild, options, type Build, type Category } from './setup';
import { CAREER } from './events';
import renamed from './data/renamed.json';

// 所持金・所持パーツ・クリア状況・セッティング。端末（ブラウザ）にだけ保存する
const KEY = 'kumitate-racer.save.v1';

export interface SaveData {
  coins: number;
  owned: Record<string, true>; // "category:id"
  cleared: Record<string, true>; // 1位を取った大会
  upgrades: Record<string, number>; // "category:id" → 改造段階
  build: Build;
  event: string;
}

const ownedKey = (c: Category, id: string) => `${c}:${id}`;

function fresh(): SaveData {
  const owned: Record<string, true> = {};
  for (const c of CATEGORIES) for (const o of options(c.key)) if (!o.price) owned[ownedKey(c.key, o.id)] = true;
  return { coins: 500, owned, cleared: {}, upgrades: {}, build: defaultBuild(), event: CAREER[0].id };
}

export function loadSave(): SaveData {
  const data = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved) {
      data.coins = Number(saved.coins) || 0;
      Object.assign(data.owned, saved.owned);
      Object.assign(data.upgrades, saved.upgrades);
      // 旧版の前後共通パーツ（ローラー・ウィング・マスダンパー）は前後両方を所持扱いにする
      for (const key of Object.keys(saved.owned ?? {})) {
        const [c, id] = key.split(':');
        if (c === 'roller' || c === 'wing' || c === 'damper') {
          data.owned[`${c}F:${id}`] = true;
          data.owned[`${c}R:${id}`] = true;
        }
      }
      // 作り直したパーツ（モーター・ギヤ）の旧IDを新IDへ
      const RENAMED = renamed as Record<string, Record<string, string>>;
      for (const [c, map] of Object.entries(RENAMED)) {
        for (const [from, to] of Object.entries(map)) {
          if (saved.owned?.[`${c}:${from}`]) data.owned[`${c}:${to}`] = true;
          if (saved.upgrades?.[`${c}:${from}`]) data.upgrades[`${c}:${to}`] = saved.upgrades[`${c}:${from}`];
          if (saved.build?.[c] === from) saved.build[c] = to;
        }
      }
      Object.assign(data.cleared, saved.cleared);
      if (typeof saved.event === 'string') data.event = saved.event;
      for (const c of CATEGORIES) {
        const id = saved.build?.[c.key];
        if (data.owned[ownedKey(c.key, id)]) data.build[c.key] = id;
      }
    }
  } catch {
    // 保存なし・読めないときは最初から
  }
  return data;
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 保存できなくても遊べる
  }
}

export const isOwned = (data: SaveData, c: Category, id: string) => !!data.owned[ownedKey(c, id)];
export const markOwned = (data: SaveData, c: Category, id: string) => {
  data.owned[ownedKey(c, id)] = true;
};

export const upgradeLevel = (data: SaveData, c: Category, id: string) => data.upgrades[ownedKey(c, id)] ?? 0;
export const setUpgrade = (data: SaveData, c: Category, id: string, lv: number) => {
  data.upgrades[ownedKey(c, id)] = lv;
};
