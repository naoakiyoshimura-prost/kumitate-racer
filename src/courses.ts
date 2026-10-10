import type { CourseData } from './track';
import standard from './data/courses/standard.json';
import technical from './data/courses/technical.json';
import highspeed from './data/courses/highspeed.json';
import hairpin from './data/courses/hairpin.json';
import oval from './data/courses/oval.json';

// コースを増やすときは data/courses/ にJSONを置いて、ここに1行足す
export const COURSES = [standard, technical, highspeed, hairpin, oval] as CourseData[];
export const courseById = (id: string) => COURSES.find((c) => c.id === id) ?? COURSES[0];
