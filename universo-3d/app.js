import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

// =====================================================================
//  CONFIGURACIÓN GLOBAL  (todo personalizable desde el panel)
// =====================================================================
const config = {
  starCount: 12000,
  rotationSpeed: 1.0,      // multiplicador global de velocidad orbital
  bloomStrength: 0.85,
  bloomRadius: 0.5,
  sunColor: '#ffd27a',
  sunSize: 5,
  showOrbits: true,
  showAsteroids: true,
  autoRotate: false,
  shootingStars: true,
  showTrails: true,
  blackHole: true,
  lensingStrength: 0.022,
};

// =====================================================================
//  ESCENA · CÁMARA · RENDERER
// =====================================================================
const canvas = document.getElementById('scene');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x03040a, 0.0007);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 8000);
camera.position.set(0, 70, 160);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.6;     // permite acercarse mucho a objetos pequeños
controls.maxDistance = 2600;
controls.zoomSpeed = 1.15;

// =====================================================================
//  POST-PROCESADO (bloom para que el sol y las estrellas brillen)
// =====================================================================
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// --- Lente gravitacional (deflexión de luz tipo Schwarzschild, aproximada) ---
// La desviación de un rayo de luz es ~ proporcional a 1/distancia al centro
// (ángulo de Einstein α = 4GM/(c²·b)). Aquí se aproxima en espacio de pantalla.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBH:      { value: new THREE.Vector2(0.5, 0.5) }, // pos del AN en pantalla (0..1)
    uRadius:  { value: 0.0 },   // radio del horizonte en unidades de pantalla
    uStrength:{ value: 0.0 },   // intensidad de la deflexión
    uAspect:  { value: innerWidth / innerHeight },
    uActive:  { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uBH; uniform float uRadius; uniform float uStrength;
    uniform float uAspect; uniform float uActive;
    varying vec2 vUv;
    void main(){
      if(uActive < 0.5){ gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 d = vUv - uBH; d.x *= uAspect;
      float dist = length(d);
      float r = uRadius;
      if(dist < r){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; } // horizonte de sucesos
      // deflexión: la luz se curva hacia el centro, ~ r^2/dist^2
      float bend = uStrength * (r*r) / (dist*dist);
      vec2 dir = normalize(d);
      vec2 off = dir * bend; off.x /= uAspect;
      vec3 col = texture2D(tDiffuse, vUv + off).rgb;
      // anillo de fotones (Einstein ring) justo fuera del horizonte
      float ring = smoothstep(r, r*1.5, dist) * (1.0 - smoothstep(r*1.5, r*2.8, dist));
      col += vec3(1.0, 0.78, 0.45) * ring * 1.3;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const lensingPass = new ShaderPass(LensShader);
composer.addPass(lensingPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  config.bloomStrength, config.bloomRadius, 0.0
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// =====================================================================
//  GENERADORES DE TEXTURAS PROCEDURALES (canvas)
// =====================================================================
function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---------- Ruido de valor + fbm (para texturas orgánicas) ----------
function hash2(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, seed, oct = 5) {
  let val = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    val += amp * vnoise(x * freq, y * freq, seed + i * 13.1);
    norm += amp; freq *= 2; amp *= 0.5;
  }
  return val / norm;
}

const _col = new THREE.Color(), _colA = new THREE.Color();
function lerpColor(hexA, hexB, t) {
  _col.set(hexA); _colA.set(hexB);
  return _col.lerp(_colA, t);
}

// ---------- Textura de planeta (fbm sin costura en longitud) ----------
function makePlanetTexture(base, accent, bands = false) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const seed = Math.random() * 1000;
  const dark = lerpColor(base, '#000000', 0.55).clone();
  const baseC = new THREE.Color(base);
  const accC = new THREE.Color(accent);
  const s = bands ? 2.2 : 4.5;

  for (let y = 0; y < H; y++) {
    const lat = (y / H);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      // wrap continuo en longitud usando seno/coseno
      let n = 0.5 * fbm(Math.cos(lon) * s + 10, lat * s, seed)
            + 0.5 * fbm(Math.sin(lon) * s + 20, lat * s, seed);

      let r, g, b;
      if (bands) {
        // Gigante gaseoso: franjas onduladas por el ruido
        const band = Math.sin((lat * 18) + n * 4.0) * 0.5 + 0.5;
        const col = lerpColor(base, accent, band * 0.8 + n * 0.2);
        r = col.r; g = col.g; b = col.b;
      } else {
        // Mundo rocoso: tierra (accent) sobre océano/roca (base)
        const land = n;
        let col;
        if (land < 0.45)      col = baseC.clone().lerp(dark, 0.3);   // bajo
        else if (land < 0.6)  col = baseC.clone().lerp(accC, (land - 0.45) / 0.15 * 0.6);
        else                  col = accC.clone().lerp(baseC, (1 - land) * 0.3);
        // sombreado por relieve
        const shade = 0.75 + n * 0.5;
        r = col.r * shade; g = col.g * shade; b = col.b * shade;
      }
      const i = (y * W + x) * 4;
      img.data[i]   = Math.min(255, r * 255);
      img.data[i+1] = Math.min(255, g * 255);
      img.data[i+2] = Math.min(255, b * 255);
      img.data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- Sprite de estrella redonda y suave ----------
let _starTex = null;
function starTexture() {
  if (_starTex) return _starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _starTex = new THREE.CanvasTexture(c);
  return _starTex;
}

// ---------- Textura de nebulosa procedural (fbm wispy) ----------
function makeNebulaTexture(rgb) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const seed = Math.random() * 1000;
  const sc = 3.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // densidad fbm con caída radial suave
      let d = fbm(x / S * sc, y / S * sc, seed, 6);
      d = Math.pow(d, 2.2);
      const dx = (x - S/2) / (S/2), dy = (y - S/2) / (S/2);
      const fall = Math.max(0, 1 - Math.sqrt(dx*dx + dy*dy));
      const a = d * fall * fall * 255;
      const i = (y * S + x) * 4;
      img.data[i] = rgb[0]; img.data[i+1] = rgb[1]; img.data[i+2] = rgb[2];
      img.data[i+3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function makeGlowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

// =====================================================================
//  CAMPO DE ESTRELLAS
// =====================================================================
let starField;
const starUniforms = {
  uTime: { value: 0 },
  uTex: { value: starTexture() },
  uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
};
function buildStars(count) {
  if (starField) { scene.remove(starField); starField.geometry.dispose(); starField.material.dispose(); }
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pha = new Float32Array(count);
  const palette = [
    new THREE.Color(0xffffff), new THREE.Color(0xaad4ff),
    new THREE.Color(0xffd9a0), new THREE.Color(0xb48bff),
    new THREE.Color(0xff9fb0),
  ];
  for (let i = 0; i < count; i++) {
    const r = rand(400, 2200);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(rand(-1, 1));
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.cos(phi);
    pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    const cc = pick(palette);
    col[i*3] = cc.r; col[i*3+1] = cc.g; col[i*3+2] = cc.b;
    // unas pocas estrellas muy brillantes, la mayoría pequeñas
    siz[i] = Math.random() < 0.04 ? rand(7, 14) : rand(1.5, 4.5);
    pha[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vColor = color;
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + aPhase);
        vTw = tw;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z) * tw;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        if (t.a < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.7 + vTw * 0.6), t.a);
      }`,
  });
  starField = new THREE.Points(geo, mat);
  starField.frustumCulled = false;
  scene.add(starField);
}
buildStars(config.starCount);

// =====================================================================
//  VÍA LÁCTEA (domo de fondo con banda galáctica + polvo)
// =====================================================================
function makeMilkyWayTexture() {
  const W = 1280, H = 640;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#03040a';
  ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const seed = Math.random() * 1000;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // banda galáctica: gaussiana centrada, ondulada por ruido
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const warp = (fbm(u * 4, v * 4, seed, 3) - 0.5) * 0.12;
      const band = Math.exp(-Math.pow((v - 0.5 + warp) / 0.085, 2));
      const clump = fbm(u * 9, v * 18, seed + 5, 4);
      const dust = fbm(u * 14, v * 28, seed + 9, 4);   // bandas oscuras de polvo
      let bright = band * (0.35 + clump * 0.9) * (0.5 + dust * 0.9);
      bright = Math.min(1, bright);
      // color: núcleo cálido, brazos azulados
      const warm = band * band;
      const r = bright * (170 + warm * 70);
      const g = bright * (175 + warm * 30);
      const b = bright * (210 - warm * 40);
      const i = (y * W + x) * 4;
      img.data[i]   = Math.min(255, r);
      img.data[i+1] = Math.min(255, g);
      img.data[i+2] = Math.min(255, b);
      img.data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // estrellas dispersas espolvoreadas encima
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const a = Math.random() * 0.8;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, Math.random() < 0.1 ? 2 : 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const milkyWay = new THREE.Mesh(
  new THREE.SphereGeometry(2500, 64, 64),
  new THREE.MeshBasicMaterial({
    map: makeMilkyWayTexture(), side: THREE.BackSide,
    depthWrite: false, fog: false,
  })
);
milkyWay.rotation.z = 0.4;   // inclina la banda galáctica
milkyWay.renderOrder = -1;
scene.add(milkyWay);

// =====================================================================
//  NEBULOSAS (sprites de color suave)
// =====================================================================
const nebulaPalette = [
  [120, 80, 255], [60, 160, 255], [255, 90, 160],
  [80, 255, 200], [255, 150, 90], [180, 110, 255],
];
const nebulae = [];
// Cada nebulosa = varias capas del mismo color con escalas y rotaciones distintas
for (let i = 0; i < 9; i++) {
  const rgb = pick(nebulaPalette);
  const center = new THREE.Vector3(rand(-1500, 1500), rand(-700, 700), rand(-1500, 1500));
  const layers = 3;
  for (let l = 0; l < layers; l++) {
    const tex = makeNebulaTexture(rgb);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: rand(0.05, 0.12), rotation: Math.random() * Math.PI * 2,
    });
    const sp = new THREE.Sprite(mat);
    const size = rand(500, 1100) * (1 + l * 0.25);
    sp.scale.set(size, size, 1);
    sp.position.copy(center).add(new THREE.Vector3(rand(-120, 120), rand(-120, 120), rand(-120, 120)));
    sp.userData.spin = rand(-0.02, 0.02);
    scene.add(sp);
    nebulae.push(sp);
  }
}

// =====================================================================
//  SOL
// =====================================================================
const sunGroup = new THREE.Group();
const sunGeo = new THREE.IcosahedronGeometry(config.sunSize, 12);
const sunMat = new THREE.MeshBasicMaterial({ color: config.sunColor });
const sun = new THREE.Mesh(sunGeo, sunMat);
sunGroup.add(sun);
const sunGlow = makeGlowSprite(config.sunColor, config.sunSize * 6);
sunGroup.add(sunGlow);
scene.add(sunGroup);

const sunLight = new THREE.PointLight(0xfff0d0, 4, 0, 0.6);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x223044, 0.6));

// =====================================================================
//  PLANETAS
// =====================================================================
const planets = [];
const orbitLines = [];
const trails = [];
const selectable = [];   // objetos que se pueden clicar/enfocar

// --- Física orbital (Kepler): ω ∝ d^(-3/2) ; v = ω·d ∝ d^(-1/2) ---
const KEPLER = 30;        // constante para órbitas planetarias
const MOON_K = 9;         // constante para órbitas lunares
const keplerOmega = (d, k = KEPLER) => k / Math.pow(d, 1.5);

// --- Estela orbital con desvanecimiento ---
function makeTrail(colorHex, max = 180) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  const t = { line, pos, col, max, pts: [], color: new THREE.Color(colorHex) };
  trails.push(t);
  return t;
}
function updateTrail(t, worldPos) {
  t.pts.unshift(worldPos.clone());
  if (t.pts.length > t.max) t.pts.pop();
  const n = t.pts.length;
  for (let i = 0; i < n; i++) {
    const p = t.pts[i];
    t.pos[i*3] = p.x; t.pos[i*3+1] = p.y; t.pos[i*3+2] = p.z;
    const f = 1 - i / n;           // se desvanece hacia la cola
    t.col[i*3] = t.color.r * f; t.col[i*3+1] = t.color.g * f; t.col[i*3+2] = t.color.b * f;
  }
  t.line.geometry.setDrawRange(0, n);
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.geometry.attributes.color.needsUpdate = true;
}

// Halo atmosférico (resplandor en el borde, tipo fresnel)
function atmosphereMaterial(colorHex) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(colorHex) } },
    transparent: true, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = 1.0 - abs(dot(vNormal, vView));
        rim = pow(rim, 3.0);
        gl_FragColor = vec4(uColor, rim);
      }`,
  });
}

const PLANET_PRESETS = [
  { name: 'Ferra',    base: '#b5532e', accent: '#e9a06a', size: 1.6, dist: 18,  speed: 1.6, moons: 0, ring: false, bands: false },
  { name: 'Azura',    base: '#2e6fb5', accent: '#7fd0ff', size: 2.4, dist: 30,  speed: 1.1, moons: 1, ring: false, bands: false },
  { name: 'Verdis',   base: '#2e9d5b', accent: '#caffd9', size: 2.1, dist: 44,  speed: 0.85,moons: 2, ring: false, bands: false },
  { name: 'Tholmus',  base: '#caa15a', accent: '#fff0c0', size: 4.5, dist: 66,  speed: 0.55,moons: 3, ring: true,  bands: true  },
  { name: 'Cyrenia',  base: '#9b6fc4', accent: '#e3c9ff', size: 3.8, dist: 92,  speed: 0.4, moons: 2, ring: true,  bands: true  },
  { name: 'Glacium',  base: '#7fb9d6', accent: '#e6fbff', size: 2.7, dist: 116, speed: 0.28,moons: 1, ring: false, bands: false },
];

function createPlanet(p) {
  const orbit = new THREE.Group();      // gira → produce la traslación
  scene.add(orbit);

  const geo = new THREE.SphereGeometry(p.size, 64, 64);
  const mat = new THREE.MeshStandardMaterial({
    map: makePlanetTexture(p.base, p.accent, p.bands),
    roughness: 0.85, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.x = p.dist;
  orbit.add(mesh);

  // Datos físicos (masa ∝ volumen ∝ r³, en masas terrestres relativas)
  const mass = Math.pow(p.size / 2.0, 3);
  const omega = keplerOmega(p.dist);
  const vorb = omega * p.dist;               // velocidad orbital relativa
  const period = (Math.PI * 2) / omega;      // periodo (en "años" de la sim)
  mesh.userData = {
    type: 'Planeta', name: p.name, dist: p.dist, size: p.size,
    mass, vorb, period, moons: p.moons, focusDist: p.size * 4.5,
    ring: p.ring, bands: p.bands,
  };
  selectable.push(mesh);

  // Halo atmosférico (no debe interceptar los clics)
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(p.size * 1.2, 48, 48),
    atmosphereMaterial(p.accent)
  );
  atmo.raycast = () => {};
  mesh.add(atmo);

  // Inclinación aleatoria del plano orbital para que no sea todo plano
  orbit.rotation.x = rand(-0.15, 0.15);
  orbit.rotation.z = rand(-0.15, 0.15);
  orbit.rotation.y = Math.random() * Math.PI * 2;

  // Anillos
  if (p.ring) {
    const rg = new THREE.RingGeometry(p.size * 1.5, p.size * 2.4, 96);
    const rm = new THREE.MeshBasicMaterial({
      color: p.accent, side: THREE.DoubleSide,
      transparent: true, opacity: 0.55,
    });
    const ring = new THREE.Mesh(rg, rm);
    ring.raycast = () => {};
    ring.rotation.x = Math.PI / 2 + rand(-0.3, 0.3);
    mesh.add(ring);
  }

  // Lunas (órbita Kepleriana alrededor del planeta)
  const moons = [];
  for (let m = 0; m < p.moons; m++) {
    const mr = p.size * rand(0.18, 0.32);
    const mg = new THREE.SphereGeometry(mr, 24, 24);
    const mm = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, roughness: 1 });
    const moon = new THREE.Mesh(mg, mm);
    const md = p.size * rand(2.4, 4.2);
    const mw = keplerOmega(md, MOON_K);
    moon.userData = {
      dist: md, ang: Math.random() * Math.PI * 2, spd: mw, r: mr,
      type: 'Luna', name: `${p.name} · Luna ${m + 1}`,
      parent: p.name, size: mr, vorb: mw * md, focusDist: mr * 6,
    };
    mesh.add(moon);
    moons.push(moon);
    selectable.push(moon);
  }

  // Línea de órbita
  const curve = new THREE.EllipseCurve(0, 0, p.dist, p.dist, 0, Math.PI * 2);
  const pts = curve.getPoints(160).map(pt => new THREE.Vector3(pt.x, 0, pt.y));
  const og = new THREE.BufferGeometry().setFromPoints(pts);
  const om = new THREE.LineBasicMaterial({ color: 0x3a4a66, transparent: true, opacity: 0.5 });
  const line = new THREE.LineLoop(og, om);
  line.rotation.copy(orbit.rotation);
  scene.add(line);
  orbitLines.push(line);

  const trail = makeTrail(p.accent);
  planets.push({ ...p, orbit, mesh, moons, line, omega, trail, angle: Math.random() * Math.PI * 2 });
}
PLANET_PRESETS.forEach(createPlanet);

// Hacer el Sol seleccionable
sun.userData = {
  type: 'Estrella', name: 'Sol (estrella central)',
  size: config.sunSize, mass: 333000, temp: '~5.500 °C',
  focusDist: config.sunSize * 4,
};
selectable.push(sun);

// =====================================================================
//  CINTURÓN DE ASTEROIDES (InstancedMesh)
// =====================================================================
const ASTEROID_COUNT = 1400;
const astGeo = new THREE.DodecahedronGeometry(0.4, 0);
const astMat = new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 1 });
const asteroids = new THREE.InstancedMesh(astGeo, astMat, ASTEROID_COUNT);
const astData = [];
const dummy = new THREE.Object3D();
for (let i = 0; i < ASTEROID_COUNT; i++) {
  const d = rand(132, 152);
  const a = Math.random() * Math.PI * 2;
  const y = rand(-3, 3);
  astData.push({ d, a, y, spd: rand(0.05, 0.12), s: rand(0.4, 1.4) });
  dummy.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
  dummy.scale.setScalar(astData[i].s);
  dummy.updateMatrix();
  asteroids.setMatrixAt(i, dummy.matrix);
}
scene.add(asteroids);

// Proxy para poder enfocar un asteroide concreto (instancia móvil)
const astProxy = new THREE.Object3D();
scene.add(astProxy);
let focusAstId = -1;

// =====================================================================
//  AGUJERO NEGRO (horizonte + disco de acreción con Doppler + anillo de fotones)
// =====================================================================
const BH_R = 6;
const bhGroup = new THREE.Group();
const bhWorldPos = new THREE.Vector3(0, 40, -360);
bhGroup.position.copy(bhWorldPos);
scene.add(bhGroup);

// Horizonte de sucesos (esfera negra perfecta)
const bhHorizon = new THREE.Mesh(
  new THREE.SphereGeometry(BH_R, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0x000000 })
);
bhHorizon.userData = {
  type: 'Agujero negro', name: 'Agujero negro · Keron',
  size: BH_R, mass: 4.1e6, horizon: BH_R, focusDist: BH_R * 7,
};
bhGroup.add(bhHorizon);
selectable.push(bhHorizon);

// Anillo de fotones (luz atrapada justo fuera del horizonte)
const photonRing = new THREE.Mesh(
  new THREE.TorusGeometry(BH_R * 1.06, 0.12, 16, 128),
  new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
);
photonRing.raycast = () => {};
bhGroup.add(photonRing);

// Disco de acreción (shader: gradiente de temperatura + remolino + Doppler beaming)
const diskUniforms = { uTime: { value: 0 }, uOuter: { value: BH_R * 5 } };
const accretionDisk = new THREE.Mesh(
  new THREE.RingGeometry(BH_R * 1.5, BH_R * 5, 180, 8),
  new THREE.ShaderMaterial({
    uniforms: diskUniforms,
    transparent: true, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `
      varying vec2 vP;
      void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uOuter;
      varying vec2 vP;
      void main(){
        float rad = length(vP) / uOuter;          // 0..1
        float ang = atan(vP.y, vP.x);
        // gradiente de temperatura: interior blanco-azulado, exterior rojo
        vec3 hot = vec3(1.0, 0.97, 0.9);
        vec3 mid = vec3(1.0, 0.55, 0.2);
        vec3 cool= vec3(0.65, 0.1, 0.04);
        vec3 col = mix(hot, mid, smoothstep(0.0, 0.45, rad));
        col = mix(col, cool, smoothstep(0.45, 1.0, rad));
        // remolino turbulento (material orbitando)
        float swirl = sin(ang * 3.0 - uTime * 2.5 + rad * 26.0) * 0.5 + 0.5;
        col *= 0.55 + swirl * 0.6;
        // Doppler beaming relativista: un lado (que se acerca) brilla mucho más
        float beaming = 0.35 + 1.15 * (cos(ang) * 0.5 + 0.5);
        col *= beaming;
        float a = smoothstep(0.0, 0.06, rad) * (1.0 - smoothstep(0.82, 1.0, rad));
        gl_FragColor = vec4(col, a);
      }`,
  })
);
accretionDisk.raycast = () => {};
accretionDisk.rotation.x = -1.15;     // inclinado para verlo en perspectiva
bhGroup.add(accretionDisk);

// =====================================================================
//  ESTRELLAS FUGACES
// =====================================================================
const shooters = [];
function spawnShooter() {
  const geo = new THREE.BufferGeometry();
  const start = new THREE.Vector3(rand(-600, 600), rand(100, 400), rand(-600, 600));
  const dir = new THREE.Vector3(rand(-1, 1), rand(-0.6, -0.2), rand(-1, 1)).normalize();
  const end = start.clone().add(dir.clone().multiplyScalar(80));
  geo.setFromPoints([start, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
  const line = new THREE.Line(geo, mat);
  line.userData = { dir, life: 1 };
  scene.add(line);
  shooters.push(line);
}

// =====================================================================
//  INTERACCIÓN: clic en planeta → panel de info
// =====================================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const infoBox = document.getElementById('planet-info');
let downXY = null;

// ---------- Sistema de enfoque de cámara ----------
let focusObj = null, focusApproach = 0;
const focusPrev = new THREE.Vector3();
const _wp = new THREE.Vector3();

function focusOn(obj, info, focusDist) {
  focusObj = obj;
  focusObj.userData._focusDist = focusDist || 10;
  focusApproach = 1;
  obj.getWorldPosition(focusPrev);
  showInfo(info);
}
function clearFocus() {
  focusObj = null; focusApproach = 0; focusAstId = -1;
  controls.minDistance = 0.6;
  infoBox.classList.add('hidden');
}

canvas.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  if (moved > 6) return;  // fue un arrastre, no un clic
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const objHits = raycaster.intersectObjects(selectable, false)
    .filter(h => h.object !== bhHorizon || bhGroup.visible);
  const astHits = asteroids.visible ? raycaster.intersectObject(asteroids, false) : [];

  let pick = objHits[0] || null;
  let viaAst = false;
  if (astHits.length && (!pick || astHits[0].distance < pick.distance)) {
    pick = astHits[0]; viaAst = true;
  }
  if (!pick) { clearFocus(); return; }

  if (viaAst) {
    const id = pick.instanceId;
    focusAstId = id;
    const a = astData[id];
    astProxy.position.set(Math.cos(a.a) * a.d, a.y, Math.sin(a.a) * a.d);
    focusOn(astProxy, asteroidInfo(id), a.s * 5 + 2.5);
  } else {
    focusAstId = -1;
    const o = pick.object;
    focusOn(o, buildInfo(o.userData), o.userData.focusDist);
  }
});

// ---------- Panel de información dinámico ----------
const piRows = document.getElementById('pi-rows');
function showInfo(info) {
  document.getElementById('pi-name').textContent = info.name;
  piRows.innerHTML = '';
  for (const [k, v] of info.rows) {
    const row = document.createElement('div'); row.className = 'pi-row';
    const s = document.createElement('span'); s.textContent = k;
    const b = document.createElement('b'); b.textContent = v;
    row.append(s, b); piRows.append(row);
  }
  infoBox.classList.remove('hidden');
}
function buildInfo(u) {
  if (u.type === 'Planeta') {
    return { name: `🪐 ${u.name}`, rows: [
      ['Tipo', u.bands ? 'Gigante gaseoso' : 'Rocoso'],
      ['Distancia al Sol', u.dist.toFixed(0) + ' u'],
      ['Radio', u.size.toFixed(1) + ' R⊕'],
      ['Masa', u.mass.toFixed(2) + ' M⊕'],
      ['Vel. orbital', u.vorb.toFixed(2) + ' u/s'],
      ['Periodo orbital', u.period.toFixed(1) + ' s-sim'],
      ['Lunas', String(u.moons)],
    ]};
  }
  if (u.type === 'Luna') {
    return { name: `🌙 ${u.name}`, rows: [
      ['Orbita a', u.parent],
      ['Radio', u.size.toFixed(2) + ' R⊕'],
      ['Dist. al planeta', u.dist.toFixed(1) + ' u'],
      ['Vel. orbital', u.vorb.toFixed(2) + ' u/s'],
    ]};
  }
  if (u.type === 'Estrella') {
    return { name: `☀️ ${u.name}`, rows: [
      ['Tipo', 'Estrella (secuencia ppal.)'],
      ['Radio', u.size.toFixed(1) + ' u'],
      ['Masa', u.mass.toLocaleString('es') + ' M⊕'],
      ['Temp. superficie', u.temp],
    ]};
  }
  if (u.type === 'Agujero negro') {
    return { name: `🕳️ ${u.name}`, rows: [
      ['Tipo', 'Singularidad (Schwarzschild)'],
      ['Masa', (u.mass / 1e6).toFixed(1) + ' millones M☉'],
      ['Radio horizonte', u.horizon.toFixed(1) + ' u'],
      ['Luz', 'curvada por gravedad'],
    ]};
  }
  return { name: u.name || 'Objeto', rows: [] };
}
function asteroidInfo(id) {
  const a = astData[id];
  const w = keplerOmega(a.d) * a.d;
  return { name: `🪨 Asteroide #${id}`, rows: [
    ['Tipo', 'Roca del cinturón'],
    ['Tamaño', (a.s).toFixed(2) + ' u'],
    ['Dist. al Sol', a.d.toFixed(0) + ' u'],
    ['Vel. orbital', w.toFixed(2) + ' u/s'],
  ]};
}

// =====================================================================
//  PANEL DE CONTROL (lil-gui)
// =====================================================================
const gui = new GUI({ title: '⚙ Personalizar universo' });

const gUni = gui.addFolder('Universo');
gUni.add(config, 'rotationSpeed', 0, 4, 0.05).name('Velocidad órbitas');
gUni.add(config, 'starCount', 1000, 40000, 500).name('Nº estrellas')
    .onFinishChange(v => buildStars(v));
gUni.add(config, 'autoRotate').name('Auto-rotar cámara')
    .onChange(v => controls.autoRotate = v);
gUni.add(config, 'shootingStars').name('Estrellas fugaces');

const gSun = gui.addFolder('Sol');
gSun.addColor(config, 'sunColor').name('Color').onChange(v => {
  sun.material.color.set(v);
  sunGlow.material.map.dispose();
  const ng = makeGlowSprite(v, config.sunSize * 6);
  sunGlow.material = ng.material;
});
gSun.add(config, 'sunSize', 2, 12, 0.5).name('Tamaño').onChange(v => {
  sun.scale.setScalar(v / 5);
  sunGlow.scale.set(v * 6, v * 6, 1);
});

const gFx = gui.addFolder('Efectos');
gFx.add(config, 'bloomStrength', 0, 3, 0.05).name('Brillo (bloom)')
   .onChange(v => bloomPass.strength = v);
gFx.add(config, 'bloomRadius', 0, 1, 0.05).name('Radio brillo')
   .onChange(v => bloomPass.radius = v);
gFx.add(config, 'showOrbits').name('Ver órbitas')
   .onChange(v => orbitLines.forEach(l => l.visible = v));
gFx.add(config, 'showTrails').name('Ver estelas')
   .onChange(v => trails.forEach(t => t.line.visible = v));
gFx.add(config, 'showAsteroids').name('Cinturón asteroides')
   .onChange(v => asteroids.visible = v);

const gBH = gui.addFolder('Agujero negro');
gBH.add(config, 'blackHole').name('Visible')
   .onChange(v => { bhGroup.visible = v; });
gBH.add(config, 'lensingStrength', 0, 0.08, 0.002).name('Lente gravitacional');

const actions = {
  randomizar() {
    planets.forEach(p => {
      const nb = new THREE.Color().setHSL(Math.random(), rand(0.4, 0.8), rand(0.4, 0.6));
      const na = new THREE.Color().setHSL(Math.random(), rand(0.4, 0.8), rand(0.6, 0.8));
      p.mesh.material.map.dispose();
      p.mesh.material.map = makePlanetTexture('#' + nb.getHexString(), '#' + na.getHexString(), p.bands);
      p.mesh.material.needsUpdate = true;
    });
  },
  vistaLibre() {
    clearFocus();
    camera.position.set(0, 70, 160);
    controls.target.set(0, 0, 0);
  },
  vistaSuperior() {
    clearFocus();
    camera.position.set(0, 320, 1);
    controls.target.set(0, 0, 0);
  },
  irAlAgujeroNegro() {
    config.blackHole = true; bhGroup.visible = true;
    focusOn(bhHorizon, buildInfo(bhHorizon.userData), bhHorizon.userData.focusDist);
  },
};
gui.add(actions, 'randomizar').name('🎨 Recolorar planetas');
gui.add(actions, 'irAlAgujeroNegro').name('🕳️ Ir al agujero negro');
gui.add(actions, 'vistaSuperior').name('🔭 Vista superior');
gui.add(actions, 'vistaLibre').name('🛰 Vista libre (deseleccionar)');

// =====================================================================
//  BUCLE DE ANIMACIÓN
// =====================================================================
const clock = new THREE.Clock();
let shooterTimer = 0;
const _tmp = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  // Sol
  sun.rotation.y += dt * 0.1;
  const pulse = 1 + Math.sin(t * 1.5) * 0.03;
  sunGlow.scale.set(config.sunSize * 6 * pulse, config.sunSize * 6 * pulse, 1);

  // Planetas (órbita Kepleriana: ω ∝ d^-3/2)
  planets.forEach(p => {
    p.angle += dt * p.omega * config.rotationSpeed;
    p.orbit.rotation.y = p.angle;
    p.mesh.rotation.y += dt * 0.4;
    // Lunas
    p.moons.forEach(m => {
      m.userData.ang += dt * m.userData.spd * config.rotationSpeed;
      m.position.set(
        Math.cos(m.userData.ang) * m.userData.dist,
        Math.sin(m.userData.ang * 0.5) * m.userData.dist * 0.2,
        Math.sin(m.userData.ang) * m.userData.dist
      );
    });
    // Estela orbital
    if (config.showTrails) { p.mesh.getWorldPosition(_tmp); updateTrail(p.trail, _tmp); }
  });

  // Asteroides
  if (asteroids.visible) {
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const a = astData[i];
      a.a += dt * keplerOmega(a.d) * config.rotationSpeed;
      dummy.position.set(Math.cos(a.a) * a.d, a.y, Math.sin(a.a) * a.d);
      dummy.rotation.set(a.a * 2, a.a * 3, 0);
      dummy.scale.setScalar(a.s);
      dummy.updateMatrix();
      asteroids.setMatrixAt(i, dummy.matrix);
    }
    asteroids.instanceMatrix.needsUpdate = true;
    if (focusAstId >= 0) {
      const a = astData[focusAstId];
      astProxy.position.set(Math.cos(a.a) * a.d, a.y, Math.sin(a.a) * a.d);
    }
  }

  // Agujero negro
  if (bhGroup.visible) {
    diskUniforms.uTime.value = t;
    accretionDisk.rotation.z += dt * 0.05;
    photonRing.rotation.z += dt * 0.2;
  }

  // Estrellas: rotación lenta del fondo + parpadeo (twinkle)
  if (starField) starField.rotation.y += dt * 0.004;
  starUniforms.uTime.value = t;

  // Nebulosas: deriva rotacional muy lenta
  for (const n of nebulae) n.material.rotation += dt * n.userData.spin;

  // Estrellas fugaces
  if (config.shootingStars) {
    shooterTimer += dt;
    if (shooterTimer > 1.4) { shooterTimer = 0; if (Math.random() > 0.4) spawnShooter(); }
  }
  for (let i = shooters.length - 1; i >= 0; i--) {
    const s = shooters[i];
    s.position.add(s.userData.dir.clone().multiplyScalar(dt * 220));
    s.userData.life -= dt * 0.8;
    s.material.opacity = Math.max(0, s.userData.life);
    if (s.userData.life <= 0) {
      scene.remove(s); s.geometry.dispose(); s.material.dispose();
      shooters.splice(i, 1);
    }
  }

  // --- Lente gravitacional: proyecta el AN a pantalla y ajusta el shader ---
  if (bhGroup.visible && config.lensingStrength > 0) {
    _tmp.copy(bhWorldPos).project(camera);            // NDC
    const inFront = _tmp.z < 1;
    if (inFront) {
      lensingPass.uniforms.uBH.value.set(_tmp.x * 0.5 + 0.5, _tmp.y * 0.5 + 0.5);
      // radio del horizonte en pantalla: proyecta un punto en el borde
      _wp.copy(bhWorldPos).addScaledVector(
        new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), BH_R);
      _wp.project(camera);
      const rx = (_wp.x * 0.5 + 0.5) - (_tmp.x * 0.5 + 0.5);
      const ry = (_wp.y * 0.5 + 0.5) - (_tmp.y * 0.5 + 0.5);
      const aspect = innerWidth / innerHeight;
      lensingPass.uniforms.uRadius.value = Math.hypot(rx * aspect, ry);
      lensingPass.uniforms.uAspect.value = aspect;
      lensingPass.uniforms.uStrength.value = config.lensingStrength;
      lensingPass.uniforms.uActive.value = 1;
    } else {
      lensingPass.uniforms.uActive.value = 0;
    }
  } else {
    lensingPass.uniforms.uActive.value = 0;
  }

  // --- Seguimiento de cámara sobre el objeto enfocado ---
  if (focusObj) {
    focusObj.getWorldPosition(_wp);
    // sigue la traslación del objeto manteniéndolo centrado
    _tmp.copy(_wp).sub(focusPrev);
    camera.position.add(_tmp);
    controls.target.add(_tmp);
    focusPrev.copy(_wp);
    if (focusApproach > 0) {
      controls.target.lerp(_wp, 0.15);
      const fd = focusObj.userData._focusDist || 10;
      _tmp.copy(camera.position).sub(controls.target);
      if (_tmp.lengthSq() < 1e-6) _tmp.set(0, 0.4, 1);
      _tmp.normalize().multiplyScalar(fd).add(_wp);
      camera.position.lerp(_tmp, 0.12);
      controls.minDistance = Math.max(0.4, fd * 0.2);
      if (camera.position.distanceTo(_tmp) < fd * 0.1) focusApproach = 0;
    }
  }

  controls.update();
  composer.render();
}
animate();

// Tecla Esc: salir del enfoque
addEventListener('keydown', e => { if (e.key === 'Escape') clearFocus(); });

// =====================================================================
//  RESIZE + LOADER
// =====================================================================
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

const loader = document.getElementById('loader');
setTimeout(() => loader.classList.add('done'), 900);
setTimeout(() => loader.remove(), 1800);
