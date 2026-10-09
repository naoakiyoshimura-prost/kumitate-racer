import * as THREE from 'three';

// 段階①：雛形。スマホで開けて、横持ちで3D描画とFPSが出ることを確認する。
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6e0);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
camera.position.set(0, 6, 12);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 10, 5);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshLambertMaterial({ color: 0x4f7a4f }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// 仮のマシン（箱）。円周上を走らせるだけ
const car = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.5, 2),
  new THREE.MeshLambertMaterial({ color: 0xd23c3c }),
);
car.position.y = 0.25;
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
let t = 0;
let frames = 0;
let fpsTimer = 0;

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  t += dt;
  const r = 6;
  car.position.x = Math.cos(t) * r;
  car.position.z = Math.sin(t) * r;
  car.rotation.y = -t;

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    hud.textContent = `FPS: ${Math.round(frames / fpsTimer)}`;
    frames = 0;
    fpsTimer = 0;
  }
  renderer.render(scene, camera);
});
