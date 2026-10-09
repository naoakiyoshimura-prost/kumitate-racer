// コースの確認: 長さ、一番きついコーナーの半径、ジャンプの位置
// 実行: npm run coursecheck
import { Track } from '../src/track';
import { COURSES } from '../src/courses';

for (const c of COURSES) {
  const t = new Track(c);
  let minR = Infinity;
  let at = 0;
  for (let s = 0; s < t.length; s += 1) {
    const k = t.curvatureAt(s).k;
    if (1 / k < minR) {
      minR = 1 / k;
      at = s;
    }
  }
  const jumps = t.jumps.map((j) => `${j.at}m`).join(', ') || 'なし';
  console.log(`${c.name}: 長さ ${t.length.toFixed(0)}m  最小半径 ${minR.toFixed(1)}m（${at}m地点）  ジャンプ ${jumps}`);
}
