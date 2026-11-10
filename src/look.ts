// デザイン見本（仮・見た目だけ）: 自分のマシンの3Dの形だけを、作り込んだボディの見本に差し替える。
// 性能・値段・装着ボディ・セーブデータには入れない（parts.json にも足さない）。
// URL の ?look=<id> で開くか、ガレージの「見本」で選ぶ。選んだものは URL に書き戻すので、再読み込みやモード切替でも残る
export const LOOKS: { id: string; name: string; maker: string }[] = [
  { id: 'vector', name: 'ベクター', maker: 'FALKREUT' },
  { id: 'crimson', name: 'クリムゾン', maker: 'VETRA' },
  { id: 'pearl', name: 'パール', maker: 'ORBEL' },
  { id: 'clover', name: 'クローバー', maker: 'WESTMERE' },
  { id: 'ivory', name: 'アイボリー', maker: 'IRONRIDGE' },
  { id: 'regent', name: 'リージェント', maker: 'NORDVEIL' },
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
