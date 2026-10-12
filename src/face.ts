// ドライバーの顔: 輪郭・目・髪・飾りの部品を組み合わせて SVG で描く（画像ファイルなし）
// 絵柄(style)を人ごとに変えられる: anime=アニメ調 / chibi=デフォルメ / bold=劇画調 / pixel=ドット絵
export type FaceStyle = 'anime' | 'chibi' | 'bold' | 'pixel';
export type HairStyle = 'spiky' | 'short' | 'long' | 'twin' | 'buzz' | 'bob';
export type Accessory = 'none' | 'goggles' | 'headband' | 'cap' | 'star' | 'glasses';
export interface FaceSpec {
  style: FaceStyle;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eye: string;
  acc: Accessory;
  accColor?: string;
  mood?: 'smile' | 'cool' | 'grin';
}

// いまのドライバー6人の顔（id は parts.json の driver）
export const FACES: Record<string, FaceSpec> = {
  kakeru: { style: 'anime', skin: '#f6d2b0', hair: '#c0392b', hairStyle: 'spiky', eye: '#7a3010', acc: 'goggles', accColor: '#f39c12', mood: 'grin' },
  mina: { style: 'chibi', skin: '#ffe0c8', hair: '#ff7eb6', hairStyle: 'twin', eye: '#c2185b', acc: 'star', accColor: '#ffd23a', mood: 'smile' },
  daichi: { style: 'bold', skin: '#d9a77e', hair: '#2b2b2b', hairStyle: 'buzz', eye: '#3a2a1a', acc: 'headband', accColor: '#e74c3c', mood: 'grin' },
  reina: { style: 'anime', skin: '#fbe3d0', hair: '#cfd8e6', hairStyle: 'long', eye: '#3a6fd6', acc: 'none', mood: 'cool' },
  sora: { style: 'pixel', skin: '#f2c9a0', hair: '#2f6fd6', hairStyle: 'short', eye: '#1a2a4a', acc: 'cap', accColor: '#27ae60', mood: 'smile' },
  hayato: { style: 'anime', skin: '#f1cba6', hair: '#1e2a4a', hairStyle: 'short', eye: '#1f6f8b', acc: 'headband', accColor: '#2f8fff', mood: 'cool' },
  tsubasa: { style: 'chibi', skin: '#f8d8bc', hair: '#5a3a8a', hairStyle: 'bob', eye: '#5a2a8a', acc: 'glasses', accColor: '#20c0d0', mood: 'cool' },
};

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

// 髪: 後ろ髪（顔の奥）と前髪（顔の手前）に分けて描く
function hairBack(f: FaceSpec, cy: number, r: number) {
  const c = f.hair;
  switch (f.hairStyle) {
    case 'long':
      return `<path d="M${50 - r - 6} ${cy} Q${50 - r - 8} ${cy + r + 30} ${50 - r + 4} ${cy + r + 34} L${50 + r - 4} ${cy + r + 34} Q${50 + r + 8} ${cy + r + 30} ${50 + r + 6} ${cy} Z" fill="${c}"/>`;
    case 'twin':
      return `<ellipse cx="${50 - r - 6}" cy="${cy + 14}" rx="9" ry="20" fill="${c}"/><ellipse cx="${50 + r + 6}" cy="${cy + 14}" rx="9" ry="20" fill="${c}"/>`;
    case 'bob':
      return `<path d="M${50 - r - 5} ${cy - 4} Q${50 - r - 6} ${cy + r + 6} ${50 - r + 6} ${cy + r + 4} L${50 + r - 6} ${cy + r + 4} Q${50 + r + 6} ${cy + r + 6} ${50 + r + 5} ${cy - 4} Z" fill="${c}"/>`;
    default:
      return '';
  }
}
function hairFront(f: FaceSpec, cy: number, r: number) {
  const c = f.hair;
  const top = cy - r;
  switch (f.hairStyle) {
    case 'spiky': {
      let d = `M${50 - r - 4} ${cy}`;
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const x = 50 - r - 4 + ((2 * r + 8) * i) / n;
        d += ` L${x - 4} ${top - 10 - (i % 2) * 6} L${x + 3} ${top + 8}`;
      }
      return `<path d="${d} L${50 + r + 4} ${cy} Q50 ${top - 4} ${50 - r - 4} ${cy} Z" fill="${c}"/>`;
    }
    case 'buzz':
      return `<path d="M${50 - r} ${cy - 4} Q50 ${top - 8} ${50 + r} ${cy - 4} Q50 ${top + 6} ${50 - r} ${cy - 4} Z" fill="${c}"/>`;
    case 'short':
      return `<path d="M${50 - r - 3} ${cy + 2} Q${50 - r} ${top - 8} 50 ${top - 6} Q${50 + r} ${top - 8} ${50 + r + 3} ${cy + 2} Q${50 + r - 6} ${top + 10} 50 ${top + 12} Q${50 - r + 4} ${top + 10} ${50 - r - 3} ${cy + 2} Z" fill="${c}"/>`;
    case 'bob':
    case 'long':
    case 'twin':
      return `<path d="M${50 - r - 4} ${cy + 4} Q${50 - r} ${top - 10} 50 ${top - 8} Q${50 + r} ${top - 10} ${50 + r + 4} ${cy + 4} L${50 + r - 2} ${cy - 4} Q${50 + 8} ${top + 16} ${50 - 4} ${top + 10} Q${50 - r + 6} ${top + 18} ${50 - r + 2} ${cy - 4} Z" fill="${c}"/>`;
  }
}
function eyes(f: FaceSpec, y: number, gap: number, size: number) {
  const out: string[] = [];
  for (const s of [-1, 1]) {
    const x = 50 + s * gap;
    if (f.style === 'bold') {
      // 劇画調: 細い目と太い眉
      out.push(`<path d="M${x - 7} ${y} Q${x} ${y - 4} ${x + 7} ${y}" stroke="#111" stroke-width="2.4" fill="none"/>`);
      out.push(`<circle cx="${x}" cy="${y + 0.5}" r="2" fill="${f.eye}"/>`);
      out.push(`<path d="M${x - 9} ${y - 8} L${x + 8} ${y - 6 - s * 1.5}" stroke="#111" stroke-width="4" stroke-linecap="round"/>`);
    } else if (f.mood === 'cool' && f.style === 'anime') {
      out.push(`<ellipse cx="${x}" cy="${y}" rx="${size * 0.8}" ry="${size * 0.7}" fill="#fff"/>`);
      out.push(`<ellipse cx="${x}" cy="${y + 1}" rx="${size * 0.55}" ry="${size * 0.65}" fill="${f.eye}"/>`);
      out.push(`<path d="M${x - size} ${y - size * 0.4} L${x + size} ${y - size * 0.7}" stroke="#222" stroke-width="2"/>`);
      out.push(`<circle cx="${x - 1.5}" cy="${y - 1.5}" r="1.4" fill="#fff"/>`);
    } else {
      out.push(`<ellipse cx="${x}" cy="${y}" rx="${size * 0.75}" ry="${size}" fill="#222"/>`);
      out.push(`<ellipse cx="${x}" cy="${y + size * 0.15}" rx="${size * 0.55}" ry="${size * 0.75}" fill="${f.eye}"/>`);
      out.push(`<circle cx="${x - size * 0.25}" cy="${y - size * 0.35}" r="${size * 0.28}" fill="#fff"/>`);
    }
  }
  return out.join('');
}
function mouth(f: FaceSpec, y: number) {
  if (f.mood === 'grin') return `<path d="M43 ${y} Q50 ${y + 7} 57 ${y} Z" fill="#7a1f1f" stroke="#3a0f0f" stroke-width="1"/><path d="M45 ${y + 0.5} L55 ${y + 0.5}" stroke="#fff" stroke-width="1.6"/>`;
  if (f.mood === 'cool') return `<path d="M46 ${y + 1} L54 ${y}" stroke="#7a3a3a" stroke-width="1.6" stroke-linecap="round"/>`;
  return `<path d="M45 ${y} Q50 ${y + 5} 55 ${y}" stroke="#7a3a3a" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
}
function accessory(f: FaceSpec, cy: number, r: number, eyeY: number) {
  const c = f.accColor ?? '#888';
  switch (f.acc) {
    case 'goggles':
      return `<rect x="${50 - r - 2}" y="${cy - r + 4}" width="${2 * r + 4}" height="5" fill="#333"/>` +
        [-1, 1].map((s) => `<circle cx="${50 + s * 11}" cy="${cy - r + 6}" r="7.5" fill="${c}" stroke="#333" stroke-width="2.5"/><circle cx="${50 + s * 11 - 2}" cy="${cy - r + 4}" r="2" fill="#fff" opacity=".7"/>`).join('');
    case 'headband':
      return `<rect x="${50 - r - 1}" y="${cy - r + 8}" width="${2 * r + 2}" height="7" fill="${c}"/><path d="M${50 + r} ${cy - r + 11} l9 -4 l-2 9 Z" fill="${c}"/>`;
    case 'cap':
      return `<path d="M${50 - r - 2} ${cy - r + 10} Q50 ${cy - r - 16} ${50 + r + 2} ${cy - r + 10} Z" fill="${c}"/><path d="M${50 - r - 2} ${cy - r + 10} L${50 + r + 16} ${cy - r + 10} L${50 + r + 12} ${cy - r + 14} L${50 - r - 2} ${cy - r + 14} Z" fill="${shade(c, 0.7)}"/>`;
    case 'star':
      return `<path transform="translate(${50 + r - 4} ${cy - r + 4}) scale(.9)" d="M0 -8 L2.4 -2.4 L8 -2 L3.6 1.6 L5 8 L0 4.4 L-5 8 L-3.6 1.6 L-8 -2 L-2.4 -2.4 Z" fill="${c}" stroke="#b8860b" stroke-width="1"/>`;
    case 'glasses':
      return [-1, 1].map((s) => `<rect x="${50 + s * 12 - 8}" y="${eyeY - 6}" width="16" height="12" rx="3" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="2"/>`).join('') +
        `<path d="M46 ${eyeY - 2} L54 ${eyeY - 2}" stroke="${c}" stroke-width="2"/>`;
    default:
      return '';
  }
}

// ドット絵: 16×16 のマスで描く（同じ部品情報から、色だけ使って簡略化する）
function pixelFace(f: FaceSpec) {
  const map = [
    '....HHHHHHHH....',
    '...HHHHHHHHHH...',
    '..AAAAAAAAAAAA..',
    '..HHHHHHHHHHHH..',
    '..HSSSSSSSSSSH..',
    '..SSSSSSSSSSSS..',
    '..SSEESSSSEESS..',
    '..SSEESSSSEESS..',
    '..SSSSSSSSSSSS..',
    '..SSSSSMMSSSSS..',
    '...SSSSSSSSSS...',
    '....SSSSSSSS....',
    '.....SSSSSS.....',
    '....BBBBBBBB....',
    '..BBBBBBBBBBBB..',
    '.BBBBBBBBBBBBBB.',
  ];
  const col: Record<string, string> = { H: f.hair, A: f.accColor ?? f.hair, S: f.skin, E: '#1a1a2a', M: '#a04040', B: '#3a4a6a' };
  let out = '';
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (col[ch]) out += `<rect x="${2 + x * 6}" y="${2 + y * 6}" width="6.2" height="6.2" fill="${col[ch]}"/>`;
  }));
  return `<g shape-rendering="crispEdges">${out}</g>`;
}

// 画像で入れるドライバー（顔=カード用、art=ガレージの立ち絵）。public/drivers/ に置く
export const DRIVER_ART: Record<string, { face: string; art: string }> = {
  sena: { face: './drivers/sena-face.webp', art: './drivers/sena-art.webp' },
  chibisena: { face: './drivers/chibisena-face.webp', art: './drivers/chibisena-art.webp' },
  azpaca: { face: './drivers/azpaca-face.webp', art: './drivers/azpaca-art.webp' },
};
// カード用の顔（画像があれば画像、なければ部品合成のSVG）
export function faceHtml(id: string): string {
  if (DRIVER_ART[id]) return `<img src="${DRIVER_ART[id].face}" alt="">`;
  return FACES[id] ? faceSvg(FACES[id]) : '';
}

export function faceSvg(f: FaceSpec, bg = '#1d2430'): string {
  let body = '';
  if (f.style === 'pixel') body = pixelFace(f);
  else {
    // 輪郭の大きさと目の大きさで絵柄を分ける（デフォルメ=頭が大きく目が大きい）
    const chibi = f.style === 'chibi';
    const bold = f.style === 'bold';
    const cy = chibi ? 50 : 46;
    const r = chibi ? 30 : 25;
    const eyeY = cy + (chibi ? 6 : 4);
    const stroke = bold ? 'stroke="#111" stroke-width="3"' : 'stroke="rgba(0,0,0,.25)" stroke-width="1"';
    const head = bold
      ? `<path d="M${50 - r} ${cy - 8} L${50 - r + 2} ${cy + 12} L${50 - 10} ${cy + r + 4} L${50 + 10} ${cy + r + 4} L${50 + r - 2} ${cy + 12} L${50 + r} ${cy - 8} Q50 ${cy - r - 6} ${50 - r} ${cy - 8} Z" fill="${f.skin}" ${stroke}/>`
      : `<ellipse cx="50" cy="${cy + (chibi ? 0 : 3)}" rx="${r}" ry="${chibi ? r - 2 : r + 3}" fill="${f.skin}" ${stroke}/>`;
    const neck = `<rect x="44" y="${cy + r - 2}" width="12" height="10" fill="${shade(f.skin, 0.85)}"/><path d="M20 100 Q22 ${cy + r + 8} 50 ${cy + r + 6} Q78 ${cy + r + 8} 80 100 Z" fill="#3a4a6a"/>`;
    const blush = chibi ? `<ellipse cx="${50 - 18}" cy="${eyeY + 9}" rx="5" ry="3" fill="#ff8a8a" opacity=".5"/><ellipse cx="${50 + 18}" cy="${eyeY + 9}" rx="5" ry="3" fill="#ff8a8a" opacity=".5"/>` : '';
    const jawShade = bold ? `<path d="M${50 - r + 4} ${cy + 14} L${50 - 9} ${cy + r + 2} L${50 - 4} ${cy + r + 2} Z" fill="${shade(f.skin, 0.75)}"/>` : '';
    body = hairBack(f, cy, r) + neck + head + jawShade + eyes(f, eyeY, chibi ? 12 : 10, chibi ? 7 : 5) + blush +
      mouth(f, eyeY + (chibi ? 14 : 15)) + hairFront(f, cy, r) + accessory(f, cy, r, eyeY);
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="${bg}"/>${body}</svg>`;
}
