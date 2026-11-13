// デザイン見本（仮・見た目だけ）: 自分のマシンの3Dの形だけを、作り込んだボディの見本に差し替える。
// 性能・値段・装着ボディ・セーブデータには入れない（parts.json にも足さない）。
// URL の ?look=<id> で開くか、ガレージの「見本」で選ぶ。選んだものは URL に書き戻すので、再読み込みやモード切替でも残る
// maker は国産6社への割り振り（2026-11-13 店長「今作った車体は国産扱いに割り振ってよい」。parts.json machineSets）。カタログ上の元の所属はコメントに残す
export const LOOKS: { id: string; name: string; maker: string }[] = [
  { id: 'vector', name: 'ベクター', maker: 'ROKKA' }, // カタログ: FALKREUT
  { id: 'crimson', name: 'クリムゾン', maker: 'TATSUNO' }, // カタログ: VETRA
  { id: 'pearl', name: 'パール', maker: 'MIKAGE' }, // カタログ: ORBEL
  { id: 'clover', name: 'クローバー', maker: 'AKASHI' }, // カタログ: WESTMERE
  { id: 'ivory', name: 'アイボリー', maker: 'HARIMA' }, // カタログ: IRONRIDGE
  { id: 'regent', name: 'リージェント', maker: 'NARUO' }, // カタログ: NORDVEIL
  // STELLA: 部位キット版（src/bodykit）。シャーシ追従・自前のブーストポッド（ブースター部品の形は出さない）。ポッドの動きは ?pod=A|B|C
  { id: 'stella', name: 'STELLA', maker: 'ORIGINAL' },
];
const valid = (id: string | null) => (id && LOOKS.some((l) => l.id === id) ? id : null);
let current = typeof location === 'undefined' ? null : valid(new URLSearchParams(location.search).get('look'));

export const getLook = () => current;
export const lookName = (id: string | null) => LOOKS.find((l) => l.id === id)?.name ?? 'なし';
export function setLook(id: string | null) {
  current = valid(id);
  try {
    const u = new URL(location.href);
    if (current) u.searchParams.set('look', current);
    else u.searchParams.delete('look');
    history.replaceState(history.state, '', u.toString());
  } catch {
    // URL を書き換えられなくても、この画面の中では効く
  }
}
