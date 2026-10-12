import type { CarCommand } from './car';

// 画面のボタンとキーボードを、同じ「操作命令」に変換する
export class Input {
  private queue: CarCommand[] = [];
  // ブーストボタンを押し続けているか（スタートは押したまま待って、離して発進）
  boostHeld = false;
  private boostPointer = -1;
  // 左右ボタンを押し続けているか（レーンなしコースでは押している間、横へ動き続ける）
  held: { left: boolean; right: boolean } = { left: false, right: false };
  private steerPointers = new Map<number, 'left' | 'right'>();

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
        if (cmd === 'left' || cmd === 'right') {
          this.held[cmd] = true;
          this.steerPointers.set(e.pointerId, cmd);
        }
      });
    }
    const release = (e: PointerEvent) => {
      const steer = this.steerPointers.get(e.pointerId);
      if (steer) {
        this.steerPointers.delete(e.pointerId);
        this.held[steer] = [...this.steerPointers.values()].includes(steer);
      }
      if (e.pointerId !== this.boostPointer) return;
      this.boostHeld = false;
      this.boostPointer = -1;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    const isBoostKey = (k: string) => k === ' ' || k === 'ArrowUp' || k === 'w';
    window.addEventListener('keyup', (e) => {
      if (isBoostKey(e.key)) this.boostHeld = false;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.held.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') this.held.right = false;
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') {
        this.queue.push('left');
        this.held.left = true;
      }
      if (e.key === 'ArrowRight' || e.key === 'd') {
        this.queue.push('right');
        this.held.right = true;
      }
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
