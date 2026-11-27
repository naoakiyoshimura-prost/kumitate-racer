// コース図の印刷用シート（2026-11-27 店長「コースレイアウト組んだ奴を A4 横書きで印刷したい。全体図と必要なパーツ数一覧で」「PDF か PNG でダウンロード」）。
// A4 横（297×210mm）を 200dpi 相当の 1枚の画像に描き、PNG はそのまま、PDF はその画像を1ページに貼った最小の PDF を自前で組む（外部ライブラリなし）。
import type { Built, Layout, PieceType, Placed } from './types';
import { pieceLabel } from './geom';
import { View2D, placedColor } from './view2d';

const DPI = 200;
const PAGE_W = Math.round((297 / 25.4) * DPI); // 2339
const PAGE_H = Math.round((210 / 25.4) * DPI); // 1654
const MM = DPI / 25.4;
const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';

// パーツ一覧の並び（部品の種類の順 → 名前）
const TYPE_ORDER: PieceType[] = ['start', 'straight', 'corner', 'wave', 'laneChange', 'slopeUp', 'slopeDown', 'bankApproach', 'loop', 'laneLoop', 'bankChange', 'cornerChange', 'shiftChange', 'bump', 'hump', 'forkRoad', 'hopChange', 'twistChange', 'gapJump', 'washboard', 'universal'];

export interface PartRow { name: string; count: number; color: string }
export function partCounts(built: Built, layout: Layout): PartRow[] {
  const m = new Map<string, { row: PartRow; order: number }>();
  for (const p of built.placed) {
    const name = pieceLabel(p.spec, layout.lanes, layout.dims);
    const cur = m.get(name);
    if (cur) cur.row.count++;
    else m.set(name, { row: { name, count: 1, color: placedColor(p) }, order: TYPE_ORDER.indexOf(p.spec.type) });
  }
  return [...m.values()].sort((a, b) => a.order - b.order || a.row.name.localeCompare(b.row.name, 'ja')).map((x) => x.row);
}

export function drawSheet(view: View2D, layout: Layout, built: Built): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = PAGE_W; cv.height = PAGE_H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, PAGE_W, PAGE_H);
  const mg = 9 * MM;
  const ck = built.check;
  // 見出し
  c.fillStyle = '#111'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.font = `bold ${7.5 * MM}px ${FONT}`;
  c.fillText(layout.name || 'コース', mg, mg + 7 * MM, PAGE_W * 0.62);
  c.font = `${3.8 * MM}px ${FONT}`;
  const status = ck.closed ? `周回OK　1周 ${(ck.totalLengthMm / 1000).toFixed(2)} m` : `周回がつながっていません（すき間 ${Math.round(ck.gapMm)} mm）`;
  const shift = ck.closed && ck.laneShift ? `　レーンずれ${ck.laneShift}（${ck.lapsToReturn}周で戻る）` : '';
  c.fillText(`${layout.lanes}レーン　部品 ${built.placed.length}個　${status}${shift}`, mg, mg + 13 * MM);
  const d = new Date();
  c.textAlign = 'right'; c.fillStyle = '#555';
  c.fillText(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`, PAGE_W - mg, mg + 7 * MM);
  c.strokeStyle = '#111'; c.lineWidth = 0.5 * MM;
  c.beginPath(); c.moveTo(mg, mg + 16.5 * MM); c.lineTo(PAGE_W - mg, mg + 16.5 * MM); c.stroke();

  // 全体図（左 約7割）
  const top = mg + 20 * MM, bottom = PAGE_H - mg - 8 * MM;
  const tableW = 78 * MM;
  const planW = PAGE_W - 2 * mg - tableW - 6 * MM, planH = bottom - top;
  const plan = document.createElement('canvas');
  plan.width = Math.round(planW); plan.height = Math.round(planH);
  const k = 2.4; // 画面の何倍の細かさで描くか（番号の文字がおよそ 3mm）
  const mPx = view.renderTo(plan, k);
  c.drawImage(plan, mg, top);
  c.strokeStyle = '#999'; c.lineWidth = 0.25 * MM; c.strokeRect(mg, top, planW, planH);
  // 縮尺の帯（1m。図が小さいときは 2m・5m）
  if (mPx > 0) {
    let len = 1; while (mPx * len < 18 * MM && len < 100) len = len === 1 ? 2 : len === 2 ? 5 : len * 2;
    const bx = mg + 5 * MM, by = bottom - 5 * MM, bw = mPx * len;
    c.fillStyle = '#111'; c.fillRect(bx, by - 1.2 * MM, bw / 2, 1.2 * MM);
    c.strokeStyle = '#111'; c.lineWidth = 0.3 * MM; c.strokeRect(bx, by - 1.2 * MM, bw, 1.2 * MM);
    c.font = `${3 * MM}px ${FONT}`; c.textAlign = 'left'; c.fillText(`${len} m`, bx + bw + 2 * MM, by);
  }

  // パーツ数の一覧（右）
  const rows = partCounts(built, layout);
  const tx = PAGE_W - mg - tableW;
  c.textAlign = 'left'; c.fillStyle = '#111'; c.font = `bold ${4.6 * MM}px ${FONT}`;
  c.fillText('必要なパーツ数', tx, top + 5 * MM);
  const listTop = top + 9 * MM, listBottom = bottom - 12 * MM;
  const cols = rows.length * 7 * MM > listBottom - listTop ? 2 : 1;
  const perCol = Math.ceil(rows.length / cols);
  const rh = Math.min(7 * MM, (listBottom - listTop) / Math.max(1, perCol));
  const colW = tableW / cols;
  const fs = Math.min(4 * MM, rh * 0.62) * (cols === 2 ? 0.85 : 1);
  rows.forEach((r, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = tx + col * colW, y = listTop + row * rh;
    if (row % 2 === 0) { c.fillStyle = '#f1f3f6'; c.fillRect(x, y, colW - 1.5 * MM, rh); }
    const sw = Math.min(4 * MM, rh * 0.6);
    c.fillStyle = r.color; c.fillRect(x + 1.2 * MM, y + (rh - sw) / 2, sw, sw);
    c.strokeStyle = '#333'; c.lineWidth = 0.2 * MM; c.strokeRect(x + 1.2 * MM, y + (rh - sw) / 2, sw, sw);
    c.fillStyle = '#111'; c.textBaseline = 'middle'; c.textAlign = 'left';
    const avail = colW - sw - 14 * MM;
    let f = fs; c.font = `${f}px ${FONT}`;
    while (f > fs * 0.6 && c.measureText(r.name).width > avail) { f *= 0.94; c.font = `${f}px ${FONT}`; } // 長い名前は横に潰さず文字を小さく
    c.fillText(r.name, x + 2.6 * MM + sw, y + rh / 2, avail);
    c.textAlign = 'right'; c.font = `bold ${fs}px ${FONT}`;
    c.fillText(`${r.count}`, x + colW - 3.5 * MM, y + rh / 2);
  });
  c.textBaseline = 'alphabetic';
  c.strokeStyle = '#111'; c.lineWidth = 0.4 * MM;
  c.beginPath(); c.moveTo(tx, listBottom + 3 * MM); c.lineTo(tx + tableW - 1.5 * MM, listBottom + 3 * MM); c.stroke();
  c.font = `bold ${4.4 * MM}px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#111';
  c.fillText('合計', tx + 1.2 * MM, listBottom + 9 * MM);
  c.textAlign = 'right'; c.fillText(`${built.placed.length}個`, tx + tableW - 3.5 * MM, listBottom + 9 * MM);

  // 下の注記
  c.font = `${2.7 * MM}px ${FONT}`; c.fillStyle = '#555'; c.textAlign = 'left';
  const notes = ['図の数字: 上=部品の順番、下の「+」=床からの高さ(mm)。S=スタート、矢印=走る向き'];
  if (rows.some((r) => r.name === 'ユニバーサル')) notes.push('ユニバーサルは長さと形が自動');
  c.fillText(notes.join('　／　'), mg, PAGE_H - mg + 1 * MM, PAGE_W - 2 * mg);
  return cv;
}

// ファイル名は英数字だけ（日本語の名前は端末・ブラウザによって「download」などに化けるため。コース名は紙面の見出しに入る）
const fileBase = (_layout: Layout) => { const d = new Date(), z = (n: number) => String(n).padStart(2, '0'); return `kumitate_course_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`; };

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const toBlob = (cv: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, q));

export async function savePng(cv: HTMLCanvasElement, layout: Layout) {
  save(await toBlob(cv, 'image/png'), `${fileBase(layout)}_A4.png`);
}

// JPEG を1枚、A4 横（842×595pt）いっぱいに貼った1ページの PDF
export async function pdfBlob(cv: HTMLCanvasElement): Promise<Blob> {
  const jpg = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.92)).arrayBuffer());
  const W = 841.89, H = 595.28;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (x: string | Uint8Array) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n: number, body: string | (() => void)) => { offsets[n] = len; push(`${n} 0 obj\n`); if (typeof body === 'string') push(body); else body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => { push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream'); });
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
export async function savePdf(cv: HTMLCanvasElement, layout: Layout) {
  save(await pdfBlob(cv), `${fileBase(layout)}_A4.pdf`);
}
