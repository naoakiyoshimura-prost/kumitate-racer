// EX技の確認: ドライバーごとに、使えるタイミングで毎回EXを使ったときのタイムと発動回数
// 実行: npm run exsim
import { Track } from '../src/track';
import { CarState, type Tuning } from '../src/car';
import { CpuDriver } from '../src/cpu';
import { applyBuild, defaultBuild, options } from '../src/setup';
import { COURSES } from '../src/courses';
import tuning from '../src/data/tuning.json';

let seed = 3;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const course of COURSES) {
  const track = new Track(course);
  const laps = course.laps ?? tuning.race.laps;
  console.log(`\n${course.name}（${laps}周）`);
  for (const body of options('driver')) {
    for (const useEx of [false, true]) {
      const t = applyBuild(tuning as Tuning, { ...defaultBuild(), driver: body.id });
      let total = 0;
      let used = 0;
      let outs = 0;
      const runs = 4;
      for (let r = 0; r < runs; r++) {
        const car = new CarState(track, t, 2, rand);
        const cpu = new CpuDriver(car, track, { ...tuning.cpu, mistakeRate: 0 }, t.boost.boostCost, t.corner.threshold, rand);
        let time = 0;
        while (car.lap <= laps && time < 300) {
          // ハングオンはコーナーで、クイックターンはS字の手前で、それ以外は使えるときにすぐ使う
          const hangWait = (car.exSkill === 'hangOn' && !car.inCorner) || (car.exSkill === 'quickTurn' && !car.sBendAhead());
          // エアードリフトはイン側の端のレーンからだけ。使えるようになったらコーナー手前で端へ寄せる
          if (useEx && car.exSkill === 'airDrift' && !car.exActive && car.time >= car.airDriftAt && car.gauge >= tuning.ex.cost + 2 * tuning.boost.laneChangeCost) {
            const side = car.cornerAhead();
            // シミュはイン側の端（ショートカット）を使う。AIR=outer で外側の端から
            const inner = (side > 0) !== (process.env.AIR === 'outer') ? car.laneCount - 1 : 0;
            if (side !== 0 && car.targetLane !== inner) {
              // CPUの走行ラインもイン側の端に合わせる（戻されないように）
              (cpu as unknown as { plannedLane: number }).plannedLane = inner;
              car.command(inner > car.targetLane ? 'right' : 'left', time);
            }
          }
          if (useEx && !hangWait && car.canEx() && car.command('ex', time)) used++;
          // ハイパーチャージ中はブーストを連発する
          if (useEx && (car.exActive === 'hyperCharge' || car.exActive === 'capacitor')) car.command('boost', time);
          if (useEx && car.doubleReady) car.command('ex', time);
          // リボルバーは直線で1発ずつ撃つ
          if (useEx && car.exActive === 'revolver' && !car.inCorner) car.command('boost', time);
          if (useEx && car.exActive === 'drift' && car.cornerInside && car.vLat * car.cornerInside < -1.5) car.command(car.cornerInside < 0 ? 'left' : 'right', time);
          cpu.update(1 / 60, time);
          car.update(1 / 60);
          time += 1 / 60;
        }
        total += time;
        outs += car.courseOuts;
      }
      console.log(`  ${body.name} ${useEx ? 'EXあり' : 'EXなし'}: ${(total / runs).toFixed(2)}s  EX ${(used / runs).toFixed(1)}回  コースアウト${(outs / runs).toFixed(1)}`);
    }
  }
}
