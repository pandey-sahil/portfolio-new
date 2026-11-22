import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { gsap } from 'gsap';

/* The night desk in 3D. A MacBook by a window over a city at night; around it a pixel LED clock, an iced coffee, an
   ivy against the window grille, a glass mushroom lamp, a succulent, headphones, fairy lights and a purple LED strip.
   The layout and the camera were measured off the inspiration image (the camera fitted to its laptop to about 10 px).
   three.js draws the room with bloom; the live SAHIL/OS screen (real HTML) sits on the MacBook's display through
   CSS3DRenderer. World units are metres; the origin is the middle of the laptop's base on the desk, +z to the viewer.

   Assets: MacBook "Macbook Pro 13 inch 2020" by timblewee (Sketchfab, CC BY 4.0); Potted Plant 02 from Poly Haven
   (CC0); the city is Note Thanun's photo on Unsplash. Everything else is built here. */

export const SCREEN_PX = { w: 1100, h: 688 };
const SCREEN_M = { w: 0.286, h: 0.179 }; // the display, in metres
const PX_TO_M = SCREEN_M.w / SCREEN_PX.w;
const LID_OPEN = THREE.MathUtils.degToRad(112);
const MAT = 0.003; // the desk mat's thickness

// the camera fitted to the inspiration image's laptop
const FIT = { pos: new THREE.Vector3(-0.036, 0.362, 0.428), yaw: -1.36, pitch: -27.76, vfov: 54.3, hfov: 41.98 };

// the city photo hangs far off and low outside the window; the backdrop and the drops on the glass both use this
const CITY = { pos: new THREE.Vector3(-0.6, -0.8, -7), w: 13, h: 13 / 1.5 };
const CITY_GRADE = /* glsl */ `
  vec3 cityGrade(vec3 raw, vec2 uv) {
    float lum = dot(raw, vec3(0.299, 0.587, 0.114));
    float sky = smoothstep(0.4, 0.62, uv.y);
    vec3 c = raw * 0.2;
    c = mix(c * vec3(0.8, 0.85, 1.15), c * vec3(0.45, 0.62, 1.5) + vec3(0.004, 0.008, 0.032), sky);
    float lit = smoothstep(0.14, 0.45, lum) * (1.0 - sky);
    c += vec3(1.0, 0.82, 0.55) * lum * lit * 0.45;
    return c + vec3(0.006, 0.009, 0.02);
  }`;

export interface Stage {
  setLevel(level: number, duration: number): void;
  prepareIntro(): void;
  openLid(duration: number): void;
  setPower(on: boolean): void;
  screenScale(): number;
}

type View = { pos: THREE.Vector3; target: THREE.Vector3; fov: number };

const std = (color: string, roughness = 0.85, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

const shadows = (o: THREE.Object3D, cast = true, receive = true) =>
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });

export async function createStage(scene$: HTMLElement): Promise<Stage | null> {
  const screenEl = document.getElementById('screen');
  const powerEl = document.querySelector<HTMLElement>('.monitor-power');
  if (!screenEl || !powerEl) return null;

  let gl: THREE.WebGLRenderer;
  try {
    gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [mac, ivy] = await Promise.all([
    loader.loadAsync('/models/macbook.glb').then((g) => g.scene),
    loader.loadAsync('/models/desk/potted_plant_02.glb').then((g) => g.scene),
  ]);

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  gl.setSize(W(), H());
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.domElement.className = 'stage-gl';
  gl.domElement.setAttribute('aria-hidden', 'true');

  const css = new CSS3DRenderer();
  css.setSize(W(), H());
  css.domElement.className = 'stage-css';
  scene$.prepend(css.domElement);
  scene$.prepend(gl.domElement);

  RectAreaLightUniformsLib.init();
  const world = new THREE.Scene();
  world.background = new THREE.Color('#04050a');
  const pmrem = new THREE.PMREMGenerator(gl);
  world.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  world.environmentIntensity = 0.05;

  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.01, 60);

  /* ---- the laptop, with the live screen and the power key on it ---- */
  const laptop = buildLaptop(mac);
  world.add(laptop.group);
  // The HTML goes in a scene of its own, 1000 times bigger, seen by a copy of the camera moved out 1000 times as far:
  // the same picture, but in metres the screen sits a fraction of a css pixel from the eye, and at numbers that
  // small the browser stops finding clicks on parts of it.
  const K = 1000;
  const cssScene = new THREE.Scene();
  const cssCam = new THREE.PerspectiveCamera();
  const scaleK = new THREE.Matrix4().makeScale(K, K, K);
  const mount = (el: HTMLElement, at: THREE.Object3D) => {
    const obj = new CSS3DObject(el);
    obj.matrixAutoUpdate = false;
    cssScene.add(obj);
    return () => obj.matrix.multiplyMatrices(scaleK, at.matrixWorld);
  };
  const screenAt = new THREE.Object3D();
  screenAt.scale.setScalar(PX_TO_M);
  laptop.anchor.add(screenAt);
  const powerAt = new THREE.Object3D();
  powerAt.scale.setScalar(PX_TO_M);
  powerAt.rotation.x = -Math.PI / 2;
  powerAt.position.set(0.1275, 0.0034, 0.018);
  laptop.hinge.add(powerAt);
  const syncs = [mount(screenEl, screenAt), mount(powerEl, powerAt)];
  const renderCss = () => {
    syncs.forEach((f) => f());
    cssCam.copy(camera);
    cssCam.position.multiplyScalar(K);
    cssCam.near *= K;
    cssCam.far *= K;
    cssCam.updateProjectionMatrix();
    cssCam.updateMatrixWorld();
    css.render(cssScene, cssCam);
  };

  // the display washes the keys amber
  const screenLight = new THREE.RectAreaLight('#ffb347', 0.6, SCREEN_M.w, SCREEN_M.h);
  screenLight.position.set(0, 0, 0.003);
  screenLight.rotation.y = Math.PI;
  laptop.anchor.add(screenLight);

  /* ---- the room and its things ---- */
  const room = buildRoom();
  world.add(room.group);
  const place = (o: THREE.Object3D, x: number, z: number, yaw = 0, scale = 1) => {
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    o.scale.setScalar(scale);
    shadows(o);
    world.add(o);
    return o;
  };
  ivy.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m) return;
    m.roughness = Math.max(m.roughness, 0.55);
    if (/(^|_)pot($|_|\.|\d)/i.test(o.name)) Object.assign(m, { map: null, needsUpdate: true }), m.color.set('#6d6965');
  });
  place(ivy, -0.29, -0.27, 0.6, 0.17);
  const pixelClock = buildPixelClock();
  place(pixelClock.group, -0.215, -0.1, 0.38);
  place(buildIcedCoffee(), -0.235, 0.05, 0.4);
  place(buildSucculent(), 0.198, -0.17, 0.3);
  place(buildHeadphones(), 0.285, -0.02, -0.55);
  const lamp = buildMushroomLamp();
  place(lamp.group, 0.285, -0.265, 0);

  /* ---- light: the night outside, the lamp, the LED strip, the fairy lights, the screen ---- */
  world.add(new THREE.HemisphereLight('#33477e', '#0b0806', 0.55));
  const cityGlow = new THREE.DirectionalLight('#7891d8', 0.55);
  cityGlow.position.set(-0.7, 1.3, -2.4);
  world.add(cityGlow);

  /* ---- post: bloom, so the lights glow the way they do in a photo ---- */
  const composer = new EffectComposer(gl);
  composer.addPass(new RenderPass(world, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.55, 0.5, 0.88));
  composer.addPass(new OutputPass());

  /* ---- camera framings: 0 the screen, 1 the image's view of the desk, 2 a step back ---- */
  const deg = THREE.MathUtils.degToRad;
  const forward = (yaw: number, pitch: number) => new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(deg(pitch), deg(yaw), 0, 'YXZ'));
  const vfovFor = (hfov: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(deg(hfov) / 2) / camera.aspect));
  const views = (): View[] => {
    const wide = camera.aspect > 1;
    // 0: square on to the display, filling the view
    const centre = laptop.anchor.localToWorld(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(laptop.anchor.matrixWorld);
    const fov0 = 30;
    const fit = (w: number, h: number, fov: number) => {
      const t = Math.tan(deg(fov) / 2);
      return Math.max(h / 2 / t, w / 2 / (t * camera.aspect));
    };
    const d0 = fit(SCREEN_M.w + 0.03, SCREEN_M.h + 0.012, fov0);
    // 1: the inspiration image's own camera; on a wide screen its middle band, at the image's width
    const pitch1 = wide ? -25.5 : FIT.pitch;
    const fov1 = wide ? vfovFor(FIT.hfov) : FIT.vfov;
    // on a wide screen a step back from the image's camera, so the things on the desk show around the laptop
    const p1 = FIT.pos.clone().addScaledVector(forward(FIT.yaw, pitch1), wide ? -0.1 : 0);
    const t1 = p1.clone().add(forward(FIT.yaw, pitch1).multiplyScalar(0.6));
    // 2: back and up from there, the whole desk and the window
    const back = forward(FIT.yaw, -30);
    const p2 = FIT.pos.clone().addScaledVector(back, -0.34).add(new THREE.Vector3(0.0, 0.04, 0));
    const fov2 = wide ? vfovFor(62) : 60;
    return [
      { pos: centre.clone().addScaledVector(normal, d0), target: centre, fov: fov0 },
      { pos: p1, target: t1, fov: fov1 },
      { pos: p2, target: p2.clone().add(back), fov: fov2 },
    ];
  };

  const cam = { px: 0, py: 0, pz: 1, tx: 0, ty: 0, tz: 0, fov: 40 };
  const apply = (v: View) => Object.assign(cam, { px: v.pos.x, py: v.pos.y, pz: v.pos.z, tx: v.target.x, ty: v.target.y, tz: v.target.z, fov: v.fov });
  let level = 1;
  world.updateMatrixWorld(true);
  apply(views()[level]);

  /* ---- a little drift with the pointer ---- */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / W()) * 2 - 1;
    pointer.y = (e.clientY / H()) * 2 - 1;
  });

  /* ---- loop ---- */
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => {
    const was = running;
    running = document.visibilityState === 'visible';
    if (running && !was) requestAnimationFrame(frame);
  });
  function frame() {
    if (!running) return;
    const t = clock.getElapsedTime();
    const k = reduced.matches ? 0 : 1;
    pointer.sx += (pointer.x * k - pointer.sx) * 0.05;
    pointer.sy += (pointer.y * k - pointer.sy) * 0.05;
    const sway = 0.012 * (level === 0 ? 0.3 : 1);
    camera.position.set(cam.px + pointer.sx * sway, cam.py - pointer.sy * sway * 0.5, cam.pz);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    room.tick(t, k);
    lamp.tick(t, k);
    pixelClock.tick();
    composer.render();
    renderCss();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    gl.setSize(W(), H());
    composer.setSize(W(), H());
    css.setSize(W(), H());
    gsap.killTweensOf(cam);
    apply(views()[level]);
  });

  const lid = { angle: LID_OPEN };
  // the HTML screen always draws over the canvas, so it only shows once the lid is open far enough to face us
  const setLid = () => {
    laptop.lid.rotation.x = -lid.angle;
    screenEl.style.visibility = lid.angle > THREE.MathUtils.degToRad(75) ? '' : 'hidden';
  };
  const glow = { v: 1 };
  const setGlow = () => {
    laptop.setDisplayGlow(glow.v);
    screenLight.intensity = 0.6 * glow.v;
  };

  return {
    setLevel(next, duration) {
      level = next;
      const v = views()[level];
      const to = { px: v.pos.x, py: v.pos.y, pz: v.pos.z, tx: v.target.x, ty: v.target.y, tz: v.target.z, fov: v.fov };
      gsap.killTweensOf(cam);
      if (duration === 0 || reduced.matches) Object.assign(cam, to);
      else gsap.to(cam, { ...to, duration, ease: 'power3.inOut' });
    },
    prepareIntro() {
      lid.angle = THREE.MathUtils.degToRad(3);
      setLid();
      glow.v = 0;
      setGlow();
    },
    openLid(duration) {
      gsap.to(lid, { angle: LID_OPEN, duration, ease: 'power2.inOut', onUpdate: setLid });
    },
    setPower(on) {
      gsap.to(glow, { v: on ? 1 : 0, duration: on ? 0.8 : 0.25, onUpdate: setGlow });
    },
    screenScale() {
      return screenEl.getBoundingClientRect().width / screenEl.offsetWidth || 1;
    },
  };
}

/* ---------- the MacBook ---------- */

// The lid is the node "lid", pivoting on the hinge at its origin; shut, the display faces down, its centre 2.8 mm
// above and 106 mm in front of the hinge, which sits at (-0.0001, 0.0082, -0.104) in the file.
function buildLaptop(mac: THREE.Object3D) {
  const lid = mac.getObjectByName('lid');
  if (!lid) throw new Error('no lid');
  const s = lid.scale.x;
  const anchor = new THREE.Object3D();
  anchor.position.set(0, (0.0028 - 0.0004) / s, 0.106 / s);
  anchor.scale.setScalar(1 / s);
  anchor.rotation.x = Math.PI / 2;
  lid.add(anchor);
  lid.rotation.x = -LID_OPEN;

  let display: THREE.MeshStandardMaterial | null = null;
  mac.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m) return;
    if (m.name === 'display') (display = m), m.color.set('#000000');
    if (m.name === 'aluminium') Object.assign(m, { metalness: 0.55, roughness: 0.55 }), m.color.set('#6c6f78');
    if (m.name === 'logo') Object.assign(m, { metalness: 0.7, roughness: 0.35 }), m.color.set('#8a8d94');
    if (m.name === 'Black_Glass') m.roughness = 0.3;
    if (m.name === 'Black_Plastic') Object.assign(m, { roughness: 0.85, metalness: 0 });
    if (m.name === 'Keys' || m.name === 'Keys.001') Object.assign(m, { roughness: 0.88, metalness: 0 }), m.color.set('#202024');
    if (m.name === 'Material.001') m.roughness = 0.5;
  });
  shadows(mac);
  mac.position.set(0.0001, -0.0082, 0.104); // the hinge onto the hinge group's origin

  const hinge = new THREE.Group();
  hinge.add(mac);
  addStickers(hinge);
  hinge.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mac);
  hinge.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + MAT, -0.105);
  const group = new THREE.Group();
  group.add(hinge);
  const glowColor = new THREE.Color('#ffae00');
  return {
    group,
    hinge,
    lid,
    anchor,
    setDisplayGlow(v: number) {
      if (!display) return;
      display.emissive.copy(glowColor);
      display.emissiveIntensity = 0.25 * v;
    },
  };
}

/* ---------- stickers on the palm rest, our own designs ---------- */

function addStickers(laptop: THREE.Object3D) {
  const make = (w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = Math.round((256 * h) / w);
    const g = c.getContext('2d')!;
    draw(g, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    return m;
  };
  const disc = (g: CanvasRenderingContext2D, W: number, fill: string) => {
    g.fillStyle = '#f6f1e8';
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 16, 0, Math.PI * 2);
    g.fill();
  };
  // a pixel heart
  const heart = make(0.03, 0.03, (g, W) => {
    disc(g, W, '#1b1622');
    g.fillStyle = '#ff5c8a';
    const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
    const p = 18;
    const x0 = W / 2 - 3.5 * p;
    const y0 = W / 2 - 3 * p;
    rows.forEach((r, y) => [...r].forEach((v, x) => v === '1' && g.fillRect(x0 + x * p, y0 + y * p, p - 2, p - 2)));
  });
  // a camera on a blue disc
  const cam = make(0.032, 0.032, (g, W) => {
    disc(g, W, '#3f5fae');
    g.fillStyle = '#e6a35a';
    g.beginPath();
    g.roundRect(W * 0.24, W * 0.36, W * 0.52, W * 0.34, 14);
    g.fill();
    g.fillStyle = '#2a1c10';
    g.beginPath();
    g.arc(W / 2, W * 0.53, W * 0.12, 0, Math.PI * 2);
    g.fill();
  });
  // an amber smiley
  const smile = make(0.03, 0.03, (g, W) => {
    disc(g, W, '#ffc233');
    g.fillStyle = '#2a1a06';
    g.beginPath();
    g.arc(W * 0.38, W * 0.42, 11, 0, Math.PI * 2);
    g.arc(W * 0.62, W * 0.42, 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a1a06';
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(W / 2, W * 0.5, W * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
  });
  // "ship it"
  const ship = make(0.042, 0.022, (g, W, H) => {
    g.fillStyle = '#f6f1e8';
    g.beginPath();
    g.roundRect(2, 2, W - 4, H - 4, H / 2);
    g.fill();
    g.fillStyle = '#ff6a3d';
    g.beginPath();
    g.roundRect(12, 12, W - 24, H - 24, (H - 24) / 2);
    g.fill();
    g.fillStyle = '#fff6ea';
    g.font = 'bold 44px "Avenir Next", Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SHIP IT', W / 2, H / 2 + 2);
  });
  const y = 0.0072; // the deck's top, above the hinge
  heart.position.set(-0.112, y, 0.182);
  heart.rotation.z = 0.3;
  cam.position.set(-0.078, y, 0.162);
  smile.position.set(0.085, y, 0.16);
  ship.position.set(0.116, y, 0.186);
  ship.rotation.z = -0.3;
  laptop.add(heart, cam, smile, ship);
}

/* ---------- the room ---------- */

function buildRoom() {
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();

  /* the desk, dark slate, and a felt mat under the laptop */
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 1.4), std('#363c4e', 0.78));
  desk.position.set(0, -0.02, 0.35);
  desk.receiveShadow = true;
  group.add(desk);
  const matShape = new THREE.Shape();
  const mw = 0.66;
  const md = 0.33;
  const r = 0.02;
  matShape.moveTo(-mw / 2 + r, -md / 2);
  matShape.lineTo(mw / 2 - r, -md / 2);
  matShape.quadraticCurveTo(mw / 2, -md / 2, mw / 2, -md / 2 + r);
  matShape.lineTo(mw / 2, md / 2 - r);
  matShape.quadraticCurveTo(mw / 2, md / 2, mw / 2 - r, md / 2);
  matShape.lineTo(-mw / 2 + r, md / 2);
  matShape.quadraticCurveTo(-mw / 2, md / 2, -mw / 2, md / 2 - r);
  matShape.lineTo(-mw / 2, -md / 2 + r);
  matShape.quadraticCurveTo(-mw / 2, -md / 2, -mw / 2 + r, -md / 2);
  const mat = new THREE.Mesh(new THREE.ExtrudeGeometry(matShape, { depth: MAT, bevelEnabled: false }), std('#1c1d23', 1));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0, 0.02);
  mat.receiveShadow = true;
  group.add(mat);

  /* the window wall, close behind the laptop: a wide opening, a mullion, a fine grille on the left pane, a wall to
     the right (measured off the inspiration image through the fitted camera) */
  const wallZ = -0.33;
  const depth = 0.1;
  const open = { x0: -1.2, x1: 0.183, y0: 0.0, y1: 0.9 };
  const wallMat = std('#8f7a63', 0.95);
  const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    return b;
  };
  block(open.x1, 1.6, -0.04, 1.6, wallZ - depth, wallZ, wallMat);
  block(-1.6, 1.6, open.y1, 1.6, wallZ - depth, wallZ, wallMat);
  block(-1.6, open.x0, -0.04, 1.6, wallZ - depth, wallZ, wallMat);
  const frameMat = std('#23242a', 0.55, 0.35);
  const glassZ = -0.36;
  block(-0.081, -0.023, open.y0, open.y1, glassZ - 0.03, glassZ + 0.02, std('#a08566', 0.7));
  block(0.14, open.x1, open.y0, open.y1, glassZ - 0.02, glassZ + 0.015, frameMat);
  block(open.x0, open.x1, open.y0, open.y0 + 0.012, glassZ - 0.02, wallZ, frameMat);
  block(0.152, 0.158, 0.17, 0.3, glassZ + 0.015, glassZ + 0.03, std('#9a9ca3', 0.35, 0.8));
  const gz = glassZ - 0.025;
  const cell = 0.022;
  const gx1 = -0.081;
  const nV = Math.floor((gx1 - open.x0) / cell);
  const nH = Math.floor((open.y1 - open.y0) / cell);
  const grille = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('#15161b', 0.6, 0.3), nV + nH);
  let gi = 0;
  const mid = (open.y0 + open.y1) / 2;
  for (let i = 1; i <= nV; i++)
    grille.setMatrixAt(gi++, m4.compose(new THREE.Vector3(gx1 - i * cell, mid, gz), new THREE.Quaternion(), new THREE.Vector3(0.0016, open.y1 - open.y0, 0.0016)));
  for (let j = 1; j <= nH; j++)
    grille.setMatrixAt(gi++, m4.compose(new THREE.Vector3((open.x0 + gx1) / 2, open.y0 + j * cell, gz), new THREE.Quaternion(), new THREE.Vector3(gx1 - open.x0, 0.0016, 0.0016)));
  group.add(grille);

  /* the city below, through rain: the window looks down on it from a high floor. Seen through wet glass it is soft,
     its lights opening into round blobs (bright samples weigh more, as in a lens), its sky deep and hazy, a few
     windows blinking. CITY_GRADE is shared with the drops on the glass, which see the same city sharp. */
  const cityTex = new THREE.TextureLoader().load('/images/room/night-city.jpg');
  cityTex.colorSpace = THREE.SRGBColorSpace;
  const cityU = { uTex: { value: cityTex }, uTime: { value: 0 } };
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.w, CITY.h),
    new THREE.ShaderMaterial({
      uniforms: cityU,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uTime; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        ${CITY_GRADE}
        void main(){
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 24; i++) {
            float a = float(i) * 2.39996;
            float r = 0.0062 * sqrt((float(i) + 0.5) / 24.0);
            vec3 s = texture2D(uTex, vUv + vec2(cos(a), sin(a) * 1.5) * r).rgb;
            float l = dot(s, vec3(0.299, 0.587, 0.114));
            float w = 1.0 + 4.0 * l * l * l;
            acc += s * w;
            wsum += w;
          }
          vec3 raw = acc / wsum;
          vec3 c = cityGrade(raw, vUv);
          float lum = dot(raw, vec3(0.299, 0.587, 0.114));
          float lit = smoothstep(0.14, 0.45, lum) * (1.0 - smoothstep(0.4, 0.62, vUv.y));
          vec2 cell = floor(vUv * vec2(160.0, 110.0));
          float blink = step(0.985, hash(cell)) * step(0.5, fract(uTime * 0.07 + hash(cell + 3.1)));
          c -= c * lit * blink * 0.8;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  backdrop.position.copy(CITY.pos);
  group.add(backdrop);

  /* rain falling past the window: soft streaks, as a camera sees them, most faint, a few catching the light, warmer
     near the lamp, fading into the distance */
  const rainU = { uTime: { value: 0 } };
  const N = 1400;
  const quad = new THREE.PlaneGeometry(1, 1);
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.index = quad.index;
  rainGeo.setAttribute('position', quad.getAttribute('position'));
  rainGeo.setAttribute('uv', quad.getAttribute('uv'));
  const aPos = new Float32Array(N * 3);
  const aMove = new Float32Array(N * 3); // speed, length, brightness
  for (let i = 0; i < N; i++) {
    aPos.set([-1.7 + Math.random() * 2.5, -2 + Math.random() * 3, -0.42 - Math.pow(Math.random(), 1.6) * 2.6], i * 3);
    aMove.set([1.5 + Math.random() * 0.9, 0.045 + Math.random() * 0.05, 0.15 + Math.pow(Math.random(), 3) * 0.85], i * 3);
  }
  rainGeo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  rainGeo.setAttribute('aMove', new THREE.InstancedBufferAttribute(aMove, 3));
  rainGeo.instanceCount = N;
  const rain = new THREE.Mesh(
    rainGeo,
    new THREE.ShaderMaterial({
      uniforms: rainU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; attribute vec3 aPos; attribute vec3 aMove; varying vec2 vUv; varying vec3 vCol;
        void main(){
          float y = mod(aPos.y - uTime * aMove.x + 2.0, 3.0) - 2.0;
          vec3 c = vec3(aPos.x, y, aPos.z);
          float dist = distance(c, cameraPosition);
          float w = max(0.0009, dist * 0.0016); // never thinner than about a pixel, so it doesn't flicker
          float energy = 0.0009 / w;
          vec3 p = c + vec3(position.x * w + position.y * aMove.y * 0.12, position.y * aMove.y, 0.0);
          float near = exp(-(-aPos.z - 0.42) * 0.9);
          vec3 cool = vec3(0.55, 0.65, 0.9);
          vec3 warm = vec3(1.0, 0.78, 0.5);
          vCol = mix(cool, warm, smoothstep(-0.2, 0.25, aPos.x) * near) * aMove.z * (0.25 + 0.75 * near) * energy;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vCol;
        void main(){
          float across = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
          float along = sin(3.14159 * vUv.y);
          gl_FragColor = vec4(vCol * across * along * 0.6, 1.0);
        }`,
    }),
  );
  rain.frustumCulled = false;
  group.add(rain);

  /* drops on the glass. Each is a tiny lens: the ray through it bends and lands somewhere else on the city, so a drop
     holds a sharp, flipped little picture of the lights behind it, with a dark rim and a pin of lamp light. Some sit
     and slowly dry, some run down and leave a wet trail. */
  const pane = { x0: open.x0, x1: open.x1, y0: open.y0 + 0.012, y1: open.y1 };
  const wetU = { uTime: rainU.uTime, uTex: { value: cityTex }, uCity: { value: new THREE.Vector4(CITY.pos.x, CITY.pos.y, CITY.pos.z, 0) } };
  const wet = new THREE.Mesh(
    new THREE.PlaneGeometry(pane.x1 - pane.x0, pane.y1 - pane.y0),
    new THREE.ShaderMaterial({
      uniforms: wetU,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uTex; uniform vec4 uCity; varying vec3 vW;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        ${CITY_GRADE}
        // what a drop shows: the view ray, bent by the drop's surface, carried on to the city
        vec3 throughDrop(vec2 n) {
          vec3 d = normalize(vW - cameraPosition);
          d = normalize(vec3(d.xy - n * 0.55, d.z));
          float t = (uCity.z - vW.z) / d.z;
          vec3 q = vW + d * t;
          vec2 uv = vec2((q.x - uCity.x) / ${CITY.w.toFixed(3)} + 0.5, (q.y - uCity.y) / ${CITY.h.toFixed(3)} + 0.5);
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.01, 0.015, 0.03);
          return cityGrade(texture2D(uTex, uv).rgb, uv);
        }
        vec4 drop(vec2 d, float r, float stretch) {
          if (r <= 0.0) return vec4(0.0);
          vec2 q = d / vec2(r, r * stretch);
          float l = length(q);
          if (l > 1.0) return vec4(0.0);
          vec2 n = q * sqrt(l);                       // steeper toward the edge, like a bead of water
          vec3 col = throughDrop(n) * 1.5 + 0.012;
          col *= 1.0 - smoothstep(0.6, 1.0, l) * 0.55; // the darker rim
          float hl = smoothstep(0.32, 0.0, length(q - vec2(0.35, 0.45)));
          col += vec3(1.0, 0.78, 0.5) * hl * 0.5;      // the lamp, up and to the right
          float a = smoothstep(1.0, 0.82, l);
          return vec4(col, a);
        }
        void main(){
          vec2 P = vW.xy;
          vec4 col = vec4(0.0);
          // sitting drops: they land, then slowly dry
          float cell = 0.0105;
          vec2 id = floor(P / cell);
          vec2 f = fract(P / cell) - 0.5;
          float h = hash(id);
          if (h > 0.62) {
            vec2 off = (vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5) * 0.45;
            float life = fract(uTime * 0.035 + h * 7.0);
            float r = (0.1 + 0.2 * hash(id + 3.7)) * smoothstep(0.0, 0.03, life) * (1.0 - smoothstep(0.8, 1.0, life));
            col = drop((f - off) * cell, r * cell, 1.0);
          }
          // runners: now and then a drop grows heavy and goes, in lurches: a quick slide, a stop, another slide,
          // wobbling side to side, leaving a line of tiny beads behind it
          float colW = 0.03;
          float ci = floor(P.x / colW);
          float hc = hash(vec2(ci, 9.0));
          if (hc > 0.35) {
            float top = ${pane.y1.toFixed(3)};
            float span = top - ${pane.y0.toFixed(3)} + 0.12;
            // one lurch per unit of sx; the pace wavers but never runs backwards
            float sx = uTime * (0.35 + 0.5 * hc) + 0.3 * sin(uTime * 0.7 + hc * 9.0) + hc * 17.0;
            float k = floor(sx);
            float moving = smoothstep(0.0, 1.0, clamp(fract(sx) * 2.2, 0.0, 1.0)); // slides, then sits
            float dist = (k + moving) * (0.014 + 0.02 * hc);
            float y = top - mod(dist, span);
            float wob = 0.0018;
            float xAt = (ci + 0.3 + 0.4 * hash(vec2(ci, 2.0))) * colW;
            float x = xAt + sin(y * 60.0 + hc * 10.0) * wob;
            float big = 0.0024 + 0.0014 * hc;
            vec4 run = drop(P - vec2(x, y - big * 0.25), big, 1.3);
            col = mix(col, run, run.a);
            col.a = max(col.a, run.a);
            // the trail: beads left along the path above, fading as they dry
            float above = P.y - y;
            if (above > big && above < 0.09) {
              float tx = xAt + sin(P.y * 60.0 + hc * 10.0) * wob;
              float bead = 0.004;
              float bi = floor(P.y / bead);
              float hb = hash(vec2(ci, bi));
              if (hb > 0.45) {
                vec2 bc = vec2(tx, (bi + 0.5) * bead);
                vec4 b = drop(P - bc, (0.18 + 0.2 * hash(vec2(bi, ci))) * bead * (1.0 - above / 0.09), 1.0);
                col = mix(col, b, b.a);
                col.a = max(col.a, b.a);
              }
              float wet = smoothstep(0.0005, 0.0, abs(P.x - tx)) * smoothstep(0.09, 0.0, above);
              col = max(col, vec4(vec3(0.3, 0.36, 0.5) * wet, wet * 0.08));
            }
          }
          gl_FragColor = col;
          #include <colorspace_fragment>
        }`,
    }),
  );
  wet.position.set((pane.x0 + pane.x1) / 2, (pane.y0 + pane.y1) / 2, glassZ - 0.004);
  group.add(wet);

  /* a purple LED strip along the foot of the window, glowing up the frame and the grille */
  const ledColor = new THREE.Color('#8f5cff');
  const led = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: ledColor.clone().multiplyScalar(2.2), toneMapped: false }));
  led.position.set(-0.4, 0.014, wallZ + 0.004);
  group.add(led);
  const ledLight = new THREE.RectAreaLight(ledColor, 5, 1.0, 0.02);
  ledLight.position.set(-0.4, 0.016, wallZ + 0.006);
  ledLight.rotation.x = Math.PI / 2; // shining up
  group.add(ledLight);
  const ledWash = new THREE.RectAreaLight(ledColor, 1.4, 1.0, 0.02);
  ledWash.position.set(-0.4, 0.016, wallZ + 0.006);
  ledWash.rotation.x = Math.PI; // and out over the desk
  group.add(ledWash);

  /* fairy lights: down the wall beside the window, and a few at the clock's foot */
  const strand = [
    [0.198, 0.42], [0.2, 0.357], [0.199, 0.327], [0.197, 0.3], [0.204, 0.264], [0.21, 0.23], [0.215, 0.194], [0.217, 0.161],
    [0.218, 0.129], [0.224, 0.101], [0.226, 0.064], [0.227, 0.037], [0.212, 0.018], [0.2, 0.01],
  ].map(([x, y]) => new THREE.Vector3(x, y, -0.31));
  const foot = [[-0.17, 0.012, -0.17], [-0.155, 0.02, -0.15], [-0.18, 0.03, -0.19], [-0.145, 0.008, -0.13]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const pts = [...strand, ...foot];
  const fairy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0037, 12, 10), new THREE.MeshBasicMaterial({ toneMapped: false }), pts.length);
  const warm = new THREE.Color('#ffc878');
  const tmp = new THREE.Color();
  const phase = pts.map((_, i) => (i * 2.399) % (Math.PI * 2));
  pts.forEach((p, i) => {
    fairy.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
    fairy.setColorAt(i, tmp.copy(warm).multiplyScalar(3));
  });
  group.add(fairy);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strand), 160, 0.0006, 4), std('#15120e', 0.6)));
  const fLights = [new THREE.Vector3(0.21, 0.3, -0.29), new THREE.Vector3(0.22, 0.1, -0.29), new THREE.Vector3(-0.16, 0.03, -0.15)].map((p, i) => {
    const l = new THREE.PointLight('#ffb867', i === 2 ? 0.12 : 0.18, 0.35, 1.6);
    l.position.copy(p);
    group.add(l);
    return l;
  });

  return {
    group,
    tick(t: number, k: number) {
      cityU.uTime.value = t * k;
      rainU.uTime.value = t;
      for (let i = 0; i < pts.length; i++) fairy.setColorAt(i, tmp.copy(warm).multiplyScalar(2.4 + Math.sin(t * 1.6 * k + phase[i]) * 0.9 * k));
      fairy.instanceColor!.needsUpdate = true;
      fLights.forEach((l, i) => (l.intensity = (i === 2 ? 0.12 : 0.18) + Math.sin(t * 1.3 * k + i) * 0.02 * k));
      // the LED strip breathes, slowly
      ledLight.intensity = 5 + Math.sin(t * 0.6 * k) * 0.8 * k;
    },
  };
}

/* ---------- a glass mushroom lamp ---------- */

function buildMushroomLamp() {
  const group = new THREE.Group();
  const glass = (glow: number) =>
    std('#c9ad86', 0.45, 0, { emissive: new THREE.Color('#ff9a3c'), emissiveIntensity: glow, transparent: true, opacity: 0.96 });
  const capMat = glass(0.15);
  const stemMat = glass(0.09);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.01, 48), stemMat);
  base.position.y = 0.005;
  group.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.024, 0.115, 40), stemMat);
  stem.position.y = 0.0675;
  group.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.072, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.scale.y = 0.72;
  cap.position.y = 0.122;
  group.add(cap);
  const under = new THREE.Mesh(new THREE.CircleGeometry(0.072, 64), capMat);
  under.rotation.x = Math.PI / 2;
  under.position.y = 0.122;
  group.add(under);
  const bulb = new THREE.PointLight('#ffa552', 0.3, 0.8, 1.7);
  bulb.position.y = 0.14;
  group.add(bulb);
  const pool = new THREE.SpotLight('#ffb062', 0.5, 0.8, 1.05, 0.9, 1.8);
  pool.position.set(0, 0.118, 0);
  pool.target.position.set(-0.1, -0.2, 0.1);
  pool.castShadow = true;
  pool.shadow.mapSize.set(1024, 1024);
  pool.shadow.bias = -0.0005;
  pool.shadow.radius = 6;
  group.add(pool, pool.target);
  return {
    group,
    tick(t: number, k: number) {
      capMat.emissiveIntensity = 0.15 + Math.sin(t * 0.5 * k) * 0.015 * k;
    },
  };
}

/* ---------- a pixel LED clock, showing Bhopal time ---------- */

const DIGITS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

function buildPixelClock() {
  const group = new THREE.Group();
  const w = 0.1;
  const h = 0.05;
  const d = 0.032;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std('#141418', 0.55, 0.2));
  body.position.y = h / 2 + 0.004;
  group.add(body);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.004, d * 0.9), std('#0c0c0f', 0.7));
  foot.position.y = 0.002;
  group.add(foot);
  const cols = 32;
  const rows = 14;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 224;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.84), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(0, h / 2 + 0.004, d / 2 + 0.0005);
  group.add(face);
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' });
  let shown = '';
  const draw = (text: string, colon: boolean) => {
    const cw = c.width / cols;
    const ch = c.height / rows;
    g.fillStyle = '#050403';
    g.fillRect(0, 0, c.width, c.height);
    const lit = new Set<string>();
    let x = 3;
    for (const chr of text) {
      if (chr === ':') {
        if (colon) {
          lit.add(`${x},5`);
          lit.add(`${x},8`);
        }
        x += 2;
        continue;
      }
      DIGITS[chr]?.forEach((row, ry) => [...row].forEach((v, rx) => v === '1' && lit.add(`${x + rx},${ry + 3}`)));
      x += 6;
    }
    for (let yy = 0; yy < rows; yy++)
      for (let xx = 0; xx < cols; xx++) {
        const on = lit.has(`${xx},${yy}`);
        g.fillStyle = on ? '#ffb000' : '#1d1407';
        g.beginPath();
        g.arc((xx + 0.5) * cw, (yy + 0.5) * ch, cw * (on ? 0.4 : 0.3), 0, Math.PI * 2);
        g.fill();
      }
    tex.needsUpdate = true;
  };
  return {
    group,
    tick() {
      const now = new Date();
      const text = fmt.format(now);
      const colon = now.getSeconds() % 2 === 0;
      const key = text + colon;
      if (key === shown) return;
      shown = key;
      draw(text, colon);
    },
  };
}

/* ---------- an iced coffee ---------- */

function buildIcedCoffee() {
  const g = new THREE.Group();
  const H = 0.078;
  const cupProfile = [[0, 0], [0.019, 0], [0.02, 0.002], [0.026, H], [0.0245, H]].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(
    new THREE.LatheGeometry(cupProfile, 48),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, transparent: true, opacity: 0.22, side: THREE.DoubleSide, clearcoat: 1 }),
  );
  g.add(cup);
  // coffee below, milk swirling on top
  const layer = (y0: number, y1: number, color: string) => {
    const r0 = 0.0185 + (y0 / H) * 0.0055;
    const r1 = 0.0185 + (y1 / H) * 0.0055;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 40), std(color, 0.5));
    m.position.y = (y0 + y1) / 2;
    g.add(m);
  };
  layer(0.002, 0.036, '#3b2214');
  layer(0.036, 0.05, '#7a5233');
  layer(0.05, 0.062, '#c9a37c');
  const ice = new THREE.MeshPhysicalMaterial({ color: '#eef6ff', roughness: 0.15, transparent: true, opacity: 0.45, clearcoat: 1 });
  [[0.006, 0.064, 0.004, 0.4], [-0.008, 0.066, -0.002, 1.1], [0.002, 0.061, -0.01, 2]].forEach(([x, y, z, a]) => {
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.011, 0.012), ice);
    cube.position.set(x, y, z);
    cube.rotation.set(a, a * 0.7, a * 0.3);
    g.add(cube);
  });
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.12, 12), std('#9fd3b0', 0.6));
  straw.position.set(0.006, 0.07, 0.002);
  straw.rotation.z = -0.22;
  straw.rotation.x = 0.1;
  g.add(straw);
  return g;
}

/* ---------- a succulent rosette in a concrete pot ---------- */

function buildSucculent() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [0.03, 0], [0.034, 0.004], [0.036, 0.05], [0.032, 0.05], [0.03, 0.044], [0, 0.044]].map(([x, y]) => new THREE.Vector2(x, y)), 48),
    std('#8d8a86', 0.95),
  );
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.031, 32), std('#2b2219', 1));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.045;
  g.add(soil);
  const leafGeo = new THREE.SphereGeometry(1, 16, 10);
  const leafMat = std('#6f9b6a', 0.6, 0, { emissive: new THREE.Color('#0b1408') });
  [
    { n: 9, r: 0.022, len: 0.02, tilt: 1.15, y: 0.05 },
    { n: 7, r: 0.013, len: 0.017, tilt: 0.75, y: 0.055 },
    { n: 5, r: 0.006, len: 0.012, tilt: 0.35, y: 0.06 },
  ].forEach((ring, k) => {
    for (let i = 0; i < ring.n; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.scale.set(ring.len * 0.55, ring.len * 0.22, ring.len);
      leaf.position.set(0, ring.len * 0.35, ring.r);
      leaf.rotation.x = -(Math.PI / 2 - ring.tilt) * 0.6;
      const pivot = new THREE.Group();
      pivot.position.y = ring.y;
      pivot.rotation.y = (i / ring.n) * Math.PI * 2 + k * 0.4;
      pivot.add(leaf);
      g.add(pivot);
    }
  });
  return g;
}

/* ---------- over-ear headphones, lying on the desk ---------- */

function buildHeadphones() {
  const g = new THREE.Group();
  const shell = std('#e8e5de', 0.55, 0.05);
  const cushion = std('#cfcac0', 0.95);
  const metal = std('#b9bcc4', 0.3, 0.9);
  const span = 0.068;
  [-1, 1].forEach((side) => {
    const cup = new THREE.Group();
    cup.position.set(side * span, 0, 0);
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.026, 48), shell);
    outer.position.y = 0.024;
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.008, 16, 40), cushion);
    pad.rotation.x = Math.PI / 2;
    pad.position.y = 0.008;
    cup.add(outer, pad);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.05), metal);
    arm.position.set(0, 0.03, -0.045);
    cup.add(arm);
    g.add(cup);
  });
  const band = new THREE.Mesh(new THREE.TorusGeometry(span, 0.007, 14, 64, Math.PI), shell);
  band.rotation.x = -Math.PI / 2;
  band.position.set(0, 0.012, -0.07);
  band.scale.set(1, 0.85, 1);
  g.add(band);
  return g;
}
