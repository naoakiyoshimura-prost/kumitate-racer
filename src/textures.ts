import * as THREE from 'three';

// レトロなレースゲーム風の模様を、画像ファイルなしでその場で描く（読み込み待ちゼロ・著作権の心配なし）
// シミュレーション（node）では画面がないので模様なし
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter; // ドット絵っぽいくっきり感
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 路面: 横＝コース幅、縦＝進行方向。タイルの継ぎ目と、両端の紅白の縁石
export function roadTexture() {
  return canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = '#4b505a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#434852';
    ctx.fillRect(16, 0, 48, 32);
    ctx.fillRect(64, 32, 48, 32);
    ctx.fillStyle = '#5b616c';
    ctx.fillRect(0, 0, 128, 2);
    ctx.fillRect(0, 32, 128, 1);
    // 縁石
    for (const x of [0, 116]) {
      ctx.fillStyle = '#e8402a';
      ctx.fillRect(x, 0, 12, 32);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(x, 32, 12, 32);
    }
  });
}

// 壁: 横＝進行方向、縦＝高さ。光るガードの帯と斜めのストライプで流れを見せる
export function wallTexture() {
  return canvasTexture(64, 32, (ctx) => {
    ctx.fillStyle = '#1d4fb8';
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = '#f5d33a';
    for (let x = -32; x < 64; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x + 8, 32);
      ctx.lineTo(x + 24, 12);
      ctx.lineTo(x + 16, 12);
      ctx.fill();
    }
    ctx.fillStyle = '#9fe6ff';
    ctx.fillRect(0, 4, 64, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 2);
    ctx.fillStyle = '#0d2c70';
    ctx.fillRect(0, 10, 64, 2);
    ctx.fillRect(31, 12, 2, 20);
  });
}

// 芝生: 刈り込みの縞（明暗2色）と、ところどころの濃い点
export function grassTexture() {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#4f7a4f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#5a875a';
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = '#466e46';
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 37) % 64, (i * 23) % 64, 2, 2);
  });
}

// ゴールライン・ゲートの市松模様
export function checkerTexture() {
  return canvasTexture(16, 4, (ctx) => {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x, y, 1, 1);
      }
  });
}

// 観客席: 色とりどりの点で人を表す
export function crowdTexture() {
  return canvasTexture(64, 16, (ctx) => {
    ctx.fillStyle = '#3a3f4a';
    ctx.fillRect(0, 0, 64, 16);
    const cols = ['#e8402a', '#f5d33a', '#2a7de8', '#f2f2f2', '#3ac46a', '#f08a2a'];
    for (let y = 1; y < 16; y += 4)
      for (let x = (y % 8) / 2; x < 64; x += 3) {
        ctx.fillStyle = cols[(x * 7 + y * 3) % cols.length];
        ctx.fillRect(x, y, 2, 2);
      }
  });
}

// ガレージの壁: 縦のパネル、腰の高さのオレンジ帯、足元の黄黒ハザード
export function garageWallTexture() {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#262b35';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#2e3440';
    ctx.fillRect(2, 0, 28, 44);
    ctx.fillRect(34, 0, 28, 44);
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(31, 0, 2, 44);
    ctx.fillStyle = '#b8620a';
    ctx.fillRect(0, 45, 64, 2);
    for (let x = -8; x < 64; x += 8) {
      ctx.fillStyle = '#6e5a1a';
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x + 4, 64);
      ctx.lineTo(x + 12, 54);
      ctx.lineTo(x + 8, 54);
      ctx.fill();
    }
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 52, 64, 2);
  });
}

// 空: 上は濃い青、地平線は霧と同じ色。低い位置に横長の雲
export function skyTexture(horizon: string) {
  const tex = canvasTexture(512, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#3f7fd0');
    g.addColorStop(0.88, horizon);
    g.addColorStop(1, horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 480;
      const y = 82 + rnd() * 22;
      const w = 10 + rnd() * 16;
      for (let k = 0; k < 4; k++) ctx.fillRect(x + k * w * 0.18, y - (k % 2) * 2, w * 0.6, 2 + (k % 2) * 2);
    }
  });
  if (tex) {
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
  }
  return tex;
}
