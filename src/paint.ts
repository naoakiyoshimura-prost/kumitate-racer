// 車体カラー（ガレージで選ぶ）。CPUの車と見分けがつくよう、CPUは自分と違う色にする
export const PAINTS = [
  { name: 'レッド', hex: 0xd23c3c },
  { name: 'ブルー', hex: 0x2f6fd6 },
  { name: 'イエロー', hex: 0xf2c230 },
  { name: 'グリーン', hex: 0x2fb35a },
  { name: 'オレンジ', hex: 0xff7a1a },
  { name: 'パープル', hex: 0x8a4fd8 },
  { name: 'ホワイト', hex: 0xe8e8ec },
  { name: 'ブラック', hex: 0x2a2c30 },
];
export const paintHex = (i: number | undefined) => (PAINTS[i ?? 0] ?? PAINTS[0]).hex;
// CPUの色: 基本は青、自分が青なら赤
export const rivalHex = (playerIndex: number | undefined) => (playerIndex === 1 ? PAINTS[0].hex : PAINTS[1].hex);
