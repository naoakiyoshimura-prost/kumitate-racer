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
