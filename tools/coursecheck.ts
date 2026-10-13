// コースの確認: 長さ、一番きついコーナーの半径、ジャンプの位置、壁あり（仕切り3レーン）で走れるか、ピースのコースが閉じているか
// 実行: npm run coursecheck
import { Track } from '../src/track';
import { COURSES } from '../src/courses';
import { buildPieces, WALLED_LANE_WIDTH, WALLED_MIN_RADIUS } from '../src/pieces';

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
  // 壁あり3レーン: きついコーナーは曲がれない。幅が足りなければ、必要な幅を出す
  const need = WALLED_LANE_WIDTH * 3;
  const walled = c.walledLanes ? '壁あり' : minR < WALLED_MIN_RADIUS ? `×（半径${WALLED_MIN_RADIUS}m未満）` : c.width < need ? `△（幅${c.width}→${need.toFixed(1)}mなら可）` : '○';
  let closed = '';
  if (c.pieces) {
    const b = buildPieces(c.pieces);
    const turn = ((b.heading % 360) + 360) % 360;
    const ok = b.gap < 2 && Math.min(turn, 360 - turn) < 1;
    closed = `  ピース: ${ok ? '閉じている' : `★閉じていない（ずれ${b.gap.toFixed(1)}m・向き${b.heading.toFixed(0)}度）`}`;
  }
  console.log(`${c.name}: 長さ ${t.length.toFixed(0)}m  最小半径 ${minR.toFixed(1)}m（${at}m地点）  ジャンプ ${jumps}  壁あり3レーン ${walled}${closed}`);
}
