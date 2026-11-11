import * as THREE from 'three';
import FX from './data/boostfx.json';
import { BoostFx, type FxProfile, type Nozzle } from './boostFx';
import { isTransformBuild, part, type Build } from './setup';
import parts from './data/parts.json';
import { customBodyData } from './body/custom';
import { meshEntries } from './body/mesh';
import { aeroMatrices, aeroSets, itemEntries, rearPivot } from './body/aero';
import { isAeroKind } from './body/blocks';
import { buildDesignedBody, isDesignedBody, type DesignedBody } from './carBodies';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 車体の見た目（仮のカクカク版）。セッティングに合わせてタイヤの数・大きさ・幅、モーター位置が変わる
// 前が +z。原点は路面の高さ
// タイヤ径はmm表記（中径26mm＝半径0.3）に比例させる
export const TIRE_MM: Record<string, number> = { tiny: 22, small: 24, standard: 26, large: 29, huge: 32 };
export const TREAD_W: Record<string, number> = { narrow: 0.14, normal: 0.24, wide: 0.36 };
// ローラーの外端（壁に触れる点）の車体中心からの距離。tuning.json の car.halfWidth と同じ値にする
export const ROLLER_REACH = 0.95;

// シャーシごとの車軸: [前後位置, 固定のタイヤ径mm]。径が空なら、ガレージで選んだタイヤ径を使う
// 6輪・8輪は見た目のバランスのためタイヤ径を固定し、前後どちらに4輪あるかを並び（2軸を寄せたタンデム）で見せる。
// タンデムの2軸はタイヤ同士のすき間が約6cmになるように置く
export const AXLES: Record<string, [number, number?][]> = {
  std4: [[0.72], [-0.72]],
  aero4: [[0.72], [-0.72]],
  front6: [[1.15, 22], [0.58, 22], [-0.9, 26]], // 前4輪（小径）＋後ろ2輪（中径）
  formula6: [[1.15, 22], [0.58, 22], [-0.9, 26]], // EX 6輪フォーミュラ: 並びは前4輪型と同じ
  rear6: [[0.85, 24], [-0.5, 24], [-1.11, 24]], // 前2輪＋後ろ4輪、全部24mm
  eight: [[1.1, 22], [0.53, 22], [-0.53, 22], [-1.1, 22]], // 前後とも2軸、全部22mm
};
const mmToR = (mm: number) => (0.3 * mm) / 26;
// 車軸ごとの [前後位置, タイヤ半径]
export function axlesOf(build: Build): [number, number][] {
  const sel = mmToR(TIRE_MM[build.tireSize] ?? 26);
  return (AXLES[build.chassis] ?? AXLES.std4).map(([z, mm]) => [z, mm ? mmToR(mm) : sel]);
}

// ボディの形は「部品の組み合わせ」で持つ（将来、流線形・直線型・バランスなどを自由に組めるようにするため）
// 特定の実在車・作品の車体をそのまま写さず、「速そうな未来のレーシングカー」の雰囲気だけを借りる
// 輪郭は（前後位置, 高さ）。ノーズ（前）＋キャビン（中）＋テール（後ろ）をつなげて1枚の横顔にする
type Pt = [number, number];
export const BODY_PARTS = {
  nose: {
    wedge: [[1.25, 0], [1.2, 0.1], [0.4, 0.22]] as Pt[], // 直線型: 低く平たい
    standard: [[1.2, 0], [1.15, 0.12], [0.35, 0.28]] as Pt[], // バランス
    round: [[1.2, 0], [1.1, 0.18], [0.5, 0.36]] as Pt[], // 流線形: 丸く盛り上がる
    needle: [[1.38, 0], [1.32, 0.08], [0.5, 0.2]] as Pt[], // 長く尖る
  },
  cabin: {
    low: [[0.15, 0.4], [-0.6, 0.42]] as Pt[],
    mid: [[0.1, 0.48], [-0.55, 0.48]] as Pt[],
    high: [[0.15, 0.55], [-0.5, 0.55]] as Pt[],
  },
  tail: {
    cut: [[-1.0, 0.3], [-1.12, 0.12], [-1.12, 0]] as Pt[], // 直線型: スパッと切る
    taper: [[-0.95, 0.34], [-1.1, 0.12], [-1.1, 0]] as Pt[], // バランス
    smooth: [[-1.0, 0.35], [-1.1, 0.1], [-1.1, 0]] as Pt[], // 流線形
  },
};
export type BodySpec = {
  nose: keyof typeof BODY_PARTS.nose;
  cabin: keyof typeof BODY_PARTS.cabin;
  tail: keyof typeof BODY_PARTS.tail;
  width: number;
  // 飾り（EX技に合わせる）
  fenders?: boolean;
  fins?: boolean;
  skirts?: boolean;
  canards?: boolean;
  stripe?: number;
  // タイヤハウス: open=タイヤむき出し、half=上半分だけ覆う低重心型、full=タイヤごと覆うフルカウル
  cowl?: 'open' | 'half' | 'full';
};
// いまのボディ6種の組み合わせ（組み立て画面は後で作る）
const BODY_SPEC: Record<string, BodySpec> = {
  slider: { nose: 'wedge', cabin: 'low', tail: 'cut', width: 0.9, cowl: 'open' }, // 直線型
  twin: { nose: 'standard', cabin: 'mid', tail: 'taper', width: 0.82, stripe: 0.3, cowl: 'open' }, // バランス
  cyclone: { nose: 'round', cabin: 'high', tail: 'smooth', width: 0.8, fins: true, cowl: 'full' }, // 流線形
  wallrunner: { nose: 'wedge', cabin: 'low', tail: 'cut', width: 0.86, cowl: 'half' }, // 直線型・低重心
  shifter: { nose: 'needle', cabin: 'low', tail: 'smooth', width: 0.8, stripe: 0.21, cowl: 'half' }, // 流線形・低重心
  stormShifter: { nose: 'needle', cabin: 'high', tail: 'smooth', width: 0.8, fins: true, cowl: 'full' }, // 流線形
};
type BodyLook = BodySpec & { profile: Pt[] };
const bodyLook = (id: string): BodyLook => {
  const spec = BODY_SPEC[id] ?? BODY_SPEC.slider;
  return { ...spec, profile: [...BODY_PARTS.nose[spec.nose], ...BODY_PARTS.cabin[spec.cabin], ...BODY_PARTS.tail[spec.tail]] };
};

// ホイールの見た目で性能がわかるようにする:
// コンパウンドでスポークの形と色（ハード=ディスク、ミディアム=5本、ハイグリップ=金の6本、スリック=黒の3本＋橙のリム）、
// シャフトでセンターキャップの色（軸受けなし=なし、ベアリング=銀、強化ベアリング=青）
const WHEEL_STYLE: Record<string, { spokes: number; color: number; rim?: number; disc?: boolean }> = {
  hard: { spokes: 0, color: 0x9aa0a8, disc: true },
  medium: { spokes: 5, color: 0xe8e8e8 },
  soft: { spokes: 6, color: 0xe0b030, rim: 0xc83030 },
  slick: { spokes: 3, color: 0x2a2a2a, rim: 0xff8a00 },
};
const CAP: Record<string, number> = { bearing: 0xd9d9d9, reinforced: 0x2f8fff };
const wheelMats = new Map<number, THREE.MeshLambertMaterial>();
const wmat = (c: number) => {
  if (!wheelMats.has(c)) wheelMats.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return wheelMats.get(c)!;
};
function makeWheelFace(build: Build, r: number, treadW: number, side: number, hubMat: THREE.Material): THREE.Group {
  const face = new THREE.Group();
  const st = WHEEL_STYLE[build.compound] ?? WHEEL_STYLE.medium;
  const x = side * (treadW / 2 + 0.006);
  // ホイールの皿（タイヤの内側の円）
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.02, 16), st.disc ? wmat(st.color) : hubMat);
  dish.rotation.z = Math.PI / 2;
  dish.position.x = x - side * 0.004;
  face.add(dish);
  if (!st.disc) {
    // 皿は暗くして、スポークを浮かせる
    dish.material = wmat(0x1c1c1c);
    for (let i = 0; i < st.spokes; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 0.66, r * 0.16), wmat(st.color));
      spoke.position.y = r * 0.33;
      const arm = new THREE.Group();
      arm.add(spoke);
      arm.rotation.x = (i / st.spokes) * Math.PI * 2;
      arm.position.x = x;
      face.add(arm);
    }
  }
  if (st.rim) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, 0.022, 6, 20), wmat(st.rim));
    rim.rotation.y = Math.PI / 2;
    rim.position.x = x;
    face.add(rim);
  }
  const cap = CAP[build.shaft];
  if (cap) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, 0.05, 10), wmat(cap));
    c.rotation.z = Math.PI / 2;
    c.position.x = x + side * 0.015;
    face.add(c);
  }
  return face;
}

// root の子孫のメッシュ list を、root から見た位置のまま材質ごとに1つへまとめて root の直下に置き、元は外す
function mergeInto(root: THREE.Object3D, list: THREE.Mesh[]) {
  if (list.length < 2) return;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const m of list) {
    const g = (m.geometry.index ? m.geometry : m.geometry.toNonIndexed()).clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
    m.parent!.remove(m);
  }
  for (const [mat, geos] of byMat) {
    const indexed = geos.filter((g) => g.index);
    const plain = geos.filter((g) => !g.index);
    for (const set of [indexed, plain]) {
      if (!set.length) continue;
      const merged = set.length === 1 ? set[0] : mergeGeometries(set);
      if (merged) root.add(new THREE.Mesh(merged, mat));
    }
  }
}

// ゼッケン（白丸に数字）のテクスチャ。番号ごとに使い回す
const numberTex = new Map<number, THREE.CanvasTexture>();
function numberTexture(n: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (!numberTex.has(n)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111111';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 32, 35);
    numberTex.set(n, new THREE.CanvasTexture(c));
  }
  return numberTex.get(n)!;
}

// ブースターの取付（ボディ別）。作り込んだボディでは、ブースターをボディの面に沿わせて付け（密着）、
// 作れる所ではブーストしていない間ボディの中へ引っ込める（格納）。位置はボディの形を上下・前後から光線で測って決め、
// ボディの表 design.mount（種類ごと）で足し引き・上書きできる。表の無いボディ（工房の自作ボディ）は従来の位置のまま。
// 数値の基準（deckY からの高さ）: マフラー2本 x±0.22 y0.22 r0.07 長0.5 / 4本 x±0.24 y0.15・0.29 r0.05 長0.42 /
// 大型シングル x0 y0.5 r0.11（冷却フィン r0.16）長0.6 / 2連ポッド 後輪の上 / 4連ポッド y0.62 z-0.72（レール y0.52）。管の根元は z-0.9
export interface MountFit {
  dx: number; dy: number; dz: number; s: number; podX: number | null;
  stow: [number, number] | null; anchor: THREE.Object3D | null;
  pads: [number, number, number, number, number, number][]; // 受け（黒い台座・口金）[x0,x1,y0,y1,z0,z1]
}
function solveMount(design: DesignedBody, kind: string, deckY: number, axles: [number, number][], treadW: number): MountFit {
  const m = design.mount?.[kind] ?? {};
  const fit: MountFit = { dx: 0, dy: 0, dz: 0, s: m.s ?? 1, podX: m.podX ?? null, stow: null, anchor: m.anchor ?? null, pads: [] };
  design.group.updateMatrixWorld(true);
  // 測る相手: ボディの見えている面（エアロ0の状態。可動部も含む。ゼッケンと隠れた支柱は除く）
  const solids: THREE.Mesh[] = [];
  const skip = new Set<THREE.Object3D>();
  for (const g of design.mountIgnore ?? []) g.traverse((o) => skip.add(o));
  design.group.traverseVisible((o) => {
    const me = o as THREE.Mesh;
    if (me.isMesh && !skip.has(me) && !(me.material as THREE.MeshLambertMaterial).map) solids.push(me);
  });
  const ray = new THREE.Raycaster();
  const hit = (o: THREE.Vector3, d: THREE.Vector3) => {
    ray.set(o, d);
    ray.far = 8;
    return ray.intersectObjects(solids, false)[0]?.point ?? null;
  };
  // (x,z) の真上から見たボディの上面の高さ（無ければ -Infinity）
  const surf = (x: number, z: number) => hit(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0))?.y ?? -Infinity;
  // 高さ y・横 x の位置で、後ろから見たボディの後ろの面の z（無ければ null）
  const face = (x: number, y: number) => hit(new THREE.Vector3(x, y, -4), new THREE.Vector3(0, 0, 1))?.z ?? null;
  const max = (a: number[]) => Math.max(-Infinity, ...a);
  const auto = m.auto !== false;
  if (auto && (kind === 'twin' || kind === 'quad')) {
    const pipes: [number, number, number][] = kind === 'twin' ? [[-0.22, 0.22, 0.095], [0.22, 0.22, 0.095]] : [-0.24, 0.24].flatMap((x) => [[x, 0.15, 0.068], [x, 0.29, 0.068]] as [number, number, number][]);
    const len = kind === 'twin' ? 0.5 : 0.42;
    const yOff = m.dy ?? 0;
    const fs = pipes.map(([x, y]) => face(x, deckY + y + yOff)).filter((z): z is number => z !== null && z > -1.3);
    if (fs.length === pipes.length) {
      const f = Math.max(...fs);
      fit.dz = f + 0.05 + 0.9;
      const deep = f + len;
      const covered = pipes.every(([x, y, r]) => surf(x, deep) > deckY + y + yOff + r && surf(x, f + 0.06) > deckY + y + yOff + r);
      if (covered && !m.noStow) fit.stow = [0, len + 0.03];
      // 口金: 管の出口のまわりの黒い板（ボディの後ろの面に貼る）
      const ys = pipes.map(([, y]) => deckY + y + yOff);
      const r = pipes[0][2];
      fit.pads.push([-Math.abs(pipes[0][0]) - r * 1.25, Math.abs(pipes[0][0]) + r * 1.25, Math.min(...ys) - r * 1.25, Math.max(...ys) + r * 1.25, f - 0.012, f + 0.02]);
    }
  } else if (auto && kind === 'single') {
    fit.dz = 0.28;
    const zs = [-0.64, -0.74, -0.84, -0.94];
    const top = max([-0.12, 0, 0.12].flatMap((x) => zs.map((z) => surf(x, z))));
    if (top > -1) {
      fit.dy = top - (deckY + 0.34) + 0.005;
      const low = Math.min(...zs.map((z) => surf(0, z)).filter((y) => y > -1));
      const bottom = deckY + 0.5 - 0.11 + fit.dy + (m.dy ?? 0);
      if (bottom - low > 0.01) fit.pads.push([-0.075, 0.075, low - 0.02, bottom + 0.02, -0.95, -0.66]);
    }
  } else if (auto && kind === 'pod2') {
    const rearAxle = Math.min(...axles.map(([z]) => z));
    const rearR = axles.find(([z]) => z === rearAxle)![1];
    const podR = 0.11;
    const px = fit.podX ?? 0.45 + treadW / 2 + 0.03;
    const z = rearAxle + 0.05;
    const y0 = rearR * 2 + podR + 0.05 - podR; // ポッドの底（もとの位置）
    const over = px + podR > 0.46 && px - podR < 0.48 + treadW;
    const tire = over ? max(axles.filter(([za, r]) => Math.abs(za - z) < r + 0.2).map(([, r]) => 2 * r)) + 0.055 : -Infinity; // 台座がタイヤに触れない高さ
    const top = max([px - 0.08, px, px + 0.08].flatMap((x) => [z - 0.18, z, z + 0.18].map((zz) => surf(x, zz))));
    const bottom = Math.max(top, tire);
    if (bottom > -1) {
      fit.dy = bottom - y0;
      const low = surf(px, z);
      if (low > -1 && bottom - low > 0.01) for (const sx of [-1, 1]) fit.pads.push([sx * px - podR * 0.6, sx * px + podR * 0.6, low - 0.02, bottom + 0.015, z - 0.14, z + 0.12]);
    }
  } else if (auto && kind === 'pod4') {
    const top = max([-0.4, -0.3, -0.15, 0, 0.15, 0.3, 0.4].flatMap((x) => [-0.93, -0.81, -0.69, -0.57].map((z) => surf(x, z))));
    if (top > -1) fit.dy = top - (deckY + 0.495);
  }
  fit.dx += m.dx ?? 0;
  fit.dy += m.dy ?? 0;
  fit.dz += m.dz ?? 0;
  if (m.stow !== undefined) fit.stow = m.stow;
  if (m.pads) fit.pads = m.pads;
  return fit;
}

// lookOverride: デザイン見本の id（src/look.ts）。渡したときは装着ボディの代わりにその形を見せる（見た目だけ。性能は build のまま）
// ブースターの色枠（部品ごとに変えられる。後で工房の画面につなぐ）。渡さなかった枠は既定値（boosterColorsFor）
//   shell=外装のベース色 / band=外装の帯（サブ色） / line=細い差し線 / nozzle=ノズルリング / arm=腕と台座
export interface BoosterColors { shell: number; band: number; line: number; nozzle: number; arm: number }
// 既定値: 外装は白、帯は車体色（白と車体色の塗り分け）、細い差し線はランク色（N灰/T水色/H紫/R橙/EX金。ランクの目印を保つ）、
// ノズルリングは金、腕と台座は黒
export function boosterColorsFor(bodyColor: number, tier = 'N', over: Partial<BoosterColors> = {}): BoosterColors {
  const RANK: Record<string, number> = { N: 0x7a7f88, T: 0x5fc4ff, H: 0xb35cff, R: 0xff7a1a, EX: 0xffd23a };
  return { shell: 0xe6e9ee, band: bodyColor, line: RANK[tier] ?? RANK.N, nozzle: 0xd4a640, arm: 0x2a2d33, ...over };
}

export function buildCarModel(color: number, build: Build, number = 1, lookOverride: string | null = null, boosterColors: Partial<BoosterColors> = {}) {
  const group = new THREE.Group();
  const axles = axlesOf(build);
  const tireR = Math.max(...axles.map(([, r]) => r)); // 一番大きいタイヤ（車高の基準）
  const treadW = TREAD_W[build.tread] ?? 0.24;
  const deckY = tireR * 0.75;

  // シャーシ: ラジコンのフレームのような平たい板と左右のレール
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 2.3), frameMat);
  plate.position.y = deckY;
  group.add(plate);
  for (const side of [-1, 1]) {
    const zs = axles.map(([z]) => z);
    const front = Math.max(1.05, Math.max(...zs) + 0.2);
    const back = Math.min(-1.05, Math.min(...zs) - 0.2);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, front - back), frameMat);
    rail.position.set(side * 0.44, deckY + 0.08, (front + back) / 2);
    group.add(rail);
  }

  // タイヤとホイール（走行中に回す）
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xd9d9d9 });
  const grooveMat = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });
  const wheels: { mesh: THREE.Group; r: number }[] = [];
  for (const [z, r] of axles) {
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, treadW, 14), tireMat);
      tire.rotation.z = Math.PI / 2;
      wheel.add(tire, makeWheelFace(build, r, treadW, side, hubMat));
      // トレッドの溝: ナロー1本・標準2本・ワイド3本で幅の違いを見せる
      const grooves = treadW < 0.2 ? 1 : treadW < 0.3 ? 2 : 3;
      for (let g = 0; g < grooves; g++) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.004, r + 0.004, 0.02, 14), grooveMat);
        ring.rotation.z = Math.PI / 2;
        ring.position.x = ((g + 1) / (grooves + 1) - 0.5) * treadW;
        wheel.add(ring);
      }
      wheel.position.set(side * (0.45 + treadW / 2 + 0.03), r, z);
      group.add(wheel);
      wheels.push({ mesh: wheel, r });
    }
  }

  // モーター: 銀色の缶。搭載位置と向きは駆動方式（シャーシ）で決まる:
  // frontT=フロント横置き(前車軸の上) frontL=フロント縦置き center=センター縦置き midL=ミッド縦置き(後車軸の前) rearT=リヤ横置き(後車軸の上)
  // 缶の帯の色でメーカー（ミドリ電工=緑、イワオ重工=赤、ハヤテ技研=青）、エンドキャップの色でランク
  const motorPart = part('motor', build.motor) as { maker?: string; tier?: string };
  const MAKER_COLOR: Record<string, number> = { ミドリ電工: 0x2fb35a, イワオ重工: 0xd23c3c, ハヤテ技研: 0x2f7fe0 };
  const RANK_COLOR: Record<string, number> = { N: 0x7a7f88, T: 0x5fc4ff, H: 0xb35cff, R: 0xff7a1a, EX: 0xffd23a };
  const motorG = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), new THREE.MeshLambertMaterial({ color: 0xbfc6cf }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.16, 12), new THREE.MeshLambertMaterial({ color: MAKER_COLOR[motorPart.maker ?? ''] ?? 0x888888 }));
  const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12), new THREE.MeshLambertMaterial({ color: RANK_COLOR[motorPart.tier ?? 'N'] ?? 0x7a7f88 }));
  endCap.position.y = -0.23;
  motorG.add(can, band, endCap);
  const ch = part('chassis', build.chassis) as { motor?: string; drive?: string };
  const mount = ch.motor ?? 'center';
  const zs = axles.map(([z]) => z).sort((x, y) => y - x);
  const frontZ = zs[0];
  const rearZ = zs[zs.length - 1];
  // 後ろがタンデム2軸なら、その2軸の間を「後車軸」とみなす
  const rearPair = zs.length > 2 && zs[zs.length - 2] < 0 ? (rearZ + zs[zs.length - 2]) / 2 : rearZ;
  const transverse = mount === 'frontT' || mount === 'rearT';
  const motorZ = { frontT: frontZ, frontL: frontZ - 0.32, center: (frontZ + rearZ) / 2, midL: rearZ + 0.34, rearT: rearPair }[mount] ?? 0;
  if (transverse) motorG.rotation.z = Math.PI / 2;
  else motorG.rotation.x = Math.PI / 2;
  motorG.position.set(0, deckY + 0.2, motorZ);
  group.add(motorG);

  // 駆動の見える化: 駆動する車軸にギヤボックス、モーターから駆動軸まではプロペラシャフト
  const drive = ch.drive ?? 'A';
  const driven = drive === 'F' ? [frontZ] : drive === 'R' ? [rearZ] : zs;
  const gearMat = new THREE.MeshLambertMaterial({ color: 0x4a4f58 });
  for (const z of driven) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.18), gearMat);
    box.position.set(transverse && Math.abs(z - motorZ) < 0.01 ? 0.3 : 0, deckY + 0.1, z);
    group.add(box);
  }
  const span = [...driven, ...(transverse ? [] : [motorZ])];
  const z0 = Math.min(...span);
  const z1 = Math.max(...span);
  if (z1 - z0 > 0.05) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, z1 - z0, 8), new THREE.MeshLambertMaterial({ color: 0xd9dde3 }));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, deckY + 0.08, (z0 + z1) / 2);
    group.add(shaft);
  }

  // ガイドローラー: 前後4か所。外側の端（壁に触れる点）は ROLLER_REACH にそろえ、車体で一番外に出す。
  // 種類は色と厚みで見分ける: 樹脂=白の厚い1枚、低摩擦=水色の厚い1枚、ベアリング=銀の薄い1枚＋黒い軸受け、
  // ダブル=銀の薄い2段、低摩擦ベアリング=金の薄い1枚、超低摩擦=紫アルマイトの薄い2段＋銀のフランジ
  const ROLLER: Record<string, { color: number; r: number; h: number; stack: number; ring?: number; flange?: number }> = {
    plastic: { color: 0xf2f2f2, r: 0.12, h: 0.13, stack: 1 },
    lowFriction: { color: 0x8fd8ff, r: 0.12, h: 0.13, stack: 1 },
    bearing: { color: 0xc9ced6, r: 0.14, h: 0.07, stack: 1, ring: 0x222222 },
    doubleBearing: { color: 0xc9ced6, r: 0.14, h: 0.06, stack: 2, ring: 0x222222 },
    lowFrictionBearing: { color: 0xf2c230, r: 0.15, h: 0.06, stack: 1, ring: 0x222222, flange: 0xffe27a },
    superLowFriction: { color: 0x9a5cff, r: 0.16, h: 0.05, stack: 2, ring: 0xd9d9d9, flange: 0xe6e6e6 },
  };
  const rollerMats: THREE.MeshLambertMaterial[] = [];
  // ローラーは一番前・一番後ろのタイヤより外に置く（6輪・8輪でタイヤに埋まらないように）
  const rollerZF = Math.max(1.25, Math.max(...axles.map(([z, r]) => z + r)) + 0.16);
  const rollerZR = Math.min(-1.2, Math.min(...axles.map(([z, r]) => z - r)) - 0.16);
  const stayMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  for (const [key, z] of [['rollerF', rollerZF], ['rollerR', rollerZR]] as const) {
    const st = ROLLER[build[key]] ?? ROLLER.plastic;
    const mat = new THREE.MeshLambertMaterial({ color: st.color, emissive: 0x000000 });
    rollerMats.push(mat);
    const x = ROLLER_REACH - st.r;
    // ローラーステー: 車体から左右のローラー軸まで渡す板
    const stay = new THREE.Mesh(new THREE.BoxGeometry(x * 2 + 0.12, 0.035, 0.16), stayMat);
    stay.position.set(0, deckY - 0.06, z);
    group.add(stay);
    for (const side of [-1, 1]) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 6), wmat(0x9aa0a8));
      shaft.position.set(side * x, deckY + 0.04, z);
      group.add(shaft);
      for (let i = 0; i < st.stack; i++) {
        const y = deckY + (st.stack === 2 ? (i - 0.5) * (st.h + 0.03) : 0);
        const r = new THREE.Mesh(new THREE.CylinderGeometry(st.r, st.r, st.h, 16), mat);
        r.position.set(side * x, y, z);
        group.add(r);
        if (st.ring) {
          const ring = new THREE.Mesh(new THREE.CylinderGeometry(st.r * 0.45, st.r * 0.45, st.h + 0.01, 10), wmat(st.ring));
          ring.position.copy(r.position);
          group.add(ring);
        }
        if (st.flange) {
          const fl = new THREE.Mesh(new THREE.TorusGeometry(st.r * 0.98, 0.012, 4, 20), wmat(st.flange));
          fl.rotation.x = Math.PI / 2;
          fl.position.set(side * x, y + st.h / 2, z);
          group.add(fl);
        }
      }
    }
  }
  // 壁に当たったときの発光は前後まとめて切り替える
  const rollerMat = { emissive: { setHex: (h: number) => rollerMats.forEach((m) => m.emissive.setHex(h)) } };

  // ボディ: 既製の6ボディは carBodies.ts の作り込んだ形（面を別々に組んだローポリ）。
  // 自作ボディ（ボディ工房）は下の従来の作り方（横から見た形を押し出したシェル＋飾り）のまま
  const lookId = lookOverride && isDesignedBody(lookOverride) ? lookOverride : null;
  const custom = lookId ? undefined : customBodyData.get(build.body);
  const shapeId = lookId ?? build.body; // 形を作るボディ（見本を選んでいなければ装着ボディ）
  const transform = isTransformBuild(build);
  const accent = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0x5a1010, emissive: 0x330000 });
  const boosterKind = (part('booster', build.booster) as { boostKind?: string }).boostKind ?? 'twin';
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const numTex = numberTexture(number);
  const design = !custom && isDesignedBody(shapeId)
    ? buildDesignedBody(shapeId, {
        color, axles, treadW, deckY, tireR, boostKind: boosterKind, bodyMat, accent, tailMat,
        numberMat: numTex ? new THREE.MeshLambertMaterial({ map: numTex, transparent: true }) : null,
      })
    : null;
  // 作り込んだボディはモーターまで覆うので、ボディを見せている間はモーターを隠す（中身表示では出す）
  if (design) {
    group.add(design.group);
    motorG.visible = false;
  }
  const fit = design ? solveMount(design, boosterKind, deckY, axles, treadW) : null;
  // 受け（台座・口金）はシャーシと同じ材質で作り、下の「動かない部品の結合」に入れる（動く部品に付くときは別）
  if (fit?.pads.length) {
    const pads = fit.pads.map(([x0, x1, y0, y1, z0, z1]) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    const padMesh = new THREE.Mesh(mergeGeometries(pads)!, frameMat);
    if (fit.anchor) {
      fit.anchor.updateWorldMatrix(true, false);
      padMesh.applyMatrix4(fit.anchor.matrixWorld.clone().invert());
      fit.anchor.add(padMesh);
    } else group.add(padMesh);
  }
  const legacy = new THREE.Group();
  const shape = new THREE.Shape();
  const look = bodyLook(build.body);
  const profile = look.profile;
  shape.moveTo(profile[0][0], profile[0][1]);
  for (const [z, y] of profile.slice(1)) shape.lineTo(z, y);
  const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: look.width, bevelEnabled: false });
  shellGeo.rotateY(-Math.PI / 2);
  shellGeo.translate(look.width / 2, 0, 0);
  const shell = new THREE.Mesh(shellGeo, bodyMat);
  // EX技ごとの飾り（フィン、スカート、カナード）。ボディと一緒に外せる
  const extras = new THREE.Group();
  extras.position.y = deckY + 0.04;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = bodyMat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    extras.add(m);
    return m;
  };
  for (const side of [-1, 1]) {
    if (look.fenders) box(0.22, 0.26, 0.6, side * (look.width / 2 + 0.05), 0.15, -0.7);
    if (look.fins) box(0.05, 0.42, 0.45, side * 0.3, 0.6, -0.85, accent);
    if (look.skirts) box(0.05, 0.28, 1.7, side * (look.width / 2 + 0.03), 0.12, 0, accent);
    if (look.canards) box(0.35, 0.03, 0.22, side * 0.45, 0.14, 1.0, accent);
  }
  if (look.stripe) box(0.16, 0.01, 1.2, 0, look.stripe, 0.55, accent);
  // テールランプ: 後ろから見える横一文字のライト。ブースト中は差し色と一緒に光る
  shellGeo.computeBoundingBox();
  box(look.width * 0.62, 0.06, 0.03, 0, 0.15, shellGeo.boundingBox!.min.z - 0.015, tailMat);
  // 塗装（60-30-10）: 車体色が主、下まわりは同じ色を暗くした帯、差し色は白。
  // 帯の形はボディの系統で変える（直線型=細い2本、流線型=斜めの流れ、バランス=太い1本）
  const line = (part('body', build.body) as { line?: string }).line ?? 'balance';
  const darkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.45) });
  const halfW = look.width / 2;
  for (const side of [-1, 1]) {
    box(0.02, 0.1, 2.0, side * (halfW + 0.01), 0.05, 0, darkMat);
    if (line === 'edge') {
      box(0.02, 0.025, 1.4, side * (halfW + 0.012), 0.16, 0.1, accent);
      box(0.02, 0.025, 1.4, side * (halfW + 0.012), 0.2, 0.1, accent);
    } else if (line === 'stream') {
      const sw = box(0.02, 0.05, 1.3, side * (halfW + 0.012), 0.2, 0.05, accent);
      sw.rotation.x = -0.12;
    } else {
      box(0.02, 0.07, 1.5, side * (halfW + 0.012), 0.17, 0.05, accent);
    }
    // ゼッケン
    const tex = design ? null : numTex;
    if (tex) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshLambertMaterial({ map: tex, transparent: true }));
      plate.position.set(side * (halfW + 0.03), 0.24, -0.45);
      plate.rotation.y = side * Math.PI / 2;
      extras.add(plate);
    }
  }
  // タイヤハウス（前後の車軸ごと）。メインボディとは別部品として作り、将来の組み立てで差し替えられるようにする
  if (look.cowl === 'half' || look.cowl === 'full') {
    const wx = 0.45 + treadW / 2 + 0.03;
    const top = tireR * 2 + 0.02 - (deckY + 0.04);
    for (const side of [-1, 1]) {
      for (const [z, r] of axles) {
        const len = r * 2 + 0.16;
        if (look.cowl === 'full') {
          // 外側の板でタイヤを丸ごと隠す
          box(treadW + 0.1, top + deckY - 0.02, len, side * wx, (top - deckY) / 2 + 0.01, z);
        } else {
          // 上半分だけ覆い、下は見せる（低く構えた見た目）
          box(treadW + 0.1, 0.08, len, side * wx, r * 2 + 0.06 - (deckY + 0.04), z);
          box(0.04, r + 0.04, len, side * (wx + treadW / 2 + 0.05), r * 1.5 + 0.04 - (deckY + 0.04), z, accent);
        }
      }
      // 前後のハウスをつなぐサイドポッド
      const zs = axles.map(([z]) => z);
      const span = Math.max(...zs) - Math.min(...zs);
      const h = look.cowl === 'full' ? top * 0.55 : 0.12;
      box(treadW + 0.06, h, span, side * wx, look.cowl === 'full' ? top * 0.275 - deckY / 2 : 0.04, (Math.max(...zs) + Math.min(...zs)) / 2);
    }
  }
  shell.position.y = deckY + 0.04;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0x1b2a3a }));
  canopy.position.set(0, deckY + 0.5, -0.15);
  legacy.add(extras, shell, canopy);
  if (!design) group.add(legacy);
  // 自作ボディ（ボディ工房で作ったもの）: 標準のシェル・飾り・キャノピーを隠して、ブロックの形に差し替える
  // 変形部位は、変形できるシャーシのときだけ動く部品として別に作る（それ以外は普通の部位と同じく固定）
  const moving = custom && transform ? aeroSets(custom.items) : [];
  const customGroup = custom
    ? meshEntries(custom.items.filter((it) => !(transform && isAeroKind(it.kind))).flatMap((it) => itemEntries(it)), color, accent)
    : null;
  const movers = moving.map((set) => {
    const before = meshEntries(set.before, color, accent);
    const after = meshEntries(set.after, color, accent);
    for (const g of [before, after]) g.matrixAutoUpdate = false;
    customGroup!.add(before, after);
    return { set, before, after };
  });
  if (customGroup) {
    legacy.visible = false;
    group.add(customGroup);
  }

  // バンパー（前後）: FRPは白、カーボンは黒、ハードカーボンは黒＋金の縁
  const BUMPER: Record<string, number> = { frp: 0xeeeeee, carbon: 0x222222, hardCarbon: 0x333333 };
  for (const [key, z] of [['bumperF', rollerZF + 0.07], ['bumperR', rollerZR - 0.08]] as const) {
    const id = build[key];
    if (!BUMPER[id]) continue;
    const bar = new THREE.Mesh(new THREE.BoxGeometry((ROLLER_REACH - 0.14) * 2, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: BUMPER[id], emissive: id === 'hardCarbon' ? 0x332200 : 0 }));
    bar.position.set(0, deckY + 0.06, z);
    group.add(bar);
  }
  // カナード（前後）: ノーズ横とテール横の小さな翼。ワイドは大きめ。変形マシンには付かない
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x3a3f48 });
  const CANARD: Record<string, number> = { small: 1, large: 1.4 };
  for (const [id, z, y] of [[build.wingF, 1.0, 0.16], [build.wingR, -0.9, 0.3]] as [string, number, number][]) {
    const k = transform ? 0 : CANARD[id];
    if (!k) continue;
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.32 * k, 0.03, 0.24 * k), wingMat);
      // 作り込んだボディのフェンダーに埋まらないよう、フェンダーの上に出す
      c.position.set(side * (0.52 + 0.1 * k), Math.max(deckY + y, design?.canardY(z) ?? 0), z);
      c.rotation.set(0, side * 0.35, side * 0.2);
      group.add(c);
    }
  }
  // 変形翼: サーキットモードでは前の翼はノーズ下に隠れ、リヤは左右独立のウイング。
  // エアロモードで前の翼がせり出し、リヤの左右ウイングは外側の付け根を軸に90度ボディ側へ倒れてカナード状になる
  const aeroMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, emissive: 0x000000 });
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.32), aeroMat);
  const rearHalves: { pivot: THREE.Group; side: number }[] = [];
  const aeroParts: THREE.Object3D[] = [frontWing]; // 標準の変形翼（ボディ工房では外して見せる）
  // 自作の変形部位があれば、その位置の標準の翼は付けない
  const customFront = moving.some((m) => m.kind === 'aeroFront');
  const customRear = moving.some((m) => m.kind === 'aeroRear');
  // 作り込んだボディは車ごとの可動部（carBodies.ts）で変形するので、標準の変形翼は付けない
  if (transform && !design) {
    frontWing.position.set(0, deckY + 0.1, 0.7);
    if (!customFront) group.add(frontWing);
    for (const side of customRear ? [] : [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.copy(rearPivot(side, deckY));
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.36), aeroMat);
      plate.position.x = -side * 0.31;
      pivot.add(plate);
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.12), wingMat);
      stay.position.set(side * 0.62, deckY + 0.6, -0.95);
      group.add(pivot, stay);
      rearHalves.push({ pivot, side });
      aeroParts.push(pivot, stay);
    }
  }
  const setAero = (a: number) => {
    if (!transform) return;
    if (design) {
      design.setAero(a);
      return;
    }
    frontWing.position.z = 0.7 + 0.65 * a;
    frontWing.scale.x = 0.5 + 0.5 * a;
    frontWing.visible = a > 0.02;
    for (const { pivot, side } of rearHalves) pivot.rotation.z = side * (Math.PI / 2) * a;
    aeroMat.emissive.setHex(a > 0.5 ? 0x1a8fff : 0x000000);
    for (const { set, before, after } of movers) {
      const m = aeroMatrices(set, a, deckY);
      before.matrix.copy(m.before);
      after.matrix.copy(m.after);
      before.visible = m.kb > 0.01;
      after.visible = m.ka > 0.01;
    }
  };
  setAero(0);
  // マスダンパー: 重いほど大きい金色の円柱。EX提灯はぶら下がる形
  const DAMPER: Record<string, number> = { light: 0.08, medium: 0.1, heavy: 0.12, superHeavy: 0.14, chochin: 0.12 };
  const damperMat = new THREE.MeshLambertMaterial({ color: 0xd9a826 });
  for (const [key, z] of [['damperF', 1.0], ['damperR', -1.05]] as const) {
    const r = DAMPER[build[key]];
    if (!r) continue;
    for (const side of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 10), damperMat);
      d.position.set(side * 0.38, deckY + (build[key] === 'chochin' ? 0.62 : 0.12), z);
      group.add(d);
    }
  }

  // ブースター: 種類で形、ランクで先端リングの色（N灰/T水色/H紫/R橙/EX金）
  const boosterFrom = group.children.length; // ボディ工房で「ブーストの取付位置」を示すために、ここから先の部品を覚えておく
  const boosterPart = part('booster', build.booster) as { boostKind?: string; tier?: string };
  const kind = boosterPart.boostKind ?? 'twin';
  const bc = boosterColorsFor(color, boosterPart.tier ?? 'N', boosterColors);
  const tipMat = wmat(bc.line); // 細い差し線（既定はランク色）
  const nozzleMat = new THREE.MeshLambertMaterial({ color: bc.nozzle, emissive: new THREE.Color(bc.nozzle).multiplyScalar(0.18) });
  const armMat = wmat(bc.arm);
  const flameMat = () => new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const pipeMat = wmat(0xb4bac2);
  const burntMat = wmat(0x6a6fb0); // 焼け色（チタン風の青紫）
  const darkMat2 = wmat(0x2a2d33);
  const holeMat = wmat(0x0c0d10); // ノズル・吸気口の奥
  const backZ = -1.15;
  const mufflers: THREE.Mesh[] = [];
  const nozzles: Nozzle[] = [];
  // 後ろ向きの円柱（z方向）を置く
  const tube = (r1: number, r2: number, len: number, x: number, y: number, z: number, mat: THREE.Material, seg = 12) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, deckY + y, z);
    group.add(m);
    return m;
  };
  const flameAt = (x: number, y: number, z: number, r: number) => {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, 0.45 + r * 3, 8), flameMat());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, deckY + y, z - 0.25 - r * 1.5);
    // 内側の芯（1段目=黄色、2段目=白）。外炎と一緒に伸び縮みする
    const core = new THREE.Mesh(new THREE.ConeGeometry(r * 0.7, 0.3 + r * 2, 8), flameMat());
    core.position.y = -0.08;
    flame.add(core);
    group.add(flame);
    mufflers.push(flame);
    // ノズルの口の位置と向き（-z）。ブースターの展開と一緒に動き、新しい噴射演出（boostFx.ts）がここから出る
    const anchor = new THREE.Object3D();
    anchor.position.set(x, deckY + y, z);
    group.add(anchor);
    nozzles.push({ anchor, r });
  };
  // 絞り（アイリス）: 噴射口のまわりに花びら状の板を並べ、Wブーストの2段目で内側へ閉じる（ラムエア風）
  const irisMat = wmat(0x8a909a);
  const irises: { petals: THREE.Mesh[]; r: number }[] = [];
  const iris = (x: number, y: number, z: number, r: number) => {
    const g = new THREE.Group();
    g.position.set(x, deckY + y, z);
    const petals: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / 8) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.BoxGeometry(r * 0.85, r * 0.5, 0.015), irisMat);
      pivot.add(petal);
      g.add(pivot);
      petals.push(petal);
    }
    g.visible = false;
    group.add(g);
    irises.push({ petals, r });
  };
  // マフラー1本: 根元の銀パイプ → 焼け色の中間 → 広がった先端 → ランク色のリング
  const pipe = (x: number, y: number, r: number, len: number) => {
    const z0 = backZ + 0.25;
    tube(r, r, len * 0.55, x, y, z0 - len * 0.275, pipeMat);
    tube(r, r * 1.05, len * 0.3, x, y, z0 - len * 0.7, burntMat);
    tube(r * 1.05, r * 1.35, len * 0.15, x, y, z0 - len * 0.925, pipeMat);
    tube(r * 1.06, r * 1.06, 0.03, x, y, z0 - len * 0.5, tipMat); // 細い差し線（ランク色）
    tube(r * 1.2, r * 0.8, 0.06, x, y, z0 - len + 0.03, holeMat); // 口の奥
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.35, 0.018, 6, 14), nozzleMat);
    ring.position.set(x, deckY + y, z0 - len);
    group.add(ring);
    iris(x, y, z0 - len - 0.01, r * 1.35);
    flameAt(x, y, z0 - len, r);
  };
  if (kind === 'twin') {
    for (const x of [-0.22, 0.22]) pipe(x, 0.22, 0.07, 0.5);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.08), armMat);
    bracket.position.set(0, deckY + 0.22, backZ + 0.12);
    group.add(bracket);
  } else if (kind === 'quad') {
    // 2段×2列。前に集合部（コレクター）
    for (const x of [-0.24, 0.24]) for (const y of [0.15, 0.29]) pipe(x, y, 0.05, 0.42);
    const collector = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.26, 0.16), armMat);
    collector.position.set(0, deckY + 0.22, backZ + 0.3);
    group.add(collector);
  } else if (kind === 'single') {
    // 大きな1本を背負う。冷却フィンつき
    pipe(0, 0.5, 0.11, 0.6);
    for (let i = 0; i < 3; i++) {
      tube(0.16, 0.16, 0.025, 0, 0.5, backZ + 0.12 - i * 0.1, armMat, 16);
    }
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.26), armMat);
    mount.position.set(0, deckY + 0.32, backZ + 0.05);
    group.add(mount);
  }
  // ブーストポッド（可動式）: 台座＋関節つきの腕（前後2本の平行リンク）＋ポッド本体＋上のカバー（小翼）。
  // ふだんは腕が寝てボディの背中に沿って伏せ、ブーストで腕が起きてポッドが持ち上がり、上のカバーが開く。
  // 本体は外装（白）と帯（車体色）の塗り分け、前に奥まった吸気口とファン、後ろに奥行きのあるノズルと金のリング
  const podMat = wmat(bc.shell);
  const bandMat = wmat(bc.band);
  // 2連ポッドは後輪の真上に左右へ張り出して置く（ボディの表で横位置・高さを変えられる）。4連は車体の上にレールで並べる
  const rearAxle = Math.min(...axles.map(([z]) => z));
  const rearR = (axles.find(([z]) => z === rearAxle) ?? [0, tireR])[1];
  const podR = kind === 'pod2' ? 0.11 : 0.085;
  const podWx = fit?.podX ?? 0.45 + treadW / 2 + 0.03;
  const PODS: Record<string, [number, number, number][]> = {
    pod2: [-1, 1].map((side) => [side * podWx, rearR * 2 + podR + 0.05 - deckY, rearAxle + 0.05] as [number, number, number]),
    pod4: [-0.36, -0.12, 0.12, 0.36].map((x) => [x, 0.62, -0.72] as [number, number, number]),
  };
  const podX = (PODS[kind] ?? []).map(([x]) => x);
  const hasPods = podX.length > 0;
  if (kind === 'pod4') {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.36), armMat);
    rail.position.set(0, deckY + 0.52, -0.75);
    group.add(rail);
  }
  // ポッド1基ごとに「本体（持ち上がる）」と「後ろの筒（延びる）」をまとめ、段階ごとに動かす
  //   1段目: 腕が起きて持ち上がり（高さはここで決まる）、上のカバーが開く  2段目: 高さはそのまま、後ろの筒が延びる
  //   3段目: 持ち上げも延長もせず、カナードが開く
  interface PodRig { body: THREE.Group; tail: THREE.Group; baseY: number; struts: THREE.Group[]; intakes: { pivot: THREE.Group; side: number }[]; canards: { pivot: THREE.Group; side: number }[] }
  const podRigs: PodRig[] = [];
  const ARM = 0.22; // 腕の長さ（持ち上げ量 FX.pod.lift より長く）
  const podArms: THREE.Group[] = [];
  const podPads: THREE.Mesh[] = [];
  const gather = (into: THREE.Group, from: number) => {
    for (const o of group.children.slice(from)) into.add(o);
  };
  for (const [x, y, z] of PODS[kind] ?? []) {
    const body = new THREE.Group();
    const tail = new THREE.Group();
    let from = group.children.length;
    // 外装: 前の吸気口の縁（白）→ 帯（車体色）→ 白 → 細い差し線 → 白
    tube(podR * 0.96, podR, 0.06, x, y, z + 0.19, podMat, 12);
    tube(podR, podR * 1.03, 0.14, x, y, z + 0.09, bandMat, 12);
    tube(podR * 1.03, podR * 1.08, 0.12, x, y, z - 0.04, podMat, 12);
    tube(podR * 1.09, podR * 1.09, 0.025, x, y, z - 0.105, tipMat, 12);
    tube(podR * 1.08, podR * 1.1, 0.09, x, y, z - 0.16, podMat, 12);
    // 吸気口: 奥へすぼまる黒い口、少し奥にファン（3枚羽根）と中心の円錐
    tube(podR * 0.82, podR * 0.6, 0.08, x, y, z + 0.18, holeMat, 10);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(podR * 0.62, 10), darkMat2);
    fan.position.set(x, deckY + y, z + 0.145);
    group.add(fan);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(podR * 1.15, 0.018, 0.012), pipeMat);
      blade.position.set(x, deckY + y, z + 0.15);
      blade.rotation.z = (i / 3) * Math.PI + 0.3;
      group.add(blade);
    }
    const spin = new THREE.Mesh(new THREE.ConeGeometry(podR * 0.22, podR * 0.5, 8), pipeMat);
    spin.rotation.x = Math.PI / 2;
    spin.position.set(x, deckY + y, z + 0.17);
    group.add(spin);
    // 2段目で見える内筒（ふだんは本体の中に隠れている）
    tube(podR * 0.82, podR * 0.82, 0.3, x, y, z - 0.2, burntMat, 12);
    // 腕の付け根の受け（ポッドの下の黒い板。腕の先の関節が付く）
    const keel = new THREE.Mesh(new THREE.BoxGeometry(podR * 0.9, 0.03, 0.34), armMat);
    keel.position.set(x, deckY + y - podR * 0.98, z);
    group.add(keel);
    // 2連ポッドを外へ張り出すときは、車体から横の腕も伸ばす
    if (kind === 'pod2' && Math.abs(x) - 0.25 > 0.06) {
      const reach = Math.abs(x) - 0.25;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(reach, 0.05, 0.18), armMat);
      arm.position.set(Math.sign(x) * (0.25 + reach / 2), deckY + y - podR * 0.7, z);
      group.add(arm);
    }
    gather(body, from);
    // 後ろの筒: 絞ったノズル（中は奥へすぼまる黒い穴）・金のリング・絞り・炎。2段目で後ろへ延びる
    from = group.children.length;
    tube(podR * 1.1, podR * 0.78, 0.16, x, y, z - 0.28, darkMat2, 12);
    tube(podR * 0.7, podR * 0.36, 0.14, x, y, z - 0.3, holeMat, 8);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(podR * 0.76, 0.022, 5, 12), nozzleMat);
    ring.position.set(x, deckY + y, z - 0.37);
    group.add(ring);
    iris(x, y, z - 0.375, podR * 0.75);
    flameAt(x, y, z - 0.37, podR * 0.7);
    gather(tail, from);
    body.add(tail);
    // 上のカバー（小翼）: 左右2枚。外側の縁を軸に開き、開くと小さな翼になる。閉じているときは上面に沿う
    const intakes: { pivot: THREE.Group; side: number }[] = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x + side * podR * 0.92, deckY + y + podR * 0.42, z - 0.02);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(podR * 0.95, 0.016, 0.24), bandMat);
      lid.position.set(-side * podR * 0.45, podR * 0.5, 0);
      lid.rotation.z = side * 0.42;
      pivot.add(lid);
      body.add(pivot);
      intakes.push({ pivot, side });
    }
    // 3段目で開くカナード（外側へ水平に開く小さな翼）
    const canards: { pivot: THREE.Group; side: number }[] = [];
    const sides = kind === 'pod2' ? [Math.sign(x)] : x === Math.min(...podX) ? [-1] : x === Math.max(...podX) ? [1] : [];
    for (const side of sides) {
      const pivot = new THREE.Group();
      pivot.position.set(x + side * podR, deckY + y, z + 0.12);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.34), tipMat);
      wing.position.set(side * 0.035, 0, -0.17);
      pivot.add(wing);
      pivot.visible = false;
      body.add(pivot);
      canards.push({ pivot, side });
    }
    group.add(body);
    // 台座（ボディ側に固定）と、関節つきの腕2本（前後の平行リンク）。腕は台座の後ろの関節から前へ伸び、
    // 寝ているときは台座の上に伏せ、ブーストで起きてポッドを持ち上げる。関節は筒（ナックル）で見せる
    const baseY = deckY + y - podR - 0.03;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(podR * 1.3, 0.03, 0.42), armMat);
    pad.position.set(x, baseY - 0.015, z + 0.02);
    group.add(pad);
    podPads.push(pad);
    // 腕は全ポッドで同じ高さ・前後位置の軸（x 方向）で回るので、前後1本ずつの軸にまとめる
    const struts: THREE.Group[] = [];
    [-0.17, 0.0].forEach((dz, i) => {
      if (!podArms[i]) {
        podArms[i] = new THREE.Group();
        podArms[i].position.set(0, baseY + 0.012, z + dz);
        group.add(podArms[i]);
        struts.push(podArms[i]);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(podR * 0.7, 0.022, ARM), armMat);
      bar.position.set(x, 0, ARM / 2);
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, podR * 0.95, 8), armMat);
      knuckle.rotation.z = Math.PI / 2;
      knuckle.position.x = x;
      const tip = knuckle.clone();
      tip.position.z = ARM;
      podArms[i].add(bar, knuckle, tip);
    });
    podRigs.push({ body, tail, baseY: 0, struts, intakes, canards });
  }
  // 炎・絞りを除いた、ブースターの本体部品
  // 描画回数を増やさない: ブースターの動かない部品を、動きのまとまり（ポッドの本体・後ろの筒）ごとに材質で1つへまとめる
  const flameSet = new Set<THREE.Object3D>(mufflers);
  const meshKids = (g: THREE.Object3D) => g.children.filter((o) => (o as THREE.Mesh).isMesh && !flameSet.has(o)) as THREE.Mesh[];
  // ポッドは全基が同じ量だけ動くので、本体・後ろの筒・腕・台座を全基まとめて1組にする（カバーとカナードは軸が別なので別のまま）
  if (podRigs.length) {
    const [r0, ...rest] = podRigs;
    for (const r of rest) {
      for (const m of meshKids(r.body)) r0.body.add(m);
      for (const m of meshKids(r.tail)) r0.tail.add(m);
    }
    mergeInto(r0.body, meshKids(r0.body));
    mergeInto(r0.tail, meshKids(r0.tail));
    for (const a of podArms) mergeInto(a, meshKids(a));
    mergeInto(group, podPads);
  }
  let irisK = 0;
  const pods: THREE.Mesh[] = [];
  // マフラー型（ポッド以外）の展開: 管が少し後ろへせり出し、左右のブレードが開く（ポッドとは別の機構）
  const mufflerRig = new THREE.Group();
  if (!hasPods) for (const o of group.children.slice(boosterFrom)) mufflerRig.add(o);
  group.add(mufflerRig);
  if (!hasPods) mergeInto(mufflerRig, meshKids(mufflerRig));
  // ボディ別の取付: ブースター一式を mountG（決まった位置・大きさ）→ stowG（格納のための出し入れ）に入れる
  const stowG = new THREE.Group();
  const mountG = new THREE.Group();
  mountG.add(stowG);
  if (fit) {
    for (const o of group.children.slice(boosterFrom)) stowG.add(o);
    const P = new THREE.Vector3(0, deckY + (kind === 'single' ? 0.5 : kind === 'pod4' ? 0.6 : 0.25), kind === 'pod2' ? rearAxle : -1.0);
    mountG.position.set(fit.dx, fit.dy, fit.dz).addScaledVector(P, 1 - fit.s);
    mountG.scale.setScalar(fit.s);
    if (fit.anchor) {
      fit.anchor.updateWorldMatrix(true, false);
      mountG.updateMatrix();
      mountG.matrix.premultiply(fit.anchor.matrixWorld.clone().invert());
      mountG.matrix.decompose(mountG.position, mountG.quaternion, mountG.scale);
      fit.anchor.add(mountG);
    } else group.add(mountG);
  }
  let deployK = 0;
  const applyStow = () => {
    if (!fit?.stow) return;
    const u = 1 - deployK;
    stowG.position.set(0, fit.stow[0] * u, fit.stow[1] * u);
    design?.onDeploy?.(deployK);
  };
  applyStow();
  const bladeMat = wmat(0x2f343d);
  const bladeGlow = new THREE.MeshBasicMaterial({ color: 0xff9a1f });
  const blades: { pivot: THREE.Group; side: number; tier: number }[] = [];
  const addBlade = (side: number, tier: number, y: number, z: number, len: number, w: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.3, Math.max(deckY + y, design?.bladeY ?? 0), z);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, len), bladeMat);
    plate.position.set(side * w * 0.5, 0, -len / 2);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, len * 0.9), bladeGlow);
    edge.position.set(side * w, 0, -len / 2);
    pivot.add(plate, edge);
    pivot.visible = false;
    group.add(pivot);
    blades.push({ pivot, side, tier });
  };
  if (!hasPods) for (const side of [-1, 1]) {
    addBlade(side, 1, 0.3, -0.5, 0.6, 0.16);
    addBlade(side, 3, 0.38, -0.3, 0.5, 0.2);
  }
  // 段階ごとの展開量（0→1、バネの動き）: 1=持ち上げ/せり出し 2=延長 3=吸気口とカナード
  const dep = [0, 0, 0];
  const depV = [0, 0, 0];
  // 噴流のダイヤモンド模様（3段目）: 炎の軸に沿って明るい粒を並べる
  const diamondMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const diamonds: THREE.Mesh[] = [];
  for (const f of mufflers) {
    const r = (f.geometry as THREE.ConeGeometry).parameters.radius;
    for (let i = 0; i < FX.diamonds.count; i++) {
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(r * FX.diamonds.size, 0), diamondMat);
      d.position.copy(f.position);
      d.userData = { z0: f.position.z + 0.2, i };
      d.visible = false;
      f.parent!.add(d);
      diamonds.push(d);
    }
  }
  // チャージ中の円形の稲妻: ブースターを囲む輪。溜まるほど強く、発動の瞬間にもう一段強くなる
  const ringSeg = FX.ring.segments;
  const ringGeo = new THREE.BufferGeometry();
  const ringPos = new Float32Array(ringSeg * 2 * 2 * 3);
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  const ringMatFx = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const chargeRing = new THREE.LineSegments(ringGeo, ringMatFx);
  chargeRing.frustumCulled = false;
  chargeRing.visible = false;
  chargeRing.position.set(0, deckY + 0.35, hasPods ? -0.75 : -1.0);
  group.add(chargeRing);
  let ringTime = -1;
  let firePop = 0;
  let lastLevel = 0;
  let lastTime = 0;
  const redrawRing = (power: number) => {
    let k = 0;
    for (let ring = 0; ring < 2; ring++) {
      const R = FX.ring.radius * (0.55 + 0.25 * ring) * (0.7 + 0.3 * power);
      let px = 0, pz = 0;
      for (let i = 0; i <= ringSeg; i++) {
        const a = (i / ringSeg) * Math.PI * 2;
        const rr = R * (1 + (Math.random() - 0.5) * FX.ring.jitter * power);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (i > 0) {
          ringPos.set([px, (Math.random() - 0.5) * 0.12 * power, pz, x, (Math.random() - 0.5) * 0.12 * power, z], k);
          k += 6;
        }
        px = x;
        pz = z;
      }
    }
    ringGeo.attributes.position.needsUpdate = true;
  };
  // Wブースト2段目の稲妻: 車体のまわりに細いジグザグ線を数本、短い間隔で描き直す
  const BOLTS = 4;
  const SEG = 6;
  const boltGeo = new THREE.BufferGeometry();
  const boltPos = new Float32Array(BOLTS * SEG * 2 * 3);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
  const bolts = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  bolts.visible = false;
  bolts.frustumCulled = false;
  group.add(bolts);
  let boltTime = -1;
  const redrawBolts = () => {
    let k = 0;
    for (let b = 0; b < BOLTS; b++) {
      // 車体の側面〜後ろから外へ走る1本
      const side = b % 2 ? 1 : -1;
      let x = side * (0.3 + Math.random() * 0.3);
      let y = deckY + 0.2 + Math.random() * 0.4;
      let z = -0.9 + Math.random() * 1.6;
      for (let i = 0; i < SEG; i++) {
        const nx = x + side * (0.08 + Math.random() * 0.12);
        const ny = y + (Math.random() - 0.5) * 0.25;
        const nz = z - 0.1 - Math.random() * 0.2;
        boltPos.set([x, y, z, nx, ny, nz], k);
        k += 6;
        [x, y, z] = [nx, ny, nz];
      }
    }
    boltGeo.attributes.position.needsUpdate = true;
  };

  // 最初は炎を消しておく（ガレージでは噴かない）
  for (const f of [...mufflers, ...pods]) f.visible = false;
  // 炎・絞り・隠れた部品を除いた、ブースターの本体部品（ボディ工房の干渉の目安）
  const boosterParts: THREE.Object3D[] = [];
  const boosterRoots = fit ? [mountG] : hasPods ? group.children.slice(boosterFrom) : [mufflerRig];
  for (const r of boosterRoots) r.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) boosterParts.push(o);
  });

  // 描画回数を減らす: 動かない部品（シャーシ・ローラー・バンパー・カナード・マスダンパー）と、
  // 各タイヤのホイール面・溝（タイヤと一緒に回る）を、材質ごとに1つのメッシュへまとめる。
  // タイヤ本体（wheel.children[0]）はボディ工房が寸法を読むのでそのまま残す。ブースターと動く部品は対象外
  const keep = new Set<THREE.Object3D>([...aeroParts, frontWing]);
  const statics = group.children.slice(0, boosterFrom).filter((o) => (o as THREE.Mesh).isMesh && !keep.has(o)) as THREE.Mesh[];
  mergeInto(group, statics);
  for (const { mesh: wheel } of wheels) {
    const parts: THREE.Mesh[] = [];
    for (const o of wheel.children.slice(1)) o.traverse((m) => (m as THREE.Mesh).isMesh && parts.push(m as THREE.Mesh));
    mergeInto(wheel, parts);
  }
  // 新しい噴射演出（炎・節・衝撃波リング・火花・光の線・稲妻）。boostfx.json の jet.fxScale=0 なら従来の炎のまま
  const jet = new BoostFx(group, nozzles);

  return {
    group,
    boosterParts,
    wheels,
    deckY,
    rollerMat,
    hasPods,
    setAero,
    // ガレージの確認用: 作り込んだボディの可動部だけを、変形シャーシでなくても動かす（走行には使わない）
    canPreviewAero: !!design,
    previewAero(a: number) {
      design?.setAero(a);
    },
    // ブースト演出: stage 1=マフラーの炎 2=Wブースト2段目・トルネードは青く大きな炎
    // charge: ブーストの溜め 0→1（溜め中は噴射口に白い光が育ち、差し色のラインが白く明滅する）
    // level: 多段ブーストの段（0〜3）。段ごとにブースターが展開する（上の PodRig の説明のとおり）
    // charge: 次の段の溜め 0→1（どの段でも）。円形の稲妻が育ち、発動の瞬間にもう一段強くなる
    // 噴射演出の簡略版を選ぶ（mini=俯瞰モード、cpu=CPUの車）
    setFxProfile(p: Partial<FxProfile>) {
      jet.setProfile(p);
    },
    fxStats: () => jet.stats(),
    // fxDt: 演出を進める実時間（省略時は time の差。俯瞰モードは走行計算の時間が速いので渡す）
    setBoost(stage: number, aero: boolean, time: number, charge = 0, level = stage > 0 ? 1 : 0, fxDt?: number) {
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      // 展開はバネの動き（素早く上がって少し行き過ぎて止まる）。目標は段で決まり、上の段でも前の段の量は変わらない
      const charging1 = level === 0 && charge > 0;
      const goal = [level >= 1 ? 1 : 0, level >= 2 ? 1 : 0, level >= 3 ? 1 : 0];
      for (let i = 0; i < 3; i++) {
        depV[i] += (goal[i] - dep[i]) * FX.spring - depV[i] * FX.damp;
        dep[i] += depV[i];
      }
      // 持ち上げは1段目だけで決まる（2・3段目の量は高さに足さない）。発動前のタメで少し沈む
      const lift = FX.pod.lift * dep[0] - (charging1 ? FX.pod.anticipate * charge : 0);
      for (const rig of podRigs) {
        rig.body.position.y = lift;
        rig.tail.position.z = -FX.pod.extend * dep[1];
        for (const st of rig.struts) {
          // 腕の先がポッドの下（持ち上げた高さ）に来る角度。寝ているときは 0
          st.rotation.x = -Math.min(1.2, Math.asin(Math.min(1, Math.max(0, lift) / ARM)));
        }
        // 上のカバー: 1段目で開いて小さな翼になる
        for (const h of rig.intakes) h.pivot.rotation.z = -h.side * FX.pod.intakeOpen * Math.max(0, Math.min(1.1, dep[0]));
        for (const c of rig.canards) {
          c.pivot.visible = dep[2] > 0.03;
          c.pivot.rotation.y = -c.side * FX.pod.canardOpen * dep[2];
        }
      }
      mufflerRig.position.z = -FX.muffler.slide * dep[0];
      // 格納しているブースターは、溜め始め（またはブースト）でせり出し、終わるとボディの中へ戻る
      deployK += ((stage > 0 || charge > 0 || level > 0 ? 1 : 0) - deployK) * Math.min(1, dt * 9);
      applyStow();
      const glow = level >= 3 ? 0xbfe4ff : 0xff9a1f;
      bladeGlow.color.setHex(glow);
      for (const b of blades) {
        const k = b.tier === 1 ? dep[0] : dep[2];
        b.pivot.visible = k > 0.03;
        b.pivot.rotation.y = -b.side * (b.tier === 1 ? FX.muffler.bladeOpen * dep[0] : FX.muffler.bladeOpen3 * dep[2]);
        b.pivot.scale.setScalar(Math.max(0.01, Math.min(1.1, k)));
      }
      // 噴射: ジェットのように脈動させ、段が上がるほど長く・速く・強く
      const li = Math.max(0, Math.min(2, level - 1));
      const multi = level > 0;
      const pulse = 1 + FX.flame.pulseAmp[li] * Math.sin(time * Math.PI * 2 * FX.flame.pulseHz[li]) + 0.06 * Math.sin(time * 97);
      const flicker = multi ? pulse : 0.85 + Math.sin(time * 60) * 0.15;
      for (const f of mufflers) {
        f.visible = stage > 0;
        f.scale.set(multi ? FX.flame.width[li] : 1, flicker * (multi ? FX.flame.length[li] : 1), multi ? FX.flame.width[li] : 1);
        (f.material as THREE.MeshBasicMaterial).color.set(multi ? FX.flame.outer[li] : '#ff7a10');
        ((f.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(multi ? FX.flame.core[li] : '#ffd84a');
      }
      // Wブースト（EX）の2段目は従来どおり、噴射口を絞った細く長い青い炎
      if (stage === 2 && level < 2) {
        for (const f of mufflers) {
          f.scale.set(0.55, flicker * 2.4, 0.55);
          (f.material as THREE.MeshBasicMaterial).color.setHex(0x7fc8ff);
          ((f.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0xf4fbff);
        }
      }
      if (stage === 0 && charge > 0) {
        for (const f of mufflers) {
          f.visible = true;
          const k = 0.25 + charge * 0.5;
          f.scale.set(k, k * flicker, k);
          (f.material as THREE.MeshBasicMaterial).color.setHex(0xbfe4ff);
          ((f.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
        }
      }
      // ダイヤモンド模様（3段目だけ）: 後ろへ流れながら明滅する
      const showDia = level >= 3 && stage > 0;
      for (const d of diamonds) {
        d.visible = showDia;
        if (!showDia) continue;
        const u = ((d.userData.i as number) + (time * 3) % 1) / FX.diamonds.count;
        d.position.z = (d.userData.z0 as number) - 0.35 - u * FX.diamonds.spacing * FX.diamonds.count;
        d.scale.set(1 - u * 0.6, 1 - u * 0.6, 1.6);
      }
      diamondMat.opacity = 0.55 + 0.35 * Math.sin(time * 50);
      // 円形の稲妻: 溜めの量で強まり、段が上がった瞬間にもう一段強く光る
      if (level > lastLevel) firePop = FX.ring.firePop;
      lastLevel = level;
      firePop = Math.max(0, firePop - dt);
      const power = Math.max(charge, firePop > 0 ? 1.4 : 0);
      chargeRing.visible = power > 0.02;
      if (chargeRing.visible) {
        ringMatFx.opacity = Math.min(1, 0.25 + power * 0.7);
        ringMatFx.color.set(FX.ring.color[Math.min(2, firePop > 0 ? Math.max(0, level - 1) : level)]);
        if (Math.abs(time - ringTime) > FX.ring.redraw) {
          ringTime = time;
          redrawRing(power);
        }
      }
      irisK += ((stage === 2 && level < 2 ? 1 : 0) - irisK) * 0.25;
      for (const { petals, r } of irises) {
        petals[0].parent!.parent!.visible = irisK > 0.03;
        // 開いた状態=リムの外、閉じた状態=口の半分まで
        for (const p of petals) p.position.y = r * (1.2 - 0.55 * irisK);
      }
      // 差し色のラインが光る（1段目=オレンジ、Wブースト2段目=青、3段目=青白）
      const wb2 = stage === 2 && level < 2;
      accent.emissive.setHex(level >= 3 && stage > 0 ? 0xbfe4ff : wb2 ? 0x3aa8ff : stage >= 1 ? 0xff7a1a : charge > 0 ? 0xffffff : 0x000000);
      accent.emissiveIntensity = stage === 0 && charge > 0 ? charge * (0.7 + Math.sin(time * 40) * 0.3) : 0.7 + Math.sin(time * 18) * 0.3;
      tailMat.emissive.setHex(wb2 ? 0x3aa8ff : stage >= 1 ? 0xff5a1a : 0x330000);
      // 細い青白い稲妻: Wブーストの2段目と、多段の3段目
      bolts.visible = (wb2 || (level >= 3 && stage > 0)) && Math.sin(time * 37) > -0.3; // ときどき消えてチラつく
      if (bolts.visible && Math.abs(time - boltTime) > 0.06) {
        boltTime = time;
        redrawBolts();
      }
      // 新しい噴射演出: 従来の炎・ダイヤモンド・円形の稲妻・3段目の稲妻を隠して、ノズルから出す（Wブースト2段目の稲妻は従来のまま）
      if (jet.enabled) {
        for (const f of mufflers) f.visible = false;
        for (const d of diamonds) d.visible = false;
        if (!FX.jet.enable.legacyChargeRing) chargeRing.visible = false;
        if (!wb2) bolts.visible = false;
        jet.update(stage, level, charge, time, fxDt);
      }
    },
    // ガレージで中身を見せるときはボディを外す
    setShell(visible: boolean) {
      if (customGroup) customGroup.visible = visible;
      else if (design) {
        design.group.visible = visible;
        motorG.visible = !visible;
      } else legacy.visible = visible;
      for (const o of aeroParts) o.visible = visible && (o !== frontWing || frontWing.scale.x > 0.51);
    },
    // 速度に合わせてタイヤを回す
    spin(speed: number, dt: number) {
      for (const w of wheels) w.mesh.rotation.x += (speed / w.r) * dt;
    },
  };
}
