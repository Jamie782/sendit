// SEND IT — bike / e-bike / scooter / e-scooter stunt game
// Three.js, arcade physics, procedural world. No external assets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ───────────────────────── helpers ─────────────────────────
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = t => t * t * (3 - 2 * t);
const _up0 = new THREE.Vector3(0, 1, 0);
const grassTime = { value: 0 };
const rand = (a, b) => a + Math.random() * (b - a);
let seed = 1337;
const srand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const store = {
  get(k, d) { try { const v = localStorage.getItem('sendit.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sendit.' + k, JSON.stringify(v)); } catch { } }
};
const IS_TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');

// ───────────────────────── renderer ─────────────────────────
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 2500);

const QUALITY = {
  low: { pr: 1, shadow: 1024, shadowSize: 50, bloom: false, samples: 0, ao: false, grass: 6000 },
  medium: { pr: Math.min(devicePixelRatio, 1.5), shadow: 2048, shadowSize: 70, bloom: true, samples: 4, ao: false, grass: 22000 },
  high: { pr: Math.min(devicePixelRatio, 2), shadow: 4096, shadowSize: 90, bloom: true, samples: 4, ao: true, grass: 45000 },
};
let qualityName = store.get('quality', IS_TOUCH ? 'low' : 'high');
let composer, bloomPass, aoPass, grassReady = false;
function buildComposer() {
  const q = QUALITY[qualityName];
  renderer.setPixelRatio(q.pr);
  renderer.setSize(innerWidth, innerHeight, false);
  const rt = new THREE.WebGLRenderTarget(innerWidth * q.pr, innerHeight * q.pr, { type: THREE.HalfFloatType, samples: q.samples });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(q.pr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  aoPass = null;
  if (q.ao) {
    // ground-truth ambient occlusion: contact darkening under ramps, cars, kerbs and the rider
    aoPass = new GTAOPass(scene, camera, innerWidth * q.pr, innerHeight * q.pr);
    aoPass.output = GTAOPass.OUTPUT.Default;
    aoPass.blendIntensity = 0.9;
    aoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    composer.addPass(aoPass);
  }
  if (q.bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.16, 0.4, 2.8);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());
  if (sun) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    const s = q.shadowSize; Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s }); sun.shadow.camera.updateProjectionMatrix();
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  if (grassReady) grassMesh.count = Math.min(q.grass, grassMesh.userData.max);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  if (aoPass) aoPass.setSize(innerWidth * QUALITY[qualityName].pr, innerHeight * QUALITY[qualityName].pr);
});

// ───────────────────────── sky, light, fog ─────────────────────────
const sky = new Sky();
sky.scale.setScalar(4000);
const su = sky.material.uniforms;
su.turbidity.value = 5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.85;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(215));
su.sunPosition.value.copy(sunDir);
if (su.showSunDisc) su.showSunDisc.value = 1;
// clamp sky radiance so bloom only catches lamps, headlights and the sun sprite
sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor, vec3( 1.6 ) ), 1.0 );');
if (su.cloudCoverage) { su.cloudCoverage.value = 0.36; su.cloudDensity.value = 0.5; }
scene.add(sky);

// environment map from sky (drives reflections in glass, paint, chrome and concrete)
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function buildEnv(groundCol = 0x4a463e, blockCol = 0x2c2f35) {
  const envScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000);
  for (const k in su) s2.material.uniforms[k].value = su[k].value && su[k].value.clone ? su[k].value.clone() : su[k].value;
  if (s2.material.uniforms.showSunDisc) s2.material.uniforms.showSunDisc.value = 0;
  envScene.add(s2);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: groundCol }));
  ground.position.y = -5; envScene.add(ground);
  seed = 5;
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, h = 40 + srand() * 120;
    const b = new THREE.Mesh(new THREE.BoxGeometry(60, h, 60), new THREE.MeshBasicMaterial({ color: blockCol }));
    b.position.set(Math.cos(a) * 500, h / 2 - 5, Math.sin(a) * 500); envScene.add(b);
  }
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
}
scene.fog = new THREE.FogExp2(0xc4c9cc, 0.0011);

const sun = new THREE.DirectionalLight(0xffd9b0, 4.2);
sun.castShadow = true;
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60; sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xa9c1e0, 0x5e5243, 0.9); scene.add(hemi);

// ───────────────────────── procedural textures ─────────────────────────
function makeCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO; return t;
}
function noiseCanvas(size, base, varAmt, opts = {}) {
  const W = size, H = opts.h || size;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H; i++) {
    const n = (Math.random() - 0.5) * varAmt + (opts.speck && Math.random() < opts.speck ? (Math.random() - 0.3) * 90 : 0);
    d[i * 4] = clamp(base[0] + n, 0, 255); d[i * 4 + 1] = clamp(base[1] + n * (opts.tint ?? 1), 0, 255); d[i * 4 + 2] = clamp(base[2] + n * (opts.tint ?? 1), 0, 255); d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  blotches(g, W, H, opts.blotches ?? 30, opts.blotchAmt ?? 0.09);
  return { c, g };
}
function blotches(g, W, H, n, amt = 0.09) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = rand(W * 0.03, W * 0.18);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = rand(0.03, amt), dark = Math.random() < 0.6;
    gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
}
function crack(g, W, H, x, y, len, width = 1.5, col = 'rgba(15,15,15,.75)') {
  g.strokeStyle = col; g.lineWidth = width; g.lineCap = 'round';
  let a = rand(0, Math.PI * 2);
  g.beginPath(); g.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    a += rand(-0.6, 0.6); x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y);
    if (Math.random() < 0.05) { g.stroke(); crack(g, W, H, x, y, len * 0.4, width * 0.7, col); g.beginPath(); g.moveTo(x, y); }
  }
  g.stroke();
}
function normalFromCanvas(srcCanvas, strength = 2, invert = false) {
  const W = srcCanvas.width, H = srcCanvas.height, g = srcCanvas.getContext('2d');
  const s = g.getImageData(0, 0, W, H).data;
  const c = makeCanvas(W, H), o = c.getContext('2d'), img = o.createImageData(W, H), d = img.data;
  const L = (x, y) => { x = (x + W) % W; y = (y + H) % H; const i = (y * W + x) * 4; return (s[i] + s[i + 1] + s[i + 2]) / 765; };
  const k = invert ? -1 : 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * strength * k, dy = (L(x, y + 1) - L(x, y - 1)) * strength * k;
    const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * W + x) * 4;
    d[i] = (-dx * il * 0.5 + 0.5) * 255; d[i + 1] = (-dy * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  o.putImageData(img, 0, 0); return tex(c, { srgb: false });
}
function greyCanvas(W, H, v) { const c = makeCanvas(W, H), g = c.getContext('2d'); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, 0, W, H); return { c, g }; }

// asphalt: aggregate, cracks, patches, oil
const asphalt = noiseCanvas(1024, [64, 64, 67], 30, { speck: 0.08, blotches: 80 });
{
  const g = asphalt.g;
  for (let i = 0; i < 14000; i++) { const v = rand(70, 150); g.fillStyle = `rgba(${v},${v},${v - 4},${rand(0.25, 0.7)})`; const s = rand(1, 2.6); g.fillRect(rand(0, 1024), rand(0, 1024), s, s); }
  for (let i = 0; i < 3; i++) { g.fillStyle = `rgba(20,20,22,${rand(0.06, 0.12)})`; const w = rand(80, 260), h = rand(60, 200), x = rand(0, 900), y = rand(0, 900); g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(10,10,10,.2)'; g.lineWidth = 2; g.strokeRect(x, y, w, h); }
  for (let i = 0; i < 9; i++) crack(g, 1024, 1024, rand(0, 1024), rand(0, 1024), rand(10, 40), rand(1, 2.2));
  for (let i = 0; i < 6; i++) { const x = rand(0, 1024), y = rand(0, 1024), r = rand(12, 50); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(8,8,10,.4)'); gr.addColorStop(1, 'rgba(8,8,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
}
// UK paving slabs (600 mm) — 512px = 2.4 m
const paving = noiseCanvas(512, [158, 155, 148], 14, { blotches: 30 });
{
  const g = paving.g;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = rand(-14, 14); g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 160})` : `rgba(0,0,0,${-v / 140})`; g.fillRect(x * 128, y * 128, 128, 128); }
  g.strokeStyle = 'rgba(55,52,48,.85)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
  for (let i = 0; i < 3; i++) crack(g, 512, 512, rand(0, 512), rand(0, 512), rand(5, 14), 1, 'rgba(40,38,35,.6)');
  for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(30,28,25,${rand(0.08, 0.2)})`; g.beginPath(); g.arc(rand(0, 512), rand(0, 512), rand(2, 6), 0, 7); g.fill(); } // gum spots
}
// trowelled skatepark concrete with stains and control joints (1024 = 6 m)
const skate = noiseCanvas(1024, [190, 187, 181], 10, { blotches: 60, blotchAmt: 0.06 });
{
  const g = skate.g;
  for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(255,255,255,${rand(0.02, 0.06)})`; g.lineWidth = rand(4, 14); g.beginPath(); const x = rand(0, 1024), y = rand(0, 1024), r = rand(40, 160), a = rand(0, 6); g.arc(x, y, r, a, a + rand(0.4, 1.4)); g.stroke(); }
  for (let i = 0; i < 18; i++) { const x = rand(0, 1024), y = rand(0, 1024), r = rand(20, 110); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(60,50,40,${rand(0.06, 0.16)})`); gr.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(30,30,30,${rand(0.08, 0.25)})`; g.lineWidth = rand(1, 3); g.beginPath(); const x = rand(0, 1024), y = rand(0, 1024); g.moveTo(x, y); g.lineTo(x + rand(-80, 80), y + rand(-80, 80)); g.stroke(); } // wheel scuffs
  for (let i = 0; i < 4; i++) crack(g, 1024, 1024, rand(0, 1024), rand(0, 1024), rand(8, 24), 1.2, 'rgba(50,48,45,.55)');
  g.strokeStyle = 'rgba(70,68,64,.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 2); g.lineTo(1024, 2); g.moveTo(2, 0); g.lineTo(2, 1024); g.stroke();
}
const grassC = noiseCanvas(512, [70, 98, 44], 40, { tint: 0.8, blotches: 70 });
{ const g = grassC.g; for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rand(55, 130)},${rand(100, 160)},${rand(28, 60)},.55)`; g.fillRect(rand(0, 512), rand(0, 512), 1, rand(2, 6)); } for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(120,100,60,${rand(.1, .3)})`; g.fillRect(rand(0, 512), rand(0, 512), rand(2, 5), rand(1, 3)); } }
// packed dirt with pebbles and tyre ruts
const dirtC = noiseCanvas(1024, [132, 96, 66], 34, { speck: 0.05, blotches: 90 });
{
  const g = dirtC.g;
  for (let i = 0; i < 6000; i++) { const v = rand(-50, 70); g.fillStyle = v > 0 ? `rgba(220,200,175,${rand(.2, .6)})` : `rgba(40,25,15,${rand(.2, .5)})`; g.beginPath(); g.arc(rand(0, 1024), rand(0, 1024), rand(0.8, 3), 0, 7); g.fill(); }
  for (let k = 0; k < 7; k++) { const x0 = rand(0, 1024); g.strokeStyle = `rgba(60,40,25,${rand(.08, .2)})`; g.lineWidth = rand(8, 20); g.beginPath(); for (let y = -20; y <= 1044; y += 32) g.lineTo(x0 + Math.sin(y * 0.01 + k) * 30, y); g.stroke(); }
}
// plywood sheets with screws (1024 = 4.8 m x 2.4 m sheets)
const woodC = (() => {
  const c = makeCanvas(1024), g = c.getContext('2d');
  for (let s = 0; s < 4; s++) {
    const base = [rand(176, 200), rand(140, 158), rand(98, 112)];
    g.fillStyle = `rgb(${base})`; g.fillRect(0, s * 256, 1024, 256);
    for (let k = 0; k < 260; k++) { g.strokeStyle = `rgba(110,70,35,${rand(0.03, 0.09)})`; g.lineWidth = rand(1, 3); g.beginPath(); const y = s * 256 + rand(0, 256); g.moveTo(0, y); for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x * 0.01 + k) * rand(1, 5)); g.stroke(); }
    for (let k = 0; k < 6; k++) { const x = rand(0, 1024), y = s * 256 + rand(20, 236); g.fillStyle = 'rgba(90,55,25,.35)'; g.beginPath(); g.ellipse(x, y, rand(6, 14), rand(3, 6), 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(40,25,12,.65)'; g.fillRect(0, s * 256, 1024, 3);
    g.fillRect(512, s * 256, 3, 256);
    g.fillStyle = 'rgba(50,50,55,.85)'; for (let x = 20; x < 1024; x += 100) for (const yy of [14, 128, 242]) { g.beginPath(); g.arc(x, s * 256 + yy, 2.5, 0, 7); g.fill(); }
  }
  blotches(g, 1024, 1024, 40, 0.08);
  for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(30,30,30,${rand(.1, .3)})`; g.lineWidth = rand(1, 3); g.beginPath(); const x = rand(0, 1024), y = rand(0, 1024); g.moveTo(x, y); g.lineTo(x + rand(-120, 120), y + rand(-20, 20)); g.stroke(); }
  return { c, g };
})();
// knobby tyre tread (height map → normal), u = around wheel, v = across tread
const treadC = (() => {
  const c = makeCanvas(256, 64), g = c.getContext('2d');
  g.fillStyle = '#202020'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#f0f0f0';
  for (let i = 0; i < 16; i++) { const x = i * 16; g.fillRect(x + 2, (i % 2) ? 6 : 14, 9, 10); g.fillRect(x + 2, (i % 2) ? 40 : 46, 9, 10); g.fillRect(x + 4, 26, 7, 12); }
  return c;
})();
const slickC = (() => { const c = makeCanvas(256, 64), g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#555'; for (let i = 0; i < 32; i++) { g.save(); g.translate(i * 8, 32); g.rotate(0.6); g.fillRect(-1, -12, 2, 9); g.restore(); g.save(); g.translate(i * 8 + 4, 32); g.rotate(-0.6); g.fillRect(-1, 3, 2, 9); g.restore(); } return c; })();

const corrC = (() => { const c = makeCanvas(256, 64), g = c.getContext('2d'); for (let x = 0; x < 256; x++) { const v = 128 + Math.sin(x / 256 * Math.PI * 2 * 8) * 110; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 64); } return c; })();
const sandC = noiseCanvas(512, [214, 196, 160], 22, { blotches: 40 });
{ const g = sandC.g; for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${rand(150, 255)},${rand(140, 230)},${rand(110, 190)},.5)`; g.fillRect(rand(0, 512), rand(0, 512), 1.5, 1.5); } for (let k = 0; k < 14; k++) { g.strokeStyle = 'rgba(150,130,100,.12)'; g.lineWidth = 3; g.beginPath(); const y = rand(0, 512); for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + k) * 8); g.stroke(); } }
const gravelC = noiseCanvas(512, [128, 122, 112], 50, { speck: 0.2, blotches: 50 });
const T = {
  corrugated: (() => { const t = normalFromCanvas(corrC, 5); return t; })(),
  sand: tex(sandC.c), sandN: normalFromCanvas(sandC.c, 1.5), gravel: tex(gravelC.c), gravelN: normalFromCanvas(gravelC.c, 1.2),
  asphalt: tex(asphalt.c), asphaltN: normalFromCanvas(asphalt.c, 1.6),
  paving: tex(paving.c), pavingN: normalFromCanvas(paving.c, 2.2),
  grass: tex(grassC.c), grassN: normalFromCanvas(grassC.c, 2),
  dirt: tex(dirtC.c), dirtN: normalFromCanvas(dirtC.c, 3),
  wood: tex(woodC.c), woodN: normalFromCanvas(woodC.c, 1.2),
  skate: tex(skate.c), skateN: normalFromCanvas(skate.c, 0.9),
  tread: (() => { const t = normalFromCanvas(treadC, 6); t.repeat.set(10, 1); return t; })(),
  slick: (() => { const t = normalFromCanvas(slickC, 3); t.repeat.set(8, 1); return t; })(),
};

function roadTexture() {
  const W = 512, H = 2048, c = makeCanvas(W, H), g = c.getContext('2d');
  for (let y = 0; y < H; y += 512) g.drawImage(asphalt.c, 0, 0, 1024, 1024, 0, y, 512, 512);
  // tyre polish in the wheel paths
  for (const x of [95, 180, 330, 415]) { const gr = g.createLinearGradient(x - 30, 0, x + 30, 0); gr.addColorStop(0, 'rgba(10,10,12,0)'); gr.addColorStop(0.5, 'rgba(10,10,12,.22)'); gr.addColorStop(1, 'rgba(10,10,12,0)'); g.fillStyle = gr; g.fillRect(x - 30, 0, 60, H); }
  // worn white lines (UK: thin edge lines, long-dash centre line)
  const line = (x, y, w, h) => { g.fillStyle = 'rgba(232,232,222,.9)'; g.fillRect(x, y, w, h); for (let i = 0; i < w * h / 25; i++) { g.fillStyle = 'rgba(70,70,72,.55)'; g.fillRect(x + rand(0, w), y + rand(0, h), rand(1, 3), rand(1, 4)); } };
  line(22, 0, 7, H); line(W - 29, 0, 7, H);
  for (let y = 0; y < H; y += 512) line(W / 2 - 4, y + 60, 8, 300);
  // drain covers by the kerb
  for (const y of [400, 1500]) for (const x of [36, W - 64]) { g.fillStyle = '#222'; g.fillRect(x, y, 28, 52); g.fillStyle = '#3a3a3a'; for (let k = 0; k < 7; k++) g.fillRect(x + 3, y + 4 + k * 7, 22, 3); }
  return c;
}
const roadC = roadTexture();
T.road = tex(roadC); T.roadN = normalFromCanvas(roadC, 1.4);

// building facades: recessed reflective windows; brick or render
function brickWall(g, S, base) {
  g.fillStyle = '#8f8a80'; g.fillRect(0, 0, S, S); // mortar
  const bh = 9, bw = 24;
  for (let y = 0, row = 0; y < S; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < S; x += bw) {
    const v = rand(-22, 22); g.fillStyle = `rgb(${clamp(base[0] + v, 0, 255)},${clamp(base[1] + v * 0.7, 0, 255)},${clamp(base[2] + v * 0.6, 0, 255)})`;
    g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
  }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${rand(0, .07)})`; g.fillRect(rand(0, S), rand(0, S), 2, 2); }
}
function facade(style) {
  const S = 512, cols = 4, rows = 4, cw = S / cols, ch = S / rows;
  const c = makeCanvas(S), g = c.getContext('2d');
  const e = makeCanvas(S), ge = e.getContext('2d');
  const r = greyCanvas(S, S, 220), h = greyCanvas(S, S, 255);
  if (style.brick) brickWall(g, S, style.brick);
  else { g.fillStyle = style.wall; g.fillRect(0, 0, S, S); for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${rand(0, 0.05)})`; g.fillRect(rand(0, S), rand(0, S), 2, 2); } blotches(g, S, S, 25, 0.07); }
  // rain streaks
  for (let i = 0; i < 40; i++) { const x = rand(0, S), y = rand(0, S); const gr = g.createLinearGradient(x, y, x, y + 80); gr.addColorStop(0, 'rgba(30,30,30,.12)'); gr.addColorStop(1, 'rgba(30,30,30,0)'); g.fillStyle = gr; g.fillRect(x, y, rand(2, 6), 80); }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  for (let ry = 0; ry < rows; ry++) for (let q = 0; q < cols; q++) {
    const x = q * cw + cw * 0.2, y = ry * ch + ch * 0.18, w = cw * 0.6, hh = ch * 0.6;
    // frame
    g.fillStyle = style.frame; g.fillRect(x - 5, y - 5, w + 10, hh + 10);
    h.g.fillStyle = 'rgb(170,170,170)'; h.g.fillRect(x - 5, y - 5, w + 10, hh + 10);
    r.g.fillStyle = 'rgb(120,120,120)'; r.g.fillRect(x - 5, y - 5, w + 10, hh + 10);
    // glass
    const gr = g.createLinearGradient(x, y, x + w * 0.6, y + hh);
    gr.addColorStop(0, style.glass[0]); gr.addColorStop(1, style.glass[1]);
    g.fillStyle = gr; g.fillRect(x, y, w, hh);
    h.g.fillStyle = 'rgb(70,70,70)'; h.g.fillRect(x, y, w, hh);
    r.g.fillStyle = 'rgb(14,14,14)'; r.g.fillRect(x, y, w, hh);
    // curtains / blinds in some windows
    if (Math.random() < 0.35) { g.fillStyle = `rgba(${rand(150, 230)},${rand(140, 210)},${rand(120, 190)},.55)`; g.fillRect(x, y, w * rand(0.2, 0.45), hh); r.g.fillStyle = 'rgb(160,160,160)'; }
    // mullions
    g.fillStyle = style.frame; g.fillRect(x + w / 2 - 2, y, 4, hh); g.fillRect(x, y + hh * 0.35, w, 4);
    h.g.fillStyle = 'rgb(160,160,160)'; h.g.fillRect(x + w / 2 - 2, y, 4, hh); h.g.fillRect(x, y + hh * 0.35, w, 4);
    // sill + lintel
    g.fillStyle = style.sill; g.fillRect(x - 10, y + hh + 5, w + 20, 8); g.fillRect(x - 8, y - 12, w + 16, 7);
    h.g.fillStyle = '#fff'; h.g.fillRect(x - 10, y + hh + 5, w + 20, 8);
    if (Math.random() < 0.3) { ge.fillStyle = `rgb(${rand(210, 255)},${rand(165, 205)},${rand(95, 135)})`; ge.fillRect(x + 2, y + 2, w - 4, hh - 4); }
  }
  return {
    map: tex(c), emissive: tex(e), rough: tex(r.c, { srgb: false }), normal: normalFromCanvas(h.c, 3),
  };
}
const FACADE_STYLES = [
  { brick: [150, 72, 52], frame: '#e8e6e0', sill: '#cfc8b8', glass: ['#26323e', '#6e8396'] },
  { brick: [118, 62, 48], frame: '#2a2a2c', sill: '#bdb6a6', glass: ['#1f2a35', '#5f7488'] },
  { brick: [170, 120, 80], frame: '#f2f0ea', sill: '#ddd5c4', glass: ['#28343f', '#7c90a2'] },
  { wall: '#d9d3c6', frame: '#3a3d42', sill: '#bdb6a6', glass: ['#1c2733', '#6a8095'] },
  { wall: '#9aa1a6', frame: '#202224', sill: '#8e9296', glass: ['#18222c', '#55697c'] },
  { wall: '#c9b79a', frame: '#f4f2ec', sill: '#e0d6c2', glass: ['#253039', '#71879a'] },
];
const FACADES = FACADE_STYLES.map(st => {
  const t = facade(st);
  return new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0.55, roughnessMap: t.rough, roughness: 1, normalMap: t.normal, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.0 });
});
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.95 });

function softCircle() {
  const c = makeCanvas(64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}
function graffitiTex(seedText) {
  const c = makeCanvas(1024, 256), g = c.getContext('2d');
  g.drawImage(skate.c, 0, 0, 1024, 256, 0, 0, 1024, 256); g.fillStyle = 'rgba(120,115,105,.35)'; g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${rand(0, .08)})`; g.fillRect(rand(0, 1024), rand(0, 256), 3, 3); }
  const cols = ['#ff4d1f', '#ffc531', '#2ad1ff', '#b14dff', '#3dff8a', '#ff3b8d'];
  for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % cols.length] + '55'; g.beginPath(); g.ellipse(rand(0, 1024), rand(40, 220), rand(60, 180), rand(30, 80), rand(0, 3), 0, 7); g.fill(); }
  g.font = 'italic 900 150px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = '#111'; g.strokeText(seedText, 512, 135);
  const gr = g.createLinearGradient(0, 60, 0, 210); gr.addColorStop(0, cols[Math.floor(rand(0, 6))]); gr.addColorStop(1, cols[Math.floor(rand(0, 6))]);
  g.fillStyle = gr; g.fillText(seedText, 512, 135);
  g.lineWidth = 3; g.strokeStyle = '#fff'; g.strokeText(seedText, 512, 135);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}


// ───────────────────────── materials ─────────────────────────
const fabric = (color, sheen = 0x666666) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, sheen: 1, sheenRoughness: 0.75, sheenColor: sheen });
const M = {
  grass: new THREE.MeshStandardMaterial({ map: T.grass, normalMap: T.grassN, roughness: 1, vertexColors: true }),
  road: new THREE.MeshStandardMaterial({ map: T.road, normalMap: T.roadN, roughness: 0.88 }),
  asphalt: new THREE.MeshStandardMaterial({ map: T.asphalt, normalMap: T.asphaltN, roughness: 0.9 }),
  sidewalk: new THREE.MeshStandardMaterial({ map: T.paving, normalMap: T.pavingN, roughness: 0.85 }),
  kerb: new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.8, normalMap: T.skateN }),
  park: new THREE.MeshStandardMaterial({ map: T.skate, normalMap: T.skateN, roughness: 0.78, metalness: 0 }),
  rampTop: new THREE.MeshStandardMaterial({ map: T.skate, normalMap: T.skateN, roughness: 0.62, metalness: 0 }),
  rampSide: new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.85, normalMap: T.skateN }),
  dirt: new THREE.MeshStandardMaterial({ map: T.dirt, normalMap: T.dirtN, roughness: 1 }),
  dirtRamp: new THREE.MeshStandardMaterial({ map: T.dirt, normalMap: T.dirtN, color: 0xc49a76, roughness: 0.97 }),
  wood: new THREE.MeshStandardMaterial({ map: T.wood, normalMap: T.woodN, roughness: 0.72 }),
  woodSide: new THREE.MeshStandardMaterial({ map: T.wood, color: 0x9a7a58, roughness: 0.85 }),
  coping: new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.22 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.75, roughness: 0.45 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.35 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd28a, emissiveIntensity: 4 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x4f3d2e, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }),
  hedge: new THREE.MeshStandardMaterial({ color: 0x3f5a2a, roughness: 1, normalMap: T.grassN }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.82, normalMap: T.tread, normalScale: new THREE.Vector2(1.5, 1.5) }),
  slick: new THREE.MeshStandardMaterial({ color: 0x1f1f21, roughness: 0.7, normalMap: T.slick }),
  sidewall: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.85 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe8ebef, metalness: 1, roughness: 0.15 }),
  alloy: new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 1, roughness: 0.3 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x232528, metalness: 0.8, roughness: 0.38 }),
  rotor: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 1, roughness: 0.25 }),
  chain: new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.9, roughness: 0.45 }),
  hose: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95, normalMap: T.slick }),
  saddle: new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.55, clearcoat: 0.3 }),
  griptape: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 1, normalMap: T.asphaltN, normalScale: new THREE.Vector2(2, 2) }),
  pu: new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.55 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: 0.1, roughness: 0.04, clearcoat: 1 }),
  clearGlass: new THREE.MeshPhysicalMaterial({ color: 0xbfd2dc, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.25 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 6 }),
  carLight: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.2 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 3 }),
  car: [0xb3202a, 0x1e4fa8, 0xe7e7e2, 0x1c1c1f, 0x6c7178, 0x2f6b46, 0x9aa0a6].map(c => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.65, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 })),
  plastic: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }),
  hoodie: fabric(0x2a2c31, 0x55585e),
  hood: fabric(0x2a2c31, 0x55585e),
  accent: fabric(0xff4d1f, 0xff9a70),
  pants: fabric(0x2f3a48, 0x5a6a80),
  sock: fabric(0xe8e8e8),
  shoe: new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.75 }),
  sole: new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.9 }),
  glove: fabric(0x161616, 0x444444),
  helmet: new THREE.MeshPhysicalMaterial({ color: 0xff4d1f, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
  helmetTrim: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
  visor: new THREE.MeshPhysicalMaterial({ color: 0x1a120a, roughness: 0.02, metalness: 0.6, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6 }),
  postbox: new THREE.MeshPhysicalMaterial({ color: 0xc8101b, roughness: 0.35, clearcoat: 0.6 }),
  bin: new THREE.MeshStandardMaterial({ color: 0x1d3b2a, roughness: 0.6, metalness: 0.3 }),
  benchWood: new THREE.MeshStandardMaterial({ map: T.wood, color: 0x8b6a4a, roughness: 0.8 }),
  awning: [0x1f5c3a, 0x8a1c1c, 0x1d3e73, 0x333333, 0x7a5a1e].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide })),
  shopGlass: new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.05, metalness: 0.2, emissive: 0xffe2b8, emissiveIntensity: 0.35 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.7 }),
  railMetal: new THREE.MeshStandardMaterial({ color: 0x2f3a46, metalness: 0.7, roughness: 0.35 }),
  granite: new THREE.MeshStandardMaterial({ map: T.paving, color: 0x8e8a86, roughness: 0.6, normalMap: T.pavingN, normalScale: new THREE.Vector2(0.4, 0.4) }),
  plazaFloor: new THREE.MeshStandardMaterial({ map: T.paving, color: 0xd6cfc4, normalMap: T.pavingN, roughness: 0.7 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1, normalMap: T.dirtN }),
  water: new THREE.MeshPhysicalMaterial({ color: 0x1d4a5a, roughness: 0.04, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85, normalMap: T.asphaltN, normalScale: new THREE.Vector2(0.15, 0.15) }),
  tape: new THREE.MeshStandardMaterial({ color: 0xffffff, map: (() => { const c = makeCanvas(64, 8), g = c.getContext('2d'); for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#e12020' : '#ffffff'; g.fillRect(i * 16, 0, 16, 8); } const t = tex(c); t.repeat.set(60, 1); return t; })(), side: THREE.DoubleSide, roughness: 0.6 }),
};
const SHOP_MATS = [];
Object.assign(M, {
  hillRoad: new THREE.MeshStandardMaterial({ map: T.asphalt, normalMap: T.asphaltN, roughness: 0.88 }),
  sea: new THREE.MeshPhysicalMaterial({ color: 0x1f5566, roughness: 0.08, metalness: 0.05, clearcoat: 1, normalMap: T.asphaltN.clone(), normalScale: new THREE.Vector2(0.35, 0.35) }),
  foam: new THREE.MeshStandardMaterial({ color: 0xf2f6f8, roughness: 0.9, transparent: true, opacity: 0.75 }),
  sand: new THREE.MeshStandardMaterial({ map: T.sand, normalMap: T.sandN, roughness: 1, color: 0xbfae8c }),
  sandRamp: new THREE.MeshStandardMaterial({ map: T.sand, normalMap: T.sandN, color: 0xe6d2a8, roughness: 1 }),
  bowl: new THREE.MeshStandardMaterial({ map: T.skate, normalMap: T.skateN, roughness: 0.55, vertexColors: true, color: 0x8f969c }),
  bowlDeck: new THREE.MeshStandardMaterial({ map: T.skate, normalMap: T.skateN, roughness: 0.8, color: 0x9a978f }),
  hutRoof: new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.8 }),
  kiosk: new THREE.MeshStandardMaterial({ color: 0xf3e9d2, roughness: 0.6 }),
  gravel: new THREE.MeshStandardMaterial({ map: T.gravel, normalMap: T.gravelN, roughness: 1 }),
  fence: new THREE.MeshStandardMaterial({ map: (() => { const c = makeCanvas(64), g = c.getContext('2d'); g.strokeStyle = '#c8ccd0'; g.lineWidth = 3; for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } const t = tex(c); t.repeat.set(20, 2); return t; })(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }),
  busRed: new THREE.MeshPhysicalMaterial({ color: 0xc4161c, roughness: 0.35, clearcoat: 0.8 }),
  cone: new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5 }),
  cabin: new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.6, metalness: 0.2 }),
  crane: new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.5, metalness: 0.5 }),
  concrete2: new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.9 }),
});
// push the big ground layers back in depth so flats on top never flicker at a distance
Object.assign(M.grass, { polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
Object.assign(M.sand, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
M.sea.normalMap.wrapS = M.sea.normalMap.wrapT = THREE.RepeatWrapping; M.sea.normalMap.repeat.set(60, 30);
const FOAM = [];
M.tLight = { red: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 }), amber: new THREE.MeshStandardMaterial({ color: 0x221500, emissive: 0xffa000, emissiveIntensity: 0 }), green: new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x10ff60, emissiveIntensity: 0 }) };

// ───────────────────────── world: ground & zones ─────────────────────────
const WORLD = 300;
const ZONES = {
  street: { name: 'STREET', pos: v3(-150, 0, 0), yaw: Math.PI / 2 },
  park: { name: 'SKATEPARK', pos: v3(65, 0, 52), yaw: 0 },
  dirt: { name: 'DIRT JUMPS', pos: v3(10, 0, -48), yaw: Math.PI / 2 },
  mega: { name: 'MEGA RAMP', pos: v3(98, 20, 130), yaw: Math.PI / 2 },
  plaza: { name: 'PLAZA', pos: v3(214, 1.12, 57), yaw: -Math.PI / 2 },
};
const RECTS = []; // surface rectangles: {x0,x1,z0,z1,type}
function rect(x0, x1, z0, z1, type) { RECTS.push({ x0, x1, z0, z1, type }); }
function surfaceAt(x, z) {
  for (let i = RECTS.length - 1; i >= 0; i--) { const r = RECTS[i]; if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.type; }
  return 'grass';
}

{ // grass ground with vertex-colour variation
  const geo = new THREE.PlaneGeometry(2200, 1364, 160, 100).rotateX(-Math.PI / 2).translate(0, 0, 418); // stops at the coast (sea to the south)
  const col = [], pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = 0.5 + 0.25 * Math.sin(x * 0.031 + Math.cos(z * 0.017) * 2) + 0.25 * Math.sin(z * 0.043 + x * 0.011);
    col.push(lerp(0.82, 1.08, n), lerp(0.85, 1.05, n), lerp(0.75, 0.95, n));
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.attributes.uv.array.forEach((v, i, a) => a[i] = v * (i % 2 ? 180 : 290));
  const g = new THREE.Mesh(geo, M.grass); g.receiveShadow = true; scene.add(g);
}
function flat(x0, x1, z0, z1, mat, y, uvScale = 8, type) {
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / uvScale, uv.getY(i) * d / uvScale);
  const m = new THREE.Mesh(geo, mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m);
  if (type) rect(x0, x1, z0, z1, type);
  return m;
}
function road(x0, x1, z0, z1, alongX) {
  const w = alongX ? z1 - z0 : x1 - x0, len = alongX ? x1 - x0 : z1 - z0;
  const geo = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * len / 28);
  if (alongX) geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, M.road); m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m);
  rect(x0, x1, z0, z1, 'road');
}
// main roads
road(-WORLD, WORLD, -7, 7, true);
road(-147, -133, -190, -7, false); road(-147, -133, 7, 190, false);
road(-67, -53, -190, -7, false); road(-67, -53, 7, 190, false);
road(-7, 7, -WORLD, -7, false); road(-7, 7, 7, 160, false);
for (const x of [-140, -60, 0]) { flat(x - 7, x + 7, -7, 7, M.asphalt, 0.025, 8, 'road'); }
// skatepark pad / dirt area / mega area
flat(16, 114, 20, 92, M.park, 0.03, 6, 'park');
flat(16, 156, -112, -24, M.dirt, 0.03, 10, 'dirt');
flat(86, 250, 120, 140, M.asphalt, 0.03, 8, 'road');

// ───────────────────────── ramps ─────────────────────────
const ramps = [];
const PROF = {
  kicker: (L, H, p = 1.6) => u => H * Math.pow(clamp(u / L, 0, 1), p),
  landing: (deck, L, H) => u => u <= deck ? H : H * Math.pow(1 - clamp((u - deck) / L, 0, 1), 2),
  funbox: (up, top, down, H) => u => u < up ? H * smooth(u / up) * 0.0 + H * (u / up) : u < up + top ? H : H * (1 - (u - up - top) / down),
  box: (H) => u => H,
  qp: (R, deck) => { const cap = R * 0.965; return u => u < cap ? R - Math.sqrt(R * R - u * u) : R - Math.sqrt(R * R - cap * cap); },
  rollin: (deck, L, H) => u => u <= deck ? H : H * Math.pow(1 - clamp((u - deck) / L, 0, 1), 2),
};
class Ramp {
  constructor(o) {
    Object.assign(this, { yaw: 0, width: 4, type: 'kicker', surface: 'concrete', base: 0 }, o);
    this.s = Math.sin(this.yaw); this.c = Math.cos(this.yaw);
    this.cx = this.x + this.s * this.length / 2; this.cz = this.z + this.c * this.length / 2;
    this.rad = Math.hypot(this.length, this.width) / 2 + 0.5;
    ramps.push(this);
  }
  local(x, z) { const dx = x - this.x, dz = z - this.z; return [dx * this.s + dz * this.c, dx * this.c - dz * this.s]; }
  heightAt(x, z) {
    const [u, v] = this.local(x, z);
    if (u < 0 || u > this.length || Math.abs(v) > this.width / 2) return -Infinity;
    return this.base + this.profile(u);
  }
}
function buildRampMesh(r, topMat, sideMat, { nu = 30, sloped = 0, sideMap, uvS = 3 } = {}) {
  const grp = new THREE.Group();
  const nv = 2, W = r.width, L = r.length;
  // top surface
  const pos = [], uv = [], idx = [];
  let arc = 0, prevH = r.profile(0);
  for (let i = 0; i <= nu; i++) {
    const u = (i / nu) * L, h = r.profile(u);
    if (i > 0) arc += Math.hypot(L / nu, h - prevH); prevH = h;
    for (let j = 0; j <= nv; j++) { const v = -W / 2 + (j / nv) * W; pos.push(v, h, u); uv.push(v / uvS, arc / uvS); }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx); top.computeVertexNormals();
  const tm = new THREE.Mesh(top, topMat); tm.castShadow = tm.receiveShadow = true; grp.add(tm);
  // sides
  const sp = [], su2 = [];
  const quad = (a, b, c, d, ua, ub, uc, ud) => { sp.push(...a, ...b, ...c, ...a, ...c, ...d); su2.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); };
  for (const side of [-1, 1]) {
    const vx = side * W / 2, vo = side * (W / 2 + sloped);
    for (let i = 0; i < nu; i++) {
      const u0 = (i / nu) * L, u1 = ((i + 1) / nu) * L, h0 = r.profile(u0), h1 = r.profile(u1);
      const ext0 = sloped ? vo + side * h0 * 0.6 : vx, ext1 = sloped ? vo + side * h1 * 0.6 : vx;
      const A = [vx, h0, u0], B = [vx, h1, u1], C = [ext1, 0, u1], D = [ext0, 0, u0];
      if (side < 0) quad(A, B, C, D, [u0 / L, h0 / 4], [u1 / L, h1 / 4], [u1 / L, 0], [u0 / L, 0]);
      else quad(A, D, C, B, [u0 / L, h0 / 4], [u0 / L, 0], [u1 / L, 0], [u1 / L, h1 / 4]);
    }
  }
  for (const [u, s] of [[0, -1], [L, 1]]) {
    const h = r.profile(u); if (h < 0.01) continue;
    const ex = sloped ? sloped + h * 0.6 : 0;
    const A = [-W / 2, h, u], B = [W / 2, h, u], C = [W / 2 + ex, 0, u + s * (sloped ? h * 0.8 : 0)], D = [-W / 2 - ex, 0, u + s * (sloped ? h * 0.8 : 0)];
    if (s < 0) quad(A, B, C, D, [0, 1], [1, 1], [1, 0], [0, 0]); else quad(A, D, C, B, [0, 1], [0, 0], [1, 0], [1, 1]);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(su2, 2));
  sg.computeVertexNormals();
  const sm = new THREE.Mesh(sg, sideMap ? new THREE.MeshStandardMaterial({ map: sideMap, roughness: 0.85 }) : sideMat);
  sm.castShadow = sm.receiveShadow = true; grp.add(sm);
  grp.position.set(r.x, r.base, r.z); grp.rotation.y = r.yaw;
  scene.add(grp); r.mesh = grp; return grp;
}
function addCoping(r, u) {
  const h = r.profile(u);
  const geo = new THREE.CylinderGeometry(0.06, 0.06, r.width, 12).rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(geo, M.coping); m.position.set(0, h, u); m.castShadow = true; r.mesh.add(m);
}
const GRAFF = ['SEND IT', 'RIDE', 'NO BRAKES', 'SHRED', 'FULL SEND', 'GNAR'];
let graffI = 0;
function concreteRamp(o, extra = {}) {
  const r = new Ramp({ surface: 'concrete', ...o });
  buildRampMesh(r, M.rampTop, M.rampSide, { nu: o.type === 'qp' ? 40 : 24, sideMap: extra.graffiti ? graffitiTex(GRAFF[graffI++ % GRAFF.length]) : null });
  if (o.type === 'qp') addCoping(r, o.R * 0.965);
  return r;
}

// Skatepark
{
  const R = 3.6;
  concreteRamp({ x: 65, z: 82, yaw: 0, width: 34, length: R * 0.965 + 3, type: 'qp', R, profile: PROF.qp(R) }, { graffiti: true });
  concreteRamp({ x: 65, z: 30, yaw: Math.PI, width: 34, length: R * 0.965 + 3, type: 'qp', R, profile: PROF.qp(R) }, { graffiti: true });
  const R2 = 2.8;
  concreteRamp({ x: 104, z: 56, yaw: Math.PI / 2, width: 22, length: R2 * 0.965 + 2.5, type: 'qp', R: R2, profile: PROF.qp(R2) }, { graffiti: true });
  concreteRamp({ x: 26, z: 56, yaw: -Math.PI / 2, width: 22, length: R2 * 0.965 + 2.5, type: 'qp', R: R2, profile: PROF.qp(R2) }, { graffiti: true });
  // funbox (along x)
  concreteRamp({ x: 44, z: 60, yaw: Math.PI / 2, width: 7, length: 14, type: 'funbox', profile: PROF.funbox(4, 6, 4, 1.25) }, { graffiti: true });
  // kicker -> landing gap
  concreteRamp({ x: 74, z: 44, yaw: Math.PI / 2, width: 4, length: 3.2, type: 'kicker', profile: PROF.kicker(3.2, 1.3, 1.7) });
  concreteRamp({ x: 82, z: 44, yaw: Math.PI / 2, width: 5, length: 5.5, type: 'landing', profile: PROF.landing(1, 4.5, 1.3) });
  // manual pad
  concreteRamp({ x: 52, z: 40, yaw: Math.PI / 2, width: 3, length: 10, type: 'box', profile: PROF.box(0.28) });
  // pyramid-ish double kicker
  concreteRamp({ x: 80, z: 64, yaw: -Math.PI / 2, width: 5, length: 3, type: 'kicker', profile: PROF.kicker(3, 1.0, 1.4) });
  concreteRamp({ x: 86, z: 64, yaw: Math.PI / 2, width: 5, length: 3, type: 'kicker', profile: PROF.kicker(3, 1.0, 1.4) });
}
// Street kickers
for (const [x, z, h, yaw] of [[-110, 0, 0.7, Math.PI / 2], [-95, 0, 1.0, Math.PI / 2], [-40, 0, 0.8, Math.PI / 2], [-175, 0, 0.9, -Math.PI / 2]]) {
  const r = new Ramp({ x, z, yaw, width: 2.0, length: 2.2, type: 'kicker', surface: 'wood', profile: PROF.kicker(2.2, h, 1.3) });
  buildRampMesh(r, M.wood, M.woodSide, { nu: 12 });
}
// Dirt jumps
const DIRT_GAPS = [];
function dirtLine(z, x0, sets) {
  let x = x0;
  for (const s of sets) {
    const t = new Ramp({ x, z, yaw: Math.PI / 2, width: 3.6, length: s.L, type: 'kicker', surface: 'dirt', profile: PROF.kicker(s.L, s.H, 1.7) });
    buildRampMesh(t, M.dirtRamp, M.dirtRamp, { nu: 16, sloped: 0.4 });
    DIRT_GAPS.push({ z, x: x + s.L + s.gap / 2, y: s.H + 1.3 });
    x += s.L + s.gap;
    const l = new Ramp({ x, z, yaw: Math.PI / 2, width: 4.6, length: 1.2 + s.down, type: 'landing', surface: 'dirt', profile: PROF.landing(1.2, s.down, s.H * 0.95) });
    buildRampMesh(l, M.dirtRamp, M.dirtRamp, { nu: 16, sloped: 0.4 });
    x += 1.2 + s.down + s.run;
  }
}
dirtLine(-48, 32, [
  { L: 3.0, H: 1.2, gap: 3.0, down: 4.0, run: 7 },
  { L: 3.3, H: 1.45, gap: 3.6, down: 4.6, run: 7 },
  { L: 3.6, H: 1.7, gap: 4.2, down: 5.0, run: 7 },
  { L: 3.9, H: 1.95, gap: 4.8, down: 5.4, run: 8 },
]);
dirtLine(-82, 32, [
  { L: 4.2, H: 2.2, gap: 5.5, down: 6.0, run: 9 },
  { L: 4.6, H: 2.6, gap: 6.5, down: 6.5, run: 9 },
  { L: 5.0, H: 3.0, gap: 7.5, down: 7.0, run: 9 },
]);
// Mega ramp (runs +x along z=130)
{
  const z = 130;
  const roll = new Ramp({ x: 95, z, yaw: Math.PI / 2, width: 8, length: 46, type: 'rollin', surface: 'wood', profile: PROF.rollin(6, 40, 20) });
  buildRampMesh(roll, M.wood, M.woodSide, { nu: 60, sideMap: graffitiTex('MEGA') });
  const kick = new Ramp({ x: 155, z, yaw: Math.PI / 2, width: 6, length: 9, type: 'kicker', surface: 'wood', profile: PROF.kicker(9, 4.2, 1.8) });
  buildRampMesh(kick, M.wood, M.woodSide, { nu: 30, sideMap: graffitiTex('FULL SEND') });
  const land = new Ramp({ x: 184, z, yaw: Math.PI / 2, width: 12, length: 32, type: 'landing', surface: 'wood', profile: PROF.landing(4, 28, 5.2) });
  buildRampMesh(land, M.wood, M.woodSide, { nu: 40 });
  // rails on roll-in deck
  for (const s of [-1, 1]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 8).rotateZ(Math.PI / 2), M.pole); top.position.set(98, 21, z + s * 3.95); top.castShadow = true; scene.add(top);
    for (const x of [95.1, 98, 100.9]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), M.pole); post.position.set(x, 20.5, z + s * 3.95); scene.add(post); }
  }
}

// ground queries
function groundInfo(x, z) {
  let h = 0, ramp = null;
  for (const r of ramps) {
    if (Math.abs(x - r.cx) > r.rad || Math.abs(z - r.cz) > r.rad) continue;
    const hh = r.heightAt(x, z); if (hh > h) { h = hh; ramp = r; }
  }
  return { h, ramp };
}
function heightAt(x, z) { return groundInfo(x, z).h; }
function slopeAlong(x, z, dx, dz) {
  const e = 0.14, g0 = groundInfo(x, z), gf = groundInfo(x + dx * e, z + dz * e), gb = groundInfo(x - dx * e, z - dz * e);
  const kf = (gf.h - g0.h) / e, kb = (g0.h - gb.h) / e;
  const isStep = (a, b) => a.ramp !== b.ramp && ((a.ramp && a.ramp.type === 'box') || (b.ramp && b.ramp.type === 'box'));
  // kerbs and box edges are steps, not slopes: measure on the side that doesn't cross one
  if (isStep(g0, gf)) return isStep(g0, gb) ? 0 : kb;
  if (isStep(g0, gb)) return kf;
  return Math.abs(kf - kb) > 1.6 ? kb : (kf + kb) / 2;
}


// ───────────────────────── city dressing ─────────────────────────
const colliders = []; // AABB in xz {x0,x1,z0,z1}
const box = (w, h, d, mat, x, y, z, parent = scene, shadow = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; };
const cyl = (rt, rb, h, mat, x, y, z, parent = scene, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
const collide = (x, z, hw, hd, h = 99) => colliders.push({ x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, h });
const BENCHES = [], BUILDINGS = [], FLAGS = [], FLOODS = [];
const lampSpots = [];   // world positions of light sources for night lighting

// merge non-indexed geometries (position/normal/color) into one
function mergeGeos(list) {
  let n = 0; const parts = list.map(g => { const ng = g.index ? g.toNonIndexed() : g; n += ng.attributes.position.count; return ng; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function tint(geo, r, g, b, jitter = 0) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const j = 1 + (Math.random() - 0.5) * jitter; c[i * 3] = r * j; c[i * 3 + 1] = g * j; c[i * 3 + 2] = b * j; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}

// ── pavements with kerbs (physical: you bump up 13 cm) ──
function pavement(x0, x1, z0, z1) {
  const alongX = (x1 - x0) > (z1 - z0);
  const r = alongX
    ? new Ramp({ x: x0, z: (z0 + z1) / 2, yaw: Math.PI / 2, width: z1 - z0, length: x1 - x0, type: 'box', surface: 'concrete', profile: PROF.box(0.13) })
    : new Ramp({ x: (x0 + x1) / 2, z: z0, yaw: 0, width: x1 - x0, length: z1 - z0, type: 'box', surface: 'concrete', profile: PROF.box(0.13) });
  buildRampMesh(r, M.sidewalk, M.kerb, { nu: 1, uvS: 2.4 });
  rect(x0, x1, z0, z1, 'sidewalk');
}
const CROSS = [[-147, -133], [-67, -53], [-7, 7]];
function segmentsAlongX(xa, xb) { const out = []; let x = xa; for (const [c0, c1] of CROSS) { if (c1 < xa || c0 > xb) continue; if (c0 > x) out.push([x, c0]); x = c1; } if (x < xb) out.push([x, xb]); return out; }
for (const [a, b] of segmentsAlongX(-WORLD, 14)) { pavement(a, b, 7, 11); pavement(a, b, -11, -7); }
for (const [c0, c1] of CROSS.slice(0, 2)) for (const [z0, z1] of [[11, 95], [-95, -11]]) { pavement(c0 - 4, c0, z0, z1); pavement(c1, c1 + 4, z0, z1); }

// zebra crossings with Belisha beacons
function zebra(x) {
  for (let z = -6.2; z <= 6.2; z += 1.0) { const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5).rotateX(-Math.PI / 2), M.white); s.position.set(x, 0.026, z); s.receiveShadow = true; scene.add(s); }
  for (const zz of [-8.2, 8.2]) {
    const g = new THREE.Group(); g.position.set(x - 2, 0.13, zz); scene.add(g);
    const stripes = makeCanvas(16, 128), sg = stripes.getContext('2d'); for (let i = 0; i < 8; i++) { sg.fillStyle = i % 2 ? '#111' : '#eee'; sg.fillRect(0, i * 16, 16, 16); }
    const pm = new THREE.MeshStandardMaterial({ map: tex(stripes), roughness: 0.5 });
    cyl(0.05, 0.05, 2.6, pm, 0, 1.3, 0, g, 10);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 2.5, roughness: 0.3 })); globe.position.y = 2.75; g.add(globe);
    collide(x - 2, zz, 0.15, 0.15);
  }
}
zebra(-112); zebra(-30);

// ── buildings with shopfronts, cornices and roof kit ──
const SHOPS = ['COFFEE', 'BIKE SHOP', 'NEWS & MORE', 'PIZZA', 'BARBER', 'MINI MARKET', 'FISH & CHIPS', 'BAKERY', 'PHONES', 'LAUNDRETTE', 'KEBAB', 'FLORIST', 'HARDWARE', 'OPTICIAN'];
let shopI = 0;
function signTex(name) {
  const c = makeCanvas(512, 96), g = c.getContext('2d');
  const bg = ['#1b2a3a', '#2b1d14', '#123524', '#3a0f12', '#f2efe6', '#1d1d1f'][Math.floor(srand() * 6)];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = bg === '#f2efe6' ? '#1d1d1f' : ['#f2d48a', '#ffffff', '#e8c070'][Math.floor(srand() * 3)];
  g.font = 'bold 54px Inter, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 256, 52);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function interiorTex() {
  const c = makeCanvas(256, 128), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#5a4a38'); gr.addColorStop(1, '#2a221a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(${rand(120, 240)},${rand(100, 220)},${rand(80, 200)},.6)`; g.fillRect(rand(0, 230), rand(40, 100), rand(10, 40), rand(10, 40)); }
  g.fillStyle = 'rgba(255,230,180,.5)'; for (let x = 20; x < 256; x += 60) g.fillRect(x, 4, 30, 6);
  return tex(c);
}
const INTERIORS = [interiorTex(), interiorTex(), interiorTex()];
function building(x, z, w, d, h, streetSide) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * spans[f][0] / 14, uv.getY(i) * spans[f][1] / 14); }
  const fm = FACADES[Math.floor(srand() * FACADES.length)];
  const m = new THREE.Mesh(geo, [fm, fm, roofMat, roofMat, fm, fm]);
  m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  // cornice + parapet
  box(w + 0.5, 0.35, d + 0.5, M.kerb, x, h - 0.6, z);
  box(w + 0.1, 0.8, 0.25, M.kerb, x, h + 0.4, z - d / 2 + 0.12); box(w + 0.1, 0.8, 0.25, M.kerb, x, h + 0.4, z + d / 2 - 0.12);
  // roof kit
  const ac = box(rand(2, 3.5), 1.2, rand(1.6, 2.6), M.steel, x + rand(-w / 4, w / 4), h + 0.6, z + rand(-d / 4, d / 4));
  if (srand() < 0.5) cyl(0.9, 0.9, 2.2, M.darkMetal, x + rand(-w / 3, w / 3), h + 1.1, z + rand(-d / 3, d / 3));
  // shopfront at street level
  if (streetSide && srand() < 0.8) {
    const fz = z + streetSide * (d / 2) ; // street-facing wall plane
    const out = streetSide * 0.12;
    const g = new THREE.Group(); g.position.set(x, 0, fz + out); g.rotation.y = streetSide > 0 ? 0 : Math.PI; scene.add(g);
    const sw = w - 1.2;
    box(sw + 0.6, 4.2, 0.3, M.darkMetal, 0, 2.1, -0.1, g);                       // surround
    const winMat = new THREE.MeshStandardMaterial({ map: INTERIORS[shopI % 3], emissive: 0xffe2b8, emissiveMap: INTERIORS[shopI % 3], emissiveIntensity: 0.55, roughness: 0.05, metalness: 0.1 }); SHOP_MATS.push(winMat);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(sw - 1.6, 2.6), winMat);
    win.position.set(-0.6, 1.75, 0.07); g.add(win);
    box(1.0, 2.4, 0.06, M.glass, sw / 2 - 0.55, 1.2, 0.06, g);                    // door
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.85), new THREE.MeshStandardMaterial({ map: signTex(SHOPS[shopI++ % SHOPS.length]), roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.08 }));
    sign.position.set(0, 3.65, 0.07); g.add(sign);
    if (srand() < 0.55) { // fabric awning
      const aw = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.4, 1.5), M.awning[Math.floor(srand() * M.awning.length)]);
      aw.position.set(0, 2.95, 0.65); aw.rotation.x = -1.05; aw.castShadow = true; g.add(aw);
    }
  }
  collide(x, z, w / 2, d / 2);
  BUILDINGS.push({ x, z, w, d, h });
}
seed = 4242;
for (const side of [-1, 1]) {
  for (let x = -WORLD + 15; x < -20;) {
    const w = 12 + srand() * 14;
    const cx = x + w / 2;
    const nearCross = [-140, -60].some(c => Math.abs(cx - c) < w / 2 + 11);
    if (!nearCross) {
      const d = 14 + srand() * 12, h = 9 + srand() * 30;
      building(cx, side * (11.6 + d / 2), w - 1.5, d, h, -side);
      if (srand() < 0.7) { const d2 = 12 + srand() * 10; building(cx, side * (11.6 + d + 6 + d2 / 2), w - 1.5, d2, 8 + srand() * 38, 0); }
    }
    x += w + 1;
  }
}

// ── streetlights ──
{
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.12, 8, 12);
  const armCurve = new THREE.CubicBezierCurve3(v3(0, 7.8, 0), v3(0, 8.6, 0), v3(0, 8.6, 0.8), v3(0, 8.3, 1.8));
  const armGeo = new THREE.TubeGeometry(armCurve, 16, 0.05, 8);
  const headGeo = new THREE.BoxGeometry(0.32, 0.1, 0.75), lensGeo = new THREE.PlaneGeometry(0.26, 0.6).rotateX(Math.PI / 2);
  for (let x = -WORLD + 20; x < WORLD - 10; x += 26) for (const s of [-1, 1]) {
    if ([-140, -60, 0].some(c => Math.abs(x + (s > 0 ? 13 : 0) - c) < 10)) continue;
    const g = new THREE.Group();
    const p = new THREE.Mesh(poleGeo, M.pole); p.position.y = 4; p.castShadow = true;
    const a = new THREE.Mesh(armGeo, M.pole); a.castShadow = true;
    const hd = new THREE.Mesh(headGeo, M.darkMetal); hd.position.set(0, 8.28, 1.95);
    const ln = new THREE.Mesh(lensGeo, M.lamp); ln.position.set(0, 8.22, 1.95);
    g.add(p, a, hd, ln); g.position.set(x + (s > 0 ? 13 : 0), 0.13, s * 9.6); g.rotation.y = s > 0 ? Math.PI : 0; scene.add(g);
    lampSpots.push(v3(g.position.x, 8.0, g.position.z + (s > 0 ? -1.95 : 1.95)));
    collide(g.position.x, g.position.z, 0.2, 0.2);
  }
}
// ── traffic lights at junctions ──
const trafficHeads = [];
for (const cx of [-140, -60]) for (const [dx, dz, ry] of [[-8, -8.6, 0], [8, 8.6, Math.PI]]) {
  const g = new THREE.Group(); g.position.set(cx + dx, 0.13, dz); g.rotation.y = ry; scene.add(g);
  cyl(0.07, 0.07, 3.4, M.pole, 0, 1.7, 0, g, 10);
  box(0.36, 1.0, 0.28, M.darkMetal, 0, 3.6, 0.1, g);
  const lights = ['red', 'amber', 'green'].map((k, i) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.095, 18), M.tLight[k]); l.position.set(0, 3.9 - i * 0.3, 0.245); g.add(l); return l; });
  for (let i = 0; i < 3; i++) { const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12, 1, true, -Math.PI / 2, Math.PI), M.darkMetal); hood.rotation.x = Math.PI / 2; hood.position.set(0, 3.95 - i * 0.3, 0.3); g.add(hood); }
  trafficHeads.push(g); collide(g.position.x, g.position.z, 0.15, 0.15);
}

// ── street furniture: benches, bins, pillar boxes, bus stop, bollards ──
function bench(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0.13, z); g.rotation.y = ry; scene.add(g);
  for (let i = 0; i < 3; i++) box(1.8, 0.04, 0.11, M.benchWood, 0, 0.45, -0.17 + i * 0.13, g);
  for (let i = 0; i < 2; i++) box(1.8, 0.11, 0.04, M.benchWood, 0, 0.62 + i * 0.14, -0.27, g);
  for (const sx of [-0.8, 0.8]) { box(0.05, 0.45, 0.42, M.darkMetal, sx, 0.22, -0.04, g); box(0.05, 0.4, 0.05, M.darkMetal, sx, 0.66, -0.28, g); }
  collide(x, z, Math.abs(Math.cos(ry)) > 0.5 ? 0.95 : 0.3, Math.abs(Math.cos(ry)) > 0.5 ? 0.3 : 0.95, 0.75);
  g.updateMatrixWorld(true);
  BENCHES.push({ a: g.localToWorld(v3(-0.88, 0.5, 0.08)), b: g.localToWorld(v3(0.88, 0.5, 0.08)) });
}
function bin(x, z) { const g = new THREE.Group(); g.position.set(x, 0.13, z); scene.add(g); cyl(0.26, 0.24, 0.95, M.bin, 0, 0.48, 0, g, 18); cyl(0.29, 0.29, 0.08, M.bin, 0, 1.0, 0, g, 18); collide(x, z, 0.3, 0.3, 1.2); }
function pillarBox(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0.13, z); scene.add(g);
  cyl(0.26, 0.28, 1.25, M.postbox, 0, 0.62, 0, g, 24); const cap = new THREE.Mesh(new THREE.SphereGeometry(0.29, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.postbox); cap.position.y = 1.25; cap.castShadow = true; g.add(cap);
  box(0.3, 0.05, 0.05, M.darkMetal, 0, 1.05, 0.27, g); box(0.4, 0.06, 0.62, M.darkMetal, 0, 0.05, 0, g);
  collide(x, z, 0.3, 0.3, 1.5);
}
function bollard(x, z) { cyl(0.08, 0.1, 1.0, M.darkMetal, x, 0.63, z, scene, 12); collide(x, z, 0.12, 0.12, 1.15); }
function busStop(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0.13, z); scene.add(g);
  for (const [px, pz] of [[-1.9, -0.7], [1.9, -0.7], [-1.9, 0.6], [1.9, 0.6]]) box(0.06, 2.5, 0.06, M.steel, px, 1.25, pz, g);
  box(4.0, 0.08, 1.5, M.steel, 0, 2.52, 0, g);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.1), M.clearGlass); back.position.set(0, 1.25, -0.7); g.add(back);
  for (const sx of [-1.9, 1.9]) { const sd = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.1), M.clearGlass); sd.rotation.y = Math.PI / 2; sd.position.set(sx, 1.25, -0.05); g.add(sd); }
  box(2.2, 0.06, 0.32, M.steel, 0, 0.5, -0.45, g);
  const ad = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xddeeff, emissiveIntensity: 0.6, map: signTex('RIDE MORE') })); ad.position.set(-1.85, 1.3, 0.1); ad.rotation.y = Math.PI / 2; g.add(ad);
  collide(x, z - 0.7, 2.0, 0.15); collide(x - 1.9, z, 0.1, 0.7); collide(x + 1.9, z, 0.1, 0.7);
}
seed = 777;
for (let x = -WORLD + 30; x < -20; x += 22 + srand() * 18) {
  if (CROSS.some(([a, b]) => x > a - 6 && x < b + 6)) continue;
  for (const s of [-1, 1]) {
    const r = srand();
    if (r < 0.28) bench(x, s * 10.3, s > 0 ? Math.PI : 0);
    else if (r < 0.48) bin(x, s * 10.4);
    else if (r < 0.56) pillarBox(x, s * 10.3);
    else if (r < 0.66) { bollard(x, s * 7.5); bollard(x + 1.6, s * 7.5); }
  }
}
busStop(-100, 9.9); busStop(-200, -9.9 + 0.0);

// ── parked cars (proper silhouettes) ──
const carBody = (() => {
  const s = new THREE.Shape();
  s.moveTo(-2.15, 0.36); s.lineTo(-2.17, 0.86); s.quadraticCurveTo(-2.12, 1.0, -1.85, 1.0); s.lineTo(1.35, 1.0);
  s.quadraticCurveTo(2.05, 0.95, 2.16, 0.78); s.lineTo(2.18, 0.42); s.quadraticCurveTo(2.15, 0.3, 2.0, 0.3);
  s.lineTo(1.76, 0.3); s.absarc(1.35, 0.32, 0.41, 0, Math.PI, false); s.lineTo(-0.94, 0.3);
  s.absarc(-1.35, 0.32, 0.41, 0, Math.PI, false); s.lineTo(-2.0, 0.3); s.quadraticCurveTo(-2.14, 0.3, -2.15, 0.36);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 4, curveSegments: 18 });
  g.translate(0, 0, -0.81); g.rotateY(-Math.PI / 2); return g;
})();
const carGlass = (() => {
  const s = new THREE.Shape();
  s.moveTo(-1.78, 0.98); s.quadraticCurveTo(-1.6, 1.36, -1.35, 1.42); s.lineTo(0.35, 1.44); s.quadraticCurveTo(0.65, 1.42, 1.25, 0.98);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -0.75); g.rotateY(-Math.PI / 2); return g;
})();
const tyreGeo = new THREE.TorusGeometry(0.25, 0.085, 14, 32).scale(1, 1, 1.35).rotateY(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.2, 24).rotateZ(Math.PI / 2);
function car(x, z, yaw, mat) {
  const g = makeCar(mat);
  g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
  const hw = Math.abs(Math.sin(yaw)) > 0.5 ? 2.25 : 0.95, hd = Math.abs(Math.sin(yaw)) > 0.5 ? 0.95 : 2.25;
  collide(x, z, hw, hd, 1.55);
}
function makeCar(mat) {
  const g = new THREE.Group(); queueMicrotask(() => mergeGroup(g));
  const body = new THREE.Mesh(carBody, mat); body.castShadow = body.receiveShadow = true;
  const glass = new THREE.Mesh(carGlass, M.glass); glass.castShadow = true;
  const roof = box(1.42, 0.06, 1.55, mat, 0, 1.47, -0.5, g);
  for (const [px, pz, sx] of [[0.72, 0.92, 1], [-0.72, 0.92, -1]]) { const p = box(0.06, 0.55, 0.08, mat, px, 1.2, pz, g); p.rotation.x = 0.85; } // A-pillars
  for (const px of [-0.79, 0.79]) box(0.04, 0.46, 0.09, mat, px, 1.2, -0.25, g); // B-pillars
  g.add(body, glass);
  for (const [wx, wz] of [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]]) {
    const t = new THREE.Mesh(tyreGeo, M.slick); t.position.set(wx, 0.33, wz); t.castShadow = true; g.add(t);
    const r = new THREE.Mesh(rimGeo, M.alloy); r.position.set(wx, 0.33, wz); g.add(r);
  }
  for (const sx of [-0.62, 0.62]) { box(0.38, 0.12, 0.05, M.carLight, sx, 0.82, 2.2, g, false); box(0.34, 0.12, 0.05, M.taillight, sx, 0.88, -2.2, g, false); }
  box(0.52, 0.12, 0.02, M.white, 0, 0.55, 2.24, g, false);
  box(0.52, 0.12, 0.02, new THREE.MeshStandardMaterial({ color: 0xf2c400, roughness: 0.5 }), 0, 0.6, -2.24, g, false);
  for (const sx of [-1, 1]) box(0.16, 0.1, 0.06, mat, sx * 0.95, 1.05, 0.85, g);
  return g;
}
seed = 99;
for (let x = -235; x < -30; x += 17 + srand() * 20) {
  if (CROSS.some(([a, b]) => x > a - 10 && x < b + 6)) continue;
  if (srand() < 0.6) car(x, 5.7, Math.PI / 2, M.car[Math.floor(srand() * M.car.length)]);
  if (srand() < 0.5) car(x + 6, -5.7, -Math.PI / 2, M.car[Math.floor(srand() * M.car.length)]);
}

// ── trees: branching trunks + clustered leaf masses, 3 species-ish variants, instanced ──
function treeGeo(kind) {
  const parts = [];
  const H = kind === 2 ? 5 : 3.2;
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, H, 9).translate(0, H / 2, 0); parts.push(tint(trunk, 0.32, 0.25, 0.19, 0.2));
  const crownC = v3(0, H + (kind === 2 ? 2.2 : 2.0), 0), R = kind === 1 ? v3(2.6, 2.2, 2.6) : kind === 2 ? v3(1.8, 3.2, 1.8) : v3(2.2, 2.4, 2.2);
  for (let b = 0; b < 4; b++) {
    const a = b / 4 * Math.PI * 2 + rand(-0.3, 0.3), len = rand(1.4, 2.2);
    const br = new THREE.CylinderGeometry(0.05, 0.12, len, 6).translate(0, len / 2, 0);
    br.rotateZ(rand(0.5, 0.9)); br.rotateY(a); br.translate(0, H - rand(0.2, 0.8), 0); parts.push(tint(br, 0.3, 0.24, 0.18, 0.2));
  }
  const base = kind === 1 ? [0.2, 0.36, 0.12] : kind === 2 ? [0.15, 0.3, 0.13] : kind === 3 ? [0.62, 0.3, 0.08] : kind === 4 ? [0.55, 0.45, 0.1] : [0.26, 0.4, 0.14];
  const n = kind === 2 ? 18 : 24;
  for (let i = 0; i < n; i++) {
    const p = v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)); if (p.length() > 1) { i--; continue; }
    p.multiply(R).add(crownC);
    const r = rand(0.7, 1.25) * (kind === 2 ? 0.85 : 1);
    const ico = new THREE.IcosahedronGeometry(r, 1);
    const pa = ico.attributes.position; for (let k = 0; k < pa.count; k++) { const f = 1 + rand(-0.18, 0.18); pa.setXYZ(k, pa.getX(k) * f, pa.getY(k) * f * 0.85, pa.getZ(k) * f); }
    ico.translate(p.x, p.y, p.z); ico.computeVertexNormals();
    const shade = 0.75 + (p.y - crownC.y + R.y) / (2 * R.y) * 0.45; // darker underneath
    parts.push(tint(ico, base[0] * shade, base[1] * shade, base[2] * shade, 0.25));
  }
  return mergeGeos(parts);
}
const TREE_GEOS = [treeGeo(0), treeGeo(1), treeGeo(2), treeGeo(3), treeGeo(4)];
const treeSpots = [];
{
  seed = 7;
  let n = 0;
  while (n < 300) {
    const x = (srand() * 2 - 1) * (WORLD - 10), z = (srand() * 2 - 1) * (WORLD - 10);
    if (surfaceAt(x, z) !== 'grass') continue;
    if (Math.abs(z) < 16) continue;
    if (x < -20 && Math.abs(z) < 100) continue;
    if (x > 10 && x < 120 && z > 14 && z < 98) continue;
    if (x > 10 && x < 162 && z > -118 && z < -18) continue;
    if (x > 80 && x < 256 && z > 112 && z < 148) continue;
    if (Math.abs(x) < 12) continue;
    if (colliders.some(c => x > c.x0 - 3 && x < c.x1 + 3 && z > c.z0 - 3 && z < c.z1 + 3)) continue;
    treeSpots.push([x, z, 0.75 + srand() * 0.6, srand() * 6.28, Math.floor(srand() * 5)]);
    collide(x, z, 0.4, 0.4); n++;
  }
  // street trees in the city pavements
  for (let x = -WORLD + 40; x < -25; x += 34) for (const s of [-1, 1]) {
    if (CROSS.some(([a, b]) => x > a - 8 && x < b + 8)) continue;
    if (colliders.some(c => x > c.x0 - 1.2 && x < c.x1 + 1.2 && s * 10 > c.z0 - 1.2 && s * 10 < c.z1 + 1.2)) continue;
    treeSpots.push([x, s * 9.9, 0.7, srand() * 6.28, srand() < 0.5 ? 2 : 3, 0.13]); collide(x, s * 9.9, 0.35, 0.35);
  }
}

// hedges around the skatepark and dirt area
{
  const geo = new THREE.IcosahedronGeometry(1, 2); const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) { const f = 1 + rand(-0.12, 0.12); pa.setXYZ(i, pa.getX(i) * f, pa.getY(i) * f, pa.getZ(i) * f); } geo.computeVertexNormals();
  const spots = [];
  const line = (x0, z0, x1, z1, gaps = []) => { const L = Math.hypot(x1 - x0, z1 - z0); for (let t = 0; t < L; t += 1.6) { const x = lerp(x0, x1, t / L), z = lerp(z0, z1, t / L); if (gaps.some(([a, b]) => t > a && t < b)) continue; spots.push([x, z]); } };
  line(12, 96, 118, 96); line(118, 16, 118, 96); line(12, 16, 12, 96, [[30, 45]]);
  line(12, -116, 160, -116); line(160, -116, 160, -20);
  const im = new THREE.InstancedMesh(geo, M.hedge, spots.length); const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
  spots.forEach(([x, z], i) => { mtx.compose(v3(x, 0.55, z), q.setFromAxisAngle(_up0, rand(0, 6)), v3(1.0 + rand(0, 0.3), 0.8 + rand(0, 0.3), 1.0 + rand(0, 0.3))); im.setMatrixAt(i, mtx); collide(x, z, 0.7, 0.7); });
  im.castShadow = im.receiveShadow = true; scene.add(im);
}
// floodlight masts at the skatepark
for (const [x, z] of [[18, 22], [112, 22], [18, 90], [112, 90]]) {
  cyl(0.12, 0.2, 12, M.pole, x, 6, z, scene, 10);
  const head = box(1.6, 0.6, 0.3, M.darkMetal, x, 12, z); head.lookAt(65, 0, 56);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), M.lamp); lens.position.set(0, 0, 0.16); head.add(lens);
  FLOODS.push(v3(x, 12, z));
  collide(x, z, 0.3, 0.3);
}

// ── grass tufts with wind (alpha-tested blade cards) ──
let grassMesh = null;


// distant hills ring for horizon
{
  const geo = new THREE.CylinderGeometry(1000, 1000, 1, 128, 1, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const south = pos.getZ(i) < -150 ? 0.08 : 1;
    if (pos.getY(i) > 0) pos.setY(i, (45 + 35 * Math.sin(a * 3 + 1) + 22 * Math.sin(a * 7 + 2) + 12 * Math.sin(a * 17) + 4 * Math.sin(a * 53)) * south); else pos.setY(i, -5);
  }
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x55684a, side: THREE.BackSide, roughness: 1 })));
}


// ── draw-call reduction: merge meshes that share a material ──
function prepGeo(g, m4) {
  let geo = g.clone(); if (m4) geo.applyMatrix4(m4);
  if (geo.index) geo = geo.toNonIndexed();
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  geo.morphAttributes = {}; geo.clearGroups();
  return geo;
}
const mergeable = o => o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && !o.material.isShaderMaterial && !o.material.vertexColors && o.visible && !o.userData.noMerge;
// merge the direct mesh children of a rigid group (local space)
function mergeGroup(group) {
  const by = new Map();
  for (const c of group.children) if (mergeable(c) && c.children.length === 0) { if (!by.has(c.material)) by.set(c.material, []); by.get(c.material).push(c); }
  for (const [mat, list] of by) {
    if (list.length < 2) continue;
    for (const c of list) c.updateMatrix();
    const geo = mergeGeometries(list.map(c => prepGeo(c.geometry, c.matrix)), false); if (!geo) continue;
    const m = new THREE.Mesh(geo, mat); m.castShadow = list.some(c => c.castShadow); m.receiveShadow = true;
    for (const c of list) group.remove(c);
    group.add(m);
  }
  return group;
}
// merge all static scenery in world space (skips anything marked noMerge, e.g. riders, cars, people)
function mergeStatic() {
  scene.updateMatrixWorld(true);
  const by = new Map(), victims = [];
  const walk = o => {
    if (o.userData.noMerge) return;
    if (mergeable(o) && o.children.length === 0 && o.parent) { const k = o.material.uuid + (o.castShadow ? 's' : ''); if (!by.has(k)) by.set(k, []); by.get(k).push(o); }
    for (const c of o.children) walk(c);
  };
  for (const c of scene.children) walk(c);
  for (const [k, list] of by) {
    if (list.length < 2) continue;
    const chunks = [];
    for (let i = 0; i < list.length; i += 400) chunks.push(list.slice(i, i + 400));
    for (const chunk of chunks) {
      const geo = mergeGeometries(chunk.map(o => prepGeo(o.geometry, o.matrixWorld)), false); if (!geo) continue;
      const m = new THREE.Mesh(geo, chunk[0].material); m.castShadow = chunk[0].castShadow; m.receiveShadow = true; m.matrixAutoUpdate = false;
      scene.add(m);
      for (const o of chunk) victims.push(o);
    }
  }
  for (const o of victims) o.parent && o.parent.remove(o);
}

// ───────────────────────── vehicles ─────────────────────────
const VEH = {
  bike: { label: 'BIKE', desc: 'Dirt-jump bike. Flips, whips and barspins. Best in the dirt.', top: 12.5, accel: 8, hop: 5.4, spin: 8.6, flip: 5.4, whip: 0.5, bar: 0.32, wb: 0.9, wbMax: 1.4, motor: false, tLabel: 'SUPERMAN', stats: [0.65, 0.95, 0.85] },
  ebike: { label: 'E-BIKE', desc: 'Motor-assisted trail bike with suspension. Fast on the road, huge on the mega ramp.', top: 14.5, accel: 9, hop: 4.6, spin: 6.2, flip: 3.9, whip: 0.8, bar: 0.42, wb: 0.86, wbMax: 1.3, motor: true, tLabel: 'SUPERMAN', stats: [0.85, 0.6, 0.8] },
  scooter: { label: 'SCOOTER', desc: 'Pro stunt scooter. Made for the skatepark — whips for days.', top: 11, accel: 6.5, hop: 5.0, spin: 10.5, flip: 5.9, whip: 0.34, bar: 0.26, wb: 0.42, wbMax: 0.75, motor: false, tLabel: 'NO-FOOTER', stats: [0.5, 1.0, 0.45] },
  escooter: { label: 'E-SCOOTER', desc: 'Dual-suspension electric scooter. Top speed and long wheelies on the street.', top: 15, accel: 6.5, hop: 3.6, spin: 5.6, flip: 0, whip: 0.95, bar: 0.5, wb: 0.62, wbMax: 1.0, motor: true, tLabel: 'KICKOUT', stats: [0.9, 0.35, 1.0] },
};
const VEH_KEYS = Object.keys(VEH);
const COLORS = [0xff4d1f, 0x18a0ff, 0x2ee86c, 0xffc531, 0xb14dff, 0xf2f2f2, 0x1d1d20];
let paintColor = store.get('color', 0);

function tube(a, b, r, mat, parent, r2 = r, seg = 14) {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(v3(0, 1, 0), d.normalize());
  m.castShadow = true; parent.add(m); return m;
}
function weld(p, r, mat, parent) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat); m.position.copy(p); parent.add(m); return m; }
function curveTube(points, r, mat, parent) {
  const c = new THREE.CatmullRomCurve3(points);
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(8, points.length * 6), r, 6), mat); m.castShadow = true; parent.add(m); return m;
}
const spokeMat = new THREE.LineBasicMaterial({ color: 0xb6bcc2 });
// spoked wheel: knobby or road tyre, double-wall rim, hub flanges, laced spokes, optional disc / cassette / motor hub
function spokedWheel(r, tw, o = {}) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r - tw, tw, 18, 72).scale(1, 1, o.fat ? 1.25 : 1.05), o.slick ? M.slick : M.rubber);
  tire.rotation.y = Math.PI / 2; tire.castShadow = true; g.add(tire);
  const rr = r - tw * 1.9, rimW = tw * 1.15;
  const rimMat = o.rimMat || M.darkMetal;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, rimW, 56, 1, true).rotateZ(Math.PI / 2), rimMat); g.add(rim);
  const rim2 = new THREE.Mesh(new THREE.CylinderGeometry(rr - 0.016, rr - 0.016, rimW * 0.6, 56, 1, true).rotateZ(Math.PI / 2), rimMat); g.add(rim2);
  for (const s of [-1, 1]) { const lip = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.004, 4, 56), rimMat); lip.rotation.y = Math.PI / 2; lip.position.x = s * rimW / 2; g.add(lip); }
  const hubR = o.motor ? 0.075 : 0.022, hubL = o.motor ? 0.08 : 0.1;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubL, 24).rotateZ(Math.PI / 2), o.motor ? M.darkMetal : M.alloy));
  for (const s of [-1, 1]) { const fl = new THREE.Mesh(new THREE.CylinderGeometry(hubR + 0.018, hubR + 0.018, 0.005, 24).rotateZ(Math.PI / 2), M.alloy); fl.position.x = s * hubL * 0.4; g.add(fl); }
  // spokes: 32, two-cross lacing
  const pts = []; const n = 32;
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, a = i / n * Math.PI * 2, cross = (i % 4 < 2 ? 1 : -1) * 0.38;
    pts.push(side * hubL * 0.4, Math.cos(a + cross) * (hubR + 0.014), Math.sin(a + cross) * (hubR + 0.014), side * 0.006, Math.cos(a) * (rr - 0.012), Math.sin(a) * (rr - 0.012));
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(sg, spokeMat));
  if (o.disc) {
    const rot = new THREE.Mesh(new THREE.CylinderGeometry(o.disc, o.disc, 0.003, 40).rotateZ(Math.PI / 2), M.rotor); rot.position.x = -0.062; g.add(rot);
    const spider = new THREE.Mesh(new THREE.CylinderGeometry(o.disc * 0.6, o.disc * 0.6, 0.005, 6).rotateZ(Math.PI / 2), M.darkMetal); spider.position.x = -0.062; g.add(spider);
  }
  if (o.cassette) for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03 + i * 0.008, 0.03 + i * 0.008, 0.003, 24).rotateZ(Math.PI / 2), M.chain); c.position.x = 0.04 + (5 - i) * 0.006; g.add(c); }
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 6), M.alloy); valve.position.set(0, rr - 0.02, 0); g.add(valve);
  return g;
}
// small solid-core stunt scooter wheel (110 mm): PU tyre on a spoked alloy core
function stuntWheel(r, w, coreMat) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r - 0.018, 0.018, 16, 40).scale(1, 1, w / 0.036), M.pu); tire.rotation.y = Math.PI / 2; tire.castShadow = true; g.add(tire);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r - 0.03, r - 0.03, w * 0.9, 32).rotateZ(Math.PI / 2), M.pu));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, w * 1.1, 16).rotateZ(Math.PI / 2), M.alloy); g.add(hub);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, (r - 0.036) * 0.9, 0.01), coreMat); s.position.y = 0; s.rotation.x = i / 6 * Math.PI; g.add(s); }
  for (const sd of [-1, 1]) { const face = new THREE.Mesh(new THREE.TorusGeometry(r - 0.034, 0.004, 4, 32), coreMat); face.rotation.y = Math.PI / 2; face.position.x = sd * w * 0.48; g.add(face); }
  return g;
}
function axisPivot(parent, point, axis) {
  const p = new THREE.Group(); p.position.copy(point); p.quaternion.setFromUnitVectors(v3(0, 1, 0), axis);
  parent.add(p); p.updateMatrixWorld(true); return p;
}
function roundedDeckGeo(len, wid, thick, rad, bevel = 0.006) {
  const s = new THREE.Shape(), hl = len / 2, hw = wid / 2;
  s.moveTo(-hw + rad, -hl); s.lineTo(hw - rad, -hl); s.quadraticCurveTo(hw, -hl, hw, -hl + rad); s.lineTo(hw, hl - rad); s.quadraticCurveTo(hw, hl, hw - rad, hl);
  s.lineTo(-hw + rad, hl); s.quadraticCurveTo(-hw, hl, -hw, hl - rad); s.lineTo(-hw, -hl + rad); s.quadraticCurveTo(-hw, -hl, -hw + rad, -hl);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0); return { geo: g, shape: s };
}
function buildVehicle(kind, colorIdx = paintColor) {
  const paint = new THREE.MeshPhysicalMaterial({ color: COLORS[colorIdx % COLORS.length], metalness: 0.5, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05 });
  const model = new THREE.Group();
  const out = { model, wheels: [], kind, paint };
  if (kind === 'bike' || kind === 'ebike') {
    const e = kind === 'ebike';
    const r = e ? 0.37 : 0.335, tw = e ? 0.034 : 0.03;
    const axis = v3(0, 0.94, -0.34).normalize();
    const HT = v3(0, e ? 0.99 : 0.87, e ? 0.42 : 0.36), HB = HT.clone().addScaledVector(axis, e ? -0.15 : -0.13);
    const t = (HB.y - r) / axis.y, F = HB.clone().addScaledVector(axis, -t); F.z += 0.045; F.y = r;
    const wbLen = e ? 1.18 : 1.04, R = v3(0, r, F.z - wbLen);
    const mid = (F.z + R.z) / 2;
    [HT, HB, F, R].forEach(p => p.z -= mid);
    const BB = v3(0, e ? 0.34 : 0.31, R.z + (e ? 0.46 : 0.4)), S = e ? v3(0, 0.93, R.z + 0.25) : v3(0, 0.77, R.z + 0.29);
    out.wbLen = wbLen; out.r = r;
    // ── front end (steers + barspins) ──
    const front = axisPivot(model, HT, axis);
    const steer = new THREE.Group(); front.add(steer); steer.updateMatrixWorld(true);
    const fk = new THREE.Group(); model.add(fk);
    // fork: rigid chromoly (DJ) or air suspension (e-bike)
    const crown = HB.clone().addScaledVector(axis, -0.03);
    const box3 = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.07), e ? M.darkMetal : paint); box3.position.copy(crown); box3.quaternion.setFromUnitVectors(v3(0, 1, 0), axis); fk.add(box3);
    for (const sx of [-1, 1]) {
      const top = v3(sx * 0.068, crown.y, crown.z), bot = v3(sx * 0.068, F.y, F.z);
      if (e) { const midP = top.clone().lerp(bot, 0.45); tube(top, midP, 0.019, M.chrome, fk); tube(midP.clone().add(v3(0, 0.03, -0.01)), bot.clone().add(v3(0, -0.02, 0.005)), 0.026, M.darkMetal, fk); }
      else tube(top, bot, 0.017, paint, fk, 0.014);
      const drop = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.035), M.darkMetal); drop.position.copy(bot); fk.add(drop);
    }
    if (e) { const arch = curveTube([v3(-0.07, crown.y - 0.2, crown.z + 0.06), v3(0, crown.y - 0.16, crown.z + 0.1), v3(0.07, crown.y - 0.2, crown.z + 0.06)], 0.012, M.darkMetal, fk); }
    tube(HT.clone().add(v3(0, 0.01, 0)), HB.clone().addScaledVector(axis, -0.02), 0.012, M.chrome, fk); // steerer
    const stemTop = HT.clone().addScaledVector(axis, 0.05);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.04, 0.07), M.darkMetal); stem.position.copy(stemTop).add(v3(0, 0.005, -0.03)); fk.add(stem);
    weld(stemTop, 0.024, M.darkMetal, fk);
    const barY = stemTop.y + (e ? 0.035 : 0.09), barZ = stemTop.z - 0.06;
    const BW = e ? 0.38 : 0.36;
    const bl = v3(-BW, barY, barZ - 0.03), br = v3(BW, barY, barZ - 0.03);
    curveTube([bl, v3(-0.2, barY - 0.01, barZ - 0.02), v3(-0.1, stemTop.y + 0.01, barZ), v3(0.1, stemTop.y + 0.01, barZ), v3(0.2, barY - 0.01, barZ - 0.02), br], 0.0115, M.darkMetal, fk);
    if (!e) tube(v3(-0.2, barY - 0.05, barZ - 0.02), v3(0.2, barY - 0.05, barZ - 0.02), 0.008, M.darkMetal, fk); // BMX-style crossbar
    for (const gp of [bl, br]) {
      const sx = Math.sign(gp.x);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 14).rotateZ(Math.PI / 2), M.grip); g.position.copy(gp).add(v3(-sx * 0.06, 0, 0)); fk.add(g);
      for (const k of [0, 1]) { const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14).rotateZ(Math.PI / 2), M.alloy); ring.position.copy(gp).add(v3(-sx * (k ? 0.125 : 0.0), 0, 0)); fk.add(ring); }
      // brake lever + hose
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.016), M.alloy); lever.position.copy(gp).add(v3(-sx * 0.09, -0.012, 0.04)); lever.rotation.y = sx * 0.25; fk.add(lever);
      const clampB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), M.darkMetal); clampB.position.copy(gp).add(v3(-sx * 0.15, 0, 0.005)); fk.add(clampB);
    }
    // front brake hose to the caliper
    curveTube([bl.clone().add(v3(0.15, -0.01, 0.01)), v3(-0.12, barY - 0.08, barZ + 0.06), v3(-0.09, crown.y - 0.05, crown.z + 0.05), v3(-0.075, F.y + 0.12, F.z - 0.06)], 0.0035, M.hose, fk);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.06, 0.04), M.darkMetal); cal.position.set(-0.075, F.y + 0.09, F.z - 0.055); fk.add(cal);
    const gripL = new THREE.Object3D(); gripL.position.copy(bl).add(v3(0.065, 0, 0)); fk.add(gripL);
    const gripR = new THREE.Object3D(); gripR.position.copy(br).add(v3(-0.065, 0, 0)); fk.add(gripR);
    const fw = spokedWheel(r, tw, { disc: e ? 0.09 : 0.08, fat: e, rimMat: e ? M.darkMetal : M.alloy }); fw.position.copy(F); fk.add(fw);
    if (e) { const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.05, 16).rotateX(Math.PI / 2), M.headlight); hl.position.copy(stemTop).add(v3(0, -0.03, 0.07)); fk.add(hl); const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.06, 16).rotateX(Math.PI / 2), M.darkMetal); hb.position.copy(hl.position).add(v3(0, 0, -0.012)); fk.add(hb); const disp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.04), new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x6fd6ff, emissiveIntensity: 1.6 })); disp.position.set(-0.08, barY + 0.01, barZ); fk.add(disp); }
    steer.attach(fk);
    // ── rear triangle (tailwhips around the steering axis) ──
    const whip = axisPivot(model, HT, axis);
    const fr = new THREE.Group(); model.add(fr);
    const tr = e ? 0.036 : 0.029;
    const HTt = HT.clone().addScaledVector(axis, -0.02);
    // head tube
    tube(HT.clone().addScaledVector(axis, 0.015), HB.clone().addScaledVector(axis, -0.01), e ? 0.03 : 0.026, paint, fr);
    tube(S, HTt, tr, paint, fr, tr * 0.9);
    tube(BB, HB, e ? 0.05 : 0.033, paint, fr, e ? 0.042 : 0.031);
    tube(BB, S, tr * 0.95, paint, fr);
    for (const p of [S, HTt, HB, BB]) weld(p, (e ? 0.04 : 0.032), paint, fr);
    for (const sx of [-1, 1]) {
      tube(v3(sx * 0.025, BB.y, BB.z - 0.02), v3(sx * 0.066, R.y, R.z), 0.015, paint, fr, 0.012);
      tube(v3(sx * 0.02, S.y - 0.09, S.z + 0.02), v3(sx * 0.066, R.y + 0.01, R.z), 0.012, paint, fr, 0.01);
      const drop = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.05), M.darkMetal); drop.position.set(sx * 0.066, R.y, R.z); fr.add(drop);
    }
    // seatpost, clamp & saddle
    const post = S.clone().add(v3(0, 0.1, -0.035));
    tube(S.clone().add(v3(0, -0.02, 0)), post, 0.014, M.alloy, fr);
    const clampS = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 14), M.darkMetal); clampS.position.copy(S).add(v3(0, 0.01, 0)); fr.add(clampS);
    const sad = new THREE.Group(); sad.position.copy(post).add(v3(0, 0.025, -0.01)); fr.add(sad);
    const sRear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 10), M.saddle); sRear.scale.set(1, 0.32, 1.0); sRear.position.z = -0.04; sad.add(sRear);
    const sNose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 8), M.saddle); sNose.scale.set(0.9, 0.55, 2.4); sNose.position.z = 0.07; sad.add(sNose);
    const rw = spokedWheel(r, tw, { disc: e ? 0.09 : 0.08, cassette: true, fat: e, rimMat: e ? M.darkMetal : M.alloy }); rw.position.copy(R); fr.add(rw);
    const calR = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.04, 0.06), M.darkMetal); calR.position.set(-0.075, R.y + 0.08, R.z + 0.05); fr.add(calR);
    curveTube([v3(-0.075, R.y + 0.1, R.z + 0.08), v3(-0.03, S.y - 0.15, S.z + 0.05), v3(-0.01, HT.y - 0.06, HT.z - 0.1), v3(-0.02, HT.y + 0.04, HT.z + 0.02)], 0.0035, M.hose, fr);
    if (e) {
      // down-tube battery, mid-drive motor, rear shock-free hardtail, fenders, lights
      const dir = HB.clone().sub(BB), bat = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, dir.length() * 0.78), M.darkMetal);
      bat.position.copy(BB).addScaledVector(dir, 0.52).add(v3(0, 0.055, -0.02)); bat.lookAt(bat.position.clone().add(dir)); fr.add(bat);
      const logo = new THREE.Mesh(new THREE.BoxGeometry(0.087, 0.012, dir.length() * 0.5), paint); logo.position.copy(bat.position).add(v3(0, 0.01, 0)); logo.quaternion.copy(bat.quaternion); fr.add(logo);
      const mot = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.13, 28).rotateZ(Math.PI / 2), M.darkMetal); mot.position.copy(BB).add(v3(0, -0.01, 0.02)); fr.add(mot);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.015), M.taillight); tl.position.copy(post).add(v3(0, -0.06, -0.04)); fr.add(tl);
      for (const [c, a0, len] of [[R, 0.25, 1.35], [F, 1.75, 1.2]]) {
        const fen = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.022, 4, 24, len).scale(1, 1, 1.6), M.darkMetal); fen.rotation.y = Math.PI / 2; fen.rotation.x = 0; fen.rotateZ(a0); fen.position.copy(c);
        (c === F ? fk : fr).add(fen);
      }
    }
    // drivetrain: chainring, chain, cranks with platform pedals
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.008, 6, 40), M.chain); ring.rotation.y = Math.PI / 2; ring.position.copy(BB).add(v3(0.062, 0, 0)); fr.add(ring);
    const ringIn = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.004, 5).rotateZ(Math.PI / 2), M.darkMetal); ringIn.position.copy(ring.position); fr.add(ringIn);
    const cogR = 0.045, ch = new THREE.Vector3(0.062, 0, 0);
    tube(BB.clone().add(ch).add(v3(0, 0.095, 0)), R.clone().add(ch).add(v3(0, cogR, 0)), 0.005, M.chain, fr, 0.005, 6);
    tube(BB.clone().add(ch).add(v3(0, -0.095, 0)), R.clone().add(ch).add(v3(0, -cogR, 0)), 0.005, M.chain, fr, 0.005, 6);
    const crank = new THREE.Group(); crank.position.copy(BB); fr.add(crank);
    const pedals = [];
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.175, 0.03), M.darkMetal); arm.position.set(sx * 0.085, sx * 0.0875, 0); crank.add(arm);
      const ped = new THREE.Group(); ped.position.set(sx * 0.145, sx * 0.175, 0); crank.add(ped);
      ped.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 0.1), M.darkMetal));
      for (let k = 0; k < 4; k++) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4), M.alloy); pin.position.set((k % 2 ? 0.04 : -0.04), 0, (k < 2 ? 0.04 : -0.04)); ped.add(pin); }
      pedals[sx < 0 ? 0 : 1] = ped;
    }
    whip.attach(fr);
    out.front = front; out.steer = steer; out.whip = whip; out.crank = crank; out.pedals = pedals; out.grips = [gripL, gripR];
    out.wheels = [{ obj: fw, r }, { obj: rw, r }];
    out.seated = e; out.saddle = post.clone().add(v3(0, 0.08, -0.06)); out.hip = null;
    out.contactR = R.z; out.contactF = F.z;
    out.forkLowers = null;
  } else {
    const e = kind === 'escooter';
    const r = e ? 0.115 : 0.055, wbLen = e ? 0.98 : 0.5;
    const R = v3(0, r, -wbLen / 2), F = v3(0, r, wbLen / 2);
    const axis = e ? v3(0, 1, -0.12).normalize() : v3(0, 1, -0.06).normalize();
    const deckTop = e ? 0.2 : 0.11;
    const HB = v3(0, e ? 0.22 : 0.14, F.z - (e ? 0.04 : 0.028)), HT = HB.clone().addScaledVector(axis, e ? 0.98 : 0.75);
    out.wbLen = wbLen; out.r = r; out.deckTop = deckTop;
    const front = axisPivot(model, HB, axis);
    const steer = new THREE.Group(); front.add(steer); steer.updateMatrixWorld(true);
    const fk = new THREE.Group(); model.add(fk);
    // stem / bars
    if (e) {
      tube(HB, HB.clone().addScaledVector(axis, 0.12), 0.03, M.darkMetal, fk);
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.07), M.darkMetal); hinge.position.copy(HB).addScaledVector(axis, 0.15); hinge.quaternion.setFromUnitVectors(v3(0, 1, 0), axis); fk.add(hinge);
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.015), M.alloy); latch.position.copy(hinge.position).add(v3(0.035, 0, 0.01)); latch.quaternion.copy(hinge.quaternion); fk.add(latch);
      tube(HB.clone().addScaledVector(axis, 0.19), HT, 0.021, M.darkMetal, fk);
      // front suspension spring (helix)
      const hp = []; for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 12; hp.push(v3(Math.cos(a) * 0.03, HB.y - 0.03 - i / 60 * 0.08, HB.z + Math.sin(a) * 0.03 + 0.01)); }
      curveTube(hp, 0.004, M.postbox, fk);
    } else {
      tube(HB.clone().addScaledVector(axis, -0.02), HB.clone().addScaledVector(axis, 0.12), 0.025, M.darkMetal, fk); // headset
      for (const k of [0, 0.12]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.01, 18), M.alloy); cup.position.copy(HB).addScaledVector(axis, k); fk.add(cup); }
      tube(HB.clone().addScaledVector(axis, 0.12), HT, 0.017, paint, fk);
      const clampS = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.065, 0.052), M.darkMetal); clampS.position.copy(HB).addScaledVector(axis, 0.18); fk.add(clampS);
      for (const by of [-0.02, 0.02]) for (const bx of [-1, 1]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.012, 6).rotateZ(Math.PI / 2), M.alloy); bolt.position.copy(clampS.position).add(v3(bx * 0.03, by, 0)); fk.add(bolt); }
    }
    const barW = e ? 0.26 : 0.29;
    const gl = v3(-barW, HT.y, HT.z), gr = v3(barW, HT.y, HT.z);
    tube(gl, gr, e ? 0.014 : 0.0145, e ? M.darkMetal : paint, fk);
    if (!e) for (const sx of [-1, 1]) { tube(v3(sx * 0.075, HT.y - 0.2, HT.z + 0.005), v3(sx * 0.075, HT.y, HT.z), 0.011, paint, fk); weld(v3(sx * 0.075, HT.y, HT.z), 0.016, paint, fk); }
    if (!e) tube(v3(-0.075, HT.y - 0.2, HT.z + 0.005), v3(0.075, HT.y - 0.2, HT.z + 0.005), 0.012, paint, fk);
    for (const gp of [gl, gr]) {
      const sx = Math.sign(gp.x);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.14, 16).rotateZ(Math.PI / 2), M.grip); g.position.copy(gp).add(v3(-sx * 0.065, 0, 0)); fk.add(g);
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 16).rotateZ(Math.PI / 2), M.grip); fl.position.copy(gp).add(v3(-sx * 0.135, 0, 0)); fk.add(fl);
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 14).rotateZ(Math.PI / 2), M.alloy); end.position.copy(gp).add(v3(sx * 0.005, 0, 0)); fk.add(end);
      if (e) { const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.016), M.alloy); lever.position.copy(gp).add(v3(-sx * 0.07, -0.01, 0.04)); fk.add(lever); }
    }
    const gripL = new THREE.Object3D(); gripL.position.copy(gl).add(v3(0.065, 0, 0)); fk.add(gripL);
    const gripR = new THREE.Object3D(); gripR.position.copy(gr).add(v3(-0.065, 0, 0)); fk.add(gripR);
    // fork + front wheel
    for (const sx of [-1, 1]) tube(v3(sx * (e ? 0.045 : 0.03), HB.y - (e ? 0.12 : 0.01), HB.z), v3(sx * (e ? 0.045 : 0.03), F.y, F.z), e ? 0.013 : 0.01, M.darkMetal, fk);
    const fcrown = new THREE.Mesh(new THREE.BoxGeometry(e ? 0.12 : 0.08, 0.02, 0.04), M.darkMetal); fcrown.position.set(0, HB.y - (e ? 0.12 : 0.01), HB.z); fk.add(fcrown);
    const fw = e ? spokedWheel(r, 0.04, { fat: true, slick: true, motor: true, rimMat: M.darkMetal }) : stuntWheel(r, 0.026, M.alloy); fw.position.copy(F); fk.add(fw);
    if (e) {
      const disp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.016, 0.055), new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x2ad1ff, emissiveIntensity: 1.8 })); disp.position.copy(HT).add(v3(0, 0.022, 0.005)); fk.add(disp);
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.035, 16).rotateX(Math.PI / 2), M.headlight); hl.position.copy(HB).addScaledVector(axis, 0.62).add(v3(0, 0, 0.035)); fk.add(hl);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome); bell.position.copy(gl).add(v3(0.13, 0.015, 0)); fk.add(bell);
      curveTube([gl.clone().add(v3(0.12, 0, 0.02)), HT.clone().add(v3(-0.04, -0.08, 0.04)), HB.clone().addScaledVector(axis, 0.45).add(v3(-0.03, 0, 0.035)), HB.clone().addScaledVector(axis, 0.2).add(v3(-0.03, 0, 0.04))], 0.004, M.hose, fk);
      curveTube([gr.clone().add(v3(-0.12, 0, 0.02)), HT.clone().add(v3(0.04, -0.08, 0.04)), HB.clone().addScaledVector(axis, 0.45).add(v3(0.03, 0, 0.035)), HB.clone().addScaledVector(axis, 0.2).add(v3(0.03, 0, 0.04))], 0.004, M.hose, fk);
      const ffen = new THREE.Mesh(new THREE.TorusGeometry(r + 0.025, 0.02, 4, 18, 1.4).scale(1, 1, 2.2), M.darkMetal); ffen.rotation.y = Math.PI / 2; ffen.rotateZ(1.0); ffen.position.copy(F); fk.add(ffen);
    }
    steer.attach(fk);
    // deck + rear (tailwhips around the stem)
    const whip = axisPivot(model, HB, axis);
    const fr = new THREE.Group(); model.add(fr);
    const deckL = e ? 0.76 : 0.5, deckW = e ? 0.17 : 0.115, deckH = e ? 0.085 : 0.034;
    const dz = HB.z - deckL / 2 - 0.03;
    const deck = roundedDeckGeo(deckL, deckW, deckH, e ? 0.03 : 0.02);
    const dm = new THREE.Mesh(deck.geo, e ? M.darkMetal : paint); dm.position.set(0, deckTop - deckH, dz); dm.castShadow = true; fr.add(dm);
    const tape = new THREE.Mesh(new THREE.ShapeGeometry(deck.shape, 8).rotateX(-Math.PI / 2), M.griptape); tape.scale.set(0.92, 1, 0.96); tape.position.set(0, deckTop + 0.0015, dz); fr.add(tape);
    if (e) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(deckW + 0.004, 0.012, deckL * 0.8), paint); stripe.position.set(0, deckTop - deckH * 0.55, dz); fr.add(stripe);
      const kick = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.16), M.darkMetal); kick.position.set(-deckW / 2 - 0.005, deckTop - deckH + 0.01, dz - 0.05); fr.add(kick);
    }
    // neck from deck to head tube
    const neckA = v3(0, deckTop - deckH / 2, dz + deckL / 2 - 0.03), neckB = HB.clone().addScaledVector(axis, -0.01);
    tube(neckA, neckB, e ? 0.035 : 0.024, e ? M.darkMetal : paint, fr, e ? 0.03 : 0.022);
    // rear dropouts, brake/fender, wheel
    for (const sx of [-1, 1]) {
      const a = v3(sx * (e ? 0.05 : 0.032), deckTop - deckH * 0.5, dz - deckL / 2 + 0.03);
      const drop = new THREE.Mesh(new THREE.BoxGeometry(0.008, e ? 0.12 : 0.07, e ? 0.12 : 0.08), e ? M.darkMetal : paint); drop.position.copy(a.clone().lerp(v3(a.x, R.y, R.z), 0.5)); drop.rotation.x = e ? 0.4 : 0.6; fr.add(drop);
    }
    const fender = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.014, 4, 18, Math.PI * 0.55).scale(1, 1, e ? 3.0 : 1.9), M.darkMetal); fender.rotation.y = Math.PI / 2; fender.rotateZ(0.6); fender.position.copy(R); fr.add(fender);
    const rw = e ? spokedWheel(r, 0.04, { fat: true, slick: true, disc: 0.06, rimMat: M.darkMetal }) : stuntWheel(r, 0.026, M.alloy); rw.position.copy(R); fr.add(rw);
    if (e) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), M.taillight); tl.position.set(0, r + 0.12, R.z - 0.11); fr.add(tl);
      const shock = curveTube([v3(0.06, deckTop - deckH, dz - deckL / 2 + 0.1), v3(0.06, R.y + 0.05, R.z + 0.06)], 0.012, M.postbox, fr);
    }
    whip.attach(fr);
    out.front = front; out.steer = steer; out.whip = whip; out.grips = [gripL, gripR];
    out.wheels = [{ obj: fw, r }, { obj: rw, r }];
    out.feet = [v3(0.035, deckTop + 0.012, dz + deckL * 0.24), v3(-0.035, deckTop + 0.012, dz - deckL * 0.22)];
    out.footYaw = e ? [0.15, 0.25] : [0.35, 1.0];
    out.contactR = R.z; out.contactF = F.z;
  }
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  const rigid = []; model.traverse(o => { if (o.isGroup || o.type === 'Object3D') rigid.push(o); });
  for (const gr of rigid) mergeGroup(gr);
  return out;
}

// ───────────────────────── rider ─────────────────────────
const LIMB_CACHE = {};
function limb(r0, r1, len, mat) {
  const key = [r0, r1, len].join();
  const geo = LIMB_CACHE[key] || (LIMB_CACHE[key] = mergeGeometries([
    prepGeo(new THREE.CylinderGeometry(r1, r0, len, 12, 1, true)),
    prepGeo(new THREE.SphereGeometry(r0, 12, 8).translate(0, -len / 2, 0)),
    prepGeo(new THREE.SphereGeometry(r1, 12, 8).translate(0, len / 2, 0))]));
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m;
}
const MAT_CACHE = {};
const AV_SKIN = [0xf6d2b8, 0xe7b48f, 0xc98e66, 0xa36b45, 0x7a4e30, 0x4e3221];
const AV_HAIRC = [0x1d1a17, 0x4a2c1a, 0x8a5a2b, 0xd9b26a, 0xb5401f, 0xe8e2d8, 0x2b54d6, 0xe0409a];
const EYE_M = new THREE.MeshBasicMaterial({ color: 0x15171c });
const fabricC = hex => MAT_CACHE['f' + hex] || (MAT_CACHE['f' + hex] = fabric(hex, new THREE.Color(hex).offsetHSL(0, -0.1, 0.15).getHex()));
const skinC = hex => MAT_CACHE['s' + hex] || (MAT_CACHE['s' + hex] = new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.6, sheen: 0.3, sheenColor: 0xffd0b0 }));
const helmetC = hex => MAT_CACHE['h' + hex] || (MAT_CACHE['h' + hex] = new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }));
function buildRider(o = {}) {
  const g = new THREE.Group();
  const top = o.top != null ? fabricC(o.top) : M.hoodie, pants = o.pants != null ? fabricC(o.pants) : M.pants;
  const accent = o.ped ? top : M.accent;
  const D = { thigh: 0.45, shin: 0.46, upper: 0.3, fore: 0.28, torso: 0.52 };
  const torsoGeo = new THREE.LatheGeometry([[0.0, -0.04], [0.135, -0.02], [0.15, 0.06], [0.142, 0.18], [0.155, 0.3], [0.175, 0.4], [0.17, 0.48], [0.12, 0.54], [0.05, 0.57], [0.0, 0.575]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const torso = new THREE.Mesh(torsoGeo, top); torso.scale.set(1.18, 1, 0.78); torso.castShadow = true;
  const torsoG = new THREE.Group(); torsoG.add(torso);
  if (!o.ped) {
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.045, 10, 18, Math.PI * 1.1), M.hood); hood.position.set(0, 0.53, -0.07); hood.rotation.set(-0.5, 0, Math.PI * 0.95); torsoG.add(hood);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), M.hood); pocket.position.set(0, 0.12, 0.12); torsoG.add(pocket);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), accent); logo.position.set(0, 0.38, 0.137); torsoG.add(logo);
  } else {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16), top); collar.rotation.x = Math.PI / 2; collar.position.y = 0.55; torsoG.add(collar);
  }
  const parts = {
    thighL: limb(0.085, 0.06, D.thigh, pants), thighR: limb(0.085, 0.06, D.thigh, pants),
    shinL: limb(0.06, 0.045, D.shin, pants), shinR: limb(0.06, 0.045, D.shin, pants),
    upL: limb(0.058, 0.047, D.upper, top), upR: limb(0.058, 0.047, D.upper, top),
    foL: limb(0.047, 0.04, D.fore, top), foR: limb(0.047, 0.04, D.fore, top),
    torso: torsoG,
    pelvis: new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), pants),
    neck: limb(0.05, 0.045, 0.1, o.ped ? skinC(o.skin) : top),
  };
  parts.pelvis.scale.set(1.2, 0.8, 0.9);
  if (!o.ped) for (const k of ['foL', 'foR']) { const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.04, 12), M.accent); cuff.position.y = D.fore / 2 - 0.02; parts[k].add(cuff); }
  const shoe = () => {
    const s = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.028, 0.29), M.sole); sole.position.set(0, -0.035, 0.04); s.add(sole);
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 6, 12).rotateX(Math.PI / 2), o.ped ? M.sole : M.shoe); up.scale.set(1.05, 0.75, 1); up.position.set(0, 0.0, 0.04); s.add(up);
    if (!o.ped) { const toe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 8), M.sole); toe.scale.set(1, 0.5, 1.1); toe.position.set(0, -0.02, 0.15); s.add(toe); const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.1), M.accent); tongue.position.set(0, 0.035, 0.01); s.add(tongue); }
    return s;
  };
  parts.shoeL = shoe(); parts.shoeR = shoe();
  const hand = () => { const h = new THREE.Group(); const m = o.ped ? skinC(o.skin) : M.glove; const p = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), m); p.scale.set(0.85, 1.25, 0.6); h.add(p); const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.06, 4, 8), m); f.position.set(0, 0.06, 0.02); f.rotation.x = 0.6; h.add(f); return h; };
  parts.handL = hand(); parts.handR = hand();
  const head = new THREE.Group();
  if (o.ped) {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), skinC(o.skin)); skull.scale.set(0.9, 1.08, 1.0); head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), o.hat ? fabricC(o.top) : new THREE.MeshStandardMaterial({ color: o.hair, roughness: 0.9 }));
    hair.scale.set(0.95, o.hat ? 1.15 : 1.05, 1.05); hair.position.y = 0.012; hair.rotation.x = -0.25; head.add(hair);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skinC(o.skin)); nose.position.set(0, -0.01, 0.105); head.add(nose);
    for (const sx of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), skinC(o.skin)); ear.scale.set(0.5, 1, 0.8); ear.position.set(sx * 0.1, 0, 0); head.add(ear); }
  } else if (o.gear && o.gear !== 'full') {
    // avatar head: face, hair and an open helmet / cap / beanie
    const hm = helmetC(o.helmet != null ? o.helmet : 0xff4d1f), sk = skinC(o.skin != null ? o.skin : 0xe7b48f), hc = new THREE.MeshStandardMaterial({ color: o.hairCol != null ? o.hairCol : 0x4a2c1a, roughness: 0.9 });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), sk); skull.scale.set(0.9, 1.08, 1.0); head.add(skull);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), sk); nose.position.set(0, -0.01, 0.105); head.add(nose);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), sk); ear.scale.set(0.5, 1, 0.8); ear.position.set(sx * 0.1, 0, 0); head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(o.eyes === 'cool' ? 0.026 : 0.012, 8, 6), EYE_M); eye.position.set(sx * 0.036, 0.018, 0.094); if (o.eyes === 'cool') eye.scale.set(1.3, 0.7, 0.4); head.add(eye);
    }
    const hairShown = o.gear === 'none' || o.gear === 'cap';
    if (hairShown && o.hair !== 'bald') {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.116, 20, 12, 0, Math.PI * 2, 0, Math.PI * (o.hair === 'buzz' ? 0.45 : 0.55)), hc);
      hair.scale.set(o.hair === 'curly' ? 1.08 : 0.96, o.hair === 'curly' ? 1.15 : 1.05, 1.06); hair.position.y = 0.012; hair.rotation.x = -0.25; head.add(hair);
      if (o.hair === 'long') { const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.12, 4, 10), hc); back.position.set(0, -0.06, -0.06); back.scale.set(1.3, 1, 0.6); head.add(back); }
      if (o.hair === 'mohawk' && o.gear === 'none') { const mh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.2), hc); mh.position.set(0, 0.12, -0.01); head.add(mh); }
      if (o.hair === 'bun' && o.gear === 'none') { const bn = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), hc); bn.position.set(0, 0.1, -0.08); head.add(bn); }
    }
    if (o.gear === 'open') {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hm); shell.scale.set(0.95, 1, 1.08); shell.position.y = 0.02; shell.rotation.x = -0.18; head.add(shell);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 20, Math.PI), M.helmetTrim); strap.rotation.set(0, Math.PI / 2, Math.PI); strap.position.y = -0.0; strap.scale.set(1, 1.2, 1); head.add(strap);
    } else if (o.gear === 'cap') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), hm); cap.scale.set(0.96, 1, 1.06); cap.position.y = 0.025; cap.rotation.x = -0.2; head.add(cap);
      const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 18, 1, false, -Math.PI / 2, Math.PI), hm); peak.position.set(0, 0.06, 0.07); peak.scale.set(1, 1, 1.2); peak.rotation.x = 0.12; head.add(peak);
    } else if (o.gear === 'beanie') {
      const bea = new THREE.Mesh(new THREE.SphereGeometry(0.122, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hm); bea.scale.set(0.96, 1.15, 1.05); bea.position.y = 0.015; bea.rotation.x = -0.2; head.add(bea);
      const fold = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.022, 8, 22), hm); fold.rotation.x = Math.PI / 2 - 0.2; fold.position.set(0, 0.03, -0.005); fold.scale.set(0.96, 1.05, 1); head.add(fold);
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), hm); pom.position.set(0, 0.155, -0.035); head.add(pom);
    }
  } else {
    const hm = o.helmet != null ? helmetC(o.helmet) : M.helmet;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.155, 28, 22), hm); shell.scale.set(0.95, 1.0, 1.1);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), M.helmetTrim); face.position.set(0, -0.03, 0.05); face.scale.set(0.9, 0.85, 1.05);
    const chin = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 10, 24, Math.PI * 0.85).rotateZ(Math.PI * 0.075).rotateX(Math.PI / 2), hm); chin.position.set(0, -0.085, 0.035); chin.scale.set(1, 1.5, 1.12);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.03), M.helmetTrim); vent.position.set(0, -0.085, 0.172);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.01, 0.11), hm); peak.position.set(0, 0.105, 0.16); peak.rotation.x = -0.2;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 24, 1, true, -0.95, 1.9), M.visor); lens.position.set(0, 0.03, 0.022); lens.scale.set(1, 1, 1.1);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.158, 0.158, 0.032, 28, 1, true), M.accent); strap.position.set(0, 0.03, 0); strap.scale.set(0.97, 1, 1.12);
    head.add(shell, face, chin, vent, peak, lens, strap);
  }
  parts.head = head;
  for (const k of ['shoeL', 'shoeR', 'handL', 'handR', 'head', 'torso']) mergeGroup(parts[k]);
  for (const k in parts) { parts[k].traverse(m => { if (m.isMesh) m.castShadow = true; }); g.add(parts[k]); }
  g.userData.noMerge = true;
  return { group: g, parts, D };
}
const _a = v3(), _b = v3(), _c = v3(), _d = v3(), _up = v3(0, 1, 0);
function placeSeg(mesh, p, q) {
  _a.subVectors(q, p); const len = _a.length();
  mesh.position.copy(p).addScaledVector(_a, 0.5);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(_up, _a.divideScalar(len));
}
function ik(root, target, l1, l2, pole, outMid, outEnd) {
  _b.subVectors(target, root); let d = _b.length();
  d = clamp(d, 0.05, l1 + l2 - 0.002);
  _b.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _c.copy(pole).addScaledVector(_b, -pole.dot(_b)).normalize();
  outMid.copy(root).addScaledVector(_b, l1 * cosA).addScaledVector(_c, l1 * sinA);
  outEnd.copy(root).addScaledVector(_b, d);
}
// lay the body parts along the solved skeleton
function placeBody(R, L, lookDir, shoeYaw = [0, 0]) {
  const pr = R.parts;
  placeSeg(pr.thighL, L.hp[0], L.knee[0]); placeSeg(pr.shinL, L.knee[0], L.foot[0]);
  placeSeg(pr.thighR, L.hp[1], L.knee[1]); placeSeg(pr.shinR, L.knee[1], L.foot[1]);
  placeSeg(pr.upL, L.sh[0], L.elbow[0]); placeSeg(pr.foL, L.elbow[0], L.hand[0]);
  placeSeg(pr.upR, L.sh[1], L.elbow[1]); placeSeg(pr.foR, L.elbow[1], L.hand[1]);
  pr.torso.position.copy(L.hip); pr.torso.quaternion.setFromUnitVectors(_up, lookDir);
  pr.pelvis.position.copy(L.hip).addScaledVector(lookDir, 0.03);
  placeSeg(pr.neck, L.chest, _d.copy(L.chest).addScaledVector(lookDir, 0.12));
  for (let s = 0; s < 2; s++) {
    const h = s ? pr.handR : pr.handL; h.position.copy(L.hand[s]);
    h.quaternion.setFromUnitVectors(_up, _a.subVectors(L.hand[s], L.elbow[s]).normalize());
    const sh = s ? pr.shoeR : pr.shoeL; sh.position.copy(L.foot[s]); sh.rotation.set(0, shoeYaw[s], 0);
  }
  pr.head.position.copy(L.chest).addScaledVector(lookDir, 0.22).add(v3(0, 0.01, 0.02));
}

// ───────────────────────── player ─────────────────────────
const G = 13; // gravity m/s²
const settings = { easy: store.get('easy', true), slowmo: store.get('slowmo', true) };
const player = {
  kind: store.get('vehicle', 'bike'), zone: store.get('zone', 'auto'),
  pos: v3(), yaw: 0, v: 0, vy: 0, air: false, vel: v3(),
  steer: 0, slope: 0, lean: 0, visPitch: 0, visY: 0,
  wheelie: 0, wheelieV: 0, inWheelie: false, wobble: 0, stop: 0, stopV: 0, inStop: false,
  flip: 0, spin: 0, whip: 0, whipLeft: 0, whipDir: 1, whipName: 'Tailwhip', bar: 0, barLeft: 0, autoTurn: 0, poses: {},
  airTime: 0, airStart: v3(), maxH: 0, crouch: 0, crouchV: 0, crank: 0,
  bailed: false, bailT: 0, safe: { pos: v3(), yaw: 0 }, hist: [], safeT: 0, landWindow: 0, kickPhase: 0, kickAmt: 0, onRamp: null,
  grind: null, braking: false, dist: 0,
};
// trick buttons per vehicle: key → trick
const TRICK_KEYS = ['J', 'K', 'L', 'I', 'U', 'O', 'SH'];
const TRICKS = {
  bike: { J: { t: 'whip', n: 'Tailwhip', d: 1 }, K: { t: 'bar', n: 'Barspin' }, L: { t: 'pose', p: 'superman', n: 'Superman' }, I: { t: 'pose', p: 'nohand', n: 'No-Hander' }, U: { t: 'pose', p: 'tabletop', n: 'Tabletop' }, O: { t: 'pose', p: 'cancan', n: 'Can-Can' }, SH: { t: 'pose', p: 'xup', n: 'X-Up' } },
  ebike: { J: { t: 'whip', n: 'Tailwhip', d: 1 }, K: { t: 'bar', n: 'Barspin' }, L: { t: 'pose', p: 'superman', n: 'Superman' }, I: { t: 'pose', p: 'nohand', n: 'No-Hander' }, U: { t: 'pose', p: 'tabletop', n: 'Tabletop' }, O: { t: 'pose', p: 'cancan', n: 'Can-Can' }, SH: { t: 'pose', p: 'xup', n: 'X-Up' } },
  scooter: { J: { t: 'whip', n: 'Tailwhip', d: 1 }, K: { t: 'bar', n: 'Barspin' }, L: { t: 'pose', p: 'nofooter', n: 'No-Footer' }, I: { t: 'pose', p: 'nohand', n: 'No-Hander' }, U: { t: 'whip', n: 'Heelwhip', d: -1 }, O: { t: 'pose', p: 'indy', n: 'Indy Grab' }, SH: { t: 'pose', p: 'nacnac', n: 'Nac-Nac' } },
  escooter: { J: { t: 'whip', n: 'Tailwhip', d: 1 }, K: { t: 'bar', n: 'Barspin' }, L: { t: 'pose', p: 'kickout', n: 'Kickout' }, I: { t: 'pose', p: 'nohand', n: 'No-Hander' }, U: { t: 'whip', n: 'Heelwhip', d: -1 }, O: { t: 'pose', p: 'indy', n: 'Indy Grab' }, SH: { t: 'pose', p: 'cancan', n: 'Can-Can' } },
};
const POSE_PTS = { superman: 300, nofooter: 300, kickout: 240, nohand: 220, tabletop: 330, cancan: 260, xup: 240, indy: 260, nacnac: 280 };
const GRIND_STYLES = {
  bike: { none: 'Double Peg', A: 'Feeble', D: 'Smith', W: 'Icepick', S: 'Luc-E' },
  scooter: { none: '50-50', A: 'Feeble', D: 'Smith', W: 'Nose Grind', S: 'Crooked' },
};
GRIND_STYLES.ebike = GRIND_STYLES.bike; GRIND_STYLES.escooter = GRIND_STYLES.scooter;

const COM = 0.85;
function makeAvatar(riderOpts = {}) {
  const A = { root: new THREE.Group(), slopeG: new THREE.Group(), airG: new THREE.Group(), wheelieG: new THREE.Group(), rider: buildRider(riderOpts), veh: null, sm: {} };
  A.slopeG.rotation.order = 'YXZ'; A.airG.rotation.order = 'XZY';
  A.root.add(A.slopeG); A.slopeG.add(A.airG); A.airG.add(A.wheelieG);
  A.airG.position.y = COM; A.wheelieG.position.y = -COM;
  A.root.userData.noMerge = true;
  scene.add(A.root);
  return A;
}
function setAvatarVehicle(A, kind, colorIdx) {
  if (A.veh) { A.wheelieG.remove(A.veh.model); A.veh.model.traverse(o => o.geometry && o.geometry.dispose()); }
  A.veh = buildVehicle(kind, colorIdx); A.veh.cfg = VEH[kind]; A.kind = kind;
  A.wheelieG.add(A.veh.model);
  A.veh.model.add(A.rider.group);
  A.veh.model.position.set(0, 0, -A.veh.contactR); A.wheelieG.position.z = A.veh.contactR;
}
const me = makeAvatar();
const root = me.root, slopeG = me.slopeG, airG = me.airG, wheelieG = me.wheelieG;
let veh = null, rider = me.rider;
function equip(kind) {
  player.kind = kind; store.set('vehicle', kind);
  setAvatarVehicle(me, kind, paintColor);
  veh = me.veh; veh.cfg = vehCfg(kind);
  applyPaint(veh.paint, paintId, COLORS[paintColor]);
  { const key = outfitId + JSON.stringify(AV); if (me.lookKey !== key) { me.lookKey = key; AV.outfit = outfitId; applyOutfitTo(me, outfitId, AV); rider = me.rider; } }
  document.getElementById('veh-name').textContent = VEH[kind].label;
  buildTrickBar();
  if (typeof net !== 'undefined') net.announce();
}
function spawn(zoneKey) {
  const z = ZONES[zoneKey];
  player.pos.copy(z.pos); player.yaw = z.yaw; player.v = 0; player.vy = 0; player.air = false; player.vel.set(0, 0, 0); player.grind = null;
  player.pos.y = heightAt(z.pos.x, z.pos.z);
  resetTricks(); player.wheelie = 0; player.wheelieV = 0; player.stop = 0; player.inStop = false; player.bailed = false; player.crouch = 0;
  player.safe.pos.copy(player.pos); player.safe.yaw = player.yaw; player.hist = [];
  camState.init = false; endCombo(false);
  if (rider.group.parent !== veh.model) { veh.model.add(rider.group); rider.group.position.set(0, 0, 0); rider.group.rotation.set(0, 0, 0); }
  bailVis.active = false; root.visible = true; root.position.copy(player.pos); root.rotation.set(0, player.yaw, 0);
  clearTrafficNear(player.pos);
}
function resetTricks() {
  Object.assign(player, { flip: 0, spin: 0, whip: 0, whipLeft: 0, bar: 0, barLeft: 0, autoTurn: 0, autoLeft: 0, airTime: 0, maxH: 0, vertAir: false });
  player.poses = {};
  airTricks = { counts: {}, poseTime: {} };
}
function timeToLand(P) {
  const h = P.pos.y - heightAt(P.pos.x, P.pos.z), vy = P.vel.y;
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * Math.max(0, h)))) / G;
}

// ───────────────────────── input ─────────────────────────
const keys = {};
const pressed = new Set();
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.repeat) { if (['Space'].includes(e.code)) e.preventDefault(); return; }
  keys[e.code] = true; pressed.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const touch = { x: 0, y: 0, btn: {} };
const input = { throttle: 0, brake: 0, steer: 0, jump: false, wheelie: false, tr: {} };
let chatOpen = false;
let padPrev = {};
function readInput() {
  const k = c => !!keys[c];
  let thr = k('KeyW') || k('ArrowUp') ? 1 : 0, brk = k('KeyS') || k('ArrowDown') ? 1 : 0;
  let st = (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0);
  let jump = pressed.has('Space'), wh = k('ShiftLeft') || k('ShiftRight');
  let t1 = k('KeyJ'), t2 = k('KeyK'), t3 = k('KeyL'), t4 = k('KeyI'), t5 = k('KeyU'), t6 = k('KeyO');
  // touch
  if (Math.abs(touch.x) > 0.15) st += -touch.x;
  if (touch.y < -0.25) thr = Math.max(thr, clamp(-touch.y * 1.3, 0, 1));
  if (touch.y > 0.25) brk = Math.max(brk, clamp(touch.y * 1.3, 0, 1));
  if (touch.btn.jumpP) { jump = true; touch.btn.jumpP = false; }
  wh ||= !!touch.btn.wheelie; t1 ||= !!touch.btn.t1; t2 ||= !!touch.btn.t2; t3 ||= !!touch.btn.t3; t4 ||= !!touch.btn.t4; t5 ||= !!touch.btn.t5; t6 ||= !!touch.btn.t6;
  // gamepad
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const b = i => p.buttons[i] && p.buttons[i].pressed, bv = i => p.buttons[i] ? p.buttons[i].value : 0;
    const lx = p.axes[0] || 0, ly = p.axes[1] || 0;
    if (Math.abs(lx) > 0.15) st += -lx;
    thr = Math.max(thr, bv(7), ly < -0.3 ? -ly : 0); brk = Math.max(brk, bv(6), ly > 0.3 ? ly : 0);
    if (b(0) && !padPrev[0]) jump = true;
    wh ||= b(4); t1 ||= b(2); t2 ||= b(3); t3 ||= b(1); t4 ||= b(5); t5 ||= b(12) || b(14); t6 ||= b(13) || b(15);
    if (b(9) && !padPrev[9]) togglePause();
    if (b(3) && b(2) && !padPrev.r) { } // reserved
    padPrev = {}; p.buttons.forEach((x, i) => padPrev[i] = x.pressed);
    break;
  }
  if (chatOpen) { thr = brk = st = 0; jump = wh = t1 = t2 = t3 = t4 = t5 = t6 = false; }
  Object.assign(input, { throttle: clamp(thr, 0, 1), brake: clamp(brk, 0, 1), steer: clamp(st, -1, 1), jump, wheelie: wh, tr: { J: t1, K: t2, L: t3, I: t4, U: t5, O: t6, SH: wh } });
}

// ───────────────────────── scoring ─────────────────────────
let score = 0, best = store.get('best', 0);
let combo = { parts: [], pts: 0, mult: 0, active: false, seen: {} };
const MULT_CAP = 12, COMBO_COIN_CAP = 2500;
let airTricks = { counts: {}, poseTime: {} };
let wheelieAcc = 0;
const elScore = document.getElementById('score'), elBest = document.getElementById('best'), elCN = document.getElementById('combo-names'), elCS = document.getElementById('combo-score');
elBest.textContent = best.toLocaleString();
function addToCombo(name, pts, mult = 1) {
  // doing the same thing again in one combo pays less each time (like a real judge would score it)
  const key = String(name).replace(/\s*\(\d+m\)$/, '');
  const n = combo.seen[key] = (combo.seen[key] || 0) + 1;
  const f = Math.max(0.15, 1 - 0.3 * (n - 1));
  combo.active = true; combo.parts.push(n > 1 ? `${name} ×${n}` : name);
  combo.pts += pts * f;
  combo.mult = Math.min(MULT_CAP, combo.mult + (n <= 2 ? mult : n <= 4 ? Math.min(1, mult) : 0));
  renderCombo();
}
function renderCombo() {
  if (!combo.active) { elCN.textContent = ''; elCS.innerHTML = ''; return; }
  const p = combo.parts.slice(-4); elCN.textContent = (combo.parts.length > 4 ? '… + ' : '') + p.join(' + ');
  elCS.innerHTML = `${Math.round(combo.pts).toLocaleString()} <span class="mult">× ${Math.max(1, combo.mult)}</span>`;
}
function endCombo(bank) {
  if (combo.active && bank) {
    const total = Math.round(combo.pts * Math.max(1, combo.mult));
    score += total; elScore.textContent = score.toLocaleString();
    if (score > best) { best = score; store.set('best', best); elBest.textContent = best.toLocaleString(); }
    // harder tricks score more, and coins come from the score: bigger tricks and longer combos pay more
    const coins = earn(Math.min(COMBO_COIN_CAP, total / 20 * (combo.mult >= 6 ? 1.5 : combo.mult >= 3 ? 1.2 : 1)));
    if (total > 300) showPopup('+' + total.toLocaleString(), 'good', (combo.mult >= 4 ? 'SICK COMBO · ' : '') + `+${coins} COINS`);
    else if (coins) addFeed(`<b>+${coins} coins</b>`);
    online.submit('combo', total);
    if (total >= 5000) goal('combo5k');
    if (combo.mult >= 8) goal('mult8');
    if (total >= 800) net.trick(combo.parts.slice(-3).join(' + '), total);
    net.renderRoom();
    sfx.ding();
  }
  combo = { parts: [], pts: 0, mult: 0, active: false, seen: {} }; renderCombo();
}
let popTimer = 0;
const elPop = document.getElementById('popup');
function showPopup(text, cls = '', sub = '') {
  elPop.className = 'show ' + cls; elPop.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : ''); popTimer = 1.4;
}

// ───────────────────────── audio ─────────────────────────
const sfxLevel = () => store.get('muted', false) ? 0 : store.get('sfxVol', 0.6) * 0.75;
const sfx = (() => {
  let ctx = null, master, windG, windF, rollG, rollF, motorO, motorG, motorF, skidG, skidF, tickPh = 0;
  const init = () => {
    if (ctx) return; ctx = new (window.AudioContext || window.webkitAudioContext)();
    // everything goes through a gentle compressor so landings and crashes never blast
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2; comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = sfxLevel(); master.connect(comp);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type, f, q) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return [g, fl]; };
    [windG, windF] = mk('lowpass', 300, 0.5);
    [rollG, rollF] = mk('lowpass', 200, 0.7);
    [skidG, skidF] = mk('bandpass', 1800, 1.5);
    // electric motor: a soft whine instead of a buzzing sawtooth
    motorO = ctx.createOscillator(); motorO.type = 'triangle'; motorF = ctx.createBiquadFilter(); motorF.type = 'lowpass'; motorF.frequency.value = 1100; motorG = ctx.createGain(); motorG.gain.value = 0;
    motorO.connect(motorF); motorF.connect(motorG); motorG.connect(master); motorO.start();
    sfx.buf = buf;
  };
  const burst = (dur, f0, f1, gain, type = 'lowpass') => {
    if (!ctx) return; const s = ctx.createBufferSource(); s.buffer = sfx.buf; const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = 1;
    const g = ctx.createGain(); const t = ctx.currentTime;
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  };
  const tone = (f, dur, gain, t0 = 0, type = 'sine') => {
    if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + t0; o.type = type;
    o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  return {
    init,
    update(speed, ground, motor, thr, surface, skid = false, freewheel = false, dt = 0) {
      if (!ctx) return; const t = ctx.currentTime;
      const soft = surface === 'dirt' || surface === 'grass';
      skidG.gain.setTargetAtTime(skid && ground ? Math.min(0.08, speed * 0.012) : 0, t, 0.04);
      skidF.frequency.setTargetAtTime(soft ? 450 : 1600 + speed * 25, t, 0.05);
      // freewheel hub: a few soft clicks, not a buzz
      if (freewheel && ground && speed > 0.8) { tickPh += dt * Math.min(16, speed * 2.2); if (tickPh > 1) { tickPh %= 1; burst(0.012, 3800, 2600, 0.01, 'bandpass'); } }
      windG.gain.setTargetAtTime(Math.min(0.16, speed * speed * 0.0006), t, 0.15); windF.frequency.setTargetAtTime(180 + speed * 22, t, 0.15);
      rollG.gain.setTargetAtTime(ground ? Math.min(0.13, speed * (soft ? 0.02 : 0.011)) : 0, t, 0.08);
      rollF.frequency.setTargetAtTime(soft ? 140 : 190 + speed * 6, t, 0.1);
      motorG.gain.setTargetAtTime(motor ? (0.004 + thr * 0.014) * Math.min(1, speed / 3 + thr) : 0, t, 0.1);
      motorO.frequency.setTargetAtTime(160 + speed * 26, t, 0.08);
    },
    land(h) { burst(0.2, 700, 60, Math.min(0.35, 0.1 + h * 0.05)); tone(70, 0.15, Math.min(0.25, 0.08 + h * 0.03)); },
    whoosh() { burst(0.3, 600, 2400, 0.07, 'bandpass'); },
    splash() { burst(0.8, 1600, 120, 0.4); burst(0.45, 3200, 900, 0.12, 'bandpass'); },
    crash() { burst(0.5, 2200, 80, 0.4); tone(55, 0.35, 0.25); },
    thud() { burst(0.22, 500, 70, 0.3); tone(95, 0.16, 0.18); },
    ding() { tone(880, 0.25, 0.08); tone(1320, 0.35, 0.06, 0.08); },
    hop() { burst(0.1, 300, 1000, 0.06, 'bandpass'); },
    setVolume(v) { store.set('sfxVol', v); if (master) master.gain.setTargetAtTime(sfxLevel(), ctx.currentTime, 0.05); },
    toggleMute() { const m = !store.get('muted', false); store.set('muted', m); if (master) master.gain.value = sfxLevel(); return m; },
  };
})();

// ───────────────────────── particles ─────────────────────────
const puffTex = softCircle();
const puffs = [];
for (let i = 0; i < 80; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xc8a888, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; scene.add(s); puffs.push({ s, life: 0, vel: v3() });
}
let puffI = 0;
function emitDust(p, n, surf, power = 1) {
  const col = surf === 'dirt' ? 0xb88d66 : surf === 'grass' ? 0x8a9a6a : surf === 'water' ? 0xe8f4ff : surf === 'sand' ? 0xd8c49a : 0xb8b2a8;
  for (let i = 0; i < n; i++) {
    const q = puffs[puffI++ % puffs.length]; q.life = 1; q.max = rand(0.6, 1.2);
    q.s.visible = true; q.s.position.copy(p).add(v3(rand(-0.3, 0.3), 0.1, rand(-0.3, 0.3)));
    q.vel.set(rand(-2, 2) * power, rand(0.5, 2) * power, rand(-2, 2) * power); q.s.material.color.setHex(col); q.s.scale.setScalar(rand(0.4, 0.8));
  }
}
const sparks = [];
for (let i = 0; i < 60; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: new THREE.Color(4, 2.2, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.visible = false; scene.add(s); sparks.push({ s, life: 0, vel: v3() }); }
let sparkI = 0;
function emitSparks(p, n, kind) {
  for (let i = 0; i < n; i++) {
    if (kind === 'ledge') { emitDust(p, 1, 'concrete', 0.25); continue; }
    const q = sparks[sparkI++ % sparks.length]; q.life = 1; q.max = rand(0.12, 0.3);
    q.s.visible = true; q.s.position.copy(p); q.s.scale.setScalar(rand(0.018, 0.04));
    q.vel.set(rand(-2.5, 2.5), rand(0.5, 3), rand(-2.5, 2.5));
  }
}
function updateDust(dt) {
  for (const q of sparks) { if (q.life <= 0) continue; q.life -= dt / q.max; if (q.life <= 0) { q.s.visible = false; continue; } q.vel.y -= 12 * dt; q.s.position.addScaledVector(q.vel, dt); q.s.material.opacity = q.life; }
  for (const q of puffs) {
    if (q.life <= 0) continue;
    q.life -= dt / q.max; if (q.life <= 0) { q.s.visible = false; continue; }
    q.s.position.addScaledVector(q.vel, dt); q.vel.multiplyScalar(1 - dt * 2);
    q.s.scale.multiplyScalar(1 + dt * 1.6); q.s.material.opacity = q.life * 0.5;
  }
}


// skid marks / ruts left by a locked rear wheel
const SKID_N = 900;
const skidPos = new Float32Array(SKID_N * 18), skidCol = new Float32Array(SKID_N * 18);
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3)); skidGeo.setAttribute('color', new THREE.BufferAttribute(skidCol, 3));
const skidMesh = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
skidMesh.frustumCulled = false; scene.add(skidMesh);
let skidI = 0, lastSkid = null;
function updateSkids() {
  const P = player;
  if (!P.skidding || P.air || P.bailed || P.inWheelie) { lastSkid = null; return; }
  const f = forward(P.yaw, v3());
  const pt = v3(P.pos.x + f.x * veh.contactR, 0, P.pos.z + f.z * veh.contactR); pt.y = heightAt(pt.x, pt.z) + 0.012;
  if (!lastSkid) { lastSkid = pt; return; }
  if (pt.distanceTo(lastSkid) < 0.18) return;
  const w = veh.kind === 'scooter' ? 0.016 : veh.kind === 'escooter' ? 0.028 : 0.026;
  const d = v3().subVectors(pt, lastSkid).normalize(), side = v3(-d.z, 0, d.x).multiplyScalar(w);
  const surf = P.onRamp ? P.onRamp.surface : surfaceAt(pt.x, pt.z);
  const c = surf === 'dirt' ? [0.3, 0.2, 0.13] : surf === 'grass' ? [0.22, 0.26, 0.12] : [0.03, 0.03, 0.03];
  const A = lastSkid.clone().add(side), B = lastSkid.clone().sub(side), C2 = pt.clone().add(side), D2 = pt.clone().sub(side);
  const o = (skidI % SKID_N) * 18;
  [A, B, C2, B, D2, C2].forEach((p, k) => { skidPos[o + k * 3] = p.x; skidPos[o + k * 3 + 1] = p.y; skidPos[o + k * 3 + 2] = p.z; skidCol[o + k * 3] = c[0]; skidCol[o + k * 3 + 1] = c[1]; skidCol[o + k * 3 + 2] = c[2]; });
  skidI++; skidGeo.attributes.position.needsUpdate = true; skidGeo.attributes.color.needsUpdate = true; skidGeo.setDrawRange(0, Math.min(skidI, SKID_N) * 6);
  lastSkid = pt;
}

// ───────────────────────── physics ─────────────────────────
const fwd = v3();
function forward(yaw, out = fwd) { return out.set(Math.sin(yaw), 0, Math.cos(yaw)); }
function collideWorld(p) {
  let hit = false;
  if (Math.abs(p.x) > WORLD - 2 || p.z > WORLD - 2 || p.z < -340) { p.x = clamp(p.x, -WORLD + 2, WORLD - 2); p.z = clamp(p.z, -340, WORLD - 2); hit = true; }
  const R = 0.45;
  for (const c of colliders) {
    if (p.x > c.x0 - R && p.x < c.x1 + R && p.z > c.z0 - R && p.z < c.z1 + R && p.y < (c.h ?? 99)) {
      const dl = p.x - (c.x0 - R), dr = c.x1 + R - p.x, db = p.z - (c.z0 - R), df = c.z1 + R - p.z;
      const m = Math.min(dl, dr, db, df);
      if (m === dl) p.x = c.x0 - R; else if (m === dr) p.x = c.x1 + R; else if (m === db) p.z = c.z0 - R; else p.z = c.z1 + R;
      hit = true;
    }
  }
  return hit;
}

function step(dt) {
  const P = player, C = veh.cfg;
  if (P.bailed) return;
  forward(P.yaw);
  const px = P.pos.x, pz = P.pos.z;
  if (P.grind) grindStep(dt, P);
  else if (!P.air) groundStep(dt, P, C);
  else airStep(dt, P, C);
  P.dist += Math.hypot(P.pos.x - px, P.pos.z - pz);
  if (!P.bailed) {
    // traffic: get hit (or ride into a car)
    const car = carHit(P.pos);
    if (car) {
      const sp = P.air ? Math.hypot(P.vel.x, P.vel.z) : Math.abs(P.v);
      if (car.v > 2.5 || sp > 6) { if (P.grind) endGrind(P, false); return bail(car.v > 2.5 ? 'HIT BY A CAR' : 'CRASHED INTO A CAR'); }
      P.v *= -0.3; const dx = P.pos.x - car.x, dz = P.pos.z - car.z; P.pos.x += Math.sign(dx) * 0.1; P.pos.z += Math.sign(dz) * 0.1;
    }
    // bumping into pedestrians just knocks you back
    for (const p of PEDS) {
      if (p.down) continue;
      const dx = P.pos.x - p.x, dz = P.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.6 && P.pos.y - heightAt(p.x, p.z) < 1.5 && d > 0.001) {
        const sp = Math.abs(P.v);
        if (sp > 2.2) { knockDown(p, Math.sin(P.yaw) * Math.sign(P.v || 1), Math.cos(P.yaw) * Math.sign(P.v || 1), sp); P.v *= 0.82; P.wobble = (P.wobble || 0) + (Math.random() - 0.5) * 0.25; }
        else { P.pos.x = p.x + dx / d * 0.6; P.pos.z = p.z + dz / d * 0.6; P.v *= 0.5; }
      }
    }
  }
}

function groundStep(dt, P, C) {
  const kind = veh.kind;
  const surf = surfaceAt(P.pos.x, P.pos.z);
  const gi = groundInfo(P.pos.x, P.pos.z);
  const onRampSurf = gi.ramp ? gi.ramp.surface : surf;
  const k = slopeAlong(P.pos.x, P.pos.z, fwd.x, fwd.z);
  const th = Math.atan(k);
  P.slope = th; P.onRamp = gi.ramp;
  // longitudinal
  let a = 0;
  const top = C.top * ((surf === 'grass' || surf === 'sand') && !gi.ramp ? 0.55 : 1);
  const sp0 = Math.abs(P.v);
  if (veh.kind === 'scooter') {
    // real kick-pushes: speed comes in surges while the back foot is planted
    const kicking = input.throttle > 0 && sp0 < top * 0.97;
    P.kickAmt = damp(P.kickAmt || 0, kicking ? 1 : 0, 7, dt);
    if (P.kickAmt > 0.05) P.kickPhase = (P.kickPhase + dt * (1.15 + sp0 * 0.03)) % 1;
    const push = Math.max(0, -Math.sin(P.kickPhase * Math.PI * 2));
    if (kicking && P.v >= -0.5) a += C.accel * 2.3 * push * P.kickAmt * clamp(1 - P.v / top, 0, 1);
  } else if (input.throttle > 0 && P.v >= -0.5) {
    // e-bike motor assist fades out above 25 km/h like a road-legal one; e-scooter pulls hard to the top
    const assist = kind === 'ebike' ? (P.v < 6.9 ? 1 : 0.5) : 1;
    a += input.throttle * C.accel * assist * clamp(1 - P.v / top, 0, 1);
  }
  if (input.brake > 0) { if (P.v > 0.3) a -= input.brake * 11; else a -= input.brake * 3 * clamp(1 + P.v / 3, 0, 1); }
  // pumping transitions
  if (Math.abs(th) > 0.15 && input.throttle > 0 && P.v > 0 && th < 0) a += 3.5;
  a -= G * Math.sin(th);
  const rr = onRampSurf === 'grass' ? 1.8 : onRampSurf === 'sand' ? 2.2 : onRampSurf === 'dirt' ? 0.22 : 0.12;
  a -= Math.sign(P.v) * (rr + 0.0045 * P.v * P.v);
  if (P.inWheelie && C.motor) a *= 1.0;
  const oldV = P.v; P.v += a * dt;
  if (oldV > 0 && P.v < 0 && input.brake === 0 && Math.abs(th) < 0.1) P.v = 0;
  if (Math.abs(P.v) < 0.05 && input.throttle === 0 && Math.abs(th) < 0.05) P.v = 0;
  // steering
  const sp = Math.abs(P.v);
  const maxSteer = lerp(0.55, 0.11, clamp(sp / 16, 0, 1)) * (P.inWheelie || P.inStop ? 0.55 : 1) * (1 + 0.06 * (C.grip || 0));
  P.steer = damp(P.steer, input.steer * maxSteer, 10, dt);
  const yawRate = P.v * Math.tan(P.steer) / veh.wbLen * (veh.kind === 'scooter' ? 0.75 : 1);
  P.yaw += yawRate * dt;
  P.lean = damp(P.lean, clamp(-Math.atan(sp * yawRate / G) * 0.95, -0.75, 0.75), 6, dt); // lean angle for a balanced turn
  forward(P.yaw);
  // move
  const hv = P.v * Math.cos(th);
  const nx = P.pos.x + fwd.x * hv * dt, nz = P.pos.z + fwd.z * hv * dt;
  const ng = groundInfo(nx, nz);
  const vyPrev = P.v * Math.sin(th);
  const ballistic = P.pos.y + vyPrev * dt - 0.5 * G * dt * dt;
  if (ng.h - P.pos.y > 0.32) { // wall
    if (sp > 7) return bail('SLAMMED');
    P.v = -P.v * 0.25; sfx.land(0.3); return;
  }
  const np = v3(nx, P.pos.y, nz);
  if (collideWorld(np)) {
    if (sp > 8) { P.pos.x = np.x; P.pos.z = np.z; return bail('CRASHED'); }
    P.v *= -0.2;
  }
  P.pos.x = np.x; P.pos.z = np.z;
  if (ng.h < ballistic - 0.025 && (vyPrev > 0.6 || ng.h < P.pos.y - 0.25)) {
    // launch!
    launch(P, vyPrev, hv, gi.ramp, th);
    return;
  }
  P.pos.y = ng.h; P.vy = vyPrev;
  if (P.pos.z < SEA_Z && ng.h <= 0.01) return splash(false);
  // wheelie / manual
  if (updateWheelie(dt, P, C, sp)) return;
  // hop
  if (input.jump && !P.inWheelieLoop) {
    const boost = C.hop * (1 + clamp(P.crouch * 1.2, 0, 0.3));
    launch(P, vyPrev + boost, hv, gi.ramp, th, true);
    sfx.hop(); return;
  }
  // safe point
  P.safeT += dt;
  if (P.safeT > 0.4 && Math.abs(th) < 0.08 && !P.inWheelie && (!gi.ramp || gi.ramp.type === 'box')) {
    P.safeT = 0; P.hist.push({ pos: P.pos.clone(), yaw: P.yaw }); if (P.hist.length > 12) P.hist.shift();
    const h0 = P.hist[Math.max(0, P.hist.length - 6)]; P.safe.pos.copy(h0.pos); P.safe.yaw = h0.yaw;
  }
  // combo window
  if (combo.active && !P.inWheelie && !P.inStop) { P.landWindow -= dt; if (P.landWindow <= 0) endCombo(true); }
  // cranks & kicks
  if (veh.crank) { if (input.throttle > 0) P.crank += dt * Math.max(3.5, sp / veh.r / 2.6); else P.crank = damp(P.crank, Math.round(P.crank / Math.PI) * Math.PI, 4, dt); }
  // skid dust
  P.braking = input.brake > 0;
  P.skidding = input.brake > 0 && sp > 2.5 && !P.inWheelie && !P.inStop;
  if (P.skidding && (onRampSurf === 'dirt' || onRampSurf === 'grass') && Math.random() < 0.5) emitDust(P.pos, 1, onRampSurf, 0.4);
}

function updateWheelie(dt, P, C, sp) {
  const E = settings.easy;
  // stoppie / nose manual: Shift + brake
  if (!P.inWheelie && (P.inStop || (input.wheelie && input.brake > 0 && sp > 1.6 && P.wheelie < 0.05))) {
    if (!P.inStop) { P.inStop = true; P.stopV = 1.3; stopAcc = 0; P.wobble = 0; }
    const bal = veh.kind === 'scooter' ? 0.24 : 0.3, mx = veh.kind === 'scooter' ? 0.55 : 0.62;
    let torque;
    if (input.wheelie) {
      P.wobble += (Math.random() - 0.5) * dt * 7; P.wobble = clamp(P.wobble * Math.pow(0.5, dt), -0.5, 0.5);
      torque = 14 * (bal - P.stop) - 5 * P.stopV + P.wobble * (E ? 4 : 9) + (input.brake ? 0.8 : -2.5);
    } else torque = -10 * Math.cos(P.stop) - 3;
    P.stopV += torque * dt; P.stopV *= Math.exp(-1.5 * dt); P.stop += P.stopV * dt;
    P.v = Math.max(0, P.v - 2.2 * dt);
    if (P.stop > 0.06) stopAcc += dt;
    if (P.stop <= 0 || P.v < 0.8) { P.stop = 0; P.stopV = 0; finishStoppie(); }
    if (P.stop > mx + (E ? 0.12 : 0)) { P.stop = 0; P.stopV = 0; P.inStop = false; bail("ENDO'D OVER THE BARS"); return true; }
    return false;
  }
  const can = sp > 0.8;
  const bal = C.wb;
  let torque = 0;
  if (input.wheelie && can) {
    if (!P.inWheelie) { P.inWheelie = true; P.wheelieV = 1.6; wheelieAcc = 0; P.wobble = 0; }
    torque += 15 * (bal - P.wheelie) - 5.5 * P.wheelieV; // rider balancing toward the sweet spot
    P.wobble += (Math.random() - 0.5) * dt * (E ? 4.5 : 8) * (1 + sp * 0.04) * (1 - 0.1 * (C.grip || 0));
    P.wobble = clamp(P.wobble * Math.pow(0.5, dt), -0.5, 0.5);
    torque += P.wobble * (E ? 7 : 12);
    if (input.throttle > 0) torque += 0.8;   // pedal / throttle lifts the front
    if (input.brake > 0) torque -= 7;       // tap the rear brake to bring it down
    if (P.wheelie > bal) torque += 4 * Math.sin(P.wheelie - bal); // past balance it wants to go over
  } else {
    torque -= 10 * Math.cos(P.wheelie) + 3;
  }
  P.wheelieV += torque * dt; P.wheelieV *= Math.exp(-1.5 * dt);
  P.wheelie += P.wheelieV * dt;
  if (P.wheelie <= 0) { P.wheelie = 0; P.wheelieV = 0; if (P.inWheelie && (!input.wheelie || !can)) finishWheelie(); }
  if (P.wheelie > C.wbMax + (E ? 0.15 : 0)) { P.wheelie = 0; P.wheelieV = 0; P.inWheelie = false; bail('LOOPED OUT'); return true; }
  if (P.inWheelie && P.wheelie > 0.12) {
    const inZone = Math.abs(P.wheelie - bal) < 0.22;
    wheelieAcc += dt * (inZone ? 1 : 0.4);
  }
  return false;
}
let stopAcc = 0;
function finishWheelie() {
  const P = player; P.inWheelie = false;
  if (wheelieAcc > 0.6) {
    const name = veh.kind === 'scooter' ? 'Manual' : 'Wheelie';
    addToCombo(`${name} ${wheelieAcc.toFixed(1)}s`, Math.round(wheelieAcc * 110), 1);
    P.landWindow = 1.2;
    if (wheelieAcc >= 10) goal('wheelie10');
  }
  wheelieAcc = 0;
}
function finishStoppie() {
  const P = player; P.inStop = false;
  if (stopAcc > 0.5) {
    addToCombo(`${veh.kind === 'scooter' ? 'Nose Manual' : 'Stoppie'} ${stopAcc.toFixed(1)}s`, Math.round(stopAcc * 160), 1);
    P.landWindow = 1.2; goal('stoppie');
  }
  stopAcc = 0;
}

function launch(P, vy, hv, ramp, th, hop = false) {
  if (P.inWheelie) finishWheelie();
  if (P.inStop) { P.stop = 0; finishStoppie(); }
  P.air = true; P.airTime = 0; P.airStart.copy(P.pos); P.maxH = P.pos.y;
  forward(P.yaw);
  P.vel.set(fwd.x * hv, vy, fwd.z * hv);
  resetTricks();
  if (ramp && (ramp.type === 'qp' || ramp.type === 'bowl') && th > 0.75 && !hop) {
    const e = 0.2, rf = ramp.type === 'qp' ? v3(ramp.s, 0, ramp.c) : v3(heightAt(P.pos.x + e, P.pos.z) - heightAt(P.pos.x - e, P.pos.z), 0, heightAt(P.pos.x, P.pos.z + e) - heightAt(P.pos.x, P.pos.z - e)).normalize();
    const along = P.vel.x * rf.x + P.vel.z * rf.z;
    P.vel.x -= rf.x * (along + 0.7); P.vel.z -= rf.z * (along + 0.7);
    P.vel.y = Math.max(vy, P.v * 1.08) + 2.6;
    const f = forward(P.yaw, v3()); const fa = f.dot(rf); f.addScaledVector(rf, -2 * fa);
    P.autoLeft = wrap(Math.atan2(f.x, f.z) - P.yaw);
    if (Math.abs(Math.abs(P.autoLeft) - Math.PI) < 0.05) P.autoLeft = Math.PI * (input.steer < 0 ? -1 : 1);
    const ascend = P.vel.y / G;
    P.autoTurn = Math.abs(P.autoLeft) / Math.max(0.25, ascend * 0.9);
    P.vertAir = true;
    P.vertCam = P.pos.clone().addScaledVector(rf, -6.5).add(v3(0, -0.6, 0));
    P.vertCam.y = Math.max(P.vertCam.y, heightAt(P.vertCam.x, P.vertCam.z) + 1.4);
  } else P.vertAir = false;
  P.vy = P.vel.y; P.crouchV -= 1.5;
  P.lockW = input.throttle > 0; P.lockS = input.brake > 0;
  P.lockT = { ...input.tr };     // trick buttons held through take-off don't fire until re-pressed
  P.lockSteer = hop && input.steer !== 0 && P.fromGrind; P.fromGrind = false;
}

function trickActive(P) { return P.whipLeft > 0 || P.barLeft > 0 || Object.values(P.poses).some(a => a > 0.3) || Math.abs(P.flipRate || 0) > 1 || Math.abs(P.spinRate || 0) > 1; }
function airStep(dt, P, C) {
  const E = settings.easy;
  P.airTime += dt;
  P.vel.y -= G * dt;
  P.vel.multiplyScalar(1 - 0.004 * dt);
  if (!input.throttle) P.lockW = false; if (!input.brake) P.lockS = false;
  for (const k of TRICK_KEYS) if (!input.tr[k]) P.lockT[k] = false;
  const held = k => input.tr[k] && !P.lockT[k];
  if (!input.steer) P.lockSteer = false;
  const spinIn = P.lockSteer ? 0 : input.steer, flipIn = (input.brake && !P.lockS ? -1 : 0) + (input.throttle && !P.lockW ? 1 : 0);
  P.spinRate = damp(P.spinRate || 0, spinIn * C.spin, 14, dt);
  P.yaw += P.spinRate * dt; P.spin += P.spinRate * dt;
  if (P.vertAir && P.autoLeft) {
    const s = Math.sign(P.autoLeft) * Math.min(Math.abs(P.autoLeft), Math.abs(P.autoTurn) * dt);
    P.yaw += s; P.autoLeft -= s;
  }
  if (C.flip > 0) { P.flipRate = damp(P.flipRate || 0, flipIn * C.flip, 8, dt); P.flip += P.flipRate * dt; }
  // landing assist: once you let go, carry the rotation round to the nearest clean landing
  const reach = E ? 2.3 : 1.7;
  if (!flipIn && C.flip > 0) {
    const rem = -wrap(P.flip), dir = Math.sign(P.flip) || 1;
    if (Math.abs(P.flip) > 0.3 && Math.abs(rem) < reach && (Math.sign(rem) === dir || Math.abs(rem) < 0.8)) {
      const st = Math.sign(rem) * Math.min(Math.abs(rem), Math.max(E ? 4.5 : 3.5, Math.abs(P.flipRate)) * dt); P.flip += st; P.flipRate = 0;
    }
  }
  const hvA = Math.hypot(P.vel.x, P.vel.z);
  if (!spinIn && !P.autoLeft && hvA > 2.2) {
    const rem = -wrap(P.yaw - Math.atan2(P.vel.x, P.vel.z)), dir = Math.sign(P.spin) || 1;
    if (Math.abs(rem) > 0.001 && Math.abs(rem) < reach && (Math.sign(rem) === dir || Math.abs(rem) < 0.9)) {
      const st = Math.sign(rem) * Math.min(Math.abs(rem), Math.max(E ? 8 : 6.5, Math.abs(P.spinRate)) * dt); P.yaw += st; P.spin += st; P.spinRate = 0;
    }
  }
  // style tricks
  const tl = timeToLand(P);
  const TK = TRICKS[veh.kind];
  for (const key of TRICK_KEYS) {
    const t = TK[key]; if (!t) continue;
    if (t.t === 'whip') { if (held(key) && P.whipLeft <= 0.001) { P.whipLeft = Math.PI * 2; P.whipDir = t.d; P.whipName = t.n; P.whipKey = key; sfx.whoosh(); } }
    else if (t.t === 'bar') { if (held(key) && P.barLeft <= 0.001) { P.barLeft = Math.PI * 2; P.barKey = key; sfx.whoosh(); } }
    else {
      let target = held(key) ? 1 : 0;
      if (E && tl < 0.24) target = 0;            // easy mode: hands and feet go back on in time
      P.poses[t.p] = damp(P.poses[t.p] || 0, target, 10, dt);
      if (P.poses[t.p] > 0.8) airTricks.poseTime[t.n] = (airTricks.poseTime[t.n] || 0) + dt;
    }
  }
  const boost = E ? 1.2 : 1;
  if (P.whipLeft > 0) {
    let s = Math.min(P.whipLeft, (Math.PI * 2) / (C.whip * (P.whipName === 'Heelwhip' ? 1.15 : 1)) * boost * dt);
    if (E && tl < 0.12) s = P.whipLeft;                          // easy mode: finish it before touchdown
    P.whipLeft -= s; P.whip += s * P.whipDir;
    if (P.whipLeft <= 0) { airTricks.counts[P.whipName] = (airTricks.counts[P.whipName] || 0) + 1; if (held(P.whipKey) && tl > 0.35) { P.whipLeft = Math.PI * 2; sfx.whoosh(); } }
  }
  if (P.barLeft > 0) {
    let s = Math.min(P.barLeft, (Math.PI * 2) / C.bar * boost * dt);
    if (E && tl < 0.12) s = P.barLeft;
    P.barLeft -= s; P.bar += s;
    if (P.barLeft <= 0) { airTricks.counts.Barspin = (airTricks.counts.Barspin || 0) + 1; if (held(P.barKey) && tl > 0.3) { P.barLeft = Math.PI * 2; sfx.whoosh(); } }
  }
  // integrate
  const np = v3(P.pos.x + P.vel.x * dt, P.pos.y + P.vel.y * dt, P.pos.z + P.vel.z * dt);
  if (P.vel.y < 0.8 && tryGrind(P, np)) return;
  if (collideWorld(np)) {
    if (Math.hypot(P.vel.x, P.vel.z) > 6) { P.pos.copy(np); return bail('CRASHED'); }
    P.vel.x *= -0.2; P.vel.z *= -0.2;
  }
  const gh = heightAt(np.x, np.z);
  if (gh - np.y > 0.55 && gh - P.pos.y > 0.3) { // hit a ramp side
    if (Math.hypot(P.vel.x, P.vel.z) > 5) return bail('SLAMMED');
    P.vel.x = 0; P.vel.z = 0; np.x = P.pos.x; np.z = P.pos.z;
  }
  P.pos.copy(np);
  P.maxH = Math.max(P.maxH, P.pos.y - gh);
  P.vy = P.vel.y;
  if (P.pos.y <= gh && P.vel.y <= 0) land(P, C, gh);
}

// shared landing check (ground and rails). Returns a bail reason or null.
function landingFault(P, yawErr, flipRem, impact) {
  const E = settings.easy;
  if (P.whipLeft > (E ? 99 : 0.9)) return 'MISSED THE ' + P.whipName.toUpperCase();
  if (P.barLeft > (E ? 99 : 0.9)) return 'MISSED THE BARSPIN';
  if (Math.abs(flipRem) > (E ? 1.15 : 0.75)) return Math.abs(flipRem) > 2.2 ? 'LANDED UPSIDE DOWN' : 'UNDER-ROTATED';
  if (yawErr > (E ? 1.3 : 0.95)) return 'LANDED SIDEWAYS';
  for (const [k, a] of Object.entries(P.poses)) if (a > (E ? 0.8 : 0.5)) return k === 'nohand' || k === 'xup' ? 'NO HANDS ON LANDING' : 'FEET OFF ON LANDING';
  if (impact > (E ? 24 : 17.5)) return 'CASED IT';
  return null;
}
function finishOpenRotations(P) {
  const TWO = Math.PI * 2, nearlyDone = left => left < TWO * 0.4;
  if (P.whipLeft > 0) { if (nearlyDone(P.whipLeft)) airTricks.counts[P.whipName] = (airTricks.counts[P.whipName] || 0) + 1; P.whip += P.whipLeft * P.whipDir; P.whipLeft = 0; }
  if (P.barLeft > 0) { if (nearlyDone(P.barLeft)) airTricks.counts.Barspin = (airTricks.counts.Barspin || 0) + 1; P.bar += P.barLeft; P.barLeft = 0; }
}
function land(P, C, gh) {
  if (P.pos.z < SEA_Z && gh <= 0.01) return splash(true);
  P.pos.y = gh;
  const hv = Math.hypot(P.vel.x, P.vel.z);
  forward(P.yaw);
  const velYaw = Math.atan2(P.vel.x, P.vel.z);
  const yawErr = hv > 2.2 ? Math.abs(wrap(P.yaw - velYaw)) : 0;
  const flipRem = wrap(P.flip);
  const k = slopeAlong(P.pos.x, P.pos.z, fwd.x, fwd.z);
  const th = Math.atan(k);
  const n = v3(-fwd.x * Math.sin(th), Math.cos(th), -fwd.z * Math.sin(th));
  const impact = -(P.vel.x * n.x + P.vel.y * n.y + P.vel.z * n.z);
  P.air = false;
  P.lastLand = { yawErr: +yawErr.toFixed(2), flipRem: +flipRem.toFixed(2), spin: +P.spin.toFixed(2), hv: +hv.toFixed(1), t: +P.airTime.toFixed(2) };
  const reason = landingFault(P, yawErr, flipRem, impact);
  if (reason) { P.vel.multiplyScalar(0.6); return bail(reason); }
  finishOpenRotations(P);
  const along = P.vel.x * fwd.x + P.vel.z * fwd.z;
  P.v = Math.max(0, along * Math.cos(th) + Math.max(0, -P.vel.y) * Math.max(0, -Math.sin(th)) * 0.95);
  P.v = Math.max(0, P.v - Math.max(0, impact - 4) * 0.22);
  if (hv < 2.2 && P.vertAir) P.v = Math.max(P.v, -P.vel.y * Math.abs(Math.sin(th)) * 0.95);
  if (yawErr < 1.3 && hv > 2.2) P.yaw = P.yaw - wrap(P.yaw - velYaw) * 0.85;
  P.spinRate = 0; P.flipRate = 0; P.poses = {};
  P.crouchV -= Math.min(4, impact * 0.35);
  sfx.land(impact);
  emitDust(P.pos, Math.min(14, Math.round(impact * 1.2)), surfaceAt(P.pos.x, P.pos.z), 0.6 + impact * 0.04);
  if (impact > 9) shake = Math.min(0.5, impact * 0.02);
  scoreAir(P, C, yawErr, Math.abs(flipRem));
  P.flip = 0;
}

function scoreAir(P, C, yawErr, flipErr) {
  const parts = []; let pts = 0, mult = 0;
  const flips = Math.round(Math.abs(P.flip) / (Math.PI * 2));
  if (flips > 0) {
    const nm = (P.flip < 0 ? 'Backflip' : 'Frontflip');
    parts.push((flips === 2 ? 'Double ' : flips === 3 ? 'Triple ' : flips > 3 ? flips + 'x ' : '') + nm); pts += 650 * flips * (P.flip > 0 ? 1.3 : 1); mult += flips;
    goal(P.flip < 0 ? 'backflip' : 'frontflip');
  }
  const spin = Math.round(Math.abs(P.spin) / Math.PI) * 180;
  if (spin >= 180) { parts.push(String(spin)); pts += spin * 0.75; mult += spin / 180; if (spin >= 360) goal('360'); }
  const word = n => n === 2 ? 'Double ' : n === 3 ? 'Triple ' : n > 3 ? n + 'x ' : '';
  for (const nm of ['Tailwhip', 'Heelwhip']) {
    const w = airTricks.counts[nm] || 0; if (!w) continue;
    parts.push(word(w) + nm); pts += 320 * (1 - 0.8 ** w) / 0.2 * (nm === 'Heelwhip' ? 1.15 : 1); mult += Math.min(w, 2);
    if (w >= 2) goal('doublewhip');
  }
  const b = airTricks.counts.Barspin || 0;
  if (b > 0) { parts.push(word(b) + 'Barspin'); pts += 200 * (1 - 0.8 ** b) / 0.2; mult += Math.min(b, 2); }
  if (b > 0 && (airTricks.counts.Tailwhip || airTricks.counts.Heelwhip)) goal('whipbar');
  const TK = TRICKS[veh.kind];
  for (const key of TRICK_KEYS) {
    const t = TK[key]; if (!t || t.t !== 'pose') continue;
    const tm = airTricks.poseTime[t.n] || 0;
    if (tm > 0.12) { parts.push(t.n); pts += POSE_PTS[t.p] + tm * 300; mult += 1; }
  }
  const dist = Math.hypot(P.pos.x - P.airStart.x, P.pos.z - P.airStart.z);
  const airPts = P.airTime * 60 + P.maxH * 25;
  if (parts.length === 0) {
    if (P.vertAir || (P.airTime > 0.95 && P.maxH > 0.9)) parts.push(P.airTime > 1.6 ? 'Big Air' : 'Air');
  }
  if (P.vertAir && parts.length && parts[0] !== 'Air') parts.unshift('Vert');
  if (P.airStart.x < 168 && P.airStart.x > 150 && Math.abs(P.airStart.z - 130) < 6 && P.pos.x > 184) goal('mega');
  if (P.airStart.x > 172 && P.airStart.x < 181 && Math.abs(P.airStart.z - 262) < 3 && P.pos.x > 196) { parts.push('Bus Jump'); pts += 900; mult += 2; goal('bus'); }
  if (P.vertAir && Math.abs(P.airStart.x + 150) < 14 && Math.abs(P.airStart.z + 164) < 10) goal('bowl');
  if (parts.length === 0) return;
  if (P.airTime > 1.2) online.submit('air', +P.airTime.toFixed(2));
  pts += airPts;
  let name = parts.join(' ');
  if (dist > 12) name += ` (${Math.round(dist)}m)`;
  const perfect = yawErr < 0.25 && flipErr < 0.25 && mult > 0;
  if (perfect) pts *= 1.15;
  addToCombo(name, pts, Math.max(1, mult));
  if (perfect && mult >= 2) showPopup('PERFECT', 'good', 'CLEAN LANDING');
  player.landWindow = 1.4;
}

// ── grinds ──
function grindOffset(kind) { return kind === 'bike' ? 0.31 : kind === 'ebike' ? 0.34 : kind === 'scooter' ? 0.075 : 0.12; }
function tryGrind(P, np) {
  const E = settings.easy, off = grindOffset(veh.kind), GR = E ? 0.6 : 0.42;
  for (const r of RAILS) {
    if (Math.abs(np.x - r.cx) > r.rad || Math.abs(np.z - r.cz) > r.rad) continue;
    const t = ((np.x - r.a.x) * r.dh.x + (np.z - r.a.z) * r.dh.z) / r.hlen;
    if (t < 0.02 || t > 0.98) continue;
    const cx = r.a.x + (r.b.x - r.a.x) * t, cz = r.a.z + (r.b.z - r.a.z) * t, cy = r.a.y + (r.b.y - r.a.y) * t;
    if (Math.hypot(np.x - cx, np.z - cz) > GR) continue;
    if (!(P.pos.y + off >= cy - (E ? 0.25 : 0.1) && np.y + off <= cy + 0.06)) continue;
    const hv = Math.hypot(P.vel.x, P.vel.z), along = (P.vel.x * r.dh.x + P.vel.z * r.dh.z);
    if (hv > 1.5 && Math.abs(along) / hv < (E ? 0.45 : 0.62)) continue;
    // the air before counts as a landing
    const dir = hv > 1.5 ? Math.sign(along) || 1 : (Math.sign(Math.sin(P.yaw) * r.dh.x + Math.cos(P.yaw) * r.dh.z) || 1);
    const railYaw = Math.atan2(r.dh.x * dir, r.dh.z * dir);
    const fault = landingFault(P, Math.abs(wrap(P.yaw - railYaw)) * (hv > 1.5 ? 1 : 0), wrap(P.flip), 0);
    if (fault) { P.pos.copy(np); P.vel.multiplyScalar(0.6); bail(fault); return true; }
    finishOpenRotations(P);
    scoreAir(P, veh.cfg, 0, Math.abs(wrap(P.flip)));
    const st = GRIND_STYLES[veh.kind];
    const key = input.steer > 0.3 ? 'A' : input.steer < -0.3 ? 'D' : input.throttle && !P.lockW ? 'W' : input.brake && !P.lockS ? 'S' : 'none';
    P.grind = { r, t, dir, v: Math.max(2.5, Math.abs(along) * 0.95 + (r.d.y * dir < 0 ? 1 : 0)), time: 0, style: st[key], key, bal: 0, balV: 0 };
    P.air = false; P.flip = 0; P.poses = {}; P.spinRate = 0; P.flipRate = 0;
    P.pos.set(cx, cy - off, cz); P.yaw = railYaw;
    P.crouchV -= 1.2; sfx.land(3); shake = 0.08;
    return true;
  }
  return false;
}
function grindStep(dt, P) {
  const g = P.grind, r = g.r, E = settings.easy;
  const rise = r.d.y * g.dir;
  g.v += (-G * rise - (r.kind === 'ledge' ? 1.2 : 0.8)) * dt;
  g.time += dt;
  if (E) { g.bal = damp(g.bal, input.steer * 0.25, 4, dt); }
  else {
    g.balV += ((Math.random() - 0.5) * 7 + g.bal * 2.2 - input.steer * 5) * dt; g.balV *= Math.exp(-1.2 * dt);
    g.bal += g.balV * dt;
    if (Math.abs(g.bal) > 1) { endGrind(P, false); return bail('SLIPPED OFF THE ' + (r.kind === 'ledge' ? 'LEDGE' : 'RAIL')); }
  }
  g.t += g.dir * g.v * dt / r.len;
  const off = grindOffset(veh.kind);
  const tt = clamp(g.t, 0, 1);
  P.pos.set(r.a.x + (r.b.x - r.a.x) * tt, r.a.y + (r.b.y - r.a.y) * tt - off, r.a.z + (r.b.z - r.a.z) * tt);
  P.v = g.v; P.slope = Math.atan2(rise, Math.hypot(r.d.x, r.d.z));
  P.yaw = Math.atan2(r.dh.x * g.dir, r.dh.z * g.dir);
  if (Math.random() < 0.7) emitSparks(P.pos.clone().add(v3(0, off, 0)), r.kind === 'ledge' ? 1 : 2, r.kind);
  const hv = g.v * Math.hypot(r.d.x, r.d.z), vy = g.v * rise;
  if (g.t > 1 || g.t < 0) { endGrind(P, true); P.fromGrind = true; launch(P, vy + 1.6, hv, null, 0, true); return; }
  if (input.jump) { endGrind(P, true); P.fromGrind = true; launch(P, vy + veh.cfg.hop * 0.9, hv, null, 0, true); sfx.hop(); return; }
  if (g.v < 0.35) { endGrind(P, true); launch(P, 1.2, 0.6, null, 0, true); return; }
}
function endGrind(P, ok) {
  const g = P.grind; if (!g) return;
  P.grind = null;
  if (ok && g.time > 0.25) {
    addToCombo(`${g.style} ${g.time.toFixed(1)}s`, Math.round(140 + g.time * 190), 1);
    P.landWindow = 1.4;
    if (g.time >= 3) goal('grind3');
  }
}

// bail
const bailVis = { active: false, rv: v3(), rr: v3(), bv: v3(), br: v3() };
function bail(reason) {
  const P = player; if (P.bailed) return;
  P.lastBail = reason; root.position.copy(P.pos); root.rotation.set(0, P.yaw, 0);
  const v = P.air ? P.vel.clone() : forward(P.yaw, v3()).multiplyScalar(P.v);
  if (v.lengthSq() < 0.1 && P.vel.lengthSq() > 0.1) v.copy(P.vel);
  P.bailed = true; P.bailT = 0; P.air = false; P.inWheelie = false; P.wheelie = 0; P.inStop = false; P.stop = 0; P.grind = null; P.poses = {};
  endCombo(false); net.send({ t: 'bail' });
  showPopup('BAIL!', 'bail', reason);
  sfx.crash(); shake = 0.6;
  // detach rider into world
  scene.attach(rider.group);
  bailVis.active = true;
  bailVis.rv.copy(v).multiplyScalar(0.8).add(v3(0, 3, 0));
  bailVis.rr.set(rand(-6, 6), rand(-3, 3), rand(-6, 6));
  bailVis.bv.copy(v).multiplyScalar(0.6).add(v3(0, 2, 0));
  bailVis.br.set(rand(-8, 8), rand(-4, 4), rand(-8, 8));
  emitDust(P.pos, 14, surfaceAt(P.pos.x, P.pos.z), 1.2);
}
function updateBail(dt) {
  const P = player; P.bailT += dt;
  const tumble = (obj, vel, rot) => {
    vel.y -= G * dt; obj.position.addScaledVector(vel, dt);
    const gh = heightAt(obj.position.x, obj.position.z);
    if (obj.position.y < gh) { obj.position.y = gh; vel.y = Math.abs(vel.y) * 0.3; vel.x *= 0.6; vel.z *= 0.6; rot.multiplyScalar(0.6); }
    obj.rotation.x += rot.x * dt; obj.rotation.y += rot.y * dt; obj.rotation.z += rot.z * dt;
  };
  tumble(rider.group, bailVis.rv, bailVis.rr);
  tumble(root, bailVis.bv, bailVis.br);
  P.pos.copy(root.position);
  if (P.bailT > 2.0) respawnSafe();
}
function respawnSafe() {
  const P = player;
  veh.model.add(rider.group); rider.group.position.set(0, 0, 0); rider.group.rotation.set(0, 0, 0);
  root.rotation.set(0, 0, 0); root.visible = true;
  P.pos.copy(P.safe.pos); P.yaw = P.safe.yaw; P.v = 0; P.air = false; P.bailed = false; P.vel.set(0, 0, 0);
  P.pos.y = heightAt(P.pos.x, P.pos.z); resetTricks(); P.wheelie = 0; P.wheelieV = 0; P.stop = 0; P.grind = null;
  clearTrafficNear(P.pos);
  bailVis.active = false;
}

// ───────────────────────── visuals per frame ─────────────────────────
const tmpV = v3(), tmpQ = new THREE.Quaternion();
const L = { hip: v3(), chest: v3(), sh: [v3(), v3()], hp: [v3(), v3()], knee: [v3(), v3()], foot: [v3(), v3()], elbow: [v3(), v3()], hand: [v3(), v3()], ft: [v3(), v3()], ht: [v3(), v3()] };
let bumpT = 0;
// visual state of the local rider (also what gets sent to other players)
const VS = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flip: 0, table: 0, wheelie: 0, steer: 0, bar: 0, whip: 0, xup: 0, wheelSpd: 0, crank: 0, crouch: 0, air: false, whipping: false, barring: false, kickAmt: 0, kickPhase: 0, poses: {}, braking: false, bailed: false };
function updateVisual(dt) {
  const P = player;
  if (P.bailed) { updateBail(dt); VS.bailed = true; VS.x = root.position.x; VS.y = root.position.y; VS.z = root.position.z; return; }
  VS.bailed = false;
  let targetPitch, yOff = 0, roll = P.lean;
  if (P.grind) {
    targetPitch = -P.slope; P.chatter = 0.002;
    const st = P.grind.key;
    roll = st === 'A' ? 0.38 : st === 'D' ? -0.38 : 0;
    roll += P.grind.bal * 0.25;
  } else if (!P.air) {
    const f = forward(P.yaw, tmpV);
    const hC = P.pos.y;
    let hR = heightAt(P.pos.x + f.x * veh.contactR, P.pos.z + f.z * veh.contactR);
    let hF = heightAt(P.pos.x + f.x * veh.contactF, P.pos.z + f.z * veh.contactF);
    if (hF < hC - 0.2 && hR <= hC + 0.05) hF = 2 * hC - hR;
    if (hR < hC - 0.2 && hF <= hC + 0.05) hR = 2 * hC - hF;
    if (hF > hC + 0.34) hF = hC; if (hR > hC + 0.34) hR = hC;
    targetPitch = -Math.atan2(hF - hR, veh.wbLen);
    yOff = (hR + hF) / 2 - hC;
    const sp = Math.abs(P.v), surf = surfaceAt(P.pos.x, P.pos.z);
    const amp = (P.onRamp ? (P.onRamp.surface === 'dirt' ? 0.006 : 0.0015) : surf === 'grass' ? 0.016 : surf === 'dirt' ? 0.008 : surf === 'sidewalk' || surf === 'plaza' ? 0.003 : 0.0015) * clamp(sp / 6, 0, 1.5);
    bumpT += dt * sp * 3.3;
    yOff += (Math.sin(bumpT * 1.7) * 0.6 + Math.sin(bumpT * 3.9 + 1) * 0.4) * amp;
    P.chatter = amp;
  } else {
    const hv = Math.hypot(P.vel.x, P.vel.z); targetPitch = P.vertAir ? 0 : clamp(-Math.atan2(P.vel.y, Math.max(hv, 0.1)) * 0.5, -0.7, 0.7); P.chatter = 0;
  }
  P.visY = P.air || P.grind ? damp(P.visY || 0, 0, 10, dt) : damp(P.visY || 0, yOff, 30, dt);
  P.visPitch = P.air ? damp(P.visPitch, targetPitch, 3, dt) : damp(P.visPitch, targetPitch, 22, dt);
  P.visRoll = P.air ? damp(P.visRoll || 0, 0, 5, dt) : damp(P.visRoll || 0, roll, 14, dt);
  P.crouchV += (-P.crouch * 70 - P.crouchV * 10) * dt; P.crouch += P.crouchV * dt; P.crouch = clamp(P.crouch, -0.25, 0.3);
  if (P.air) P.airSpin = damp(P.airSpin || 0, 0, 0.6, dt); else P.airSpin = P.v;
  Object.assign(VS, {
    x: P.pos.x, y: P.pos.y + P.visY, z: P.pos.z, yaw: P.yaw, pitch: P.visPitch, roll: P.visRoll, flip: P.flip,
    table: (P.poses.tabletop || 0) * 1.15, wheelie: P.wheelie - P.stop,
    steer: -P.steer * 1.25 * (P.air || P.grind ? 0 : 1), bar: P.bar, whip: P.whip, xup: P.poses.xup || 0,
    wheelSpd: P.air ? P.airSpin : P.v, crank: P.crank, crouch: P.crouch, air: P.air, whipping: P.whipLeft > 0, barring: P.barLeft > 0,
    kickAmt: P.kickAmt || 0, kickPhase: P.kickPhase, poses: P.poses, braking: P.braking && !P.air, grinding: !!P.grind,
  });
  applyAvatar(me, VS, dt);
}
function applyAvatar(A, S, dt) {
  const V = A.veh;
  A.root.position.set(S.x, S.y, S.z); A.root.rotation.set(0, S.yaw, 0);
  A.slopeG.rotation.x = S.pitch; A.slopeG.rotation.z = S.roll;
  A.airG.rotation.x = S.flip; A.airG.rotation.z = S.table;
  const w = S.wheelie;
  if (w >= 0) { A.wheelieG.position.z = V.contactR; V.model.position.z = -V.contactR; } else { A.wheelieG.position.z = V.contactF; V.model.position.z = -V.contactF; }
  A.wheelieG.rotation.x = -w;
  V.steer.rotation.y = S.steer + S.bar + S.xup * Math.PI;
  V.whip.rotation.y = S.whip * (A.kind === 'scooter' || A.kind === 'escooter' ? 1 : -1);
  for (const wh of V.wheels) wh.obj.rotation.x += S.wheelSpd * dt / wh.r;
  if (V.crank) V.crank.rotation.x = S.crank;
  poseRider(dt, S, A);
}
// what each style trick does to the body
const POSE_FX = {
  superman(L, a, s, c) { const off = c.bike ? v3(c.side * 0.14, L.hip.y + 0.25, L.hip.z - 0.95) : v3(c.side * 0.35, L.ft[s].y + 0.45, L.ft[s].z - 0.45); L.ft[s].lerp(off, a); },
  nofooter(L, a, s, c) { L.ft[s].lerp(v3(c.side * 0.42, L.ft[s].y + 0.38, L.ft[s].z - 0.3), a); },
  kickout(L, a, s, c) { if (s === 1) L.ft[s].lerp(v3(-0.5, L.ft[s].y + 0.3, L.ft[s].z - 0.25), a); },
  nohand(L, a, s, c) { L.ht[s].lerp(v3(c.side * 0.46, L.ht[s].y + 0.36, L.ht[s].z - 0.14), a); },
  tabletop(L, a, s, c) { L.ft[s].lerp(v3(c.side * 0.16, L.hip.y - 0.32, L.hip.z + 0.15), a * 0.6); },
  cancan(L, a, s, c) { if (s === 0) L.ft[s].lerp(v3(0.34, L.hip.y - 0.28, L.hip.z + 0.18), a); },
  nacnac(L, a, s, c) { if (s === 1) L.ft[s].lerp(c.bike ? v3(-0.42, L.hip.y + 0.05, L.hip.z - 0.6) : v3(0.4, L.ft[s].y + 0.55, L.ft[s].z - 0.5), a); },
  xup() { },
  indy(L, a, s, c) { if (s === 1) L.ht[s].lerp(v3(0.09, (c.deckTop || 0.4) + 0.06, (L.ft[0].z + L.ft[1].z) / 2), a); L.ft[s].y += 0.22 * a; },
};
function poseRider(dt, S, A) {
  const R = A.rider, D = R.D, V = A.veh, kind = A.kind, sm = A.sm;
  const bike = kind === 'bike' || kind === 'ebike';
  V.model.updateMatrixWorld(true);
  const toLocal = (obj, out) => { obj.getWorldPosition(out); return V.model.worldToLocal(out); };
  const hipW = 0.1, shW = 0.19;
  sm.whipLift = damp(sm.whipLift || 0, S.whipping ? 1 : 0, S.whipping ? 30 : 12, dt);
  sm.barOff = damp(sm.barOff || 0, S.barring ? 1 : 0, S.barring ? 40 : 14, dt);
  const crouch = S.crouch + (S.air ? 0.07 : 0) + (S.braking ? 0.04 : 0) + (S.grinding ? 0.08 : 0);
  toLocal(V.grips[0], L.ht[0]); toLocal(V.grips[1], L.ht[1]);
  if (bike) { toLocal(V.pedals[0], L.ft[0]); toLocal(V.pedals[1], L.ft[1]); L.ft[0].y += 0.085; L.ft[1].y += 0.085; L.ft[0].z -= 0.03; L.ft[1].z -= 0.03; }
  else { L.ft[0].copy(V.feet[0]); L.ft[1].copy(V.feet[1]); L.ft[0].y += 0.07; L.ft[1].y += 0.07; }
  if (kind === 'bike') L.hip.set(0, 1.08 - crouch, V.contactR + 0.34);
  else if (kind === 'ebike') { L.hip.copy(V.saddle); L.hip.y -= crouch * 0.35; }
  else if (kind === 'scooter') L.hip.set(0.02, V.deckTop + 0.82 - crouch, -0.1);
  else L.hip.set(0.02, V.deckTop + 0.86 - crouch, -0.12);
  const lean = Math.max(0, S.wheelie) * 0.65 - Math.min(0, S.wheelie) * -0.5;
  if (kind === 'scooter' && S.kickAmt > 0.01 && !S.air) {
    const a = S.kickPhase * Math.PI * 2;
    const kick = v3(-0.16, Math.max(-V.deckTop + 0.075, Math.sin(a) * 0.13 + 0.03), -0.05 - Math.cos(a) * 0.3);
    L.ft[1].lerp(kick, S.kickAmt);
    L.hip.y -= 0.07 * S.kickAmt;
  }
  const c = { bike, deckTop: V.deckTop, side: 0 };
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1; c.side = side;
    if (sm.whipLift > 0.001) {
      const off = bike ? v3(side * 0.3, L.hip.y - 0.22, L.hip.z + 0.05) : L.ft[s].clone().add(v3(side * 0.1, 0.42, 0.02));
      L.ft[s].lerp(off, sm.whipLift);
    }
    if (sm.barOff > 0.01) L.ht[s].lerp(v3(side * 0.46, L.ht[s].y + 0.36, L.ht[s].z - 0.14), sm.barOff * 0.9);
    for (const k in S.poses) { const a = S.poses[k]; if (a > 0.01 && POSE_FX[k]) POSE_FX[k](L, a, s, c); }
  }
  const sup = S.poses.superman || 0;
  if (sup > 0.01 && bike) { L.hip.z -= sup * 0.3; L.hip.y += sup * 0.08; }
  if ((S.poses.tabletop || 0) > 0.01) L.hip.y -= S.poses.tabletop * 0.08;
  const handMid = tmpV.addVectors(L.ht[0], L.ht[1]).multiplyScalar(0.5);
  const lookDir = v3(0, 1, 0).lerp(handMid.clone().sub(L.hip).normalize(), kind === 'ebike' ? 0.5 : kind === 'bike' ? 0.45 : 0.3).normalize();
  lookDir.applyAxisAngle(v3(1, 0, 0), -lean * 0.8);
  if (sup > 0.01 && bike) lookDir.lerp(v3(0, 0.35, 1).normalize(), sup * 0.6).normalize();
  L.chest.copy(L.hip).addScaledVector(lookDir, D.torso);
  const sideV = v3(1, 0, 0);
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    L.hp[s].copy(L.hip).addScaledVector(sideV, side * hipW);
    L.sh[s].copy(L.chest).addScaledVector(sideV, side * shW).addScaledVector(lookDir, -0.06);
    const kp = bike ? v3(side * 0.3, 0.15, 1).normalize() : v3(side * 0.45, 0.1, 1).normalize();
    ik(L.hp[s], L.ft[s], D.thigh, D.shin, kp, L.knee[s], L.foot[s]);
    const ep = v3(side * 0.7, -0.55, -0.4).normalize();
    ik(L.sh[s], L.ht[s], D.upper, D.fore, ep, L.elbow[s], L.hand[s]);
  }
  placeBody(R, L, lookDir, bike ? [0, 0] : [V.footYaw ? V.footYaw[0] : 0, V.footYaw ? -V.footYaw[1] : 0]);
  const modelPitch = S.pitch - S.wheelie + (S.air ? S.flip : 0);
  R.parts.head.rotation.set(-modelPitch * 0.75 + 0.12, 0, 0);
}

// ───────────────────────── camera ─────────────────────────
const camState = { init: false, mode: 0, yaw: 0, pos: v3(), look: v3() };
let shake = 0, camOverride = null, camFixed = null;
// in the menu, slide the picture so the rider sits in the free space beside the panel
let viewShift = 0, viewShiftT = 0, panelRight = 0;
function menuViewOffset(dt, menu) {
  viewShiftT -= dt;
  if (menu && viewShiftT <= 0) { viewShiftT = 0.25; const p = document.querySelector('.pane:not(.hidden) .panel'); panelRight = p && innerWidth > 900 ? p.getBoundingClientRect().right : 0; }
  const want = menu && panelRight ? -(panelRight / 2) * 0.9 : 0;
  viewShift = damp(viewShift, want, 6, dt);
  if (Math.abs(viewShift) > 0.5) camera.setViewOffset(innerWidth, innerHeight, viewShift, 0, innerWidth, innerHeight);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
}
function updateCamera(dt, menu) {
  menuViewOffset(dt, menu);
  const P = player;
  if (camFixed) { camera.position.copy(camFixed.p); camera.lookAt(root.position.x, root.position.y + 0.8, root.position.z); camera.fov = camFixed.fov; camera.updateProjectionMatrix(); return; }
  if (camOverride) { camera.position.copy(root.position).add(camOverride); camera.lookAt(root.position.x, root.position.y + 0.8, root.position.z); camera.fov = 50; camera.updateProjectionMatrix(); return; }
  if (menu) {
    const t = clock * 0.12 + 0.6;
    const c = root.position;
    camera.position.set(c.x + Math.sin(t) * 5.2, c.y + 1.6 + Math.sin(t * 2.3) * 0.2, c.z + Math.cos(t) * 5.2);
    camera.lookAt(c.x, c.y + 0.75, c.z);
    camera.fov = 45; camera.updateProjectionMatrix(); return;
  }
  const hv = P.air ? Math.hypot(P.vel.x, P.vel.z) : Math.abs(P.v);
  let targetYaw = P.yaw - P.spin * (P.air ? 1 : 0);
  if (P.air && hv > 2) targetYaw = Math.atan2(P.vel.x, P.vel.z);
  if (P.air && P.vertAir) targetYaw = camState.yaw;
  if (!P.air && P.v < -0.5) targetYaw = P.yaw;
  if (!camState.init) {
    camState.yaw = targetYaw; camState.init = true;
    const f0 = forward(targetYaw, v3());
    camState.pos.copy(P.pos).addScaledVector(f0, -4.6).add(v3(0, 1.8, 0));
    camState.look.copy(P.pos).add(v3(0, 0.9, 0)).addScaledVector(f0, 1.5);
  }
  camState.yaw += wrap(targetYaw - camState.yaw) * (1 - Math.exp(-(P.air ? 2 : 5) * dt));
  const small = veh.kind === 'scooter' ? 0.85 : 1;
  const modes = [[4.2 * small, 1.55 * small], [8.5, 3.2], [0, 0]];
  const [dist, ht] = modes[camState.mode];
  const f = forward(camState.yaw, v3());
  const target = v3().copy(P.pos);
  if (camState.mode === 2) {
    // helmet cam
    rider.parts.head.getWorldPosition(target);
    const look = target.clone().add(forward(P.yaw, v3()).multiplyScalar(10)).add(v3(0, -1.2, 0));
    camera.position.copy(target).add(v3(0, 0.12, 0)); camera.lookAt(look);
    rider.parts.head.visible = false;
  } else {
    rider.parts.head.visible = true;
    let want = target.clone().addScaledVector(f, -dist).add(v3(0, ht + Math.min(2, hv * 0.03), 0));
    if (P.air && P.vertAir && P.vertCam) want = P.vertCam.clone();
    const gh = heightAt(want.x, want.z); if (want.y < gh + 0.6) want.y = gh + 0.6;
    camState.pos.lerp(want, 1 - Math.exp(-(P.air ? 6 : 9) * dt));
    camState.look.lerp(target.clone().add(v3(0, 0.9, 0)).addScaledVector(f, P.vertAir && P.air ? 0 : 1.5), 1 - Math.exp(-12 * dt));
    camera.position.copy(camState.pos);
    camera.lookAt(camState.look);
    // a little roll into turns, and road buzz through the camera at speed
    camera.rotateZ(clamp(P.lean, -0.6, 0.6) * 0.12);
    if (P.chatter) camera.position.y += (Math.random() - 0.5) * P.chatter * 1.4;
  }
  if (shake > 0) { camera.position.add(v3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.25)); shake = Math.max(0, shake - dt * 1.8); }
  const fov = 62 + clamp(hv / 18, 0, 1) * 12;
  camera.fov = damp(camera.fov, fov, 4, dt); camera.updateProjectionMatrix();
}

// ───────────────────────── rails, ledges & the plaza ─────────────────────────
const RAILS = [];
function addRail(a, b, kind = 'rail', opts = {}) {
  const r = { a: a.clone(), b: b.clone(), kind, name: opts.name || kind };
  r.d = v3().subVectors(b, a); r.len = r.d.length(); r.d.normalize();
  r.dh = v3(r.d.x, 0, r.d.z); r.hlen = Math.hypot(b.x - a.x, b.z - a.z); if (r.dh.lengthSq() > 0) r.dh.normalize();
  r.cx = (a.x + b.x) / 2; r.cz = (a.z + b.z) / 2; r.rad = r.hlen / 2 + 1.5;
  RAILS.push(r);
  if (opts.visual !== false && kind === 'rail') {
    const g = new THREE.Group(); scene.add(g);
    const top = tube(a, b, opts.r || 0.03, opts.mat || M.railMetal, g);
    const n = Math.max(2, Math.ceil(r.hlen / 3) + 1);
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, i / (n - 1)); const base = v3(p.x, heightAt(p.x, p.z), p.z);
      if (p.y - base.y > 0.08) tube(base, p, 0.025, opts.mat || M.railMetal, g);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), M.steel); foot.position.copy(base); g.add(foot);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  return r;
}
// a ledge is a box you can ride on, with grindable steel-capped edges
function ledge(x, z, len, wid, h, yaw, mat = M.granite) {
  const r = new Ramp({ x: x - Math.sin(yaw) * len / 2, z: z - Math.cos(yaw) * len / 2, yaw, width: wid, length: len, type: 'box', surface: 'concrete', profile: PROF.box(h) });
  buildRampMesh(r, mat, mat, { nu: 1, uvS: 1.5 });
  const f = v3(Math.sin(yaw), 0, Math.cos(yaw)), s = v3(Math.cos(yaw), 0, -Math.sin(yaw));
  for (const sd of [-1, 1]) {
    const a = v3(x, h, z).addScaledVector(f, -len / 2 + 0.05).addScaledVector(s, sd * (wid / 2 - 0.02));
    const b = v3(x, h, z).addScaledVector(f, len / 2 - 0.05).addScaledVector(s, sd * (wid / 2 - 0.02));
    addRail(a, b, 'ledge', { visual: false, name: 'ledge' });
    const cap = tube(a.clone().add(v3(0, -0.01, 0)), b.clone().add(v3(0, -0.01, 0)), 0.022, M.coping, scene); cap.castShadow = false;
  }
  return r;
}
// plaza: raised granite deck, a 7-stair with handrails, banks, ledges, planters, fountain
const PLAZA = { x0: 150, x1: 242, z0: 16, z1: 98 };
{
  const { x0, x1, z0, z1 } = PLAZA;
  flat(x0, x1, z0, z1, M.plazaFloor, 0.035, 3, 'plaza');
  const H = 1.12;
  // upper deck (box) with granite sides
  const deck = new Ramp({ x: 202, z: 57, yaw: Math.PI / 2, width: 46, length: 36, type: 'box', surface: 'concrete', profile: PROF.box(H) });
  buildRampMesh(deck, M.plazaFloor, M.granite, { nu: 1, uvS: 3 });
  // stair set down the west face (smooth for physics, stepped for looks)
  const stairs = new Ramp({ x: 199.0, z: 57, yaw: Math.PI / 2, width: 9, length: 3.0, type: 'stairs', surface: 'concrete', profile: u => H * clamp(u / 3.0, 0, 1) });
  {
    const g = new THREE.Group(); g.position.set(199.0, 0, 57); g.rotation.y = Math.PI / 2; scene.add(g);
    const N = 7;
    for (let i = 0; i < N; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(9, H * (i + 1) / N, 3.0 / N), M.granite); st.position.set(0, H * (i + 1) / N / 2, (i + 0.5) * 3.0 / N); st.castShadow = st.receiveShadow = true; g.add(st); }
  }
  for (const sd of [-1, 1]) addRail(v3(198.7, 0.9, 57 + sd * 3.6), v3(202.4, H + 0.9, 57 + sd * 3.6), 'rail', { name: 'handrail' });
  addRail(v3(198.7, 0.9, 57), v3(202.4, H + 0.9, 57), 'rail', { name: 'handrail' }); // centre rail
  // banks up the east and north faces
  const bankE = new Ramp({ x: 230, z: 57, yaw: -Math.PI / 2, width: 12, length: 5, type: 'kicker', surface: 'concrete', profile: PROF.kicker(5, H, 1) });
  buildRampMesh(bankE, M.plazaFloor, M.granite, { nu: 6, uvS: 3 });
  const bankN = new Ramp({ x: 212, z: 80, yaw: Math.PI, width: 10, length: 5, type: 'kicker', surface: 'concrete', profile: PROF.kicker(5, H, 1) });
  buildRampMesh(bankN, M.plazaFloor, M.granite, { nu: 6, uvS: 3 });
  // ledges on the deck and at ground level
  ledge(212, 44, 8, 0.7, H + 0.42, Math.PI / 2);
  ledge(212, 70, 8, 0.7, H + 0.42, Math.PI / 2);
  ledge(168, 34, 9, 0.6, 0.44, Math.PI / 2);
  ledge(168, 80, 9, 0.6, 0.44, Math.PI / 2);
  ledge(184, 57, 7, 1.4, 0.3, 0); // manual pad
  // flat bars
  addRail(v3(160, 0.42, 57), v3(172, 0.42, 57), 'rail', { name: 'flat bar' });
  addRail(v3(176, 0.7, 24), v3(188, 0.7, 24), 'rail', { name: 'flat bar' });
  // planters with grindable edges and trees
  for (const [px, pz] of [[158, 24], [158, 90], [190, 90], [236, 24], [236, 90]]) {
    const p = ledge(px, pz, 4, 4, 0.5, 0, M.granite);
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 3.7).rotateX(-Math.PI / 2), M.soil); soil.position.set(px, 0.51, pz); scene.add(soil);
    treeSpots.push([px, pz, 0.8, srand() * 6, 3, 0.5]);
    collide(px, pz, 0.3, 0.3);
  }
  // fountain
  {
    const fx = 178, fz = 86, R = 3.2;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.1, 0.55, 40, 1, true), M.granite); basin.position.set(fx, 0.28, fz); basin.castShadow = basin.receiveShadow = true; scene.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.12, 8, 40), M.granite); rim.rotation.x = Math.PI / 2; rim.position.set(fx, 0.56, fz); scene.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 40).rotateX(-Math.PI / 2), M.water); water.position.set(fx, 0.42, fz); scene.add(water);
    const col = cyl(0.25, 0.4, 1.6, M.granite, fx, 0.8, fz); col.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.granite); bowl.position.set(fx, 1.75, fz); scene.add(bowl);
    collide(fx, fz, R * 0.85, R * 0.85, 0.6);
    // ring around the rim is grindable
    for (let i = 0; i < 12; i++) { const a0 = i / 12 * Math.PI * 2, a1 = (i + 1) / 12 * Math.PI * 2; addRail(v3(fx + Math.cos(a0) * R, 0.62, fz + Math.sin(a0) * R), v3(fx + Math.cos(a1) * R, 0.62, fz + Math.sin(a1) * R), 'ledge', { visual: false, name: 'fountain' }); }
  }
  // lamp posts around the plaza
  for (const [lx, lz] of [[154, 20], [154, 94], [196, 20], [196, 94], [240, 40], [240, 74]]) {
    cyl(0.06, 0.09, 4.5, M.pole, lx, 2.25, lz, scene, 10);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), M.lamp); globe.position.set(lx, 4.65, lz); scene.add(globe);
    lampSpots.push(v3(lx, 4.5, lz)); collide(lx, lz, 0.15, 0.15);
  }
  for (const [bx, bz, ry] of [[164, 46, 0], [164, 68, Math.PI], [222, 30, 0]]) bench(bx, bz, ry);
}
// skatepark street section: rails and ledges
addRail(v3(88, 0.45, 52), v3(98, 0.45, 52), 'rail', { name: 'flat bar' });
addRail(v3(48.3, 1.25 + 0.42, 60), v3(53.7, 1.25 + 0.42, 60), 'rail', { name: 'funbox rail' });
ledge(34, 42, 8, 0.6, 0.45, Math.PI / 2);
ledge(34, 72, 8, 0.6, 0.45, Math.PI / 2);
// benches in the street are grindable along the front edge of the seat
for (const b of BENCHES) addRail(b.a, b.b, 'ledge', { visual: false, name: 'bench' });

// ───────────────────────── colour & life ─────────────────────────
// bunting strung across the high street
{
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0.16, 0, 0, 0, -0.36, 0], 3)); tri.computeVertexNormals();
  const cols = [0xff4d1f, 0xffc531, 0x2ad1ff, 0x3ddc84, 0xb14dff, 0xffffff, 0xe0245e];
  const spans = [];
  for (let x = -270; x < -30; x += 36) if (!CROSS.some(([a, b]) => x > a - 6 && x < b + 6)) spans.push(x);
  const per = 26, N = spans.length * per;
  const im = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), N);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(); let k = 0;
  for (const x of spans) {
    const pts = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30, z = lerp(-11.4, 11.4, t); pts.push(v3(x + Math.sin(t * 3) * 0.3, 7.6 - Math.sin(t * Math.PI) * 1.1, z)); }
    const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.008, 4), M.darkMetal); scene.add(line);
    for (let i = 0; i < per; i++) {
      const t = (i + 0.5) / per, z = lerp(-11.4, 11.4, t);
      mtx.compose(v3(x + Math.sin(t * 3) * 0.3, 7.6 - Math.sin(t * Math.PI) * 1.1, z), q.setFromAxisAngle(_up0, Math.PI / 2 + rand(-0.15, 0.15)), v3(1, 1, 1));
      im.setMatrixAt(k, mtx); im.setColorAt(k, col.setHex(cols[i % cols.length])); k++;
    }
  }
  im.castShadow = true; scene.add(im);
}
// murals on gable walls & a few billboards
function muralTex(seedN) {
  const c = makeCanvas(1024, 512), g = c.getContext('2d');
  const palettes = [['#1d2b53', '#ff004d', '#ffa300', '#29adff', '#fff1e8'], ['#0b3d2e', '#f2c14e', '#f78154', '#4d9078', '#ffffff'], ['#2d1e2f', '#ff6f59', '#43aa8b', '#ffd23f', '#ffffff'], ['#102542', '#f87060', '#cdd7d6', '#b3a394', '#ffe066']];
  const p = palettes[seedN % palettes.length];
  g.fillStyle = p[0]; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 26; i++) { g.fillStyle = p[1 + (i % 4)] + (i < 10 ? 'cc' : '88'); g.beginPath(); const x = rand(-100, 1100), y = rand(-50, 560), r = rand(40, 220); if (i % 3 === 0) g.arc(x, y, r, 0, 7); else { g.moveTo(x, y); g.lineTo(x + rand(-300, 300), y + rand(-200, 200)); g.lineTo(x + rand(-300, 300), y + rand(-200, 200)); } g.fill(); }
  for (let i = 0; i < 8; i++) { g.strokeStyle = p[1 + (i % 4)]; g.lineWidth = rand(8, 26); g.beginPath(); g.moveTo(rand(0, 1024), rand(0, 512)); g.bezierCurveTo(rand(0, 1024), rand(0, 512), rand(0, 1024), rand(0, 512), rand(0, 1024), rand(0, 512)); g.stroke(); }
  const words = ['RIDE OR DIE', 'ESSEX', 'SEND IT', 'NO LIMITS', 'STREETS', 'FREE RIDE'];
  g.font = 'italic 900 150px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 16; g.strokeStyle = '#111'; g.strokeText(words[seedN % words.length], 512, 260);
  g.fillStyle = p[4]; g.fillText(words[seedN % words.length], 512, 260);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${rand(0, .08)})`; g.fillRect(rand(0, 1024), rand(0, 512), 2, 2); }
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
{
  let m = 0;
  for (const b of BUILDINGS) {
    if (b.h < 12 || m > 9 || srand() < 0.55) continue;
    // paint the side wall facing a cross street or open plot
    const side = srand() < 0.5 ? -1 : 1;
    const w = Math.min(b.d - 2, 18), h = Math.min(b.h - 3, 10);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: muralTex(m), roughness: 0.9 }));
    pl.position.set(b.x + side * (b.w / 2 + 0.03), h / 2 + 3, b.z); pl.rotation.y = side * Math.PI / 2; pl.receiveShadow = true; scene.add(pl); m++;
  }
  // billboards facing the main road
  for (const [x, z, ry, txt] of [[-25, -40, 0, 'SEND IT — OUT NOW'], [-180, 60, Math.PI, 'RIDE SAFE · WEAR A LID'], [140, -12, 0, 'MEGA RAMP →']]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    for (const sx of [-3, 3]) cyl(0.15, 0.15, 6, M.steel, sx, 3, 0, g, 10);
    box(8.4, 3.6, 0.2, M.darkMetal, 0, 7.6, -0.1, g);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), new THREE.MeshStandardMaterial({ map: billboardTex(txt), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.05 }));
    face.position.set(0, 7.6, 0.01); g.add(face);
    lampSpots.push(v3(x, 9.5, z)); collide(x, z, 3.3, 0.3);
  }
}
function billboardTex(txt) {
  const c = makeCanvas(1024, 410), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 1024, 410); gr.addColorStop(0, '#ff4d1f'); gr.addColorStop(1, '#ffb01f'); g.fillStyle = gr; g.fillRect(0, 0, 1024, 410);
  g.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 12; i++) g.fillRect(i * 100 - 40, 0, 40, 410);
  g.font = 'italic 900 96px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(txt, 512, 205);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
// dirt area: course tape, tyre stacks and a start banner
{
  for (const z of [-62, -98]) for (let x = 24; x < 150; x += 6) { const p = cyl(0.03, 0.03, 1.0, M.white, x, 0.5, z, scene, 6); }
  for (const z of [-62, -98]) { const t = new THREE.Mesh(new THREE.PlaneGeometry(126, 0.08), M.tape); t.position.set(87, 0.92, z); scene.add(t); const t2 = t.clone(); t2.rotation.y = Math.PI; scene.add(t2); }
  for (const [x, z] of [[20, -40], [20, -56], [20, -74], [20, -90], [150, -35], [150, -110]]) for (let i = 0; i < 3; i++) { const ty = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 10, 20).rotateX(Math.PI / 2), M.slick); ty.position.set(x, 0.16 + i * 0.3, z); ty.castShadow = true; scene.add(ty); collide(x, z, 0.6, 0.6, 1.0); }
  const g = new THREE.Group(); g.position.set(22, 0, -48); scene.add(g);
  for (const sz of [-4, 4]) cyl(0.08, 0.08, 4.4, M.steel, 0, 2.2, sz, g, 8);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1.1), new THREE.MeshStandardMaterial({ map: billboardTex('DIRT LINE'), side: THREE.DoubleSide, roughness: 0.6 })); banner.position.set(0, 3.9, 0); banner.rotation.y = Math.PI / 2; g.add(banner);
  collide(22, -52, 0.2, 0.2); collide(22, -44, 0.2, 0.2);
}
// skatepark flags
for (const [x, z] of [[14, 18], [116, 18], [14, 94], [116, 94]]) {
  cyl(0.04, 0.05, 7, M.steel, x, 3.5, z, scene, 8);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 2), new THREE.MeshStandardMaterial({ map: billboardTex('SEND IT'), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(x + 0.92, 6.4, z); flag.userData.noMerge = true; scene.add(flag); FLAGS.push(flag);
}

// ───────────────────────── collectible letters S·E·N·D·I·T ─────────────────────────
const LETTERS = [];
{
  const spots = [
    ['S', v3(65, 5.0, 83.2)],                 // vert air on the big quarter pipe
    ['E', v3(DIRT_GAPS[5].x, DIRT_GAPS[5].y, -82)],   // middle of the big dirt gap
    ['N', v3(176, 9.2, 130)],                 // over the mega ramp gap
    ['D', v3(197.6, 2.4, 57)],                // down the plaza 7-stair
    ['I', v3(-90.6, 2.0, 0)],                 // street kicker in the high street
    ['T', v3(51, 3.0, 60)],                   // over the funbox
  ];
  const got = store.get('letters', []);
  for (const [ch, p] of spots) {
    const c = makeCanvas(128), g = c.getContext('2d');
    g.font = 'italic 900 110px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#fff'; g.strokeText(ch, 64, 68); g.fillStyle = '#ff4d1f'; g.fillText(ch, 64, 68);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide, emissive: 0xff6a3a, emissiveIntensity: 0.6, depthWrite: false }));
    m.position.copy(p); m.userData.noMerge = true; scene.add(m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.035, 8, 40), new THREE.MeshStandardMaterial({ color: 0xffc531, emissive: 0xffc531, emissiveIntensity: 2 })); ring.position.copy(p); ring.userData.noMerge = true; scene.add(ring);
    const L = { ch, p, m, ring, got: got.includes(ch) };
    m.visible = ring.visible = !L.got;
    LETTERS.push(L);
  }
}

// ───────────────────────── v1.3 locations ─────────────────────────
// generic 2D height-field ramp (used for the bowl)
function fieldRamp(o) {
  const r = Object.assign({ type: 'bowl', surface: 'concrete', base: 0, yaw: 0, s: 0, c: 1 }, o);
  r.x0 = o.cx - o.w / 2; r.x1 = o.cx + o.w / 2; r.z0 = o.cz - o.d / 2; r.z1 = o.cz + o.d / 2;
  r.rad = Math.hypot(o.w, o.d) / 2 + 0.5;
  r.heightAt = (x, z) => (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) ? -Infinity : o.fn(x - o.cx, z - o.cz);
  r.profile = () => 0;
  ramps.push(r); return r;
}
function fieldMesh(r, step, matDeck, matPool, sideMat, H) {
  const nx = Math.ceil(r.w / step), nz = Math.ceil(r.d / step);
  const geo = new THREE.PlaneGeometry(r.w, r.d, nx, nz).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) { const h = r.fn(pos.getX(i), pos.getZ(i)); pos.setY(i, h + 0.03); const deck = h > H - 0.01; col.push(deck ? 1 : 0.78, deck ? 1 : 0.86, deck ? 1 : 0.93); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r.w / 4, uv.getY(i) * r.d / 4);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, matPool); m.position.set(r.cx, 0, r.cz); m.receiveShadow = true; m.castShadow = true; scene.add(m);
  // outer walls
  const wall = (w, x, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, H), sideMat); p.position.set(x, H / 2, z); p.rotation.y = ry; p.castShadow = p.receiveShadow = true; scene.add(p); };
  wall(r.w, r.cx, r.z1, 0); wall(r.w, r.cx, r.z0, Math.PI); wall(r.d, r.x1, r.cz, Math.PI / 2); wall(r.d, r.x0, r.cz, -Math.PI / 2);
}
// rounded-rectangle signed distance (negative inside)
function sdRoundRect(x, z, ax, az, rc) { const qx = Math.abs(x) - ax + rc, qz = Math.abs(z) - az + rc; return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rc; }

const NEW_ZONES = {};
// ── HILL BOMB: a 36 m downhill road with tables, barriers you can grind, and a timed race ──
const HILL = { x: -286, z: 205, L: 262, W: 14, H: 36, jumps: [62, 104, 146, 190, 228] };
{
  const { L, H } = HILL, top = 14, end = L - 12;
  const base = u => u <= top ? H : u >= end ? 0 : H * (1 - smooth(clamp((u - top) / (end - top), 0, 1)));
  const prof = u => { let h = base(u); for (const j of HILL.jumps) if (u > j - 10 && u <= j) h += 2.2 * Math.pow((u - (j - 10)) / 10, 1.7); return h; };
  HILL.prof = prof;
  const r = new Ramp({ x: HILL.x, z: HILL.z, yaw: Math.PI / 2, width: HILL.W, length: L, type: 'hill', surface: 'concrete', profile: prof });
  buildRampMesh(r, M.hillRoad, M.rampSide, { nu: 300, uvS: 7 });
  rect(HILL.x - 4, HILL.x + L + 4, HILL.z - 12, HILL.z + 12, 'hill');
  // crash barriers along both sides (grindable)
  const seg = 6;
  for (const sd of [-1, 1]) for (let u = 4; u < L - 6; u += seg) {
    const a = v3(HILL.x + u, prof(u) + 0.75, HILL.z + sd * (HILL.W / 2 - 0.25)), b = v3(HILL.x + u + seg, prof(u + seg) + 0.75, HILL.z + sd * (HILL.W / 2 - 0.25));
    if (HILL.jumps.some(j => u + seg > j - 11 && u < j + 1)) continue;
    addRail(a, b, 'rail', { name: 'barrier', r: 0.045, mat: M.steel });
  }
  // start / checkpoint / finish gates
  HILL.gates = [top + 2, 90, 160, 215, L - 14];
  HILL.gates.forEach((u, i) => {
    const g = new THREE.Group(); g.position.set(HILL.x + u, prof(u), HILL.z); scene.add(g);
    for (const sd of [-1, 1]) cyl(0.12, 0.12, 5, M.steel, 0, 2.5, sd * 7.2, g, 8);
    const label = i === 0 ? 'START' : i === HILL.gates.length - 1 ? 'FINISH' : 'CHECKPOINT ' + i;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 1.3), new THREE.MeshStandardMaterial({ map: billboardTex(label), side: THREE.DoubleSide, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.1 }));
    banner.position.set(0, 4.7, 0); banner.rotation.y = -Math.PI / 2; g.add(banner);
    lampSpots.push(v3(HILL.x + u, prof(u) + 5, HILL.z));
  });
  NEW_ZONES.hill = { name: 'HILL BOMB', pos: v3(HILL.x + 6, H, HILL.z), yaw: Math.PI / 2 };
}

// ── SEAFRONT: sea, sand, promenade with railings, beach huts, a pier you can launch off, dunes and a concrete bowl ──
const SEA_Z = -262;
const seaMesh = (() => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1400, 1, 1).rotateX(-Math.PI / 2), M.sea);
  m.position.set(0, -0.35, SEA_Z - 700); m.userData.noMerge = true; scene.add(m); return m;
})();
{
  flat(-1100, 1100, SEA_Z - 2, -214, M.sand, 0.02, 6, 'sand');
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2.2).rotateX(-Math.PI / 2), M.foam); foam.position.set(0, -0.2, SEA_Z - 0.8); foam.userData.noMerge = true; scene.add(foam); FOAM.push(foam);
  flat(-300, 300, -214, -196, M.plazaFloor, 0.035, 3, 'plaza');
  // sea railings with gaps for beach steps
  for (let x = -296; x < 296; x += 24) {
    if (Math.abs(x - 40) < 14 || Math.abs(x + 100) < 6 || Math.abs(x - 160) < 6) continue;
    addRail(v3(x, 1.0, -213.6), v3(x + 20, 1.0, -213.6), 'rail', { name: 'sea rail', mat: M.white, r: 0.035 });
    collide(x + 10, -213.6, 10, 0.08, 1.1);
  }
  // beach huts
  seed = 31337;
  const hutCols = [0xe63946, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xffd166, 0x06d6a0, 0xef476f, 0x118ab2, 0xb5e48c, 0xffffff];
  for (let x = -280, i = 0; x < -30; x += 3.6, i++) {
    if (i % 9 === 8) { x += 6; continue; }
    const g = new THREE.Group(); g.position.set(x, 0.05, -193.2); scene.add(g);
    const c = hutCols[i % hutCols.length], mat = MAT_CACHE['hut' + c] || (MAT_CACHE['hut' + c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, map: T.wood }));
    box(2.8, 2.4, 2.6, mat, 0, 1.2, 0, g);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.0, 1.0, 4, 1).rotateY(Math.PI / 4).scale(1.05, 1, 0.98), M.hutRoof); roof.position.y = 2.9; roof.castShadow = true; g.add(roof);
    box(1.2, 1.9, 0.06, M.white, 0, 1.05, -1.32, g);
    box(0.1, 0.1, 0.1, M.darkMetal, 0.4, 1.05, -1.37, g);
    collide(x, -193.2, 1.45, 1.35, 3.4);
  }
  // promenade lamps, benches, kiosk
  for (let x = -280; x < 290; x += 30) { cyl(0.07, 0.1, 5, M.pole, x, 2.5, -199, scene, 10); const lg = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), M.lamp); lg.position.set(x, 5.2, -199); scene.add(lg); lampSpots.push(v3(x, 5, -199)); collide(x, -199, 0.15, 0.15); }
  for (let x = -265; x < 280; x += 60) bench(x, -210.8, Math.PI);
  { const g = new THREE.Group(); g.position.set(-10, 0.05, -200); scene.add(g); box(3.2, 2.6, 2.4, M.kiosk, 0, 1.3, 0, g); box(3.8, 0.12, 3.0, M.awning[1], 0, 2.75, -0.2, g); const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.7), new THREE.MeshStandardMaterial({ map: signTex('ICE CREAM'), roughness: 0.5 })); s.position.set(0, 3.2, -1.21); s.rotation.y = Math.PI; g.add(s); collide(-10, -200, 1.7, 1.3, 3); }
  // pier: wooden deck out over the sea with a launch ramp at the end
  const PZ0 = -204, PZ1 = -294, PH = 1.6, PW = 7;
  const entry = new Ramp({ x: 40, z: PZ0, yaw: Math.PI, width: PW, length: 6, type: 'kicker', surface: 'wood', profile: PROF.kicker(6, PH, 1) });
  buildRampMesh(entry, M.wood, M.woodSide, { nu: 6 });
  const deck = new Ramp({ x: 40, z: PZ0 - 6, yaw: Math.PI, width: PW, length: (PZ0 - 6) - PZ1, type: 'box', surface: 'wood', profile: PROF.box(PH) });
  buildRampMesh(deck, M.wood, M.woodSide, { nu: 1, uvS: 4 });
  const kick = new Ramp({ x: 40, z: PZ1 + 7, yaw: Math.PI, width: 4, length: 5, type: 'kicker', surface: 'wood', base: PH, profile: PROF.kicker(5, 1.8, 1.7) });
  buildRampMesh(kick, M.wood, M.woodSide, { nu: 12 });
  for (const sd of [-1, 1]) {
    addRail(v3(40 + sd * (PW / 2 - 0.1), PH + 1.0, PZ0 - 7), v3(40 + sd * (PW / 2 - 0.1), PH + 1.0, PZ1 + 1), 'rail', { name: 'pier rail', mat: M.white, r: 0.035 });
    for (let z = PZ0 - 10; z > PZ1; z -= 6) cyl(0.18, 0.18, 4, M.trunk, 40 + sd * (PW / 2 - 0.3), PH - 2.0, z, scene, 8);
  }
  lampSpots.push(v3(40, PH + 4, -250), v3(40, PH + 4, -285));
  for (const z of [-250, -285]) { cyl(0.06, 0.08, 4, M.pole, 38, PH + 2, z, scene, 8); const lg = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), M.lamp); lg.position.set(38, PH + 4.1, z); scene.add(lg); collide(38, z, 0.12, 0.12, PH + 4); }
  // sand dunes line on the beach
  let x = -10;
  for (const s of [{ L: 3.4, H: 1.3, gap: 3.6, down: 4.4 }, { L: 3.8, H: 1.7, gap: 4.4, down: 5 }, { L: 4.2, H: 2.1, gap: 5.2, down: 5.6 }]) {
    const t = new Ramp({ x, z: -238, yaw: Math.PI / 2, width: 4, length: s.L, type: 'kicker', surface: 'dirt', profile: PROF.kicker(s.L, s.H, 1.7) });
    buildRampMesh(t, M.sandRamp, M.sandRamp, { nu: 14, sloped: 0.6 });
    x += s.L + s.gap;
    const l = new Ramp({ x, z: -238, yaw: Math.PI / 2, width: 5, length: 1.2 + s.down, type: 'landing', surface: 'dirt', profile: PROF.landing(1.2, s.down, s.H * 0.95) });
    buildRampMesh(l, M.sandRamp, M.sandRamp, { nu: 14, sloped: 0.6 });
    x += 1.2 + s.down + 9;
  }
  // concrete bowl on a raised deck, with a bank to ride up and grindable coping
  const BX = -150, BZ = -164, BW = 28, BD = 20, BH = 2.4, AX = 10.5, AZ = 6.5, RC = 3.5;
  const Rt = BH / 0.738;
  const bowl = fieldRamp({
    cx: BX, cz: BZ, w: BW, d: BD, H: BH, fn: (lx, lz) => {
      const sd = sdRoundRect(lx, lz, AX, AZ, RC);
      if (sd >= 0) return BH;
      const t = -sd; const xx = Rt * 0.965 - t;
      return xx <= 0 ? 0 : Rt - Math.sqrt(Math.max(0, Rt * Rt - xx * xx));
    },
  });
  bowl.w = BW; bowl.d = BD; bowl.fn = (lx, lz) => bowl.heightAt(lx + BX, lz + BZ);
  fieldMesh(bowl, 0.3, M.bowlDeck, M.bowl, M.rampSide, BH);
  const coping = [];
  for (let i = 0; i <= 64; i++) {
    const a = i / 64 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const qx = Math.sign(c) * (AX - RC) + c * RC, qz = Math.sign(s) * (AZ - RC) + s * RC;
    coping.push(v3(BX + qx, BH + 0.02, BZ + qz));
  }
  const cp = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coping, true), 128, 0.06, 8, true), M.coping); cp.castShadow = true; scene.add(cp);
  for (let i = 0; i < 64; i += 2) addRail(coping[i], coping[i + 2], 'ledge', { visual: false, name: 'coping' });
  const bank = new Ramp({ x: BX, z: BZ - BD / 2 - 6, yaw: 0, width: 8, length: 6, type: 'kicker', surface: 'concrete', profile: PROF.kicker(6, BH, 1) });
  buildRampMesh(bank, M.rampTop, M.rampSide, { nu: 6 });
  rect(BX - BW / 2 - 2, BX + BW / 2 + 2, BZ - BD / 2 - 8, BZ + BD / 2 + 2, 'park');
  NEW_ZONES.beach = { name: 'SEAFRONT', pos: v3(40, 0, -199), yaw: Math.PI };
}

// ── CONSTRUCTION YARD: containers, a scaffold drop-in to jump a double-decker bus, the big pipe ──
{
  const X0 = 128, X1 = 292, Z0 = 166, Z1 = 292;
  flat(X0, X1, Z0, Z1, M.gravel, 0.03, 8, 'dirt');
  // fence with a gate on the south side
  const fence = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), g = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.2), M.fence);
    g.position.set((ax + bx) / 2, 1.1, (az + bz) / 2); g.rotation.y = -Math.atan2(bz - az, bx - ax); g.userData.noMerge = true; scene.add(g);
    for (let t = 0; t <= len; t += 3) cyl(0.04, 0.04, 2.3, M.steel, ax + (bx - ax) * t / len, 1.15, az + (bz - az) * t / len, scene, 6);
    const hw = Math.abs(bx - ax) / 2 + 0.1, hd = Math.abs(bz - az) / 2 + 0.1; collide((ax + bx) / 2, (az + bz) / 2, hw, hd, 2.3);
  };
  fence(X0, Z0, 196, Z0); fence(214, Z0, X1, Z0); fence(X0, Z1, X1, Z1); fence(X0, Z0, X0, Z1); fence(X1, Z0, X1, Z1);
  // shipping containers (ride on top, grind the edges)
  const CC = [0xb23a2a, 0x1f5f9e, 0x2f7d4a, 0xe07b1f, 0x6b6f75, 0x7a1f5c];
  function container(x, z, yaw, len, level, ci) {
    const H = 2.6, W = 2.44, base = level * H;
    const r = new Ramp({ x: x - Math.sin(yaw) * len / 2, z: z - Math.cos(yaw) * len / 2, yaw, width: W, length: len, type: 'box', surface: 'concrete', base, profile: PROF.box(H) });
    const mat = MAT_CACHE['ct' + ci] || (MAT_CACHE['ct' + ci] = new THREE.MeshStandardMaterial({ color: CC[ci % CC.length], roughness: 0.6, metalness: 0.4, normalMap: T.corrugated }));
    const g = new THREE.Mesh(new THREE.BoxGeometry(W, H, len), mat); g.position.set(x, base + H / 2, z); g.rotation.y = yaw; g.castShadow = g.receiveShadow = true; scene.add(g);
    const uv = g.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2, uv.getY(i));
    const f = v3(Math.sin(yaw), 0, Math.cos(yaw)), s = v3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (const sd of [-1, 1]) addRail(v3(x, base + H, z).addScaledVector(f, -len / 2 + 0.1).addScaledVector(s, sd * (W / 2 - 0.03)), v3(x, base + H, z).addScaledVector(f, len / 2 - 0.1).addScaledVector(s, sd * (W / 2 - 0.03)), 'ledge', { visual: false, name: 'container' });
    if (level === 0) collide(x, z, Math.abs(Math.sin(yaw)) > 0.5 ? len / 2 : W / 2, Math.abs(Math.sin(yaw)) > 0.5 ? W / 2 : len / 2, base + H);
  }
  container(150, 190, Math.PI / 2, 12.2, 0, 0); container(150, 193.2, Math.PI / 2, 12.2, 0, 1); container(150, 191.6, Math.PI / 2, 12.2, 1, 3);
  container(176, 190, Math.PI / 2, 12.2, 0, 2);
  container(150, 230, 0, 6.1, 0, 4); container(156, 230, 0, 6.1, 0, 5); container(153, 236.5, Math.PI / 2, 12.2, 0, 1);
  // plank ramps up onto the containers
  for (const [x, z, yaw, H] of [[141.5, 190, Math.PI / 2, 2.6], [184.5, 190, -Math.PI / 2, 2.6], [150, 220, 0, 2.6], [139.5, 191.6, Math.PI / 2, 5.2]]) {
    const L = H > 3 ? 11 : 6.5;
    const r = new Ramp({ x: x - Math.sin(yaw) * L, z: z - Math.cos(yaw) * L, yaw, width: 2.2, length: L, type: 'kicker', surface: 'wood', profile: PROF.kicker(L, H, 1) });
    buildRampMesh(r, M.wood, M.woodSide, { nu: 4 });
  }
  // drop-in tower → kicker → over the bus → landing
  const JZ = 262, rollX = 150;
  const roll = new Ramp({ x: rollX, z: JZ, yaw: Math.PI / 2, width: 5, length: 18, type: 'rollin', surface: 'wood', profile: PROF.rollin(3, 15, 10) });
  buildRampMesh(roll, M.wood, M.woodSide, { nu: 40 });
  for (const sd of [-1, 1]) for (let u = 0; u < 12; u += 3) cyl(0.08, 0.08, roll.profile(u), M.steel, rollX + u, roll.profile(u) / 2, JZ + sd * 2.6, scene, 6);
  const k2 = new Ramp({ x: rollX + 24, z: JZ, yaw: Math.PI / 2, width: 4, length: 5, type: 'kicker', surface: 'wood', profile: PROF.kicker(5, 2.4, 1.7) });
  buildRampMesh(k2, M.wood, M.woodSide, { nu: 14 });
  const land = new Ramp({ x: rollX + 47, z: JZ, yaw: Math.PI / 2, width: 7, length: 15, type: 'landing', surface: 'wood', profile: PROF.landing(1, 14, 3.6) });
  buildRampMesh(land, M.wood, M.woodSide, { nu: 20 });
  // the bus
  {
    const g = new THREE.Group(); g.position.set(rollX + 39.5, 0, JZ); g.rotation.y = Math.PI / 2; scene.add(g);
    box(2.5, 4.2, 10.6, M.busRed, 0, 2.35, 0, g);
    for (const y of [1.75, 3.55]) { const w = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.9, 9.6), M.glass); w.position.set(0, y, 0); g.add(w); }
    box(2.54, 0.12, 10.62, M.white, 0, 2.6, 0, g);
    for (const z of [-3.6, 3.6]) for (const sx of [-1.2, 1.2]) { const t = new THREE.Mesh(tyreGeo, M.slick); t.position.set(sx, 0.33, z); t.scale.setScalar(1.6); g.add(t); }
    const dest = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.4), new THREE.MeshStandardMaterial({ map: signTex('SEND IT  42'), emissive: 0xffcc66, emissiveIntensity: 0.4 })); dest.position.set(0, 4.15, 5.31); g.add(dest);
    collide(rollX + 39.5, JZ, 5.3, 1.3, 4.4);
  }
  // the big concrete pipe (halfpipe)
  for (const [z, yaw] of [[204, 0], [196, Math.PI]]) concreteRamp({ x: 232, z, yaw, width: 12, length: 4.2 * 0.965 + 1.5, type: 'qp', R: 4.2, profile: PROF.qp(4.2) });
  // scaffold with a grind pipe and plank deck
  for (let x = 220; x <= 260; x += 4) for (const z of [250, 254]) cyl(0.04, 0.04, 3.2, M.steel, x, 1.6, z, scene, 6);
  addRail(v3(220, 1.1, 248.8), v3(260, 1.1, 248.8), 'rail', { name: 'scaffold pipe', mat: M.steel, r: 0.03 });
  addRail(v3(220, 3.2, 250), v3(260, 3.2, 250), 'rail', { name: 'scaffold pipe', mat: M.steel, r: 0.03 });
  const plank = new Ramp({ x: 240, z: 241, yaw: 0, width: 3, length: 8, type: 'kicker', surface: 'wood', profile: PROF.kicker(8, 3.2, 1) });
  buildRampMesh(plank, M.wood, M.woodSide, { nu: 4 });
  const sdeck = new Ramp({ x: 220, z: 252, yaw: Math.PI / 2, width: 4, length: 40, type: 'box', surface: 'wood', profile: PROF.box(3.2) });
  buildRampMesh(sdeck, M.wood, M.woodSide, { nu: 1, uvS: 4 });
  // dirt pile jump, cones, site cabin, crane
  const pile = new Ramp({ x: 196, z: 226, yaw: Math.PI / 2, width: 6, length: 6, type: 'kicker', surface: 'dirt', profile: PROF.kicker(6, 2.8, 1.5) });
  buildRampMesh(pile, M.dirtRamp, M.dirtRamp, { nu: 12, sloped: 1.2 });
  const pileL = new Ramp({ x: 210, z: 226, yaw: Math.PI / 2, width: 8, length: 9, type: 'landing', surface: 'dirt', profile: PROF.landing(2, 7, 2.7) });
  buildRampMesh(pileL, M.dirtRamp, M.dirtRamp, { nu: 12, sloped: 1.2 });
  for (let i = 0; i < 18; i++) { const x = 180 + (i % 6) * 3, z = 176 + Math.floor(i / 6) * 3; const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 12), M.cone); c.position.set(x, 0.38, z); c.castShadow = true; scene.add(c); }
  { const g = new THREE.Group(); g.position.set(270, 0, 180); scene.add(g); box(6, 2.8, 2.6, M.cabin, 0, 1.45, 0, g); for (const x of [-1.8, 0, 1.8]) box(0.9, 0.7, 0.04, M.glass, x, 1.8, 1.32, g); collide(270, 180, 3.1, 1.4, 3); }
  {
    const cx = 275, cz = 275, g = new THREE.Group(); g.position.set(cx, 0, cz); scene.add(g);
    for (let y = 0; y < 34; y += 2) { for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) tube(v3(a[0], y, a[1]), v3(b[0], y + 2, b[1]), 0.04, M.crane, g); }
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tube(v3(x, 0, z), v3(x, 34, z), 0.09, M.crane, g);
    box(30, 1.2, 1.4, M.crane, -10, 34.6, 0, g); box(3, 2.2, 2.2, M.cabin, 1, 33, 0, g); box(4, 2, 2, M.concrete2, 6, 33.5, 0, g);
    lampSpots.push(v3(cx - 24, 35.5, cz)); collide(cx, cz, 1.2, 1.2);
  }
  NEW_ZONES.yard = { name: 'CONSTRUCTION YARD', pos: v3(205, 0, 170), yaw: 0 };
}
// high-street turnaround quarter pipe + extra kickers
concreteRamp({ x: -282, z: 0, yaw: -Math.PI / 2, width: 13, length: 3.4 * 0.965 + 2, type: 'qp', R: 3.4, profile: PROF.qp(3.4) }, { graffiti: true });
for (const [x, h] of [[-230, 1.1], [-205, 0.6], [-125, 1.3], [-20, 1.0]]) { const r = new Ramp({ x, z: 0, yaw: Math.PI / 2, width: 2.0, length: 2.4, type: 'kicker', surface: 'wood', profile: PROF.kicker(2.4, h, 1.3) }); buildRampMesh(r, M.wood, M.woodSide, { nu: 12 }); }
Object.assign(ZONES, NEW_ZONES);

function buildTrees() {
  for (let i = treeSpots.length - 1; i >= 0; i--) {
    const t = treeSpots[i]; if (t[5]) continue;
    if (surfaceAt(t[0], t[1]) === 'grass' && heightAt(t[0], t[1]) < 0.01 && t[1] > SEA_Z + 70) continue;
    const ci = colliders.findIndex(c => c.x0 === t[0] - 0.4 && c.z0 === t[1] - 0.4); if (ci >= 0) colliders.splice(ci, 1);
    treeSpots.splice(i, 1);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let k = 0; k < TREE_GEOS.length; k++) {
    const list = treeSpots.filter(t => t[4] === k);
    const im = new THREE.InstancedMesh(TREE_GEOS[k], M.leaf, list.length);
    list.forEach((t, i) => { q.setFromAxisAngle(_up0, t[3]); mtx.compose(v3(t[0], t[5] || 0, t[1]), q, v3(t[2], t[2] * rand(0.9, 1.1), t[2])); im.setMatrixAt(i, mtx); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  }
}
buildTrees();
function buildGrass() {

  const c = makeCanvas(128, 128), g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = rand(10, 118), h = rand(60, 124), lean = rand(-18, 18), w = rand(3, 6);
    const gr = g.createLinearGradient(0, 128, 0, 128 - h); gr.addColorStop(0, '#2f4a1c'); gr.addColorStop(1, ['#8fae5a', '#a3b866', '#7a9a48'][i % 3]);
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.quadraticCurveTo(x + lean * 0.3 + w * 0.3, 128 - h * 0.6, x + w, 128); g.fill();
  }
  const gt = new THREE.CanvasTexture(c); gt.colorSpace = THREE.SRGBColorSpace;
  const quads = [];
  for (let k = 0; k < 3; k++) { const p = new THREE.PlaneGeometry(0.7, 0.45).translate(0, 0.225, 0); p.rotateY(k * Math.PI / 3); quads.push(p); }
  const geo = mergeGeos(quads.map(q => { q.deleteAttribute('uv'); return q; }));
  // re-add UVs (merge dropped them): planes share the same uv layout
  const uvs = new Float32Array(geo.attributes.position.count * 2); const ref = new THREE.PlaneGeometry(1, 1).toNonIndexed().attributes.uv.array;
  for (let i = 0; i < uvs.length; i++) uvs[i] = ref[i % ref.length]; geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const mat = new THREE.MeshStandardMaterial({ map: gt, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = grassTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.22) * 0.5 + sin(uTime * 3.1 + wp.x * 0.9) * 0.18;
      transformed.x += sway * position.y * 0.32; transformed.z += sway * position.y * 0.16;`);
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = vec3(0.0, 1.0, 0.0);');
  };
  const N = 45000;
  const occ = new Set(); for (const cl of colliders) for (let gx = Math.floor((cl.x0 - 0.3) / 2); gx <= Math.floor((cl.x1 + 0.3) / 2); gx++) for (let gz = Math.floor((cl.z0 - 0.3) / 2); gz <= Math.floor((cl.z1 + 0.3) / 2); gz++) occ.add(gx * 1000 + gz);
  grassMesh = new THREE.InstancedMesh(geo, mat, N);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  seed = 31; let i = 0, tries = 0;
  const centers = [[-60, 40, 150], [65, 56, 75], [85, -66, 90], [165, 130, 90], [0, 60, 70], [-150, -110, 90]];
  while (i < N && tries < N * 6) {
    tries++;
    const cc = centers[Math.floor(srand() * centers.length)];
    const a = srand() * 6.283, r = Math.sqrt(srand()) * cc[2];
    const x = cc[0] + Math.cos(a) * r, z = cc[1] + Math.sin(a) * r;
    if (surfaceAt(x, z) !== 'grass' || heightAt(x, z) > 0.01) continue;
    if (occ.has(Math.floor(x / 2) * 1000 + Math.floor(z / 2))) continue;
    const s = 0.6 + srand() * 0.9;
    mtx.compose(v3(x, 0, z), q.setFromAxisAngle(_up0, srand() * 6.28), v3(s, s * (0.8 + srand() * 0.6), s)); grassMesh.setMatrixAt(i, mtx);
    col.setHSL(0.22 + srand() * 0.06, 0.35 + srand() * 0.2, 0.42 + srand() * 0.18); grassMesh.setColorAt(i, col);
    i++;
  }
  grassMesh.userData.max = i; grassMesh.count = Math.min(i, QUALITY[qualityName].grass); grassReady = true;
  grassMesh.receiveShadow = true; grassMesh.frustumCulled = false; scene.add(grassMesh);
}
buildGrass();

// ───────────────────────── traffic ─────────────────────────
const LIGHT_CYCLE = 26;
function lightFor(axis, t) { // 'green' | 'amber' | 'red' for traffic on the main road (axis x) or cross road (axis z)
  const c = t % LIGHT_CYCLE;
  if (axis === 'x') return c < 12 ? 'green' : c < 14.5 ? 'amber' : 'red';
  return c < 13 ? 'red' : c < 23.5 ? 'green' : c < 25.5 ? 'amber' : 'red';
}
const LANES = [
  { axis: 'x', dir: 1, off: -3.1, junctions: [-140, -60] },
  { axis: 'x', dir: -1, off: 3.1, junctions: [-140, -60] },
  { axis: 'z', dir: 1, off: -60 + 3.1, junctions: [0] },
  { axis: 'z', dir: -1, off: -60 - 3.1, junctions: [0] },
];
const TRAFFIC = [];
function spawnTraffic(n) {
  for (const c of TRAFFIC) scene.remove(c.g);
  TRAFFIC.length = 0;
  seed = 2024;
  for (let i = 0; i < n; i++) {
    const lane = LANES[i % LANES.length];
    const g = makeCar(M.car[Math.floor(srand() * M.car.length)]); g.userData.noMerge = true;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    const car = { g, lane, s: lane.axis === 'x' ? -270 + srand() * 540 : -180 + srand() * 360, v: 14 + srand() * 4, vmax: 15 + srand() * 6, brake: 0 };
    if (lane.axis === 'x' && car.s > -20) car.s = -280 + srand() * 250; // keep most cars in town
    TRAFFIC.push(car);
  }
}
function clearTrafficNear(p) { for (const c of TRAFFIC) { const [x, z] = carXZ(c); if (Math.hypot(x - p.x, z - p.z) < 18) c.s -= c.lane.dir * 40; } }
function carXZ(c) { return c.lane.axis === 'x' ? [c.s, c.lane.off] : [c.lane.off, c.s]; }
function updateTraffic(dt) {
  const t = clock;
  for (const k of ['red', 'amber', 'green']) M.tLight[k].emissiveIntensity = lightFor('x', t) === k ? (k === 'green' ? 2.6 : 3) : 0.05;
  const P = player;
  for (const c of TRAFFIC) {
    const L = c.lane;
    let vmax = c.vmax;
    // car in front
    for (const o of TRAFFIC) {
      if (o === c || o.lane !== L) continue;
      const gap = (o.s - c.s) * L.dir;
      if (gap > 0 && gap < 55) vmax = Math.min(vmax, Math.max(0, (gap - 8) * 0.8));
    }
    // red lights
    const light = lightFor(L.axis, t);
    if (light !== 'green') for (const j of L.junctions) {
      const stop = j - L.dir * 9.5, d = (stop - c.s) * L.dir;
      if (d > -0.5 && d < 60 && !(light === 'amber' && d < 10)) vmax = Math.min(vmax, Math.max(0, (d - 0.5) * 0.6));
    }
    // give way to the rider
    const [cx, cz] = carXZ(c);
    const rx = L.axis === 'x' ? P.pos.x : P.pos.z, lat = L.axis === 'x' ? P.pos.z - cz : P.pos.x - cx;
    const ahead = (rx - c.s) * L.dir;
    const pv = P.air ? (L.axis === 'x' ? P.vel.x : P.vel.z) : P.v * (L.axis === 'x' ? Math.sin(P.yaw) : Math.cos(P.yaw));
    const closing = c.v + Math.max(0, -pv * L.dir);
    const look = 8 + closing * closing / 10;
    if (ahead > 0 && ahead < look && Math.abs(lat) < 2.8 && P.pos.y < 2) vmax = Math.min(vmax, Math.max(0, (ahead - 6 - closing * 0.5) * 1.2));
    const dv = vmax - c.v;
    c.v += clamp(dv, -9 * dt, 3.4 * dt);
    c.brake = dv < -0.5 ? 1 : 0;
    c.s += c.v * L.dir * dt;
    const lim = L.axis === 'x' ? 276 : 182;
    if (c.s * L.dir > lim) c.s = -lim * L.dir;
    const [x, z] = carXZ(c);
    c.g.position.set(x, 0, z);
    c.g.rotation.y = L.axis === 'x' ? (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (L.dir > 0 ? 0 : Math.PI);
    c.x = x; c.z = z;
  }
}
// returns the car the rider is touching (axis-aligned box test), or null
function carHit(p) {
  for (const c of TRAFFIC) {
    if (c.x === undefined) continue;
    const hw = c.lane.axis === 'x' ? 2.35 : 1.05, hd = c.lane.axis === 'x' ? 1.05 : 2.35;
    if (Math.abs(p.x - c.x) < hw && Math.abs(p.z - c.z) < hd && p.y < 1.6) return c;
  }
  return null;
}

// ───────────────────────── pedestrians ─────────────────────────
const PEDS = [];
const SKIN = [0xf1c8a8, 0xe0ac8a, 0xc68b62, 0x9b6a45, 0x6e4a32, 0x4a3022];
const CLOTHES = [0x2b3a55, 0x7a1f2b, 0x2f5d3a, 0xc9b28a, 0x3b3b40, 0xe6e2d8, 0x5b3a6e, 0x1f6f8b, 0xb5651d, 0x222222];
function spawnPeds(n) {
  for (const p of PEDS) scene.remove(p.g);
  PEDS.length = 0;
  seed = 909;
  for (let i = 0; i < n; i++) {
    const R = buildRider({ ped: true, top: CLOTHES[Math.floor(srand() * CLOTHES.length)], pants: CLOTHES[Math.floor(srand() * CLOTHES.length)], skin: SKIN[Math.floor(srand() * SKIN.length)], hair: [0x1a1410, 0x3b2a1a, 0x8a6a3a, 0xbcbcbc, 0x111111][Math.floor(srand() * 5)], hat: srand() < 0.3 });
    const g = new THREE.Group(); g.userData.noMerge = true; g.add(R.group); scene.add(g);
    const scale = 0.93 + srand() * 0.12; g.scale.setScalar(scale);
    let ped;
    const where = i % 5;
    if (where < 3) { // high street pavements
      const side = srand() < 0.5 ? -1 : 1;
      const segs = segmentsAlongX(-WORLD + 10, -24);
      const seg = segs[Math.floor(srand() * segs.length)];
      ped = { mode: 'line', axis: 'x', lo: seg[0] + 2, hi: seg[1] - 2, lat: side * (8.6 + srand() * 1.6), s: lerp(seg[0] + 2, seg[1] - 2, srand()), dir: srand() < 0.5 ? -1 : 1 };
    } else if (where === 3) { // plaza wanderers
      ped = { mode: 'wander', x: 155 + srand() * 38, z: 20 + srand() * 74, tx: 0, tz: 0, box: [153, 195, 19, 95] };
      ped.tx = ped.x; ped.tz = ped.z;
    } else { // skatepark spectators
      const spots = [[20, 30], [20, 84], [110, 28], [110, 86], [40, 94], [90, 94]];
      const sp = spots[i % spots.length];
      ped = { mode: 'watch', x: sp[0] + rand(-3, 3), z: sp[1] + rand(-2, 2) };
    }
    Object.assign(ped, { g, R, speed: 1.05 + srand() * 0.45, phase: srand() * 6, dodge: 0, dodgeV: 0, yaw: 0, scale });
    PEDS.push(ped);
  }
}
const PL = { hip: v3(), chest: v3(), sh: [v3(), v3()], hp: [v3(), v3()], knee: [v3(), v3()], foot: [v3(), v3()], elbow: [v3(), v3()], hand: [v3(), v3()], ft: [v3(), v3()], ht: [v3(), v3()] };
// riding into someone knocks them flat; they lie there a moment, then get back up and carry on
function knockDown(p, dx, dz, speed) {
  const l = Math.hypot(dx, dz) || 1;
  p.down = { t: 0, vx: dx / l * Math.min(5, 1.2 + speed * 0.35), vz: dz / l * Math.min(5, 1.2 + speed * 0.35), dur: 3 + Math.random() * 1.5, back: Math.random() < 0.5 };
  p.yaw = Math.atan2(dx, dz) + (p.down.back ? Math.PI : 0);
  sfx.thud(); emitDust(v3(p.x, 0.3, p.z), 8, surfaceAt(p.x, p.z), 0.8);
}
function updateDownPed(p, dt) {
  const D = p.down; D.t += dt;
  const slide = Math.exp(-4 * D.t);
  p.x += D.vx * slide * dt; p.z += D.vz * slide * dt;
  const fall = 0.32, upAt = D.dur, up = 0.7;
  let a;
  if (D.t < fall) a = (D.t / fall) ** 2;                       // tipping over
  else if (D.t < upAt) a = 1 + Math.sin(D.t * 9) * 0.015 * Math.max(0, 1 - (D.t - fall) * 2); // little bounce, then still
  else a = 1 - smooth(clamp((D.t - upAt) / up, 0, 1));          // getting up
  const ang = a * Math.PI / 2 * (D.back ? -1 : 1);
  p.g.rotation.set(0, 0, 0); p.g.rotation.order = 'YXZ';
  p.g.rotation.y = p.yaw; p.g.rotation.x = ang;
  const y = heightAt(p.x, p.z) > 0.5 ? 0 : heightAt(p.x, p.z);
  p.g.position.set(p.x, y + a * 0.13, p.z);
  if (D.t > upAt + up) {
    p.down = null; p.g.rotation.x = 0;
    if (p.mode === 'line') { p.s = clamp(p.x, p.lo, p.hi); p.dodge = clamp(p.z - p.lat, -1.5, 1.5); p.dodgeV = 0; }
  }
}
function updatePeds(dt) {
  const P = player, cam = camera.position;
  for (const p of PEDS) {
    let moving = 0;
    if (p.down) { updateDownPed(p, dt); const dc = Math.hypot(cam.x - p.x, cam.z - p.z); p.g.visible = dc < 160; if (dc < 90) { p.phase += dt * 0.5; poseWalker(p, 0); } continue; }
    if (p.mode === 'line') {
      // step aside when a rider comes at them
      const px = p.s, pz = p.lat + p.dodge;
      const dx = P.pos.x - px, dz = P.pos.z - pz, d = Math.hypot(dx, dz);
      const sp = Math.abs(P.v);
      if (d < 5 && sp > 2 && sp < 6) p.dodgeV = clamp(p.dodgeV + (dz > 0 ? -1 : 1) * 9 * dt, -2.5, 2.5); // too fast and they can't get out of the way
      else p.dodgeV *= Math.exp(-3 * dt);
      p.dodge = clamp(p.dodge + p.dodgeV * dt, -1.5, 1.5); p.dodge *= Math.exp(-0.4 * dt);
      p.s += p.dir * p.speed * dt * (d < 3 ? 0.3 : 1);
      if (p.s > p.hi) { p.s = p.hi; p.dir = -1; } if (p.s < p.lo) { p.s = p.lo; p.dir = 1; }
      p.x = p.s; p.z = clamp(p.lat + p.dodge, Math.sign(p.lat) * 7.4, Math.sign(p.lat) * 10.8);
      if (Math.sign(p.lat) < 0) p.z = clamp(p.lat + p.dodge, -10.8, -7.4); else p.z = clamp(p.lat + p.dodge, 7.4, 10.8);
      p.yaw = damp(p.yaw, p.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 6, dt) + Math.atan2(p.dodgeV, 2) * 0.02;
      moving = 1;
    } else if (p.mode === 'wander') {
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.5) { p.tx = rand(p.box[0], p.box[1]); p.tz = rand(p.box[2], p.box[3]); }
      else { p.x += dx / d * p.speed * dt; p.z += dz / d * p.speed * dt; p.yaw = Math.atan2(dx, dz); moving = 1; }
      const rd = Math.hypot(P.pos.x - p.x, P.pos.z - p.z);
      if (rd < 3 && Math.abs(P.v) > 2 && Math.abs(P.v) < 6) { p.x -= (P.pos.x - p.x) / rd * 2.5 * dt; p.z -= (P.pos.z - p.z) / rd * 2.5 * dt; }
    } else {
      p.yaw = Math.atan2(P.pos.x - p.x, P.pos.z - p.z);
    }
    const y = heightAt(p.x, p.z) > 0.5 ? 0 : heightAt(p.x, p.z);
    p.g.position.set(p.x, y, p.z); p.g.rotation.y = p.yaw;
    // only animate the ones you can see
    const dcam = Math.hypot(cam.x - p.x, cam.z - p.z);
    p.g.visible = dcam < 160;
    if (dcam > 90) continue;
    p.phase += dt * (moving ? p.speed * 5.2 : 1.2);
    poseWalker(p, moving);
  }
}
function poseWalker(p, moving) {
  const R = p.R, pr = R.parts, D = R.D, L = PL, ph = p.phase;
  const sw = moving ? Math.sin(ph) : 0, bob = moving ? Math.abs(Math.cos(ph)) * 0.035 : Math.sin(ph) * 0.006;
  L.hip.set(0, 0.93 + bob, 0);
  const look = v3(0, 1, moving ? 0.05 : 0.01).normalize();
  L.chest.copy(L.hip).addScaledVector(look, D.torso);
  for (let s = 0; s < 2; s++) {
    const side = s ? 1 : -1, ps = s ? -sw : sw;
    L.hp[s].set(side * 0.1, L.hip.y, 0);
    L.ft[s].set(side * 0.11, 0.075 + (moving ? Math.max(0, Math.cos(ph + (s ? Math.PI : 0))) * 0.09 : 0), ps * 0.3);
    L.sh[s].copy(L.chest).add(v3(side * 0.19, -0.05, 0));
    L.ht[s].copy(L.sh[s]).add(v3(side * 0.06, -0.56, -ps * 0.22 + (p.mode === 'watch' ? 0.05 : 0)));
    ik(L.hp[s], L.ft[s], D.thigh, D.shin, v3(0, 0, 1), L.knee[s], L.foot[s]);
    ik(L.sh[s], L.ht[s], D.upper, D.fore, v3(side * 0.2, 0, -1).normalize(), L.elbow[s], L.hand[s]);
  }
  placeBody(R, L, look);
  pr.head.rotation.set(0.05, 0, 0);
}

// ───────────────────────── time of day & night lighting ─────────────────────────
const NIGHT_LIGHTS = [];
for (let i = 0; i < 10; i++) { const l = new THREE.PointLight(0xffc98a, 0, 26, 1.6); scene.add(l); NIGHT_LIGHTS.push(l); }
const FLOOD_LIGHTS = FLOODS.map(p => { const l = new THREE.SpotLight(0xf2f6ff, 0, 90, 0.75, 0.5, 1.2); l.position.copy(p); l.target.position.set(65, 0, 56); scene.add(l, l.target); return l; });
const headLight = new THREE.SpotLight(0xf4f8ff, 0, 40, 0.45, 0.45, 1.4);
headLight.position.set(0, 1.0, 0.4); headLight.target.position.set(0, 0, 9); root.add(headLight, headLight.target);
const stars = (() => {
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random() * 0.98 + 0.02); pos[i * 3] = Math.cos(a) * Math.cos(e) * 1800; pos[i * 3 + 1] = Math.sin(e) * 1800; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 1800; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  p.visible = false; scene.add(p); return p;
})();
const moon = new THREE.Mesh(new THREE.SphereGeometry(28, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false }));
moon.visible = false; scene.add(moon);
const TOD = {
  day: { el: 48, az: 200, sun: 0xfff2e0, si: 4.2, hs: 0xb9d0f2, hg: 0x6a5b48, hi: 1.0, exp: 0.82, fog: 0xc8d4de, fd: 0.0009, tur: 2.6, ray: 1.1, mie: 0.004, mieG: 0.8, win: 0.12, lamp: 0.5, night: 0, env: 0.75, cloud: 0.42 },
  sunset: { el: 6.5, az: 238, sun: 0xffa868, si: 3.8, hs: 0x93a2c8, hg: 0x5a4535, hi: 0.72, exp: 0.95, fog: 0xd9b59c, fd: 0.0012, tur: 6.5, ray: 2.6, mie: 0.009, mieG: 0.92, win: 0.75, lamp: 3.0, night: 0, env: 0.55, cloud: 0.5 },
  night: { el: -14, az: 238, sun: 0x9db4ff, si: 0.55, hs: 0x22304e, hg: 0x0c0c12, hi: 0.45, exp: 1.05, fog: 0x0e1424, fd: 0.0016, tur: 2, ray: 0.6, mie: 0.002, mieG: 0.8, win: 1.7, lamp: 7, night: 1, env: 0.22, cloud: 0.25 },
};
let todName = store.get('tod', 'sunset');
const sunWorldDir = v3();
function applyTimeOfDay(name) {
  todName = name; store.set('tod', name);
  const T0 = TOD[name];
  const skySun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - T0.el), THREE.MathUtils.degToRad(T0.az));
  su.sunPosition.value.copy(skySun); su.turbidity.value = T0.tur; su.rayleigh.value = T0.ray; su.mieCoefficient.value = T0.mie; su.mieDirectionalG.value = T0.mieG;
  if (su.cloudCoverage) su.cloudCoverage.value = T0.cloud;
  // the light that casts shadows is the sun, or the moon at night
  if (name === 'night') sunWorldDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(120));
  else sunWorldDir.copy(skySun);
  sunDir.copy(sunWorldDir);
  sun.color.setHex(T0.sun); sun.intensity = T0.si;
  hemi.color.setHex(T0.hs); hemi.groundColor.setHex(T0.hg); hemi.intensity = T0.hi;
  renderer.toneMappingExposure = T0.exp;
  scene.fog.color.setHex(T0.fog); scene.fog.density = T0.fd;
  for (const f of FACADES) f.emissiveIntensity = T0.win;
  for (const m of SHOP_MATS) m.emissiveIntensity = 0.3 + T0.win * 0.6;
  M.lamp.emissiveIntensity = T0.lamp;
  M.carLight.emissiveIntensity = name === 'night' ? 4 : name === 'sunset' ? 1.2 : 0.25;
  M.taillight.emissiveIntensity = name === 'night' ? 4 : 3;
  stars.visible = moon.visible = name === 'night';
  moon.position.copy(sunWorldDir).multiplyScalar(1500);
  buildEnv(name === 'night' ? 0x0a0a0e : 0x4a463e, name === 'night' ? 0x0c0d12 : 0x2c2f35);
  scene.environmentIntensity = T0.env;
  nightAmt = T0.night;
  // lights only exist at night, so daytime shaders stay cheap
  for (const l of FLOOD_LIGHTS) { l.intensity = nightAmt * 900; l.visible = nightAmt > 0; }
  for (const l of NIGHT_LIGHTS) l.visible = nightAmt > 0;
  headLight.intensity = nightAmt > 0.5 ? 180 : 0; headLight.visible = nightAmt > 0.5;
}
let nightAmt = 0, nightT = 0;
function updateNightLights(dt) {
  if (nightAmt <= 0) { for (const l of NIGHT_LIGHTS) l.intensity = 0; return; }
  nightT -= dt; if (nightT > 0) return; nightT = 0.35;
  const p = player.pos;
  const near = lampSpots.map(s => [s, (s.x - p.x) ** 2 + (s.z - p.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, NIGHT_LIGHTS.length);
  NIGHT_LIGHTS.forEach((l, i) => { if (near[i]) { l.position.copy(near[i][0]).add(v3(0, -0.4, 0)); l.intensity = 70 * nightAmt; } else l.intensity = 0; });
}

// ───────────────────────── goals, letters, feed ─────────────────────────
const GOALS = [
  ['backflip', 'Land a backflip'], ['frontflip', 'Land a frontflip'], ['360', 'Land a 360'], ['doublewhip', 'Land a double whip'],
  ['whipbar', 'Tailwhip + barspin in one air'], ['grind3', 'Grind for 3 seconds'], ['wheelie10', 'Hold a 10 second wheelie'], ['stoppie', 'Stoppie or nose manual (Shift + S)'],
  ['mega', 'Clear the mega ramp gap'], ['plaza7', 'Air the plaza 7-stair'], ['combo5k', 'Bank a 5,000 point combo'], ['mult8', 'Hit a ×8 multiplier'],
  ['letters', 'Collect S-E-N-D-I-T'], ['ride2k', 'Ride 2 km'],
  ['hill', 'Finish the Hill Bomb'], ['pier', 'Send it off the pier'], ['bus', 'Jump the bus'], ['bowl', 'Vert air in the bowl'], ['attack20k', 'Score 20,000 in Trick Attack'],
];
const goalsDone = new Set(store.get('goals', []));
let goalTimer = 0;
function goal(id) {
  if (goalsDone.has(id)) return;
  goalsDone.add(id); store.set('goals', [...goalsDone]); earn(300, 'goal bonus');
  const g = GOALS.find(x => x[0] === id); if (!g) return;
  const el = document.getElementById('goal-toast'); el.innerHTML = `GOAL COMPLETE<span>${g[1]}</span>`; el.className = 'show'; goalTimer = 2.6;
  sfx.ding(); addFeed(`<b>Goal:</b> ${g[1]}`);
  renderGoals();
}
function renderGoals() {
  document.getElementById('goal-count').textContent = `${goalsDone.size}/${GOALS.length}`;
  document.getElementById('goals-panel').innerHTML = GOALS.map(([id, t]) => `<div class="${goalsDone.has(id) ? 'done' : ''}"><i>${goalsDone.has(id) ? '✓' : ''}</i>${t}</div>`).join('');
}
function renderLetters() { document.querySelectorAll('#letters i').forEach((el, i) => el.classList.toggle('got', LETTERS[i] && LETTERS[i].got)); }
function updateLetters(dt) {
  const P = player, me3 = v3(P.pos.x, P.pos.y + 0.9, P.pos.z);
  for (const Lt of LETTERS) {
    if (Lt.got) continue;
    Lt.m.quaternion.copy(camera.quaternion); Lt.ring.quaternion.copy(camera.quaternion); Lt.ring.rotateZ(clock * 2);
    Lt.m.position.y = Lt.p.y + Math.sin(clock * 2 + Lt.p.x) * 0.12;
    if (!P.bailed && me3.distanceTo(Lt.p) < 1.5) {
      Lt.got = true; Lt.m.visible = Lt.ring.visible = false;
      store.set('letters', LETTERS.filter(l => l.got).map(l => l.ch));
      showPopup('LETTER ' + Lt.ch, 'good', `${LETTERS.filter(l => l.got).length} / 6`); sfx.ding(); renderLetters(); earn(150);
      if (LETTERS.every(l => l.got)) goal('letters');
    }
  }
}
const elFeed = document.getElementById('feed');
function addFeed(html) {
  const d = document.createElement('div'); d.innerHTML = html; elFeed.appendChild(d);
  while (elFeed.children.length > 5) elFeed.firstChild.remove();
  setTimeout(() => d.remove(), 7000);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ───────────────────────── multiplayer (peer-to-peer rooms) ─────────────────────────
const net = (() => {
  const HAS = typeof window.Peer === 'function';
  let peer = null, isHost = false, code = null, myId = null, sendT = 0, joinTimer = null, listed = false, priv = false, roomName = '', myTicket = null, beatT = null;
  const conns = new Map();
  const remotes = new Map();
  const elStatus = document.getElementById('mp-status'), elRoom = document.getElementById('room-box'), elCode = document.getElementById('room-code'), elList = document.getElementById('room-list');
  const status = h => { elStatus.innerHTML = h; };
  const guest = store.get('guestName', null) || (() => { const g = 'Guest' + Math.floor(1000 + Math.random() * 9000); store.set('guestName', g); return g; })();
  const myName = () => (online.me ? online.me.username : guest).slice(0, 16);
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];
  function opts() {
    const q = new URLSearchParams(location.search), o = { debug: 0, config: { iceServers: ICE } };
    if (q.get('peerHost')) Object.assign(o, { host: q.get('peerHost'), port: +q.get('peerPort') || 9000, path: q.get('peerPath') || '/', secure: false, config: { iceServers: [] } });
    return o;
  }
  const roomId = c => 'sendit-room-' + c.toLowerCase();
  function hello(withTicket) { const h = { t: 'hi', name: myName(), kind: player.kind, color: paintColor, helmet: outfit(outfitId).helmet, paint: paintId, outfit: outfitId, av: AV, acct: !!online.me }; if (withTicket && myTicket) h.ticket = myTicket; return h; }
  function setUi(connected) {
    for (const id of ['mp-join', 'mp-code']) document.getElementById(id).classList.toggle('hidden', connected);
    document.querySelector('.host-box').classList.toggle('hidden', connected);
    document.getElementById('mp-leave').classList.toggle('hidden', !connected);
    elRoom.classList.toggle('hidden', !connected);
    renderLine();
  }
  function renderLine() {
    const el = document.getElementById('room-line'); if (!el) return;
    const on = !!peer && (isHost || conns.size > 0);
    el.classList.toggle('hidden', !on);
    if (on) el.innerHTML = `<div class="grow">${isHost ? 'Hosting' : 'On'} <b>${esc(roomName || 'server')}</b> · code <b>${code}</b> · ${remotes.size + 1} rider${remotes.size ? 's' : ''}${priv ? ' · friends only' : ''}</div><button class="act ghost" data-copy="1">COPY INVITE LINK</button>`;
    const st2 = document.getElementById('srv-invite'); if (st2) st2.classList.toggle('hidden', !on);
  }
  async function roomBeat() {
    clearTimeout(beatT); if (!isHost || !listed || !online.me) return;
    try { await online.rpc('si_room_beat', { p_token: online.token, p_code: code, p_players: remotes.size + 1, p_zone: player.zone === 'auto' ? zoneFor() : player.zone }); } catch { }
    beatT = setTimeout(roomBeat, 15000);
  }
  function host(name, isPrivate) {
    if (!HAS) return status('Multiplayer needs the desktop app (or a normal browser tab).');
    if (isPrivate && !online.me) { status('Sign in to host a friends-only server.'); openAuth('in'); return; }
    leave(true);
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    roomName = (name || `${myName()}'s server`).slice(0, 28); priv = !!isPrivate; listed = false;
    status('Starting your server…');
    isHost = true;
    peer = new window.Peer(roomId(code), opts());
    peer.on('open', async id => {
      myId = id; elCode.textContent = code; setUi(true); renderRoom();
      if (online.me) {
        try { await online.rpc('si_room_open', { p_token: online.token, p_code: code, p_name: roomName, p_private: priv, p_zone: player.zone === 'auto' ? zoneFor() : player.zone, p_max: 8 }); listed = true; roomBeat(); online.beat(); }
        catch (e) { status('Your server is running, but it could not be listed: ' + online.nice(e)); }
      }
      status(priv ? `Friends-only server <b>${code}</b> is up. Only your friends can see it and join.` : listed ? `<b>${esc(roomName)}</b> is in the server list. Code <b>${code}</b>` : `Server code <b>${code}</b>. Sign in to put it in the server list.`);
      addFeed(`Hosting <b>${esc(roomName)}</b> (${code})`); refreshServers();
    });
    peer.on('connection', c => setup(c));
    peer.on('error', e => { if (e.type === 'unavailable-id') { host(); return; } status('Could not create the room (' + e.type + '). Check your internet and try again.'); });
    peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
  }
  function join(c, ticket) {
    if (!HAS) return status('Multiplayer needs the desktop app (or a normal browser tab).');
    c = (c || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,5}$/.test(c)) return status('Type the server code first.');
    leave(true);
    code = c; isHost = false; myTicket = ticket || null; roomName = ''; status(`Joining <b>${code}</b>…`);
    peer = new window.Peer(undefined, opts());
    peer.on('open', id => {
      myId = id;
      const conn = peer.connect(roomId(code), { reliable: true });
      setup(conn, 'host');
      clearTimeout(joinTimer);
      joinTimer = setTimeout(() => { if (!conns.size) { status(`Couldn't reach server <b>${code}</b>. Check the code, and that the host still has the game open.`); leave(true); } }, 12000);
    });
    peer.on('error', e => status(e.type === 'peer-unavailable' ? `No server with code <b>${code}</b>. It may have closed.` : 'Connection problem (' + e.type + ').'));
  }
  const others = r => ({ t: 'hi', id: r.id, name: r.name, kind: r.kind, color: r.color, helmet: r.helmet, paint: r.paint, outfit: r.outfit, av: r.av });
  function setup(conn, as) {
    conn.on('open', () => {
      clearTimeout(joinTimer);
      if (isHost) { conn.ok = false; conns.set(conn.peer, conn); return; } // wait for their hello (and ticket) before letting them in
      conns.set(as || conn.peer, conn); conn.ok = true;
      conn.send(hello(true));
      status(`Joining <b>${code}</b>…`);
    });
    conn.on('data', m => onMsg(m, conn));
    conn.on('close', () => { conns.delete(as || conn.peer); if (isHost) { if (conn.ok) { drop(conn.peer); broadcast({ t: 'bye', id: conn.peer }); roomBeat(); } } else if (peer && !kicked) { addFeed('The server closed'); for (const id of [...remotes.keys()]) drop(id); setUi(false); status('The host closed the server.'); peer && peer.destroy(); peer = null; online.beat(); } });
    conn.on('error', () => { });
  }
  let kicked = false;
  async function admit(conn, m) {
    // private servers check a join ticket with the game server, so only the host's friends get in
    let name = m.name, verified = false;
    if (m.ticket && listed && online.me) {
      try { const r = await online.rpc('si_check_ticket', { p_token: online.token, p_code: code, p_ticket: m.ticket }); if (r.ok) { verified = true; name = r.username; } }
      catch { }
    }
    if (priv && !verified) { try { conn.send({ t: 'kick', why: 'This server is friends only.' }); } catch { } setTimeout(() => conn.close(), 400); return; }
    if (!verified) name = String(name || 'Guest').replace(/[^\w ]/g, '').slice(0, 16) + (m.acct ? '' : '');
    if (remotes.size >= 7) { try { conn.send({ t: 'kick', why: 'This server is full.' }); } catch { } setTimeout(() => conn.close(), 400); return; }
    conn.ok = true; m.name = name; m.verified = verified;
    conn.send({ t: 'welcome', name: roomName, code, priv });
    conn.send(hello());
    for (const r of remotes.values()) conn.send(others(r));
    m.id = conn.peer; broadcast(m, conn);
    addRemote(conn.peer, m); renderRoom(); renderLine(); roomBeat();
  }
  function broadcast(m, except) { for (const [k, c] of conns) if (c !== except && c.open && c.ok !== false) c.send(m); }
  function send(m) { if (!peer || !conns.size) return; m.id = myId; broadcast(m); }
  function onMsg(m, conn) {
    if (!m || typeof m !== 'object') return;
    if (isHost && !conn.ok) { if (m.t === 'hi' && !conn.admitting) { conn.admitting = true; admit(conn, m); } return; }
    if (!isHost && m.t === 'kick') { kicked = true; status(m.why || 'The host did not let you in.'); addFeed(esc(m.why || 'Not allowed in')); leave(true); kicked = false; status(m.why || 'The host did not let you in.'); return; }
    if (!isHost && m.t === 'welcome') { roomName = m.name; priv = m.priv; elCode.textContent = code; setUi(true); status(`On <b>${esc(roomName)}</b> (${code})`); addFeed(`Joined <b>${esc(roomName)}</b>`); online.beat(); return; }
    if (isHost) { m.id = conn.peer; if (m.t === 'hi') { const r = remotes.get(conn.peer); if (r) m.name = r.name; } broadcast(m, conn); }
    const id = m.id || conn.peer;
    if (id === myId) return;
    if (m.t === 'hi') addRemote(id, m);
    else if (m.t === 's') { const r = remotes.get(id); if (r) { r.buf.push({ t: performance.now(), s: m.s }); if (r.buf.length > 12) r.buf.shift(); r.score = m.s.sc || 0; } }
    else if (m.t === 'trick') { const r = remotes.get(id); if (r) addFeed(`<b>${esc(r.name)}</b> ${esc(m.name)} <b>+${(+m.pts).toLocaleString()}</b>`); }
    else if (m.t === 'chat') { const r = remotes.get(id); addFeed(`<b>${esc(r ? r.name : '?')}:</b> ${esc(m.text)}`); }
    else if (m.t === 'bail') { const r = remotes.get(id); if (r) r.bailT = 2.0; }
    else if (m.t === 'bye') drop(id);
    renderRoom();
  }
  function nameTag(name, col) {
    const c = makeCanvas(256, 64), g = c.getContext('2d');
    g.fillStyle = 'rgba(10,12,18,.6)'; g.beginPath(); g.roundRect(8, 10, 240, 44, 14); g.fill();
    g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.fillRect(20, 26, 12, 12);
    g.font = '600 26px Inter, Arial, sans-serif'; g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(name, 42, 33);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(2.2, 0.55, 1); s.renderOrder = 10; return s;
  }
  function addRemote(id, m) {
    let r = remotes.get(id);
    const helmet = m.helmet ?? COLORS[m.color % COLORS.length];
    if (!r) {
      const A = makeAvatar(riderOpts(m.outfit || 'classic', m.av));
      r = { id, A, buf: [], name: m.name, kind: null, color: m.color, helmet, score: 0, bailT: 0, outfit: m.outfit || 'classic', avKey: JSON.stringify(m.av || {}) };
      r.tag = nameTag(m.name, helmet); A.root.add(r.tag); r.tag.position.y = 2.35;
      remotes.set(id, r);
      addFeed(`<b>${esc(m.name)}</b> joined`);
    }
    if (r.name !== m.name && r.tag) { r.A.root.remove(r.tag); r.tag = nameTag(m.name, helmet); r.A.root.add(r.tag); r.tag.position.y = 2.35; }
    r.name = m.name; r.av = m.av; r.helmet = helmet;
    const avKey = JSON.stringify(m.av || {});
    if (r.outfit !== m.outfit || r.avKey !== avKey) { r.outfit = m.outfit; r.avKey = avKey; applyOutfitTo(r.A, m.outfit || 'classic', m.av); }
    if (r.kind !== m.kind || r.color !== m.color || r.paint !== m.paint) { r.kind = m.kind; r.color = m.color; r.paint = m.paint; setAvatarVehicle(r.A, m.kind, m.color); applyPaint(r.A.veh.paint, m.paint || 'gloss', COLORS[m.color % COLORS.length]); }
  }
  function drop(id) {
    const r = remotes.get(id); if (!r) return;
    scene.remove(r.A.root); remotes.delete(id); addFeed(`<b>${esc(r.name)}</b> left`); renderRoom(); renderLine();
  }
  function renderRoom() {
    const rows = [[myName() + ' (you)', score], ...[...remotes.values()].map(r => [r.name, r.score])].sort((a, b) => b[1] - a[1]);
    elList.innerHTML = rows.map(([n, s]) => `<div><span>${esc(n)}</span><span>${(s || 0).toLocaleString()}</span></div>`).join('');
  }
  const LERP = ['x', 'y', 'z', 'pitch', 'roll', 'flip', 'table', 'wheelie', 'steer', 'bar', 'whip', 'xup', 'wheelSpd', 'crank', 'crouch', 'kickAmt'];
  const ANG = ['yaw'];
  function pack() {
    const s = {}; for (const k of LERP) s[k] = +VS[k].toFixed(3); s.yaw = +VS.yaw.toFixed(3); s.kickPhase = +VS.kickPhase.toFixed(3);
    s.air = VS.air ? 1 : 0; s.wh = VS.whipping ? 1 : 0; s.br = VS.barring ? 1 : 0; s.bk = VS.braking ? 1 : 0; s.gr = VS.grinding ? 1 : 0; s.bl = VS.bailed ? 1 : 0;
    const p = {}; for (const k in VS.poses) if (VS.poses[k] > 0.02) p[k] = +VS.poses[k].toFixed(2); s.p = p; s.sc = score; return s;
  }
  function update(dt) {
    if (!peer || !conns.size && !isHost) return;
    sendT -= dt;
    if (sendT <= 0 && conns.size) { sendT = 1 / 15; send({ t: 's', s: pack() }); }
    const now = performance.now() - 110;
    for (const r of remotes.values()) {
      if (!r.A.veh || r.buf.length === 0) continue;
      let a = r.buf[0], b = r.buf[r.buf.length - 1];
      for (let i = 0; i < r.buf.length - 1; i++) if (r.buf[i].t <= now && r.buf[i + 1].t >= now) { a = r.buf[i]; b = r.buf[i + 1]; break; }
      const f = b.t > a.t ? clamp((now - a.t) / (b.t - a.t), 0, 1) : 1;
      const S = r.S || (r.S = { poses: {} });
      for (const k of LERP) S[k] = lerp(a.s[k] ?? 0, b.s[k] ?? 0, f);
      S.yaw = a.s.yaw + wrap(b.s.yaw - a.s.yaw) * f;
      S.kickPhase = b.s.kickPhase; S.air = !!b.s.air; S.whipping = !!b.s.wh; S.barring = !!b.s.br; S.braking = !!b.s.bk; S.grinding = !!b.s.gr;
      S.poses = b.s.p || {};
      // whip and bar angles wrap, so don't interpolate across a reset
      if (Math.abs(b.s.whip - a.s.whip) > 3) S.whip = b.s.whip; if (Math.abs(b.s.bar - a.s.bar) > 3) S.bar = b.s.bar;
      applyAvatar(r.A, S, dt);
      if (b.s.bl) { r.A.root.rotation.z = damp(r.A.root.rotation.z, 1.35, 6, dt); } else r.A.root.rotation.z = 0;
    }
  }
  function leave(silent) {
    clearTimeout(joinTimer); clearTimeout(beatT);
    if (isHost && listed && online.me) online.rpc('si_room_close', { p_token: online.token, p_code: code }).catch(() => { });
    if (peer) { try { send({ t: 'bye' }); } catch { } try { peer.destroy(); } catch { } }
    peer = null; conns.clear(); for (const id of [...remotes.keys()]) { const r = remotes.get(id); scene.remove(r.A.root); remotes.delete(id); }
    const was = code; isHost = false; listed = false; code = null; myTicket = null; setUi(false); if (!silent && was) { status('Left the server.'); online.beat(); }
  }
  addEventListener('beforeunload', () => leave(true));
  return {
    HAS, host, join, leave, send, update, remotes, renderLine,
    get connected() { return !!peer && (isHost || conns.size > 0); },
    get code() { return peer && (isHost || conns.size > 0) ? code : null; },
    announce() { send(hello()); },
    trick(name, pts) { send({ t: 'trick', name, pts }); },
    chat(text) { send({ t: 'chat', text }); addFeed(`<b>You:</b> ${esc(text)}`); },
    renderRoom,
  };
})();

// ───────────────────────── music radio (procedural, nothing to download) ─────────────────────────
const music = (() => {
  const nf = m => 440 * Math.pow(2, (m - 69) / 12);
  let noiseBuf = null;
  function noise(c) {
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const b = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (noiseBuf = b);
  }
  const env = (c, t, a, d, peak, end = 0.0001) => { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); return g; };
  const I = {
    kick(c, o, t, g = 1) { const s = c.createOscillator(); s.frequency.setValueAtTime(150, t); s.frequency.exponentialRampToValueAtTime(42, t + 0.13); const e = env(c, t, 0.004, 0.42, 0.9 * g); s.connect(e).connect(o); s.start(t); s.stop(t + 0.5); },
    snare(c, o, t, g = 1, dec = 0.18) {
      const n = c.createBufferSource(); n.buffer = noise(c); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
      const e = env(c, t, 0.002, dec, 0.55 * g); n.connect(f).connect(e).connect(o); n.start(t, Math.random()); n.stop(t + dec + 0.05);
      const s = c.createOscillator(); s.type = 'triangle'; s.frequency.setValueAtTime(200, t); s.frequency.exponentialRampToValueAtTime(140, t + 0.08); const e2 = env(c, t, 0.002, 0.1, 0.35 * g); s.connect(e2).connect(o); s.start(t); s.stop(t + 0.15);
    },
    clap(c, o, t, g = 1) { for (const k of [0, 0.011, 0.023]) { const n = c.createBufferSource(); n.buffer = noise(c); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; const e = env(c, t + k, 0.001, k === 0.023 ? 0.2 : 0.03, 0.5 * g); n.connect(f).connect(e).connect(o); n.start(t + k, Math.random()); n.stop(t + k + 0.25); } },
    hat(c, o, t, g = 1, open = false) { const n = c.createBufferSource(); n.buffer = noise(c); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200; const e = env(c, t, 0.001, open ? 0.28 : 0.045, 0.22 * g); n.connect(f).connect(e).connect(o); n.start(t, Math.random()); n.stop(t + 0.35); },
    crash(c, o, t, g = 1) { const n = c.createBufferSource(); n.buffer = noise(c); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4500; const e = env(c, t, 0.002, 1.4, 0.2 * g); n.connect(f).connect(e).connect(o); n.start(t, Math.random() * 0.2); n.stop(t + 1.5); },
    bass(c, o, t, m, dur, g = 1, type = 'sawtooth', cut = 700) {
      const s = c.createOscillator(); s.type = type; s.frequency.value = nf(m);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(cut * 2.5, t); f.frequency.exponentialRampToValueAtTime(cut * 0.5, t + dur);
      const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.32 * g, t + 0.01); e.gain.setValueAtTime(0.32 * g, t + dur * 0.8); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(e).connect(o); s.start(t); s.stop(t + dur + 0.02);
    },
    reese(c, o, t, m, dur, g = 1) { for (const det of [-9, 9]) { const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = nf(m); s.detune.value = det; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.2 * g, t + 0.03); e.gain.setValueAtTime(0.2 * g, t + dur - 0.05); e.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f).connect(e).connect(o); s.start(t); s.stop(t + dur); } },
    sub808(c, o, t, m, dur, g = 1, glideTo = null) {
      const s = c.createOscillator(); s.frequency.setValueAtTime(nf(m), t); if (glideTo != null) s.frequency.exponentialRampToValueAtTime(nf(glideTo), t + Math.min(0.2, dur * 0.6));
      const ws = c.createWaveShaper(); const cu = new Float32Array(257); for (let i = 0; i < 257; i++) { const x = i / 128 - 1; cu[i] = Math.tanh(x * 2.2); } ws.curve = cu; // odd length so silence stays at exactly zero
      const e = env(c, t, 0.005, dur, 0.5 * g); s.connect(ws).connect(e).connect(o); s.start(t); s.stop(t + dur + 0.05);
    },
    pad(c, o, t, notes, dur, g = 1, cut = 1400) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; const e = c.createGain();
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.06 * g, t + dur * 0.25); e.gain.setValueAtTime(0.06 * g, t + dur * 0.75); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      f.connect(e).connect(o);
      for (const m of notes) for (const det of [-7, 7]) { const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = nf(m); s.detune.value = det; s.connect(f); s.start(t); s.stop(t + dur); }
    },
    keys(c, o, t, notes, dur, g = 1) { // electric piano
      for (const m of notes) { const s = c.createOscillator(); s.type = 'sine'; s.frequency.value = nf(m); const s2 = c.createOscillator(); s2.type = 'triangle'; s2.frequency.value = nf(m + 12); const e = env(c, t, 0.006, dur, 0.09 * g); const e2 = env(c, t, 0.004, 0.25, 0.03 * g); s.connect(e).connect(o); s2.connect(e2).connect(o); s.start(t); s2.start(t); s.stop(t + dur + 0.1); s2.stop(t + 0.4); }
    },
    pluck(c, o, t, m, dur, g = 1, type = 'square', cut = 2400) { const s = c.createOscillator(); s.type = type; s.frequency.value = nf(m); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cut, t); f.frequency.exponentialRampToValueAtTime(300, t + dur); const e = env(c, t, 0.003, dur, 0.12 * g); s.connect(f).connect(e).connect(o); s.start(t); s.stop(t + dur + 0.05); },
    guitar(c, o, t, root, dur, g = 1, mute = false) {
      const ws = c.createWaveShaper(); const cu = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 256 - 1; cu[i] = Math.tanh(x * 9); } ws.curve = cu;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = mute ? 1300 : 3200; const e = c.createGain();
      const d = mute ? Math.min(dur, 0.12) : dur;
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.11 * g, t + 0.008); e.gain.setValueAtTime(0.11 * g, t + d * 0.7); e.gain.exponentialRampToValueAtTime(0.0001, t + d);
      ws.connect(f).connect(e).connect(o);
      for (const iv of [0, 7, 12]) for (const det of [-6, 6]) { const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = nf(root + iv); s.detune.value = det; s.connect(ws); s.start(t); s.stop(t + d + 0.02); }
    },
    vinyl(c, o, t, dur) { const n = c.createBufferSource(); n.buffer = noise(c); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 0.3; const g = c.createGain(); g.gain.value = 0.012; n.connect(f).connect(g).connect(o); n.start(t, Math.random()); n.stop(t + dur); for (let i = 0; i < 6; i++) { const tt = t + Math.random() * dur; const n2 = c.createBufferSource(); n2.buffer = noise(c); const e = env(c, tt, 0.001, 0.01, 0.05); n2.connect(e).connect(o); n2.start(tt, Math.random()); n2.stop(tt + 0.02); } },
  };
  const chordOf = (root, q) => q === 'm7' ? [root, root + 3, root + 7, root + 10] : q === 'M7' ? [root, root + 4, root + 7, root + 11] : q === '7' ? [root, root + 4, root + 7, root + 10] : q === 'm' ? [root, root + 3, root + 7] : [root, root + 4, root + 7];
  let rs = 1; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  // each station schedules one 4-beat bar starting at t
  const STATIONS = [
    { name: 'RAD FM', genre: 'Drum & Bass', bpm: 172, bar(c, o, t, b, B) {
      const prog = [[53, 'm7'], [49, 'M7'], [56, 'M'], [51, 'M']], ch = prog[Math.floor(b / 2) % 4], sec = Math.floor(b / 8) % 4;
      const intro = b < 4;
      if (b % 2 === 0) I.pad(c, o, t, chordOf(ch[0] + 12, ch[1]), B * 8, 1, 1600);
      if (!intro) {
        // two-step break
        I.kick(c, o, t); I.snare(c, o, t + B, 1); I.kick(c, o, t + B * 2.5, 0.8); I.snare(c, o, t + B * 3, 1);
        if (sec === 2 && rnd() < 0.5) I.snare(c, o, t + B * 3.75, 0.5);
        for (let i = 0; i < 8; i++) I.hat(c, o, t + i * B / 2, i % 2 ? 0.6 : 0.9, i === 7 && rnd() < 0.3);
        if (b % 8 === 0) I.crash(c, o, t);
        I.reese(c, o, t, ch[0] - 24, B * 1.5); I.reese(c, o, t + B * 2, ch[0] - 24 + (rnd() < 0.3 ? 3 : 0), B * 1.8);
        if (sec >= 2) { const sc = chordOf(ch[0] + 24, ch[1]); for (let i = 0; i < 8; i++) if (rnd() < 0.55) I.pluck(c, o, t + i * B / 2, sc[(i * 3 + b) % sc.length], B * 0.4, 0.7, 'square', 3000); }
      } else for (let i = 0; i < 4; i++) I.hat(c, o, t + i * B, 0.5);
    } },
    { name: 'CHILL FM', genre: 'Lo-fi beats', bpm: 84, swing: 0.16, bar(c, o, t, b, B) {
      const prog = [[62, 'm7'], [67, 'm7'], [60, '7'], [65, 'M7']], ch = prog[b % 4];
      I.vinyl(c, o, t, B * 4);
      I.keys(c, o, t, chordOf(ch[0] - 12, ch[1]), B * 1.8, 1); I.keys(c, o, t + B * 2.5, chordOf(ch[0] - 12, ch[1]), B * 1.3, 0.7);
      I.bass(c, o, t, ch[0] - 24, B * 1.5, 0.9, 'sine', 300); I.bass(c, o, t + B * 2.5, ch[0] - 24 + (rnd() < 0.5 ? 7 : 0), B, 0.8, 'sine', 300);
      if (b >= 2) {
        const sw = B * 0.16;
        I.kick(c, o, t, 0.9); I.kick(c, o, t + B * 1.75 + sw * 0.5, 0.6); I.kick(c, o, t + B * 2.5, 0.8);
        I.snare(c, o, t + B, 0.7, 0.25); I.snare(c, o, t + B * 3, 0.7, 0.25);
        for (let i = 0; i < 8; i++) I.hat(c, o, t + i * B / 2 + (i % 2 ? sw : 0), i % 2 ? 0.45 : 0.7);
        if (b % 4 === 3) { const sc = [74, 72, 69, 67, 65]; for (let i = 0; i < 4; i++) I.pluck(c, o, t + B * (i * 0.75 + 0.5), sc[Math.floor(rnd() * 5)], B * 0.6, 0.6, 'triangle', 1800); }
      }
    } },
    { name: 'SKATE PUNK RADIO', genre: 'Skate punk', bpm: 182, bar(c, o, t, b, B) {
      const prog = [40, 36, 43, 38], r = prog[Math.floor(b / 2) % 4], sec = Math.floor(b / 8) % 4;
      if (b % 8 === 0) I.crash(c, o, t, 1.2);
      for (let i = 0; i < 4; i++) { I.kick(c, o, t + i * B, 0.9); I.snare(c, o, t + i * B + B / 2, 0.9, 0.12); I.hat(c, o, t + i * B, 0.6); I.hat(c, o, t + i * B + B / 2, 0.5); }
      const mute = sec === 1;
      for (let i = 0; i < 8; i++) I.guitar(c, o, t + i * B / 2, r, B / 2, 1, mute && i % 2 === 1);
      for (let i = 0; i < 8; i++) I.bass(c, o, t + i * B / 2, r - 12, B / 2 * 0.9, 0.9, 'sawtooth', 500);
    } },
    { name: '808 FM', genre: 'Trap', bpm: 140, bar(c, o, t, b, B) {
      const prog = [57, 53, 55, 52], r = prog[Math.floor(b / 2) % 4];
      I.pad(c, o, t, chordOf(r + 12, 'm'), B * 4, 0.8, 900);
      const bell = [r + 24, r + 27, r + 31, r + 34];
      for (let i = 0; i < 8; i++) if (i % 3 !== 2) I.pluck(c, o, t + i * B / 2, bell[(i + b) % 4], B * 0.5, 0.55, 'sine', 4000);
      if (b < 2) return;
      I.kick(c, o, t); I.sub808(c, o, t, r - 24, B * 1.4, 1); I.kick(c, o, t + B * 1.75, 0.8); I.sub808(c, o, t + B * 1.75, r - 24, B * 1.6, 1, b % 4 === 3 ? r - 19 : null);
      I.clap(c, o, t + B * 2, 1); if (rnd() < 0.3) I.clap(c, o, t + B * 3.75, 0.5);
      for (let i = 0; i < 8; i++) {
        if (rnd() < 0.18) for (let k = 0; k < 3; k++) I.hat(c, o, t + i * B / 2 + k * B / 6, 0.5);
        else I.hat(c, o, t + i * B / 2, i % 2 ? 0.5 : 0.75);
      }
    } },
    { name: 'NIGHT DRIVE', genre: 'Synthwave', bpm: 104, bar(c, o, t, b, B) {
      const prog = [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], ch = prog[b % 4];
      I.pad(c, o, t, chordOf(ch[0], ch[1]), B * 4, 1.3, 1800);
      const ar = chordOf(ch[0] + 12, ch[1]).concat([ch[0] + 24]);
      for (let i = 0; i < 16; i++) I.pluck(c, o, t + i * B / 4, ar[i % ar.length], B / 4 * 0.9, 0.55, 'sawtooth', 2600);
      for (let i = 0; i < 8; i++) I.bass(c, o, t + i * B / 2, ch[0] - 24, B / 2 * 0.85, 0.8, 'sawtooth', 450);
      if (b >= 2) { for (let i = 0; i < 4; i++) { I.kick(c, o, t + i * B); I.hat(c, o, t + i * B + B / 2, 0.6); } I.snare(c, o, t + B, 1.1, 0.35); I.snare(c, o, t + B * 3, 1.1, 0.35); if (b % 8 === 0) I.crash(c, o, t); }
    } },
  ];
  // live playback
  let ducked = false, ctx = null, master = null, filt = null, bus = null, delay = null, station = store.get('station', 0), vol = store.get('musicVol', 0.5), on = store.get('musicOn', true);
  let nextT = 0, bar = 0, timer = null;
  function chain(c, dest) {
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
    const dl = c.createDelay(1); dl.delayTime.value = 0.28; const fb = c.createGain(); fb.gain.value = 0.25; const wet = c.createGain(); wet.gain.value = 0.18;
    const input = c.createGain();
    // block any DC offset before it reaches the echo loop, or it builds up into a thump
    const dc = c.createBiquadFilter(); dc.type = 'highpass'; dc.frequency.value = 22; dc.Q.value = 0.7;
    input.connect(dc); dc.connect(comp); dc.connect(dl); dl.connect(fb).connect(dl); dl.connect(wet).connect(comp);
    comp.connect(lp).connect(dest);
    return { input, lp };
  }
  function start() {
    if (!on) return;
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    if (timer) return;
    newBus();
    timer = setInterval(pump, 40);
    nowPlaying();
  }
  function newBus() {
    if (bus) { const old = bus; old.input.gain.setTargetAtTime(0, ctx.currentTime, 0.15); setTimeout(() => { try { old.input.disconnect(); } catch { } }, 1500); }
    bus = chain(ctx, master); filt = bus.lp; ducked = false;
    nextT = ctx.currentTime + 0.08; bar = 0; rs = 1 + station * 977;
  }
  function pump() {
    if (!ctx || !on) return;
    const S = STATIONS[station], B = 60 / S.bpm;
    while (nextT < ctx.currentTime + 0.35) { S.bar(ctx, bus.input, nextT, bar, B); nextT += B * 4; bar++; }
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } if (bus) { bus.input.gain.setTargetAtTime(0, ctx.currentTime, 0.1); } bus = null; }
  function nowPlaying() { const S = STATIONS[station]; showPopup('♪ ' + S.name, '', S.genre.toUpperCase()); const el = document.getElementById('np'); if (el) el.textContent = '♪ ' + S.name; }
  // offline render (used to score the trailer)
  async function render(idx, seconds, sr = 44100) {
    const c = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    noiseBuf = null; const g = c.createGain(); g.gain.value = 0.9; g.connect(c.destination);
    const b2 = chain(c, g); const S = STATIONS[idx], B = 60 / S.bpm; rs = 1 + idx * 977;
    for (let t = 0.05, k = 0; t < seconds; t += B * 4, k++) S.bar(c, b2.input, t, k, B);
    const buf = await c.startRendering(); noiseBuf = null;
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, out = new Int16Array(n * 2);
    let peak = 0.0001; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const k = 0.95 / peak; for (let i = 0; i < n; i++) { out[i * 2] = L[i] * k * 32767; out[i * 2 + 1] = R[i] * k * 32767; }
    const bytes = new Uint8Array(out.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return {
    STATIONS, start, render,
    get station() { return station; }, get on() { return on; }, get vol() { return vol; },
    next() { station = (station + 1) % STATIONS.length; store.set('station', station); if (ctx && timer) { newBus(); nowPlaying(); } else start(); },
    set(i) { station = i; store.set('station', i); if (ctx && timer) { newBus(); nowPlaying(); } },
    toggle(v) { on = v ?? !on; store.set('musicOn', on); if (on) start(); else stop(); const el = document.getElementById('np'); if (el) el.textContent = on ? '♪ ' + STATIONS[station].name : ''; },
    volume(v) { vol = v; store.set('musicVol', v); if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    duck(amount) { const d = amount < 1; if (filt && ctx && d !== ducked) { ducked = d; filt.frequency.setTargetAtTime(d ? 900 : 20000, ctx.currentTime, 0.1); } },
  };
})();

// ───────────────────────── garage: cash, upgrades, paint, outfits ─────────────────────────
let cash = store.get('cash', 0);
const UPGRADES = [
  { id: 'speed', n: 'Top speed', d: '+6% top speed' },
  { id: 'accel', n: 'Acceleration', d: '+12% acceleration' },
  { id: 'pop', n: 'Pop', d: '+6% hop & air' },
  { id: 'trick', n: 'Trick speed', d: '+8% spins, flips, whips' },
  { id: 'grip', n: 'Handling', d: 'sharper steering, calmer wheelies' },
];
const UPG_COST = [250, 600, 1200, 2400, 4500];
const upg = store.get('upg', {});
const upgLevel = (kind, id) => (upg[kind] && upg[kind][id]) || 0;
function vehCfg(kind) {
  const b = VEH[kind], L = id => upgLevel(kind, id), t = 1 + 0.08 * L('trick');
  return { ...b, top: b.top * (1 + 0.06 * L('speed')), accel: b.accel * (1 + 0.12 * L('accel')), hop: b.hop * (1 + 0.06 * L('pop')), spin: b.spin * t, flip: b.flip * t, whip: b.whip / t, bar: b.bar / t, grip: L('grip') };
}
const PAINTS = [
  { id: 'gloss', n: 'Gloss', price: 0 }, { id: 'matte', n: 'Matte', price: 300 }, { id: 'camo', n: 'Camo', price: 800 },
  { id: 'carbon', n: 'Carbon fibre', price: 1500 }, { id: 'chrome', n: 'Chrome', price: 1800 }, { id: 'flame', n: 'Flames', price: 2200 },
  { id: 'neon', n: 'Neon glow', price: 2600 }, { id: 'galaxy', n: 'Galaxy', price: 3200 }, { id: 'oil', n: 'Oil slick', price: 3800 }, { id: 'pixel', n: 'Pixel camo', price: 2400 },
  { id: 'rainbow', n: 'Rainbow', price: 4200 }, { id: 'lava', n: 'Lava', price: 5000 }, { id: 'gold', n: '24K gold', price: 6000 }, { id: 'diamond', n: 'Diamond', price: 12000 },
];
const OUTFITS = [
  { id: 'classic', n: 'Classic', price: 0, top: 0x2a2c31, pants: 0x2f3a48, helmet: 0xff4d1f },
  { id: 'street', n: 'Street', price: 300, top: 0xe6e2d8, pants: 0x1f2a3a, helmet: 0x111111 },
  { id: 'race', n: 'Race kit', price: 900, top: 0x1d4ed8, pants: 0xf2f2f2, helmet: 0xf2f2f2 },
  { id: 'forest', n: 'Forest', price: 900, top: 0x2f5d3a, pants: 0x4a3b2a, helmet: 0x6b8e23 },
  { id: 'hivis', n: 'Hi-vis', price: 1200, top: 0xd7ff1f, pants: 0x222222, helmet: 0xff7a00 },
  { id: 'night', n: 'Night rider', price: 1600, top: 0x0d0d10, pants: 0x0d0d10, helmet: 0x7a2cff },
  { id: 'candy', n: 'Candy', price: 2000, top: 0xff6fb5, pants: 0x7dd3fc, helmet: 0xffffff },
  { id: 'ninja', n: 'Ninja', price: 2400, top: 0x111114, pants: 0x111114, helmet: 0xd61f1f },
  { id: 'ice', n: 'Ice', price: 2800, top: 0xbfe9ff, pants: 0x2b4c7e, helmet: 0x7fd4ff },
  { id: 'toxic', n: 'Toxic', price: 3400, top: 0x39ff14, pants: 0x1b1b1b, helmet: 0x39ff14 },
  { id: 'royal', n: 'Royal', price: 5000, top: 0x4b1d8f, pants: 0x1a1a2e, helmet: 0xffd43b },
  { id: 'champ', n: 'Champion', price: 7500, top: 0xffd36b, pants: 0x1a1a1a, helmet: 0xffc531 },
];
const owned = store.get('owned', ['p:gloss', 'o:classic']);
let paintId = store.get('paint', 'gloss'), outfitId = store.get('outfit', 'classic');
function earn(n, why) {
  n = Math.round(n); if (n <= 0) return 0;
  cash += n; store.set('cash', cash); renderCash();
  if (why) addFeed(`<b>+${n.toLocaleString()} coins</b> ${why}`);
  online.coinsEarned(n);
  return n;
}
const coinHTML = n => `<span class="price"><i class="coin"></i>${n.toLocaleString()}</span>`;
function renderCash() { const t = cash.toLocaleString(); const a = document.getElementById('cash'); if (a) a.innerHTML = `<i class="coin"></i>${t}`; const b = document.getElementById('tb-coins'); if (b) b.textContent = t; }
// paint textures
function patternTex(kind, base) {
  const c = makeCanvas(256), g = c.getContext('2d'), col = '#' + base.toString(16).padStart(6, '0');
  if (kind === 'camo') { g.fillStyle = '#4b5320'; g.fillRect(0, 0, 256, 256); for (const k of ['#6b6b3a', '#2f3a1f', '#8a7b55', '#1f241a']) for (let i = 0; i < 16; i++) { g.fillStyle = k; g.beginPath(); g.ellipse(rand(0, 256), rand(0, 256), rand(14, 40), rand(8, 26), rand(0, 3), 0, 7); g.fill(); } }
  else if (kind === 'carbon') { for (let y = 0; y < 256; y += 8) for (let x = 0; x < 256; x += 8) { const v = ((x + y) / 8) % 2 ? 26 : 44; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(x, y, 8, 8); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, y, 8, 3); } }
  else if (kind === 'galaxy') { const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#120b3a'); gr.addColorStop(0.5, '#4b1d7a'); gr.addColorStop(1, '#0a2a5a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 6; i++) { const x = rand(0, 256), y = rand(0, 256), r = rand(30, 90), q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, ['rgba(255,80,200,.35)', 'rgba(80,200,255,.3)'][i % 2]); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(0, 0, 256, 256); } for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(255,255,255,${rand(.4, 1)})`; g.fillRect(rand(0, 256), rand(0, 256), rand(1, 2.5), rand(1, 2.5)); } }
  else if (kind === 'flame') { g.fillStyle = col; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 9; i++) { const x = i * 30 - 10; const gr = g.createLinearGradient(0, 256, 0, 40); gr.addColorStop(0, '#ffef5a'); gr.addColorStop(0.5, '#ff7a1a'); gr.addColorStop(1, 'rgba(220,30,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, 256); g.quadraticCurveTo(x + 30, 160, x + 10, rand(30, 90)); g.quadraticCurveTo(x + 40, 150, x + 34, 256); g.fill(); } }
  else if (kind === 'pixel') { const P = ['#2b3a55', '#3f5a85', '#1b2436', '#6b8bbd']; for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) { g.fillStyle = P[(Math.random() * 4) | 0]; g.fillRect(x, y, 16, 16); } }
  else if (kind === 'rainbow') { const gr = g.createLinearGradient(0, 0, 256, 0); ['#ff3b3b', '#ff9f1c', '#ffe14d', '#3ddc84', '#2b9bff', '#8b5cf6', '#ff3b3b'].forEach((c2, i, a) => gr.addColorStop(i / (a.length - 1), c2)); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  else if (kind === 'lava') { g.fillStyle = '#1a0a06'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 40; i++) { g.strokeStyle = ['#ff4d1f', '#ffb300', '#ff7a1a'][i % 3]; g.lineWidth = rand(1.5, 4); g.beginPath(); let x = rand(0, 256), y = rand(0, 256); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rand(-30, 30); y += rand(-30, 30); g.lineTo(x, y); } g.stroke(); } }
  const t = tex(c); t.repeat.set(2, 2); return t;
}
const PAINT_TEX = {};
function applyPaint(mat, id, hex) {
  mat.map = null; mat.emissive.setHex(0); mat.emissiveIntensity = 1; mat.iridescence = 0; mat.metalness = 0.5; mat.roughness = 0.26; mat.clearcoat = 1; mat.clearcoatRoughness = 0.05; mat.color.setHex(hex);
  if (id === 'matte') { mat.roughness = 0.85; mat.clearcoat = 0; mat.metalness = 0.2; mat.color.setHex(hex).multiplyScalar(0.6); }
  else if (id === 'chrome') { mat.metalness = 1; mat.roughness = 0.06; mat.color.setHex(0xeef1f5); }
  else if (id === 'gold') { mat.metalness = 1; mat.roughness = 0.18; mat.color.setHex(0xffc65a); }
  else if (id === 'neon') { mat.emissive.setHex(hex); mat.emissiveIntensity = 1.6; mat.roughness = 0.4; }
  else if (id === 'oil') { mat.metalness = 0.9; mat.roughness = 0.2; mat.iridescence = 1; mat.iridescenceIOR = 1.8; mat.color.setHex(0x2a2a40); }
  else if (id === 'diamond') { mat.metalness = 0.2; mat.roughness = 0.02; mat.iridescence = 1; mat.iridescenceIOR = 2.4; mat.color.setHex(0xe6f7ff); mat.emissive.setHex(0x3a5a70); mat.emissiveIntensity = 0.4; }
  else if (['camo', 'carbon', 'galaxy', 'flame', 'pixel', 'rainbow', 'lava'].includes(id)) { const k = id + (id === 'flame' ? hex : ''); mat.map = PAINT_TEX[k] || (PAINT_TEX[k] = patternTex(id, hex)); mat.color.setHex(0xffffff); if (id === 'galaxy') { mat.emissiveMap = mat.map; mat.emissive.setHex(0x553388); mat.emissiveIntensity = 0.5; } if (id === 'lava') { mat.emissiveMap = mat.map; mat.emissive.setHex(0xffffff); mat.emissiveIntensity = 0.9; } }
  if (id !== 'galaxy' && id !== 'lava') mat.emissiveMap = null;
  mat.needsUpdate = true;
}
function outfit(id) { return OUTFITS.find(o => o.id === id) || OUTFITS[0]; }
function riderOpts(id, av) {
  const o = outfit(id); av = av || {};
  return { top: o.top, pants: o.pants, helmet: o.helmet, gear: av.gear || 'full', skin: AV_SKIN[(av.skin ?? 1) % AV_SKIN.length], hair: av.hair || 'short', hairCol: AV_HAIRC[(av.hairCol ?? 1) % AV_HAIRC.length], eyes: av.eyes };
}
function applyOutfitTo(A, id, av) {
  // rebuild the rider with the outfit's colours and the avatar's head
  const old = A.rider.group, parent = old.parent;
  A.rider = buildRider(riderOpts(id, av));
  if (parent) { parent.remove(old); parent.add(A.rider.group); }
}
function equipLook() {
  applyPaint(veh.paint, paintId, COLORS[paintColor]);
  AV.outfit = outfitId;
  const key = outfitId + JSON.stringify(AV);
  if (me.lookKey !== key) { me.lookKey = key; applyOutfitTo(me, outfitId, AV); rider = me.rider; }
  net.announce(); online.saveSoon(); if (typeof renderMe === 'function') renderMe();
}
// garage UI
let gTab = 'up';
function renderGarage() {
  const el = document.getElementById('garage-body'); if (!el) return;
  renderCash();
  document.querySelectorAll('#garage-tabs button').forEach(b => b.classList.toggle('sel', b.dataset.t === gTab));
  const k = player.kind;
  const gr = document.getElementById('g-ride'); if (gr) gr.innerHTML = gTab === 'up' ? VEH_KEYS.map(v => `<button data-ride="${v}" class="${v === k ? 'sel' : ''}">${VEH[v].label}</button>`).join('') : '';
  if (gTab === 'up') {
    el.innerHTML = `<div class="g-note">Upgrades for your <b>${VEH[k].label}</b>. Each ride has its own upgrades — switch ride at the top right.</div>` + UPGRADES.map(u => {
      const lv = upgLevel(k, u.id), cost = UPG_COST[lv];
      return `<div class="g-row"><div><b>${u.n}</b><span>${u.d} per level</span></div><div class="pips">${[0, 1, 2, 3, 4].map(i => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>` +
        (lv >= 5 ? `<button disabled>MAXED</button>` : `<button data-buy="u:${u.id}" ${cash < cost ? 'class="poor"' : ''}>${coinHTML(cost)}</button>`) + `</div>`;
    }).join('');
  } else if (gTab === 'paint') {
    el.innerHTML = `<div class="g-grid">` + PAINTS.map(p => {
      const own = owned.includes('p:' + p.id), on = paintId === p.id;
      return `<div class="g-card ${on ? 'on' : ''}"><div class="sw sw-${p.id}" style="--c:#${COLORS[paintColor].toString(16).padStart(6, '0')}"></div><b>${p.n}</b>` + (own ? `<button data-eq="p:${p.id}">${on ? 'EQUIPPED' : 'EQUIP'}</button>` : `<button data-buy="p:${p.id}" ${cash < p.price ? 'class="poor"' : ''}>${coinHTML(p.price)}</button>`) + `</div>`;
    }).join('') + `</div><div class="g-note">Pick the colour on the PLAY tab. Paint jobs work on every ride.</div>`;
  } else if (gTab === 'avatar') { renderAvatarEditor(el); } else {
    el.innerHTML = `<div class="g-grid">` + OUTFITS.map(o => {
      const own = owned.includes('o:' + o.id), on = outfitId === o.id, h = x => '#' + x.toString(16).padStart(6, '0');
      return `<div class="g-card ${on ? 'on' : ''}"><div class="fit"><i style="background:${h(o.helmet)}"></i><i style="background:${h(o.top)}"></i><i style="background:${h(o.pants)}"></i></div><b>${o.n}</b>` + (own ? `<button data-eq="o:${o.id}">${on ? 'WEARING' : 'WEAR'}</button>` : `<button data-buy="o:${o.id}" ${cash < o.price ? 'class="poor"' : ''}>${coinHTML(o.price)}</button>`) + `</div>`;
    }).join('') + `</div>`;
  }
}
function garageClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.t) { gTab = b.dataset.t; renderGarage(); return; }
  if (b.dataset.ride) { equip(b.dataset.ride); spawn(zoneFor()); buildMenu(); return; }
  if (b.dataset.av) { const [key, v] = b.dataset.av.split(':'); setAvatar(key, v); return; }
  const k = player.kind;
  if (b.dataset.buy) {
    const [type, id] = b.dataset.buy.split(':');
    let price = 0;
    if (type === 'u') price = UPG_COST[upgLevel(k, id)];
    else if (type === 'p') price = PAINTS.find(p => p.id === id).price;
    else price = OUTFITS.find(o => o.id === id).price;
    if (cash < price) { b.textContent = 'NEED ' + (price - cash).toLocaleString() + ' MORE'; return; }
    cash -= price; store.set('cash', cash);
    if (type === 'u') { upg[k] = upg[k] || {}; upg[k][id] = upgLevel(k, id) + 1; store.set('upg', upg); veh.cfg = vehCfg(k); online.saveSoon(1000); }
    else { owned.push(type + ':' + id); store.set('owned', owned); if (type === 'p') paintId = id; else outfitId = id; store.set('paint', paintId); store.set('outfit', outfitId); equipLook(); }
    sfx.ding(); renderGarage(); return;
  }
  if (b.dataset.eq) { const [type, id] = b.dataset.eq.split(':'); if (type === 'p') paintId = id; else outfitId = id; store.set('paint', paintId); store.set('outfit', outfitId); equipLook(); renderGarage(); }
}

// ───────────────────────── modes: hill race & trick attack ─────────────────────────
const race = { on: false, t: 0, gate: 0, best: store.get('hillBest', 0) };
function updateRace(dt) {
  const P = player;
  const onHill = Math.abs(P.pos.z - HILL.z) < 9 && P.pos.x > HILL.x - 2 && P.pos.x < HILL.x + HILL.L + 2;
  const u = P.pos.x - HILL.x;
  if (!race.on) {
    if (onHill && u > HILL.gates[0] && u < HILL.gates[0] + 6 && !P.bailed) { race.on = true; race.t = 0; race.gate = 1; showPopup('GO!', 'good', 'HILL BOMB'); sfx.ding(); }
  } else {
    race.t += dt;
    if (!onHill || u < HILL.gates[0] - 2) { race.on = false; showPopup('RACE CANCELLED', 'bail'); return; }
    if (u >= HILL.gates[race.gate]) {
      if (race.gate === HILL.gates.length - 1) {
        race.on = false;
        const t = race.t, pb = !race.best || t < race.best;
        if (pb) { race.best = t; store.set('hillBest', t); }
        showPopup(t.toFixed(2) + 's', 'good', pb ? 'NEW BEST TIME' : 'BEST ' + race.best.toFixed(2) + 's');
        earn(Math.max(150, 900 - t * 14), 'Hill Bomb finish'); goal('hill'); online.submit('hill', +t.toFixed(2));
        net.send({ t: 'trick', name: `Hill Bomb in ${t.toFixed(2)}s`, pts: 0 });
      } else { race.gate++; sfx.ding(); showPopup(race.t.toFixed(2) + 's', '', 'CHECKPOINT'); }
    }
  }
  const el = document.getElementById('timer');
  if (race.on) { el.classList.remove('hidden'); el.innerHTML = `<span>HILL BOMB</span>${race.t.toFixed(2)}`; }
  else if (!attack.on) el.classList.add('hidden');
}
const attack = { on: false, t: 0, score0: 0, best: store.get('attackBest', 0) };
function startAttack() { attack.on = true; attack.t = 120; attack.score0 = score; showPopup('TRICK ATTACK', 'good', '2 MINUTES — GO!'); }
function updateAttack(dt) {
  if (!attack.on) return;
  attack.t -= dt;
  const el = document.getElementById('timer'); el.classList.remove('hidden');
  const got = score - attack.score0;
  el.innerHTML = `<span>TRICK ATTACK · ${got.toLocaleString()}</span>${Math.max(0, attack.t).toFixed(1)}`;
  if (attack.t <= 0) {
    endCombo(true);
    const pts = score - attack.score0; attack.on = false; el.classList.add('hidden');
    const pb = pts > attack.best; if (pb) { attack.best = pts; store.set('attackBest', pts); }
    showPopup(pts.toLocaleString(), 'good', pb ? 'NEW TRICK ATTACK BEST' : 'BEST ' + attack.best.toLocaleString());
    earn(pts / 12, 'Trick Attack'); if (pts >= 20000) goal('attack20k'); online.submit('attack', pts);
  }
}
// ───────────────────────── avatar (2D portrait + rider head) ─────────────────────────
const AV_HAIR = ['short', 'buzz', 'curly', 'long', 'mohawk', 'bun', 'bald'];
const AV_EYES = ['dots', 'happy', 'cool', 'wink', 'angry'];
const AV_MOUTH = ['smile', 'grin', 'flat', 'open', 'tongue'];
const AV_GEAR = ['full', 'open', 'cap', 'beanie', 'none'];
const AV_GEAR_N = { full: 'Full-face', open: 'Open helmet', cap: 'Cap', beanie: 'Beanie', none: 'Nothing' };
const AV_BG = ['#ff4d1f', '#2b6cff', '#22a35a', '#ffc531', '#8b5cf6', '#ff6fb5', '#16a3b8', '#3a3f4b'];
let AV = Object.assign({ skin: 1, hair: 'short', hairCol: 1, eyes: 'dots', mouth: 'smile', gear: 'full', bg: 0 }, store.get('avatar', {}));
const hx = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
const safeImg = s => typeof s === 'string' && /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+|https:\/\/cdn\.discordapp\.com\/[A-Za-z0-9_./?=-]+)$/.test(s) && s.length < 24000;
function avatarSVG(av, outfitIdOrLook) {
  if (av && safeImg(av.img)) return `<img src="${av.img}" alt="" draggable="false" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
  av = Object.assign({ skin: 1, hair: 'short', hairCol: 1, eyes: 'dots', mouth: 'smile', gear: 'full', bg: 0 }, av || {});
  const o = typeof outfitIdOrLook === 'object' && outfitIdOrLook ? outfitIdOrLook : outfit(outfitIdOrLook || av.outfit || 'classic');
  const skin = hx(AV_SKIN[av.skin % AV_SKIN.length]), hair = hx(AV_HAIRC[av.hairCol % AV_HAIRC.length]), top = hx(o.top), gear = hx(o.helmet), bg = AV_BG[av.bg % AV_BG.length];
  const dark = '#15171c';
  let s = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="${bg}"/><circle cx="20" cy="14" r="46" fill="rgba(255,255,255,.14)"/>`;
  // body
  s += `<path d="M12 104 C14 78 32 70 50 70 C68 70 86 78 88 104Z" fill="${top}"/><path d="M40 70 L50 82 L60 70" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="3"/>`;
  s += `<rect x="43" y="58" width="14" height="14" rx="4" fill="${skin}"/>`;
  const showHair = av.gear !== 'full' && av.gear !== 'beanie' && av.gear !== 'open';
  // hair behind the head
  if (showHair || av.gear === 'open') { if (av.hair === 'long') s += `<path d="M27 44 C25 70 30 78 38 76 L62 76 C70 78 75 70 73 44Z" fill="${hair}"/>`; }
  // head
  s += `<circle cx="29.5" cy="47" r="5" fill="${skin}"/><circle cx="70.5" cy="47" r="5" fill="${skin}"/><ellipse cx="50" cy="45" rx="20.5" ry="23" fill="${skin}"/>`;
  if (showHair) {
    const H = {
      short: `<path d="M29 43 C27 20 73 20 71 43 C66 31 34 31 29 43Z" fill="${hair}"/>`,
      buzz: `<path d="M30 40 C30 22 70 22 70 40 C64 32 36 32 30 40Z" fill="${hair}" opacity=".85"/>`,
      curly: [[34, 30], [42, 25], [50, 23], [58, 25], [66, 30], [70, 37], [30, 37]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${hair}"/>`).join(''),
      long: `<path d="M28 46 C26 18 74 18 72 46 C66 30 34 30 28 46Z" fill="${hair}"/>`,
      mohawk: `<path d="M44 34 C44 12 56 12 56 34Z" fill="${hair}"/>`,
      bun: `<circle cx="50" cy="19" r="8" fill="${hair}"/><path d="M29 42 C27 21 73 21 71 42 C66 31 34 31 29 42Z" fill="${hair}"/>`,
      bald: `<ellipse cx="44" cy="30" rx="7" ry="3" fill="rgba(255,255,255,.25)"/>`,
    }; s += H[av.hair] || H.short;
  }
  // face
  const E = {
    dots: `<circle cx="42" cy="47" r="2.8" fill="${dark}"/><circle cx="58" cy="47" r="2.8" fill="${dark}"/>`,
    happy: `<path d="M38.5 48 Q42 43.5 45.5 48" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M54.5 48 Q58 43.5 61.5 48" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    cool: `<rect x="33" y="42" width="15" height="9" rx="3" fill="${dark}"/><rect x="52" y="42" width="15" height="9" rx="3" fill="${dark}"/><rect x="47" y="44" width="6" height="2.4" fill="${dark}"/><rect x="36" y="43.5" width="5" height="2" rx="1" fill="rgba(255,255,255,.35)"/>`,
    wink: `<circle cx="42" cy="47" r="2.8" fill="${dark}"/><path d="M54.5 47.5 L61.5 47.5" stroke="${dark}" stroke-width="2.6" stroke-linecap="round"/>`,
    angry: `<circle cx="42" cy="48" r="2.6" fill="${dark}"/><circle cx="58" cy="48" r="2.6" fill="${dark}"/><path d="M37 41 L46 44 M63 41 L54 44" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>`,
  };
  const Mo = {
    smile: `<path d="M43 57 Q50 63.5 57 57" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    grin: `<path d="M41 56 Q50 66 59 56Z" fill="${dark}"/><path d="M43 56.6 L57 56.6 L56 58.6 L44 58.6Z" fill="#fff"/>`,
    flat: `<path d="M44 58.5 L56 58.5" stroke="${dark}" stroke-width="2.6" stroke-linecap="round"/>`,
    open: `<ellipse cx="50" cy="59" rx="4.6" ry="5.4" fill="${dark}"/>`,
    tongue: `<path d="M42 56.5 Q50 64 58 56.5" stroke="${dark}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M47 60 Q50 67 53 60Z" fill="#ff6f8a"/>`,
  };
  if (av.gear !== 'full') s += (E[av.eyes] || E.dots) + (Mo[av.mouth] || Mo.smile);
  // head gear on top
  if (av.gear === 'full') {
    s += `<path d="M24 47 C24 15 76 15 76 47 L76 58 C76 70 66 72 50 72 C34 72 24 70 24 58Z" fill="${gear}"/>`;
    s += `<path d="M30 40 C30 35 70 35 70 40 L70 52 C70 56 30 56 30 52Z" fill="#1d2430"/><path d="M33 41 C40 38 52 38 60 40 L58 44 C50 42 40 42 35 45Z" fill="rgba(255,255,255,.28)"/>`;
    s += `<rect x="45" y="61" width="10" height="5" rx="2" fill="rgba(0,0,0,.3)"/><path d="M28 30 C36 21 52 19 64 23" stroke="rgba(255,255,255,.35)" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  } else if (av.gear === 'open') {
    s += `<path d="M26 44 C24 13 76 13 74 44 C68 34 32 34 26 44Z" fill="${gear}"/><path d="M28 44 L33 62 M72 44 L67 62" stroke="rgba(0,0,0,.35)" stroke-width="2"/><path d="M33 26 C40 20 54 19 63 22" stroke="rgba(255,255,255,.35)" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  } else if (av.gear === 'cap') {
    s += `<path d="M28 39 C27 17 73 17 72 39Z" fill="${gear}"/><path d="M50 37 C62 35 80 36 84 41 C76 43 60 42 50 41Z" fill="${gear}"/><path d="M50 37 C62 35 80 36 84 41" stroke="rgba(0,0,0,.25)" stroke-width="1.5" fill="none"/><circle cx="50" cy="19" r="2.4" fill="rgba(0,0,0,.3)"/>`;
  } else if (av.gear === 'beanie') {
    s += `<path d="M27 40 C25 12 75 12 73 40Z" fill="${gear}"/><rect x="26" y="34" width="48" height="10" rx="5" fill="${gear}"/><rect x="26" y="34" width="48" height="10" rx="5" fill="rgba(0,0,0,.18)"/><circle cx="50" cy="13" r="5.5" fill="${gear}"/>`;
  }
  return s + '</svg>';
}

// ───────────────────────── online: accounts, friends, servers, leaderboards ─────────────────────────
const ONLINE_CFG = { url: 'https://jmrgxreacfnakwsbwjyk.supabase.co', key: 'sb_publishable_dT28MOtEkXkeXclJnqzcvQ_xTSOJqlX' };
const SITE_URL = 'https://play-sendit.netlify.app';
{ const q = new URLSearchParams(location.search); if (q.get('onlineUrl')) { ONLINE_CFG.url = q.get('onlineUrl'); ONLINE_CFG.key = q.get('onlineKey') || 'test'; } }
const online = (() => {
  const ON = !!(ONLINE_CFG.url && ONLINE_CFG.key);
  let token = store.get('token', null), me = null, saveT = null, pendingCoins = 0, beatT = null, listeners = [];
  const ERR = {
    bad_username: 'Usernames are 3–16 letters, numbers or _', bad_password: 'Passwords need at least 6 characters', username_taken: 'That username is taken',
    wrong_login: 'Wrong username or password', not_logged_in: 'Please sign in again', no_such_user: 'No player with that username', thats_you: "That's you!",
    no_such_server: 'That server has closed', not_friends: 'You can only invite friends', not_in_server: 'Join or host a server first', bad_avatar: "That picture can't be used", friends_only: "That server is friends only", server_full: 'That server is full', code_taken: 'Try hosting again',
  };
  const nice = e => { const m = String(e && e.message || e); for (const k in ERR) if (m.includes(k)) return ERR[k]; return /fetch|network|Failed/i.test(m) ? "Can't reach the game servers — check your internet" : m; };
  async function rpc(fn, args = {}) {
    if (!ON) throw new Error('Online play is not set up in this build');
    const r = await fetch(`${ONLINE_CFG.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ONLINE_CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = txt; }
    if (!r.ok) { const e = new Error((j && j.message) || 'HTTP ' + r.status); if (String(e.message).includes('not_logged_in')) signedOut(); throw e; }
    return j;
  }
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
  // what we keep in the cloud
  function snapshot() { return { v: 1, cash, upg, owned, paint: paintId, outfit: outfitId, color: paintColor, goals: [...goalsDone], best, hillBest: race.best, attackBest: attack.best }; }
  function adopt(save) {
    if (!save || !save.v) return false;
    cash = save.cash | 0; store.set('cash', cash);
    for (const k of Object.keys(upg)) delete upg[k]; Object.assign(upg, save.upg || {}); store.set('upg', upg);
    owned.length = 0; owned.push(...new Set(['p:gloss', 'o:classic', ...(save.owned || [])])); store.set('owned', owned);
    paintId = save.paint || 'gloss'; outfitId = save.outfit || 'classic'; store.set('paint', paintId); store.set('outfit', outfitId);
    if (save.color != null) { paintColor = save.color % COLORS.length; store.set('color', paintColor); }
    for (const g of save.goals || []) goalsDone.add(g); store.set('goals', [...goalsDone]);
    if (save.best > best) { best = save.best; store.set('best', best); elBest.textContent = best.toLocaleString(); }
    if (save.hillBest && (!race.best || save.hillBest < race.best)) { race.best = save.hillBest; store.set('hillBest', race.best); }
    if (save.attackBest > attack.best) { attack.best = save.attackBest; store.set('attackBest', attack.best); }
    veh.cfg = vehCfg(player.kind); equipLook(); renderLetters && renderLetters();
    return true;
  }
  function signedIn(res, fresh) {
    token = res.token || token; store.set('token', token); me = res.profile || res;
    if (me.avatar && (me.avatar.hair || me.avatar.img)) { AV = Object.assign(AV, me.avatar); if (!me.avatar.img) delete AV.img; store.set('avatar', AV); applyAvatarLook(); }
    if (!adopt(me.save)) saveSoon(0); // brand-new account: upload what's on this computer
    else if (fresh) addFeed(`Welcome back, <b>${esc(me.username)}</b>`);
    beat(); emit();
  }
  function signedOut() { token = null; me = null; store.set('token', null); clearTimeout(beatT); emit(); }
  async function signup(u, p) { const r = await rpc('si_signup', { p_username: u, p_password: p, p_avatar: AV, p_save: snapshot() }); signedIn(r, true); }
  async function login(u, p) { const r = await rpc('si_login', { p_username: u, p_password: p }); signedIn(r, true); }
  async function logout() { try { if (token) await rpc('si_logout', { p_token: token }); } catch { } signedOut(); }
  async function restore() { if (!ON || !token) return emit(); try { const p = await rpc('si_me', { p_token: token }); signedIn({ profile: p }); } catch (e) { if (!String(e.message).includes('not_logged_in')) emit(); } }
  function saveSoon(ms = 4000) {
    if (!me) return; clearTimeout(saveT);
    saveT = setTimeout(async () => { const c = pendingCoins; pendingCoins = 0; try { const r = await rpc('si_save', { p_token: token, p_save: snapshot(), p_avatar: AV, p_coins_earned: c }); if (r && me) me.coins_total = r.coins_total; } catch (e) { pendingCoins += c; } }, ms);
  }
  async function beat() {
    clearTimeout(beatT); if (!me) return;
    try { const r = await rpc('si_heartbeat', { p_token: token, p_room: net.code || null }); requests = r.requests | 0; invites = r.invites || []; emit(); renderInvites(); } catch { }
    beatT = setTimeout(beat, 15000);
  }
  let requests = 0, invites = [];
  // Discord: get a one-time state, open the browser, then wait for the result
  let discordPoll = null;
  async function discord(link) {
    const r = await rpc('si_discord_begin', { p_token: link ? token : null });
    window.open(`${ONLINE_CFG.url}/functions/v1/si-discord?start=${r.state}`, '_blank');
    clearInterval(discordPoll);
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      discordPoll = setInterval(async () => {
        if (Date.now() - t0 > 10 * 60 * 1000) { clearInterval(discordPoll); return reject(new Error('Discord sign-in timed out')); }
        try {
          const p = await rpc('si_discord_poll', { p_state: r.state });
          if (p.status === 'pending') return;
          clearInterval(discordPoll);
          if (p.status !== 'ok') return reject(new Error(p.error === 'discord_in_use' ? 'That Discord account is already linked to another SEND IT account' : 'Discord sign-in expired — try again'));
          if (link) { me = p.profile; if (!AV.img && me.discord && me.discord.avatar) { AV.img = me.discord.avatar; store.set('avatar', AV); saveSoon(500); } emit(); }
          else signedIn({ token: p.token, profile: p.profile }, true);
          resolve(p);
        } catch (e) { }
      }, 2000);
    });
  }
  const best1 = {};
  async function submit(board, value) {
    if (!me) return; const low = board === 'hill';
    if (best1[board] != null && (low ? value >= best1[board] : value <= best1[board])) return;
    try { const r = await rpc('si_submit', { p_token: token, p_board: board, p_value: value }); best1[board] = r.best; if (r.improved) addFeed(`<b>New personal best</b> on the ${BOARDS.find(b => b.id === board).n} leaderboard`); } catch { }
  }
  return {
    ON, rpc, nice, signup, login, logout, restore, saveSoon, submit, beat,
    get me() { return me; }, get token() { return token; }, get requests() { return requests; }, get invites() { return invites; },
    discord, cancelDiscord() { clearInterval(discordPoll); },
    async unlinkDiscord() { me = await rpc('si_discord_unlink', { p_token: token }); emit(); },
    dismissInvite(id) { invites = invites.filter(i => i.id !== id); renderInvites(); rpc('si_invite_dismiss', { p_token: token, p_id: id }).catch(() => { }); },
    coinsEarned(n) { pendingCoins += n; saveSoon(); },
    on(f) { listeners.push(f); },
  };
})();

const BOARDS = [
  { id: 'combo', n: 'Best combo', f: v => Math.round(v).toLocaleString() },
  { id: 'attack', n: 'Trick Attack', f: v => Math.round(v).toLocaleString() },
  { id: 'hill', n: 'Hill Bomb', f: v => v.toFixed(2) + 's' },
  { id: 'air', n: 'Biggest air', f: v => v.toFixed(2) + 's' },
  { id: 'coins', n: 'Most coins', f: v => Math.round(v).toLocaleString() },
];

// ───────────────────────── menu screens ─────────────────────────
let menuTab = 'play';
function setTab(t) {
  menuTab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('sel', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t));
  if (t === 'garage') renderGarage();
  if (t === 'online') { renderAccount(); refreshServers(); refreshFriends(); }
  if (t === 'ranks') { renderBoards(); loadBoard(); renderGoals(); }
}
document.getElementById('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setTab(b.dataset.tab); sfx.init(); } });
function renderMe() {
  const m = online.me;
  document.getElementById('me-av').innerHTML = avatarSVG(AV, outfitId);
  document.getElementById('me-name').textContent = m ? m.username : 'SIGN IN';
  document.getElementById('req-dot').classList.toggle('hidden', !online.requests);
}
document.getElementById('me-chip').onclick = () => { if (online.me) setTab('online'); else openAuth('in'); };

// sign in / create account
let authMode = 'in';
function openAuth(mode) {
  if (!online.ON) { setTab('online'); return; }
  authMode = mode; const up = mode === 'up';
  document.getElementById('auth-title').textContent = up ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.getElementById('auth-go').textContent = up ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.getElementById('auth-switch').innerHTML = up ? 'Already have an account? <a>Sign in</a>' : 'New here? <a>Create an account</a>';
  document.getElementById('auth-pass').autocomplete = up ? 'new-password' : 'current-password';
  document.getElementById('auth-err').textContent = '';
  document.getElementById('auth').classList.remove('hidden');
  document.getElementById('auth-user').focus();
}
{
  const box = document.getElementById('auth'), go = document.getElementById('auth-go'), err = document.getElementById('auth-err');
  const submit = async () => {
    const u = document.getElementById('auth-user').value.trim(), p = document.getElementById('auth-pass').value;
    if (!u || !p) { err.textContent = 'Type a username and password'; return; }
    go.disabled = true; err.textContent = '';
    try { if (authMode === 'up') await online.signup(u, p); else await online.login(u, p); box.classList.add('hidden'); document.getElementById('auth-pass').value = ''; showPopup('SIGNED IN', 'good', online.me.username.toUpperCase()); }
    catch (e) { err.textContent = online.nice(e); }
    go.disabled = false;
  };
  go.onclick = submit;
  for (const id of ['auth-user', 'auth-pass']) document.getElementById(id).addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submit(); if (e.key === 'Escape') box.classList.add('hidden'); });
  document.getElementById('auth-switch').onclick = e => { if (e.target.tagName === 'A') openAuth(authMode === 'up' ? 'in' : 'up'); };
  document.getElementById('auth-x').onclick = () => { box.classList.add('hidden'); online.cancelDiscord(); };
  document.getElementById('auth-discord').onclick = e => discordFlow(true, e.currentTarget);
  box.addEventListener('mousedown', e => { if (e.target === box) box.classList.add('hidden'); });
}
// stop menu text boxes from driving the bike
for (const id of ['srv-name', 'mp-code', 'fr-name']) document.getElementById(id).addEventListener('keydown', e => e.stopPropagation());

const DISCORD_ICON = '<svg class="dci" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.7.2 18.2a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-.9l.5-.4a14 14 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 .9l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.8-3.5-13.8ZM8.3 15.4c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.2 1 2.1 2.3c0 1.3-.9 2.3-2.1 2.3Zm7.4 0c-1.2 0-2.1-1-2.1-2.3s.9-2.3 2.1-2.3 2.2 1 2.1 2.3c0 1.3-.9 2.3-2.1 2.3Z"/></svg>';
async function discordFlow(fromModal, btn) {
  const msg = fromModal ? document.getElementById('auth-err') : document.getElementById('dc-msg');
  if (msg) msg.textContent = 'Finish signing in with Discord in your browser…';
  if (btn) btn.disabled = true;
  try { await online.discord(false); document.getElementById('auth').classList.add('hidden'); showPopup('SIGNED IN', 'good', online.me.username.toUpperCase()); }
  catch (e) { if (msg) msg.textContent = online.nice(e); }
  if (btn) btn.disabled = false;
}
function renderAccount() {
  const el = document.getElementById('acct'), m = online.me;
  if (!online.ON) { el.innerHTML = `<div class="signin-card"><div><div class="t">ONLINE IS OFF IN THIS BUILD</div><div class="d">You can still host and join servers with a code.</div></div></div>`; return; }
  if (!m) {
    el.innerHTML = `<div class="signin-card"><span class="av lg">${avatarSVG(AV, outfitId)}</span><div><div class="t">PLAY ONLINE</div><div class="d">Sign in to save your coins and unlocks, add friends, host friends-only servers and get on the leaderboards.</div><div id="dc-msg" class="d"></div></div><div class="sp"></div><div class="acct-btns"><button class="act dc" data-a="discord">${DISCORD_ICON}DISCORD</button><button class="act ghost" data-a="up">CREATE ACCOUNT</button><button class="act" data-a="in">SIGN IN</button></div></div>`;
  } else {
    const joined = new Date(m.created_at || Date.now()).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const dc = m.discord ? `<span class="dc-pill">${DISCORD_ICON}${esc(m.discord.name || 'Discord')}</span> <a class="lnk" data-a="unlink">unlink</a>` : `<button class="act dc" data-a="link">${DISCORD_ICON}LINK DISCORD</button>`;
    el.innerHTML = `<div class="acct-card"><span class="av lg">${avatarSVG(AV, outfitId)}</span><div><div class="nm">${esc(m.username)}</div><div class="sub"><span class="price"><i class="coin"></i>${(m.coins_total || 0).toLocaleString()} coins earned</span> · rider since ${joined}</div><div class="sub dc-row">${dc}</div><div id="dc-msg" class="sub"></div></div><div class="sp"></div><div class="acct-btns"><button class="act ghost" data-a="avatar">EDIT AVATAR</button><button class="act ghost" data-a="pw">${m.discord ? 'SET PASSWORD' : 'NEW PASSWORD'}</button><button class="act ghost" data-a="out">SIGN OUT</button></div></div>
      <div class="pw-row hidden" id="pw-row"><input id="pw-new" type="password" maxlength="72" placeholder="New password (6+ characters)" autocomplete="new-password"><button class="act" data-a="pwsave">SAVE</button><span id="pw-msg" class="muted small"></span></div>`;
    document.getElementById('pw-new').addEventListener('keydown', e => e.stopPropagation());
  }
  el.onclick = async e => {
    const b = e.target.closest('button,a'); if (!b) return; const a = b.dataset.a, msg = document.getElementById('dc-msg');
    if (a === 'in' || a === 'up') openAuth(a); if (a === 'out') online.logout(); if (a === 'avatar') { gTab = 'avatar'; setTab('garage'); }
    if (a === 'discord') discordFlow(false, b);
    if (a === 'link') { msg.textContent = 'Finish linking in your browser…'; try { await online.discord(true); showPopup('DISCORD LINKED', 'good'); } catch (err) { msg.textContent = online.nice(err); } }
    if (a === 'unlink') { await online.unlinkDiscord(); }
    if (a === 'pw') document.getElementById('pw-row').classList.toggle('hidden');
    if (a === 'pwsave') { const pm = document.getElementById('pw-msg'); try { await online.rpc('si_set_password', { p_token: online.token, p_password: document.getElementById('pw-new').value }); pm.textContent = 'Password saved — you can sign in with your username now.'; document.getElementById('pw-new').value = ''; } catch (err) { pm.textContent = online.nice(err); } }
  };
}

// servers
let hostPrivate = false;
document.getElementById('srv-priv').onclick = e => { const b = e.target.closest('button'); if (!b) return; hostPrivate = b.dataset.v === '1'; document.querySelectorAll('#srv-priv button').forEach(x => x.classList.toggle('sel', x === b)); };
document.getElementById('srv-refresh').onclick = () => refreshServers();
const ZONE_NAME = z => (ZONES[z] && ZONES[z].name) || z;
async function refreshServers() {
  const el = document.getElementById('srv-list');
  if (!online.ON) { el.innerHTML = `<div class="empty">The server list needs the online build. Host one and share the code instead.</div>`; return; }
  try {
    const rows = await online.rpc('si_rooms_list', { p_token: online.token });
    el.innerHTML = rows.length ? rows.map(r => `<div class="li ${r.mine ? 'mine' : r.friend ? 'friendrow' : ''}"><span class="av sm">${avatarSVG(r.host_avatar, r.host_avatar && r.host_avatar.outfit)}</span><div class="grow"><div class="t">${esc(r.name)}${r.private ? '<span class="tag lock">FRIENDS</span>' : '<span class="tag pub">PUBLIC</span>'}</div><div class="s">${esc(r.host)}${r.friend ? ' (friend)' : ''} · ${esc(ZONE_NAME(r.zone))} · code ${r.code}</div></div><span class="s">${r.players}/${r.max}</span>` +
      (r.mine || net.code === r.code ? `<button class="act ghost" disabled>${r.mine ? 'YOURS' : 'IN'}</button>` : `<button class="act blue" data-join="${r.code}">JOIN</button>`) + `</div>`).join('')
      : `<div class="empty">No servers open right now. Host one!</div>`;
  } catch (e) { el.innerHTML = `<div class="empty">${esc(online.nice(e))}</div>`; }
}
document.getElementById('srv-list').onclick = e => { const b = e.target.closest('[data-join]'); if (b) joinServer(b.dataset.join); };
async function joinServer(code) {
  const st = document.getElementById('mp-status');
  let ticket = null;
  if (online.me) {
    try { ticket = (await online.rpc('si_ticket', { p_token: online.token, p_code: code })).ticket; }
    catch (e) { const m = online.nice(e); if (/friends only|full/.test(m)) { st.textContent = m; return; } } // unlisted servers have no ticket: just join by code
  }
  net.join(code, ticket);
}

// friends
async function refreshFriends() {
  const el = document.getElementById('fr-list'), cnt = document.getElementById('fr-count');
  if (!online.me) { el.innerHTML = `<div class="empty">${online.ON ? 'Sign in to add friends, see when they are online and join their servers.' : 'Friends need the online build.'}</div>`; cnt.textContent = ''; return; }
  try {
    const rows = await online.rpc('si_friends_list', { p_token: online.token });
    const fr = rows.filter(r => r.status === 'friend');
    cnt.textContent = fr.length ? `${fr.filter(r => r.online).length} online / ${fr.length}` : '';
    const order = { incoming: 0, friend: 1, outgoing: 2 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (b.online - a.online));
    el.innerHTML = rows.length ? rows.map(r => {
      let right = '';
      if (r.status === 'incoming') right = `<button class="act green" data-acc="${esc(r.username)}">ACCEPT</button><button class="act ghost" data-dec="${esc(r.username)}">✕</button>`;
      else if (r.status === 'outgoing') right = `<span class="s">request sent</span><button class="act ghost" data-rem="${esc(r.username)}">✕</button>`;
      else right = (r.room && net.code !== r.room.code ? `<button class="act blue" data-join="${r.room.code}">JOIN</button>` : '') + (net.code && (!r.room || r.room.code !== net.code) ? `<button class="act ghost" data-inv="${esc(r.username)}" title="Invite to your server">INVITE</button>` : '') + `<button class="mini" data-rem="${esc(r.username)}" title="Remove friend">✕</button>`;
      const sub = r.status === 'incoming' ? 'wants to be friends' : r.status === 'outgoing' ? '' : r.room ? `riding in <b>${esc(r.room.name)}</b> (${r.room.players}/${r.room.max})` : r.online ? 'online' : 'offline';
      return `<div class="li"><span class="online-dot ${r.online ? 'on' : ''}"></span><span class="av sm">${avatarSVG(r.avatar, r.avatar && r.avatar.outfit)}</span><div class="grow"><div class="t">${esc(r.username)}</div><div class="s">${sub}</div></div>${right}</div>`;
    }).join('') : `<div class="empty">No friends yet. Add someone by their username above.</div>`;
  } catch (e) { el.innerHTML = `<div class="empty">${esc(online.nice(e))}</div>`; }
}
{
  const msg = document.getElementById('fr-msg');
  const add = async () => {
    const i = document.getElementById('fr-name'), u = i.value.trim(); if (!u) return;
    if (!online.me) { openAuth('in'); return; }
    try { const r = await online.rpc('si_friend_add', { p_token: online.token, p_username: u }); msg.textContent = { sent: `Friend request sent to ${u}`, accepted: `You and ${u} are now friends`, already_friends: `You're already friends with ${u}`, already_sent: `You already sent ${u} a request` }[r.status]; i.value = ''; refreshFriends(); }
    catch (e) { msg.textContent = online.nice(e); }
  };
  document.getElementById('fr-add').onclick = add;
  document.getElementById('fr-name').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  document.getElementById('fr-list').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.acc) await online.rpc('si_friend_respond', { p_token: online.token, p_username: b.dataset.acc, p_accept: true });
      else if (b.dataset.dec) await online.rpc('si_friend_respond', { p_token: online.token, p_username: b.dataset.dec, p_accept: false });
      else if (b.dataset.rem) await online.rpc('si_friend_remove', { p_token: online.token, p_username: b.dataset.rem });
      else if (b.dataset.join) return joinServer(b.dataset.join);
      else if (b.dataset.inv) { await online.rpc('si_invite', { p_token: online.token, p_username: b.dataset.inv, p_code: net.code }); b.textContent = 'INVITED'; b.disabled = true; msg.textContent = `Invite sent to ${b.dataset.inv}`; return; }
      refreshFriends(); online.beat();
    } catch (err) { msg.textContent = online.nice(err); }
  };
}

// leaderboards
let lbBoard = 'combo', lbScope = 'all';
function renderBoards() {
  const el = document.getElementById('lb-boards');
  el.innerHTML = BOARDS.map(b => `<button data-b="${b.id}" class="${b.id === lbBoard ? 'sel' : ''}">${b.n.toUpperCase()}</button>`).join('');
}
document.getElementById('lb-boards').onclick = e => { const b = e.target.closest('button'); if (!b) return; lbBoard = b.dataset.b; renderBoards(); loadBoard(); };
document.getElementById('lb-scope').onclick = e => { const b = e.target.closest('button'); if (!b) return; lbScope = b.dataset.v; document.querySelectorAll('#lb-scope button').forEach(x => x.classList.toggle('sel', x === b)); loadBoard(); };
async function loadBoard() {
  const el = document.getElementById('lb-list'), meEl = document.getElementById('lb-me'), note = document.getElementById('lb-note');
  const B = BOARDS.find(b => b.id === lbBoard);
  note.textContent = { combo: 'biggest single combo', attack: 'best 2-minute score', hill: 'fastest Hill Bomb run', air: 'longest time in the air', coins: 'coins earned all-time' }[lbBoard];
  meEl.innerHTML = '';
  if (!online.ON) { el.innerHTML = `<div class="empty">Leaderboards need the online build.</div>`; return; }
  if (lbScope === 'friends' && !online.me) { el.innerHTML = `<div class="empty">Sign in to compare with your friends.</div>`; return; }
  el.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const r = await online.rpc('si_leaderboard', { p_board: lbBoard, p_scope: lbScope, p_token: online.token, p_limit: 25 });
    el.innerHTML = r.rows.length ? r.rows.map(x => `<div class="li ${x.me ? 'me' : ''}"><span class="rk">${x.rank}</span><span class="av sm">${avatarSVG(x.avatar, x.avatar && x.avatar.outfit)}</span><div class="grow"><div class="t">${esc(x.username)}</div></div><span class="val">${B.f(x.value)}</span></div>`).join('')
      : `<div class="empty">Nobody on this board yet. Be the first!</div>`;
    if (r.me && !r.rows.some(x => x.me)) meEl.innerHTML = `<div class="li me"><span class="rk">${r.me.rank}</span><span class="av sm">${avatarSVG(AV, outfitId)}</span><div class="grow"><div class="t">You</div></div><span class="val">${B.f(r.me.value)}</span></div>`;
    else if (!online.me) meEl.innerHTML = `<div class="empty">Sign in to get your scores on the board.</div>`;
  } catch (e) { el.innerHTML = `<div class="empty">${esc(online.nice(e))}</div>`; }
}

// avatar editor (garage → AVATAR)
function renderAvatarEditor(el) {
  const btns = (arr, key, label = x => x) => `<div class="chips">${arr.map(v => `<button data-av="${key}:${v}" class="${AV[key] === v ? 'sel' : ''}">${label(v).toUpperCase()}</button>`).join('')}</div>`;
  const dots = (cols, key) => `<div class="dots">${cols.map((c, i) => `<button data-av="${key}:${i}" class="${AV[key] === i ? 'sel' : ''}" style="background:${typeof c === 'number' ? hx(c) : c}"></button>`).join('')}</div>`;
  const dcPic = online.me && online.me.discord && online.me.discord.avatar;
  el.innerHTML = `<div class="av-ed"><div><div class="av-big">${avatarSVG(AV, outfitId)}</div>
    <div class="pic-btns"><label class="act ghost up-btn">UPLOAD PICTURE<input type="file" id="av-file" accept="image/png,image/jpeg,image/webp" hidden></label>${dcPic ? `<button class="act dc" data-pic="discord">${DISCORD_ICON}USE DISCORD PICTURE</button>` : ''}${AV.img ? `<button class="act ghost" data-pic="none">USE DRAWN AVATAR</button>` : ''}</div>
    <div class="av-note">${AV.img ? 'Your picture shows on the leaderboards, friends list and server list. Your rider in the game still uses the head below.' : 'Your avatar shows on the leaderboards, your friends list and in servers. Helmet and clothes colours come from your skin in SKINS.'}</div></div>
    <div class="av-opts">
      <div class="p-head">HEAD</div>${btns(AV_GEAR, 'gear', v => AV_GEAR_N[v])}
      <div class="p-head">SKIN</div>${dots(AV_SKIN, 'skin')}
      <div class="p-head">HAIR</div>${btns(AV_HAIR, 'hair')}${dots(AV_HAIRC, 'hairCol')}
      <div class="p-head">EYES</div>${btns(AV_EYES, 'eyes')}
      <div class="p-head">MOUTH</div>${btns(AV_MOUTH, 'mouth')}
      <div class="p-head">BACKGROUND</div>${dots(AV_BG, 'bg')}
    </div></div>`;
}
// custom pictures: cropped to a square and shrunk so they stay small
function loadPicture(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const c = makeCanvas(112), g = c.getContext('2d'), s = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 112, 112);
    let q = 0.85, d = c.toDataURL('image/jpeg', q); while (d.length > 16000 && q > 0.3) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
    URL.revokeObjectURL(url); AV.img = d; store.set('avatar', AV); renderGarage(); renderMe(); online.saveSoon(800);
  };
  img.src = url;
}
document.querySelector('[data-pane="garage"]').addEventListener('change', e => { if (e.target.id === 'av-file') loadPicture(e.target.files[0]); });
document.querySelector('[data-pane="garage"]').addEventListener('click', e => {
  const b = e.target.closest('[data-pic]'); if (!b) return;
  if (b.dataset.pic === 'discord') AV.img = online.me.discord.avatar; else delete AV.img;
  store.set('avatar', AV); renderGarage(); renderMe(); online.saveSoon(800);
});
function setAvatar(key, v) {
  AV[key] = ['skin', 'hairCol', 'bg'].includes(key) ? +v : v; AV.outfit = outfitId; store.set('avatar', AV);
  applyAvatarLook(); renderGarage(); renderMe(); online.saveSoon(1500);
}
function applyAvatarLook() { me.outfit = null; equipLook(); }
// ── updates: the desktop app downloads new game files by itself and tells us here ──
const GAME_VERSION = '1.5.2';
window.__sendItVersion = v => { const el = document.getElementById('ver-line'); if (el) el.textContent = `Version ${v.game}` + (v.shell !== v.game ? ` (app ${v.shell})` : ''); };
window.__sendItUpdate = info => {
  const el = document.getElementById('update-toast'); if (!el) return;
  if (info.kind === 'ready') el.innerHTML = `<div class="grow"><b>SEND IT ${esc(info.version)} is ready</b><div class="s">${esc(info.notes || 'Restart to play the new version.')}</div></div><button class="act" id="upd-go">RESTART NOW</button><button class="mini" id="upd-x">LATER</button>`;
  else el.innerHTML = `<div class="grow"><b>SEND IT ${esc(info.version)} is out</b><div class="s">This one needs a fresh download.</div></div><button class="act" id="upd-dl">GET IT</button><button class="mini" id="upd-x">LATER</button>`;
  el.classList.remove('hidden');
  const go = document.getElementById('upd-go'); if (go) go.onclick = () => { online.saveSoon(0); setTimeout(() => location.reload(), 400); };
  const dl = document.getElementById('upd-dl'); if (dl) dl.onclick = () => window.open(SITE_URL + '/#download', '_blank');
  document.getElementById('upd-x').onclick = () => el.classList.add('hidden');
};
document.getElementById('ver-line').textContent = 'Version ' + GAME_VERSION;
function renderInvites() {
  const el = document.getElementById('invites'); if (!el) return;
  const list = online.invites.filter(i => i.code !== net.code).slice(0, 3);
  el.innerHTML = list.map(i => `<div class="inv"><span class="av sm">${avatarSVG(i.avatar, i.avatar && i.avatar.outfit)}</span><div class="grow"><b>${esc(i.from)}</b> invited you to <b>${esc(i.name)}</b><div class="s">${i.players}/${i.max} riders</div></div><button class="act blue" data-ij="${i.code}" data-id="${i.id}">JOIN</button><button class="mini" data-ix="${i.id}">✕</button></div>`).join('');
  if (list.length && !renderInvites.seen?.has(list[0].id)) { (renderInvites.seen ||= new Set()).add(list[0].id); sfx.ding(); }
}
document.getElementById('invites').addEventListener('click', e => {
  const j = e.target.closest('[data-ij]'), x = e.target.closest('[data-ix]');
  if (j) { online.dismissInvite(+j.dataset.id); joinServer(j.dataset.ij); }
  if (x) online.dismissInvite(+x.dataset.ix);
});
const inviteLink = code => SITE_URL ? `${SITE_URL}/join.html?code=${code}` : code;
window.copyInvite = () => copyInvite();
async function copyInvite() {
  const code = net.code; if (!code) return;
  const link = inviteLink(code);
  try { await navigator.clipboard.writeText(link); showPopup('INVITE LINK COPIED', 'good', code); addFeed(`Invite link copied: <b>${esc(link)}</b>`); }
  catch { prompt('Copy this invite link', link); }
}
// joining from an invite link: ?join=CODE in the browser version, sendit://join/CODE in the app
window.__joinCode = code => { code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); if (!code) return; if (state === 'play') togglePause(); setTab('online'); document.getElementById('mp-code').value = code; joinServer(code); };
{ const q = new URLSearchParams(location.search).get('join'); if (q) setTimeout(() => window.__joinCode(q), 2500); }
online.on(() => { renderMe(); if (menuTab === 'online') { renderAccount(); refreshServers(); refreshFriends(); } if (menuTab === 'ranks') loadBoard(); renderCash(); renderGarage(); });
setInterval(() => { if (state === 'menu' && menuTab === 'online' && document.visibilityState === 'visible') { refreshServers(); if (online.me) refreshFriends(); } }, 15000);

// sea: ride in and you splash, launch off the pier and it's a trick
function splash(fromAir) {
  const P = player;
  emitDust(P.pos.clone().add(v3(0, 0.2, 0)), 30, 'water', 2.6); emitDust(P.pos.clone(), 20, 'water', 1.2);
  sfx.splash && sfx.splash();
  if (fromAir && P.airStart.z < -215 && Math.abs(P.airStart.x - 40) < 5 && P.airStart.y > 1) {
    scoreAir(P, veh.cfg, 0, 0); addToCombo('Pier Send', 800, 2); endCombo(true); goal('pier');
    showPopup('PIER SEND!', 'good', 'SPLASH');
  } else showPopup('SPLASH!', 'bail', 'TOO DEEP');
  P.bailed = true; P.bailT = 1.1; P.air = false; P.grind = null; P.inWheelie = false; P.wheelie = 0;
  bailVis.rv.set(0, 0, 0); bailVis.rr.set(0, 0, 0); bailVis.bv.set(0, 0, 0); bailVis.br.set(0, 0, 0);
  root.visible = false;
}

// ───────────────────────── trick bar ─────────────────────────
const KEY_LABEL = { J: 'J', K: 'K', L: 'L', I: 'I', U: 'U', O: 'O', SH: 'SHIFT' };
let trickBarT = 0;
function buildTrickBar() {
  const el = document.getElementById('trickbar'); if (!el) return;
  const TK = TRICKS[player.kind];
  el.innerHTML = TRICK_KEYS.filter(k => TK[k]).map(k => `<div data-k="${k}"><b>${KEY_LABEL[k]}</b>${TK[k].n}</div>`).join('') + `<div><b>W/S</b>Flip</div><div><b>A/D</b>Spin</div>`;
  const map = { t1: 'J', t2: 'K', t3: 'L', t4: 'I', t5: 'U', t6: 'O' };
  for (const [id, k] of Object.entries(map)) { const b = document.getElementById('tb-' + id); if (b && TK[k]) b.textContent = TK[k].n.replace('No-Hander', 'NO HAND').replace('Tailwhip', 'WHIP').replace('Barspin', 'BAR').toUpperCase().slice(0, 9); }
  trickBarT = 12;
}
function updateTrickBar(dt) {
  const el = document.getElementById('trickbar'); const P = player;
  trickBarT -= dt;
  const show = state === 'play' && !P.bailed && (P.air || P.grind || trickBarT > 0);
  el.style.bottom = hintHidden ? '24px' : '150px';
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const TK = TRICKS[player.kind];
  for (const d of el.children) {
    const k = d.dataset.k; if (!k) continue; const t = TK[k];
    const on = t.t === 'whip' ? P.whipLeft > 0 && P.whipKey === k : t.t === 'bar' ? P.barLeft > 0 : (P.poses[t.p] || 0) > 0.5;
    d.classList.toggle('on', on);
  }
}

// ───────────────────────── HUD ─────────────────────────
const elSpeed = document.getElementById('speed'), elWM = document.getElementById('wheelie-meter'), elNeedle = elWM.querySelector('.wm-needle'), elZone = elWM.querySelector('.wm-zone');
const mm = document.getElementById('minimap'), mctx = mm.getContext('2d');
const mmBg = (() => {
  const c = makeCanvas(180), g = c.getContext('2d'), s = 180 / (WORLD * 2);
  const tx = x => (x + WORLD) * s, tz = z => (z + WORLD) * s;
  g.fillStyle = '#3b4a30'; g.fillRect(0, 0, 180, 180);
  const col = { road: '#2b2b30', sidewalk: '#6c6a66', park: '#9b9890', dirt: '#7a5a3e', plaza: '#a8a196' };
  for (const r of RECTS) { g.fillStyle = col[r.type] || '#444'; g.fillRect(tx(r.x0), tz(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); }
  g.fillStyle = '#7d7468'; for (const c of colliders) if (c.x1 - c.x0 > 3) g.fillRect(tx(c.x0), tz(c.z0), (c.x1 - c.x0) * s, (c.z1 - c.z0) * s);
  g.fillStyle = '#c9a36b'; for (const r of ramps) { g.fillRect(tx(r.cx) - 1.5, tz(r.cz) - 1.5, 3, 3); }
  return c;
})();
let hudT = 0;
function updateHUD(dt) {
  const P = player;
  const sp = P.air ? Math.hypot(P.vel.x, P.vel.z) : Math.abs(P.v);
  hudT += dt;
  if (hudT > 0.06) { elSpeed.textContent = Math.round(sp * 3.6); hudT = 0; }
  const showW = P.inWheelie && !P.air && !P.bailed;
  elWM.classList.toggle('hidden', !showW);
  if (showW) {
    const C = veh.cfg; const frac = clamp(P.wheelie / C.wbMax, 0, 1);
    elNeedle.style.left = (frac * 100) + '%';
    const z0 = (C.wb - 0.22) / C.wbMax, z1 = (C.wb + 0.22) / C.wbMax;
    elZone.style.left = (z0 * 100) + '%'; elZone.style.width = ((z1 - z0) * 100) + '%';
  }
  if (popTimer > 0) { popTimer -= dt; if (popTimer <= 0) elPop.className = ''; }
  if (goalTimer > 0) { goalTimer -= dt; if (goalTimer <= 0) document.getElementById('goal-toast').className = ''; }
  updateTrickBar(dt);
  if (hintT > 0) { hintT -= dt; if (hintT <= 0 && !hintHidden) { hintHidden = true; document.getElementById('hint').style.display = 'none'; showPopup('', '', 'PRESS H FOR CONTROLS'); } }
  // minimap (rotating, player-centred)
  const s = 180 / (WORLD * 2) * 3.2;
  mctx.save(); mctx.clearRect(0, 0, 180, 180);
  mctx.beginPath(); mctx.arc(90, 90, 90, 0, 7); mctx.clip();
  mctx.translate(90, 90); mctx.rotate(P.yaw + Math.PI); mctx.scale(-1, 1);
  mctx.scale(3.2, 3.2);
  mctx.drawImage(mmBg, -(P.pos.x + WORLD) * (180 / (WORLD * 2)), -(P.pos.z + WORLD) * (180 / (WORLD * 2)));
  const k = 180 / (WORLD * 2);
  for (const Lt of LETTERS) if (!Lt.got) { mctx.fillStyle = '#ffc531'; mctx.beginPath(); mctx.arc((Lt.p.x - P.pos.x) * k, (Lt.p.z - P.pos.z) * k, 1.4, 0, 7); mctx.fill(); }
  for (const r of net.remotes.values()) { if (!r.S) continue; mctx.fillStyle = '#' + r.helmet.toString(16).padStart(6, '0'); mctx.beginPath(); mctx.arc((r.S.x - P.pos.x) * k, (r.S.z - P.pos.z) * k, 2.2, 0, 7); mctx.fill(); }
  mctx.restore();
  mctx.fillStyle = '#ff4d1f'; mctx.beginPath(); mctx.moveTo(90, 80); mctx.lineTo(97, 98); mctx.lineTo(90, 94); mctx.lineTo(83, 98); mctx.fill();
}

// ───────────────────────── menu ─────────────────────────
let state = 'menu';
const elMenu = document.getElementById('menu'), elHUD = document.getElementById('hud'), elTouch = document.getElementById('touch');
function buildMenu() {
  const cards = document.getElementById('vehicle-cards'); cards.innerHTML = '';
  for (const k of VEH_KEYS) {
    const c = VEH[k], d = document.createElement('div'); d.className = 'card' + (k === player.kind ? ' sel' : '');
    const lv = UPGRADES.reduce((t, u) => t + upgLevel(k, u.id), 0);
    d.innerHTML = `<div class="nm">${c.label}${lv ? `<small>UPGRADES ${lv}/25</small>` : ''}</div><div class="ds">${c.desc}</div>` +
      ['SPEED', 'TRICKS', 'WHEELIES'].map((n, i) => `<div class="stat"><span>${n}</span><div class="bar"><i style="width:${c.stats[i] * 100}%"></i></div></div>`).join('');
    d.onclick = () => { equip(k); spawn(zoneFor()); buildMenu(); };
    cards.appendChild(d);
  }
  const zs = document.getElementById('zone-seg'); zs.innerHTML = '';
  for (const [k, n] of [['auto', 'BEST FOR RIDE'], ['street', 'STREET'], ['park', 'SKATEPARK'], ['dirt', 'DIRT JUMPS'], ['mega', 'MEGA RAMP'], ['plaza', 'PLAZA'], ['hill', 'HILL BOMB'], ['beach', 'SEAFRONT'], ['yard', 'YARD']]) {
    const b = document.createElement('button'); b.textContent = n; b.className = player.zone === k ? 'sel' : '';
    b.onclick = () => { player.zone = k; store.set('zone', k); spawn(zoneFor()); buildMenu(); }; zs.appendChild(b);
  }
  const sw = document.getElementById('swatches'); sw.innerHTML = '';
  COLORS.forEach((c, i) => { const b = document.createElement('button'); b.style.background = '#' + c.toString(16).padStart(6, '0'); b.className = i === paintColor ? 'sel' : ''; b.onclick = () => { paintColor = i; store.set('color', i); applyPaint(veh.paint, paintId, c); net.announce(); online.saveSoon(); buildMenu(); }; sw.appendChild(b); });
  const qs = document.getElementById('quality-seg'); qs.innerHTML = '';
  for (const q of ['low', 'medium', 'high']) { const b = document.createElement('button'); b.textContent = q.toUpperCase(); b.className = qualityName === q ? 'sel' : ''; b.onclick = () => { qualityName = q; store.set('quality', q); buildComposer(); spawnLife(); buildMenu(); }; qs.appendChild(b); }
  const ts = document.getElementById('tod-seg'); ts.innerHTML = '';
  for (const t of ['day', 'sunset', 'night']) { const b = document.createElement('button'); b.textContent = t.toUpperCase(); b.className = todName === t ? 'sel' : ''; b.onclick = () => { applyTimeOfDay(t); buildMenu(); }; ts.appendChild(b); }
  const es = document.getElementById('easy-seg'); es.innerHTML = '';
  for (const [v, n] of [[true, 'EASY'], [false, 'PRO']]) { const b = document.createElement('button'); b.textContent = n; b.className = settings.easy === v ? 'sel' : ''; b.title = v ? 'Forgiving landings, auto-balanced grinds and wheelies' : 'Real balance and strict landings'; b.onclick = () => { settings.easy = v; store.set('easy', v); buildMenu(); }; es.appendChild(b); }
  renderGoals();
  if (IS_TOUCH) document.getElementById('controls-lbl').textContent = 'Left stick: ride & steer (in air: flips & spins) · buttons: hop, wheelie, tricks';
  const ms = document.getElementById('music-seg'); ms.innerHTML = '';
  music.STATIONS.forEach((st, i) => { const b = document.createElement('button'); b.textContent = st.name; b.title = st.genre; b.className = music.on && music.station === i ? 'sel' : ''; b.onclick = () => { if (!music.on) music.toggle(true); music.set(i); music.start(); buildMenu(); }; ms.appendChild(b); });
  { const b = document.createElement('button'); b.textContent = 'OFF'; b.className = music.on ? '' : 'sel'; b.onclick = () => { music.toggle(false); buildMenu(); }; ms.appendChild(b); }
  document.getElementById('vol').value = Math.round(music.vol * 100);
  renderCash(); renderGarage(); renderMe(); net.renderLine();
}
const zoneFor = () => player.zone !== 'auto' ? player.zone : ({ bike: 'dirt', ebike: 'mega', scooter: 'park', escooter: 'street' })[player.kind];
document.getElementById('vol').oninput = e => music.volume(e.target.value / 100);
document.getElementById('sfx-vol').value = Math.round(store.get('sfxVol', 0.6) * 100);
document.getElementById('sfx-vol').oninput = e => sfx.setVolume(e.target.value / 100);
document.querySelector('[data-pane="garage"]').addEventListener('click', garageClick);
document.getElementById('attack-btn').onclick = () => { startRide(); startAttack(); };
{
  document.getElementById('mp-host').onclick = () => net.host(document.getElementById('srv-name').value.trim(), hostPrivate);
  document.getElementById('mp-join').onclick = () => joinServer(document.getElementById('mp-code').value.trim().toUpperCase());
  document.getElementById('mp-code').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('mp-join').click(); });
  document.getElementById('mp-leave').onclick = () => net.leave();
  if (!net.HAS) document.getElementById('mp-status').textContent = 'Multiplayer works in the desktop app (and in a normal browser tab), not inside this preview.';
  const chat = document.getElementById('chat'), ci = document.getElementById('chat-input');
  window.openChat = () => { chatOpen = true; chat.classList.remove('hidden'); ci.value = ''; ci.focus(); };
  const closeChat = () => { chatOpen = false; chat.classList.add('hidden'); ci.blur(); };
  ci.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const t = ci.value.trim(); if (t) net.chat(t.slice(0, 80)); closeChat(); } else if (e.key === 'Escape') closeChat(); });
}
function spawnLife() { const q = qualityName; spawnTraffic(q === 'low' ? 6 : q === 'medium' ? 10 : 14); spawnPeds(q === 'low' ? 8 : q === 'medium' ? 14 : 22); }
document.getElementById('ride-btn').onclick = () => startRide();
let hintT = 25;
function startRide() {
  sfx.init(); music.start();
  state = 'play'; elMenu.classList.add('hidden'); elHUD.classList.remove('hidden');
  if (IS_TOUCH) elTouch.classList.remove('hidden');
  camState.init = false;
}
function togglePause() {
  if (state === 'play') { state = 'menu'; elMenu.classList.remove('hidden'); elHUD.classList.add('hidden'); elTouch.classList.add('hidden'); document.getElementById('ride-btn').textContent = 'RESUME'; buildMenu(); }
  else if (state === 'menu') startRide();
}
document.getElementById('pause-btn').onclick = togglePause;

// touch controls
{
  const stick = document.getElementById('stick'), knob = document.getElementById('stick-knob');
  let sid = null;
  const move = (e, t) => { const r = stick.getBoundingClientRect(); let x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2); const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } touch.x = x; touch.y = y; knob.style.transform = `translate(${x * 45}px,${y * 45}px)`; };
  stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; move(e, t); e.preventDefault(); }, { passive: false });
  stick.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === sid) move(e, t); e.preventDefault(); }, { passive: false });
  const end = e => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; touch.x = touch.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
  document.querySelectorAll('#tbtns button').forEach(b => {
    const k = b.dataset.k;
    b.addEventListener('touchstart', e => { touch.btn[k] = true; if (k === 'jump') touch.btn.jumpP = true; b.classList.add('on'); e.preventDefault(); }, { passive: false });
    const up = e => { touch.btn[k] = false; b.classList.remove('on'); e.preventDefault(); };
    b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
  });
}

// ───────────────────────── main loop ─────────────────────────
let last = performance.now(), acc = 0, hintHidden = false, manual = false, clock = 0, timeScale = 1;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (manual) return;
  tick(dt);
  requestAnimationFrame(frame);
}
function tick(dt, doRender = true) {
  clock += dt;
  readInput();
  if (pressed.has('Escape')) togglePause();
  if (state === 'play') {
    if (pressed.has('KeyC')) { camState.mode = (camState.mode + 1) % 3; }
    if (pressed.has('KeyR')) respawnSafe();
    if (pressed.has('KeyH')) { hintHidden = !hintHidden; document.getElementById('hint').style.display = hintHidden ? 'none' : ''; }
    if (pressed.has('KeyM')) showPopup(sfx.toggleMute() ? 'MUTED' : 'SOUND ON');
    if (pressed.has('KeyQ')) { const i = (VEH_KEYS.indexOf(player.kind) + 1) % VEH_KEYS.length; const p = player.pos.clone(), y = player.yaw; equip(VEH_KEYS[i]); spawn(zoneFor()); player.pos.copy(p); player.yaw = y; player.safe.pos.copy(p); showPopup(VEH[VEH_KEYS[i]].label); }
    ['street', 'park', 'dirt', 'mega', 'plaza', 'hill', 'beach', 'yard'].forEach((z, i) => { if (pressed.has('Digit' + (i + 1))) { spawn(z); showPopup(ZONES[z].name); } });
    if (pressed.has('KeyN')) music.next();
    if (pressed.has('KeyT')) { if (net.connected) window.openChat(); else showPopup('CHAT', '', 'join a multiplayer room first'); }
    // slow motion on big airs while you're doing something
    const wantTS = settings.slowmo && player.air && player.maxH > 3.2 && trickActive(player) ? 0.6 : 1;
    timeScale = damp(timeScale, wantTS, 6, dt);
    const sdt = dt * timeScale;
    acc += sdt; const h = 1 / 120; let n = 0;
    while (acc >= h && n < 8) { step(h); input.jump = false; acc -= h; n++; }
    updateVisual(sdt);
    updateHUD(dt);
    updateLetters(dt);
    updateRace(sdt);
    updateAttack(dt);
    music.duck(timeScale);
    if (player.dist > 2000) goal('ride2k');
    const sp = player.air ? Math.hypot(player.vel.x, player.vel.z) : Math.abs(player.v);
    sfx.update(sp, !player.air && !player.bailed, veh.cfg.motor, input.throttle, player.onRamp ? player.onRamp.surface : surfaceAt(player.pos.x, player.pos.z), player.skidding, veh.kind === 'bike' && !input.throttle, dt);
  } else {
    updateVisual(dt);
    sfx.update(0, false, false, 0);
  }
  pressed.clear();
  const ldt = dt * timeScale;
  updateDust(ldt);
  updateSkids();
  updateTraffic(ldt);
  updatePeds(ldt);
  updateNightLights(dt);
  net.update(dt);
  M.sea.normalMap.offset.set(clock * 0.004, clock * 0.009); for (const f of FOAM) f.material.opacity = 0.55 + Math.sin(clock * 1.3) * 0.2;
  for (const f of FLAGS) { const pa = f.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i) + 0.9; pa.setZ(i, Math.sin(clock * 5 + x * 3) * 0.12 * x); } pa.needsUpdate = true; }
  updateCamera(dt, state === 'menu');
  // shadow camera follows player
  sun.position.copy(root.position).addScaledVector(sunDir, 150); sun.target.position.copy(root.position); sun.target.updateMatrixWorld();
  if (su.time) su.time.value += dt;
  grassTime.value += dt;
  if (doRender) composer.render();
}

// ───────────────────────── boot ─────────────────────────
buildComposer();
equip(VEH[player.kind] ? player.kind : 'bike');
spawn(zoneFor());
mergeStatic();
spawnLife();
applyTimeOfDay(TOD[todName] ? todName : 'sunset');
renderLetters();
renderCash();
buildMenu();
setTab('play');
online.restore();
document.getElementById('loading').remove();
requestAnimationFrame(t => { last = t; frame(t); });

// test hook
window.__game = {
  sim(sec, k = {}) { // headless test helper: fixed-step physics with given held keys
    for (const c in keys) keys[c] = false; Object.assign(keys, k);
    const h = 1 / 120, n = Math.round(sec / h), log = [];
    for (let i = 0; i < n; i++) { readInput(); if (i === 0 && k.Space) input.jump = true; else input.jump = false; step(h); if (player.bailed) updateBail(h); if (i % 12 === 0) log.push([+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2), +(player.air ? Math.hypot(player.vel.x, player.vel.z) : player.v).toFixed(2), player.air ? 'A' : player.bailed ? 'X' : 'G', +player.wheelie.toFixed(2)]); }
    for (const c in keys) keys[c] = false;
    updateVisual(1 / 60); camState.init = false; updateCamera(1 / 60, false);
    return log;
  },
  stats() { renderer.info.autoReset = false; renderer.info.reset(); const t0 = performance.now(); composer.render(); const ms = performance.now() - t0; const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ms: Math.round(ms), geos: renderer.info.memory.geometries, objects: (() => { let n = 0; scene.traverse(() => n++); return n; })() }; renderer.info.autoReset = true; return r; },
  manual(on) { manual = on; if (!on) { last = performance.now(); requestAnimationFrame(frame); } },
  tick(dt, k = {}, press = [], r = true) { for (const c in keys) keys[c] = false; Object.assign(keys, k); for (const p of press) pressed.add(p); tick(dt, r); const P = player; return { vy: P.vel.y, air: P.air, at: P.airTime, w: P.wheelie, bailed: P.bailed, x: P.pos.x, y: P.pos.y, z: P.pos.z, v: P.v, flip: P.flip, yaw: P.yaw }; },
  hAt(x, z) { return heightAt(x, z); }, cols: () => colliders,
  tod(t) { applyTimeOfDay(t); },
  online, av: () => AV, net, peds: PEDS, traffic: TRAFFIC,
  place(x, z, yaw) { ZONES._t = { name: '', pos: v3(x, 0, z), yaw }; spawn('_t'); delete ZONES._t; }, music, earn, cashNow: () => cash, race, attack, vehCfg, zones: ZONES, net, settings, goals: () => [...goalsDone], rails: RAILS,
  setQuality(q) { qualityName = q; buildComposer(); },
  look(p, o, c) { if (c != null) { paintColor = c; } if (p) paintId = p; if (o) outfitId = o; equipLook(); },
  fixCam(x, y, z, fov = 50) { camFixed = x == null ? null : { p: v3(x, y, z), fov }; if (x == null) camState.init = false; },
  setCam(x, y, z) { camOverride = x == null ? null : v3(x, y, z); },
  player, input, keys, spawn, equip, startRide, togglePause, get state() { return state; }, camState, VEH, veh: () => veh, score: () => score, combo: () => combo };
