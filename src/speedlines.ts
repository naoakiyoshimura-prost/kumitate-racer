// 集中線: 画面の外側から中心へ流れる白い線。速度が上がるほど本数と濃さが増える
export class SpeedLines {
  private readonly ctx: CanvasRenderingContext2D;
  private drawn = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(ratio: number, stage: number, enabled: boolean) {
    const { canvas, ctx } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const k = Math.min(1, Math.max(0, (ratio - 0.7) / 0.6)) + stage * 0.4;
    // 何も描かないフレームは消去もしない（スマホの負荷を減らす）
    if (this.drawn) ctx.clearRect(0, 0, w, h);
    this.drawn = enabled && k > 0;
    if (!this.drawn) return;
    const cx = w / 2;
    const cy = h * 0.45;
    const r = Math.hypot(w, h) / 2;
    ctx.strokeStyle = stage === 2 ? 'rgba(170,225,255,0.55)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = Math.round(10 + k * 30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const from = r * (0.6 + Math.random() * 0.15);
      const to = from + r * (0.15 + 0.25 * Math.random()) * Math.min(1.5, k);
      ctx.moveTo(cx + Math.cos(a) * from, cy + Math.sin(a) * from);
      ctx.lineTo(cx + Math.cos(a) * to, cy + Math.sin(a) * to);
    }
    ctx.stroke();
  }
}
