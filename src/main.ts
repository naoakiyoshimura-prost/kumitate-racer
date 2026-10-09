import * as THREE from 'three';
import { Track, type CourseData } from './track';
import { CameraRig } from './camera';
import { CarState, type Tuning } from './car';
import { Input } from './input';
import course1 from './data/course1.json';
import tuning from './data/tuning.json';

// 段階③：レーン変更（タップ/スワイプ）、遠心力とローラーでの壁沿い旋回、コースアウト
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

const state = new CarState(track, tuning as Tuning, 1);

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

const input = new Input(renderer.domElement);
const hud = document.getElementById('hud')!;
const banner = document.getElementById('banner')!;
const clock = new THREE.Clock();
let frames = 0;
let fpsTimer = 0;
let fps = 0;
let outPos = new THREE.Vector3();
let outDir = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  for (const cmd of input.drain()) state.command(cmd);
  const wasOut = state.isOut;
  state.update(dt);

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
  hud.textContent = `FPS ${fps}  LAP ${state.lap}  ${kmh} km/h  レーン ${state.targetLane + 1}/${tuning.lanes.count}${state.onRoller ? '  ローラー接触' : ''}`;
  banner.hidden = !state.isOut;
  renderer.render(scene, camera);
});
