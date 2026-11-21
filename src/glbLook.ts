import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Build } from './setup';
import { axlesOf, TREAD_W } from './carModel';

// 外部で作った車体の3Dデータ（GLB）を「見た目だけ」載せる試験（2026-11-15 店長「これでどう？」TRIPO で作った車体）。
// 性能は build（内部の設定データ）のまま。GLB には性能を持たせない。変形・ブースターは対象外。
// GLB ファイルはリポジトリに入れない（素材台帳で商用利用の確認が取れるまで）。試作ページの横に置いた tripo-test.glb を読みに行き、
// 無ければ今までの形のまま走る。
// 読み込む GLB の約束（scratchpad の opt.mjs で軽量化したもの）: 前が +Z、上が +Y、
// タイヤは wheel_FR/FL/RR/RL、ローラーは roller_FR/FL/RR/RL という名前のノード。それ以外は動かない部品としてまとめてある
export const GLB_LOOK = 'tripo';
// 試作ページは .glb を置けないので、base64 にした文字ファイルで置く（中身は同じ GLB）
const GLB_URL = 'tripo-test.b64.txt';
const REDO_EXCEPTION = true; // 上の試験車だけ「やり直し」でも載せる（店長の判断待ち）。次の車からは false にする

let loading: Promise<THREE.Group | null> | null = null;
function loadGlb() {
  if (!loading)
    loading = fetch(GLB_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((b64) => {
        const bin = atob(b64.trim());
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return new GLTFLoader().parseAsync(buf.buffer, '');
      })
      .then((g) => g.scene)
      .catch((e) => {
        console.warn('[glbLook] 読み込めなかったので今までの形で走ります', e);
        return null;
      });
  return loading;
}

type Spinner = { mesh: THREE.Object3D; r: number };
type Model = { group: THREE.Group; wheels: Spinner[] };

// 取り込みの判定（車体寸法規格 v01 の importCheck。/mnt/project-files/racing-game/body-spec/ の JSON が正本、ここは写し）
const MM = 0.020485; // 1mm のゲーム単位
export const IMPORT_CHECK = { axleOk: 3, axleFix: 8, tireDiaTol: 0.15, lengthRange: [150, 165] as [number, number], widthMax: 105 };
export type GlbVerdict = 'ok' | 'fix' | 'redo';
export interface GlbCheck { verdict: GlbVerdict; axleDevMm: number; tireDiaMm: number; tireDiaWant: number; lengthMm: number; widthMm: number; reasons: string[] }
// 縮尺 s をかけたあとの寸法（mm）から判定する。純粋な計算（テストで使う）
export function judgeGlb(m: { axleDevMm: number; tireDiaMm: number; tireDiaWant: number; lengthMm: number; widthMm: number; wheels: number }): GlbCheck {
  const c = IMPORT_CHECK, reasons: string[] = [];
  let verdict: GlbVerdict = 'ok';
  const bump = (v: GlbVerdict, why: string) => { reasons.push(why); if (v === 'redo' || (v === 'fix' && verdict === 'ok')) verdict = v; };
  if (m.wheels !== 4) bump('redo', `タイヤの部品が4本ない（${m.wheels}本。名前 wheel_FR/FL/RR/RL）`);
  if (m.axleDevMm > c.axleFix) bump('redo', `車軸のずれ ${m.axleDevMm.toFixed(1)}mm（${c.axleFix}mm超）`);
  else if (m.axleDevMm > c.axleOk) bump('fix', `車軸のずれ ${m.axleDevMm.toFixed(1)}mm（${c.axleOk}〜${c.axleFix}mm、置き直す）`);
  if (Math.abs(m.tireDiaMm - m.tireDiaWant) > m.tireDiaWant * c.tireDiaTol) bump('fix', `タイヤ径 ${m.tireDiaMm.toFixed(1)}mm（選んだ径 ${m.tireDiaWant}mm と${Math.round(c.tireDiaTol * 100)}%以上違う、置き直す）`);
  if (m.lengthMm < c.lengthRange[0] || m.lengthMm > c.lengthRange[1]) bump('redo', `全長 ${m.lengthMm.toFixed(1)}mm（${c.lengthRange[0]}〜${c.lengthRange[1]}mm の外）`);
  if (m.widthMm > c.widthMax) bump('redo', `幅 ${m.widthMm.toFixed(1)}mm（${c.widthMax}mm超）`);
  return { verdict, axleDevMm: m.axleDevMm, tireDiaMm: m.tireDiaMm, tireDiaWant: m.tireDiaWant, lengthMm: m.lengthMm, widthMm: m.widthMm, reasons };
}

// model の見た目を GLB に差し替える（非同期。読み込めるまでは今までの形）。2026-11-16 車体寸法規格 v01 の6章に合わせた:
// 縮尺は前後端の車軸の間隔で決め、タイヤは GLB の形のまま中心をゲームの車軸位置・タイヤ内面へ動かして、径と幅を選んだタイヤに合わせる。
// ローラーは GLB のものを隠してゲーム側のローラー（種類ごとの色と厚み）を出す。読み込み時に判定して、「やり直し」の車は載せない
export function applyGlbLook(model: Model, build: Build): Promise<GlbCheck | null> {
  return loadGlb().then((src) => {
    if (!src) return null;
    const car = src.clone(true);
    car.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const center = (o: THREE.Object3D) => box.setFromObject(o).getCenter(new THREE.Vector3());
    const sizeOf = (o: THREE.Object3D) => box.setFromObject(o).getSize(new THREE.Vector3());
    const wheels = ['wheel_FR', 'wheel_FL', 'wheel_RR', 'wheel_RL'].map((n) => car.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    const rollers = ['roller_FR', 'roller_FL', 'roller_RR', 'roller_RL'].map((n) => car.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    const axles = axlesOf(build);
    const az = axles.map(([z]) => z);
    const gFront = Math.max(...az), gRear = Math.min(...az);
    const wc = wheels.map(center);
    const wz = wc.map((c) => c.z);
    const glbFront = wz.length ? Math.max(...wz) : 1, glbRear = wz.length ? Math.min(...wz) : -1;
    const s = (gFront - gRear) / Math.max(1e-3, glbFront - glbRear);
    const dz = (gFront + gRear) / 2 - ((glbFront + glbRear) / 2) * s; // GLB を前後に動かす量（縮尺後）
    // 判定に使う寸法（mm）: タイヤとローラーを除いた本体の全長・幅、各タイヤの前後位置のずれ、タイヤ径
    const skip = new Set<THREE.Object3D>([...wheels, ...rollers]);
    const inSkip = (o: THREE.Object3D | null): boolean => !!o && (skip.has(o) || inSkip(o.parent));
    const body = new THREE.Box3();
    car.traverse((o) => { if ((o as THREE.Mesh).isMesh && !inSkip(o)) body.expandByObject(o); });
    const bodySize = body.isEmpty() ? new THREE.Vector3() : body.getSize(new THREE.Vector3());
    const axleDev = Math.max(0, ...wz.map((z) => { const zz = z * s + dz; return Math.min(...az.map((a) => Math.abs(zz - a))) / MM; }));
    const dia = wheels.length ? wheels.map((w) => { const sz = sizeOf(w); return Math.max(sz.y, sz.z) * s / MM; }).reduce((a, b) => a + b, 0) / wheels.length : 0;
    const want = Math.round((axles[0][1] * 2) / MM);
    const chk = judgeGlb({ axleDevMm: axleDev, tireDiaMm: dia, tireDiaWant: want, lengthMm: (bodySize.z * s) / MM, widthMm: (bodySize.x * s) / MM, wheels: wheels.length });
    console.info(`[glbLook] 判定 ${chk.verdict === 'ok' ? 'OK' : chk.verdict === 'fix' ? '置き直し' : 'やり直し'}`, chk);
    // 「やり直し」の車は載せない。開発の確認用に URL に ?glb=force を付けたときだけ載せる。
    // 例外: 今の試験車（tripo-test、規格より前に作った車で全長136mm）は店長の実機確認待ちなので、店長が決めるまで載せたままにする（2026-11-16）
    const force = REDO_EXCEPTION || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('glb') === 'force');
    if (chk.verdict === 'redo' && !force) {
      console.warn('[glbLook] 「やり直し」判定なので GLB は載せず、今までの形で走ります（確認用に載せるには ?glb=force）', chk.reasons);
      return chk;
    }
    // 元の形は消さずに、見えない入れ物へ移す（ブーストの炎などが後から表示に切り替わっても出てこないように）。ゲーム側のローラーとステーだけは出したまま
    const orig = new THREE.Group();
    orig.visible = false;
    for (const c of [...model.group.children]) if (!c.userData.roller) orig.add(c);
    model.group.add(orig);
    // GLB のローラーは隠す（ゲーム側のローラーを使う）
    for (const rl of rollers) rl.visible = false;
    // タイヤ: GLB から外して、ゲームの車軸位置に置き直す。形は GLB のまま、径と幅を選んだタイヤに合わせる
    const treadW = TREAD_W[build.tread] ?? 0.24;
    const spin: Spinner[] = [];
    wheels.forEach((w, i) => {
      const c = wc[i];
      const sz = sizeOf(w);
      const inner = new THREE.Group(); // GLB のタイヤの中心を原点に（世界の向きのまま）
      inner.attach(w);
      w.position.sub(c);
      const zGlb = c.z * s + dz;
      const [az0, r] = axles.reduce((best, a) => (Math.abs(a[0] - zGlb) < Math.abs(best[0] - zGlb) ? a : best), axles[0]);
      inner.scale.set(treadW / Math.max(1e-6, sz.x), (2 * r) / Math.max(1e-6, Math.max(sz.y, sz.z)), (2 * r) / Math.max(1e-6, Math.max(sz.y, sz.z)));
      const pivot = new THREE.Group();
      const side = c.x >= 0 ? 1 : -1;
      pivot.position.set(side * (0.45 + treadW / 2 + 0.03), r, az0);
      pivot.add(inner);
      model.group.add(pivot);
      spin.push({ mesh: pivot, r });
    });
    // 高さ: GLB のタイヤの中心の高さがゲームのタイヤの中心（半径の高さ）に来るように本体を置く（タイヤとボディの関係を保つ）
    const glbAxleY = wc.length ? wc.reduce((a, c) => a + c.y, 0) / wc.length : 0;
    const gameAxleY = axles.reduce((a, [, r]) => a + r, 0) / axles.length;
    car.scale.setScalar(s);
    car.position.set(0, gameAxleY - glbAxleY * s, dz);
    model.group.add(car);
    // 元のタイヤ（見えない）は回す対象から外して、置き直した GLB のタイヤに入れ替える
    model.wheels.length = 0;
    model.wheels.push(...spin);
    return chk;
  });
}
