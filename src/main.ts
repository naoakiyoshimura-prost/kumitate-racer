import * as THREE from 'three';
import { Track } from './track';
import { CameraRig } from './camera';
import { CarState, type Tuning } from './car';
import { Input } from './input';
import { CpuDriver, applyTraffic } from './cpu';
import { Garage } from './garage';
import { applyBuild, defaultBuild } from './setup';
import { courseById } from './courses';
import tuning from './data/tuning.json';

// ガレージでコースとパーツを選び、その性能で走る（CPUは標準セッティング）
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6e0);
scene.fog = new THREE.Fog(0x87b6e0, 60, 160);

const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
const rig = new CameraRig(camera, tuning.camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(30, 50, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshLambertMaterial({ color: 0x4f7a4f }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.5; // 路面がスプラインの揺れで少し沈んでも隠れないように
scene.add(ground);

// コースは路面・壁・レーン線をまとめた group ごと差し替える
let track = new Track(courseById('standard'));
let courseGroup = new THREE.Group();
const laneMat = new THREE.LineDashedMaterial({ color: 0x8a909a, dashSize: 2, gapSize: 2 });
const laps = (): number => track.data.laps ?? tuning.race.laps;

const baseTuning = tuning as Tuning;
const cpuTuning = applyBuild(baseTuning, defaultBuild());
let playerTuning = cpuTuning;
let state = new CarState(track, playerTuning, 1);
let rival = new CarState(track, cpuTuning, 2);
const makeCpu = (c: CarState) => new CpuDriver(c, track, tuning.cpu, playerTuning.boost.boostCost, tuning.corner.threshold);
let cpu = makeCpu(rival);

function loadCourse(id: string) {
  if (track.data.id === id && courseGroup.children.length) return;
  scene.remove(courseGroup);
  courseGroup.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
  });
  track = new Track(courseById(id));
  courseGroup = new THREE.Group();
  courseGroup.add(track.mesh);
  // レーンの目安線
  for (let i = 0; i < tuning.lanes.count; i++) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(track.linePoints(state.laneLat(i))), laneMat);
    line.computeLineDistances();
    courseGroup.add(line);
  }
  scene.add(courseGroup);
}
loadCourse('standard');

// 仮のマシン（箱）。前が分かるように先端に白い印、左右に黄色いローラー
function makeCarMesh(color: number) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 2), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.25;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  nose.position.set(0, 0.55, 0.85);
  const rollerMat = new THREE.MeshLambertMaterial({ color: 0xf2c230, emissive: 0x000000 });
  for (const side of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.2, 12), rollerMat);
    r.position.set(side * 0.7, 0.25, 0.9);
    group.add(r);
  }
  group.add(body, nose);
  scene.add(group);
  return { group, rollerMat, outPos: new THREE.Vector3(), outDir: new THREE.Vector3() };
}
type CarView = ReturnType<typeof makeCarMesh>;
const playerView = makeCarMesh(0xd23c3c);
const rivalView = makeCarMesh(0x2f6fd6);

// 走行状態をメッシュに反映する（コースアウト中は外へ飛び出して回転しながら落ちる）
function syncView(view: CarView, s: CarState, wasOut: boolean, dt: number) {
  const f = track.frameAt(s.distance, s.lat / track.halfWidth);
  const g = view.group;
  if (s.isOut) {
    if (!wasOut) {
      view.outPos = g.position.clone();
      view.outDir = f.normal.clone().multiplyScalar(Math.sign(s.lat) || 1).add(f.tangent);
    }
    const k = 1 - s.courseOutTimer / tuning.corner.respawnTime;
    g.position.copy(view.outPos).addScaledVector(view.outDir, k * 8);
    g.position.y = view.outPos.y + Math.sin(k * Math.PI) * 3 - k * 2;
    g.rotation.x += dt * 8;
    g.rotation.z += dt * 5;
  } else {
    g.position.copy(f.position);
    if (s.airborne) g.position.y = s.airY;
    g.rotation.set(0, 0, 0);
    // 坂の傾きに合わせて車体を傾ける
    g.lookAt(g.position.clone().add(f.tangent).setY(g.position.y + f.slope));
  }
  view.rollerMat.emissive.setHex(s.onRoller ? 0xff6a00 : 0x000000);
  return f;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const $ = (id: string) => document.getElementById(id)!;
const input = new Input(renderer.domElement, $('boost'));
const hud = $('hud');
const banner = $('banner');
const gaugeFill = $('gauge-fill');
const boostBtn = $('boost');
const timer = $('timer');
const result = $('result');

// レース進行: countdown → racing → finished
type Phase = 'garage' | 'countdown' | 'racing' | 'finished';
let phase: Phase = 'garage';
let phaseTime = 0;
let raceTime = 0;
let lapStart = 0;
let lapTimes: number[] = [];
let rivalFinish = 0;
// 周回数と距離から、どちらが前かを決める
const progress = (c: CarState) => (c.lap - 1) * track.length + c.distance;
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

function startRace() {
  state = new CarState(track, playerTuning, 1);
  rival = new CarState(track, cpuTuning, 2);
  cpu = makeCpu(rival);
  rivalFinish = 0;
  phase = 'countdown';
  phaseTime = 0;
  raceTime = 0;
  lapStart = 0;
  lapTimes = [];
  result.hidden = true;
}
const garage = new Garage($('garage'), baseTuning, (t, courseId) => {
  playerTuning = t;
  loadCourse(courseId);
  startRace();
});
loadCourse(garage.course);
garage.show();
result.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  if ((e.target as HTMLElement).dataset.action === 'garage') {
    result.hidden = true;
    phase = 'garage';
    garage.show();
  } else {
    startRace();
  }
});
const clock = new THREE.Clock();
let frames = 0;
let fpsTimer = 0;
let fps = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  phaseTime += dt;
  const cmds = input.drain();
  const wasOut = state.isOut;
  const rivalWasOut = rival.isOut;
  if (phase === 'garage') {
    banner.textContent = '';
  } else if (phase === 'countdown') {
    banner.textContent = String(Math.ceil(tuning.race.countdown - phaseTime));
    if (phaseTime >= tuning.race.countdown) {
      phase = 'racing';
      phaseTime = 0;
    }
  } else if (phase === 'racing') {
    for (const cmd of cmds) state.command(cmd, raceTime);
    cpu.update(dt, raceTime);
    const lapBefore = state.lap;
    state.update(dt);
    rival.update(dt);
    applyTraffic([state, rival], tuning.traffic.blockGap, tuning.traffic.blockWidth);
    raceTime += dt;
    if (!rivalFinish && rival.lap > laps()) rivalFinish = raceTime;
    if (state.lap > lapBefore) {
      lapTimes.push(raceTime - lapStart);
      lapStart = raceTime;
      if (state.lap > laps()) {
        phase = 'finished';
        const best = Math.min(...lapTimes);
        const win = !rivalFinish;
        result.innerHTML = `<div class="big">${win ? '1位 GOAL!' : '2位 GOAL'}</div><div>タイム ${fmt(raceTime)}</div>` +
          `<div>CPU ${rivalFinish ? fmt(rivalFinish) : 'まだ走行中'}</div>` +
          `<div>ベストラップ ${fmt(best)}　コースアウト ${state.courseOuts}回</div>` +
          `<div>タイヤ残り ${Math.round(state.tireLife * 100)}%</div>` +
          `<div class="buttons"><button>もう一回</button><button data-action="garage">ガレージ</button></div>`;
        result.hidden = false;
      }
    }
    const landed = state.time - state.lastLandingTime < 1 ? state.lastLanding : null;
    banner.textContent = state.isOut
      ? 'COURSE OUT!'
      : landed === 'wobble'
        ? 'バランス崩れ！'
        : landed === 'clean'
          ? 'ナイス着地！'
          : phaseTime < 1
            ? 'GO!'
            : '';
  } else {
    // ゴール後は流して走る
    cpu.update(dt, raceTime);
    state.update(dt);
    rival.update(dt);
    banner.textContent = '';
  }

  const f = syncView(playerView, state, wasOut, dt);
  syncView(rivalView, rival, rivalWasOut, dt);
  // カメラはレールを追う。ジャンプ中は車の高さに半分だけ付いていく
  const camTarget = f.position.clone();
  if (state.airborne) camTarget.y = (camTarget.y + state.airY) / 2;
  rig.update({ position: camTarget, forward: f.tangent }, dt);

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
  }
  const kmh = Math.round(state.speed * 3.6);
  const lap = Math.min(state.lap, laps());
  hud.textContent = `FPS ${fps}  ${kmh} km/h  レーン ${state.targetLane + 1}/${tuning.lanes.count}  タイヤ ${Math.round(state.tireLife * 100)}%${state.onRoller ? '  ローラー接触' : ''}`;
  const pos = progress(state) >= progress(rival) || phase === 'finished' && !rivalFinish ? 1 : 2;
  timer.textContent = `${pos}位  LAP ${lap}/${laps()}  ${fmt(raceTime)}`;
  banner.hidden = banner.textContent === '';
  const g = state.gauge / tuning.boost.gaugeMax;
  gaugeFill.style.width = `${g * 100}%`;
  const rejected = raceTime - state.lastRejected < 0.3 && state.lastRejected > 0;
  gaugeFill.className = state.isBoosting ? 'boosting' : rejected ? 'rejected' : '';
  boostBtn.classList.toggle('ready', state.gauge >= playerTuning.boost.boostCost && !state.isBoosting);
  boostBtn.classList.toggle('active', state.isBoosting);
  renderer.render(scene, camera);
});
