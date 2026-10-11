import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCarModel } from './carModel';
import { options, type Build } from './setup';
import { loadSave } from './save';
import { PAINTS, paintHex } from './paint';
import {
  BLOCKS, BLOCK_TYPES, MAX_BLOCKS, MAX_PART_BLOCKS, MAX_PER_KIND, PART_KINDS, SCALE_MAX, SCALE_MIN, SIZE_MAX, SIZE_MIN,
  blockCount, blockGeometry, isAeroKind, blockMatrix, bodyBlockCount, colorHex, insideLocal, isMirrored, itemMatrix, kindLabel, newBlock,
  normalize, parseBody2, parsePart, type Block, type BlockColor, type BlockType, type BodyData2, type BodyItem, type BodyLine,
  type PartData, type PartKind, type Vec3,
} from './body/blocks';
import { BLANK_BODY, SAMPLE_AERO_PARTS, SAMPLE_BODY, SAMPLE_PARTS } from './body/samples';
import { BASE_NAME, shapeEffect } from './body/custom';
import { aeroMatrices, aeroSets, rearPivot, AERO_SLIDE } from './body/aero';

// ボディ工房: シャーシ・タイヤ・ブースターを下敷きに表示し、その上でボディを作る
// 2つのモード: 「部位」=ブロックを組んで部位（ボンネット、フェンダーなど）を作って保存する
//             「組立」=保存した部位を並べ、位置と大きさを変えてボディにする
// 編集は3面図（横・上・後ろ）で2軸ずつ動かす。3Dビューは回して確認するだけ

const BODY_KEY = 'kumitate-racer.bodies.v1'; // 中身は v2（v1 も読める）
const PART_KEY = 'kumitate-racer.parts.v1';
const SLOTS = 5;
const MAX_LIBRARY = 40;
const ROLLER_REACH = 0.95; // ボディはローラーの外端より外へ出せない
const TOP_LIMIT = 1.3;

type Store = { slots: (BodyData2 | null)[]; draft?: BodyData2; partDraft?: PartData };
function loadStore(): Store {
  const st: Store = { slots: Array(SLOTS).fill(null) };
  try {
    const raw = JSON.parse(localStorage.getItem(BODY_KEY) ?? 'null');
    if (raw) {
      for (let i = 0; i < SLOTS; i++) st.slots[i] = parseBody2(raw.slots?.[i]);
      st.draft = parseBody2(raw.draft) ?? undefined;
      st.partDraft = parsePart(raw.partDraft) ?? undefined;
    }
  } catch {
    // 読めないときは空から
  }
  return st;
}
function loadLibrary(): PartData[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PART_KEY) ?? 'null');
    if (Array.isArray(raw)) {
      const lib = raw.map(parsePart).filter((p): p is PartData => !!p).slice(0, MAX_LIBRARY);
      // 変形部位が1つもなければ、見本の変形部位を足しておく（変形部位が後から増えたので）
      if (!lib.some((p) => isAeroKind(p.kind))) lib.push(...JSON.parse(JSON.stringify(SAMPLE_AERO_PARTS)).slice(0, MAX_LIBRARY - lib.length));
      return lib;
    }
  } catch {
    // 読めないときは見本から
  }
  return JSON.parse(JSON.stringify([...SAMPLE_PARTS, ...SAMPLE_AERO_PARTS]));
}
const store = loadStore();
let library = loadLibrary();
const persist = () => {
  try {
    localStorage.setItem(BODY_KEY, JSON.stringify(store));
    localStorage.setItem(PART_KEY, JSON.stringify(library));
  } catch {
    // 保存できなくても編集はできる
  }
};

const save = loadSave();
// 開いたときはガレージで今組んでいるマシン（シャーシ・タイヤ・ブースター・塗装）を下敷きにする
const build: Build = { ...save.build };
let paint = save.colors[save.slot] ?? 0;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type Mode = 'part' | 'body';
let mode: Mode = 'body';
let body: BodyData2 = clone(store.draft ?? SAMPLE_BODY);
let part: PartData = clone(store.partDraft ?? { v: 1, id: '', name: '新しい部位', kind: 'bonnet', blocks: [] });
let sel = -1;
let view: 'persp' | 'side' | 'top' | 'back' = 'side';
let symmetric = true;
let showZones = true;
// 変形部位: 部位モードで変形前・変形後のどちらの形を作っているか / 組立モードで見せている変形の進み具合（0=前、1=後）
let editAfter = false;
let aeroA = 0;
let aeroTarget = 0;
let deckY = 0.2;
const isAeroPart = () => isAeroKind(part.kind);
// 部位モードで今さわっているブロックの一覧
const pb = (): Block[] => (editAfter && isAeroPart() ? (part.after ??= []) : part.blocks);

// ---- 3D ----
const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2026);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404a58, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-3, 5, 2);
scene.add(sun);
const grid = new THREE.GridHelper(4, 40, 0x3a4250, 0x2b313b);
scene.add(grid);

const persp = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
persp.position.set(-3.2, 2.2, 3.2);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
const orbit = new OrbitControls(persp, renderer.domElement);
orbit.target.set(0, 0.4, 0);
orbit.enableDamping = true;
orbit.update();
const cam = () => (view === 'persp' ? persp : ortho);

function fitView() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  const aspect = w / Math.max(h, 1);
  persp.aspect = aspect;
  persp.updateProjectionMatrix();
  const [needW, needH, cy] = view === 'back' ? [2.4, 1.7, 0.6] : view === 'top' ? [3.8, 2.4, 0] : [3.8, 1.7, 0.6];
  const halfH = Math.max(needH, needW / aspect) / 2;
  ortho.left = -halfH * aspect;
  ortho.right = halfH * aspect;
  ortho.top = halfH;
  ortho.bottom = -halfH;
  ortho.up.set(0, 1, 0);
  if (view === 'side') ortho.position.set(-8, cy, 0);
  else if (view === 'back') ortho.position.set(0, cy, -8);
  else if (view === 'top') {
    ortho.up.set(1, 0, 0);
    ortho.position.set(0, 8, 0);
  }
  ortho.lookAt(0, cy, 0);
  ortho.updateProjectionMatrix();
  ortho.updateMatrixWorld();
  orbit.enabled = view === 'persp';
}
new ResizeObserver(fitView).observe(host);

// ---- 下敷き（シャーシ・タイヤ・ローラー・ブースター）と、ぶつけてはいけない場所 ----
let chassis: THREE.Group | null = null;
const zoneGroup = new THREE.Group();
scene.add(zoneGroup);
type Probe = { p: THREE.Vector3; kind: 'tire' | 'boost' };
let probes: Probe[] = [];
let zLimF = 1.3;
let zLimR = -1.3;

function rebuildChassis() {
  if (chassis) scene.remove(chassis);
  const model = buildCarModel(paintHex(paint), build);
  model.setShell(false);
  chassis = model.group;
  deckY = model.deckY;
  chassis.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.Material).clone();
    mat.transparent = true;
    mat.opacity = 0.55;
    m.material = mat;
  });
  scene.add(chassis);
  chassis.updateMatrixWorld(true);

  probes = [];
  zoneGroup.clear();
  // タイヤ: 円筒の中に点をばらまき、ブロックの中に入ったら干渉
  let front = 0;
  let back = 0;
  for (const { mesh, r } of model.wheels) {
    const c = mesh.position;
    front = Math.max(front, c.z + r);
    back = Math.min(back, c.z - r);
    const tire = mesh.children[0] as THREE.Mesh;
    const tw = (tire.geometry as THREE.CylinderGeometry).parameters.height;
    for (const fx of [-0.45, 0, 0.45]) {
      for (const fr of [0.97, 0.7, 0.35]) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          probes.push({ p: new THREE.Vector3(c.x + fx * tw, c.y + Math.sin(a) * r * fr, c.z + Math.cos(a) * r * fr), kind: 'tire' });
        }
      }
    }
  }
  zLimF = Math.max(1.3, front + 0.05);
  zLimR = Math.min(-1.3, back - 0.05);
  // ブースター: 部品の外箱を重なりごとにまとめ、半透明のオレンジで「取付位置」を見せる
  const boxes = model.boosterParts.map((o) => new THREE.Box3().setFromObject(o).expandByScalar(0.02));
  const merged: THREE.Box3[] = [];
  for (const b of boxes) {
    const hit = merged.find((m) => m.intersectsBox(b));
    if (hit) hit.union(b);
    else merged.push(b.clone());
  }
  const zoneMat = new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.18, depthWrite: false });
  const zoneLine = new THREE.LineBasicMaterial({ color: 0xffa040 });
  for (const b of merged) {
    const size = b.getSize(new THREE.Vector3());
    const ctr = b.getCenter(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const m = new THREE.Mesh(geo, zoneMat);
    m.position.copy(ctr);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), zoneLine);
    e.position.copy(ctr);
    zoneGroup.add(m, e);
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      probes.push({ p: new THREE.Vector3(b.min.x + size.x * (i + 0.5) / n, b.min.y + size.y * (j + 0.5) / n, b.min.z + size.z * (k + 0.5) / n), kind: 'boost' });
    }
  }
  // ボディを置ける範囲（ローラーの外端まで）を床に描く
  const area = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-ROLLER_REACH, 0.01, zLimR), new THREE.Vector3(ROLLER_REACH, 0.01, zLimR),
      new THREE.Vector3(ROLLER_REACH, 0.01, zLimF), new THREE.Vector3(-ROLLER_REACH, 0.01, zLimF),
    ]),
    new THREE.LineBasicMaterial({ color: 0x4fd0ff }),
  );
  zoneGroup.add(area);
  zoneGroup.children.forEach((c) => (c.visible = c === area || showZones));
}

// ---- ボディ・部位の表示 ----
const bodyGroup = new THREE.Group();
scene.add(bodyGroup);
const matCache = new Map<string, THREE.MeshLambertMaterial>();
const badMats = new Set<THREE.MeshLambertMaterial>(); // 干渉しているブロックは赤く点滅させる（赤い塗装でも分かるように）
const matFor = (c: BlockColor, bad: boolean) => {
  const key = `${c}:${bad}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshLambertMaterial({ color: colorHex(c, paintHex(paint)) });
    if (bad) {
      m.emissive.setHex(0xff3030);
      badMats.add(m);
    }
    matCache.set(key, m);
  }
  return matCache.get(key)!;
};
// 部位モードでは、組立中のボディを薄く表示して大きさの見当をつけやすくする（選べない）
const ghostGroup = new THREE.Group();
scene.add(ghostGroup);
const ghostMat = new THREE.MeshLambertMaterial({ color: 0x9fb4cc, transparent: true, opacity: 0.18, depthWrite: false });
const outline = new THREE.BoxHelper(new THREE.Object3D(), 0xffe14a);
outline.visible = false;
scene.add(outline);

type Issue = { tire: boolean; boost: boolean; out: boolean };
const NO_ISSUE: Issue = { tire: false, boost: false, out: false };
let issues: Issue[] = [];
const isBad = (i: Issue | undefined) => !!i && (i.tire || i.out); // ブーストとの重なりは見た目の味として許す
// parent: 組立てで部位ごと動かした・拡大縮小した分
function checkBlock(b: Block, parent?: THREE.Matrix4): Issue {
  const res: Issue = { ...NO_ISSUE };
  const mats = [blockMatrix(b)];
  if (isMirrored(b)) mats.push(blockMatrix(b, true));
  if (parent) mats.forEach((m) => m.premultiply(parent));
  const v = new THREE.Vector3();
  for (const m of mats) {
    const inv = m.clone().invert();
    for (const pr of probes) {
      if (res[pr.kind]) continue;
      v.copy(pr.p).applyMatrix4(inv);
      if (insideLocal(b, v.x, v.y, v.z)) res[pr.kind] = true;
    }
    const g = blockGeometry(b);
    g.computeBoundingBox();
    const bb = g.boundingBox!.clone().applyMatrix4(m);
    g.dispose();
    if (bb.min.x < -ROLLER_REACH - 0.001 || bb.max.x > ROLLER_REACH + 0.001 || bb.max.z > zLimF + 0.001 || bb.min.z < zLimR - 0.001 || bb.max.y > TOP_LIMIT || bb.min.y < 0) res.out = true;
  }
  return res;
}
const orIssue = (a: Issue, b: Issue): Issue => ({ tire: a.tire || b.tire, boost: a.boost || b.boost, out: a.out || b.out });

// 1ブロック分のメッシュ（左右対称なら2つ）。mirrorTag=false なら反転側も「本体」として扱う（組立てでは部位ごと動かすため）
function addBlockMeshes(b: Block, idx: number, bad: boolean, into: THREE.Object3D, mirrorTag: boolean) {
  const geo = blockGeometry(b);
  for (const mirror of isMirrored(b) ? [false, true] : [false]) {
    const mesh = new THREE.Mesh(geo, matFor(b.c, bad));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(blockMatrix(b, mirror));
    mesh.userData = { idx, mirror: mirrorTag && mirror };
    into.add(mesh);
  }
}
function addEntryMesh(b: Block, m: THREE.Matrix4, idx: number, into: THREE.Object3D, mat: THREE.Material) {
  const mesh = new THREE.Mesh(blockGeometry(b), mat);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(m);
  mesh.userData = { idx };
  into.add(mesh);
}
// 変形の軸の目印（黄色）: リヤ=左右の付け根の回転軸、フロント=せり出す向きの線
const pivotGroup = new THREE.Group();
scene.add(pivotGroup);
const pivotMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
function updatePivots() {
  pivotGroup.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  pivotGroup.clear();
  $('aero').style.display = mode === 'body' && body.items.some((it) => isAeroKind(it.kind)) ? '' : 'none';
  $('aeronote').textContent = body.items.some((it) => isAeroKind(it.kind)) && !(options('chassis').find((o) => o.id === build.chassis) as { transform?: boolean } | undefined)?.transform
    ? '※いまのシャーシは変形しません。変形部位は変形前の形のまま付きます' : '';
  const kinds = new Set(mode === 'part' ? [part.kind] : body.items.map((it) => it.kind));
  if (kinds.has('aeroRear')) {
    for (const side of [-1, 1]) {
      const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), pivotMat);
      axis.rotation.x = Math.PI / 2;
      axis.position.copy(rearPivot(side, deckY));
      pivotGroup.add(axis);
    }
  }
  if (kinds.has('aeroFront')) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, AERO_SLIDE), pivotMat);
    rail.position.set(0, deckY + 0.1, 0.7 + AERO_SLIDE / 2);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 8), pivotMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0, deckY + 0.1, 0.7 + AERO_SLIDE + 0.06);
    pivotGroup.add(rail, tip);
  }
}
function rebuildBody() {
  bodyGroup.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  bodyGroup.clear();
  ghostGroup.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  ghostGroup.clear();
  if (mode === 'part') {
    for (const it of body.items) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(itemMatrix(it));
      it.blocks.forEach((b) => addBlockMeshes(b, -1, false, g, false));
      g.traverse((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material = ghostMat));
      ghostGroup.add(g);
    }
    // 変形後の形を作っているときは、変形前の形が倒れた（せり出した）先を薄く出す
    if (isAeroPart() && editAfter) {
      const it = { kind: part.kind, name: '', blocks: part.blocks, p: [0, 0, 0] as Vec3, sc: [1, 1, 1] as Vec3 };
      for (const set of aeroSets([it])) {
        const m = aeroMatrices({ ...set, after: [] }, 1, deckY);
        for (const e of set.before) addEntryMesh(e.b, e.m.clone().premultiply(m.before), -1, ghostGroup, ghostMat);
      }
    }
    ghostGroup.updateMatrixWorld(true);
    issues = pb().map((b) => checkBlock(b));
    pb().forEach((b, i) => addBlockMeshes(b, i, isBad(issues[i]), bodyGroup, true));
  } else {
    issues = body.items.map((it) => {
      const m = itemMatrix(it);
      return it.blocks.map((b) => checkBlock(b, m)).reduce(orIssue, NO_ISSUE);
    });
    body.items.forEach((it, i) => {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.userData = { idx: i };
      if (aeroA > 0 && isAeroKind(it.kind)) {
        // 変形の途中・変形後: 決まった軸で動かし、変形後の形があれば入れ替える
        for (const set of aeroSets([it])) {
          const m = aeroMatrices(set, aeroA, deckY);
          for (const [es, k, M] of [[set.before, m.kb, m.before], [set.after, m.ka, m.after]] as const) {
            if (k > 0.01) for (const e of es) addEntryMesh(e.b, e.m.clone().premultiply(M), i, g, matFor(e.b.c, isBad(issues[i])));
          }
        }
      } else {
        g.matrix.copy(itemMatrix(it));
        it.blocks.forEach((b) => addBlockMeshes(b, i, isBad(issues[i]), g, false));
      }
      bodyGroup.add(g);
    });
  }
  updatePivots();
  bodyGroup.updateMatrixWorld(true);
  updateOutline();
  updateStatus();
  schedulePerf();
}
// 走りへの影響（形の効果）を右の欄に出す。測るのに少し時間がかかるので、編集が止まってから
let perfTimer = 0;
function schedulePerf() {
  clearTimeout(perfTimer);
  perfTimer = window.setTimeout(() => {
    const el = document.getElementById('perf')!;
    if (!body.items.length) {
      el.textContent = '';
      return;
    }
    const e = shapeEffect(body);
    const f = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
    el.textContent = `走りへの影響: ${BASE_NAME[body.line]}の性能に、重さ${f(e.wPct)}・空気抵抗${f(e.dPct)}（大きいほど重く、前から見て広いほど最高速が落ちる。各±3%まで）` +
      (e.tooSmall ? '。小さすぎるので軽さ・空気抵抗の得はなし' : '');
  }, 250);
}
function updateOutline() {
  const obj = bodyGroup.children.find((c) => c.userData.idx === sel && !c.userData.mirror);
  outline.visible = !!obj;
  if (obj) outline.setFromObject(obj);
}

// ---- 取り消し（今のモードの中だけ） ----
const snapshot = () => JSON.stringify(mode === 'part' ? part : body);
let cur = snapshot();
let undo: string[] = [];
let redo: string[] = [];
const snapG = (v: number) => Math.round(v / 0.05) * 0.05;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
function commit() {
  // その場で丸める（右パネルが今のブロック・部位を直接さわっているので、入れ替えない）
  if (mode === 'part') {
    for (const b of [...part.blocks, ...(part.after ?? [])]) {
      const n = normalize(b);
      for (const k of Object.keys(b)) delete (b as unknown as Record<string, unknown>)[k];
      Object.assign(b, n);
    }
  } else {
    for (const it of body.items) {
      it.p = it.p.map((v) => round3(snapG(v))) as Vec3;
      it.sc = it.sc.map((v) => round3(Math.min(SCALE_MAX, Math.max(SCALE_MIN, snapG(v))))) as Vec3;
    }
  }
  const j = snapshot();
  if (j === cur) return;
  undo.push(cur);
  if (undo.length > 30) undo.shift();
  redo = [];
  cur = j;
  saveDraft();
}
function saveDraft() {
  store.draft = body;
  store.partDraft = part;
  persist();
}
function restore(j: string) {
  cur = j;
  if (mode === 'part') part = JSON.parse(j);
  else body = JSON.parse(j);
  if (sel >= units().length) sel = -1;
  saveDraft();
  rebuildBody();
  renderProps();
  renderFile();
}
const units = (): { p: Vec3 }[] => (mode === 'part' ? pb() : body.items);

// ---- 画面（DOM） ----
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = '') => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};
function fillSelect(sel: HTMLSelectElement, items: [string, string][], value: string) {
  sel.replaceChildren(...items.map(([v, t]) => el('option', { value: v }, t)));
  sel.value = value;
}
fillSelect($('chassis'), options('chassis').map((o) => [o.id, o.name]), build.chassis);
fillSelect($('tire'), options('tireSize').map((o) => [o.id, o.name]), build.tireSize);
fillSelect($('tread'), options('tread').map((o) => [o.id, `トレッド${o.name}`]), build.tread);
// ブースターは種類ごとに1つ（ランクで形は変わらない）
const boosterKinds = new Map<string, [string, string]>();
for (const o of options('booster')) {
  const kind = (o as { boostKind?: string }).boostKind ?? o.id;
  if (!boosterKinds.has(kind)) boosterKinds.set(kind, [o.id, o.name.replace(/\s*[NTHR]$|\s*EX$/, '')]);
}
const curKind = (options('booster').find((o) => o.id === build.booster) as { boostKind?: string } | undefined)?.boostKind;
fillSelect($('booster'), [...boosterKinds.values()], boosterKinds.get(curKind ?? '')?.[0] ?? build.booster);
build.booster = ($('booster') as HTMLSelectElement).value;
fillSelect($('paint'), PAINTS.map((p, i) => [String(i), p.name]), String(paint));
for (const [id, key] of [['chassis', 'chassis'], ['tire', 'tireSize'], ['tread', 'tread'], ['booster', 'booster']] as const) {
  $(id).addEventListener('change', (e) => {
    build[key] = (e.target as HTMLSelectElement).value;
    rebuildChassis();
    rebuildBody();
    renderFile();
  });
}
$('paint').addEventListener('change', (e) => {
  paint = Number((e.target as HTMLSelectElement).value);
  matCache.clear();
  badMats.clear();
  rebuildChassis();
  rebuildBody();
  renderProps();
});

// モード切替（部位をつくる / ボディを組む）
function setMode(m: Mode) {
  mode = m;
  sel = -1;
  undo = [];
  redo = [];
  cur = snapshot();
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  $('sym').style.display = m === 'part' ? '' : 'none';
  $('file-part').style.display = m === 'part' ? '' : 'none';
  $('file-body').style.display = m === 'body' ? '' : 'none';
  if (m === 'part') aeroA = aeroTarget = 0;
  $('aero').textContent = '▶ 変形';
  $('aero').classList.remove('on');
  renderPalette();
  rebuildBody();
  renderProps();
  renderFile();
}
document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m as Mode)));

// 左の一覧: 部位モード=ブロック、組立モード=保存した部位（種類ごと）
const palette = $('palette');
function renderPalette() {
  palette.replaceChildren();
  if (mode === 'part') {
    for (const t of BLOCK_TYPES) {
      const b = el('button', { 'data-t': t }, BLOCKS[t].label);
      if (BLOCKS[t].hollow) b.classList.add('hollow');
      b.addEventListener('click', () => addBlock(t));
      palette.append(b);
    }
    return;
  }
  if (!library.length) palette.append(el('p', { class: 'hint' }, '「部位」で作って保存すると、ここに並びます'));
  for (const [kind, label] of PART_KINDS) {
    const list = library.filter((p) => p.kind === kind);
    if (!list.length) continue;
    palette.append(el('div', { class: 'kind' }, label));
    for (const p of list) {
      const b = el('button', { 'data-part': p.id }, p.name);
      b.addEventListener('click', () => addItem(p));
      palette.append(b);
    }
  }
}
function addBlock(t: BlockType) {
  if (blockCount(pb()) + 1 > MAX_PART_BLOCKS) return flashCount();
  const b = newBlock(t, [0, 0.6, 0]);
  b.m = symmetric;
  pb().push(b);
  sel = pb().length - 1;
  commit();
  rebuildBody();
  renderProps();
}
function addItem(p: PartData) {
  if (body.items.filter((it) => it.kind === p.kind).length >= MAX_PER_KIND) return toast(`${kindLabel(p.kind)}は${MAX_PER_KIND}個までです`);
  if (bodyBlockCount(body) + blockCount(p.blocks) > MAX_BLOCKS) return flashCount();
  body.items.push({ kind: p.kind, name: p.name, blocks: clone(p.blocks), ...(p.after?.length ? { after: clone(p.after) } : {}), p: [0, 0, 0], sc: [1, 1, 1] });
  sel = body.items.length - 1;
  commit();
  rebuildBody();
  renderProps();
}
function flashCount() {
  const c = $('count');
  c.classList.add('flash');
  setTimeout(() => c.classList.remove('flash'), 600);
}
function updateStatus() {
  const [n, max, label] = mode === 'part' ? [blockCount(pb()), MAX_PART_BLOCKS, editAfter && isAeroPart() ? '変形後のブロック' : '部位のブロック'] : [bodyBlockCount(body), MAX_BLOCKS, 'ブロック'];
  const c = $('count');
  c.textContent = `${label} ${n}/${max}`;
  c.classList.toggle('over', n > max);
  const tire = issues.filter((i) => i.tire).length;
  const boost = issues.filter((i) => i.boost).length;
  const out = issues.filter((i) => i.out).length;
  const parts: string[] = [];
  if (tire) parts.push(`タイヤと干渉 ${tire}`);
  if (out) parts.push(`はみ出し ${out}`);
  const w = $('warn');
  w.textContent = (parts.length ? '⚠ ' + parts.join(' / ') : '干渉なし') + (boost ? `（ブーストが突き抜け ${boost}）` : '');
  w.classList.toggle('ok', !parts.length);
}

// ビュー切替と道具
document.querySelectorAll<HTMLButtonElement>('#views button').forEach((b) =>
  b.addEventListener('click', () => {
    view = b.dataset.v as typeof view;
    document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x === b));
    fitView();
  }),
);
$('sym').addEventListener('click', () => {
  symmetric = !symmetric;
  $('sym').textContent = `対称 ${symmetric ? 'ON' : 'OFF'}`;
  $('sym').classList.toggle('on', symmetric);
});
$('zones').addEventListener('click', () => {
  showZones = !showZones;
  $('zones').classList.toggle('on', showZones);
  zoneGroup.children.forEach((c, i) => (c.visible = showZones || i === zoneGroup.children.length - 1));
});
$('undo').addEventListener('click', () => {
  if (!undo.length) return;
  redo.push(cur);
  restore(undo.pop()!);
});
$('redo').addEventListener('click', () => {
  if (!redo.length) return;
  undo.push(cur);
  restore(redo.pop()!);
});

// 右パネル: 選んだブロック（部位モード）または部位（組立モード）の設定
const props = $('props');
function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) {
  const row = el('label', { class: 'row' });
  const name = el('span', {}, label);
  const val = el('b', {}, value.toFixed(step < 1 ? 2 : 0));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = v.toFixed(step < 1 ? 2 : 0);
    onInput(v);
  });
  input.addEventListener('change', commit);
  row.append(name, val, input);
  return row;
}
function btn(text: string, on: () => void, cls = '') {
  const b = el('button', cls ? { class: cls } : {}, text);
  b.addEventListener('click', on);
  return b;
}
const touched = () => rebuildBody();
const changed = () => {
  commit();
  rebuildBody();
  renderProps();
};
function renderProps() {
  props.replaceChildren();
  if (mode === 'part') renderBlockProps();
  else renderItemProps();
  const iss = issues[sel];
  if (isBad(iss)) props.append(el('p', { class: 'bad' }, [iss.tire && 'タイヤに当たっています', iss.out && '置ける範囲からはみ出しています'].filter(Boolean).join('。')));
  if (iss?.boost) props.append(el('p', { class: 'hint' }, 'ブーストが突き抜けます（そのまま使えます）'));
}
function renderBlockProps() {
  const b = pb()[sel];
  if (!b) {
    props.append(el('p', { class: 'hint' }, '部位をつくるモードです。左のブロックを足して組み、下の「新規保存」で部位として保存します。横・上・後ろのビューでドラッグすると動かせます。'));
    if (isAeroPart()) {
      props.append(el('p', { class: 'hint' }, part.kind === 'aeroRear'
        ? '変形リヤ翼: 黄色の軸（左右の付け根）を中心に、変形で90度ボディ側へ倒れます。軸は動かせません。下の「変形後」で倒れた後の形を別に作れます（作らなければ同じ形のまま倒れます）。'
        : '変形フロント翼: 黄色の矢印の向きへ前にせり出します。下の「変形後」でせり出した後の形を別に作れます（作らなければ同じ形のまま動きます）。'));
      if (editAfter) props.append(el('p', { class: 'hint' }, '薄い形＝変形前の形が動いた先です。これを目安に変形後の形を作ります。'));
    }
    return;
  }
  const d = BLOCKS[b.t];
  props.append(el('h3', {}, d.label));
  props.append(slider('左右', -ROLLER_REACH, ROLLER_REACH, 0.05, b.p[0], (v) => ((b.p[0] = v), touched())));
  props.append(slider('高さ位置', 0, TOP_LIMIT, 0.05, b.p[1], (v) => ((b.p[1] = v), touched())));
  props.append(slider('前後', -1.6, 1.6, 0.05, b.p[2], (v) => ((b.p[2] = v), touched())));
  d.dims.forEach((name, i) => {
    if (name) props.append(slider(name, SIZE_MIN, SIZE_MAX, 0.05, b.s[i], (v) => ((b.s[i] = v), touched())));
  });
  if (d.k) props.append(slider(d.k.label, d.k.min, d.k.max, d.k.step, b.k ?? d.k.def, (v) => ((b.k = v), touched())));
  if (d.tilt) props.append(slider('傾き', -90, 90, 15, b.a ?? 0, (v) => ((b.a = v), touched())));
  const rot = el('div', { class: 'btns' });
  const turn = (axis: 0 | 1 | 2) => () => {
    b.r[axis] = (b.r[axis] + 1) % 4;
    changed();
  };
  rot.append(btn('↻ 向き', turn(1)), btn('↻ 起こす', turn(0)), btn('↻ 倒す', turn(2)));
  props.append(rot);
  const colors = el('div', { class: 'btns colors' });
  for (const [c, name] of [['body', '車体色'], ['dark', '暗い色'], ['accent', '差し色'], ['black', '黒']] as [BlockColor, string][]) {
    const s = btn(name, () => ((b.c = c), changed()), b.c === c ? 'on' : '');
    s.style.borderLeft = `10px solid #${colorHex(c, paintHex(paint)).toString(16).padStart(6, '0')}`;
    colors.append(s);
  }
  props.append(colors);
  const ops = el('div', { class: 'btns' });
  ops.append(
    btn(b.m ? '対称 ON' : '対称 OFF', () => ((b.m = !b.m), changed()), b.m ? 'on' : ''),
    btn('複製', () => {
      if (blockCount([...pb(), b]) > MAX_PART_BLOCKS) return flashCount();
      const c = clone(b);
      c.p[2] = Math.max(-1.6, c.p[2] - 0.1);
      pb().splice(sel + 1, 0, c);
      sel += 1;
      changed();
    }),
    btn('削除', () => {
      pb().splice(sel, 1);
      sel = -1;
      changed();
    }, 'danger'),
  );
  props.append(ops);
}
function renderItemProps() {
  const it = body.items[sel];
  if (!it) {
    props.append(el('p', { class: 'hint' }, 'ボディを組むモードです。左の部位をタップして置き、位置と大きさを変えます。部位そのものの形は「部位」モードで作ります。'));
    return;
  }
  props.append(el('h3', {}, `${kindLabel(it.kind)}：${it.name}`));
  props.append(slider('左右', -ROLLER_REACH, ROLLER_REACH, 0.05, it.p[0], (v) => ((it.p[0] = v), touched())));
  props.append(slider('高さ位置', -0.6, 1, 0.05, it.p[1], (v) => ((it.p[1] = v), touched())));
  props.append(slider('前後', -1.6, 1.6, 0.05, it.p[2], (v) => ((it.p[2] = v), touched())));
  const all = slider('大きさ（全体）', SCALE_MIN, SCALE_MAX, 0.05, it.sc[0] === it.sc[1] && it.sc[1] === it.sc[2] ? it.sc[0] : 1, (v) => {
    it.sc = [v, v, v];
    touched();
  });
  all.querySelector('input')!.addEventListener('change', () => renderProps());
  props.append(all);
  ['幅', '高さ', '長さ'].forEach((name, i) => props.append(slider(`${name}の倍率`, SCALE_MIN, SCALE_MAX, 0.05, it.sc[i], (v) => ((it.sc[i] = v), touched()))));
  const ops = el('div', { class: 'btns' });
  ops.append(
    btn('複製', () => {
      if (body.items.filter((x) => x.kind === it.kind).length >= MAX_PER_KIND) return toast(`${kindLabel(it.kind)}は${MAX_PER_KIND}個までです`);
      if (bodyBlockCount(body) + blockCount(it.blocks) > MAX_BLOCKS) return flashCount();
      const c = clone(it);
      c.p[2] = Math.max(-1.6, c.p[2] - 0.1);
      body.items.splice(sel + 1, 0, c);
      sel += 1;
      changed();
    }),
    btn('形を直す', () => {
      // 置いた部位の写しを「部位」モードで開く（保存すると別の部位になる）
      part = { v: 1, id: '', name: it.name, kind: it.kind, blocks: clone(it.blocks), ...(it.after?.length ? { after: clone(it.after) } : {}) };
      editAfter = false;
      setMode('part');
      toast('部位モードで開きました。直したら「新規保存」してください');
    }),
    btn('外す', () => {
      body.items.splice(sel, 1);
      sel = -1;
      changed();
    }, 'danger'),
  );
  props.append(ops);
}

// 下のファイル欄: 部位の保存・読み込み / ボディの保存・読み込み
function renderFile() {
  // ボディ
  ($('name') as HTMLInputElement).value = body.name;
  fillSelect($('line'), [['edge', '系統: 直線'], ['stream', '系統: 流線'], ['balance', '系統: バランス']], body.line);
  const slot = ($('slot') as HTMLSelectElement).value || '0';
  fillSelect($('slot'), store.slots.map((s, i) => [String(i), `枠${i + 1}: ${s ? s.name : '（空き）'}`]), slot);
  fillSelect($('sample'), [['', '見本から始める…'], ['sample', SAMPLE_BODY.name], ['blank', BLANK_BODY.name]], '');
  // 部位
  ($('pname') as HTMLInputElement).value = part.name;
  fillSelect($('pkind'), PART_KINDS.map(([id, label]) => [id, label]), part.kind);
  const lib = ($('plib') as HTMLSelectElement).value;
  fillSelect($('plib'), [['', `保存した部位（${library.length}/${MAX_LIBRARY}）…`], ...library.map((p) => [p.id, `${kindLabel(p.kind)}：${p.name}`] as [string, string])], library.some((p) => p.id === lib) ? lib : '');
  $('pover').toggleAttribute('disabled', !library.some((p) => p.id === part.id));
  $('pstate').style.display = isAeroPart() ? '' : 'none';
}
$('name').addEventListener('change', (e) => {
  body.name = (e.target as HTMLInputElement).value.slice(0, 20) || 'マイボディ';
  commit();
});
$('line').addEventListener('change', (e) => {
  body.line = (e.target as HTMLSelectElement).value as BodyLine;
  commit();
});
$('save').addEventListener('click', () => {
  if (bodyBlockCount(body) > MAX_BLOCKS) return flashCount();
  const i = Number(($('slot') as HTMLSelectElement).value);
  store.slots[i] = clone(body);
  persist();
  renderFile();
  toast(`枠${i + 1}に保存しました`);
});
$('load').addEventListener('click', () => {
  const i = Number(($('slot') as HTMLSelectElement).value);
  const b = store.slots[i];
  if (!b) return toast('この枠は空です');
  sel = -1;
  body = clone(b);
  changed();
  renderFile();
});
$('sample').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (!v) return;
  sel = -1;
  body = clone(v === 'blank' ? BLANK_BODY : SAMPLE_BODY);
  changed();
  renderFile();
});
$('pname').addEventListener('change', (e) => {
  part.name = (e.target as HTMLInputElement).value.slice(0, 16) || '部位';
  commit();
});
$('pkind').addEventListener('change', (e) => {
  part.kind = (e.target as HTMLSelectElement).value as PartKind;
  sel = -1;
  setEditAfter(false);
  commit();
  rebuildBody();
  renderProps();
});
function storePart(asNew: boolean) {
  if (!part.blocks.length) return toast(isAeroPart() ? '変形前の形にブロックがありません' : 'ブロックがありません');
  if (blockCount(part.blocks) > MAX_PART_BLOCKS || blockCount(part.after ?? []) > MAX_PART_BLOCKS) return flashCount();
  if (!isAeroPart()) delete part.after;
  else if (!part.after?.length) delete part.after;
  const i = library.findIndex((p) => p.id === part.id);
  if (asNew || i < 0) {
    if (library.length >= MAX_LIBRARY) return toast(`部位は${MAX_LIBRARY}個まで保存できます。いらない部位を削除してください`);
    part.id = 'p' + Date.now().toString(36);
    library.unshift(clone(part));
  } else {
    library[i] = clone(part);
  }
  saveDraft();
  renderFile();
  renderPalette();
  toast(`「${part.name}」を${kindLabel(part.kind)}として保存しました`);
}
$('psave').addEventListener('click', () => storePart(true));
$('pover').addEventListener('click', () => storePart(false));
$('popen').addEventListener('click', () => {
  const p = library.find((x) => x.id === ($('plib') as HTMLSelectElement).value);
  if (!p) return toast('開く部位を選んでください');
  part = clone(p);
  sel = -1;
  setEditAfter(false);
  changed();
  renderFile();
});
$('pdel').addEventListener('click', () => {
  const id = ($('plib') as HTMLSelectElement).value;
  const p = library.find((x) => x.id === id);
  if (!p) return toast('削除する部位を選んでください');
  if (!confirm(`「${p.name}」を削除しますか？（置いたボディからは消えません）`)) return;
  library = library.filter((x) => x.id !== id);
  saveDraft();
  renderFile();
  renderPalette();
});
$('pnew').addEventListener('click', () => {
  part = { v: 1, id: '', name: '新しい部位', kind: part.kind, blocks: [] };
  sel = -1;
  setEditAfter(false);
  changed();
  renderFile();
});
function setEditAfter(v: boolean) {
  editAfter = v;
  document.querySelectorAll<HTMLButtonElement>('#pstate button').forEach((b) => b.classList.toggle('on', (b.dataset.s === 'after') === v));
}
document.querySelectorAll<HTMLButtonElement>('#pstate button').forEach((b) =>
  b.addEventListener('click', () => {
    setEditAfter(b.dataset.s === 'after');
    sel = -1;
    rebuildBody();
    renderProps();
  }),
);
$('aero').addEventListener('click', () => {
  aeroTarget = aeroTarget ? 0 : 1;
  $('aero').textContent = aeroTarget ? '◀ 変形前へ' : '▶ 変形';
  $('aero').classList.toggle('on', !!aeroTarget);
});
let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800);
}

// ---- タップで選ぶ・3面図でドラッグして動かす ----
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(ev: PointerEvent): THREE.Object3D | null {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam());
  return ray.intersectObjects(bodyGroup.children, true)[0]?.object ?? null;
}
let drag: { id: number; x: number; y: number; p0: Vec3; flip: boolean; moved: boolean } | null = null;
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  down = { x: ev.clientX, y: ev.clientY };
  if (view === 'persp') return;
  const hit = pick(ev);
  if (hit) {
    const idx = hit.userData.idx as number;
    if (sel !== idx) {
      sel = idx;
      updateOutline();
      renderProps();
    }
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, p0: [...units()[idx].p], flip: !!hit.userData.mirror, moved: false };
    renderer.domElement.setPointerCapture(ev.pointerId);
  }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!drag || drag.id !== ev.pointerId) return;
  const u = units()[sel];
  if (!u) return;
  const r = renderer.domElement.getBoundingClientRect();
  const upp = (ortho.right - ortho.left) / ortho.zoom / r.width;
  const right = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 1);
  const d = right.multiplyScalar((ev.clientX - drag.x) * upp).add(up.multiplyScalar(-(ev.clientY - drag.y) * upp));
  if (drag.flip) d.x = -d.x;
  const [ylo, yhi] = mode === 'part' ? [0, TOP_LIMIT] : [-0.6, 1];
  const next: Vec3 = [
    Math.max(-ROLLER_REACH, Math.min(ROLLER_REACH, snapG(drag.p0[0] + d.x))),
    Math.max(ylo, Math.min(yhi, snapG(drag.p0[1] + d.y))),
    Math.max(-1.6, Math.min(1.6, snapG(drag.p0[2] + d.z))),
  ];
  if (next.some((v, i) => Math.abs(v - u.p[i]) > 1e-6)) {
    u.p = next;
    drag.moved = true;
    rebuildBody();
  }
});
const endDrag = (ev: PointerEvent) => {
  const tap = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 6;
  down = null;
  if (drag) {
    if (drag.moved) {
      commit();
      renderProps();
    }
    drag = null;
    return;
  }
  // 何もないところをタップ＝選択解除。3Dビューではタップで選ぶ（ドラッグは回転）
  if (tap) {
    const hit = pick(ev);
    sel = hit ? (hit.userData.idx as number) : -1;
    updateOutline();
    renderProps();
  }
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', () => {
  drag = null;
  down = null;
});
renderer.domElement.addEventListener('wheel', (ev) => {
  if (view === 'persp') return;
  ev.preventDefault();
  ortho.zoom = Math.max(0.6, Math.min(4, ortho.zoom * (ev.deltaY > 0 ? 0.9 : 1.1)));
  ortho.updateProjectionMatrix();
}, { passive: false });

// ---- 開始 ----
fitView();
rebuildChassis();
setMode('body');
let lastT = 0;
function loop(t: number) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (view === 'persp') orbit.update();
  if (aeroA !== aeroTarget) {
    aeroA = aeroTarget > aeroA ? Math.min(aeroTarget, aeroA + dt * 1.2) : Math.max(aeroTarget, aeroA - dt * 1.2);
    if (mode === 'body') rebuildBody();
  }
  for (const m of badMats) m.emissiveIntensity = 0.15 + 0.55 * Math.abs(Math.sin(t / 260));
  renderer.render(scene, cam());
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// テスト用に中身を見られるようにする
(globalThis as { __builder?: unknown }).__builder = {
  get body() { return body; }, get part() { return part; }, get library() { return library; }, get issues() { return issues; }, get mode() { return mode; },
  select: (i: number) => { sel = i; updateOutline(); renderProps(); },
};
