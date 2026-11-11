import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assemble, describeKit, type Assembled } from './assemble';
import { POD_RIGS, STELLA_PALETTES, stellaKit, type PodRigId } from './stella';
import type { Detail } from './types';

// 部位キットの確認ページ（kit.html）。ゲーム本体とは独立。
// シャーシは carModel.ts に「シャーシだけ作る」公開関数が無いので、標準シャーシ（std4・中径・標準トレッド）と
// 同じ寸法の簡易の台と4輪をここに置く（値は carModel.ts buildCarModel から写した）。

const view = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2e36);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.45, -0.05);
controls.minDistance = 2;
controls.maxDistance = 14;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3328, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fb8ff, 0.8);
rim.position.set(-4, 3, -5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshLambertMaterial({ color: 0x3a3f49 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// ── 簡易シャーシ（carModel.ts の std4 と同じ寸法） ──
const chassis = new THREE.Group();
{
  const tireR = 0.3, treadW = 0.24, deckY = tireR * 0.75;
  const frame = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 2.3), frame);
  plate.position.y = deckY;
  chassis.add(plate);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 2.1), frame);
    rail.position.set(s * 0.44, deckY + 0.08, 0);
    chassis.add(rail);
  }
  const tireM = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const hubM = new THREE.MeshLambertMaterial({ color: 0xd9d9d9 });
  for (const z of [0.72, -0.72]) for (const s of [-1, 1]) {
    const w = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(tireR, tireR, treadW, 20), tireM);
    t.rotation.z = Math.PI / 2;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(tireR * 0.62, tireR * 0.62, treadW + 0.01, 12), hubM);
    h.rotation.z = Math.PI / 2;
    w.add(t, h);
    w.position.set(s * (0.45 + treadW / 2 + 0.03), tireR, z);
    chassis.add(w);
  }
  const rollM = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  for (const z of [1.25, -1.2]) {
    const stay = new THREE.Mesh(new THREE.BoxGeometry(1.79, 0.035, 0.16), frame);
    stay.position.set(0, deckY - 0.06, z);
    chassis.add(stay);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.13, 16), rollM);
      r.position.set(s * 0.83, deckY, z);
      chassis.add(r);
    }
  }
}
scene.add(chassis);

// ── 状態 ──
const q = new URLSearchParams(location.search);
let rig: PodRigId = (q.get('rig') as PodRigId) in POD_RIGS ? (q.get('rig') as PodRigId) : 'B';
let detail: Detail = q.get('detail') === 'low' ? 'low' : 'high';
let exploded = q.get('explode') === '1';
let palKey = q.get('pal') && STELLA_PALETTES[q.get('pal')!] ? q.get('pal')! : 'wbr';
let podPal: string | null = null;
let state = Number(q.get('s') ?? 0);
let explodeK = exploded ? 1 : 0;
let car: Assembled | null = null;

function rebuild() {
  if (car) {
    scene.remove(car.group);
    car.dispose();
  }
  const kit = stellaKit(rig);
  car = assemble(kit, { detail, split: exploded });
  car.setPalette(STELLA_PALETTES[palKey].palette);
  if (podPal) car.setPalette(STELLA_PALETTES[podPal].palette, ['podR', 'podL']);
  car.setState(state);
  car.setExplode(explodeK);
  scene.add(car.group);
  updateStats();
}
const statsEl = document.getElementById('stats')!;
function updateStats() {
  if (!car) return;
  const name = ['NORMAL', 'BOOST1', 'BOOST2', 'BOOST3'][Math.min(3, Math.round(state))];
  statsEl.innerHTML = `STELLA <b>${name}</b> s=${state.toFixed(2)}<br>ポッド ${POD_RIGS[rig].label}<br>${detail} ${exploded ? '分解' : '結合'}: <b>${car.stats.triangles.toLocaleString()}</b> 三角形 / <b>${car.stats.meshes}</b> メッシュ`;
}

// ── 操作 ──
const slider = document.getElementById('state') as HTMLInputElement;
slider.value = String(state);
slider.addEventListener('input', () => {
  state = Number(slider.value);
  playing = false;
  car?.setState(state);
  updateStats();
});
let playing = false;
let playDir = 1;
document.getElementById('play')!.addEventListener('click', () => (playing = !playing));
const btn = (row: HTMLElement, label: string, on: () => boolean, fn: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => {
    fn();
    refreshButtons();
  });
  row.appendChild(b);
  buttons.push([b, on]);
  return b;
};
const buttons: [HTMLButtonElement, () => boolean][] = [];
const rigRow = document.getElementById('rigRow')!;
for (const id of ['A', 'B', 'C'] as PodRigId[]) btn(rigRow, POD_RIGS[id].label, () => rig === id, () => { rig = id; rebuild(); });
const palRow = document.getElementById('palRow')!;
for (const [k, v] of Object.entries(STELLA_PALETTES)) {
  const b = btn(palRow, v.label, () => palKey === k && !podPal, () => { palKey = k; podPal = null; rebuild(); });
  b.insertAdjacentHTML('afterbegin', [v.palette.base, v.palette.sub, v.palette.line].map((c) => `<i class="chip" style="background:#${c.toString(16).padStart(6, '0')}"></i>`).join(''));
}
btn(palRow, 'ポッドだけ黒金', () => podPal === 'bkg', () => { podPal = podPal ? null : 'bkg'; rebuild(); });
const exBtn = document.getElementById('explode')!;
exBtn.addEventListener('click', () => {
  exploded = !exploded;
  if (exploded) {
    explodeK = 0;
    rebuild();
  }
  refreshButtons();
});
const deBtn = document.getElementById('detail')!;
deBtn.addEventListener('click', () => {
  detail = detail === 'high' ? 'low' : 'high';
  rebuild();
  refreshButtons();
});
const chBtn = document.getElementById('chassis')!;
chBtn.addEventListener('click', () => {
  chassis.visible = !chassis.visible;
  refreshButtons();
});
function refreshButtons() {
  for (const [b, on] of buttons) b.classList.toggle('on', on());
  exBtn.classList.toggle('on', exploded);
  deBtn.textContent = detail;
  deBtn.classList.toggle('on', detail === 'low');
  chBtn.classList.toggle('on', chassis.visible);
}

// 視点（撮影・比較用）
const VIEWS: Record<string, [number, number, number]> = {
  front: [0, 0.75, 6.2], back: [0, 0.85, -6.2], left: [-6.2, 0.6, -0.05], right: [6.2, 0.6, -0.05],
  fl: [-3.6, 2.2, 4.4], rl: [-3.8, 2.4, -4.2], top: [0, 7, -0.04], fr: [3.6, 2.2, 4.4], rr: [3.8, 2.4, -4.2],
};
const camRow = document.getElementById('camRow')!;
const VLABEL: Record<string, string> = { front: '前', back: '後', left: '左', fl: '斜め前', rl: '斜め後', top: '上' };
function setView(v: string) {
  const p = VIEWS[v];
  if (!p) return;
  const portrait = view.clientWidth / view.clientHeight < 0.8;
  const k = (exploded ? 1.25 : 1) * (portrait ? 1.35 : 1); // 分解中・縦画面は引いて見る
  camera.position.set(p[0] * k, p[1] * k, p[2] * k);
  controls.target.set(0, v === 'top' ? 0.3 : exploded ? 0.75 : 0.45, -0.05);
  controls.update();
}
for (const v of Object.keys(VLABEL)) {
  const b = document.createElement('button');
  b.textContent = VLABEL[v];
  b.addEventListener('click', () => setView(v));
  camRow.appendChild(b);
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  // 下の操作パネルに隠れないよう、絵の中心をパネルより上の領域の真ん中へずらす
  const ph = document.getElementById('panel')!.offsetHeight;
  const vis = Math.max(1, h - ph);
  camera.aspect = w / (h + ph);
  // 縦長の画面では車の全長が収まるよう画角を広げる
  camera.fov = w / vis < 0.9 ? 62 : 32;
  camera.setViewOffset(w, h + ph, 0, ph, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    state += playDir * dt * 0.8;
    if (state >= 3) { state = 3; playDir = -1; }
    if (state <= 0) { state = 0; playDir = 1; }
    slider.value = String(state);
    car?.setState(state);
    updateStats();
  }
  if (car?.split) {
    const goal = exploded ? 1 : 0;
    if (Math.abs(goal - explodeK) > 1e-3) {
      explodeK += (goal - explodeK) * Math.min(1, dt * 6);
      if (Math.abs(goal - explodeK) < 2e-3) explodeK = goal;
      car.setExplode(explodeK);
      if (!exploded && explodeK === 0) rebuild(); // 戻りきったら結合（メッシュをまとめ直す）
    }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
setView(q.get('view') ?? 'fl');
rebuild();
refreshButtons();
requestAnimationFrame(frame);

// 撮影・確認用の窓口
(window as unknown as { __kit: unknown }).__kit = {
  set(o: { s?: number; rig?: PodRigId; detail?: Detail; explode?: boolean; pal?: string; podPal?: string | null; view?: string; chassis?: boolean; cam?: [number, number, number]; target?: [number, number, number] }) {
    if (o.rig) rig = o.rig;
    if (o.detail) detail = o.detail;
    if (o.explode !== undefined) { exploded = o.explode; explodeK = o.explode ? 1 : 0; }
    if (o.pal) palKey = o.pal;
    if (o.podPal !== undefined) podPal = o.podPal;
    if (o.s !== undefined) { state = o.s; slider.value = String(state); }
    if (o.chassis !== undefined) chassis.visible = o.chassis;
    resize();
    rebuild();
    refreshButtons();
    if (o.view) setView(o.view);
    if (o.cam && o.target) {
      camera.position.set(...o.cam);
      controls.target.set(...o.target);
      controls.update();
    }
    renderer.render(scene, camera);
    return car!.stats;
  },
  describe: () => describeKit(stellaKit(rig)),
  stats: () => car!.stats,
  dump: () => {
    const out: string[] = [];
    const v = new THREE.Vector3();
    car!.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) return;
      o.getWorldPosition(v);
      out.push(`${o.name} vis=${o.visible} p=${v.toArray().map((x) => x.toFixed(2))} r=${o.rotation.toArray().slice(0, 3).map((x) => Number(x ?? 0).toFixed(2))}`);
    });
    return out;
  },
};
