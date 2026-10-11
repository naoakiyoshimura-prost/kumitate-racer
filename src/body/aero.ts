import * as THREE from 'three';
import { blockMatrix, isMirrored, itemMatrix, type Block, type BodyItem } from './blocks';

// 変形部位の動き。回転軸と動く量は標準の変形翼と同じで固定（形と、変形前・変形後の置き方だけ自由）
//   変形フロント翼: 前へ 0.65 せり出す
//   変形リヤ翼: 左右それぞれ外側の付け根（x=±0.66, 高さ=デッキ+0.78, z=−0.95）を軸に、90度ボディ側へ倒れる
// 変形後の形を別に作った部位は、動きの途中（半分あたり）で変形前の形から変形後の形へ入れ替わる
export const AERO_SLIDE = 0.65;
export const rearPivot = (side: number, deckY: number) => new THREE.Vector3(side * 0.66, deckY + 0.78, -0.95);

export function aeroPose(kind: 'aeroFront' | 'aeroRear', side: number, a: number, deckY: number): THREE.Matrix4 {
  if (kind === 'aeroFront') return new THREE.Matrix4().makeTranslation(0, 0, AERO_SLIDE * a);
  const p = rearPivot(side, deckY);
  return new THREE.Matrix4()
    .makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationZ(side * (Math.PI / 2) * a))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}
// 変形前・変形後の形の大きさ（入れ替わりのとき一瞬しぼんでから出てくる）
export function aeroScales(a: number, hasAfter: boolean): [number, number] {
  if (!hasAfter) return [1, 0];
  const ease = (t: number) => Math.max(0, Math.min(1, t));
  return [ease((0.55 - a) / 0.25), ease((a - 0.45) / 0.25)];
}

export type Entry = { b: Block; m: THREE.Matrix4 };
// 部位のブロックを、左右対称の写しも含めて車体の座標に並べる
export function itemEntries(it: BodyItem, blocks: Block[] = it.blocks): Entry[] {
  const im = itemMatrix(it);
  const out: Entry[] = [];
  for (const b of blocks) for (const mirror of isMirrored(b) ? [false, true] : [false]) out.push({ b, m: blockMatrix(b, mirror).premultiply(im) });
  return out;
}
export type AeroSet = { kind: 'aeroFront' | 'aeroRear'; side: number; before: Entry[]; after: Entry[]; cB: THREE.Vector3; cA: THREE.Vector3 };
const centerOf = (es: Entry[]) => {
  const c = new THREE.Vector3();
  for (const e of es) c.add(new THREE.Vector3().setFromMatrixPosition(e.m));
  return es.length ? c.divideScalar(es.length) : c;
};
// 変形部位を動く単位（フロント=1つ、リヤ=左右2つ）に分ける。リヤはブロックが左右どちら側にあるかで軸を決める
export function aeroSets(items: BodyItem[]): AeroSet[] {
  const sets = new Map<string, AeroSet>();
  const get = (kind: AeroSet['kind'], side: number) => {
    const key = `${kind}${side}`;
    if (!sets.has(key)) sets.set(key, { kind, side, before: [], after: [], cB: new THREE.Vector3(), cA: new THREE.Vector3() });
    return sets.get(key)!;
  };
  const sideOf = (kind: AeroSet['kind'], e: Entry) => (kind === 'aeroFront' ? 0 : new THREE.Vector3().setFromMatrixPosition(e.m).x >= 0 ? 1 : -1);
  for (const it of items) {
    if (it.kind !== 'aeroFront' && it.kind !== 'aeroRear') continue;
    const kind = it.kind;
    for (const e of itemEntries(it)) get(kind, sideOf(kind, e)).before.push(e);
    for (const e of itemEntries(it, it.after ?? [])) get(kind, sideOf(kind, e)).after.push(e);
  }
  for (const s of sets.values()) {
    s.cB = centerOf(s.before);
    s.cA = centerOf(s.after);
  }
  return [...sets.values()];
}
const scaleAbout = (c: THREE.Vector3, k: number) =>
  new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
// 動きの途中 a（0=変形前、1=変形後）での、変形前の形・変形後の形それぞれの置き方
export function aeroMatrices(s: AeroSet, a: number, deckY: number) {
  const pose = aeroPose(s.kind, s.side, a, deckY);
  const [kb, ka] = aeroScales(a, s.after.length > 0);
  const before = pose.clone().multiply(scaleAbout(s.cB, kb));
  const after = pose.clone().multiply(aeroPose(s.kind, s.side, 1, deckY).invert()).multiply(scaleAbout(s.cA, ka));
  return { before, after, kb, ka };
}
