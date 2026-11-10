// コースエディタの幾何（src/editor/geom.ts・catalog.ts・export.ts）のテスト
// 実行: npm run editortest（失敗があれば exit 1）
import { Track } from '../src/track';
import { build, right, sampleOval, emptyLayout, pieceLabel, canAddPiece, mirrorLayout, reverseLayout } from '../src/editor/geom';
import { CATALOG, dim, dimKey, trackWidth } from '../src/editor/catalog';
import { toCourse, bankDeg, MM_TO_GAME } from '../src/editor/export';
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
  const expect = build(sampleOval(n)).check.totalLengthMm * MM_TO_GAME;
  const last = c.points[c.points.length - 1];
  const first = c.points[0];
  ok(Math.abs(t.length - expect) / expect < 0.02, `(10) toCourse(${n}レーン) を Track で読める・長さが妥当`, `Track ${t.length.toFixed(1)}m / 期待 ${expect.toFixed(1)}m, 点 ${c.points.length}`);
  ok(Math.hypot(last[0] - first[0], last[1] - first[1]) > 0.5, `(10) 最後の点は最初と重ならない（${n}レーン）`);
  ok(c.walledLanes === n && c.lanes === n && Math.abs(c.width - 115 * MM_TO_GAME * n) < 0.011 && c.laps === Math.max(2, n) && !!c.crossover, `(10) レーン・幅・周回・立体交差（${n}レーン）`, JSON.stringify({ ...c, points: c.points.length }));
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

// (11) バンクの横傾きの書き出し（CourseData.bank、度、+ は右側が高い）
{
  const plain = toCourse(sampleOval(3));
  ok(plain.bank === undefined && plain.crestTakeoff === true, '(11) バンクの無いコースは bank を書き出さない・crestTakeoff は true');
  // 入口の上り（前後の傾き）は横傾きに数えない
  const pitch = build(lay([BI]));
  ok(pitch.placed[0].samples.every((s) => Math.abs(bankDeg(s)) < 1e-9), '(11) バンク入口の前後の傾きは横傾き0', `最大 ${Math.max(...pitch.placed[0].samples.map((s) => Math.abs(bankDeg(s)))).toExponential(2)}度`);
  for (const [dir, sign] of [[L, 1], [R, -1]] as const) {
    const l = lay([S, BI, dir, dir, dir, dir, BO, S, dir, dir, dir, dir]);
    const c = toCourse(l);
    const b = c.bank ?? [];
    const peak = b.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    ok(b.length === c.points.length, `(11) ${pieceLabel(dir)}バンク: bank が点と同じ数`, `${b.length} / ${c.points.length}`);
    // 90度回った所で公式角度20度。左回りは外側（右）が高い=+、右回りは −
    ok(Math.abs(Math.abs(peak) - dim(3, 'bankAngle')) < 0.5 && Math.sign(peak) === sign, `(11) ${pieceLabel(dir)}バンク: 最大の横傾きが ${sign > 0 ? '+' : '−'}20度`, `最大 ${peak}度`);
    ok(b[0] === 0 && b[b.length - 1] === 0 && b.filter((v) => v !== 0).length < b.length / 2, `(11) ${pieceLabel(dir)}バンク: 平らな所は0`);
    // 90度の所の姿勢と書き出した値が一致する
    const mid = build(l).placed[3].end; // 直線, 入口, コーナー2個 → 90度
    ok(Math.abs(bankDeg(mid) - sign * 20) < 0.01, `(11) ${pieceLabel(dir)}バンク: 90度の所の横傾き`, `${bankDeg(mid).toFixed(3)}度`);
    // ゲームの Track で読める: 傾いた所では外側の路面の端が高い
    const t = new Track(c);
    let s90 = 0;
    for (let s = 0; s < t.length; s += 0.5) if (Math.abs(t.bankAt(s)) > Math.abs(t.bankAt(s90))) s90 = s;
    const hi = t.frameAt(s90, sign).position.y - t.frameAt(s90, -sign).position.y;
    ok(Math.abs((t.bankAt(s90) * 180) / Math.PI - peak) < 0.5 && hi > 0 && Math.abs(hi - c.width * Math.sin(20 * Math.PI / 180)) < 0.1, `(11) ${pieceLabel(dir)}バンク: Track の横傾きと路面の端の高さ`, `${((t.bankAt(s90) * 180) / Math.PI).toFixed(2)}度, 端の高低差 ${hi.toFixed(2)}m`);
  }
  // bank の無いコースの Track は今までどおり（横位置は水平に取る）
  const t0 = new Track(plain);
  const f = t0.frameAt(3, 1);
  const c0 = t0.frameAt(3, 0);
  ok(t0.bankAt(3) === 0 && f.bank === 0 && f.position.y === c0.position.y, '(11) bank の無いコースは横傾き0・端の高さは中心と同じ');
}

// 3レーンと5レーンで寸法が別
{
  const diff = ['straightLength', 'cornerCenterRadius', 'wallThickness'].every((k) => dim(3, k) !== dim(5, k));
  ok(diff && trackWidth(3) !== trackWidth(5), '3レーンと5レーンで寸法が別の値', `直線 ${dim(3, 'straightLength')}/${dim(5, 'straightLength')}, 半径 ${dim(3, 'cornerCenterRadius')}/${dim(5, 'cornerCenterRadius')}`);
  ok(Object.values(CATALOG[5]).every((d) => d.source === 'provisional'), '5レーンは全部 provisional');
  ok(Object.values(CATALOG[3]).every((d) => d.source !== 'official' || d.note.includes('https://')), '公式値には URL がある');
}

// ---- start 部品 ----
const ST: PieceSpec = { type: 'start' };
{
  const b = build(lay([ST, ...sampleOval(3).pieces.slice(1)]));
  ok(b.check.closed && Math.abs(b.placed[0].length - dim(3, 'straightLength')) < 1e-9, 'start: 長さは直線1枚と同じ・周回が閉じる', `長さ ${b.placed[0].length}`);
  ok(pieceLabel(ST) === 'スタート', 'start: ラベル');
  // 1個制限
  ok(canAddPiece(lay([S, S]), ST) === null, 'start: 無いコースには置ける');
  const why = canAddPiece(lay([S, ST, S]), ST);
  ok(!!why && why.includes('1個'), 'start: 2個目は置けず理由が返る', String(why));
  ok(canAddPiece(lay([S, ST]), S) === null, 'start: 他の部品はいつでも置ける');
  // 距離0の位置: 7番目を start にすると、書き出しの最初の点はその入口
  const lp = lay([S, S, L, L, L, L, ST, S, L, L, L, L]);
  const bp = build(lp);
  const c = toCourse(lp);
  const st = bp.placed[6].start.p;
  ok(Math.abs(c.points[0][0] - st[0] * MM_TO_GAME) < 0.011 && Math.abs(c.points[0][1] - st[2] * MM_TO_GAME) < 0.011, 'start: 書き出しの最初の点（距離0）が start の入口', `点0 ${c.points[0]} / 入口 ${(st[0] * MM_TO_GAME).toFixed(2)},${(st[2] * MM_TO_GAME).toFixed(2)}`);
  const plain = toCourse(lay([S, S, L, L, L, L, S, S, L, L, L, L]));
  ok(Math.abs(plain.points[0][0]) < 0.011 && Math.abs(plain.points[0][1]) < 0.011, 'start 無し: 最初の部品の入口が距離0（原点）');
  ok(c.points.length === plain.points.length && Math.abs(new Track(c).length - new Track(plain).length) < 0.5, 'start: 点の数・1周の長さは回しても同じ');
  // 立体交差の位置: start の入口からの距離
  const lcp = lay([LC, L, L, L, L, ST, S, L, L, L, L]);
  const bl = build(lcp);
  const cc = toCourse(lcp);
  let d = 0;
  for (let i = 5; i < 11; i++) d += bl.placed[i].length;
  ok(bl.check.closed && Math.abs((cc.crossover?.at ?? -1) - d * MM_TO_GAME) < 0.05, 'start: 立体交差の位置が start からの距離になる', `at ${cc.crossover?.at} / 期待 ${(d * MM_TO_GAME).toFixed(2)}`);
  const ccPlain = toCourse(lay([S, S, L, L, L, L, LC, L, L, L, L]));
  ok(Math.abs((ccPlain.crossover?.at ?? -1) - (2 * dim(3, 'straightLength') + 4 * (dim(3, 'cornerCenterRadius') * Math.PI / 4)) * MM_TO_GAME) < 0.05, 'start 無し: 立体交差の位置は今までどおり（最初の部品から）', `at ${ccPlain.crossover?.at}`);
  // バンクの列: 回したあとも、高さのあるバンクの位置が start 基準になる
  const bk = lay([S, BI, L, L, L, L, BO, ST, L, L, L, L]);
  const cb = toCourse(bk);
  const bb = build(bk);
  const iPeak = (cb.bank ?? []).reduce((m, v, i, a) => (Math.abs(v) > Math.abs(a[m]) ? i : m), 0);
  // 回した列でのピークまでの距離 = start から コーナー 2個 までの距離 のはず
  const t = new Track(cb);
  let sPeak = 0;
  for (let s = 0; s < t.length; s += 0.5) if (Math.abs(t.bankAt(s)) > Math.abs(t.bankAt(sPeak))) sPeak = s;
  ok(!!cb.bank && cb.bank.length === cb.points.length && Math.abs(cb.bank[0]) < 1e-9 && iPeak > 0, 'start: バンクの列が点と同じ数・距離0は水平', `${cb.bank?.length}/${cb.points.length}`);
  ok(sPeak > 0, 'start: バンクの位置が回った列に反映される', `最大の傾き ${sPeak}m`);
}

// ---- 寸法の上書き ----
{
  const base = sampleOval(3);
  const b0 = build(base);
  const e0 = toCourse(base);
  // 上書き無し（dims なし・空）は完全に不変
  const b1 = build({ ...base, dims: {} });
  ok(JSON.stringify(b0.check) === JSON.stringify(b1.check) && JSON.stringify(toCourse({ ...base, dims: {} })) === JSON.stringify(e0), '寸法: 上書き無し・空は不変');
  // 直線の長さ: 長さが変わり、閉じなくなる（勝手に補正しない）
  const ls = build({ ...lay([LC, ...sampleOval(3).pieces.slice(2)]), dims: { [dimKey(3, 'straightLength')]: 600 } }); // レーンチェンジは直線2枚ぶん（1080）なので直線が変わるとずれる
  ok(Math.abs(ls.placed[5].length - 600) < 1e-9 && !ls.check.closed && ls.check.messages.some((m) => m.text.includes('つながっていません')), '寸法: 直線の長さの上書きが形に効き、閉じなくなると「閉じていない」', msgs(ls));
  // 直線の長さを上書きしても、全部の直線を同じだけ変えてコーナーも半径で合わせれば閉じる例は不要。長さ0以下・非数は無視（表の値）
  ok(dim(3, 'straightLength', { [dimKey(3, 'straightLength')]: -5 }) === 540 && dim(3, 'straightLength', { [dimKey(3, 'straightLength')]: NaN }) === 540 && dim(3, 'straightLength', { [dimKey(3, 'straightLength')]: 0 }) === 540, '寸法: 0以下・非数の上書きは使わない');
  // 5レーンの上書きは3レーンに効かない（逆も）
  ok(dim(3, 'slopeRise', { [dimKey(5, 'slopeRise')]: 200 }) === 110 && dim(5, 'slopeRise', { [dimKey(5, 'slopeRise')]: 200 }) === 200, '寸法: 3レーンと5レーンの上書きは別');
  // スロープ: 高さ・長さが形と書き出しに効く
  const o = sampleOval(3).pieces.slice(2);
  const sl = build(lay([UP, ...o]));
  const slo = build({ ...lay([UP, ...o]), dims: { [dimKey(3, 'slopeRise')]: 150, [dimKey(3, 'slopeLength')]: 1000 } });
  ok(Math.abs(slo.check.heightMm - 150) < 1e-9 && sl.check.heightMm === 110 && Math.abs(slo.placed[0].samples[slo.placed[0].samples.length - 1].p[0]) > 0, '寸法: スロープの高さの上書きが形に効く', `高さ ${slo.check.heightMm}`);
  const ssu = build({ ...lay([UP, S, DOWN]), dims: { [dimKey(3, 'slopeRise')]: 150 } });
  ok(Math.abs(ssu.placed[1].maxY - 150) < 1e-9 && Math.abs(lastEnd(ssu).p[1]) < 1e-9, '寸法: slopeRise の上書き（上り→直線→下りで戻る）', `${ssu.placed[1].maxY}`);
  // ウェーブ: 山の高さ・数
  const w0 = build(lay([{ type: 'wave' }]));
  const wh = build({ ...lay([{ type: 'wave' }]), dims: { [dimKey(3, 'waveHeight')]: 16 } });
  ok(Math.abs(wh.placed[0].maxY - 2 * w0.placed[0].maxY) < 0.5, '寸法: waveHeight の上書きが山の高さに効く', `${w0.placed[0].maxY.toFixed(2)} → ${wh.placed[0].maxY.toFixed(2)}`);
  const peaks = (pl: Built) => { const y = pl.placed[0].samples.map((s) => s.p[1]); let n = 0; for (let i = 1; i < y.length - 1; i++) if (y[i] > y[i - 1] && y[i] >= y[i + 1] && y[i] > 1) n++; return n; };
  const w4 = build({ ...lay([{ type: 'wave' }]), dims: { [dimKey(3, 'waveCount')]: 4 } });
  ok(peaks(w0) === 2 && peaks(w4) === 4 && Math.abs(lastEnd(w4).p[1]) < 1e-9 && w4.check.underground.length === 0, '寸法: waveCount の上書き（既定2個・4個にできる・出口は水平）', `${peaks(w0)} / ${peaks(w4)}`);
  const wl = build({ ...lay([{ type: 'wave' }]), dims: { [dimKey(3, 'waveLength')]: 700 } });
  ok(Math.abs(lastEnd(wl).p[0] - 700) < 1e-9, '寸法: waveLength の上書き');
  // 立体交差: 長さ・高さが書き出しに効く
  const lcl = lay([LC, ...sampleOval(3).pieces.slice(2)]);
  const x0 = toCourse(lcl).crossover!;
  const x1 = toCourse({ ...lcl, dims: { [dimKey(3, 'laneChangeRise')]: 100 } }).crossover!;
  ok(Math.abs(x1.height! - 100 * MM_TO_GAME) < 0.01 && x1.height !== x0.height, '寸法: laneChangeRise の上書きが書き出しの高さに効く', `${x0.height} → ${x1.height}`);
  const lcLen = build({ ...lcl, dims: { [dimKey(3, 'laneChangeLength')]: 1200 } });
  ok(Math.abs(lcLen.placed[0].length - 1200) < 1e-9, '寸法: laneChangeLength の上書き');
  // コーナー半径: 形が変わり閉じなくなる
  const cr = build({ ...base, dims: { [dimKey(3, 'cornerCenterRadius')]: 600 } });
  ok(Math.abs(cr.placed[2].length - 600 * Math.PI / 4) < 1e-6 && cr.check.closed && cr.check.totalLengthMm > b0.check.totalLengthMm, '寸法: コーナー半径の上書きが形に効く（楕円は半径を変えても閉じる）');
  const crl = build({ ...lay([S, S, L, L, L, L, S, L, L, L, L]), dims: { [dimKey(3, 'cornerCenterRadius')]: 600 } });
  ok(!crl.check.closed, '寸法: 閉じない形では半径の上書き後も「閉じていない」のまま（補正しない）');
  // 幅・フェンス高: 書き出しに効く
  const ew = toCourse({ ...base, dims: { [dimKey(3, 'laneWidth')]: 120, [dimKey(3, 'wallHeight')]: 55 } });
  ok(Math.abs(ew.width - 120 * MM_TO_GAME * 3) < 0.011 && Math.abs(ew.wallHeight - 55 * MM_TO_GAME) < 0.011 && ew.width !== e0.width, '寸法: laneWidth・wallHeight の上書きが書き出しに効く', `${ew.width}, ${ew.wallHeight}`);
  ok(trackWidth(3, { [dimKey(3, 'laneWidth')]: 120 }) === 3 * 120 + 20 && trackWidth(3) === 365, '寸法: trackWidth に上書きが効く');
  // バンク角
  const bk = build({ ...lay([BI, L, L, L, L, BO]), dims: { [dimKey(3, 'bankAngle')]: 10 } });
  ok(bk.check.messages.every((m) => m.level !== 'error') && angle(lastEnd(bk).u, [0, 1, 0]) < 1e-6, '寸法: bankAngle の上書きでもバンクが水平に戻る');
  // 表の側: waveCount は全レーンの表にあり provisional
  ok([3, 5].every((n) => CATALOG[n as LaneCount].waveCount?.source === 'provisional' && CATALOG[n as LaneCount].waveCount.value === 2), '寸法: 表に waveCount（仮設定 2）がある');
}

{
  // 逆走・左右反転: 閉じたコースは閉じたまま、1周の長さも同じ。2回かけると元に戻る
  const S0: PieceSpec = { type: 'straight', frac: 1 };
  const Lc: PieceSpec = { type: 'corner', dir: 'L' };
  const L4c = [Lc, Lc, Lc, Lc];
  const src: Layout = { version: 1, name: 't', lanes: 3, pieces: [{ type: 'start' }, { type: 'slopeUp' }, { type: 'bankIn' }, ...L4c, { type: 'bankOut' }, { type: 'slopeDown' }, S0, ...L4c] };
  const b0 = build(src);
  for (const [name, fn] of [['左右反転', mirrorLayout], ['逆走', reverseLayout]] as const) {
    const b1 = build(fn(src));
    ok(b0.check.closed && b1.check.closed && Math.abs(b1.check.totalLengthMm - b0.check.totalLengthMm) < 0.01, `${name}: 閉じたまま・1周の長さが同じ`, `${b0.check.closed} ${b1.check.closed} gap ${b1.check.gapMm.toFixed(3)} ${b1.check.messages.map((m) => m.text).join(' / ')}`);
    ok(JSON.stringify(fn(fn(src))) === JSON.stringify(src), `${name}: 2回かけると元に戻る`);
    ok(b1.check.underground.length === 0, `${name}: 床に潜らない`);
    ok(fn(src).pieces.filter((p) => p.type === 'start').length === 1, `${name}: スタートは1個のまま`);
  }
  const c1 = toCourse(reverseLayout(src));
  ok(c1.points.length > 3, '逆走: 書き出せる');
}

console.log(`\n${passes} 件成功 / ${fails} 件失敗`);
if (fails) process.exit(1);
