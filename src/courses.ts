import type { CourseData } from './track';
import standard from './data/courses/standard.json';
import technical from './data/courses/technical.json';
import highspeed from './data/courses/highspeed.json';

// コースを増やすときは data/courses/ にJSONを置いて、ここに1行足す
export const COURSES = [standard, technical, highspeed] as CourseData[];
export const courseById = (id: string) => COURSES.find((c) => c.id === id) ?? COURSES[0];
