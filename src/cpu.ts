import type { CarState } from './car';
import type { Track } from './track';

export interface CpuTuning {
  cornerLine: number; // 次のコーナーの外側から何本目のレーンを狙うか（0=一番外）
  reaction: number; // 判断の間隔（秒）
  mistakeRate: number; // コーナーごとに一番内側へ突っ込んでしまう確率
  boostReserve: number; // ブースト後に残しておくゲージ
  boostChance: number; // 直線でブーストを使う確率（判断ごと）
}

// CPUはプレイヤーと同じ「操作命令」だけでマシンを動かす
export class CpuDriver {
  private timer = 0;
  private cornerId = -1;
  private plannedLane = -1;

  constructor(
    readonly car: CarState,
    readonly track: Track,
    readonly t: CpuTuning,
    readonly boostCost: number,
    readonly cornerThreshold: number,
    readonly rand: () => number = Math.random,
  ) {}

  update(dt: number, now: number) {
    this.timer -= dt;
    if (this.timer > 0 || this.car.isOut) return;
    this.timer = this.t.reaction;

    const n = this.car.t.lanes.count;
    let corner: { at: number; inside: number } | null = null;
    for (let ahead = 0; ahead <= 40; ahead += 2) {
      const c = this.track.curvatureAt(this.car.distance + ahead);
      if (c.k > this.cornerThreshold) {
        corner = { at: ahead, inside: c.inside };
        break;
      }
    }

    if (corner && corner.at <= 30) {
      // コーナーごとに1回だけ狙うレーンを決める（ここでミスが起きる）
      const id = Math.floor((this.car.distance + corner.at) / 20);
      if (id !== this.cornerId) {
        this.cornerId = id;
        const line = this.rand() < this.t.mistakeRate ? n - 1 : this.t.cornerLine;
        this.plannedLane = corner.inside > 0 ? line : n - 1 - line;
      }
    } else if (!corner && this.car.gauge >= this.boostCost + this.t.boostReserve && this.rand() < this.t.boostChance) {
      this.car.command('boost', now);
    }

    if (this.plannedLane >= 0 && this.plannedLane !== this.car.targetLane) {
      this.car.command(this.plannedLane > this.car.targetLane ? 'right' : 'left', now);
    }
  }
}

// 前の車に詰まったら、後ろの車はそれ以上速く走れない（同じ位置に重ならない）
export function applyTraffic(cars: CarState[], gap: number, width: number) {
  const len = cars[0].track.length;
  for (const a of cars) {
    for (const b of cars) {
      if (a === b || a.isOut || b.isOut) continue;
      let d = b.distance - a.distance;
      if (d < -len / 2) d += len;
      if (d > len / 2) d -= len;
      if (d > 0 && d < gap && Math.abs(a.lat - b.lat) < width) {
        a.speed = Math.min(a.speed, b.speed * 0.98);
      }
    }
  }
}
