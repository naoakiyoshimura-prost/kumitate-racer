import { CATEGORIES, defaultBuild, options, type Build, type Category } from './setup';
import { CAREER } from './events';
import renamed from './data/renamed.json';
import { TESTER, skey } from './storage';

// 所持金・所持パーツ・クリア状況・セッティング。端末（ブラウザ）にだけ保存する
const KEY = skey('kumitate-racer.save.v1');

export interface SaveData {
  coins: number;
  owned: Record<string, true>; // "category:id"
  cleared: Record<string, true>; // 1位を取った大会
  upgrades: Record<string, number>; // "category:id" → 改造段階
  tunes: Record<string, string>; // "category:id" → 改造の方向（無ければ標準）
  build: Build;
  event: string;
  slots: Build[]; // マシンの保存枠（5台）
  slot: number; // 今使っている枠
  testMode: boolean; // テスト用: 全パーツ・全大会を開放
  colors: number[]; // 保存枠ごとの車体カラー（PAINTS の番号）
}

export const SLOT_COUNT = 5;

const ownedKey = (c: Category, id: string) => `${c}:${id}`;

function fresh(): SaveData {
  const owned: Record<string, true> = {};
  for (const c of CATEGORIES) for (const o of options(c.key)) if (!o.price) owned[ownedKey(c.key, o.id)] = true;
  return { coins: 500, owned, cleared: {}, upgrades: {}, tunes: {}, build: defaultBuild(), event: CAREER[0].id,
    slots: Array.from({ length: SLOT_COUNT }, defaultBuild), slot: 0, testMode: true, colors: Array(SLOT_COUNT).fill(0) };
}

export function loadSave(): SaveData {
  const data = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved) {
      data.coins = Number(saved.coins) || 0;
      Object.assign(data.owned, saved.owned);
      Object.assign(data.upgrades, saved.upgrades);
      Object.assign(data.tunes, saved.tunes);
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
      if (typeof saved.testMode === 'boolean') data.testMode = saved.testMode;
      if (TESTER) data.testMode = true; // テスター用はいつでも全開放
      if (Array.isArray(saved.colors)) for (let i = 0; i < SLOT_COUNT; i++) data.colors[i] = Number(saved.colors[i]) || 0;
      if (Number.isInteger(saved.slot) && saved.slot >= 0 && saved.slot < SLOT_COUNT) data.slot = saved.slot;
      for (let i = 0; i < SLOT_COUNT; i++) data.slots[i] = { ...defaultBuild(), ...(saved.slots?.[i] ?? (i === data.slot ? saved.build : {})) };
      for (const c of CATEGORIES) {
        const id = saved.build?.[c.key];
        if (isOwned(data, c.key, id)) data.build[c.key] = id;
      }
    }
  } catch {
    // 保存なし・読めないときは最初から
  }
  return data;
}

export function writeSave(data: SaveData) {
  data.slots[data.slot] = { ...data.build };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 保存できなくても遊べる
  }
}

export const isOwned = (data: SaveData, c: Category, id: string) =>
  ((data.testMode || (c === 'body' && id.startsWith('my'))) && options(c).some((o) => o.id === id)) || !!data.owned[ownedKey(c, id)];

// 保存枠を切り替える。持っていないパーツは初期パーツに戻す
export function switchSlot(data: SaveData, n: number) {
  data.slots[data.slot] = { ...data.build };
  data.slot = n;
  const b = { ...defaultBuild(), ...data.slots[n] };
  for (const c of CATEGORIES) if (!isOwned(data, c.key, b[c.key])) b[c.key] = defaultBuild()[c.key];
  data.build = b;
}
export const markOwned = (data: SaveData, c: Category, id: string) => {
  data.owned[ownedKey(c, id)] = true;
};

export const upgradeLevel = (data: SaveData, c: Category, id: string) => data.upgrades[ownedKey(c, id)] ?? 0;
// チューンキット: 種類ごとに1回買えば所持（どのモーターにも付け替え自由）。純正標準は最初から
export const kitOwned = (data: SaveData, kit: string) => kit === 'std' || data.testMode || !!data.owned[`kit:${kit}`];
export const markKit = (data: SaveData, kit: string) => {
  data.owned[`kit:${kit}`] = true;
};
// そのモーターに付けているキット（持っていないキットは付いていない扱い＝純正標準）
export const tuneOf = (data: SaveData, c: Category, id: string) => {
  const kit = data.tunes[ownedKey(c, id)];
  return kit && kitOwned(data, kit) ? kit : undefined;
};
export const setTune = (data: SaveData, c: Category, id: string, kit: string) => {
  data.tunes[ownedKey(c, id)] = kit;
};
export const setUpgrade = (data: SaveData, c: Category, id: string, lv: number) => {
  data.upgrades[ownedKey(c, id)] = lv;
};
