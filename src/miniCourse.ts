// 俯瞰モード用にコースを実物の比率へ寄せる（three に依存しない純粋な変換）。
// いまの仕切りレーンは 1レーン3.6m で、車（全長3.38m=実寸165mm相当）に対して実物の約1.5倍広い。
// 実物は 1レーン115mm → 車体の縮尺で約2.36m。幅をこれに合わせ、コース全体も scale 倍に縮めて
// 「コースに対する速さ」を実物に近づける。自作コース（エディタ）は最初から車体の縮尺なので触らない
import type { CourseData } from './track';

export interface MiniFit {
  laneWidth: number; // 1レーンの幅（m）
  courseScale: number; // コースの形（平面と高さ）を縮める倍率
  wallHeight: number; // 壁の高さ（m）。0以下なら元のまま
  forceLanes?: number; // 仕切りの無いコースも、この数の仕切りレーンにする（立体交差が無いのでレーンは入れ替わらない）。0で何もしない
}

// 俯瞰モードは坂の頂上で自然に浮く（CourseData.crestTakeoff。数値は tuning air.crest の仮設定）。形の変換は fitShape
export function fitMini(c: CourseData, f: MiniFit): CourseData {
  return { ...fitShape(c, f), crestTakeoff: true };
}

function fitShape(c: CourseData, f: MiniFit): CourseData {
  if (c.id === 'custom' || c.laneless) return c;
  if (!c.walledLanes) {
    if (!f.forceLanes) return c;
    c = { ...c, walledLanes: f.forceLanes, lanes: f.forceLanes };
  }
  const lanes = c.walledLanes!;
  const s = f.courseScale;
  const cross = c.crossover && { ...c.crossover, at: c.crossover.at * s, length: c.crossover.length * s };
  return {
    ...c,
    width: f.laneWidth * lanes,
    wallHeight: f.wallHeight > 0 ? f.wallHeight : c.wallHeight,
    points: c.points.map((p) => [p[0] * s, p[1] * s, (p[2] ?? 0) * s] as [number, number, number]),
    crossover: cross,
    jumps: c.jumps?.map((j) => ({ ...j, at: j.at * s })),
    slow: c.slow?.map((z) => ({ at: z.at * s, length: z.length * s })),
  };
}
