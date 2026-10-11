import type { BodyData } from './blocks';

// 見本ボディ（中径タイヤ・4WDに合わせた形）。ここから改造して始められるようにする
export const SAMPLES: BodyData[] = [
  {
    v: 1,
    name: '見本ウェッジ',
    line: 'edge',
    blocks: [
      { t: 'box', p: [0, 0.35, -0.15], s: [0.9, 0.15, 1.4], r: [0, 0, 0], c: 'body' },
      { t: 'wedge', p: [0, 0.35, 0.85], s: [0.9, 0.15, 0.6], r: [0, 0, 0], c: 'body' },
      { t: 'trap', p: [0, 0.5, -0.2], s: [0.6, 0.15, 0.6], r: [0, 0, 0], c: 'black', k: 0.6 },
      { t: 'harch', p: [0.6, 0.5, 0.7], s: [0.3, 0.4, 0.8], r: [0, 0, 0], c: 'dark', m: true, k: 0.06 },
      { t: 'harch', p: [0.6, 0.5, -0.7], s: [0.3, 0.4, 0.8], r: [0, 0, 0], c: 'dark', m: true, k: 0.06 },
      { t: 'plate', p: [0, 0.75, -1.0], s: [0.9, 0.05, 0.25], r: [0, 0, 0], c: 'accent', a: -15 },
      { t: 'box', p: [0.3, 0.6, -1.0], s: [0.05, 0.25, 0.1], r: [0, 0, 0], c: 'dark', m: true },
    ],
  },
  { v: 1, name: '白紙', line: 'balance', blocks: [] },
];
