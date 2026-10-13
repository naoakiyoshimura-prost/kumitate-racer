import type { CourseData } from './track';
import { withPieces } from './pieces';
import standard from './data/courses/standard.json';
import technical from './data/courses/technical.json';
import highspeed from './data/courses/highspeed.json';
import hairpin from './data/courses/hairpin.json';
import oval from './data/courses/oval.json';
import circuit from './data/courses/circuit.json';
import triple from './data/courses/triple.json';
import free from './data/courses/free.json';
import drift from './data/courses/drift.json';
import updown3 from './data/courses/updown3.json';
import grand from './data/courses/grand.json';

// コースを増やすときは data/courses/ にJSONを置いて、ここに1行足す
export const COURSES = ([standard, technical, highspeed, hairpin, oval, circuit, triple, free, drift, updown3, grand] as CourseData[]).map(withPieces);
export const courseById = (id: string) => COURSES.find((c) => c.id === id) ?? COURSES[0];

// 大会ごとのコース形式: open=ふつう（コースのまま）、walled=壁で仕切った3レーン（立体交差でレーンが入れ替わる）、laneless=レーンなし
export type CourseMode = 'open' | 'walled' | 'laneless';
const WALLED_WIDTH = 10.8; // 1レーン3.6m×3（立体交差3レーンと同じ）

export function courseFor(id: string, mode: CourseMode = 'open'): CourseData {
  const c = courseById(id);
  if (mode === 'walled' && c.walledCrossover) {
    // 3周で全員が3つのレーンを1回ずつ走るので、周回は3周（内側のレーンだけが得をしないように）
    return { ...c, walledLanes: 3, laneless: false, laps: 3, width: Math.max(c.width, WALLED_WIDTH), crossover: c.walledCrossover };
  }
  if (mode === 'laneless' && !c.walledLanes) {
    // 横の刻みはコース幅に合わせる（フリーライン: 幅16で9刻み）。奇数にして真ん中を作る
    const lanes = Math.max(5, Math.round(c.width * 0.55)) | 1;
    return { ...c, laneless: true, lanes };
  }
  return c;
}
