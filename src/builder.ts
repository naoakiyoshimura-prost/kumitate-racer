import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCarModel } from './carModel';
import { options, type Build } from './setup';
import { loadSave } from './save';
import { PAINTS, paintHex } from './paint';
import {
  BLOCKS, BLOCK_TYPES, MAX_BLOCKS, SIZE_MAX, SIZE_MIN, blockCount, blockGeometry, blockMatrix, colorHex, insideLocal,
  isMirrored, newBlock, normalize, parseBody, type Block, type BlockColor, type BlockType, type BodyData, type BodyLine,
} from './body/blocks';
import { SAMPLES } from './body/samples';

// ボディ工房: シャーシ・タイヤ・ブースターを下敷きに表示し、その上にブロックを組んでボディを作る
// 編集は3面図（横・上・後ろ）で2軸ずつ動かす。3Dビューは回して確認するだけ

const BODY_KEY = 'kumitate-racer.bodies.v1';
const SLOTS = 5;
const ROLLER_REACH = 0.95; // ボディはローラーの外端より外へ出せない
const TOP_LIMIT = 1.3;

type Store = { slots: (BodyData | null)[]; draft?: BodyData };
function loadStore(): Store {
  const st: Store = { slots: Array(SLOTS).fill(null) };
  try {
    const raw = JSON.parse(localStorage.getItem(BODY_KEY) ?? 'null');
    if (raw) {
      for (let i = 0; i < SLOTS; i++) st.slots[i] = parseBody(raw.slots?.[i]);
      st.draft = parseBody(raw.draft) ?? undefined;
    }
  } catch {
    // 読めないときは空から
  }
  return st;
}
const store = loadStore();
const persist = () => {
  try {
    localStorage.setItem(BODY_KEY, JSON.stringify(store));
  } catch {
    // 保存できなくても編集はできる
  }
};

const save = loadSave();
// 開いたときはガレージで今組んでいるマシン（シャーシ・タイヤ・ブースター・塗装）を下敷きにする
const build: Build = { ...save.build };
let paint = save.colors[save.slot] ?? 0;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let body: BodyData = clone(store.draft ?? SAMPLES[0]);
let sel = -1;
let view: 'persp' | 'side' | 'top' | 'back' = 'side';
let symmetric = true;
let showZones = true;

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

// ---- ボディ ----
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
const outline = new THREE.BoxHelper(new THREE.Object3D(), 0xffe14a);
outline.visible = false;
scene.add(outline);

type Issue = { tire: boolean; boost: boolean; out: boolean };
let issues: Issue[] = [];
function checkBlock(b: Block): Issue {
  const res: Issue = { tire: false, boost: false, out: false };
  const mats = [blockMatrix(b)];
  if (isMirrored(b)) mats.push(blockMatrix(b, true));
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

function rebuildBody() {
  for (const c of bodyGroup.children) (c as THREE.Mesh).geometry.dispose();
  bodyGroup.clear();
  issues = body.blocks.map(checkBlock);
  body.blocks.forEach((b, i) => {
    const bad = issues[i].tire || issues[i].out; // ブーストとの重なりは見た目の味として許す
    const geo = blockGeometry(b);
    for (const mirror of isMirrored(b) ? [false, true] : [false]) {
      const mesh = new THREE.Mesh(geo, matFor(b.c, bad));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(blockMatrix(b, mirror));
      mesh.userData = { idx: i, mirror };
      bodyGroup.add(mesh);
    }
  });
  bodyGroup.updateMatrixWorld(true);
  updateOutline();
  updateStatus();
}
function updateOutline() {
  const mesh = bodyGroup.children.find((c) => c.userData.idx === sel && !c.userData.mirror);
  outline.visible = !!mesh;
  if (mesh) outline.setFromObject(mesh);
}

// ---- 取り消し ----
let cur = JSON.stringify(body);
const undo: string[] = [];
let redo: string[] = [];
function commit() {
  // その場で丸める（右パネルが今のブロックを直接さわっているので、入れ替えない）
  for (const b of body.blocks) {
    const n = normalize(b);
    for (const k of Object.keys(b)) delete (b as unknown as Record<string, unknown>)[k];
    Object.assign(b, n);
  }
  const j = JSON.stringify(body);
  if (j === cur) return;
  undo.push(cur);
  if (undo.length > 30) undo.shift();
  redo = [];
  cur = j;
  store.draft = body;
  persist();
}
function restore(j: string) {
  cur = j;
  body = JSON.parse(j);
  if (sel >= body.blocks.length) sel = -1;
  store.draft = body;
  persist();
  rebuildBody();
  renderProps();
  renderFile();
}

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
  });
}
$('paint').addEventListener('change', (e) => {
  paint = Number((e.target as HTMLSelectElement).value);
  matCache.clear();
  badMats.clear();
  rebuildChassis();
  rebuildBody();
});

// ブロック一覧
const palette = $('left');
for (const t of BLOCK_TYPES) {
  const b = el('button', { 'data-t': t }, BLOCKS[t].label);
  if (BLOCKS[t].hollow) b.classList.add('hollow');
  b.addEventListener('click', () => addBlock(t));
  palette.append(b);
}
function addBlock(t: BlockType) {
  if (blockCount(body.blocks) + 1 > MAX_BLOCKS) return flashCount();
  const b = newBlock(t, [0, 0.6, 0]);
  b.m = symmetric;
  body.blocks.push(b);
  sel = body.blocks.length - 1;
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
  const n = blockCount(body.blocks);
  const c = $('count');
  c.textContent = `ブロック ${n}/${MAX_BLOCKS}`;
  c.classList.toggle('over', n > MAX_BLOCKS);
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

// 選んだブロックの設定
const props = $('props');
function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) {
  const row = el('label', { class: 'row' });
  const name = el('span', {}, label);
  const val = el('b', {}, value.toFixed(step < 0.05 ? 2 : step < 1 ? 2 : 0));
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
const touched = () => {
  rebuildBody();
};
function renderProps() {
  props.replaceChildren();
  const b = body.blocks[sel];
  if (!b) {
    props.append(el('p', { class: 'hint' }, '左の一覧からブロックを足すか、ブロックをタップして選びます。横・上・後ろのビューでドラッグすると動かせます。'));
    return;
  }
  const d = BLOCKS[b.t];
  props.append(el('h3', {}, `${d.label}`));
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
    commit();
    rebuildBody();
  };
  rot.append(btn('↻ 向き', turn(1)), btn('↻ 起こす', turn(0)), btn('↻ 倒す', turn(2)));
  props.append(rot);
  const colors = el('div', { class: 'btns colors' });
  for (const [c, name] of [['body', '車体色'], ['dark', '暗い色'], ['accent', '差し色'], ['black', '黒']] as [BlockColor, string][]) {
    const s = btn(name, () => {
      b.c = c;
      commit();
      rebuildBody();
      renderProps();
    }, b.c === c ? 'on' : '');
    s.style.borderLeft = `10px solid #${colorHex(c, paintHex(paint)).toString(16).padStart(6, '0')}`;
    colors.append(s);
  }
  props.append(colors);
  const ops = el('div', { class: 'btns' });
  ops.append(
    btn(b.m ? '対称 ON' : '対称 OFF', () => {
      b.m = !b.m;
      commit();
      rebuildBody();
      renderProps();
    }, b.m ? 'on' : ''),
    btn('複製', () => {
      if (blockCount([...body.blocks, b]) > MAX_BLOCKS) return flashCount();
      const c = clone(b);
      c.p[2] = Math.max(-1.6, c.p[2] - 0.1);
      body.blocks.splice(sel + 1, 0, c);
      sel += 1;
      commit();
      rebuildBody();
      renderProps();
    }),
    btn('削除', () => {
      body.blocks.splice(sel, 1);
      sel = -1;
      commit();
      rebuildBody();
      renderProps();
    }, 'danger'),
  );
  props.append(ops);
  const iss = issues[sel];
  if (iss && (iss.tire || iss.out)) {
    props.append(el('p', { class: 'bad' }, [iss.tire && 'タイヤに当たっています', iss.out && '置ける範囲からはみ出しています'].filter(Boolean).join('。')));
  }
  if (iss?.boost) props.append(el('p', { class: 'hint' }, 'ブーストがこのブロックを突き抜けます（そのまま使えます）'));
}

// 名前・系統・保存
function renderFile() {
  ($('name') as HTMLInputElement).value = body.name;
  fillSelect($('line'), [['edge', '系統: 直線'], ['stream', '系統: 流線'], ['balance', '系統: バランス']], body.line);
  const slot = ($('slot') as HTMLSelectElement).value || '0';
  fillSelect($('slot'), store.slots.map((s, i) => [String(i), `枠${i + 1}: ${s ? s.name : '（空き）'}`]), slot);
  fillSelect($('sample'), [['', '見本から始める…'], ...SAMPLES.map((s, i) => [String(i), s.name] as [string, string])], '');
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
  if (blockCount(body.blocks) > MAX_BLOCKS) return flashCount();
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
  commit();
  rebuildBody();
  renderProps();
  renderFile();
});
$('sample').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (v === '') return;
  sel = -1;
  body = clone(SAMPLES[Number(v)]);
  commit();
  rebuildBody();
  renderProps();
  renderFile();
});
let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1500);
}

// ---- タップで選ぶ・3面図でドラッグして動かす ----
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(ev: PointerEvent): THREE.Object3D | null {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam());
  return ray.intersectObjects(bodyGroup.children, false)[0]?.object ?? null;
}
let drag: { id: number; x: number; y: number; p0: [number, number, number]; flip: boolean; moved: boolean } | null = null;
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
    const b = body.blocks[idx];
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, p0: [...b.p], flip: !!hit.userData.mirror, moved: false };
    renderer.domElement.setPointerCapture(ev.pointerId);
  }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!drag || drag.id !== ev.pointerId) return;
  const b = body.blocks[sel];
  if (!b) return;
  const r = renderer.domElement.getBoundingClientRect();
  const upp = (ortho.right - ortho.left) / ortho.zoom / r.width;
  const right = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(ortho.matrixWorld, 1);
  const d = right.multiplyScalar((ev.clientX - drag.x) * upp).add(up.multiplyScalar(-(ev.clientY - drag.y) * upp));
  if (drag.flip) d.x = -d.x;
  const snapG = (v: number) => Math.round(v / 0.05) * 0.05;
  const next: [number, number, number] = [
    Math.max(-ROLLER_REACH, Math.min(ROLLER_REACH, snapG(drag.p0[0] + d.x))),
    Math.max(0, Math.min(TOP_LIMIT, snapG(drag.p0[1] + d.y))),
    Math.max(-1.6, Math.min(1.6, snapG(drag.p0[2] + d.z))),
  ];
  if (next.some((v, i) => Math.abs(v - b.p[i]) > 1e-6)) {
    b.p = next;
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
rebuildBody();
renderProps();
renderFile();
function loop(t: number) {
  if (view === 'persp') orbit.update();
  for (const m of badMats) m.emissiveIntensity = 0.15 + 0.55 * Math.abs(Math.sin(t / 260));
  renderer.render(scene, cam());
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// テスト用に中身を見られるようにする
(globalThis as { __builder?: unknown }).__builder = { get body() { return body; }, get issues() { return issues; }, select: (i: number) => { sel = i; updateOutline(); renderProps(); } };
