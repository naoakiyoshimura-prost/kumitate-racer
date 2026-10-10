import * as THREE from 'three';
import type { Build } from './setup';
import parts from './data/parts.json';

// 車体の見た目（仮のカクカク版）。セッティングに合わせてタイヤの数・大きさ・幅、モーター位置が変わる
// 前が +z。原点は路面の高さ
const TIRE_R: Record<string, number> = { small: 0.27, standard: 0.3, large: 0.34 };
const TREAD_W: Record<string, number> = { narrow: 0.18, normal: 0.24, wide: 0.32 };
const MOTOR_Z: Record<string, number> = { front: 0.55, mid: 0, rear: -0.6 };

// シャーシごとの車軸: [前後位置, タイヤ半径の倍率]
const AXLES: Record<string, [number, number][]> = {
  std4: [[0.72, 1], [-0.72, 1]],
  front6: [[1.0, 0.72], [0.5, 0.72], [-0.72, 1]],
  rear6: [[0.72, 1], [-0.5, 0.9], [-1.0, 0.9]],
  eight: [[1.0, 0.8], [0.5, 0.8], [-0.5, 0.8], [-1.0, 0.8]],
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
};
// いまのボディ6種の組み合わせ（組み立て画面は後で作る）
const BODY_SPEC: Record<string, BodySpec> = {
  slider: { nose: 'wedge', cabin: 'low', tail: 'cut', width: 0.9, fenders: true }, // ドリフト: 直線型
  twin: { nose: 'standard', cabin: 'mid', tail: 'taper', width: 0.82, stripe: 0.3 }, // Wブースト: バランス
  cyclone: { nose: 'round', cabin: 'high', tail: 'smooth', width: 0.8, fins: true }, // トルネード: 流線形
  wallrunner: { nose: 'standard', cabin: 'low', tail: 'taper', width: 0.86, skirts: true }, // 壁走り
  shifter: { nose: 'needle', cabin: 'low', tail: 'cut', width: 0.8, canards: true, stripe: 0.21 }, // 変形
  stormShifter: { nose: 'needle', cabin: 'high', tail: 'smooth', width: 0.8, canards: true, fins: true }, // 変形
};
type BodyLook = BodySpec & { profile: Pt[] };
const bodyLook = (id: string): BodyLook => {
  const spec = BODY_SPEC[id] ?? BODY_SPEC.slider;
  return { ...spec, profile: [...BODY_PARTS.nose[spec.nose], ...BODY_PARTS.cabin[spec.cabin], ...BODY_PARTS.tail[spec.tail]] };
};

export function buildCarModel(color: number, build: Build) {
  const group = new THREE.Group();
  const tireR = TIRE_R[build.tireSize] ?? 0.3;
  const treadW = TREAD_W[build.tread] ?? 0.24;
  const deckY = tireR * 0.75;

  // シャーシ: ラジコンのフレームのような平たい板と左右のレール
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 2.3), frameMat);
  plate.position.y = deckY;
  group.add(plate);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 2.1), frameMat);
    rail.position.set(side * 0.44, deckY + 0.08, 0);
    group.add(rail);
  }

  // タイヤとホイール（走行中に回す）
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xd9d9d9 });
  const wheels: { mesh: THREE.Group; r: number }[] = [];
  for (const [z, k] of AXLES[build.chassis] ?? AXLES.std4) {
    const r = tireR * k;
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, treadW, 14), tireMat);
      tire.rotation.z = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.BoxGeometry(treadW + 0.02, r * 1.1, r * 0.35), hubMat);
      wheel.add(tire, hub);
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
  // ウィング（前後）: 大きさは小・大で変える
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x3a3f48 });
  const WING: Record<string, number> = { small: 0.9, large: 1.3 };
  if (WING[build.wingF]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(WING[build.wingF], 0.04, 0.3), wingMat);
    w.position.set(0, deckY + 0.12, 1.12);
    group.add(w);
  }
  if (WING[build.wingR]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(WING[build.wingR], 0.05, 0.36), wingMat);
    w.position.set(0, deckY + 0.78, -0.95);
    for (const side of [-1, 1]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.12), wingMat);
      stay.position.set(side * 0.3, deckY + 0.6, -0.95);
      group.add(stay);
    }
    group.add(w);
  }
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

  // マフラー: 普通のブーストはここから炎が出る
  const flameMat = () => new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  const mufflers = [-0.22, 0.22].map((x) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 8), pipeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, deckY + 0.22, -1.15);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.8, 8), flameMat());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(x, deckY + 0.22, -1.7);
    group.add(pipe, flame);
    return flame;
  });
  // ブーストポッド: 変形できる車体とWブースト車だけが積む大きな推進器。2段目やエアロ中に青白く噴く
  const body = (parts.body as { id: string; ex: string; transform?: boolean }[]).find((b) => b.id === build.body);
  const chassis = (parts.chassis as { id: string; transform?: boolean }[]).find((c) => c.id === build.chassis);
  const hasPods = !!(body?.transform || chassis?.transform || body?.ex === 'doubleBoost');
  const podMat = new THREE.MeshLambertMaterial({ color: 0xe6e9ee });
  const pods = hasPods
    ? [-0.62, 0.62].map((x) => {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.7, 10), podMat);
        pod.rotation.x = Math.PI / 2;
        pod.position.set(x, deckY + 0.45, -0.75);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12), new THREE.MeshBasicMaterial({ color: 0x5fd0ff }));
        ring.position.set(x, deckY + 0.45, -1.11);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1.4, 10), flameMat());
        flame.rotation.x = -Math.PI / 2;
        flame.position.set(x, deckY + 0.45, -1.8);
        group.add(pod, ring, flame);
        return flame;
      })
    : [];
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
    // ブースト演出: stage 1=マフラー（ポッド車でエアロ中ならポッドも） 2=Wブースト2段目はポッド全開
    setBoost(stage: number, aero: boolean, time: number) {
      const flicker = 0.85 + Math.sin(time * 60) * 0.15;
      const podsOn = hasPods && (stage === 2 || (stage === 1 && aero));
      for (const f of mufflers) {
        f.visible = stage > 0;
        f.scale.set(1, flicker, 1);
        (f.material as THREE.MeshBasicMaterial).color.setHex(0xff8a1a);
      }
      for (const f of pods) {
        f.visible = podsOn;
        f.scale.set(1, flicker * (stage === 2 ? 1.5 : 1.1), 1);
        (f.material as THREE.MeshBasicMaterial).color.setHex(0x9fe0ff);
      }
      // ポッドのない車の2段目はマフラーの炎を青く大きく
      if (stage === 2 && !hasPods) {
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
