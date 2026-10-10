import * as THREE from 'three';
import { isTransformBuild, type Build } from './setup';
import parts from './data/parts.json';

// 車体の見た目（仮のカクカク版）。セッティングに合わせてタイヤの数・大きさ・幅、モーター位置が変わる
// 前が +z。原点は路面の高さ
// タイヤ径はmm表記（中径26mm＝半径0.3）に比例させる
const TIRE_MM: Record<string, number> = { tiny: 22, small: 24, standard: 26, large: 29, huge: 32 };
const TREAD_W: Record<string, number> = { narrow: 0.14, normal: 0.24, wide: 0.36 };
const MOTOR_Z: Record<string, number> = { front: 0.55, mid: 0, rear: -0.6 };

// シャーシごとの車軸: [前後位置, タイヤ半径の倍率]
const AXLES: Record<string, [number, number][]> = {
  std4: [[0.72, 1], [-0.72, 1]],
  // 6輪・8輪はホイールベースを長く取る（見た目のバランスと、重さ・小回りの弱点を兼ねる）
  front6: [[1.3, 0.72], [0.78, 0.72], [-0.85, 1]],
  rear6: [[0.9, 0.72], [-0.6, 0.95], [-1.2, 0.95]],
  eight: [[1.3, 0.8], [0.78, 0.8], [-0.78, 0.8], [-1.3, 0.8]],
};

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

export function buildCarModel(color: number, build: Build) {
  const group = new THREE.Group();
  const tireR = 0.3 * (TIRE_MM[build.tireSize] ?? 26) / 26;
  const treadW = TREAD_W[build.tread] ?? 0.24;
  const deckY = tireR * 0.75;

  // シャーシ: ラジコンのフレームのような平たい板と左右のレール
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 2.3), frameMat);
  plate.position.y = deckY;
  group.add(plate);
  for (const side of [-1, 1]) {
    const zs = (AXLES[build.chassis] ?? AXLES.std4).map(([z]) => z);
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
  for (const [z, k] of AXLES[build.chassis] ?? AXLES.std4) {
    const r = tireR * k;
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

  // モーター: 銀色の缶。フロント/ミッド/リヤで搭載位置が変わる
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), new THREE.MeshLambertMaterial({ color: 0xbfc6cf }));
  motor.rotation.x = Math.PI / 2;
  motor.position.set(0, deckY + 0.2, MOTOR_Z[build.layout] ?? 0);
  group.add(motor);

  // ガイドローラー: 前後4か所
  const rollerMat = new THREE.MeshLambertMaterial({ color: 0xf2c230, emissive: 0x000000 });
  for (const z of [1.25, -1.2]) {
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 12), rollerMat);
      r.position.set(side * 0.72, deckY, z);
      group.add(r);
    }
  }

  // ボディ: 横から見た形を押し出したシンプルなシェル（EX技ごとの形は後で差し替える）
  const shape = new THREE.Shape();
  const look = bodyLook(build.body);
  const profile = look.profile;
  shape.moveTo(profile[0][0], profile[0][1]);
  for (const [z, y] of profile.slice(1)) shape.lineTo(z, y);
  const shellGeo = new THREE.ExtrudeGeometry(shape, { depth: look.width, bevelEnabled: false });
  shellGeo.rotateY(-Math.PI / 2);
  shellGeo.translate(look.width / 2, 0, 0);
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const shell = new THREE.Mesh(shellGeo, bodyMat);
  // EX技ごとの飾り（フィン、スカート、カナード）。ボディと一緒に外せる
  const extras = new THREE.Group();
  extras.position.y = deckY + 0.04;
  const accent = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
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
  // タイヤハウス（前後の車軸ごと）。メインボディとは別部品として作り、将来の組み立てで差し替えられるようにする
  if (look.cowl === 'half' || look.cowl === 'full') {
    const axles = AXLES[build.chassis] ?? AXLES.std4;
    const wx = 0.45 + treadW / 2 + 0.03;
    const top = Math.max(...axles.map(([, k]) => tireR * k)) * 2 + 0.02 - (deckY + 0.04);
    for (const side of [-1, 1]) {
      for (const [z, k] of axles) {
        const r = tireR * k;
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
  group.add(extras);
  shell.position.y = deckY + 0.04;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0x1b2a3a }));
  canopy.position.set(0, deckY + 0.5, -0.15);
  group.add(shell, canopy);

  // バンパー（前後）: FRPは白、カーボンは黒、ハードカーボンは黒＋金の縁
  const BUMPER: Record<string, number> = { frp: 0xeeeeee, carbon: 0x222222, hardCarbon: 0x333333 };
  for (const [key, z] of [['bumperF', 1.32], ['bumperR', -1.28]] as const) {
    const id = build[key];
    if (!BUMPER[id]) continue;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.12), new THREE.MeshLambertMaterial({ color: BUMPER[id], emissive: id === 'hardCarbon' ? 0x332200 : 0 }));
    bar.position.set(0, deckY + 0.06, z);
    group.add(bar);
  }
  // カナード（前後）: ノーズ横とテール横の小さな翼。ワイドは大きめ。変形マシンには付かない
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x3a3f48 });
  const transform = isTransformBuild(build);
  const CANARD: Record<string, number> = { small: 1, large: 1.4 };
  for (const [id, z, y] of [[build.wingF, 1.0, 0.16], [build.wingR, -0.9, 0.3]] as [string, number, number][]) {
    const k = transform ? 0 : CANARD[id];
    if (!k) continue;
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.32 * k, 0.03, 0.24 * k), wingMat);
      c.position.set(side * (0.52 + 0.1 * k), deckY + y, z);
      c.rotation.set(0, side * 0.35, side * 0.2);
      group.add(c);
    }
  }
  // 変形翼: サーキットモードでは前の翼はノーズ下に隠れ、リヤは左右独立のウイング。
  // エアロモードで前の翼がせり出し、リヤの左右ウイングは外側の付け根を軸に90度ボディ側へ倒れてカナード状になる
  const aeroMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, emissive: 0x000000 });
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.32), aeroMat);
  const rearHalves: { pivot: THREE.Group; side: number }[] = [];
  if (transform) {
    frontWing.position.set(0, deckY + 0.1, 0.7);
    group.add(frontWing);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.66, deckY + 0.78, -0.95);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.36), aeroMat);
      plate.position.x = -side * 0.31;
      pivot.add(plate);
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.12), wingMat);
      stay.position.set(side * 0.62, deckY + 0.6, -0.95);
      group.add(pivot, stay);
      rearHalves.push({ pivot, side });
    }
  }
  const setAero = (a: number) => {
    if (!transform) return;
    frontWing.position.z = 0.7 + 0.65 * a;
    frontWing.scale.x = 0.5 + 0.5 * a;
    frontWing.visible = a > 0.02;
    for (const { pivot, side } of rearHalves) pivot.rotation.z = side * (Math.PI / 2) * a;
    aeroMat.emissive.setHex(a > 0.5 ? 0x1a8fff : 0x000000);
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

  // マフラー: ブーストの炎はここから出る。ブースターの種類で本数と大きさが変わる
  const kind = (parts.booster as { id: string; boostKind?: string }[]).find((o) => o.id === build.booster)?.boostKind ?? 'twin';
  const flameMat = () => new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  // [x, y（デッキからの高さ）, 太さ]
  const PIPES: Record<string, [number, number, number][]> = {
    quad: [-0.33, -0.11, 0.11, 0.33].map((x) => [x, 0.2, 0.75] as [number, number, number]),
    single: [[0, 0.55, 2.2]], // 大きな1本を背負う
  };
  const mufflers = (PIPES[kind] ?? [[-0.22, 0.22, 1], [0.22, 0.22, 1]]).map(([x, y, r]) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * r, 0.08 * r, 0.3 + 0.1 * r, 10), pipeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, deckY + y, -1.15);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11 * r, 0.6 + 0.25 * r, 8), flameMat());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, deckY + y, -1.6 - 0.12 * r);
    group.add(pipe, flame);
    return flame;
  });
  // ブーストポッド: 上に積むコンパクトな推進器（炎などのエフェクトは無し）
  const podMat = new THREE.MeshLambertMaterial({ color: 0xe6e9ee });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5fd0ff });
  const POD_X: Record<string, number[]> = { pod2: [-0.22, 0.22], pod4: [-0.33, -0.11, 0.11, 0.33] };
  const podX = POD_X[kind] ?? [];
  const podR = kind === 'pod2' ? 0.15 : 0.085;
  for (const x of podX) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(podR, podR * 1.15, 0.5, 10), podMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(x, deckY + 0.62, -0.75);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(podR * 0.9, 0.02, 6, 12), ringMat);
    ring.position.set(x, deckY + 0.62, -1.0);
    group.add(pod, ring);
  }
  const hasPods = podX.length > 0;
  const pods: THREE.Mesh[] = [];
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 8, 24), glowMat);
  glow.position.set(0, deckY + 0.3, -1.2);
  group.add(glow);

  // 最初は炎を消しておく（ガレージでは噴かない）
  for (const f of [...mufflers, ...pods]) f.visible = false;

  return {
    group,
    rollerMat,
    hasPods,
    setAero,
    // ブースト演出: stage 1=マフラーの炎 2=Wブースト2段目・トルネードは青く大きな炎
    setBoost(stage: number, aero: boolean, time: number) {
      const flicker = 0.85 + Math.sin(time * 60) * 0.15;
      for (const f of mufflers) {
        f.visible = stage > 0;
        f.scale.set(1, flicker, 1);
        (f.material as THREE.MeshBasicMaterial).color.setHex(0xff8a1a);
      }
      // 2段目はマフラーの炎を青く大きく
      if (stage === 2) {
        for (const f of mufflers) {
          f.scale.set(1.6, flicker * 1.8, 1.6);
          (f.material as THREE.MeshBasicMaterial).color.setHex(0x8fd8ff);
        }
      }
      glowMat.opacity = stage === 2 ? 0.6 + Math.sin(time * 20) * 0.3 : 0;
      glow.scale.setScalar(1 + ((time * 3) % 1) * 0.6);
    },
    // ガレージで中身を見せるときはボディを外す
    setShell(visible: boolean) {
      shell.visible = visible;
      extras.visible = visible;
      canopy.visible = visible;
    },
    // 速度に合わせてタイヤを回す
    spin(speed: number, dt: number) {
      for (const w of wheels) w.mesh.rotation.x += (speed / w.r) * dt;
    },
  };
}
