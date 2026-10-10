import * as THREE from 'three';
import { Track } from './track';
import { CameraRig } from './camera';
import { SpeedLines } from './speedlines';
import { CarState, type Tuning } from './car';
import { Input } from './input';
import { CpuDriver, applyTraffic } from './cpu';
import { Garage } from './garage';
import { buildCarModel } from './carModel';
import { GarageStage } from './garageStage';
import { paintHex, rivalHex } from './paint';
import { buildScenery } from './scenery';
import { grassTexture } from './textures';
import type { RaceEvent } from './events';
import { applyBuild, defaultBuild, type Build } from './setup';
import { courseById } from './courses';
import tuning from './data/tuning.json';

// ガレージでコースとパーツを選び、その性能で走る（CPUは標準セッティング）
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6e0);
scene.fog = new THREE.Fog(0x87b6e0, 60, 160);

const camera = new THREE.PerspectiveCamera(tuning.camera.baseFov, 1, 0.1, 400);
const rig = new CameraRig(camera, tuning.camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(30, 50, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshLambertMaterial({ color: 0xffffff, map: grassTexture() }),
);
ground.material.map?.repeat.set(50, 50);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.5; // 路面がスプラインの揺れで少し沈んでも隠れないように
scene.add(ground);

// コースは路面・壁・レーン線をまとめた group ごと差し替える
let track = new Track(courseById('standard'));
let courseGroup = new THREE.Group();
const laneMat = new THREE.LineDashedMaterial({ color: 0x8a909a, dashSize: 2, gapSize: 2 });
const laps = (): number => track.data.laps ?? tuning.race.laps;

const baseTuning = tuning as Tuning;
let cpuTuning = applyBuild(baseTuning, defaultBuild());
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
  courseGroup.add(track.mesh, buildScenery(track));
  // レーンの目安線
  const probe = new CarState(track, playerTuning, 0);
  for (let i = 0; i < (probe.walled ? 0 : probe.laneCount); i++) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(track.linePoints(probe.laneLat(i))), laneMat);
    line.computeLineDistances();
    courseGroup.add(line);
  }
  scene.add(courseGroup);
}
loadCourse('standard');

// 仮のマシン（箱）。前が分かるように先端に白い印、左右に黄色いローラー
function makeCarMesh(color: number, build: Build, number = 1) {
  const model = buildCarModel(color, build, number);
  const { group, rollerMat } = model;
  scene.add(group);
  const setAero = model.setAero;
  return { group, rollerMat, setAero, setBoost: model.setBoost, spin: model.spin, outPos: new THREE.Vector3(), outDir: new THREE.Vector3(), yaw: 0, roll: 0, driftSign: 1 };
}
type CarView = ReturnType<typeof makeCarMesh>;

// トルネードの渦: 車の周りを回る3本のらせん。飛んでいる間だけ表示
const tornadoFx = (() => {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let k = 0; k < 3; k++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const a = u * Math.PI * 4 + (k * Math.PI * 2) / 3;
      const r = 0.9 + u * 0.9;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (u - 0.5) * 4));
    }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 5), mat));
  }
  group.visible = false;
  scene.add(group);
  return {
    update(on: boolean, pos: THREE.Vector3, forward: THREE.Vector3, time: number) {
      group.visible = on;
      if (!on) return;
      group.position.copy(pos);
      group.lookAt(pos.clone().add(forward));
      group.rotateZ(time * 14);
      mat.opacity = 0.4 + 0.2 * Math.sin(time * 30);
    },
  };
})();

// ブースト中に後ろへ流れる煙（使い回しの粒）
const smoke = (() => {
  const geo = new THREE.SphereGeometry(0.25, 6, 4);
  const puffs = Array.from({ length: 60 }, () => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return { m, life: 0, max: 1 };
  });
  let next = 0;
  let acc = 0;
  return {
    // stage: 1=ブースト 2=Wブースト2段目 3=ドリフトのタイヤスモーク
    emit(pos: THREE.Vector3, forward: THREE.Vector3, stage: number, dt: number) {
      acc += dt * (stage === 2 ? 40 : stage === 3 ? 34 : 22);
      while (acc >= 1) {
        acc -= 1;
        const p = puffs[next++ % puffs.length];
        p.m.position.copy(pos).addScaledVector(forward, -1.6).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5));
        (p.m.material as THREE.MeshBasicMaterial).color.setHex(stage === 2 ? 0xbfe8ff : stage === 3 ? 0xb8b0a4 : 0xdddddd);
        p.life = p.max = 0.6;
        p.m.visible = true;
      }
    },
    update(dt: number) {
      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.life -= dt;
        const k = Math.max(0, p.life / p.max);
        p.m.scale.setScalar(0.7 + (1 - k) * 1.5);
        p.m.position.y += dt * 0.8;
        (p.m.material as THREE.MeshBasicMaterial).opacity = k * 0.3;
        if (p.life <= 0) p.m.visible = false;
      }
    },
  };
})();
// ローラーが壁をこすったときの火花（使い回しの粒。重力で落ちる）
const sparks = (() => {
  const geo = new THREE.BoxGeometry(0.09, 0.09, 0.45);
  const mats = [0xffe27a, 0xffa020, 0xffffff].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const bits = Array.from({ length: 80 }, (_, i) => {
    const m = new THREE.Mesh(geo, mats[i % mats.length]);
    m.visible = false;
    scene.add(m);
    return { m, v: new THREE.Vector3(), life: 0 };
  });
  let next = 0;
  let acc = 0;
  return {
    // 速いほどたくさん飛ぶ
    emit(pos: THREE.Vector3, forward: THREE.Vector3, out: THREE.Vector3, speed: number, dt: number) {
      acc += dt * Math.min(60, speed * 2);
      while (acc >= 1) {
        acc -= 1;
        const b = bits[next++ % bits.length];
        b.m.position.copy(pos).addScaledVector(out, 0.75).setY(pos.y + 0.25);
        b.v.copy(forward).multiplyScalar(-speed * (0.2 + Math.random() * 0.3))
          .addScaledVector(out, 1 + Math.random() * 2).add(new THREE.Vector3(0, 1.5 + Math.random() * 2.5, 0));
        b.life = 0.25 + Math.random() * 0.25;
        b.m.visible = true;
      }
    },
    update(dt: number) {
      for (const b of bits) {
        if (b.life <= 0) continue;
        b.life -= dt;
        b.v.y -= 14 * dt;
        b.m.position.addScaledVector(b.v, dt);
        b.m.lookAt(b.m.position.clone().add(b.v));
        if (b.life <= 0) b.m.visible = false;
      }
    },
  };
})();

// 着地の砂ぼこり（輪になって広がる）
const dust = (() => {
  const geo = new THREE.SphereGeometry(0.3, 6, 4);
  const puffs = Array.from({ length: 36 }, () => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcfc4b0, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return { m, v: new THREE.Vector3(), life: 0 };
  });
  let next = 0;
  return {
    burst(pos: THREE.Vector3, power: number) {
      const n = Math.round(10 + power * 8);
      for (let i = 0; i < n; i++) {
        const p = puffs[next++ % puffs.length];
        const a = (i / n) * Math.PI * 2;
        p.m.position.copy(pos).add(new THREE.Vector3(Math.cos(a) * 0.9, 0.2, Math.sin(a) * 0.9));
        p.v.set(Math.cos(a) * (3 + power * 3), 0.8, Math.sin(a) * (3 + power * 3));
        p.life = 0.9;
        p.m.visible = true;
      }
    },
    update(dt: number) {
      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.v.multiplyScalar(Math.exp(-3 * dt));
        p.m.position.addScaledVector(p.v, dt);
        const k = Math.max(0, p.life / 0.9);
        p.m.scale.setScalar(1 + (1 - k) * 2.5);
        (p.m.material as THREE.MeshBasicMaterial).opacity = k * 0.6;
        if (p.life <= 0) p.m.visible = false;
      }
    },
  };
})();
const landSeen = new WeakMap<CarState, number>();

// ドリフトのタイヤ痕: 後輪の位置に黒い帯を置いていく（古いものから順に上書き）
const skids = (() => {
  const N = 600;
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.2, 0.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    N,
  );
  mesh.frustumCulled = false;
  scene.add(mesh);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // 前回の後輪位置（車ごと）。今回の位置との間を1本の帯でつなぐので、フレームが飛んでも途切れない
  const last = new WeakMap<CarState, { pts: THREE.Vector3[]; t: number }>();
  const sc = new THREE.Vector3();
  let i = 0;
  const clear = () => {
    for (let k = 0; k < N; k++) mesh.setMatrixAt(k, zero);
    mesh.instanceMatrix.needsUpdate = true;
  };
  clear();
  return {
    clear,
    mark(s: CarState, g: THREE.Object3D) {
      g.updateMatrixWorld();
      const pts = [-0.55, 0.55].map((x) => g.localToWorld(new THREE.Vector3(x, 0, -0.8)).setY(g.position.y + 0.03));
      const prev = last.get(s);
      last.set(s, { pts, t: s.time });
      if (!prev || s.time - prev.t > 0.2) return;
      pts.forEach((p, k) => {
        const from = prev.pts[k];
        const len = from.distanceTo(p);
        if (len < 0.01 || len > 5) return;
        q.setFromAxisAngle(up, Math.atan2(p.x - from.x, p.z - from.z));
        sc.set(1, 1, (len + 0.05) / 0.7);
        mesh.setMatrixAt(i, m.compose(from.clone().lerp(p, 0.5), q, sc));
        i = (i + 1) % N;
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
})();

let playerView = makeCarMesh(0xd23c3c, defaultBuild());
let rivalView = makeCarMesh(0x2f6fd6, defaultBuild(), 2);
// レースのたびにセッティングどおりの車体を作り直す
function rebuildCars(player: Build, cpuBuild: Build) {
  for (const v of [playerView, rivalView]) scene.remove(v.group);
  const paint = garage.data.colors[garage.data.slot];
  playerView = makeCarMesh(paintHex(paint), player);
  rivalView = makeCarMesh(rivalHex(paint), cpuBuild, 2);
}

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
    g.position.y += s.lift;
    if (s.airborne) g.position.y = s.airY;
    g.rotation.set(0, 0, 0);
    const fp = s.flightPos;
    if (fp) {
      // ショートカット: コースをまたいでまっすぐ飛ぶ
      g.position.copy(fp);
      g.lookAt(fp.clone().add(s.flightDir));
    } else
    // 坂の傾きに合わせて車体を傾ける
    g.lookAt(g.position.clone().add(f.tangent).setY(g.position.y + f.slope));
    // EX技の演出: トルネードは空中で回転、壁走りは壁側へ90度ロール、ドリフトは内側へ向く
    if (s.tornadoAir) g.rotateZ(s.time * 18);
    if (s.exActive === 'wallRide') {
      // 壁側へ90度ロール。S字では反対の壁へ回りながら跳び移る
      const lean = -s.wallAngle / (Math.PI / 2);
      g.rotateZ(s.wallAngle);
      g.position.addScaledVector(f.normal, lean * 0.3).setY(g.position.y + 0.6 * Math.abs(lean) + (s.wallJump > 0 ? Math.sin(s.wallJumpProgress * Math.PI) * 1.2 : 0));
    }
    // 車体の動き: レーン変更で向きを振り、コーナーでは外へ傾く。ドリフト中は大きく横を向いたまま進む
    const drifting = s.exActive === 'drift';
    if (drifting && s.cornerInside) view.driftSign = s.cornerInside;
    const yawTarget = drifting ? -view.driftSign * (s.inCorner ? 0.8 : 0.55) : THREE.MathUtils.clamp(-s.vLat * 0.06, -0.3, 0.3);
    const rollTarget = drifting ? view.driftSign * 0.12 : s.inCorner ? s.cornerInside * 0.1 : THREE.MathUtils.clamp(s.vLat * 0.03, -0.12, 0.12);
    const k = 1 - Math.exp(-8 * dt);
    view.yaw += (yawTarget - view.yaw) * k;
    view.roll += (rollTarget - view.roll) * k;
    g.rotateY(view.yaw);
    g.rotateZ(view.roll);
  }
  view.rollerMat.emissive.setHex(s.onRoller ? 0xff6a00 : 0x000000);
  // ローラーが壁をこすると火花
  if (s.onRoller && !s.isOut && garage.fx) sparks.emit(g.position, f.tangent, f.normal.clone().multiplyScalar(Math.sign(s.lat - s.wallCenter) || 1), s.speed, dt);
  // 着地した瞬間に砂ぼこり（強い着地ほど大きく）
  if (s.lastLandingTime > 0 && landSeen.get(s) !== s.lastLandingTime) {
    landSeen.set(s, s.lastLandingTime);
    if (garage.fx) dust.burst(g.position, s.lastLanding === 'clean' ? 0.5 : 1.5);
  }
  view.setAero(s.aero);
  view.spin(s.isOut ? 0 : s.speed, dt);
  view.setBoost(s.isOut ? 0 : s.boostStage, s.aero > 0.5, s.time);
  if (!s.isOut && s.boostStage > 0) smoke.emit(g.position, f.tangent, s.boostStage, dt);
  // ドリフト中は後輪からタイヤスモーク
  if (!s.isOut && s.exActive === 'drift' && !s.airborne && garage.fx) skids.mark(s, g);
  if (!s.isOut && s.exActive === 'drift' && !s.airborne) smoke.emit(g.position.clone().addScaledVector(f.normal, view.driftSign * 0.8), f.tangent, 3, dt);
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
const input = new Input({ left: $('left'), right: $('right'), boost: $('boost'), brake: $('brake'), transform: $('transform'), ex: $('ex') });
const brakeBtn = $('brake');
const transformBtn = $('transform');
const exBtn = $('ex');
const EX_LABEL: Record<string, string> = { drift: 'ドリフト', doubleBoost: 'Wブースト', tornado: 'トルネード', tornadoCut: 'カット', wallRide: '壁走り', guard: 'ガード', none: '使えない' };
const hud = $('hud');
const banner = $('banner');
const gaugeFill = $('gauge-fill');
const boostBtn = $('boost');
const timer = $('timer');
const speedoNum = $('speedo-num');
const speedoBar = $('speedo-bar').firstElementChild as HTMLElement;
const speedoTire = $('speedo-tire');
const lights = $('lights');
const lightEls = Array.from(lights.children) as HTMLElement[];
const result = $('result');

// レース進行: countdown → racing → finished
type Phase = 'garage' | 'countdown' | 'racing' | 'finished';
let phase: Phase = 'garage';
let phaseTime = 0;
let raceTime = 0;
let lapStart = 0;
let lapTimes: number[] = [];
let rivalFinish = 0;
let exStartTime = -10;
let secondStageTime = -10;
let lastStage = 0;
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
  skids.clear();
}
let currentEvent: RaceEvent;
const garage = new Garage($('garage'), baseTuning, (t, ev) => {
  playerTuning = t;
  currentEvent = ev;
  // CPUのマシンは大会ごとに違う（初期パーツからの差分）
  const cpuBuild = { ...defaultBuild(), ...ev.cpu };
  cpuTuning = applyBuild(baseTuning, cpuBuild, () => ev.cpuLevel ?? 0);
  rebuildCars(garage.data.build, cpuBuild);
  transformBtn.hidden = !t.car.transform;
  loadCourse(ev.course);
  $('hint').textContent = track.data.walledLanes
    ? '仕切りレーン：レーン変更なし。立体交差でレーンが入れ替わる'
    : '◀▶でレーン変更　ブレーキ・エアロモード・EXもゲージを使う';
  startRace();
});
currentEvent = garage.event;
// ガレージの3D表示（真ん中に自分のマシン）
const garageStage = new GarageStage();
garageStage.attachDrag(renderer.domElement, () => phase === 'garage');
garage.onView = (build, changed, focus) => {
  garageStage.setBuild(build, changed, paintHex(garage.data.colors[garage.data.slot]));
  garageStage.setFocus(focus);
};
loadCourse(currentEvent.course);
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
// 一時停止メニュー: 続ける / やり直す / リタイヤ（賞金なしでガレージへ）
let paused = false;
const pauseBtn = $('pause');
const menu = $('menu');
pauseBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  paused = true;
  menu.hidden = false;
});
menu.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  const action = (e.target as HTMLElement).dataset.action;
  if (!action) return;
  paused = false;
  menu.hidden = true;
  if (action === 'restart') startRace();
  if (action === 'retire') {
    phase = 'garage';
    garage.show();
  }
});
const speedLines = new SpeedLines($('speedlines') as HTMLCanvasElement);
const clock = new THREE.Clock();
let frames = 0;
let fpsTimer = 0;
let fps = 0;

renderer.setAnimationLoop(() => {
  const dt = paused ? (clock.getDelta(), 0) : Math.min(clock.getDelta(), 0.1);
  pauseBtn.hidden = !(phase === 'countdown' || phase === 'racing');
  phaseTime += dt;
  const cmds = paused ? (input.drain(), []) : input.drain();
  const wasOut = state.isOut;
  const rivalWasOut = rival.isOut;
  if (phase === 'garage') {
    banner.textContent = '';
  } else if (phase === 'countdown') {
    banner.textContent = '';
    // スタートシグナル: 赤が1つずつ点き、スタートで全部緑
    const lit = Math.min(3, Math.floor((phaseTime / tuning.race.countdown) * 3) + 1);
    lightEls.forEach((el, i) => el.className = i < lit ? 'red' : '');
    if (phaseTime >= tuning.race.countdown) {
      phase = 'racing';
      phaseTime = 0;
      lightEls.forEach((el) => el.className = 'green');
    }
  } else if (phase === 'racing') {
    for (const cmd of cmds) {
      if (state.command(cmd, raceTime) && cmd === 'ex') exStartTime = state.time;
    }
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
        const diff = rivalFinish ? raceTime - rivalFinish : null;
        const lapList = lapTimes.map((t, i) => `<li class="${t === best ? 'best' : ''}"><span>LAP ${i + 1}</span>${fmt(t)}</li>`).join('');
        result.innerHTML = `<div class="panel ${win ? 'win' : 'lose'}">` +
          `<div class="head"><span class="pos">${win ? '1' : '2'}<sup>${win ? 'st' : 'nd'}</sup></span><span class="goal">GOAL!</span></div>` +
          `<div class="time">${fmt(raceTime)}<small>${diff === null ? 'CPUはまだ走行中' : `CPU ${fmt(rivalFinish)}（${diff > 0 ? '+' : ''}${diff.toFixed(2)}秒）`}</small></div>` +
          `<ol class="laps">${lapList}</ol>` +
          `<div class="chips"><span>コースアウト ${state.courseOuts}回</span><span>タイヤ残り ${Math.round(state.tireLife * 100)}%</span></div>` +
          `<div class="prize">${garage.finish(currentEvent, win ? 1 : 2)}</div>` +
          `<div class="buttons"><button class="primary">もう一回</button><button data-action="garage">ガレージ</button></div></div>`;
        result.hidden = false;
      }
    }
    const landed = state.time - state.lastLandingTime < 1 ? state.lastLanding : null;
    if (state.boostStage === 2 && lastStage !== 2) secondStageTime = state.time;
    lastStage = state.boostStage;
    // EX技の発動はボタンの光で知らせる（画面中央の大きな文字は出さない）
    const exBanner = '';
    banner.textContent = exBanner ? exBanner : state.isOut
      ? 'COURSE OUT!'
      : landed === 'wobble'
        ? 'バランス崩れ！'
        : landed === 'clean'
          ? 'ナイス着地！'
          : phaseTime < 1
            ? 'GO!'
            : state.lap > 1 && raceTime - lapStart < 1.5
              ? `${state.lap === laps() ? 'FINAL LAP' : `LAP ${state.lap}`}  ${fmt(lapTimes[lapTimes.length - 1])}`
              : '';
  } else {
    // ゴール後は流して走る
    cpu.update(dt, raceTime);
    state.update(dt);
    rival.update(dt);
    banner.textContent = '';
  }

  const f = syncView(playerView, state, wasOut, dt);
  const flying = state.flightPos;
  const forward = flying ? state.flightDir : f.tangent;
  tornadoFx.update(state.tornadoAir, playerView.group.position, forward, state.time);
  syncView(rivalView, rival, rivalWasOut, dt);
  smoke.update(dt);
  sparks.update(dt);
  dust.update(dt);
  // カメラはレールを追う。ジャンプ中は車の高さに半分だけ付いていく
  const camTarget = flying ? flying.clone().setY(f.position.y) : f.position.clone();
  camTarget.y += state.lift;
  // 空中では高さの半分だけ追う。トルネードは高く飛ぶので、ほぼ追いかけて画面から外れないようにする
  if (state.airborne) camTarget.y += (state.airY - camTarget.y) * (state.tornadoAir ? 0.85 : 0.5);
  // スピード感: 基本の最高速に対する今の速度
  const speedRatio = state.isOut ? 0 : state.speed / tuning.car.maxSpeed;
  const stage = phase === 'racing' ? state.boostStage : 0;
  rig.setSpeed(speedRatio, stage, state.time, garage.fx);
  rig.update({ position: camTarget, forward }, dt);
  speedLines.draw(speedRatio, stage, garage.fx && phase !== 'garage');

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
  }
  const kmh = Math.round(state.speed * 3.6);
  const lap = Math.min(state.lap, laps());
  hud.textContent = `FPS ${fps}  ${kmh} km/h  レーン ${state.targetLane + 1}/${state.laneCount}  タイヤ ${Math.round(state.tireLife * 100)}%${state.isAero ? '  エアロモード' : ''}${state.onRoller ? '  ローラー接触' : ''}`;
  const pos = progress(state) >= progress(rival) || phase === 'finished' && !rivalFinish ? 1 : 2;
  lights.hidden = !(phase === 'countdown' || (phase === 'racing' && raceTime < 0.8));
  speedoNum.textContent = String(kmh);
  speedoBar.style.width = `${Math.min(100, (state.speed / (tuning.car.maxSpeed * 1.6)) * 100)}%`;
  speedoTire.textContent = `タイヤ ${Math.round(state.tireLife * 100)}%`;
  speedoTire.classList.toggle('low', state.tireLife < 0.35);
  timer.textContent = `${pos}位  LAP ${lap}/${laps()}  ${fmt(raceTime)}`;
  banner.hidden = banner.textContent === '';
  const g = state.gauge / tuning.boost.gaugeMax;
  gaugeFill.style.width = `${g * 100}%`;
  const rejected = raceTime - state.lastRejected < 0.3 && state.lastRejected > 0;
  gaugeFill.className = state.isBoosting ? 'boosting' : rejected ? 'rejected' : '';
  boostBtn.classList.toggle('ready', state.gauge >= playerTuning.boost.boostCost && !state.isBoosting);
  boostBtn.classList.toggle('active', state.isBoosting);
  brakeBtn.classList.toggle('active', state.brakeTimer > 0);
  brakeBtn.classList.toggle('ready', state.brakeTimer <= 0 && state.gauge >= playerTuning.boost.brakeCost);
  transformBtn.classList.toggle('active', state.aeroTarget);
  transformBtn.classList.toggle('ready', !state.aeroTarget && state.aeroCooldown <= 0 && state.gauge >= playerTuning.aero.cost);
  transformBtn.textContent = state.aeroTarget ? 'サーキット\nへ戻す' : state.aeroCooldown > 0 ? `エアロ\n${Math.ceil(state.aeroCooldown)}秒` : 'エアロ\nモード';
  const shortcut = phase === 'racing' && !!state.shortcutWindow && state.canEx();
  exBtn.textContent = state.doubleReady
    ? `2段目！\n${state.exCountdown.toFixed(1)}`
    : shortcut
      ? 'ショート\nカット！'
    : state.exActive
      ? `${EX_LABEL[state.exSkill]}\n${state.exCountdown.toFixed(1)}`
      : `EX\n${state.exSkill === 'tornadoCut' && state.cutUsed ? '使用済み' : state.exUsedLap === state.lap ? '次の周' : state.time < playerTuning.ex.startCooldown && phase === 'racing' ? `${Math.ceil(playerTuning.ex.startCooldown - state.time)}秒` : EX_LABEL[state.exSkill] ?? ''}`;
  exBtn.classList.toggle('ready', phase === 'racing' && (state.canEx() || state.doubleReady));
  exBtn.classList.toggle('double', state.doubleReady || shortcut);
  exBtn.classList.toggle('active', !!state.exActive || state.tornadoReady || !!state.shortcutReady);
  document.body.classList.toggle('in-garage', phase === 'garage');
  if (phase === 'garage') garageStage.render(renderer, dt);
  else renderer.render(scene, camera);
});
