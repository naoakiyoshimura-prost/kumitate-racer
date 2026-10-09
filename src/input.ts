import type { CarCommand } from './car';

// タッチ（左右タップ・スワイプ）とキーボードを、同じ「操作命令」に変換する
export class Input {
  private queue: CarCommand[] = [];
  private startX = 0;

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      this.startX = e.clientX;
    });
    target.addEventListener('pointerup', (e) => {
      const dx = e.clientX - this.startX;
      if (Math.abs(dx) > 30) this.queue.push(dx > 0 ? 'right' : 'left');
      else this.queue.push(e.clientX > window.innerWidth / 2 ? 'right' : 'left');
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.queue.push('left');
      if (e.key === 'ArrowRight' || e.key === 'd') this.queue.push('right');
    });
  }

  drain(): CarCommand[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
