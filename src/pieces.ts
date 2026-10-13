import type { CourseData, JumpData } from './track';

// コースを「ピース」（直線・コーナー・坂・ジャンプ台）を並べて書く。実際の組み立てコースの図面を打ち込める形
// 点列（points）に変換してから Track に渡すので、走行計算は今までと同じ。points が書いてあるコースはそのまま使う
// 作り方は tools/gencourse.py と同じ（4m 刻み、コーナーは円弧を弦でたどる）
export type Piece =
  | { type: 'straight'; length: number; rise?: number } // rise: この区間で上がる高さ（m、下りはマイナス）
  | { type: 'corner'; dir: 'L' | 'R'; angle: number; radius: number; rise?: number } // angle: 度。実機は45度単位
  | { type: 'jump'; angle?: number }; // ジャンプ台（長さなし。ここで飛ぶ）

export interface PieceCourse {
  points: [number, number, number][];
  jumps: JumpData[];
  length: number; // ピースの長さの合計（m）
  gap: number; // 最後の点とスタートのずれ（m）。0に近いほど閉じている
  heading: number; // 最後の向き（度）。360の倍数なら一周している
}

export function buildPieces(pieces: Piece[], step = 4): PieceCourse {
  let x = 0;
  let z = 0;
  let y = 0;
  let h = 0; // 進行方向（ラジアン、0=+x）
  let dist = 0;
  const pts: [number, number, number][] = [[0, 0, 0]];
  const jumps: JumpData[] = [];
  const push = () => pts.push([round(x), round(z), round(y)]);
  for (const p of pieces) {
    if (p.type === 'jump') {
      jumps.push(p.angle ? { at: Math.round(dist), angle: p.angle } : { at: Math.round(dist) });
    } else if (p.type === 'straight') {
      const n = Math.max(1, Math.round(p.length / step));
      for (let i = 0; i < n; i++) {
        x += (Math.cos(h) * p.length) / n;
        z += (Math.sin(h) * p.length) / n;
        y += (p.rise ?? 0) / n;
        push();
      }
      dist += p.length;
    } else {
      const sign = p.dir === 'L' ? 1 : -1;
      const ang = (p.angle * Math.PI) / 180;
      const n = Math.max(2, Math.round((p.radius * ang) / step));
      const da = ang / n;
      for (let i = 0; i < n; i++) {
        // 円弧を弦でたどる
        const chord = 2 * p.radius * Math.sin(da / 2);
        x += Math.cos(h + (sign * da) / 2) * chord;
        z += Math.sin(h + (sign * da) / 2) * chord;
        y += (p.rise ?? 0) / n;
        h += sign * da;
        push();
      }
      dist += p.radius * ang;
    }
  }
  const last = pts[pts.length - 1];
  const gap = Math.hypot(last[0], last[1]);
  // 一周してスタートに戻った点は、始点と重なるので外す（コースは閉じた曲線として扱う）
  if (pts.length > 2 && gap < step / 2) pts.pop();
  return { points: pts, jumps, length: dist, gap, heading: (h * 180) / Math.PI };
}

const round = (v: number) => Math.round(v * 10) / 10;

// pieces で書かれたコースに points と jumps を入れる（points があるコースはそのまま）
export function withPieces(c: CourseData): CourseData {
  if (c.points?.length || !c.pieces) return c;
  const built = buildPieces(c.pieces);
  return { ...c, points: built.points, jumps: [...(c.jumps ?? []), ...built.jumps] };
}

// 壁あり（仕切りレーン）で走れるかの目安。今の立体交差3レーン（半径10.2m・1レーン3.6m）が基準
export const WALLED_MIN_RADIUS = 10;
export const WALLED_LANE_WIDTH = 3.6;
