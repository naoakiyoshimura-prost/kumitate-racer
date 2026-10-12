// 端末に保存するときのキー。URL に ?tester=1 を付けて開いたときは「テスター用」の別の保存場所を使う
// （ふだんの保存データを上書きしない）。テスター用は全パーツ・全大会を開放し、画面に「テスト版」と出す
// 注意: 合言葉ではなく誰でも使える目印。将来ランキングを入れるときは、テスター用の記録を除外すること
const params = new URLSearchParams(location.search);
export const TESTER = params.get('tester') === '1';
export const skey = (name: string) => (TESTER ? `${name}.tester` : name);
// ガレージ⇔ボディ工房のリンクに、テスター用の目印を引き継ぐ
export const keepQuery = (href: string) => (TESTER ? `${href}?tester=1` : href);
