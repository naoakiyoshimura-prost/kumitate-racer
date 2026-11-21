// 店長から届いた共有コードを確かめて、作り付けコースの JSON にする（2026-11-21 店長「俺が全部コース組むから、一つずつ共有」）
// 実行: npm run -s intake -- <共有コードを書いたファイル> [保存するid]
//   周回・高さ・重なり・床下・レーンずれを表示する。id を付けると src/data/layouts/<id>.json に書き出す（同じ名前があれば上書きせず止まる）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { decodeCourse } from '../src/editor/share';
import { parseLayout, build } from '../src/editor/geom';

const [file, id] = process.argv.slice(2);
if (!file) { console.log('使い方: npm run -s intake -- <コードのファイル> [id]'); process.exit(1); }
const parsed = parseLayout(await decodeCourse(readFileSync(file, "utf8")));
if (!parsed) { console.log("コースとして読めませんでした"); process.exit(1); }
const lay = parsed.layout;
if (parsed.legacy || parsed.legacyBank) console.log(`古い形式の部品を読み替えました（${parsed.legacy + parsed.legacyBank}個）`);
const { placed, check: c } = build(lay);
let lo = Infinity, hi = -Infinity;
for (const p of placed) for (const s of p.samples) { lo = Math.min(lo, s.p[1]); hi = Math.max(hi, s.p[1]); }
console.log(`名前: ${lay.name}  ${lay.lanes}レーン  部品${lay.pieces.length}個`);
console.log(`周回: ${c.closed ? 'OK' : 'つながらない'}  1周 ${(c.totalLengthMm / 1000).toFixed(2)}m  すき間 ${c.gapMm.toFixed(1)}mm  向き ${c.headingDeg.toFixed(2)}°  高さのずれ ${c.heightMm.toFixed(1)}mm  傾き ${c.tiltDeg.toFixed(2)}°`);
console.log(`高さ: ${lo.toFixed(0)}〜${hi.toFixed(0)}mm  レーンずれ ${c.laneShift}（${c.lapsToReturn}周で戻る）`);
console.log(`重なり: ${c.overlaps.length ? c.overlaps.map(([a, b]) => `${a}と${b}`).join(', ') : 'なし'}  床下: ${c.underground.length ? c.underground.join(', ') : 'なし'}`);
for (const m of c.messages) if (m.level !== 'ok') console.log(`  ${m.level === 'error' ? '×' : '△'} ${m.text}`);
if (id) {
  const out = `src/data/layouts/${id}.json`;
  if (existsSync(out)) { console.log(`${out} はもうあるので書き出していません`); process.exit(1); }
  writeFileSync(out, JSON.stringify(lay, null, 1) + '\n');
  console.log(`書き出し: ${out}`);
}
