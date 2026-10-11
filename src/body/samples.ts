import type { BodyData, BodyData2, PartData } from './blocks';

// 見本の部位（中径タイヤ・4WDに合わせた形）。部位の一覧が空のとき、これを入れておく
export const SAMPLE_PARTS: PartData[] = [
  { v: 1, id: 'sample-main', name: '平たい胴', kind: 'main', blocks: [{ t: 'box', p: [0, 0.35, -0.15], s: [0.9, 0.15, 1.4], r: [0, 0, 0], c: 'body' }] },
  { v: 1, id: 'sample-nose', name: 'ウェッジノーズ', kind: 'bonnet', blocks: [{ t: 'wedge', p: [0, 0.35, 0.85], s: [0.9, 0.15, 0.6], r: [0, 0, 0], c: 'body' }] },
  { v: 1, id: 'sample-cockpit', name: '低いキャノピー', kind: 'cockpit', blocks: [{ t: 'trap', p: [0, 0.5, -0.2], s: [0.6, 0.15, 0.6], r: [0, 0, 0], c: 'black', k: 0.6 }] },
  { v: 1, id: 'sample-ffender', name: 'アーチ（前）', kind: 'frontFender', blocks: [{ t: 'harch', p: [0.6, 0.5, 0.7], s: [0.3, 0.4, 0.8], r: [0, 0, 0], c: 'dark', m: true, k: 0.06 }] },
  { v: 1, id: 'sample-rfender', name: 'アーチ（後ろ）', kind: 'rearFender', blocks: [{ t: 'harch', p: [0.6, 0.5, -0.7], s: [0.3, 0.4, 0.8], r: [0, 0, 0], c: 'dark', m: true, k: 0.06 }] },
  {
    v: 1, id: 'sample-wing', name: '板ウイング', kind: 'rearWing', blocks: [
      { t: 'plate', p: [0, 0.75, -1.0], s: [0.9, 0.05, 0.25], r: [0, 0, 0], c: 'accent', a: -15 },
      { t: 'box', p: [0.3, 0.6, -1.0], s: [0.05, 0.25, 0.1], r: [0, 0, 0], c: 'dark', m: true },
    ],
  },
];

// 見本ボディ: 見本の部位をそのまま並べたもの
export const SAMPLE_BODY: BodyData2 = {
  v: 2,
  name: '見本ウェッジ',
  line: 'edge',
  items: SAMPLE_PARTS.map((p) => ({ kind: p.kind, name: p.name, blocks: p.blocks, p: [0, 0, 0], sc: [1, 1, 1] })),
};
export const BLANK_BODY: BodyData2 = { v: 2, name: '白紙', line: 'balance', items: [] };

// 旧版（v1）の見本。古い保存データの読み込み確認用に残す
export const SAMPLES: BodyData[] = [
  { v: 1, name: '見本ウェッジ', line: 'edge', blocks: SAMPLE_PARTS.flatMap((p) => p.blocks) },
];
