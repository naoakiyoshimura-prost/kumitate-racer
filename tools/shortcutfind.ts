// ショートカット候補を探す: 経路では遠いのに、直線では近い2点（飛び越えると大きく得をする場所）
// 実行: npx esbuild tools/shortcutfind.ts --bundle --platform=node --format=esm --outfile=dist/sf.mjs && node dist/sf.mjs <courseId>
import { Track } from '../src/track';
import { courseById } from '../src/courses';

const track = new Track(courseById(process.argv[2] ?? 'circuit'));
const out: { at: number; to: number; gap: number; saved: number }[] = [];
for (let s = 0; s < track.length; s += 2) {
  for (let d = 60; d < 260; d += 2) {
    const a = track.frameAt(s).position;
    const b = track.frameAt(s + d).position;
    const gap = Math.hypot(a.x - b.x, a.z - b.z);
    if (gap < 40 || gap > 110) continue;
    out.push({ at: s, to: (s + d) % track.length, gap, saved: d - gap });
  }
}
out.sort((x, y) => y.saved - x.saved);
const picked: typeof out = [];
for (const o of out) if (picked.every((p) => Math.abs(p.at - o.at) > 40)) picked.push(o);
console.log(`長さ ${track.length.toFixed(0)}m`);
for (const p of picked.slice(0, 6)) console.log(`at ${p.at} → ${p.to}  直線 ${p.gap.toFixed(0)}m  得 ${p.saved.toFixed(0)}m`);
