// ★（性能ランク）とコストの出場判定の確認: 境界値・★の最高値・フリー走行
// 実行: npm run startest
import { buildCost, defaultBuild, part, CATEGORIES, type Build } from '../src/setup';
import { eventById, entryCheck } from '../src/events';
let fail = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'OK ' : 'NG '} ${name}`); if (!cond) fail++; };
// ★1の大会。今の★1パーツでは合計コストが13までしか届かないので、境界の確認には上限12の仮の大会を使う
const ev = { ...eventById('beginner'), costCap: 12 };
const d = defaultBuild();
ok('初期マシンは★1', buildCost(d).star === 1);
// コストの境界: 初期にコストの増える★1パーツを足して 16 ちょうど／17 を作る
const n1 = (b: Build) => buildCost(b).total;
let b: Build = { ...d };
const cands = CATEGORIES.flatMap((c) => (part(c.key, b[c.key]) ? [c.key] : []));
// ★1でコストのあるパーツを探して、合計がちょうど上限になるように組む
import parts from '../src/data/parts.json';
const pool = cands.flatMap((c) => ((parts as any)[c] as any[]).filter((p) => p.tier === 'N').map((p) => ({ c, p })));
// ★1パーツだけで、合計コストが target ちょうどの組み合わせを探す（種類ごとに1つ選ぶ）
function hit(target: number): Build | null {
  // 貪欲法: 足りない分を超えない範囲で、一番コストの上がる★1パーツへ1つずつ替えていく
  let cur: Build = { ...d };
  for (let k = 0; k < 40 && n1(cur) < target; k++) {
    const need = target - n1(cur);
    let best: Build | null = null;
    let gain = 0;
    for (const x of pool) {
      const t = { ...cur, [x.c]: x.p.id } as Build;
      const g = n1(t) - n1(cur);
      if (g > gain && g <= need) { gain = g; best = t; }
    }
    if (!best) return null;
    cur = best;
  }
  return n1(cur) === target ? cur : null;
}
b = hit(ev.costCap!) ?? b;
ok(`★1・コスト${n1(b)}（上限ちょうど）は出られる`, n1(b) === ev.costCap && entryCheck(ev, b).ok);
const over = hit(ev.costCap! + 1);
ok(`コスト${over ? n1(over) : '?'}（上限+1）は出られない`, !!over && entryCheck(ev, over).costOver && !entryCheck(ev, over).ok);
const star2 = { ...d, rollerF: 'bearing' } as Build; // ★2・コスト1
ok(`★2パーツ1つで★2、コストは${n1(star2)}でも出られない`, buildCost(star2).star === 2 && entryCheck(ev, star2).starOver && !entryCheck(ev, star2).costOver);
ok('★2大会（チューンドGP）なら同じマシンで出られる', entryCheck(eventById('tunedGP'), star2).ok);
const hi = { ...d, chassis: 'eight' } as Build; // ★4シャーシ
const hiMix = { ...hi, rollerF: 'plastic', rollerR: 'plastic', motor: 'bal1' } as Build;
ok('★4シャーシに★1パーツを混ぜても★4のまま（平均にしない）', buildCost(hi).star === 4 && buildCost(hiMix).star === 4);
ok('★4のマシンは★3大会に出られない', entryCheck(eventById('hyperCup'), hiMix).starOver);
ok('フリー走行は条件なし', entryCheck(eventById('free-standard'), { ...d, chassis: 'formula6' } as Build).ok);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
