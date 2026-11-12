// 端末に保存するときのキー。URL に ?tester=1 を付けて開いたときは「テスター用」の別の保存場所を使う
// （ふだんの保存データを上書きしない）。テスター用は全パーツ・全大会を開放し、画面に「テスト版」と出す
// 注意: 合言葉ではなく誰でも使える目印。将来ランキングを入れるときは、テスター用の記録を除外すること
const params = new URLSearchParams(location.search);
export const TESTER = params.get('tester') === '1';
// テストプレイ用（内容を絞った配布版）: URL に ?play=1、またはページ側で window.__playtest = true。
// マシンは決まった3台から選ぶだけ（改造なし）、ドライバーは車ごとに固定、ブーストは1段だけ、俯瞰モード固定。保存場所も別。
// コースエディタから戻ってきても続くように、同じタブの間は sessionStorage に覚えておく
const PLAY_KEY = 'kumitate-racer.play';
export const PLAY = (() => {
  const on = params.get('play') === '1' || (globalThis as { __playtest?: boolean }).__playtest === true;
  try {
    if (on) sessionStorage.setItem(PLAY_KEY, '1');
    return on || sessionStorage.getItem(PLAY_KEY) === '1';
  } catch { return on; }
})();
export const skey = (name: string) => (PLAY ? `${name}.play` : TESTER ? `${name}.tester` : name);
// ガレージ⇔ボディ工房のリンクに、テスター用の目印を引き継ぐ
export const keepQuery = (href: string) => (TESTER ? `${href}?tester=1` : href);
