import * as THREE from 'three';
import { Track, type CourseData } from './track';
import { CameraRig } from './camera';
import { CarState, type Tuning } from './car';
import { Input } from './input';
import course1 from './data/course1.json';
import tuning from './data/tuning.json';

// 段階④：ブースト（ゲージ制）、レーン変更でゲージ消費、3周レースとタイム
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
ground.position.y = -0.01;
scene.add(ground);

const track = new Track(course1 as CourseData);
scene.add(track.mesh);

let state = new CarState(track, tuning as Tuning, 1);

// レーンの目安線
const laneMat = new THREE.LineDashedMaterial({ color: 0x8a909a, dashSize: 2, gapSize: 2 });
for (let i = 0; i < tuning.lanes.count; i++) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(track.linePoints(state.laneLat(i))), laneMat);
  line.computeLineDistances();
  scene.add(line);
}

// 仮のマシン（箱）。前が分かるように先端に白い印、左右に黄色いローラー
const car = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.5, 2),
  new THREE.MeshLambertMaterial({ color: 0xd23c3c }),
);
body.position.y = 0.25;
const nose = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.1, 0.3),
  new THREE.MeshLambertMaterial({ color: 0xffffff }),
);
nose.position.set(0, 0.55, 0.85);
const rollerMat = new THREE.MeshLambertMaterial({ color: 0xf2c230, emissive: 0x000000 });
const rollers = [-1, 1].map((side) => {
  const r = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.2, 12), rollerMat);
  r.position.set(side * 0.7, 0.25, 0.9);
  return r;
});
car.add(body, nose, ...rollers);
scene.add(car);

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
type Phase = 'countdown' | 'racing' | 'finished';
let phase: Phase = 'countdown';
let phaseTime = 0;
let raceTime = 0;
let lapStart = 0;
let lapTimes: number[] = [];
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

function startRace() {
  state = new CarState(track, tuning as Tuning, 1);
  phase = 'countdown';
  phaseTime = 0;
  raceTime = 0;
  lapStart = 0;
  lapTimes = [];
  result.hidden = true;
}
result.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  startRace();
});
const clock = new THREE.Clock();
let frames = 0;
let fpsTimer = 0;
let fps = 0;
let outPos = new THREE.Vector3();
let outDir = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  phaseTime += dt;
  const cmds = input.drain();
  const wasOut = state.isOut;
  if (phase === 'countdown') {
    banner.textContent = String(Math.ceil(tuning.race.countdown - phaseTime));
    if (phaseTime >= tuning.race.countdown) {
      phase = 'racing';
      phaseTime = 0;
    }
  } else if (phase === 'racing') {
    for (const cmd of cmds) state.command(cmd, raceTime);
    const lapBefore = state.lap;
    state.update(dt);
    raceTime += dt;
    if (state.lap > lapBefore) {
      lapTimes.push(raceTime - lapStart);
      lapStart = raceTime;
      if (state.lap > tuning.race.laps) {
        phase = 'finished';
        const best = Math.min(...lapTimes);
        result.innerHTML = `<div class="big">GOAL!</div><div>タイム ${fmt(raceTime)}</div>` +
          `<div>ベストラップ ${fmt(best)}　コースアウト ${state.courseOuts}回</div>` +
          `<div class="small">タップでもう一回</div>`;
        result.hidden = false;
      }
    }
    banner.textContent = state.isOut ? 'COURSE OUT!' : phaseTime < 1 ? 'GO!' : '';
  } else {
    // ゴール後は流して走る
    state.update(dt);
    banner.textContent = '';
  }

  const f = track.frameAt(state.distance, state.lat / track.halfWidth);
  if (state.isOut) {
    if (!wasOut) {
      outPos = car.position.clone();
      outDir = f.normal.clone().multiplyScalar(Math.sign(state.lat) || 1).add(f.tangent);
    }
    // コースアウト演出：外へ飛び出して回転しながら落ちる
    const k = 1 - state.courseOutTimer / tuning.corner.respawnTime;
    car.position.copy(outPos).addScaledVector(outDir, k * 8).setY(Math.sin(k * Math.PI) * 3);
    car.rotation.x += dt * 8;
    car.rotation.z += dt * 5;
  } else {
    car.position.copy(f.position);
    car.rotation.set(0, 0, 0);
    car.lookAt(f.position.clone().add(f.tangent));
  }
  rollerMat.emissive.setHex(state.onRoller ? 0xff6a00 : 0x000000);
  rig.update({ position: f.position, forward: f.tangent }, dt);

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
  }
  const kmh = Math.round(state.speed * 3.6);
  const lap = Math.min(state.lap, tuning.race.laps);
  hud.textContent = `FPS ${fps}  ${kmh} km/h  レーン ${state.targetLane + 1}/${tuning.lanes.count}${state.onRoller ? '  ローラー接触' : ''}`;
  timer.textContent = `LAP ${lap}/${tuning.race.laps}  ${fmt(raceTime)}`;
  banner.hidden = banner.textContent === '';
  const g = state.gauge / tuning.boost.gaugeMax;
  gaugeFill.style.width = `${g * 100}%`;
  const rejected = raceTime - state.lastRejected < 0.3 && state.lastRejected > 0;
  gaugeFill.className = state.isBoosting ? 'boosting' : rejected ? 'rejected' : '';
  boostBtn.classList.toggle('ready', state.gauge >= tuning.boost.boostCost && !state.isBoosting);
  boostBtn.classList.toggle('active', state.isBoosting);
  renderer.render(scene, camera);
});
