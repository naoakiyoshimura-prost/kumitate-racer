// レースゲーム: 橋脚がほかの区間の路面・外壁に刺さっていないかの確認（src/rgWorld.ts と同じ置き方。bad 0 が合格）
import './browserstub';
import { Track } from '../src/track';
import { toCourse } from '../src/editor/export';
import { CIRCUIT_BIG_LAYOUT } from '../src/circuit';
import { rgCourse } from '../src/raceGame';
const track = new Track({ ...rgCourse(toCourse(CIRCUIT_BIG_LAYOUT, 'custom').width), crestTakeoff: true });
const L = track.length; const hw = track.halfWidth; console.log("hw", hw);
const road: any[] = []; for (let s = 0; s < L; s += 1) for (const l of [-1.25, -1, -0.5, 0, 0.5, 1, 1.25]) road.push({...track.frameAt(s, l).position, s});
let placed = 0, bad = 0;
const low: any[] = []; for (let s = 0; s < L; s += 3) low.push(track.frameAt(s).position);
for (let s = 0; s < L; s += 36) {
  const f = track.frameAt(s); const h = f.position.y - 1.1; if (h < 1.5) continue;
  if (low.some((q) => q.y < f.position.y - 3 && (q.x - f.position.x) ** 2 + (q.z - f.position.z) ** 2 < (hw * 1.8 + 2.5) ** 2)) continue;
  for (const side of [-0.55, 0.55]) { placed++; const p = track.frameAt(s, side).position;
    const hit = road.find((r) => Math.abs(r.s - s) > 25 && r.y < f.position.y - 2.5 && Math.abs(r.x - p.x) < 1.6 && Math.abs(r.z - p.z) < 1.6);
    if (hit) { bad++; console.log("hit", s, f.position.y.toFixed(1), hit.s, hit.y.toFixed(1)); } }
}
console.log('L', L.toFixed(0), 'placed', placed, 'bad', bad);
