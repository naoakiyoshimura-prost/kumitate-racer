// レースゲームモードの見た目（2026-11-27 店長「このクオリティまで全体を上げよう」。見た目の水準だけを目標にし、他の作品の形・柄・看板は写さない）。
// 走りの計算には一切触らない（見た目だけ）。中身:
//  - 路面: アスファルトの質感・白線・コーナーの縁石・外側の壁（元のコースの帯は隠す）
//  - 空: 上へ行くほど濃い青のグラデーションと雲、遠くのかすみ（霧）
//  - 太陽の影: 車のまわりだけの影（影の範囲を車について動かす。スマホでも軽い1枚の影）
//  - コース脇: メインストレートの観客席、のぼり旗、コーナー外側の矢印看板、木（まとめて描く）、遠くの山
//  - タイヤスモーク: ドリフト・急ブレーキ・ブーストの出だしで後輪から（数は上限つき）
// 「軽量」では影を切り、煙を減らし、画面の細かさを1倍にする（結果は変わらない。見た目だけ）。
import * as THREE from 'three';
import type { Track } from './track';

const UP = new THREE.Vector3(0, 1, 0);
export type RgQuality = 'high' | 'low';
const Q_KEY = 'kumitate-racer.rgQuality';
export function rgQuality(): RgQuality {
  try { return localStorage.getItem(Q_KEY) === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}
export function setRgQuality(q: RgQuality) { try { localStorage.setItem(Q_KEY, q); } catch { /* */ } }

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

// アスファルト: 細かい粒と、うっすらしたムラ。横＝幅方向、縦＝進行方向
function asphaltTex() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#3d4046'; c.fillRect(0, 0, 512, 512);
    // 大きいムラ
    for (let i = 0; i < 60; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 30 + rnd() * 90;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const v = rnd() < 0.5 ? 'rgba(20,22,26,0.18)' : 'rgba(90,94,100,0.12)';
      g.addColorStop(0, v); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 粒
    const img = c.getImageData(0, 0, 512, 512), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 34 + (rnd() < 0.03 ? 40 : 0);
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
    // 走行ライン（タイヤの跡）: 幅の 1/3・2/3 あたりが少し黒い
    for (const x of [150, 362]) {
      const g = c.createLinearGradient(x - 50, 0, x + 50, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(10,10,12,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x - 50, 0, 100, 512);
    }
  });
}
// 縁石: 赤白（進行方向に 1.5m ごと）
function curbTex() {
  return canvasTex(64, 128, (c) => {
    c.fillStyle = '#d8242a'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#f4f4f4'; c.fillRect(0, 64, 64, 64);
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, 6, 128);
  });
}
// 壁: コンクリートの上に青と白の帯（オリジナル）
function wallTex() {
  return canvasTex(256, 64, (c) => {
    c.fillStyle = '#c9ccd2'; c.fillRect(0, 0, 256, 64);
    c.fillStyle = '#1c3f9a'; c.fillRect(0, 10, 256, 18);
    c.fillStyle = '#ffffff';
    for (let x = 0; x < 256; x += 64) { c.beginPath(); c.moveTo(x, 28); c.lineTo(x + 20, 10); c.lineTo(x + 32, 10); c.lineTo(x + 12, 28); c.fill(); }
    c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(0, 58, 256, 6);
  });
}
// 矢印看板（黄色地に黒の矢印。一般的な道路標識の形）
function chevronTex(dir: 1 | -1) {
  return canvasTex(256, 96, (c) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, 256, 96);
    c.fillStyle = '#ffd21a'; c.fillRect(6, 6, 244, 84);
    c.fillStyle = '#111';
    for (let i = 0; i < 3; i++) {
      const x = 40 + i * 68;
      c.beginPath();
      if (dir > 0) { c.moveTo(x, 18); c.lineTo(x + 30, 48); c.lineTo(x, 78); c.lineTo(x + 18, 78); c.lineTo(x + 48, 48); c.lineTo(x + 18, 18); }
      else { c.moveTo(x + 48, 18); c.lineTo(x + 18, 48); c.lineTo(x + 48, 78); c.lineTo(x + 30, 78); c.lineTo(x, 48); c.lineTo(x + 30, 18); }
      c.fill();
    }
  }, false);
}
// のぼり旗（このゲームの仮タイトルのロゴ。オリジナル）
function flagTex(hue: number) {
  return canvasTex(64, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, `hsl(${hue},80%,45%)`); g.addColorStop(1, `hsl(${hue + 30},80%,30%)`);
    c.fillStyle = g; c.fillRect(0, 0, 64, 256);
    c.fillStyle = '#fff'; c.font = 'bold 30px system-ui, sans-serif'; c.textAlign = 'center';
    c.save(); c.translate(32, 128); c.rotate(-Math.PI / 2); c.fillText('KUMITATE', 0, 10); c.restore();
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(8, 16, 48, 6); c.fillRect(8, 234, 48, 6);
  }, false);
}
// 観客席の観客（色の点の並び）
function crowdTex() {
  return canvasTex(256, 64, (c) => {
    c.fillStyle = '#5a5f68'; c.fillRect(0, 0, 256, 64);
    for (let y = 4; y < 64; y += 10)
      for (let x = 2; x < 256; x += 6) {
        if (rnd() < 0.15) continue;
        c.fillStyle = `hsl(${Math.floor(rnd() * 360)},${40 + rnd() * 40}%,${35 + rnd() * 35}%)`;
        c.fillRect(x + rnd() * 2, y + rnd() * 2, 4, 6);
      }
  });
}
// 空: 上が濃く下が白っぽい青＋雲（ゆるい粒の重ね）。正距円筒の横長
function skyTex() {
  return canvasTex(1024, 512, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 512);
    // 球の上半分に貼るので、画像の一番下（y≈487）が地平線
    g.addColorStop(0, '#2a62b6'); g.addColorStop(0.55, '#5f9be0'); g.addColorStop(0.88, '#a9cdf0'); g.addColorStop(0.95, '#d8e8f6'); g.addColorStop(1, '#e2ecf4');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 512);
    // 雲: 白い円をたくさん重ねて塊にする（地平線の近くほど平たく小さく）
    for (let k = 0; k < 46; k++) {
      const cy = 250 + rnd() * 215, cx = rnd() * 1024, s = 0.35 + (1 - (cy - 250) / 215) * 1.1;
      const n = 10 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() - 0.5) * 160 * s, y = cy + (rnd() - 0.5) * 22 * s, r = (14 + rnd() * 26) * s;
        for (const ox of [-1024, 0, 1024]) {
          const gr = c.createRadialGradient(x + ox, y, 0, x + ox, y, r);
          gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = gr; c.fillRect(x + ox - r, y - r, r * 2, r * 2);
        }
        // 下側にうっすら影
        c.fillStyle = 'rgba(150,165,190,0.06)'; c.fillRect(x - r * 0.8, y + r * 0.2, r * 1.6, r * 0.4);
      }
    }
  });
}
function smokeTex() {
  return canvasTex(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(240,240,240,0.45)'); g.addColorStop(1, 'rgba(230,230,230,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  }, false);
}

// 帯のメッシュ（左右2点ずつ）
function strip(left: THREE.Vector3[], right: THREE.Vector3[], vScale: number, dist: number[], mat: THREE.Material, uFlip = false): THREE.Mesh {
  const n = left.length;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos.set([left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z], i * 6);
    uv.set([uFlip ? 1 : 0, dist[i] / vScale, uFlip ? 0 : 1, dist[i] / vScale], i * 4);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } // 表＝上向き（左→右→前の順）
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export interface RgWorld {
  group: THREE.Group;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  update(car: THREE.Vector3, camera: THREE.Camera, dt: number): void;
  emitSmoke(pos: THREE.Vector3, vel: THREE.Vector3, strength: number): void;
  setQuality(q: RgQuality, renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

export function buildRgWorld(track: Track): RgWorld {
  seed = 12345;
  const group = new THREE.Group();
  group.name = 'rgWorld';
  const L = track.length;
  const STEP = 4;
  const n = Math.ceil(L / STEP);
  const ss: number[] = [];
  for (let i = 0; i <= n; i++) ss.push((i / n) * L);
  const at = (s: number, off: number, lift: number) => {
    const f = track.frameAt(s, off);
    return f.position.addScaledVector(track.surfaceAt(s).up, lift);
  };
  const hw = track.halfWidth;

  // 路面
  const asphalt = asphaltTex();
  const road = strip(ss.map((s) => at(s, -1, 0.03)), ss.map((s) => at(s, 1, 0.03)), 14, ss, new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, metalness: 0 }));
  road.receiveShadow = true;
  group.add(road);
  // 白線: 両端（幅 0.35m）と真ん中の破線
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lw = 0.35 / hw;
  for (const e of [-1, 1]) {
    const a = e < 0 ? -0.985 : 0.985 - lw;
    const m = strip(ss.map((s) => at(s, a, 0.05)), ss.map((s) => at(s, a + lw, 0.05)), 10, ss, lineMat);
    m.receiveShadow = true;
    group.add(m);
  }
  {
    const dashL: THREE.Vector3[] = [], dashR: THREE.Vector3[] = [];
    const pos: number[] = [];
    const DASH = 6, GAP = 12, w = 0.12 / hw;
    // 破線は幅の 1/3・2/3 の2本（流れていく目印。真ん中は車の真下になるので引かない）
    for (const c of [-1 / 3, 1 / 3])
      for (let s = 0; s < L - DASH; s += DASH + GAP) {
        const a0 = at(s, c - w, 0.05), b0 = at(s, c + w, 0.05), a1 = at(s + DASH, c - w, 0.05), b1 = at(s + DASH, c + w, 0.05);
        for (const v of [a0, b0, a1, b0, b1, a1]) pos.push(v.x, v.y, v.z);
      }
    void dashL; void dashR;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true;
    group.add(m);
  }
  // 縁石: コーナーの区間（曲率がある所）だけ、両端の内側 1.4m
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const cw = 1.4 / hw;
  let run: number[] = [];
  const flush = () => {
    if (run.length > 2) for (const e of [-1, 1]) {
      const a = e < 0 ? -1 : 1 - cw;
      const m = strip(run.map((s) => at(s, a, 0.08)), run.map((s) => at(s, a + cw, 0.08)), 3, run, curbMat);
      m.receiveShadow = true;
      group.add(m);
    }
    run = [];
  };
  for (const s of ss) { if (track.curvatureAt(s).k > 1 / 1500) run.push(s); else flush(); }
  flush();
  // 外側の壁（路面の端から 1.2m 外、高さ 1.1m）
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex(), roughness: 0.85, side: THREE.DoubleSide });
  for (const e of [-1, 1]) {
    const out = e * (1 + 1.2 / hw);
    const base = ss.map((s) => at(s, out, -0.6));
    const top = ss.map((s) => at(s, out, 1.1));
    const m = strip(e < 0 ? top : base, e < 0 ? base : top, 16, ss, wallMat);
    // 帯のテクスチャは縦横を入れ替えて使う（u=高さ）。uv を作り直す
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < ss.length; i++) { uv.setXY(i * 2, ss[i] / 16, e < 0 ? 0 : 1); uv.setXY(i * 2 + 1, ss[i] / 16, e < 0 ? 1 : 0); }
    m.receiveShadow = true;
    group.add(m);
    // 路面の端から壁までのすき間（緑地）は地面に任せる。高い所では路面の下へ側面を下ろす
    // 路面の横の面: 低い所は地面まで（土手）、高い所は厚さ 1.6m の橋げただけ（下は橋脚。巨大な壁に見えないように）
    const skirt = strip(ss.map((s) => at(s, e, 0.02)), ss.map((s) => { const p = at(s, e, 0); p.y = Math.max(-0.5, p.y - 1.6); return p; }), 16, ss, new THREE.MeshStandardMaterial({ color: 0xa4a9b1, roughness: 0.9, side: THREE.DoubleSide }));
    group.add(skirt);
  }

  // 高架の裏面と橋脚（路面が地面から 2m 以上の所）
  {
    const under = strip(ss.map((s) => { const p = at(s, 1, 0); p.y -= 1.6; return p; }), ss.map((s) => { const p = at(s, -1, 0); p.y -= 1.6; return p; }), 16, ss, new THREE.MeshStandardMaterial({ color: 0x7d828a, roughness: 0.95 }));
    group.add(under);
    const pier = new THREE.BoxGeometry(1, 1, 1), pierMat = new THREE.MeshStandardMaterial({ color: 0xb0b5bc, roughness: 0.85 });
    const ms: THREE.Matrix4[] = [];
    for (let s = 0; s < L; s += 36) {
      const f = track.frameAt(s);
      const h = f.position.y - 1.6 + 0.5;
      if (h < 1.5) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(f.tangent.x, f.tangent.z));
      for (const side of [-0.55, 0.55]) {
        const p = track.frameAt(s, side).position;
        ms.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, -0.5 + h / 2, p.z), q, new THREE.Vector3(2.2, h, 2.2)));
      }
    }
    if (ms.length) { const im = new THREE.InstancedMesh(pier, pierMat, ms.length); ms.forEach((m, i) => im.setMatrixAt(i, m)); im.computeBoundingSphere(); group.add(im); }
  }
  // コース脇: 置き場所はコースから離れた所（ほかの区間の路面に重ならないように中心線との距離で確かめる）
  const cl: THREE.Vector3[] = [];
  for (let s = 0; s < L; s += 10) cl.push(track.frameAt(s).position);
  const clearOf = (p: THREE.Vector3, r: number) => cl.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 > r * r);

  // 観客席: スタートから前後の直線の右側（コースの外側へ向けて）
  const crowd = crowdTex();
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.5, metalness: 0.1 });
  for (const [s0, len, side] of [[-260, 240, 1], [30, 300, 1], [-200, 160, -1]] as const) {
    const sm = s0 + len / 2;
    if (track.curvatureAt(sm).k > 1 / 2000) continue;
    const f = track.frameAt(sm, side * (1 + 6 / hw));
    const stand = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const tex = crowd.clone(); tex.repeat.set(len / 12, 1); tex.needsUpdate = true;
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 1.8), [seatMat, seatMat, seatMat, seatMat, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), seatMat]);
      step.position.set(0, 0.6 + i * 1.2, -i * 1.8);
      step.castShadow = false; step.receiveShadow = true;
      stand.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.4, 14), roofMat);
    roof.position.set(0, 11.5, -5); roof.rotation.x = -0.1;
    stand.add(roof);
    for (let x = -len / 2; x <= len / 2; x += 20) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11.5, 0.5), seatMat);
      post.position.set(x, 5.75, -11);
      stand.add(post);
    }
    stand.position.copy(f.position).setY(-0.5);
    stand.rotation.y = Math.atan2(-side * f.normal.x, -side * f.normal.z);
    group.add(stand);
  }
  // 同じ形・同じ材質の物はまとめて1回で描く（描く回数を減らしてスマホで軽く）
  const batches = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; ms: THREE.Matrix4[] }>();
  const tmp = new THREE.Object3D();
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, o: THREE.Object3D) => {
    o.updateMatrix();
    const k = geo.uuid + mat.uuid;
    const b = batches.get(k) ?? { geo, mat, ms: [] };
    b.ms.push(o.matrix.clone());
    batches.set(k, b);
  };
  // のぼり旗: 直線の両脇、壁の外 3m に 40m ごと（メインストレートとその前後だけ）
  const flagMats = [210, 280, 330].map((h) => new THREE.MeshStandardMaterial({ map: flagTex(h), roughness: 0.7, side: THREE.DoubleSide }));
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.6 });
  const flagGeo = new THREE.PlaneGeometry(1.6, 6), poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 9, 6);
  let fi = 0;
  for (let s = -400; s < 900; s += 40) {
    if (track.curvatureAt(s).k > 1 / 2000) continue;
    for (const side of [-1, 1]) {
      const f = track.frameAt(s, side * (1 + 4 / hw));
      tmp.position.copy(f.position).setY(5.5); tmp.rotation.set(0, Math.atan2(f.normal.x, f.normal.z), 0);
      put(flagGeo, flagMats[fi++ % flagMats.length], tmp);
      tmp.position.copy(f.position).addScaledVector(f.tangent, -0.85).setY(4); tmp.rotation.set(0, 0, 0);
      put(poleGeo, poleMat, tmp);
    }
  }
  // 矢印看板: コーナーの外側、壁の外 2m に 30m ごと
  const chevL = new THREE.MeshStandardMaterial({ map: chevronTex(-1), roughness: 0.6 }), chevR = new THREE.MeshStandardMaterial({ map: chevronTex(1), roughness: 0.6 });
  const signGeo = new THREE.PlaneGeometry(6, 2.25);
  const legGeo = new THREE.BoxGeometry(0.15, 2.4, 0.15);
  for (let s = 0; s < L; s += 30) {
    const c = track.curvatureAt(s);
    if (c.k < 1 / 700) continue;
    const outside = -c.inside;
    const f = track.frameAt(s, outside * (1 + 3.5 / hw));
    // 看板の表を走ってくる車へ向ける（進行方向の逆）
    tmp.position.copy(f.position).setY(f.position.y + 2.6); tmp.rotation.set(0, Math.atan2(-f.tangent.x, -f.tangent.z), 0);
    put(signGeo, c.inside > 0 ? chevR : chevL, tmp);
    tmp.rotation.set(0, 0, 0);
    for (const dx of [-2, 2]) {
      tmp.position.copy(f.position).addScaledVector(f.normal, dx).setY(f.position.y + 0.7);
      put(legGeo, poleMat, tmp);
    }
  }
  for (const b of batches.values()) {
    const im = new THREE.InstancedMesh(b.geo, b.mat, b.ms.length);
    b.ms.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    group.add(im);
  }
  // 木: コースから 25m 以上離れた所に、2段の円錐の木をまとめて描く
  {
    const box = new THREE.Box3().setFromPoints(cl).expandByScalar(220);
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < 12000 && spots.length < 1400; i++) {
      // コースのそばに多め（コースの点のまわりにばらまく）＋全体にも少し
      let p: THREE.Vector3;
      if (rnd() < 0.8) {
        const q = cl[Math.floor(rnd() * cl.length)], a = rnd() * Math.PI * 2, r = hw + 25 + rnd() * 120;
        p = new THREE.Vector3(q.x + Math.cos(a) * r, 0, q.z + Math.sin(a) * r);
      } else p = new THREE.Vector3(box.min.x + rnd() * (box.max.x - box.min.x), 0, box.min.z + rnd() * (box.max.z - box.min.z));
      if (!clearOf(p, hw + 22)) continue;
      spots.push(p);
    }
    const lower = new THREE.ConeGeometry(3.4, 7, 7), upper = new THREE.ConeGeometry(2.4, 6, 7), trunk = new THREE.CylinderGeometry(0.35, 0.45, 3, 5);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x24502e, roughness: 0.95, flatShading: true });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x2e6238, roughness: 0.95, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1 });
    const a = new THREE.InstancedMesh(lower, leafMat, spots.length), b = new THREE.InstancedMesh(upper, leafMat2, spots.length), t = new THREE.InstancedMesh(trunk, trunkMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    spots.forEach((p, i) => {
      const k = 0.8 + rnd() * 1.2;
      q.setFromAxisAngle(UP, rnd() * 6.28);
      const sc = new THREE.Vector3(k, k * (0.9 + rnd() * 0.4), k);
      a.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, -0.5 + (3 + 3.5) * sc.y, p.z), q, sc));
      b.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, -0.5 + (3 + 7.5) * sc.y, p.z), q, sc));
      t.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, -0.5 + 1.5 * sc.y, p.z), q, sc));
    });
    group.add(a, b, t);
  }
  // 遠くの山: コース全体を囲む輪に低い山を並べる（霧で青くかすむ）
  {
    const box = new THREE.Box3().setFromPoints(cl);
    const c = box.getCenter(new THREE.Vector3());
    const R = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 + 900;
    const geo = new THREE.ConeGeometry(1, 1, 6);
    const N = 70;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x4d6a58, roughness: 1, flatShading: true }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + rnd() * 0.05, r = R + rnd() * 400;
      const h = 120 + rnd() * 260, w = 260 + rnd() * 320;
      q.setFromAxisAngle(UP, rnd() * 6.28);
      im.setMatrixAt(i, m.compose(new THREE.Vector3(c.x + Math.cos(ang) * r, -0.5 + h / 2, c.z + Math.sin(ang) * r), q, new THREE.Vector3(w, h, w)));
    }
    group.add(im);
  }

  // 空のドーム（カメラについて動かす）
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2800, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.08),
    new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  group.add(sky);

  // 太陽（影は車のまわり 60m 四方だけ）
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a40, 0.9);
  group.add(hemi);

  // タイヤスモーク（板を車のまわりに出して、カメラへ向ける）
  const SMOKE_MAX = 90;
  const smokeMat = new THREE.SpriteMaterial({ map: smokeTex(), transparent: true, depthWrite: false, opacity: 0.8 });
  const puffs: { sp: THREE.Sprite; vel: THREE.Vector3; age: number; life: number; size: number }[] = [];
  for (let i = 0; i < SMOKE_MAX; i++) {
    const sp = new THREE.Sprite(smokeMat.clone());
    sp.visible = false;
    group.add(sp);
    puffs.push({ sp, vel: new THREE.Vector3(), age: 1, life: 1, size: 1 });
  }
  let next = 0, smokeLimit = SMOKE_MAX;

  return {
    group, sky, sun,
    update(car, camera, dt) {
      sky.position.copy(camera.position).setY(-0.5);
      sun.target.position.copy(car);
      sun.position.copy(car).addScaledVector(SUN_DIR, 100);
      for (const p of puffs) {
        if (!p.sp.visible) continue;
        p.age += dt;
        if (p.age >= p.life) { p.sp.visible = false; continue; }
        const r = p.age / p.life;
        p.sp.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-2.2 * dt));
        p.vel.y += 0.6 * dt;
        const s = p.size * (1 + r * 2.4);
        p.sp.scale.set(s, s, 1);
        (p.sp.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - r) * Math.min(1, r * 8);
      }
    },
    emitSmoke(pos, vel, strength) {
      const cnt = Math.min(3, Math.ceil(strength * 3));
      for (let k = 0; k < cnt; k++) {
        const p = puffs[next];
        next = (next + 1) % smokeLimit;
        p.sp.visible = true;
        p.age = 0; p.life = 0.9 + Math.random() * 0.8;
        p.size = 2 + Math.random() * 1.6;
        p.sp.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8));
        p.vel.copy(vel).multiplyScalar(0.25).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2));
      }
    },
    setQuality(q, renderer) {
      const hi = q === 'high';
      renderer.shadowMap.enabled = hi;
      sun.castShadow = hi;
      smokeLimit = hi ? SMOKE_MAX : 30;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, hi ? 2 : 1));
      // 影の切り替えは材質の作り直しが要る
      group.traverse((o) => { if (o instanceof THREE.Mesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh || o instanceof THREE.Sprite) {
          o.geometry?.dispose();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m: THREE.Material & { map?: THREE.Texture | null }) => { m.map?.dispose(); m.dispose(); });
        }
      });
    },
  };
}
