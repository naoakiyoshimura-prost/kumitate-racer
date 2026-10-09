// 数値調整用: ライン取りの作戦ごとに、平均ラップとコースアウト回数を計算する
// 実行: npm run sim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

const track = new Track(COURSES[0]);
const n = tuning.lanes.count;

// 次のコーナーの外側から数えて何本目のレーンを狙うか（0=一番外）
function strategy(fromOutside: number) {
  return (car: CarState) => {
    for (let ahead = 0; ahead <= 30; ahead += 2) {
      const c = track.curvatureAt(car.distance + ahead);
      if (c.k > tuning.corner.threshold) {
        // inside=+1 なら右が内側 → 外側は左(0)
        return c.inside > 0 ? fromOutside : n - 1 - fromOutside;
      }
    }
    return car.targetLane;
  };
}

for (let k = 0; k < n; k++) {
  const car = new CarState(track, tuning as Tuning, 0);
  const pick = strategy(k);
  const dt = 1 / 60;
  let t = 0;
  let lap2 = 0;
  while (car.lap < 5 && t < 600) {
    if (!car.isOut) car.targetLane = pick(car);
    const prev = car.lap;
    car.update(dt);
    t += dt;
    if (prev === 1 && car.lap === 2) lap2 = t;
  }
  console.log(`外から${k}本目を狙う: 平均ラップ ${((t - lap2) / 3).toFixed(2)}s  コースアウト ${car.courseOuts}回`);
}
