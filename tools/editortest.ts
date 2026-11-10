// コースエディタの幾何（src/editor/geom.ts・catalog.ts・export.ts）のテスト
// 実行: npm run editortest（失敗があれば exit 1）
import { Track, type CourseData } from '../src/track';
import { build, right, sampleOval, sampleBankValley, emptyLayout, pieceLabel, canAddPiece, mirrorLayout, reverseLayout, parseLayout, bankDims, slopeDims, rampByAngle } from '../src/editor/geom';
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
const BU: PieceSpec = { type: 'bankUp' };
const BD: PieceSpec = { type: 'bankDown' };
const bu = (angle: 20 | 30 | 40): PieceSpec => ({ type: 'bankUp', angle });
const bd = (angle: 20 | 30 | 40): PieceSpec => ({ type: 'bankDown', angle });
const L4 = [L, L, L, L];
const DEG = 180 / Math.PI;
const pitchDeg = (f: Vec3) => Math.atan2(f[1], Math.hypot(f[0], f[2])) * DEG;
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

// (5) バンク（角度つきの坂）: 入口の丸み→一定角度の斜面→出口の丸み。横には傾かない
for (const n of [3, 5] as LaneCount[]) {
  const H = dim(n, 'bankRise');
  for (const a of [20, 30, 40] as const) {
    const b = build(lay([bu(a)], n));
    const p = b.placed[0];
    const e = p.end;
    const d = bankDims(n, a);
    ok(angle(e.u, [0, 1, 0]) < 1e-9 && Math.abs(e.f[1]) < 1e-12 && Math.abs(e.p[1] - H) < 1e-9, `(5) ${n}レーン バンク上り${a}°: 出口が水平・高さ=bankRise ${H}`, `y ${e.p[1]}, f ${e.f.map((v) => v.toFixed(6))}`);
    // 真ん中（斜面の部分）の角度が選んだ角度、どこもそれより急でない
    const mid = p.samples[Math.floor(p.samples.length / 2)];
    const maxPitch = Math.max(...p.samples.map((s) => pitchDeg(s.f)));
    ok(Math.abs(pitchDeg(mid.f) - a) < 1e-6 && maxPitch < a + 1e-6 && d.slopeLen > 0, `(5) ${n}レーン バンク上り${a}°: 斜面の角度が ${a}度`, `中 ${pitchDeg(mid.f).toFixed(4)}°, 最大 ${maxPitch.toFixed(4)}°, 斜面 ${d.slopeLen.toFixed(1)}mm`);
    // 上から見た長さ・中心線の長さが式どおり（R = bankBendRadius）
    const R = dim(n, 'bankBendRadius');
    const r = a * Math.PI / 180;
    const X = 2 * R * Math.sin(r) + ((H - 2 * R * (1 - Math.cos(r))) / Math.sin(r)) * Math.cos(r);
    ok(Math.abs(e.p[0] - X) < 1e-6 && Math.abs(p.length - (2 * R * r + (H - 2 * R * (1 - Math.cos(r))) / Math.sin(r))) < 1e-6 && Math.abs(e.p[2]) < 1e-9, `(5) ${n}レーン バンク上り${a}°: 長さが式どおり・横にずれない`, `上から ${e.p[0].toFixed(1)}mm, 中心線 ${p.length.toFixed(1)}mm`);
    // 入口はへこむ向き（角度が増える）、出口はふくらむ向き（角度が減る）。横傾きなし
    const pd = p.samples.map((s) => pitchDeg(s.f));
    const k = Math.floor(pd.length / 3);
    const incr = pd.slice(0, k).every((v, i, arr) => i === 0 || v >= arr[i - 1] - 1e-9);
    const decr = pd.slice(-k).every((v, i, arr) => i === 0 || v <= arr[i - 1] + 1e-9);
    ok(incr && decr && p.samples.every((s) => Math.abs(right(s)[1]) < 1e-9), `(5) ${n}レーン バンク上り${a}°: 入口はへこむ向き・出口はふくらむ向き・横傾きなし`);
    // 上り＋下りで元の高さ。間に180度コーナー（高い位置で平ら）を置いても同じ。床に潜らない
    const ud = build(lay([bu(a), bd(a)], n));
    const uc = build(lay([bu(a), ...L4, bd(a)], n));
    const ce = lastEnd(uc);
    ok(Math.abs(lastEnd(ud).p[1]) < 1e-9 && Math.abs(ce.p[1]) < 1e-9 && angle(ce.u, [0, 1, 0]) < 1e-9 && Math.abs(uc.placed[2].maxY - H) < 1e-9 && Math.abs(uc.placed[2].minY - H) < 1e-9, `(5) ${n}レーン バンク${a}°: 上り＋下りで元の高さ・間のコーナーは高い位置で平ら`, `終わり ${ce.p[1].toExponential(2)}`);
    ok(minSampleY(uc) >= -1e-9 && uc.check.underground.length === 0 && !uc.check.messages.some((m) => m.level === 'error'), `(5) ${n}レーン バンク${a}°: 床に潜らない・error なし`, msgs(uc));
  }
}
{
  // 床から下ると潜りとして出る
  const b = build(lay([BD]));
  ok(b.check.underground.includes(0), '(6) 床からバンク下りは潜りとして出る', msgs(b));
  // 角度の既定は20度、ラベル
  ok(pieceLabel(BU) === 'バンク上り20°' && pieceLabel(bd(40)) === 'バンク下り40°' && Math.abs(build(lay([BU])).placed[0].end.p[0] - build(lay([bu(20)])).placed[0].end.p[0]) < 1e-12, '(6) 角度の既定は20度・ラベルに角度');
  // 角度がきついほど上から見た長さが短い（高さは同じ）
  const xs = ([20, 30, 40] as const).map((a) => bankDims(3, a).horizontal);
  ok(xs[0] > xs[1] && xs[1] > xs[2], '(6) 角度がきついほど短い', xs.map((x) => x.toFixed(1)).join(' / '));
  // 横傾きは0なので書き出しに bank は出ない。Track で読めて、最高点は bankRise
  const c = toCourse(sampleBankValley(3));
  const t = new Track(c);
  const top = Math.max(...c.points.map((q) => q[2]));
  ok(c.bank === undefined && t.length > 0 && Math.abs(top - dim(3, 'bankRise') * MM_TO_GAME) < 0.02, '(6) 見本: 書き出しに横傾きなし・Track で読める・最高点が bankRise', `最高 ${top}m, 1周 ${t.length.toFixed(1)}m`);
}

// (7) 見本「定番の並び」: 閉じる・重なり/潜りなし・谷がある（3レーン用。5レーン・角度3種でも閉じる）
for (const n of [3, 5] as LaneCount[])
  for (const a of [20, 30, 40] as const) {
    const l = sampleBankValley(n, a);
    const b = build(l);
    ok(b.check.closed && b.check.overlaps.length === 0 && b.check.underground.length === 0 && !b.check.messages.some((m) => m.level !== 'ok'), `(7) 定番の並び（${n}レーン・${a}°）が閉じる・重なり/潜りなし`, `gap ${b.check.gapMm.toExponential(2)}mm ${msgs(b)}`);
    if (n === 3) {
      const iDown = l.pieces.findIndex((p) => p.type === 'bankDown');
      const iSlope = l.pieces.findIndex((p) => p.type === 'slopeUp');
      ok(iSlope === iDown + 1 && Math.abs(b.placed[iDown].end.p[1]) < 1e-9 && Math.abs(b.placed[iSlope].end.p[1] - dim(3, 'slopeRise')) < 1e-9 && l.pieces.slice(iSlope + 1, iSlope + 5).every((p) => p.type === 'straight') && l.pieces[iSlope + 5].type === 'corner', `(7) 定番の並び（${a}°）: バンク下り→谷→スロープ上り→直線4枚→コーナー`);
      const c = toCourse(l);
      const t = new Track(c);
      ok(Math.abs(t.length - b.check.totalLengthMm * MM_TO_GAME) / t.length < 0.02 && c.crestTakeoff === true, `(7) 定番の並び（${a}°）を書き出して Track で読める`, `Track ${t.length.toFixed(1)}m / 実寸換算 ${(b.check.totalLengthMm * MM_TO_GAME).toFixed(1)}m`);
    }
  }

// (7b) 旧バンク（横傾き）の保存データの読み込み: 直線1枚に置き換える。dims の廃止項目は捨てる
{
  const old = { version: 1, name: '旧', lanes: 3, pieces: [S, { type: 'bankIn' }, ...L4, { type: 'bankOut' }, S, ...L4], dims: { '3:bankLength': 600, '3:bankAngle': 25, '3:slopeRise': 120 } };
  const r = parseLayout(JSON.parse(JSON.stringify(old)));
  ok(!!r && r.legacy === 2 && r.layout.pieces.length === 12 && r.layout.pieces[1].type === 'straight' && r.layout.pieces[6].type === 'straight' && r.layout.pieces[1].frac === 1, '(7b) 旧 bankIn/bankOut は直線1枚に置き換えて読む', JSON.stringify(r?.layout.pieces.map((p) => p.type)));
  ok(!!r && build(r.layout).check.closed, '(7b) 旧バンク入りの定番の周回は置き換え後も閉じる');
  ok(!!r && JSON.stringify(r.layout.dims) === JSON.stringify({ '3:slopeRise': 120 }), '(7b) 廃止した寸法（bankLength）と変えられない寸法（bankAngle）の上書きは捨てる', JSON.stringify(r?.layout.dims));
  ok(parseLayout({ ...old, pieces: [{ type: 'nazo' }] }) === null && parseLayout({ version: 1, name: 'x', lanes: 4, pieces: [] }) === null, '(7b) 知らない部品・レーン数は読まない');
  const nb = parseLayout({ version: 1, name: 'x', lanes: 3, pieces: [{ type: 'bankUp', angle: 30 }, { type: 'bankDown', angle: 35 }, { type: 'bankUp' }] });
  ok(!!nb && nb.legacy === 0 && nb.layout.pieces.map((p) => p.angle).join(',') === '30,20,20', '(7b) 新バンクの角度は 20/30/40 以外を20にする');
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

// (11) ゲーム側の横傾き（CourseData.bank、度、+ は右側が高い）。エディタには横に傾く部品が無くなったので、CourseData を直接作って確かめる
{
  const plain = toCourse(sampleOval(3));
  ok(plain.bank === undefined && plain.crestTakeoff === true, '(11) エディタのコースは bank を書き出さない・crestTakeoff は true');
  // 坂（前後の傾き）は横傾きに数えない
  const pitch = build(lay([bu(40), bd(40)]));
  ok(pitch.placed.every((p) => p.samples.every((s) => Math.abs(bankDeg(s)) < 1e-9)), '(11) バンクの前後の傾きは横傾き0');
  // 楕円の点列に、最初の180度コーナーの間だけ 20·sin(進み) 度の横傾きを付ける（+=右が高い）
  const withBank = (sign: number): CourseData => {
    const n = plain.points.length;
    const bank = plain.points.map((_, i) => {
      const u = i / n; // 楕円 [S,S,L4,S,S,L4] の 1周に対する割合。最初のコーナーは直線2枚のあと
      const L = build(sampleOval(3)).placed.map((p) => p.length);
      const tot = L.reduce((x, y) => x + y, 0);
      const c0 = (L[0] + L[1]) / tot, c1 = (L[0] + L[1] + L[2] * 4) / tot;
      return u > c0 && u < c1 ? Math.round(sign * 20 * Math.sin((Math.PI * (u - c0)) / (c1 - c0)) * 100) / 100 : 0;
    });
    return { ...plain, bank };
  };
  for (const sign of [1, -1]) {
    const c = withBank(sign);
    const t = new Track(c);
    let s90 = 0;
    for (let s = 0; s < t.length; s += 0.5) if (Math.abs(t.bankAt(s)) > Math.abs(t.bankAt(s90))) s90 = s;
    const peak = (t.bankAt(s90) * 180) / Math.PI;
    const hi = t.frameAt(s90, sign).position.y - t.frameAt(s90, -sign).position.y;
    ok(Math.abs(Math.abs(peak) - 20) < 0.5 && Math.sign(peak) === sign, `(11) CourseData の横傾き ${sign > 0 ? '+' : '−'}20度: Track の最大の横傾き`, `${peak.toFixed(2)}度`);
    ok(hi > 0 && Math.abs(hi - c.width * Math.sin((Math.abs(peak) * Math.PI) / 180)) < 0.1, `(11) CourseData の横傾き ${sign > 0 ? '+' : '−'}20度: 高い側の路面の端が高い`, `端の高低差 ${hi.toFixed(3)}m`);
    ok(t.bankAt(0) === 0 && Math.abs(t.length - new Track(plain).length) < 1e-9, `(11) CourseData の横傾き ${sign > 0 ? '+' : '−'}20度: 平らな所は0・長さは変わらない`);
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
  // バンクの高さ: 回したあとも、高い所の位置が start 基準になる（直線→バンク上り→コーナー180度→バンク下り→スタート→コーナー180度）
  const bk = lay([S, BU, ...L4, BD, ST, ...L4]);
  const bb = build(bk);
  const cb = toCourse(bk);
  const iTop = cb.points.findIndex((q) => q[2] === Math.max(...cb.points.map((r) => r[2])));
  const st0 = bb.placed[7].start.p;
  ok(bb.check.closed && Math.abs(cb.points[0][2]) < 1e-9 && Math.abs(cb.points[0][0] - st0[0] * MM_TO_GAME) < 0.011, 'start: バンク入りの周回でも距離0は start の入口（高さ0）', `${cb.points[0]}`);
  // start の後はコーナー→直線→バンク上りの順なので、最初の高い点は1周の半分より後ろ
  ok(cb.bank === undefined && iTop > cb.points.length / 2, 'start: 高い所（バンクの上）の位置が回った列に反映される', `最初の最高点 ${iTop}/${cb.points.length}`);
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
  // バンクの高さ・折れ目の半径の上書き
  const bh = build({ ...lay([bu(30), ...L4, bd(30)]), dims: { [dimKey(3, 'bankRise')]: 300 } });
  ok(Math.abs(bh.placed[0].end.p[1] - 300) < 1e-9 && Math.abs(lastEnd(bh).p[1]) < 1e-9, '寸法: bankRise の上書きが高さに効く（上り＋下りで戻る）', `${bh.placed[0].end.p[1]}`);
  const br0 = build(lay([bu(30)]));
  const br = build({ ...lay([bu(30)]), dims: { [dimKey(3, 'bankBendRadius')]: 200 } });
  const exp = rampByAngle(Math.PI / 6, dim(3, 'bankRise'), 200);
  ok(Math.abs(br.placed[0].end.p[0] - exp.horizontal) < 1e-6 && Math.abs(br.placed[0].end.p[0] - br0.placed[0].end.p[0]) > 10 && Math.abs(br.placed[0].end.p[1] - dim(3, 'bankRise')) < 1e-9 && !br.check.messages.some((m) => m.level === 'warn' && m.text.includes('半径')), '寸法: bankBendRadius の上書きが形に効く（高さ・角度はそのまま）', `${br0.placed[0].end.p[0].toFixed(1)} → ${br.placed[0].end.p[0].toFixed(1)}mm`);
  // 半径が大きすぎる（丸みだけで高さを超える）と縮めて置き、警告を出す。高さ・出口の水平は保つ
  const bbig = build({ ...lay([bu(40)]), dims: { [dimKey(3, 'bankBendRadius')]: 5000 } });
  ok(bbig.check.messages.some((m) => m.level === 'warn' && m.text.includes('縮めて')) && Math.abs(bbig.placed[0].end.p[1] - dim(3, 'bankRise')) < 1e-9 && Math.abs(bbig.placed[0].end.f[1]) < 1e-12 && bankDims(3, 40, { [dimKey(3, 'bankBendRadius')]: 5000 }).shrunk, '寸法: 大きすぎる bankBendRadius は縮めて警告', msgs(bbig));
  // 5レーンの上書きは3レーンに効かない
  ok(bankDims(3, 20, { [dimKey(5, 'bankBendRadius')]: 100 }).radius === dim(3, 'bankBendRadius') && bankDims(5, 20, { [dimKey(5, 'bankBendRadius')]: 100 }).radius === 100, '寸法: bankBendRadius の3レーン・5レーンの上書きは別');
  // スロープの折れ目の半径: 上から見た長さと高さは表のまま、角度が変わる
  const sd0 = slopeDims(3);
  const sd1 = slopeDims(3, { [dimKey(3, 'slopeBendRadius')]: 1500 });
  const sb = build({ ...lay([UP, ...o]), dims: { [dimKey(3, 'slopeBendRadius')]: 1500 } });
  const mid1 = sb.placed[0].samples[Math.floor(sb.placed[0].samples.length / 2)];
  ok(Math.abs(sd1.angleRad - sd0.angleRad) > 0.005 && Math.abs(pitchDeg(mid1.f) - sd1.angleRad * DEG) < 1e-6 && Math.abs(sb.placed[0].end.p[0] - 1080) < 1e-6 && Math.abs(sb.check.heightMm - 110) < 1e-9 && sb.check.gapMm - 110 < 1e-6, '寸法: slopeBendRadius の上書きが斜面の角度に効く（長さ・高さはそのまま）', `${(sd0.angleRad * DEG).toFixed(2)}° → ${(sd1.angleRad * DEG).toFixed(2)}°`);
  const sbig = build({ ...lay([UP, S, DOWN]), dims: { [dimKey(3, 'slopeBendRadius')]: 99999 } });
  ok(sbig.check.messages.some((m) => m.level === 'warn' && m.text.includes('スロープの折れ目')) && Math.abs(lastEnd(sbig).p[1]) < 1e-9 && Math.abs(sbig.placed[1].maxY - 110) < 1e-9, '寸法: 大きすぎる slopeBendRadius は縮めて警告・高さは保つ', msgs(sbig));
  // 表: 折れ目の半径は 3レーン・5レーン別の値で、5レーンのほうが小さい。仮設定で備考に「未確認」
  ok((['bankBendRadius', 'slopeBendRadius'] as const).every((k) => CATALOG[5][k].value < CATALOG[3][k].value && [3, 5].every((n) => CATALOG[n as LaneCount][k].source === 'provisional' && CATALOG[n as LaneCount][k].note.includes('未確認'))), '寸法: 折れ目の半径は5レーンのほうが小さい・仮設定・未確認と記載', `バンク ${CATALOG[3].bankBendRadius.value}/${CATALOG[5].bankBendRadius.value}, スロープ ${CATALOG[3].slopeBendRadius.value}/${CATALOG[5].slopeBendRadius.value}`);
  ok([3, 5].every((n) => CATALOG[n as LaneCount].bankRise.source === 'provisional' && CATALOG[n as LaneCount].bankRise.note.includes('未確認')) && CATALOG[3].bankAngle.source === 'official' && CATALOG[3].bankAngle.value === 20 && !('bankLength' in CATALOG[3]), '寸法: bankRise は仮設定、進入角20度だけ公式、bankLength は廃止');
  // スロープの新しい形（円弧→斜面→円弧）: 出口は水平、真ん中の角度が計算どおり
  const sp = build(lay([UP])).placed[0];
  ok(Math.abs(pitchDeg(sp.samples[Math.floor(sp.samples.length / 2)].f) - sd0.angleRad * DEG) < 1e-6 && Math.abs(sp.end.f[1]) < 1e-12 && Math.abs(sp.end.p[0] - 1080) < 1e-6, 'スロープ: 円弧→斜面→円弧の形（真ん中の角度・出口は水平・上から1080mm）', `${(sd0.angleRad * DEG).toFixed(2)}°`);
  // 表の側: waveCount は全レーンの表にあり provisional
  ok([3, 5].every((n) => CATALOG[n as LaneCount].waveCount?.source === 'provisional' && CATALOG[n as LaneCount].waveCount.value === 2), '寸法: 表に waveCount（仮設定 2）がある');
}

{
  // 逆走・左右反転: 閉じたコースは閉じたまま、1周の長さも同じ。2回かけると元に戻る
  const S0: PieceSpec = { type: 'straight', frac: 1 };
  const Lc: PieceSpec = { type: 'corner', dir: 'L' };
  const L4c = [Lc, Lc, Lc, Lc];
  const src: Layout = { version: 1, name: 't', lanes: 3, pieces: [{ type: 'start' }, { type: 'slopeUp' }, { type: 'bankUp', angle: 30 }, ...L4c, { type: 'bankDown', angle: 30 }, { type: 'slopeDown' }, S0, ...L4c] };
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
  const rv = reverseLayout(src).pieces;
  ok(rv.filter((p) => p.type === 'bankUp' || p.type === 'bankDown').map((p) => `${p.type}${p.angle}`).join(',') === 'bankUp30,bankDown30' && JSON.stringify(mirrorLayout(src).pieces.filter((p) => p.angle)) === JSON.stringify(src.pieces.filter((p) => p.angle)), '逆走: バンク上り↔下り（角度はそのまま）、左右反転ではバンクはそのまま');
  const rb = build(reverseLayout(sampleBankValley(3, 40)));
  ok(rb.check.closed && rb.check.underground.length === 0 && rb.check.overlaps.length === 0, '逆走: 定番の並びも閉じたまま・潜り/重なりなし');
}

console.log(`\n${passes} 件成功 / ${fails} 件失敗`);
if (fails) process.exit(1);
