import { CATEGORIES, defaultBuild, options, parseBrake, type Build, type BrakeEnd, type Category } from './setup';
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
  presetV?: number; // オススメセットアップを入れた版（テスト状態のとき1回だけ入れる）
  slotsBackup?: Build[]; // オススメを入れる前の5台（戻したいとき用の控え）
}

export const SLOT_COUNT = 5;

// テスト状態で最初から入っているオススメセットアップ（マシン1〜5、5が最速仕様）。
// 俯瞰モードの見本コース2本で測って、1→5の順に速くなる並びにしてある（数値は仮）。
// 4・5は速いぶん、ブーストしたままジャンプへ入るとコースの外へ飛び出しやすい
export const PRESET_V = 1;
export const PRESET_NAMES = ['安定入門', 'バランス', '加速重視', '高速コーナー', '最速仕様'];
const PRESETS: Partial<Build>[] = [
  { body: 'slider', motor: 'bal2', rollerF: 'lowFriction', rollerR: 'lowFriction', bumperF: 'frp', bumperR: 'frp', wingR: 'small',
    damperF: 'light', damperR: 'light', brakeR: 'mid-mid-mid' },
  { body: 'twin', motor: 'bal3', booster: 'twin2', shaft: 'bearing', rollerF: 'bearing', rollerR: 'lowFriction', bumperF: 'frp', bumperR: 'frp',
    wingR: 'small', damperF: 'medium', damperR: 'light', brakeR: 'mid-weak-axle' },
  { body: 'cyclone', chassis: 'ff4', motor: 'bal3', booster: 'twin3', battery: 'quick', shaft: 'bearing', rollerF: 'doubleBearing', rollerR: 'bearing',
    bumperF: 'carbon', bumperR: 'frp', wingF: 'small', wingR: 'small', damperF: 'medium', damperR: 'medium', suspension: 'soft', brakeR: 'mid-weak-axle' },
  { body: 'wallrunner', chassis: 'ff4', motor: 'pow4', booster: 'quad1', battery: 'quick', compound: 'hard', shaft: 'reinforced',
    rollerF: 'lowFrictionBearing', rollerR: 'lowFrictionBearing', bumperF: 'carbon', bumperR: 'carbon', layout: 'front', wingF: 'large', wingR: 'small',
    damperF: 'heavy', damperR: 'light', suspension: 'sport', brakeF: 'mid-weak-axle', brakeR: 'mid-weak-axle' },
  { body: 'stormShifter', chassis: 'ff4', motor: 'bal5', booster: 'quad1', battery: 'quick', gear: 'g32', compound: 'slick', tireSize: 'small',
    shaft: 'reinforced', rollerF: 'superLowFriction', rollerR: 'superLowFriction', bumperF: 'hardCarbon', bumperR: 'carbon', wingF: 'large', wingR: 'large',
    damperR: 'light', suspension: 'sport', brakeF: 'mid-weak-axle', brakeR: 'low-strong-out' },
];
export const presetBuilds = (): Build[] => PRESETS.map((p) => ({ ...defaultBuild(), ...p }) as Build);

const ownedKey = (c: Category, id: string) => `${c}:${id}`;

function fresh(): SaveData {
  const owned: Record<string, true> = {};
  for (const c of CATEGORIES) for (const o of options(c.key)) if (!o.price) owned[ownedKey(c.key, o.id)] = true;
  const slots = presetBuilds();
  return { coins: 500, owned, cleared: {}, upgrades: {}, tunes: {}, build: { ...slots[0] }, event: CAREER[0].id,
    slots, slot: 0, testMode: true, colors: Array(SLOT_COUNT).fill(0), presetV: PRESET_V };
}

export function loadSave(): SaveData {
  const data = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved) {
      data.build = defaultBuild(); // 保存データがあるときは、オススメではなく保存された組み合わせから作る
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
        if (typeof id === 'string' && isOwned(data, c.key, id)) data.build[c.key] = id;
      }
      // スポンジブレーキ（保存データに無い・持っていないときは付けない）
      for (const end of ['F', 'R'] as const) {
        const code = saved.build?.[`brake${end}`];
        if (typeof code === 'string' && parseBrake(code) && brakeOwned(data, end)) data.build[`brake${end}`] = code;
      }
      // テスト状態の保存データには、オススメセットアップを1回だけ入れる（前の5台は控えに残す）
      if (Array.isArray(saved.slotsBackup)) data.slotsBackup = saved.slotsBackup;
      data.presetV = Number(saved.presetV) || 0;
      if (data.testMode && data.presetV < PRESET_V) {
        data.slots[data.slot] = { ...data.build };
        data.slotsBackup = data.slots;
        data.slots = presetBuilds();
        data.build = { ...data.slots[data.slot] };
        data.presetV = PRESET_V;
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
  for (const end of ['F', 'R'] as const) if (!parseBrake(b[`brake${end}`]) || !brakeOwned(data, end)) delete b[`brake${end}`];
  data.build = b;
}
// スポンジブレーキ: 前後それぞれ1回買えば所持（"brakeF:sponge" / "brakeR:sponge"）
export const brakeOwned = (data: SaveData, end: BrakeEnd) => data.testMode || !!data.owned[`brake${end}:sponge`];
export const markBrake = (data: SaveData, end: BrakeEnd) => {
  data.owned[`brake${end}:sponge`] = true;
};
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
