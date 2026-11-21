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
import lowtech from './data/courses/lowtech.json';
import grand from './data/courses/grand.json';
import stechal2026 from './data/layouts/stechal2026.json';
import r3oval from './data/layouts/r3oval.json';
import r3oval2 from './data/layouts/r3oval2.json';
import r3oval3 from './data/layouts/r3oval3.json';
import { toCourse } from './editor/export';
import type { Layout } from './editor/types';

// コースを増やすときは data/courses/ にJSONを置いて、ここに1行足す
export const COURSES = ([standard, technical, highspeed, hairpin, oval, circuit, triple, free, drift, updown3, grand, lowtech] as CourseData[]).map(withPieces);
// コースエディタの並びで登録したコース（2026-11-19 店長「店長コースを2026ステチャレって名前で新規登録」）。読み込み時にエディタの書き出しで組み立てる
export const LAYOUT_COURSES: Record<string, Layout> = { stechal2026: stechal2026 as Layout };
for (const [id, lay] of Object.entries(LAYOUT_COURSES)) COURSES.push({ ...toCourse(lay, id), id, editorScale: true, name: lay.name, note: 'コースエディタで作ったコース（3レーン・仕切りあり）' });
// 組み直しコース（2026-11-21 店長「古いコースは全部廃棄、3レーンを全部組み直す」「俺が全部コース組むから一つずつ共有」）。
// 店長がエディタで組んで共有コードで渡したもの（原本のコードは docs/rebuilt-course-codes.md）。npm run intake で確かめて data/layouts/ に置き、ここに1行足す。テストプレイのコース選択の先頭に並ぶ
// 古いコースは「来るたびに差し替え」（店長決定）: 1本届くごとに古い1本を選択から外す（データは消さない）
export const REBUILT_COURSES: Record<string, Layout> = { r3oval: r3oval as Layout, r3oval2: r3oval2 as Layout, r3oval3: r3oval3 as Layout };
export const isRebuilt = (id: string | null | undefined): boolean => !!id && Object.prototype.hasOwnProperty.call(REBUILT_COURSES, id);
// コースエディタで作ったコース（id は 'custom'）。保存が壊れていたら無視する
let custom: CourseData | null = null;
export function setCustomCourse(json: string | null) {
  custom = null;
  if (!json) return;
  try {
    const c = JSON.parse(json) as CourseData;
    if (c && Array.isArray(c.points) && c.points.length >= 4) custom = { ...c, id: 'custom' };
  } catch { /* 読めないものは使わない */ }
}
export const courseById = (id: string) => (id === 'custom' && custom) || COURSES.find((c) => c.id === id) || COURSES[0];

// 大会ごとのコース形式: open=ふつう（コースのまま）、walled=壁で仕切った3レーン（立体交差でレーンが入れ替わる）、laneless=レーンなし
export type CourseMode = 'open' | 'walled' | 'laneless';
const WALLED_WIDTH = 10.8; // 1レーン3.6m×3（立体交差3レーンと同じ）

export function courseFor(id: string, mode: CourseMode = 'open'): CourseData {
  const c = courseById(id);
  if (id === 'custom') return c; // 自作コースはエディタが決めた形式のまま
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
