// 英語表示（テストプレイ英語版、2026-11-12 店長依頼）。
// 日本語版の画面は一切変えず、英語のときだけ画面の文字（DOM の文字・title などの属性・確認ダイアログ）を辞書で置き換える。
// 仕組み: 文字の塊（テキストノード）ごとに、前後の空白を除いた文字列を辞書で引く。
//   - 完全一致の表 EXACT
//   - 数字などが入る文は PATTERNS（キーの {} が「何か入る所」、訳の {1}{2}… がその中身）
// 辞書に無い文は日本語のまま残す（window.__i18nMiss に記録。開発時の洗い出し用）。
// 英語にする条件: ページ側の window.__lang = 'en'、または URL の ?lang=en。同じタブの中ではエディタへ移っても続く（sessionStorage）。
// 商標の注意: 実在の商品名・部品名は使わない。部品名は形をそのまま表す一般的な英語にする（例外は注意書きの文面だけ）。
import { EXACT, PATTERNS } from './i18n-en';

const LKEY = 'kumitate-racer.lang';
function detect(): 'ja' | 'en' {
  if (typeof window === 'undefined') return 'ja'; // テスト（node）では日本語のまま
  const w = window as unknown as { __lang?: string };
  let l: string | null = w.__lang ?? null;
  try { l = l ?? new URLSearchParams(location.search).get('lang'); } catch { /* */ }
  try {
    if (l === 'en' || l === 'ja') sessionStorage.setItem(LKEY, l);
    else l = sessionStorage.getItem(LKEY);
  } catch { /* 保存できなくても、このページの中では効く */ }
  return l === 'en' ? 'en' : 'ja';
}
export const LANG = detect();
export const EN = LANG === 'en';

const JP = /[぀-ヿ㐀-鿿！-｠]/;
type Rule = { re: RegExp; to: string };
const RULES: Rule[] = PATTERNS.map(([k, to]) => {
  const src = k.split('{}').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)');
  return { re: new RegExp('^' + src + '$'), to };
});
const miss = new Set<string>();
if (typeof window !== 'undefined') (window as unknown as { __i18nMiss: Set<string> }).__i18nMiss = miss;

// 1つの文を訳す（訳せなければそのまま返す）。中身の {} も訳せるものは訳す（部品名など）
export function tr(s: string): string {
  if (!EN || !JP.test(s)) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const core = m[2];
  const hit = EXACT[core];
  if (hit !== undefined) return m[1] + hit + m[3];
  for (const r of RULES) {
    const g = r.re.exec(core);
    if (g) return m[1] + r.to.replace(/\{(\d)\}/g, (_, i) => tr(g[+i] ?? '')) + m[3];
  }
  if (miss.size < 300) miss.add(core); // 毎フレーム変わる文で増え続けないように上限
  return s;
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
const done = new WeakMap<Node, string>(); // 訳した後の文字（自分で書き換えた変更を無視するため）
function walk(n: Node) {
  if (n.nodeType === 3) {
    const v = n.nodeValue ?? '';
    if (done.get(n) === v || !JP.test(v)) return;
    const t = tr(v);
    done.set(n, t);
    if (t !== v) n.nodeValue = t;
    return;
  }
  if (n.nodeType !== 1) return;
  const el = n as Element;
  if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && JP.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
  }
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return; // 入力欄の中身（共有コードなど）は触らない
  n.childNodes.forEach(walk);
}

if (EN) {
  document.documentElement.lang = 'en';
  const start = () => {
    walk(document.body);
    if (JP.test(document.title)) document.title = tr(document.title);
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') walk(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // 確認・お知らせのダイアログも訳す
  const w = window as unknown as Record<string, (m?: string) => unknown>;
  for (const f of ['alert', 'confirm', 'prompt']) {
    const orig = w[f].bind(window);
    w[f] = (msg?: string, ...rest: unknown[]) => (orig as (...a: unknown[]) => unknown)(msg === undefined ? msg : tr(String(msg)), ...rest);
  }
}
