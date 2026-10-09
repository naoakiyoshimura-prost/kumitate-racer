import * as THREE from 'three';
import { Track, type CourseData } from './track';
import { CameraRig } from './camera';
import course1 from './data/course1.json';
import tuning from './data/tuning.json';

// 段階②：コース1本の上を、箱マシンが見えないレールに沿って走る。カメラは後方視点。
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

// 仮のマシン（箱）。前が分かるように先端に白い印
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
car.add(body, nose);
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

const hud = document.getElementById('hud')!;
const clock = new THREE.Clock();
let distance = 0;
let lap = 1;
let frames = 0;
let fpsTimer = 0;
let fps = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  distance += tuning.car.speed * dt;
  if (distance >= track.length) {
    distance -= track.length;
    lap++;
  }

  const f = track.frameAt(distance, 0);
  car.position.copy(f.position);
  car.lookAt(f.position.clone().add(f.tangent));
  rig.update({ position: f.position, forward: f.tangent }, dt);

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
  }
  hud.textContent = `FPS: ${fps}  LAP: ${lap}`;
  renderer.render(scene, camera);
});
