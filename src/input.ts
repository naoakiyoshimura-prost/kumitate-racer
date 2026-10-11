import type { CarCommand } from './car';

// 画面のボタンとキーボードを、同じ「操作命令」に変換する
export class Input {
  private queue: CarCommand[] = [];
  // ブーストボタンを押し続けているか（スタートは押したまま待って、離して発進）
  boostHeld = false;
  private boostPointer = -1;

  constructor(buttons: Partial<Record<CarCommand, HTMLElement>>) {
    // 画面のボタン: 押した瞬間に命令を出す（左右もボタン式）
    for (const [cmd, el] of Object.entries(buttons)) {
      el!.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.queue.push(cmd as CarCommand);
        if (cmd === 'boost') {
          this.boostHeld = true;
          this.boostPointer = e.pointerId;
        }
      });
    }
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.boostPointer) return;
      this.boostHeld = false;
      this.boostPointer = -1;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    const isBoostKey = (k: string) => k === ' ' || k === 'ArrowUp' || k === 'w';
    window.addEventListener('keyup', (e) => {
      if (isBoostKey(e.key)) this.boostHeld = false;
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.queue.push('left');
      if (e.key === 'ArrowRight' || e.key === 'd') this.queue.push('right');
      if (isBoostKey(e.key)) {
        this.queue.push('boost');
        this.boostHeld = true;
      }
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
