// コースエディタの幾何（src/editor/geom.ts・catalog.ts・export.ts）のテスト
// 実行: npm run editortest（失敗があれば exit 1）
import { Track, type CourseData } from '../src/track';
import { build, right, sampleOval, sampleBankValley, emptyLayout, pieceLabel, canAddPiece, mirrorLayout, reverseLayout, parseLayout, bankDims, slopeDims } from '../src/editor/geom';
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
const A: PieceSpec = { type: 'bankApproach' };
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
  // slopeLength = 直線1枚ぶん（店長の説明）なので、オーバルの最初の直線1枚を slopeUp に替えると高さだけずれる
  const o = sampleOval(3).pieces.slice(1);
  const b2 = build(lay([UP, ...o]));
  ok(!b2.check.closed && Math.abs(b2.check.heightMm - 110) < 1e-9, '(4) slopeUp だけの周回は heightMm=110', `height ${b2.check.heightMm}, ${msgs(b2)}`);
  const b3 = build(lay([DOWN, ...o]));
  ok(b3.check.underground.includes(0), '(4) 床から slopeDown すると潜りとして出る', msgs(b3));
}

// ウェーブ: 路面は平らなまま左右に蛇行。入口と出口は横ずれ0・まっすぐ、flip で左右が逆
{
  const a = build(lay([{ type: 'wave' }]));
  const b = build(lay([{ type: 'wave', flip: true }]));
  const e = lastEnd(a);
  const zs = a.placed[0].samples.map((s) => s.p[2]), zb = b.placed[0].samples.map((s) => s.p[2]);
  const flat = a.placed[0].samples.every((s) => Math.abs(s.p[1]) < 1e-9 && Math.abs(s.u[1] - 1) < 1e-9);
  ok(flat && Math.abs(e.p[2]) < 1e-6 && Math.abs(e.f[2]) < 1e-6 && Math.abs(e.p[0] - dim(3, 'waveLength')) < 1e-6, 'ウェーブ: 路面は平ら、出口は横ずれ0・まっすぐ・長さは表のまま', `出口 z ${e.p[2].toExponential(1)}`);
  ok(Math.max(...zs) > 5 && Math.min(...zs) < -5 && Math.max(...zs) <= dim(3, 'waveSwing') + 1e-6 && zs.every((z, i) => Math.abs(z + zb[i]) < 1e-9), 'ウェーブ: 左右の両側へ振れる・振れ幅は表の値以下・flip で左右が逆', `${Math.min(...zs).toFixed(1)}〜${Math.max(...zs).toFixed(1)}mm`);
  const oval = build(lay([{ type: 'wave' }, S, ...L4, S, S, ...L4]));
  ok(oval.check.closed, 'ウェーブ: 直線1枚の代わりに置いても周回が閉じる', `ずれ ${oval.check.gapMm.toFixed(2)}mm`);
}

// (5) バンクアプローチ: 進行方向に対して上へ 20度曲げる円弧（へこむ向き、半径 bankBendRadius）。横には傾けない
const rollDeg = (b: Built) => Math.max(...b.placed.flatMap((p) => p.samples.map((s) => Math.abs(bankDeg(s)))));
for (const n of [3, 5] as LaneCount[]) {
  const R = dim(n, 'bankBendRadius');
  const a = dim(n, 'bankAngle') * Math.PI / 180;
  const b = build(lay([A], n));
  const p = b.placed[0];
  const e = p.end;
  const chord = Math.hypot(...e.p);
  ok(Math.abs(pitchDeg(e.f) - 20) < 1e-9 && Math.abs(bankDeg(e)) < 1e-9 && Math.abs(right(e)[1]) < 1e-12, `(5) ${n}レーン アプローチ1枚: 出口の上向き角が20度・横傾き0`, `坂 ${pitchDeg(e.f).toFixed(6)}°, 傾き ${bankDeg(e).toExponential(1)}°`);
  ok(Math.abs(chord - 2 * R * Math.sin(a / 2)) < 1e-6 && Math.abs(chord - bankDims(n).chord) < 1e-9 && Math.abs(p.length - R * a) < 1e-9 && Math.abs(e.p[2]) < 1e-9, `(5) ${n}レーン アプローチ1枚: 弦の長さ=2R·sin(10°)・中心線=R·20°・横にずれない`, `弦 ${chord.toFixed(2)}mm（R ${R}）, 中心線 ${p.length.toFixed(2)}mm`);
  if (n === 3) ok(Math.abs(chord - 226) < 1.0 && R === 650, '(5) 3レーン アプローチ1枚: 弦 約226mm（実測記事の値と合う）', `弦 ${chord.toFixed(2)}mm`);
  // へこむ向き: 角度が単調に増える
  const pd = p.samples.map((s) => pitchDeg(s.f));
  ok(pd.every((v, i) => i === 0 || v >= pd[i - 1] - 1e-12) && Math.abs(e.p[1] - R * (1 - Math.cos(a))) < 1e-9, `(5) ${n}レーン アプローチ: へこむ向き（角度が増える一方）・高さ R(1−cos20°)`, `高さ ${e.p[1].toFixed(2)}mm`);
  // 2枚で40度
  const b2 = build(lay([A, A], n));
  ok(Math.abs(pitchDeg(lastEnd(b2).f) - 40) < 1e-9 && rollDeg(b2) < 1e-9, `(5) ${n}レーン アプローチ2枚: 出口の上向き角が40度・横傾き0`, `${pitchDeg(lastEnd(b2).f).toFixed(6)}°`);
  // アプローチ→コーナー×4（傾いた面の上）→アプローチ: 出口が水平・高さ0・進行方向が反転・横へ 2·半径
  const Rc = dim(n, 'cornerCenterRadius');
  const W = trackWidth(n);
  for (const k of [1, 2]) {
    const AA = rep(A, k);
    const bv = build(lay([...AA, ...L4, ...AA], n));
    const ve = lastEnd(bv);
    const ang = k * a;
    ok(angle(ve.u, [0, 1, 0]) < 1e-9 && Math.abs(ve.p[1]) < 1e-9 && angle(ve.f, [-1, 0, 0]) < 1e-9 && Math.abs(ve.p[0]) < 1e-9 && Math.abs(Math.abs(ve.p[2]) - 2 * Rc) < 1e-9, `(5) ${n}レーン アプローチ${k}枚→コーナー×4→アプローチ${k}枚: 出口が水平・高さ0・進行方向が反転`, `出口 ${ve.p.map((v) => v.toFixed(3))}, 傾き ${angle(ve.u, [0, 1, 0]).toExponential(1)}°`);
    // 最高点: アプローチの高さ R(1−cos) ＋ 傾いた面の上のコーナーの頂点 Rc·sin(角度)（2枚なら 2枚ぶんの円弧の高さ）
    const top = R * (1 - Math.cos(ang)) + Rc * Math.sin(ang);
    const maxY = Math.max(...bv.placed.map((q) => q.maxY));
    ok(Math.abs(maxY - top) < 0.5, `(5) ${n}レーン アプローチ${k}枚の間の最高点の高さ`, `${maxY.toFixed(1)}mm（式 ${top.toFixed(1)}mm）`);
    // 傾いた面の上のコーナー: 頂点で横傾き=角度（左回りは外側＝右が高い）・路面の端は中心線より W/2·sin だけ低い・床に潜らない
    const apex = bv.placed[k + 1].end;
    const edgeMin = (q: Built['placed'][number]) => Math.min(...q.samples.map((s) => s.p[1] - Math.abs(right(s)[1]) * (W / 2)));
    const centerMin = (q: Built['placed'][number]) => Math.min(...q.samples.map((s) => s.p[1]));
    const qa = bv.placed[k + 1];
    ok(Math.abs(bankDeg(apex) - k * 20) < 1e-6 && Math.abs(Math.abs(right(apex)[1]) - Math.sin(ang)) < 1e-9 && Math.abs(qa.minY - edgeMin(qa)) < 1e-9 && qa.minY < centerMin(qa) - 1 && bv.check.underground.length === 0 && !bv.check.messages.some((m) => m.level === 'error'), `(5) ${n}レーン アプローチ${k}枚: 傾いた面のコーナーの頂点で横傾き +${k * 20}度・端の高さを判定に使う・潜らない`, `頂点 ${bankDeg(apex).toFixed(3)}°, 頂点の高さ ${apex.p[1].toFixed(1)}, 部品の最低 中心線 ${centerMin(qa).toFixed(1)} / 端 ${qa.minY.toFixed(1)}mm`);
  }
}
{
  // 床の判定は路面の端も見る: スロープ（落差160に上書き）で上がってから、アプローチ→コーナー×8 で傾いた面を1周すると、
  // 中心線の最低は 160 + R(1−cos20°) − 半径·sin20°（床の上）だが、低い側の端は さらに 182.5·sin20° ≈ 62mm 低く床より下
  const b = build({ ...lay([UP, A, ...rep(L, 8)]), dims: { [dimKey(3, 'slopeRise')]: 160 } });
  const centerMin = Math.min(...b.placed.flatMap((p) => p.samples.map((s) => s.p[1])));
  ok(centerMin > -1 && b.check.underground.length > 0 && b.check.messages.some((m) => m.level === 'error' && m.text.includes('潜って')), '(6) 床の判定は路面の端も見る（中心線は潜らなくても端が潜れば error）', `中心線の最低 ${centerMin.toFixed(1)}mm, 潜り ${JSON.stringify(b.check.underground)}`);
  // 床で下に向かうアプローチ: 床からいきなりコーナー×4を下る並び（アプローチ→コーナー×4→アプローチ→アプローチ）は潜る
  // 傾いた面で180度回ったあと、アプローチを置かずに直線を置くと下り20度のまま床へ潜る
  const bd = build(lay([A, ...L4, S]));
  ok(bd.check.underground.includes(5) && Math.abs(pitchDeg(bd.placed[5].start.f) + 20) < 1e-9, '(6) アプローチ→コーナー×4→直線は下り20度のまま床に潜る（戻すにはもう1枚アプローチ）', msgs(bd));
  ok(pieceLabel(A) === 'バンクアプローチ', '(6) ラベル');
}

// (7) 見本「定番の並び」: 閉じる・重なり/潜りなし・谷がある（3レーン用。5レーン・40度版でも閉じる）
for (const n of [3, 5] as LaneCount[])
  for (const k of [1, 2] as const) {
    const l = sampleBankValley(n, k);
    const b = build(l);
    ok(b.check.closed && b.check.overlaps.length === 0 && b.check.underground.length === 0 && !b.check.messages.some((m) => m.level !== 'ok'), `(7) 定番の並び（${n}レーン・アプローチ${k}枚）が閉じる・重なり/潜りなし`, `gap ${b.check.gapMm.toExponential(2)}mm ${msgs(b)}`);
    if (n === 3) {
      const iA = l.pieces.map((p, i) => (p.type === 'bankApproach' ? i : -1)).filter((i) => i >= 0);
      const iSlope = l.pieces.findIndex((p) => p.type === 'slopeUp');
      const iA2 = iA[iA.length - 1];
      ok(iA.length === 2 * k && l.pieces.slice(iA[k - 1] + 1, iA[k - 1] + 5).every((p) => p.type === 'corner') && iSlope === iA2 + 1 && Math.abs(b.placed[iA2].end.p[1]) < 1e-9 && Math.abs(b.placed[iSlope].end.p[1] - dim(3, 'slopeRise')) < 1e-9 && l.pieces.slice(iSlope + 1, iSlope + 5).every((p) => p.type === 'straight') && l.pieces[iSlope + 5].type === 'corner', `(7) 定番の並び（アプローチ${k}枚）: アプローチ→コーナー×4→アプローチ→谷→スロープ上り→直線4枚→コーナー`);
      const c = toCourse(l);
      const t = new Track(c);
      ok(Math.abs(t.length - b.check.totalLengthMm * MM_TO_GAME) / t.length < 0.02 && c.crestTakeoff === true, `(7) 定番の並び（アプローチ${k}枚）を書き出して Track で読める`, `Track ${t.length.toFixed(1)}m / 実寸換算 ${(b.check.totalLengthMm * MM_TO_GAME).toFixed(1)}m`);
      // 書き出しの横傾き: 傾いた面のコーナーの頂点で +20度（2枚なら+40度）。ほかは0
      const peak = Math.max(...(c.bank ?? [0]));
      const lo = Math.min(...(c.bank ?? [0]));
      const ip = (c.bank ?? []).indexOf(peak);
      ok(!!c.bank && Math.abs(peak - 20 * k) < 0.5 && lo > -0.01 && c.bank.length === c.points.length, `(7) 定番の並び（アプローチ${k}枚）: 書き出しの bank が頂点で約${20 * k}度（+=右が高い＝左回りの外側）`, `最大 ${peak}度（点 ${ip}/${c.points.length}）, 最小 ${lo}`);
      // ゲームの Track で読んだ横傾きも約20度、高い側の端が高い
      let sMax = 0;
      for (let d = 0; d < t.length; d += 0.25) if (t.bankAt(d) > t.bankAt(sMax)) sMax = d;
      const pk = (t.bankAt(sMax) * 180) / Math.PI;
      const hi = t.frameAt(sMax, 1).position.y - t.frameAt(sMax, -1).position.y;
      ok(Math.abs(pk - 20 * k) < 1 && hi > 0, `(7) 定番の並び（アプローチ${k}枚）: Track の横傾きの最大 約${20 * k}度・右の端が高い`, `${pk.toFixed(2)}度, 端の高低差 ${hi.toFixed(3)}m`);
    }
  }

// (7b) 旧部品の読み込み: 旧 bankIn/bankOut（横傾き）は直線1枚、F12 の bankUp/bankDown はアプローチ1枚。dims の廃止項目は捨てる
{
  const old = { version: 1, name: '旧', lanes: 3, pieces: [S, { type: 'bankIn' }, ...L4, { type: 'bankOut' }, S, ...L4], dims: { '3:bankLength': 600, '3:bankAngle': 25, '3:slopeRise': 120 } };
  const r = parseLayout(JSON.parse(JSON.stringify(old)));
  ok(!!r && r.legacy === 2 && r.legacyBank === 0 && r.layout.pieces.length === 12 && r.layout.pieces[1].type === 'straight' && r.layout.pieces[6].type === 'straight' && r.layout.pieces[1].frac === 1, '(7b) 旧 bankIn/bankOut は直線1枚に置き換えて読む', JSON.stringify(r?.layout.pieces.map((p) => p.type)));
  ok(!!r && build(r.layout).check.closed, '(7b) 旧バンク入りの定番の周回は置き換え後も閉じる');
  ok(!!r && JSON.stringify(r.layout.dims) === JSON.stringify({ '3:slopeRise': 120 }), '(7b) 廃止した寸法（bankLength）と変えられない寸法（bankAngle）の上書きは捨てる', JSON.stringify(r?.layout.dims));
  ok(parseLayout({ ...old, pieces: [{ type: 'nazo' }] }) === null && parseLayout({ version: 1, name: 'x', lanes: 4, pieces: [] }) === null, '(7b) 知らない部品・レーン数は読まない');
  // F12 の見本（スタート→直線3→バンク上り→180度→バンク下り→スロープ上り→直線4→180度→スロープ下り）と角度・bankRise の上書き
  const f12 = { version: 1, name: 'F12', lanes: 3, pieces: [{ type: 'start' }, S, S, S, { type: 'bankUp', angle: 30 }, ...L4, { type: 'bankDown', angle: 30 }, UP, S, S, S, S, ...L4, DOWN], dims: { '3:bankRise': 300, '3:bankBendRadius': 400 } };
  const r2 = parseLayout(JSON.parse(JSON.stringify(f12)));
  ok(!!r2 && r2.legacy === 0 && r2.legacyBank === 2 && r2.layout.pieces[4].type === 'bankApproach' && r2.layout.pieces[9].type === 'bankApproach' && r2.layout.pieces.every((p) => !('angle' in p)) && r2.layout.pieces.length === f12.pieces.length, '(7b) F12 の bankUp/bankDown はアプローチ1枚ずつに置き換え（角度は捨てる）', JSON.stringify(r2?.layout.pieces.map((p) => p.type)));
  ok(!!r2 && JSON.stringify(r2.layout.dims) === JSON.stringify({ '3:bankBendRadius': 400 }), '(7b) 廃止した bankRise の上書きは捨て、bankBendRadius は残す', JSON.stringify(r2?.layout.dims));
  // F12 の見本は、置き換えると新しい見本と同じ並びになり閉じる（スロープが直線1枚の長さになったので行きと帰りがそろう）
  const b2 = r2 && build({ ...r2.layout, dims: undefined });
  ok(!!b2 && b2.check.closed && JSON.stringify(r2!.layout.pieces) === JSON.stringify(sampleBankValley(3).pieces), '(7b) F12 の見本は置き換え後、新しい見本と同じ並びで閉じる', b2 ? msgs(b2) : '');
  // F12 では閉じていた並び（バンク上り→コーナー×4→直線→バンク下り→コーナー×4→直線）は、置き換えると閉じない（傾いた面の上の直線が下り坂になる。トーストで知らせる）
  const r3 = parseLayout({ version: 1, name: 'F12b', lanes: 3, pieces: [{ type: 'bankUp' }, ...L4, S, { type: 'bankDown' }, ...L4, S] });
  ok(!!r3 && r3.legacyBank === 2 && !build(r3.layout).check.closed, '(7b) F12 で閉じていた別の並びは置き換え後に閉じないことがある', r3 ? msgs(build(r3.layout)) : '');
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
  // 同じ形で、最初の直線を上り（直線1枚ぶん）で110mm 上げ、ターンの途中の下りで床へ戻す → 交差は110mm 差
  const figH = [UP, S, S, S, S, L, L, L, DOWN, S, L, L, L, ...rep(S, 6)];
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

// (11) ゲーム側の横傾き（CourseData.bank、度、+ は右側が高い）。CourseData を直接作って確かめる（エディタの書き出しは (7) で確認）
{
  const plain = toCourse(sampleOval(3));
  ok(plain.bank === undefined && plain.crestTakeoff === true, '(11) 平らなコースは bank を書き出さない・crestTakeoff は true');
  // 坂（前後の傾き）は横傾きに数えない
  const pitch = build(lay([A, A, S, UP, DOWN]));
  ok(pitch.placed.every((p) => p.samples.every((s) => Math.abs(bankDeg(s)) < 1e-9)), '(11) アプローチ・スロープの前後の傾きは横傾き0');
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
  ok(Object.values(CATALOG[3]).every((d) => d.source !== 'measured' || /店長|実測/.test(d.note)) && CATALOG[3].bankBendRadius.note.includes('第三者の実測記事の値。公式ではない') && !/https?:/.test(CATALOG[3].bankBendRadius.note), '実測値は出どころ（店長・第三者の実測）を書く・第三者の実測記事はURLを書かない');
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
  // バンクの高さ: 回したあとも、高い所の位置が start 基準になる（直線→アプローチ→コーナー180度（傾いた面）→アプローチ→スタート→コーナー180度）
  const bk = lay([S, A, ...L4, A, ST, ...L4]);
  const bb = build(bk);
  const cb = toCourse(bk);
  const iTop = cb.points.findIndex((q) => q[2] === Math.max(...cb.points.map((r) => r[2])));
  const st0 = bb.placed[7].start.p;
  ok(bb.check.closed && Math.abs(cb.points[0][2]) < 1e-9 && Math.abs(cb.points[0][0] - st0[0] * MM_TO_GAME) < 0.011, 'start: バンク入りの周回でも距離0は start の入口（高さ0）', `${cb.points[0]}`);
  // start の後はコーナー→直線→バンク上りの順なので、最初の高い点は1周の半分より後ろ
  const ib = cb.bank ? cb.bank.indexOf(Math.max(...cb.bank)) : -1;
  ok(iTop > cb.points.length / 2 && Math.abs(ib - iTop) <= 1, 'start: 高い所（バンクの上）と横傾きの最大の位置が回った列に反映される', `最初の最高点 ${iTop}・横傾き最大 ${ib}/${cb.points.length}`);
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
  const o = sampleOval(3).pieces.slice(1);
  const sl = build(lay([UP, ...o]));
  const slo = build({ ...lay([UP, ...o]), dims: { [dimKey(3, 'slopeRise')]: 150, [dimKey(3, 'slopeLength')]: 1000 } });
  ok(Math.abs(slo.check.heightMm - 150) < 1e-9 && sl.check.heightMm === 110 && Math.abs(slo.placed[0].samples[slo.placed[0].samples.length - 1].p[0]) > 0, '寸法: スロープの高さの上書きが形に効く', `高さ ${slo.check.heightMm}`);
  const ssu = build({ ...lay([UP, S, DOWN]), dims: { [dimKey(3, 'slopeRise')]: 150 } });
  ok(Math.abs(ssu.placed[1].maxY - 150) < 1e-9 && Math.abs(lastEnd(ssu).p[1]) < 1e-9, '寸法: slopeRise の上書き（上り→直線→下りで戻る）', `${ssu.placed[1].maxY}`);
  // ウェーブ: 振れ幅・往復の回数
  const w0 = build(lay([{ type: 'wave' }]));
  const swing = (pl: Built) => Math.max(...pl.placed[0].samples.map((s) => Math.abs(s.p[2])));
  const wh = build({ ...lay([{ type: 'wave' }]), dims: { [dimKey(3, 'waveSwing')]: 30 } });
  ok(Math.abs(swing(wh) - 2 * swing(w0)) < 0.5, '寸法: waveSwing の上書きが振れ幅に効く', `${swing(w0).toFixed(2)} → ${swing(wh).toFixed(2)}`);
  const turns = (pl: Built) => { const z = pl.placed[0].samples.map((s) => s.p[2]); let n = 0; for (let i = 1; i < z.length - 1; i++) if (z[i] > z[i - 1] && z[i] >= z[i + 1] && z[i] > 0.5) n++; return n; };
  const w4 = build({ ...lay([{ type: 'wave' }]), dims: { [dimKey(3, 'waveCount')]: 4 } });
  ok(turns(w0) === 2 && turns(w4) === 4 && Math.abs(lastEnd(w4).p[2]) < 1e-6, '寸法: waveCount の上書き（既定2往復・4往復にできる・出口は横ずれ0）', `${turns(w0)} / ${turns(w4)}`);
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
  // 90度の折れを混ぜた並びが格子の上で閉じる（コーナーの半径が直線の長さと釣り合っているか）
  for (const [name, seq] of [['直線2・左90・直線2・左180・右90・左180', 'SSLSSLLRLL'], ['楕円', 'SSLLSSLL'], ['左90・直線2・左180・右90・左180・直線', 'SLSSLLRLLS']] as const) {
    const pieces = [...seq].flatMap((c) => (c === 'S' ? [S] : c === 'L' ? [L, L] : [R, R]));
    const c3 = build(lay(pieces)).check;
    ok(c3.closed, `3レーン: ${name} が閉じる`, `ずれ ${c3.gapMm.toFixed(1)}mm`);
  }
  {
    // 5レーンは半径が直線の1.5倍なので直線3枚で釣り合う: 直線3・左90・直線3・左180・右90・左180
    const pieces = [S, S, S, L, L, S, S, S, L, L, L, L, R, R, L, L, L, L];
    const c5 = build(lay(pieces, 5)).check;
    ok(c5.closed, '5レーン: 直線3・左90・直線3・左180・右90・左180 が閉じる', `ずれ ${c5.gapMm.toFixed(1)}mm`);
  }
  const cr = build({ ...base, dims: { [dimKey(3, 'cornerCenterRadius')]: 600 } });
  ok(Math.abs(cr.placed[2].length - 600 * Math.PI / 4) < 1e-6 && cr.check.closed && cr.check.totalLengthMm > b0.check.totalLengthMm, '寸法: コーナー半径の上書きが形に効く（楕円は半径を変えても閉じる）');
  const crl = build({ ...lay([S, S, L, L, L, L, S, L, L, L, L]), dims: { [dimKey(3, 'cornerCenterRadius')]: 600 } });
  ok(!crl.check.closed, '寸法: 閉じない形では半径の上書き後も「閉じていない」のまま（補正しない）');
  // 幅・フェンス高: 書き出しに効く
  const ew = toCourse({ ...base, dims: { [dimKey(3, 'laneWidth')]: 120, [dimKey(3, 'wallHeight')]: 55 } });
  ok(Math.abs(ew.width - 120 * MM_TO_GAME * 3) < 0.011 && Math.abs(ew.wallHeight - 55 * MM_TO_GAME) < 0.011 && ew.width !== e0.width, '寸法: laneWidth・wallHeight の上書きが書き出しに効く', `${ew.width}, ${ew.wallHeight}`);
  ok(trackWidth(3, { [dimKey(3, 'laneWidth')]: 120 }) === 3 * 120 + 20 && trackWidth(3) === 365, '寸法: trackWidth に上書きが効く');
  // バンクアプローチの半径の上書き: 形に効く（角度20度はそのまま）。5レーンの上書きは3レーンに効かない
  const br = build({ ...lay([A]), dims: { [dimKey(3, 'bankBendRadius')]: 400 } });
  const bre = br.placed[0].end;
  ok(Math.abs(Math.hypot(...bre.p) - 2 * 400 * Math.sin(Math.PI / 18)) < 1e-6 && Math.abs(pitchDeg(bre.f) - 20) < 1e-9 && Math.abs(bankDims(3, { [dimKey(3, 'bankBendRadius')]: 400 }).chord - Math.hypot(...bre.p)) < 1e-9, '寸法: bankBendRadius の上書きが形に効く（角度20度はそのまま）', `弦 ${Math.hypot(...bre.p).toFixed(2)}mm`);
  ok(bankDims(3, { [dimKey(5, 'bankBendRadius')]: 100 }).radius === dim(3, 'bankBendRadius') && bankDims(5, { [dimKey(5, 'bankBendRadius')]: 100 }).radius === 100, '寸法: bankBendRadius の3レーン・5レーンの上書きは別');
  // 半径を変えても見本は閉じる（アプローチの前後の変位が打ち消すため）
  ok(build({ ...sampleBankValley(3), dims: { [dimKey(3, 'bankBendRadius')]: 400 } }).check.closed, '寸法: bankBendRadius を変えても定番の並びは閉じる');
  // bankAngle は変えられない（部品の前提）。読み込みで捨てる
  ok(parseLayout({ version: 1, name: 'x', lanes: 3, pieces: [A], dims: { '3:bankAngle': 30 } })!.layout.dims === undefined, '寸法: bankAngle の上書きは読み込みで捨てる');
  // スロープの折れ目の半径: 上から見た長さと高さは表のまま、角度が変わる
  const sd0 = slopeDims(3);
  const sd1 = slopeDims(3, { [dimKey(3, 'slopeBendRadius')]: 200 });
  const sb = build({ ...lay([UP, ...o]), dims: { [dimKey(3, 'slopeBendRadius')]: 200 } });
  const mid1 = sb.placed[0].samples[Math.floor(sb.placed[0].samples.length / 2)];
  ok(Math.abs(sd1.angleRad - sd0.angleRad) > 0.005 && Math.abs(pitchDeg(mid1.f) - sd1.angleRad * DEG) < 1e-6 && Math.abs(sb.placed[0].end.p[0] - 540) < 1e-6 && Math.abs(sb.check.heightMm - 110) < 1e-9 && sb.check.gapMm - 110 < 1e-6, '寸法: slopeBendRadius の上書きが斜面の角度に効く（長さ・高さはそのまま）', `${(sd0.angleRad * DEG).toFixed(2)}° → ${(sd1.angleRad * DEG).toFixed(2)}°`);
  const sbig = build({ ...lay([UP, S, DOWN]), dims: { [dimKey(3, 'slopeBendRadius')]: 99999 } });
  ok(sbig.check.messages.some((m) => m.level === 'warn' && m.text.includes('スロープの折れ目')) && Math.abs(lastEnd(sbig).p[1]) < 1e-9 && Math.abs(sbig.placed[1].maxY - 110) < 1e-9, '寸法: 大きすぎる slopeBendRadius は縮めて警告・高さは保つ', msgs(sbig));
  // 表: 折れ目の半径は 3レーン・5レーン別の値で、5レーンのほうが小さい。スロープの半径はバンクより小さい
  ok((['bankBendRadius', 'slopeBendRadius'] as const).every((k) => CATALOG[5][k].value < CATALOG[3][k].value && CATALOG[5][k].source === 'provisional' && CATALOG[5][k].note.includes('未確認')), '寸法: 折れ目の半径は5レーンのほうが小さい・5レーンは仮設定・未確認と記載', `バンク ${CATALOG[3].bankBendRadius.value}/${CATALOG[5].bankBendRadius.value}, スロープ ${CATALOG[3].slopeBendRadius.value}/${CATALOG[5].slopeBendRadius.value}`);
  ok([3, 5].every((n) => CATALOG[n as LaneCount].slopeBendRadius.value < CATALOG[n as LaneCount].bankBendRadius.value) && CATALOG[3].slopeBendRadius.source === 'provisional' && CATALOG[3].slopeBendRadius.note.includes('公開値なし'), '寸法: スロープの折れ目の半径はバンクの半径より小さい（3レーンは仮・公開値なし）');
  ok(CATALOG[3].bankBendRadius.source === 'measured' && CATALOG[3].bankBendRadius.value === 650 && CATALOG[3].bankAngle.source === 'official' && CATALOG[3].bankAngle.value === 20 && !('bankLength' in CATALOG[3]) && !('bankRise' in CATALOG[3]) && !('bankRise' in CATALOG[5]), '寸法: アプローチの半径650は実測（第三者）、角度20度は公式、bankLength・bankRise は廃止');
  // スロープ: 全長=直線1枚・落差110（公式）・出口水平
  ok(CATALOG[3].slopeLength.value === CATALOG[3].straightLength.value && CATALOG[3].slopeLength.source === 'measured' && CATALOG[5].slopeLength.value === CATALOG[5].straightLength.value && CATALOG[3].slopeRise.source === 'measured' && CATALOG[3].slopeRise.value === 110, '寸法: スロープの全長＝直線1枚（3レーン540・5レーン600）・落差110は店長の説明（出典ページ未確認）');
  const sp = build(lay([UP])).placed[0];
  ok(Math.abs(sp.end.p[0] - dim(3, 'straightLength')) < 1e-6 && Math.abs(sp.end.p[1] - 110) < 1e-9 && Math.abs(sp.end.f[1]) < 1e-12 && !sd0.shrunk, 'スロープ: 上から見た長さ＝直線1枚・落差110・出口水平・半径は縮めない', `斜面 ${(sd0.angleRad * DEG).toFixed(2)}°, 半径 ${sd0.radius}`);
  ok(Math.abs(pitchDeg(sp.samples[Math.floor(sp.samples.length / 2)].f) - sd0.angleRad * DEG) < 1e-6 && sd0.angleRad * DEG > Math.atan2(110, 540) * DEG && sd0.angleRad * DEG < 15, 'スロープ: 円弧→斜面→円弧の形（真ん中の角度が計算どおり、平均勾配11.5度より急・15度未満）', `${(sd0.angleRad * DEG).toFixed(2)}°`);
  const sp5 = build(lay([UP], 5)).placed[0];
  ok(Math.abs(sp5.end.p[0] - 600) < 1e-6 && Math.abs(sp5.end.f[1]) < 1e-12 && !slopeDims(5).shrunk, 'スロープ（5レーン）: 上から600・出口水平', `${(slopeDims(5).angleRad * DEG).toFixed(2)}°`);
  // 30度バンク: 弦の長さは20度の部品と同じ、出口の上向き角30度、傾いた面で180度回ってもう1枚で水平に戻る
  {
    const B30: PieceSpec = { type: 'bankApproach', deg: 30 };
    const b30 = build(lay([B30])).placed[0];
    ok(Math.abs(pitchDeg(b30.end.f) - 30) < 1e-9 && Math.abs(Math.hypot(...b30.end.p) - bankDims(3).chord) < 1e-6, '30度バンク: 出口の上向き角30度・弦の長さは20度の部品と同じ', `弦 ${Math.hypot(...b30.end.p).toFixed(2)} / ${bankDims(3).chord.toFixed(2)}mm、半径 ${bankDims(3, undefined, true).radius.toFixed(1)}mm`);
    const lap = build(lay([S, S, B30, ...L4, B30, S, S, B30, ...L4, B30]));
    ok(lap.check.closed && lap.check.underground.length === 0, '30度バンク: 両端をバンクにした楕円が閉じる・潜らない', `ずれ ${lap.check.gapMm.toFixed(2)}mm`);
    const rt = parseLayout(JSON.parse(JSON.stringify(lay([B30, A]))));
    ok(rt?.layout.pieces[0].deg === 30 && rt.layout.pieces[1].deg === undefined && pieceLabel(B30) === '30°バンク', '30度バンク: 保存・読み込みで角度が残る');
  }
  // 表の側: waveCount は全レーンの表にあり provisional
  ok([3, 5].every((n) => CATALOG[n as LaneCount].waveCount?.source === 'provisional' && CATALOG[n as LaneCount].waveCount.value === 2), '寸法: 表に waveCount（仮設定 2）がある');
}

{
  // 逆走・左右反転: 閉じたコースは閉じたまま、1周の長さも同じ。2回かけると元に戻る
  const S0: PieceSpec = { type: 'straight', frac: 1 };
  const Lc: PieceSpec = { type: 'corner', dir: 'L' };
  const L4c = [Lc, Lc, Lc, Lc];
  const src: Layout = { version: 1, name: 't', lanes: 3, pieces: [{ type: 'start' }, { type: 'slopeUp' }, { type: 'bankApproach' }, ...L4c, { type: 'bankApproach' }, { type: 'slopeDown' }, S0, ...L4c] };
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
  const idxA = (ps: PieceSpec[]) => ps.map((p, i) => (p.type === 'bankApproach' ? i : -1)).filter((i) => i >= 0).join(',');
  ok(idxA(rv) === '6,11' && idxA(mirrorLayout(src).pieces) === idxA(src.pieces) && rv.filter((p) => p.type === 'bankApproach').every((p) => Object.keys(p).length === 1), '逆走: アプローチはそのまま（並びが逆になるだけ）、左右反転でもそのまま', idxA(rv));
  // 逆走したコースでも、傾いた面のコーナーは外側が高い（右回りになるので bank は −）
  const rc = toCourse(reverseLayout(sampleBankValley(3)));
  ok(Math.abs(Math.min(...rc.bank!) + 20) < 0.5 && Math.max(...rc.bank!) < 0.01, '逆走: 定番の並びは右回りの傾いたコーナーになり、書き出しの bank は約 −20度（左が高い＝外側）', `${Math.min(...rc.bank!)}`);
  const rb = build(reverseLayout(sampleBankValley(3, 2)));
  ok(rb.check.closed && rb.check.underground.length === 0 && rb.check.overlaps.length === 0, '逆走: 定番の並びも閉じたまま・潜り/重なりなし');
}

console.log(`\n${passes} 件成功 / ${fails} 件失敗`);
if (fails) process.exit(1);
