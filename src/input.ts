import type { CarCommand } from './car';

// 画面のボタンとキーボードを、同じ「操作命令」に変換する
export class Input {
  private queue: CarCommand[] = [];

  constructor(buttons: Partial<Record<CarCommand, HTMLElement>>) {
    // 画面のボタン: 押した瞬間に命令を出す（左右もボタン式）
    for (const [cmd, el] of Object.entries(buttons)) {
      el!.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.queue.push(cmd as CarCommand);
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.queue.push('left');
      if (e.key === 'ArrowRight' || e.key === 'd') this.queue.push('right');
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') this.queue.push('boost');
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'e') this.queue.push('transform');
      if (e.key === 'q' || e.key === 'x') this.queue.push('ex');
      if (e.key === 'Shift' || e.key === 'z') this.queue.push('brake');
    });
  }

  drain(): CarCommand[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
