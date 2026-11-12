import { PLAY } from './storage';

// テストプレイ用（配布版）を開いたとき最初に出す注意書き。「同意して遊ぶ」を押すまで操作できない。
// 他社名・商品名を出すのはこの注意書きの中だけ（店長の指示 2026-11-12）。同じタブで開き直したとき（エディタから戻ったときなど）は出さない
const KEY = 'kumitate-racer.playAgree';
export function showPlayGate() {
  if (!PLAY) return;
  try { if (sessionStorage.getItem(KEY) === '1') return; } catch { /* */ }
  const box = document.createElement('div');
  box.id = 'play-gate';
  box.innerHTML =
    '<div class="card"><h2>このアプリについて</h2>' +
    '<p>このアプリは、車の模型の走りやセッティングを試すために、有志が作っているテスト用の試作アプリです。</p>' +
    '<p><b>株式会社タミヤ（タミヤ模型）および同社の「ミニ四駆」とは一切関係ありません。</b>タミヤの製品や公式のアプリではありません。「ミニ四駆」は株式会社タミヤの登録商標です。</p>' +
    '<p>開発：プロスト</p>' +
    '<p class="small">試作中のため、内容は予告なく変わります。動作や保存データの保証はありません。感想は、このリンクを渡した人に伝えてください。</p>' +
    '<button type="button">同意して遊ぶ</button></div>';
  box.querySelector('button')!.addEventListener('click', () => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* */ }
    box.remove();
  });
  // 後ろのゲーム画面へ操作を通さない
  for (const ev of ['pointerdown', 'pointerup', 'click', 'touchstart']) box.addEventListener(ev, (e) => e.stopPropagation());
  document.body.appendChild(box);
}
