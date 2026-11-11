// 部位キット（ボディを部位ごとに分けて作り、取付位置で組み上げる仕組み）の型。
// 座標は carModel.ts と同じ: 前が +z、x の + が右、y が上、原点は路面。車の全長 3.38 = 実寸165mm。
// 部位は互いに独立していて、取付位置（マウント）で車に付く。将来「くみたて工房」で
// 別の車の同じ種類の部位と入れ替えて合体させる前提なので、部位どうしで形を参照しない。

export type V3 = [number, number, number];

// 色枠（どの部位も同じ枠を持つ）。頂点色で塗り分けるので、色を変えても材質・メッシュは増えない
//   base=地の色（白）  sub=サブ（青）  line=細い差し線（赤）  frame=内側構造（黒）
//   glass=風防        metal=ノズルリング等の金物（金）  lamp / lamp2=右・左の前照灯（光る）
export type Slot = 'base' | 'sub' | 'line' | 'frame' | 'glass' | 'metal' | 'lamp' | 'lamp2';
export const SLOTS: Slot[] = ['base', 'sub', 'line', 'frame', 'glass', 'metal', 'lamp', 'lamp2'];
export const SLOT_INDEX: Record<Slot, number> = { base: 0, sub: 1, line: 2, frame: 3, glass: 4, metal: 5, lamp: 6, lamp2: 7 };
export type Palette = Record<Slot, number>;

export type Detail = 'high' | 'low';

// 可動: 状態 s（0=NORMAL 1=BOOST1 2=BOOST2 3=BOOST3、連続値）を受けて、支点からのずれを返す。
// kind は「左右の部位を1つのメッシュにまとめてよいか」の判定に使う:
//   translate = 平行移動だけ（支点の位置に関係なく同じ動き → 左右・前後どこでもまとめられる）
//   rotX      = x 軸まわりの回転だけ（支点の y,z が同じならまとめられる。左右の x は関係ない）
//   general   = それ以外（支点が完全に同じときだけまとめる）
export interface Pose {
  p: V3;
  r: V3;
  sc: number;
  vis: boolean;
}
export interface Motion {
  id: string;
  kind: 'translate' | 'rotX' | 'general';
  at(s: number, out: Pose): void;
}

// 部位の中の「動く単位」。parent の単位にぶら下がり、pivot（車体座標）を支点に motion で動く。
// motion が無い単位は親と一緒に動く（親も無ければ固定）。
export interface Unit {
  id: string;
  label: string;
  parent?: string;
  pivot?: V3;
  motion?: Motion;
  paint: import('./painter').Painter;
}

export type PartKind = 'core' | 'fenderF' | 'cowlR' | 'wing' | 'pod';

// 取付位置。同じ slot の部位どうしは入れ替えられる（工房用）
export interface Mount {
  slot: PartKind;
  side: -1 | 0 | 1; // -1=左 0=中央 1=右
  pos: V3; // 車体座標の取付点。部位の形はこの点を原点にして持つ
}

export interface PartDef {
  id: string;
  kind: PartKind;
  label: string;
  mount: Mount;
  explode: V3; // 分解表示で離す向きと量（車体座標）
  variant?: string; // 同じ部位の作り分け（例: 後肩カウルのポッド格納の型）
  build(detail: Detail): Unit[]; // 単位の形は車体座標で作る（組み上げ時にマウント基準へ直す）
}

export interface CarKit {
  id: string;
  name: string;
  states: string[]; // 状態の名前（setState の 0,1,2,… に対応）
  palette: Palette;
  parts: PartDef[];
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const ease = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
