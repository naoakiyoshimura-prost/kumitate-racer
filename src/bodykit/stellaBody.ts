import * as THREE from 'three';
import { assemble } from './assemble';
import { POD_RIGS, STELLA_PALETTES, fitFromAxles, stellaCanardY, stellaKit, type PodRigId, type StellaFit } from './stella';
import type { Detail } from './types';

// ゲーム本体に STELLA（部位キット版）を載せるための窓口。carModel.ts の buildCarModel が「デザイン見本 = stella」のときに使う。
// 見た目だけ（性能・セーブ・parts.json は変えない）。
//   ・形はシャーシに合わせて変形（車軸の位置・タイヤ径・トレッド。stella.ts の StellaFit）
//   ・ブースターは自前のポッド2基。setBoost の段の展開量を setState(0〜3) へつなぐのは carModel 側
//   ・噴射口の目印（金リングの後端）を nozzles で返す。boostFx の炎・リング・火花はここから出る
//   ・ポッドの動き方は URL ?pod=A|B|C（既定 C。店長が選んでいる途中のため切り替えられるようにしておく）

export const STELLA_LOOK = 'stella';

export function stellaRigFromUrl(): PodRigId {
  if (typeof location === 'undefined') return 'C';
  const p = new URLSearchParams(location.search).get('pod')?.toUpperCase();
  return p && p in POD_RIGS ? (p as PodRigId) : 'C';
}

export interface StellaBody {
  group: THREE.Group;
  fit: StellaFit;
  nozzles: { anchor: THREE.Object3D; r: number }[];
  setState(s: number): void;
  setAero(a: number): void;
  canardY(z: number): number;
  triangles: number;
  meshes: number;
}

// ウィングの角度（エアロ）: 可変車扱い。当面はエアロ 0→1 でウィングを少し立てる（迎え角 +7度、後縁が下がる）[仮]
const AERO_PITCH = (7 * Math.PI) / 180;

export function buildStellaBody(o: { axles: [number, number][]; treadW: number; deckY: number; detail: Detail; rig?: PodRigId }): StellaBody {
  const fit = fitFromAxles(o.axles, o.treadW, o.deckY);
  const kit = stellaKit(o.rig ?? stellaRigFromUrl(), fit);
  const car = assemble(kit, { detail: o.detail });
  car.setPalette(STELLA_PALETTES.wbr.palette);
  const wing = car.nodeOf('wing', 'wing');
  let pitch = 0;
  let state = -1;
  const apply = () => {
    if (wing) wing.rotation.x = pitch;
  };
  return {
    group: car.group,
    fit,
    nozzles: car.marks.filter((m) => m.id === 'nozzle').map((m) => ({ anchor: m.obj, r: m.r })),
    setState(s: number) {
      const v = Math.max(0, Math.min(3, s));
      if (Math.abs(v - state) < 1e-4) return;
      state = v;
      car.setState(v);
      apply(); // setState が回転を戻すので、エアロの角度をかけ直す
    },
    setAero(a: number) {
      pitch = -AERO_PITCH * Math.max(0, Math.min(1, a));
      apply();
    },
    canardY: (z: number) => stellaCanardY(z, fit),
    triangles: car.stats.triangles,
    meshes: car.stats.meshes,
  };
}
