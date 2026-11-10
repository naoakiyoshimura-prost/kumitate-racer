// コースエディタの共通の型（幾何の計算 geom.ts と画面 ui.ts の取り決め）。
// 単位は実寸の mm。座標は右手系で y が上、x-z が床。角度は度。
// ゲームへ渡すときだけ export.ts がゲームの単位（m）に換算する。

export type LaneCount = 3 | 5;

export type PieceType =
  | 'start' // スタート専用の直線（長さは直線1枚と同じ。スタートライン付き。1コースに1個まで）
  | 'straight' // 直線（frac: 1 / 0.5 / 0.25 = 標準の長さに対する割合）
  | 'corner' // 45度コーナー（dir: L / R）
  | 'wave' // ウェーブ（flip=true で反転＝山と谷が逆）
  | 'laneChange' // レーンチェンジ（立体交差。通るとレーンが1つずれる）
  | 'slopeUp' // 上りスロープ（1個で1段ぶん上がる。入口の丸み→一定角度の斜面→出口の丸み）
  | 'slopeDown' // 下りスロープ（1個で1段ぶん下がる）
  | 'bankUp' // バンク上り（角度のきつい上り坂。横には傾かない。angle 20/30/40度、高さ bankRise）
  | 'bankDown'; // バンク下り（バンク上りの逆。上りと下りを1個ずつで元の高さに戻る）
// 以前の「バンク入口 / バンク戻り」（bankIn / bankOut、路面が横に傾く部品）は誤解に基づく部品だったので廃止。
// 保存データに残っていても geom.ts parseLayout が直線1枚に置き換えて読む

export type BankAngle = 20 | 30 | 40;
export const BANK_ANGLES: BankAngle[] = [20, 30, 40];

export interface PieceSpec {
  type: PieceType;
  frac?: 1 | 0.5 | 0.25; // straight
  dir?: 'L' | 'R'; // corner
  flip?: boolean; // wave
  angle?: BankAngle; // bankUp / bankDown（斜面の角度・度。無ければ20）
}

export interface Layout {
  version: 1;
  name: string;
  lanes: LaneCount;
  // 寸法の上書き（任意）。キーは `${レーン数}:${項目名}`（例 '3:slopeRise'）。3レーンと5レーンの表は別なので値を流用しない。
  // 無い項目は catalog.ts の表の値を使う
  dims?: Record<string, number>;
  pieces: PieceSpec[]; // スタート地点から進行方向の順。最後の部品の出口が最初の入口につながれば周回
}

export type Vec3 = [number, number, number];

// コース中心線上の1点の位置と姿勢
export interface Frame {
  p: Vec3; // 位置（mm）
  f: Vec3; // 進行方向（単位ベクトル）
  u: Vec3; // 路面の上向き（単位ベクトル）。右向きは geom.ts の right(frame) で求める
}

export interface Placed {
  index: number;
  spec: PieceSpec;
  start: Frame;
  end: Frame;
  samples: Frame[]; // 中心線の点列（start と end を含む。描画と書き出し用）
  outline: [number, number][]; // 上から見た外形（x, z の多角形、壁の外側まで）
  length: number; // 中心線の長さ（mm）
  minY: number; // 路面の最低の高さ
  maxY: number;
}

export interface CheckMessage {
  level: 'ok' | 'warn' | 'error';
  text: string; // 日本語。画面にそのまま出す
  piece?: number; // 関係する部品の番号
}

export interface Check {
  closed: boolean; // 出口が入口に、位置・向き・高さ・傾きとも一致
  gapMm: number; // 出口と入口の距離
  headingDeg: number; // 向きのずれ
  heightMm: number; // 高さのずれ
  tiltDeg: number; // 路面の傾きのずれ
  laneShift: number; // 1周でレーンがいくつずれるか（レーンチェンジの数）
  lapsToReturn: number; // 元のレーンに戻るまでの周回数（ずれが0なら1）
  totalLengthMm: number; // 中心線の1周の長さ
  overlaps: [number, number][]; // 重なっている部品の組（立体交差で高さが十分に違うものは除く）
  underground: number[]; // 床（y=0）より下に潜っている部品
  messages: CheckMessage[];
}

export interface Built {
  placed: Placed[];
  check: Check;
}

// 寸法表の1項目。出典の種類を必ず持つ
export type SourceKind = 'official' | 'measured' | 'estimated' | 'provisional';
// official=メーカー公表、measured=実測（出典あり）、estimated=公表値から計算した推定、provisional=仮の値
export interface Dim {
  value: number;
  unit: 'mm' | 'deg' | 'count';
  source: SourceKind;
  note: string; // 出典や根拠（URL、計算のしかた）
}
