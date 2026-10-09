// ジャンプの確認: 速度ごとの飛距離と、着地ゾーン内に収まるか
// 実行: npm run jumpsim
import course from '../src/data/course1.json';
import tuning from '../src/data/tuning.json';

const { gravity, rampAngle } = tuning.air;
for (const j of course.jumps ?? []) {
  console.log(`ジャンプ ${j.at}m地点 / 着地ゾーン ${j.land}m`);
  for (const v of [tuning.car.maxSpeed * 0.8, tuning.car.maxSpeed, tuning.car.maxSpeed * tuning.boost.speedMul]) {
    const vy = v * Math.tan((rampAngle * Math.PI) / 180);
    const t = (vy + Math.sqrt(vy * vy + 2 * gravity * 0.8)) / gravity;
    const d = v * t;
    console.log(`  ${Math.round(v * 3.6)}km/h → 飛距離 ${d.toFixed(1)}m ${d > j.land ? 'コースアウト' : 'セーフ'}`);
  }
}
