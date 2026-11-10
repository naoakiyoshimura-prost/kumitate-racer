// コースエディタの幾何（src/editor/geom.ts・catalog.ts・export.ts）のテスト
// 実行: npm run editortest（失敗があれば exit 1）
import { Track } from '../src/track';
import { build, right, sampleOval, emptyLayout, pieceLabel } from '../src/editor/geom';
import { CATALOG, dim, trackWidth } from '../src/editor/catalog';
import { toCourse } from '../src/editor/export';
import type { Built, LaneCount, Layout, PieceSpec, Vec3 } from '../src/editor/types';

let fails = 0;
let passes = 0;
function ok(cond: boolean, name: string, detail = '') {
  if (cond) passes++;
  else fails++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}

const S: PieceSpec = { type: 'straight', frac: 1 };
const L: PieceSpec = { type: 'corner', dir: 'L' };
const R: PieceSpec = { type: 'corner', dir: 'R' };
const UP: PieceSpec = { type: 'slopeUp' };
const DOWN: PieceSpec = { type: 'slopeDown' };
const BI: PieceSpec = { type: 'bankIn' };
const BO: PieceSpec = { type: 'bankOut' };
const LC: PieceSpec = { type: 'laneChange' };
const rep = <T,>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
const lay = (pieces: PieceSpec[], lanes: LaneCount = 3): Layout => ({ version: 1, name: 't', lanes, pieces });
const lastEnd = (b: Built) => b.placed[b.placed.length - 1].end;
const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
const minSampleY = (b: Built) => Math.min(...b.placed.flatMap((p) => p.samples.map((s) => s.p[1])));
const msgs = (b: Built) => b.check.messages.map((m) => m.text).join(' / ');

// (1) 見本は閉じる
for (const n of [3, 5] as LaneCount[]) {
  const b = build(sampleOval(n));
  ok(b.check.closed, `(1) sampleOval(${n}) が閉じる`, `gap ${b.check.gapMm.toExponential(2)}mm, 1周 ${(b.check.totalLengthMm / 1000).toFixed(3)}m, overlaps ${b.check.overlaps.length}`);
  ok(b.check.overlaps.length === 0 && b.check.underground.length === 0, `(1) sampleOval(${n}) に重なり・潜りなし`, msgs(b));
}

// (2) コーナー8個で元に戻る
for (const dir of [L, R]) {
  const b = build(lay(rep(dir, 8)));
  ok(b.check.gapMm < 0.01 && b.check.closed, `(2) コーナー${pieceLabel(dir)}×8 で gap<0.01mm`, `gap ${b.check.gapMm.toExponential(2)}mm, 向き ${b.check.headingDeg.toExponential(2)}度`);
}

// (3) 直線1本
{
  const b = build(lay([S]));
  ok(!b.check.closed && Math.abs(b.check.gapMm - dim(3, 'straightLength')) < 1e-9, '(3) 直線1本は閉じず gap=直線長', `gap ${b.check.gapMm}`);
  ok(b.check.messages.some((m) => m.level === 'warn' && m.text.includes('つながっていません')), '(3) ずれのメッセージが出る', msgs(b));
}
// 部品0個でも落ちない
{
  const b = build(emptyLayout(3));
  ok(!b.check.closed && b.placed.length === 0 && b.check.messages.length > 0, '部品0個でも落ちない', msgs(b));
}

// (4) スロープ
{
  const b = build(lay([UP, S, DOWN]));
  const e = lastEnd(b);
  ok(Math.abs(e.p[1]) < 1e-9 && Math.abs(e.f[1]) < 1e-9, '(4) slopeUp→直線→slopeDown で高さが戻る', `y ${e.p[1]}, 最高 ${b.placed[1].maxY}`);
  const midF = b.placed[0].samples[Math.floor(b.placed[0].samples.length / 2)].f;
  ok(midF[1] > 0.05 && Math.abs(b.placed[0].end.f[1]) < 1e-9, '(4) スロープの途中は上向き、出口は水平');
  // slopeLength = 直線2枚ぶん（仮）なので、オーバルの最初の直線2枚を slopeUp に替えると高さだけずれる
  const o = sampleOval(3).pieces.slice(2);
  const b2 = build(lay([UP, ...o]));
  ok(!b2.check.closed && Math.abs(b2.check.heightMm - 110) < 1e-9, '(4) slopeUp だけの周回は heightMm=110', `height ${b2.check.heightMm}, ${msgs(b2)}`);
  const b3 = build(lay([DOWN, ...o]));
  ok(b3.check.underground.includes(0), '(4) 床から slopeDown すると潜りとして出る', msgs(b3));
}

// ウェーブ: 入口と出口は同じ高さ・姿勢、flip で高い山と低い山の順が逆（床より下には下がらない）
{
  const a = build(lay([{ type: 'wave' }]));
  const b = build(lay([{ type: 'wave', flip: true }]));
  const e = lastEnd(a);
  const ya = a.placed[0].samples[Math.round(a.placed[0].samples.length / 4)].p[1];
  const yb = b.placed[0].samples[Math.round(b.placed[0].samples.length / 4)].p[1];
  ok(Math.abs(e.p[1]) < 1e-9 && Math.abs(e.f[1]) < 1e-9 && Math.abs(e.p[0] - dim(3, 'waveLength')) < 1e-9 && ya > yb && yb > 0 && a.check.underground.length === 0 && b.check.underground.length === 0, 'ウェーブの入口と出口が同じ高さ・姿勢、flip で山の高低が逆、床に潜らない', `山 ${ya.toFixed(2)} / 反転 ${yb.toFixed(2)}`);
}

// (5) バンク: bankIn→コーナー4個(180度)→bankOut
{
  const b = build(lay([BI, L, L, L, L, BO]));
  const e = lastEnd(b);
  ok(angle(e.u, [0, 1, 0]) < 1e-6 && Math.abs(e.f[1]) < 1e-9, '(5) バンク後に u が真上・f が水平', `u ${e.u.map((v) => v.toFixed(6))}, f ${e.f.map((v) => v.toFixed(6))}`);
  ok(Math.abs(e.p[1]) < 1e-6, '(5) バンク後の高さは0に戻る', `y ${e.p[1]}`);
  ok(minSampleY(b) >= -1, '(5) どの samples も y≥−1', `最低 ${minSampleY(b).toFixed(3)}, 最高 ${Math.max(...b.placed.map((p) => p.maxY)).toFixed(1)}`);
  ok(!b.check.messages.some((m) => m.level === 'error'), '(5) バンクに error なし', msgs(b));
  // 傾いた面の途中: コーナーの真ん中では u が横に傾いている（右向き軸が水平でない）
  const mid = b.placed[2].end; // 90度回った所
  ok(Math.abs(right(mid)[1]) > 0.3, '(5) 90度の所で路面が横に傾いている（バンク）', `right ${right(mid).map((v) => v.toFixed(3))}`);
  // 周回が閉じる例: 直線→バンク180度→直線→平らなコーナー180度
  const lap = build(lay([S, BI, L, L, L, L, BO, S, L, L, L, L]));
  ok(lap.check.closed, '(5) バンク入りの周回が閉じる', `gap ${lap.check.gapMm.toExponential(2)}mm, ${msgs(lap)}`);
  ok(minSampleY(lap) >= -1 && lap.check.overlaps.length === 0, '(5) バンク入りの周回に潜り・重なりなし', msgs(lap));
  const lapR = build(lay([S, BI, R, R, R, R, BO, S, R, R, R, R]));
  ok(lapR.check.closed && minSampleY(lapR) >= -1, '(5) 右回りのバンク周回も閉じる', msgs(lapR));
}

// (6) bankIn→bankOut（間にコーナーなし）
{
  const b = build(lay([BI, BO]));
  const e = lastEnd(b);
  ok(angle(e.u, [0, 1, 0]) < 1e-6 && Math.abs(e.f[1]) < 1e-9 && !b.check.messages.some((m) => m.level === 'error'), '(6) bankIn→bankOut で水平に戻る', `y ${e.p[1].toFixed(2)}`);
}

// (7) 90度だけ回ってから戻すとエラー
{
  const b = build(lay([BI, L, L, BO]));
  ok(b.check.messages.some((m) => m.level === 'error' && m.text.includes('この向きではバンクを戻せません')), '(7) 90度でバンク戻りは error', msgs(b));
}

// (8) レーンチェンジ
for (const n of [3, 5] as LaneCount[]) {
  const o = sampleOval(n).pieces;
  // laneChange は直線2枚ぶん（仮）なので、最初の直線2枚と入れ替える
  const b = build(lay([LC, ...o.slice(2)], n));
  ok(b.check.closed && b.check.laneShift === 1 && b.check.lapsToReturn === n, `(8) レーンチェンジ1個の周回（${n}レーン）`, `closed ${b.check.closed}, shift ${b.check.laneShift}, laps ${b.check.lapsToReturn}`);
}
{
  const b = build(lay([LC, ...sampleOval(3).pieces.slice(2, 6), LC, ...sampleOval(3).pieces.slice(8)]));
  ok(b.check.laneShift === 2 && b.check.lapsToReturn === 3, '(8) 3レーンでずれ2なら3周', `laps ${b.check.lapsToReturn}`);
  const z = build(sampleOval(5));
  ok(z.check.laneShift === 0 && z.check.lapsToReturn === 1, '(8) ずれ0なら1周');
}

// (9) 重なり: 自分と交差する8の字（平ら）は出る。高さが違う交差・レーンチェンジでは出ない
{
  // 直線5→左135度→直線2→左135度→直線6 で、戻りの直線が最初の直線と直角に交差する
  const fig = [...rep(S, 5), L, L, L, S, S, L, L, L, ...rep(S, 6)];
  const b = build(lay(fig));
  ok(b.check.overlaps.length > 0, '(9) 平らな8の字で overlaps が出る', `${JSON.stringify(b.check.overlaps)}`);
  // 同じ形で、最初の直線を上り（直線2枚ぶん）で110mm 上げ、ターンの途中の下りで床へ戻す → 交差は110mm 差
  const figH = [UP, S, S, S, L, L, L, DOWN, L, L, L, ...rep(S, 6)];
  const bh = build(lay(figH));
  ok(bh.check.overlaps.length === 0, '(9) 高さの違う交差では出ない', `${JSON.stringify(bh.check.overlaps)} ${msgs(bh)}`);
  // 交差点の高さの差を表示（確認用）
  const lc = build(lay([LC, ...sampleOval(3).pieces.slice(2)]));
  ok(lc.check.overlaps.length === 0, '(9) レーンチェンジの周回では出ない');
}

// (10) ゲームの Track で読み込める
for (const n of [3, 5] as LaneCount[]) {
  const c = toCourse(lay([LC, ...sampleOval(n).pieces.slice(2)], n), `ed${n}`);
  const t = new Track(c);
  const expect = (build(sampleOval(n)).check.totalLengthMm * 3.6) / 115;
  const last = c.points[c.points.length - 1];
  const first = c.points[0];
  ok(Math.abs(t.length - expect) / expect < 0.02, `(10) toCourse(${n}レーン) を Track で読める・長さが妥当`, `Track ${t.length.toFixed(1)}m / 期待 ${expect.toFixed(1)}m, 点 ${c.points.length}`);
  ok(Math.hypot(last[0] - first[0], last[1] - first[1]) > 0.5, `(10) 最後の点は最初と重ならない（${n}レーン）`);
  ok(c.walledLanes === n && c.lanes === n && Math.abs(c.width - 3.6 * n) < 1e-9 && c.laps === Math.max(2, n) && !!c.crossover, `(10) レーン・幅・周回・立体交差（${n}レーン）`, JSON.stringify({ ...c, points: c.points.length }));
}
{
  const c = toCourse(sampleOval(3));
  ok(c.laps === 2 && !c.crossover, '(10) レーンチェンジなしは laps 2・立体交差なし');
  let threw = false;
  try {
    toCourse(lay([S]));
  } catch {
    threw = true;
  }
  ok(threw, '(10) 閉じていないレイアウトは例外');
}

// 3レーンと5レーンで寸法が別
{
  const diff = ['straightLength', 'cornerCenterRadius', 'wallThickness'].every((k) => dim(3, k) !== dim(5, k));
  ok(diff && trackWidth(3) !== trackWidth(5), '3レーンと5レーンで寸法が別の値', `直線 ${dim(3, 'straightLength')}/${dim(5, 'straightLength')}, 半径 ${dim(3, 'cornerCenterRadius')}/${dim(5, 'cornerCenterRadius')}`);
  ok(Object.values(CATALOG[5]).every((d) => d.source === 'provisional'), '5レーンは全部 provisional');
  ok(Object.values(CATALOG[3]).every((d) => d.source !== 'official' || d.note.includes('https://')), '公式値には URL がある');
}

console.log(`\n${passes} 件成功 / ${fails} 件失敗`);
if (fails) process.exit(1);
