import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { gsap } from 'gsap';

/* The night desk in 3D. A MacBook by a window over a city at night; around it a pixel LED clock, a mug of coffee, an
   a succulent in a concrete pot, an arc desk lamp, an AirPods case, a mechanical keyboard, a mouse, books, a charging pad,
   a notebook, headphones on a stand and a purple LED strip, on a walnut desk on legs; shelves above it with books, a
   monstera and a sleeping cat.
   The layout and the camera were measured off the inspiration image (the camera fitted to its laptop to about 10 px).
   three.js draws the room with bloom; the live SAHIL/OS screen (real HTML) sits on the MacBook's display through
   CSS3DRenderer. World units are metres; the origin is the middle of the laptop's base on the desk, +z to the viewer.

   Assets: MacBook "Macbook Pro 13 inch 2020" by timblewee (Sketchfab, CC BY 4.0); the city is Note Thanun's photo on
   Unsplash. Everything else is built here. */

export const SCREEN_PX = { w: 1100, h: 688 };
const SCREEN_M = { w: 0.286, h: 0.179 }; // the display, in metres
const PX_TO_M = SCREEN_M.w / SCREEN_PX.w;
const LID_OPEN = THREE.MathUtils.degToRad(112);
const MAT = 0.003; // the desk mat's thickness
const FLOOR = -0.75; // the floor, a desk's height below its top

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
    gl = new THREE.WebGLRenderer({ antialias: true });
    gl.localClippingEnabled = true; // the AirPods case's lid is cut from its shell
  } catch {
    return null;
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // the poster is drawn in the site's pixel font
  await document.fonts.load('92px Silkscreen').catch(() => {});
  const glb = (name: string) => loader.loadAsync(name).then((g) => g.scene);
  const [mac, calathea, pictureFrame, lampModel, mouseModel] = await Promise.all([
    glb('/models/macbook.glb'),
    glb('/models/room/calathea_orbifolia_01.glb'),
    glb('/models/room/standing_picture_frame_01.glb'),
    glb('/models/room/lamp.glb'),
    glb('/models/room/mouse.glb'),
    ]);

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  gl.setSize(W(), H());
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.15;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  // nothing that casts a shadow moves except the lid, so the shadow maps are drawn once and again only when it does
  gl.shadowMap.autoUpdate = false;
  gl.shadowMap.needsUpdate = true;
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
  world.environmentIntensity = 0.1;

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
  const cityTex = await new THREE.TextureLoader().loadAsync('/images/room/night-city.jpg');
  cityTex.colorSpace = THREE.SRGBColorSpace;
  const room = buildRoom(cityTex, blurOnce(gl, cityTex));
  world.add(room.group);
  const place = (o: THREE.Object3D, x: number, z: number, yaw = 0, scale = 1) => {
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    o.scale.setScalar(scale);
    shadows(o);
    world.add(o);
    return o;
  };
  // a succulent by the window
  place(buildSucculent({ leaf: '#7aa695', rings: [11, 9, 7, 4], twist: 0.9 }), -0.285, -0.255, 1.1, 1.3);
  const pixelClock = buildPixelClock();
  pixelClock.group.userData.interact = 'clock';
  place(pixelClock.group, -0.215, -0.1, 0.38);
  const mug = buildMug();
  mug.group.userData.interact = 'mug';
  place(mug.group, -0.232, 0.05, 2.4);
  const airpods = buildAirPods();
  place(airpods.group, 0.25, 0.1, -0.3);
  airpods.group.position.y = MAT;
  airpods.sync();
  const keyboard = buildKeyboard();
  place(keyboard.group, 0.0, 0.205, 0.0);
  const keyGlow = buildKeyGlow(mac);
  keyGlow.mesh.userData.noAO = true;
  world.add(keyGlow.mesh);
  const held = new Set<string>();
  const onKey = (e: KeyboardEvent, isDown: boolean) => {
    keyboard.press(e.code, isDown);
    keyGlow.press(e.code, isDown);
    // a thock under each press (not the auto-repeat), deeper for the big keys
    if (isDown && !held.has(e.code)) window.dispatchEvent(new CustomEvent('stage-sfx', { detail: /Space|Enter|Backspace|Shift/.test(e.code) ? 'key-big' : 'key' }));
    if (isDown) held.add(e.code);
    else held.delete(e.code);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => [...K65.flat()].forEach(([code]) => onKey({ code } as KeyboardEvent, false)));
  place(buildMouse(mouseModel), 0.355, 0.17, -0.15);
  place(pictureFrame, -0.4, -0.25, -Math.PI / 2 + 0.3, 1); // its picture faces the model's +x, the stand leg -x
  pictureFrame.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!mat) return;
    // the frame's glass would hide the picture: make it a faint sheen
    if (/glass/i.test(mat.name)) Object.assign(mat, { transparent: true, opacity: 0.12, roughness: 0.05, needsUpdate: true });
    // our own picture, glowing a touch so it reads in the dark room
    if (/artwork/i.test(mat.name)) {
      const pic = sunsetPicture();
      Object.assign(mat, { map: pic, emissiveMap: pic, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35, color: new THREE.Color('#ffffff'), needsUpdate: true });
    }
  });
  place(buildCharger(), -0.33, 0.2, 0.1);
  const notebook = place(buildNotebook(), 0.48, 0.1, -0.25);
  notebook.userData.interact = 'notebook';
  // signs someone works here: to-dos stuck to the wall, a wireframe printout under the keyboard, the phone face down
  // on its charger, the laptop's cable trailing off the back of the desk
  place(buildStickies(), 0, 0, 0);
  place(buildPrintout(), -0.21, 0.19, 0.42);
  const phoneKit = buildPhone();
  const phone = phoneKit.group;
  phone.userData.interact = 'phone';
  place(phone, -0.33, 0.2, 0.35);
  place(buildChargingCable(), 0, 0, 0);
  place(buildPowerStrip(), 0.55, -0.22, 0);
  const shelves = buildShelves({ calathea });
  place(shelves.group, 0, 0, 0);
  // the arc lamp on the right, its head reaching over towards the laptop
  const lamp = buildLamp(lampModel);
  place(lamp.group, 0.29, -0.25, -1.23);

  /* ---- light: the night outside, the lamp, the LED strip, the screen ---- */
  world.add(new THREE.HemisphereLight('#2c3452', '#1c130c', 0.5));
  // the lamp's light, bounced off the wall and the ceiling, warming the whole corner softly
  const bounce = new THREE.PointLight('#ff9d5c', 0.9, 2.6, 1.2);
  bounce.position.set(0.15, 0.85, 0.15);
  world.add(bounce);
  const windowFill = new THREE.DirectionalLight('#7f93cf', 0.4);
  windowFill.position.set(-0.6, 0.6, -1.2);
  windowFill.target.position.set(-0.2, FLOOR, 1.2);
  world.add(windowFill, windowFill.target);
  const cityGlow = new THREE.DirectionalLight('#7891d8', 0.35);
  cityGlow.position.set(-0.7, 1.3, -2.4);
  world.add(cityGlow);

  /* ---- things in the room to click: the lamp, the blinds, the LED strip, the mug, the phone, the clock ---- */
  const lampLight = { v: 1 };
  const applyLamp = () => {
    const v = lampLight.v;
    lamp.beam.intensity = 1.5 * v;
    lamp.spill.intensity = 0.65 * v;
    bounce.intensity = 0.1 + 0.8 * v;
    shelves.glow.intensity = 0.5 * v;
    lamp.cones.forEach((m) => (m.emissiveIntensity = 0.45 * v));
  };
  const windowLight = (d: number) => {
    windowFill.intensity = 0.4 * (1 - d * 0.85);
    cityGlow.intensity = 0.35 * (1 - d * 0.85);
  };
  const mugHome = mug.group.position.clone();
  const mugQuat = mug.group.quaternion.clone();
  const sip = { p: 0, busy: false };
  const phoneHome = phone.position.clone();
  // a sticky note, read close up: the camera flies to it; a click anywhere or Escape flies back
  let picked: THREE.Object3D | null = null;
  let pickedKey: number | null = null;
  let reading = false;
  // the picture frame stands right in front of the low notes: it fades out while they're read, and back after
  const frameMats: { m: THREE.Material; opacity: number; transparent: boolean }[] = [];
  pictureFrame.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => frameMats.push({ m: x, opacity: x.opacity, transparent: x.transparent }));
  });
  const frameFade = { v: 1 };
  const setFrameFade = () => {
    const v = frameFade.v;
    frameMats.forEach(({ m, opacity, transparent }) => {
      const t = transparent || v < 1;
      if (m.transparent !== t) Object.assign(m, { transparent: t, needsUpdate: true });
      m.opacity = opacity * v;
      m.depthWrite = v === 1;
    });
    pictureFrame.visible = v > 0.01;
    gl.shadowMap.needsUpdate = true;
  };
  const fadeFrame = (show: boolean) => {
    gsap.killTweensOf(frameFade);
    gsap.to(frameFade, { v: show ? 1 : 0, duration: 0.5, delay: show ? 0.45 : 0.15, ease: 'power1.inOut', onUpdate: setFrameFade });
  };
  const blocks = (obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) => {
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    return new THREE.Line3(from, to).closestPointToPoint(c, true, new THREE.Vector3()).distanceTo(c) < 0.16;
  };
  const readNote = (note: THREE.Object3D) => {
    const here = note.getWorldPosition(new THREE.Vector3());
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(note.getWorldQuaternion(new THREE.Quaternion()));
    // the notes on the same wall, close by: frame them all together
    const box = new THREE.Box3();
    world.traverse((o) => {
      if (!o.userData.note) return;
      const p = o.getWorldPosition(new THREE.Vector3());
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
      if (p.distanceTo(here) < 0.25 && f.dot(facing) > 0.9) box.expandByPoint(p);
    });
    const at = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const across = Math.max(Math.abs(size.x * facing.z) + Math.abs(size.z * facing.x), 0) + 0.11;
    const tall = size.y + 0.11;
    const t = Math.tan(THREE.MathUtils.degToRad(34) / 2);
    const dist = Math.max(tall / 2 / t, across / 2 / (t * camera.aspect), 0.12);
    flyTo(at, facing, dist);
  };
  const flyTo = (at: THREE.Vector3, facing: THREE.Vector3, dist: number) => {
    const from = at.clone().addScaledVector(facing, dist);
    reading = true;
    if (blocks(pictureFrame, from, at)) fadeFrame(false);
    gsap.killTweensOf(cam);
    gsap.to(cam, { px: from.x, py: from.y, pz: from.z, tx: at.x, ty: at.y, tz: at.z, fov: 34, duration: 1.2, ease: 'power3.inOut' });
  };
  // the notebook, from above and a little in front, its page filling the view the right way up
  const readNotebook = () => {
    const at = notebook.localToWorld(new THREE.Vector3(0, MAT + 0.012, 0));
    const front = new THREE.Vector3(0, 0, 1).transformDirection(notebook.matrixWorld).setY(0).normalize();
    const facing = new THREE.Vector3(0, 1, 0).addScaledVector(front, 0.38).normalize();
    const t = Math.tan(THREE.MathUtils.degToRad(34) / 2);
    flyTo(at, facing, Math.max(0.25 / 2 / t, 0.2 / 2 / (t * camera.aspect)));
  };
  const stopReading = () => {
    if (!reading) return;
    reading = false;
    if (frameFade.v < 1) fadeFrame(true);
    const v = views()[level];
    gsap.killTweensOf(cam);
    gsap.to(cam, { px: v.pos.x, py: v.pos.y, pz: v.pos.z, tx: v.target.x, ty: v.target.y, tz: v.target.z, fov: v.fov, duration: 1.1, ease: 'power3.inOut' });
  };
  window.addEventListener('keydown', (e) => e.key === 'Escape' && stopReading());
  let caseOpen = false;
  // sounds for the things in the room: os.ts plays them, when the sound is on
  const sfx = (name: string) => window.dispatchEvent(new CustomEvent('stage-sfx', { detail: name }));
  const actions: Record<string, { tip: () => string; run: () => void }> = {
    notebook: {
      tip: () => 'Read the notebook',
      run: () => {
        sfx('note');
        readNotebook();
      },
    },
    key: {
      tip: () => 'Press a key',
      run: () => {
        if (pickedKey === null) return;
        const code = keyboard.codeAt(pickedKey);
        onKey({ code } as KeyboardEvent, true);
        setTimeout(() => onKey({ code } as KeyboardEvent, false), 110);
      },
    },
    note: {
      tip: () => 'Read the note',
      run: () => {
        if (!picked) return;
        sfx('note');
        readNote(picked);
      },
    },
    lamp: {
      tip: () => (lampLight.v > 0.5 ? 'Turn the lamp off' : 'Turn the lamp on'),
      run: () => (sfx(lampLight.v > 0.5 ? 'lamp-off' : 'lamp-on'), gsap.to(lampLight, { v: lampLight.v > 0.5 ? 0 : 1, duration: 0.18, ease: 'power1.out', onUpdate: applyLamp })),
    },
    blinds: {
      tip: () => (room.blinds.d > 0.5 ? 'Open the blinds' : 'Close the blinds'),
      run: () => {
        if (gsap.isTweening(room.blinds)) return;
        sfx(room.blinds.d > 0.5 ? 'blinds-open' : 'blinds-close');
        gsap.to(room.blinds, {
          d: room.blinds.d > 0.5 ? 0 : 1,
          duration: 1.4,
          ease: 'power2.inOut',
          onUpdate: () => {
            room.setBlinds();
            windowLight(room.blinds.d);
            gl.shadowMap.needsUpdate = true;
          },
        });
      },
    },
    led: { tip: () => 'Change the LED colour', run: () => (sfx('led'), room.nextLed()) },
    mug: {
      tip: () => 'Take a sip',
      run: () => {
        if (sip.busy) return;
        sip.busy = true;
        sfx('sip');
        const toCam = camera.position.clone().sub(mugHome);
        const lifted = mugHome.clone().addScaledVector(toCam, 0.32).add(new THREE.Vector3(0, 0.05, 0));
        const flat = toCam.clone().setY(0).normalize();
        const tipped = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0).cross(flat).normalize(), 0.8).multiply(mugQuat);
        const apply = () => {
          mug.group.position.lerpVectors(mugHome, lifted, sip.p);
          mug.group.quaternion.slerpQuaternions(mugQuat, tipped, Math.max(0, sip.p * 1.6 - 0.6));
          mug.wisps.forEach((w) => (w.visible = sip.p < 0.15));
        };
        gsap
          .timeline({ onComplete: () => (sip.busy = false) })
          .to(sip, { p: 1, duration: 0.9, ease: 'power2.inOut', onUpdate: apply })
          .call(() => (mug.coffee.position.y = Math.max(0.035, mug.coffee.position.y - 0.006)))
          .to(sip, { p: 0, duration: 0.8, ease: 'power2.inOut', onUpdate: apply }, '+=0.5');
      },
    },
    phone: {
      tip: () => 'Someone’s texting',
      run: () => {
        if (gsap.isTweening(phone.position)) return;
        sfx('phone');
        phoneKit.notify();
        gsap.fromTo(phone.position, { x: phoneHome.x - 0.0015 }, { x: phoneHome.x + 0.0015, duration: 0.04, repeat: 13, yoyo: true, ease: 'none', onComplete: () => phone.position.copy(phoneHome) });
      },
    },
    airpods: {
      tip: () => (caseOpen ? 'Close the case' : 'Open the AirPods'),
      run: () => {
        if (gsap.isTweening(airpods.state)) return;
        const opening = !caseOpen;
        caseOpen = opening;
        sfx(opening ? 'case-open' : 'case-close');
        gsap.to(airpods.state, {
          open: opening ? 1 : 0,
          duration: opening ? 0.6 : 0.3,
          ease: opening ? 'back.out(1.6)' : 'power2.in',
          onUpdate: () => {
            airpods.sync();
            gl.shadowMap.needsUpdate = true;
          },
        });
        if (opening) gsap.delayedCall(0.7, () => phoneKit.notify('AirPods Pro', 'Connected  ·  100%'));
      },
    },
    clock: { tip: () => 'Switch 12 / 24 hour', run: () => (sfx('clock'), pixelClock.toggle12h()) },
  };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // the first solid thing under the pointer, and the action it belongs to (if any)
  const pick = (cx: number, cy: number) => {
    ndc.set((cx / W()) * 2 - 1, -(cy / H()) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObjects(world.children, true)) {
      let o: THREE.Object3D | null = hit.object;
      let act: string | null = null;
      let skip = false;
      while (o) {
        if (o.userData.noAO && !o.userData.pickable) {
          skip = true;
          break;
        }
        if (o.userData.interact) {
          act = o.userData.interact;
          picked = o;
          pickedKey = hit.instanceId ?? null;
          break;
        }
        o = o.parent;
      }
      if (skip) continue;
      return act;
    }
    return null;
  };
  const tip = document.createElement('p');
  tip.className = 'stage-tip';
  tip.setAttribute('aria-hidden', 'true');
  scene$.append(tip);
  // Nothing in the room says it works until the pointer finds it: a one-line hint, once the camera has settled on
  // the desk, until the visitor has used something in the room (remembered after that)
  const HINT = 'sahilos-room-used';
  let used = false;
  try {
    used = localStorage.getItem(HINT) === '1';
  } catch {}
  const hint = document.createElement('p');
  hint.className = 'stage-hint';
  hint.setAttribute('role', 'status');
  const touch = window.matchMedia('(hover: none)').matches;
  hint.innerHTML = `<span class="stage-hint-dot" aria-hidden="true"></span>psst, the room works: ${touch ? 'tap' : 'click'} the lamp, the blinds, the mug, the notes`;
  scene$.append(hint);
  let hintTimer = 0;
  const hideHint = () => {
    clearTimeout(hintTimer);
    hint.classList.remove('is-on');
  };
  const showHint = (after: number) => {
    if (used) return;
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      if (level === 0 || reading || used) return;
      hint.classList.add('is-on');
      hintTimer = window.setTimeout(hideHint, 9000);
    }, after);
  };
  const markUsed = () => {
    hideHint();
    if (used) return;
    used = true;
    try {
      localStorage.setItem(HINT, '1');
    } catch {}
  };
  const overUi = (t: EventTarget | null) => t instanceof Element && !!t.closest('#screen, .cam-ctrls, .win, .monitor-power, a, button');
  let lastPick = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.timeStamp - lastPick < 90) return;
    lastPick = e.timeStamp;
    // in close on the screen, a click anywhere else steps back out (os.ts does the stepping)
    const act = overUi(e.target) ? null : reading || level === 0 ? 'back' : pick(e.clientX, e.clientY);
    scene$.classList.toggle('is-pointing', !!act);
    if (act) {
      tip.textContent = act === 'back' ? 'Back to the desk' : actions[act].tip();
      tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
    }
  });
  window.addEventListener('click', (e) => {
    if (overUi(e.target) || level === 0) return;
    if (reading) return stopReading();
    const act = pick(e.clientX, e.clientY);
    if (!act) return;
    actions[act].run();
    markUsed();
    tip.textContent = actions[act].tip();
  });

  /* ---- post: bloom, so the lights glow the way they do in a photo ---- */
  const composer = new EffectComposer(gl);
  composer.addPass(new RenderPass(world, camera));
  const ao = new GTAOPass(world, camera, W(), H());
  ao.updateGtaoMaterial({ radius: 0.07, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
  ao.blendIntensity = 0.9;
  // shader-drawn see-through things (rain, wet glass, steam, key glow) aren't solid: keep them out of the occlusion
  const aoHide = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = () => {
    aoHide();
    world.traverse((o) => {
      if (o.userData.noAO) o.visible = false;
    });
  };
  composer.addPass(ao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.55, 0.5, 0.88));
  // the edges of the frame fall off a little, so the eye settles on the laptop, not the lamp
  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 0.85;
  vignette.uniforms.darkness.value = 1; // 1: falls off to black (above 1 goes negative and tints)
  composer.addPass(vignette);
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
    // 2: the whole room, from across it: the window, the desk on its legs, the shelves
    const p2 = wide ? new THREE.Vector3(0.48, 0.4, 1.12) : new THREE.Vector3(0.3, 0.5, 1.6);
    const t2 = new THREE.Vector3(-0.05, 0.12, -0.3);
    const fov2 = wide ? 46 : 64;
    return [
      { pos: centre.clone().addScaledVector(normal, d0), target: centre, fov: fov0 },
      { pos: p1, target: t1, fov: fov1 },
      { pos: p2, target: t2, fov: fov2 },
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
  let lastFrame = 0;
  let lastTick = 0;
  let cssKey = '';
  function frame(now: number) {
    if (!running) return;
    requestAnimationFrame(frame);
    const busy = gsap.isTweening(cam) || gsap.isTweening(lid);
    const gap = busy ? 0 : level === 0 ? 1000 / 15 : 1000 / 30;
    if (now - lastFrame < gap - 2) return;
    lastFrame = now;
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
    shelves.tick(t * k);
    keyGlow.tick(Math.min(0.1, (now - lastTick) / 1000));
    lastTick = now;
    pixelClock.tick();
    mug.tick(t * k, camera);
    composer.render();
    const key = camera.matrixWorld.elements.join() + laptop.lid.rotation.x;
    if (key !== cssKey) {
      cssKey = key;
      renderCss();
    }
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
    gl.shadowMap.needsUpdate = true;
  });

  const lid = { angle: LID_OPEN };
  // the HTML screen always draws over the canvas, so it only shows once the lid is open far enough to face us
  const setLid = () => {
    laptop.lid.rotation.x = -lid.angle;
    gl.shadowMap.needsUpdate = true;
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
      reading = false;
      if (level === 0) hideHint();
      else showHint((duration || 0) * 1000 + 1200);
      if (frameFade.v < 1) fadeFrame(true);
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

/* ---------- the city's soft focus, rendered once into a texture ---------- */

// A disc blur where bright samples weigh more, so lights open into round blobs as they do through a lens.
function blurOnce(gl: THREE.WebGLRenderer, tex: THREE.Texture) {
  const img = tex.image as { width: number; height: number };
  const rt = new THREE.WebGLRenderTarget(Math.min(1600, img.width), Math.round(Math.min(1600, img.width) * (img.height / img.width)), {
    type: THREE.HalfFloatType,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; varying vec2 vUv;
      void main(){
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 48; i++) {
          float a = float(i) * 2.39996;
          float r = 0.0062 * sqrt((float(i) + 0.5) / 48.0);
          vec3 s = texture2D(uTex, vUv + vec2(cos(a), sin(a) * 1.5) * r).rgb;
          float l = dot(s, vec3(0.299, 0.587, 0.114));
          float w = 1.0 + 4.0 * l * l * l;
          acc += s * w;
          wsum += w;
        }
        gl_FragColor = vec4(acc / wsum, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  gl.setRenderTarget(rt);
  gl.render(scene, new THREE.Camera());
  gl.setRenderTarget(null);
  mat.dispose();
  quad.geometry.dispose();
  return rt.texture;
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
    if (m.name === 'Material.001') Object.assign(m, { roughness: 0.85, metalness: 0 }), m.color.set('#6c6c70'); // the key legends, not glaring
    if (m.map && /Touch_Bar/.test(m.name)) m.color.setScalar(0.3); // the Touch Bar, dim as the real one
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

function buildRoom(cityTex: THREE.Texture, cityBlur: THREE.Texture) {
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();

  /* the desk: a walnut top on four legs against the wall, a carbon-weave mat on it; boards on the floor */
  const deskWood = pbr('walnut_veneer', 1.6, 1, '#d9c2ad');
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.035, 0.63), deskWood);
  desk.position.set(0.05, -0.0175, -0.015);
  desk.castShadow = desk.receiveShadow = true;
  group.add(desk);
  const legMat = std('#3a2416', 0.7);
  for (const [x, z] of [[-0.47, -0.3], [0.57, -0.3], [-0.47, 0.27], [0.57, 0.27]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, -FLOOR - 0.035, 0.045), legMat);
    leg.position.set(x, (FLOOR - 0.035) / 2, z);
    leg.castShadow = leg.receiveShadow = true;
    group.add(leg);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.02), legMat);
  apron.position.set(0.05, -0.065, 0.28);
  group.add(apron);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4), pbr('wood_floor', 3, 3, '#a88f7c'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR, 1.6);
  floor.receiveShadow = true;
  group.add(floor);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), std('#2f2b3a', 1));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-0.1, FLOOR + 0.002, 0.7);
  rug.receiveShadow = true;
  group.add(rug);
  const matShape = new THREE.Shape();
  const mw = 0.88;
  const md = 0.46;
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
  // an extruded shape's uvs run in metres, so the weave texture repeats per metre
  const matGeo = new THREE.ExtrudeGeometry(matShape, { depth: MAT, bevelEnabled: false });
  const mat = new THREE.Mesh(matGeo, std('#ffffff', 0.9, 0, { map: carbonTexture() }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0, 0.075);
  mat.receiveShadow = true;
  group.add(mat);

  /* the wall behind the desk: a window on its left half, from the desk top up, the
     blinds pulled part way down; plain wall to the right of it for the shelves */
  const wallZ = -0.33;
  const depth = 0.1;
  const open = { x0: -0.46, x1: 0.02, y0: 0.0, y1: 0.82 }; // from the corner to behind the laptop
  const wallMat = pbr('plastered_wall_04', 2.5, 2.5, '#6a6e80');
  const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    return b;
  };
  block(open.x1, 2.2, FLOOR, 1.8, wallZ - depth, wallZ, wallMat);
  block(-2.2, 2.2, open.y1, 1.8, wallZ - depth, wallZ, wallMat);
  block(-2.2, open.x0, FLOOR, 1.8, wallZ - depth, wallZ, wallMat);
  block(open.x0, open.x1, FLOOR, open.y0, wallZ - depth, wallZ, wallMat);
  // the side wall on the right, and a skirting board
  const side = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), wallMat);
  side.rotation.y = -Math.PI / 2;
  side.position.set(1.05, FLOOR + 1.3, 1.67);
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-0.5, FLOOR + 1.3, 1.67); // against the desk's left edge: the desk sits in the corner
  leftWall.receiveShadow = true;
  group.add(leftWall);
  // a poster on the left wall, above the desk's end
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.48), std('#ffffff', 0.8, 0, { map: posterTexture() }));
  poster.rotation.y = Math.PI / 2;
  poster.position.set(-0.497, 0.47, -0.08);
  poster.receiveShadow = true;
  group.add(poster);
  side.receiveShadow = true;
  group.add(side);
  block(-0.5, 1.05, FLOOR, FLOOR + 0.07, wallZ, wallZ + 0.012, std('#262a38', 0.8));
  // the window frame, pale, round the opening; the glass sits back in the wall
  const frameMat = std('#868b96', 0.6);
  const glassZ = -0.36;
  block(open.x0 - 0.04, open.x1 + 0.04, open.y1, open.y1 + 0.04, wallZ - 0.02, wallZ + 0.02, frameMat);
  block(open.x0 - 0.04, open.x1 + 0.04, open.y0 - 0.02, open.y0 + 0.012, wallZ - 0.06, wallZ + 0.03, frameMat);
  block(open.x0 - 0.04, open.x0, open.y0, open.y1, wallZ - 0.02, wallZ + 0.02, frameMat);
  block(open.x1, open.x1 + 0.04, open.y0, open.y1, wallZ - 0.02, wallZ + 0.02, frameMat);
  block(open.x1 - 0.045, open.x1, open.y0, open.y1, glassZ - 0.02, glassZ + 0.015, std('#9ea3ad', 0.5));
  block(open.x1 - 0.034, open.x1 - 0.028, 0.32, 0.46, glassZ + 0.015, glassZ + 0.03, std('#d8dbe0', 0.35, 0.8));
  // the blinds: a full set of slats, stacked up near the top, that can come down to the sill and close
  const slat = std('#d4d7de', 0.6);
  const slats: THREE.Mesh[] = [];
  const NS = 34;
  for (let i = 0; i < NS; i++) {
    const sl = new THREE.Mesh(new THREE.BoxGeometry(open.x1 - open.x0 + 0.03, 0.006, 0.03), slat);
    sl.castShadow = true;
    sl.userData.interact = 'blinds';
    group.add(sl);
    slats.push(sl);
  }
  const blinds = { d: 0 };
  const setBlinds = () => {
    const top = open.y1 - 0.015;
    const bottom = THREE.MathUtils.lerp(open.y1 - 0.19, open.y0 + 0.014, blinds.d);
    slats.forEach((sl, i) => {
      sl.position.set((open.x0 + open.x1) / 2, top - (i / (NS - 1)) * (top - bottom), wallZ + 0.03);
      sl.rotation.x = THREE.MathUtils.lerp(0.4, 1.42, blinds.d);
    });
  };
  setBlinds();
  block(open.x0 - 0.02, open.x1 + 0.02, open.y1 - 0.004, open.y1 + 0.026, wallZ + 0.01, wallZ + 0.05, slat);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.32, 6), slat);
  cord.position.set(open.x1 - 0.07, open.y1 - 0.18, wallZ + 0.055);
  cord.userData.interact = 'blinds';
  group.add(cord);

  /* the city below, through rain: the window looks down on it from a high floor. Seen through wet glass it is soft,
     its lights opening into round blobs (bright samples weigh more, as in a lens), its sky deep and hazy, a few
     windows blinking. CITY_GRADE is shared with the drops on the glass, which see the same city sharp. */
  const cityU = { uTex: { value: cityBlur }, uTime: { value: 0 } };
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
          vec3 raw = texture2D(uTex, vUv).rgb; // already blurred, once, by blurOnce
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
  rain.userData.noAO = true;
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
  wet.userData.noAO = true;
  group.add(wet);

  /* a purple LED strip along the foot of the window, glowing up the frame */
  const ledColor = new THREE.Color('#ff9a3c');
  const ledW = open.x1 - open.x0 - 0.06;
  const led = new THREE.Mesh(new THREE.BoxGeometry(ledW, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: ledColor.clone().multiplyScalar(2.2), toneMapped: false }));
  led.position.set((open.x0 + open.x1) / 2, 0.014, wallZ + 0.004);
  group.add(led);
  const ledLight = new THREE.RectAreaLight(ledColor, 2, ledW, 0.02);
  ledLight.position.set((open.x0 + open.x1) / 2, 0.016, wallZ + 0.006);
  ledLight.rotation.x = Math.PI / 2; // shining up
  group.add(ledLight);
  const ledWash = new THREE.RectAreaLight(ledColor, 0.4, ledW, 0.02);
  ledWash.position.set((open.x0 + open.x1) / 2, 0.016, wallZ + 0.006);
  ledWash.rotation.x = Math.PI; // and out over the desk
  group.add(ledWash);
  // a fatter, invisible target round the strip, so it's easy to click
  const ledHit = new THREE.Mesh(new THREE.BoxGeometry(ledW, 0.035, 0.03), new THREE.MeshBasicMaterial({ visible: false }));
  ledHit.position.copy(led.position);
  ledHit.userData.interact = 'led';
  group.add(ledHit);
  const LEDS = ['#ff9a3c', '#22c7b8', '#3d7bff', '#ff4f6d', null];
  let ledAt = 0;
  let ledBase = 2;

  return {
    group,
    tick(t: number, k: number) {
      cityU.uTime.value = t * k;
      rainU.uTime.value = t;
      // the LED strip breathes, slowly
      ledLight.intensity = ledBase * (1 + Math.sin(t * 0.6 * k) * 0.15 * k);
    },
    blinds,
    setBlinds,
    // the next colour along: amber, teal, blue, coral, off
    nextLed() {
      ledAt = (ledAt + 1) % LEDS.length;
      const c = LEDS[ledAt];
      ledBase = c ? 2 : 0;
      ledWash.intensity = c ? 0.4 : 0;
      if (c) {
        ledLight.color.set(c);
        ledWash.color.set(c);
        (led.material as THREE.MeshBasicMaterial).color.set(c).multiplyScalar(2.2);
      } else (led.material as THREE.MeshBasicMaterial).color.set('#1a1820');
      return c ? 'on' : 'off';
    },
  };
}

/* ---------- the room around the desk: a chair, shelves with the cat, headphones on a stand ---------- */

const WALL = -0.33; // the back wall's face

// a power strip on the floor under the desk, its switch lit
function buildPowerStrip() {
  const g = new THREE.Group();
  const strip = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.035, 0.06, 2, 0.01), std('#2a2b30', 0.6));
  strip.position.y = FLOOR + 0.0175;
  g.add(strip);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.002, 0.02), std('#111114', 0.5));
    s.position.set(-0.11 + i * 0.075, FLOOR + 0.036, 0);
    g.add(s);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3030').multiplyScalar(2), toneMapped: false }));
  led.position.set(0.14, FLOOR + 0.037, 0.02);
  g.add(led);
  return g;
}

// a notebook, open to a clean page, a pen across it
function buildNotebook() {
  const g = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.21), std('#2b2f3a', 0.8));
  cover.position.y = MAT + 0.006;
  const page = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.2), std('#ffffff', 0.9, 0, { map: handwritten() }));
  page.rotation.x = -Math.PI / 2;
  page.position.y = MAT + 0.0122;
  const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), std('#1c1c20', 0.4, 0.4));
  pen.rotation.set(0, 0.4, Math.PI / 2);
  pen.position.set(0, MAT + 0.018, 0.065); // below the list, not across it
  g.add(cover, page, pen);
  return g;
}

// a wall shelf right of the window: real books and a calathea in a pot (models from Poly Haven, CC0)
function buildShelves(m: { calathea: THREE.Object3D }) {
  const group = new THREE.Group();
  const wood = std('#ffffff', 0.6, 0, { map: woodTexture() });
  const bracket = std('#2a1a10', 0.7);
  const Y = 0.43;
  const shelf = (x: number, y: number, w: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, 0.2), wood);
    b.position.set(x, y, WALL + 0.1);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.12), bracket);
      k.position.set(x + s * (w / 2 - 0.07), y - 0.06, WALL + 0.06);
      group.add(k);
    }
    return y + 0.0125;
  };
  const top = shelf(0.33, Y, 0.5);
  const top2 = shelf(0.83, 0.64, 0.34); // a second, higher shelf on the right

  // the books: today's paperbacks and design books, loud spines in all sizes, arranged as books really sit:
  // a run standing, one leaning on it, a few lying in a pile, and a couple of things that live on a shelf
  const D = WALL + 0.012; // the books stand back against the wall
  const pages = std('#efe6d2', 0.95);
  const rng = (() => {
    let seed = 11;
    return () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  })();
  const book = (b: Book, x: number, y: number, flat = false, rz = 0) => {
    const cover = std(b.bg, 0.55 + rng() * 0.25);
    const spine = std('#ffffff', 0.6, 0, { map: spineTexture(b) });
    // faces: +x/-x the covers, +y/-y the page edges, +z the spine, -z the fore-edge against the wall
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(b.t, b.h, b.d, 2, 0.0016), [cover, cover, pages, pages, spine, pages]);
    const holder = new THREE.Group();
    holder.add(mesh);
    if (flat) {
      // on its back cover, spine still facing out, the title reading along the shelf
      holder.rotation.set(0, (rng() - 0.5) * 0.12, Math.PI / 2);
      holder.position.set(x, y + b.t / 2, D + b.d / 2);
    } else {
      // standing: pivoting on its bottom edge, so it can lean
      mesh.position.y = b.h / 2;
      holder.rotation.set(0, (rng() - 0.5) * 0.06, rz);
      holder.position.set(x, y, D + b.d / 2);
    }
    group.add(holder);
  };
  const run = (list: Book[], x: number, y: number) => {
    for (const b of list) {
      x += b.t / 2;
      book(b, x, y);
      x += b.t / 2 + 0.0015;
    }
    return x;
  };
  // a book leaning back on the run's last one: its top edge resting against it
  const leaner = (b: Book, end: number, y: number, a: number) => book(b, end + Math.sin(a) * b.h + (b.t / 2) * Math.cos(a), y, false, a);
  const pileUp = (list: Book[], x: number, y: number) => {
    for (const b of list) {
      book(b, x + (rng() - 0.5) * 0.008, y, true);
      y += b.t;
    }
    return y;
  };
  // left shelf: a run, one leaning back on it, a pile with a candle on top
  leaner(BOOKS[6], run(BOOKS.slice(0, 6), 0.085, top), top, 0.24);
  const candle = buildCandle();
  candle.group.position.set(0.38, pileUp([BOOKS[8], BOOKS[10], BOOKS[18]], 0.38, top), D + 0.06);
  group.add(candle.group);
  // right shelf: a short run, and a puzzle cube on a little pile
  run(BOOKS.slice(11, 16), 0.69, top2);
  const cube = buildCube();
  cube.position.set(0.92, pileUp([BOOKS[9], BOOKS[17]], 0.92, top2), D + 0.06);
  cube.rotation.y = 0.5;
  group.add(cube);

  // potted calatheas: one on the left shelf, a big one on the floor by the desk
  const potted = (clumpName: string, r: number, h: number, colour: string) => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [r * 0.82, 0], [r * 0.95, h * 0.1], [r, h], [r * 0.94, h], [r * 0.9, h * 0.94], [0, h * 0.94]].map(([px, py]) => new THREE.Vector2(px, py)), 40),
      std(colour, 0.75),
    );
    g.add(pot);
    const clump = m.calathea.getObjectByName(clumpName);
    if (clump) {
      const leaves = new THREE.Group();
      leaves.add(clump);
      clump.position.set(0, 0, 0);
      clump.updateMatrixWorld(true);
      const cb = new THREE.Box3().setFromObject(clump);
      clump.position.set(-(cb.min.x + cb.max.x) / 2, -cb.min.y, -(cb.min.z + cb.max.z) / 2);
      leaves.position.y = h * 0.82;
      g.add(leaves);
      return { g, leaves };
    }
    return { g, leaves: g };
  };
  const shelfPlant = potted('calathea_orbifolia_01_b', 0.06, 0.085, '#e6e1d8');
  shelfPlant.leaves.scale.setScalar(0.52);
  shelfPlant.g.position.set(0.52, top, WALL + 0.1);
  shelfPlant.g.rotation.y = 0.4;
  group.add(shelfPlant.g);
  const floorPlant = potted('calathea_orbifolia_01_a', 0.15, 0.3, '#3b3a40');
  floorPlant.leaves.scale.setScalar(0.85);
  floorPlant.g.position.set(0.84, FLOOR, 0.12);
  floorPlant.g.rotation.y = -0.6;
  group.add(floorPlant.g);
  // a warm light over the shelves, as from the lamp
  const glow = new THREE.PointLight('#ffb35c', 0.5, 1.0, 1.6);
  glow.position.set(0.6, 0.62, WALL + 0.3);
  group.add(glow);
  shadows(group);
  candle.group.traverse((o) => (o.castShadow = false));
  return { group, glow, tick: candle.tick };
}

type Book = { title: string; by: string; bg: string; fg: string; t: number; h: number; d: number; style: number };
// invented titles: a front-end developer's shelf, in the loud covers design books have now
const BOOKS: Book[] = (
  [
    ['MOTION', 'K. Arora', '#e8553d', '#fff3e0', 0.03, 0.2, 0.135, 0],
    ['TYPE & GRID', 'M. Weiss', '#f2ede1', '#1d1d22', 0.024, 0.185, 0.13, 1],
    ['SHIP IT', 'R. Rao', '#1d1d22', '#f2c14e', 0.02, 0.165, 0.11, 2],
    ['COLOUR', 'I. Sato', '#f2c14e', '#1d1d22', 0.034, 0.21, 0.145, 3],
    ['THINK SMALL', 'D. Lin', '#2f5d8a', '#f2ede1', 0.018, 0.175, 0.115, 0],
    ['WEBGL NOTES', 'A. Mehta', '#7fb7a4', '#14302a', 0.026, 0.19, 0.13, 2],
    ['LATE NIGHTS', 'S. P.', '#1f6f78', '#ffd9a8', 0.022, 0.17, 0.115, 1],
    ['SLOW WEB', 'J. Hart', '#ff8a3d', '#1d1d22', 0.024, 0.18, 0.125, 3],
    ['HAIKU', 'B. Ono', '#f08bb0', '#3a1426', 0.02, 0.15, 0.11, 0],
    ['GRIDS', 'E. Moss', '#2a7a5e', '#f2ede1', 0.028, 0.16, 0.12, 2],
    ['SKETCHBOOK', '', '#1d1d22', '#e8553d', 0.016, 0.14, 0.105, 1],
    ['PIXELS', 'T. Ng', '#3d7bff', '#f2ede1', 0.026, 0.17, 0.12, 3],
    ['EASING', 'C. Diaz', '#f2ede1', '#e8553d', 0.02, 0.155, 0.11, 0],
    ['BUILD', 'H. Kim', '#e8553d', '#1d1d22', 0.03, 0.18, 0.13, 2],
    ['QUIET', 'P. Roy', '#86a68f', '#1d1d22', 0.018, 0.145, 0.105, 1],
    ['CSS', 'L. Vega', '#f2c14e', '#2f5d8a', 0.022, 0.16, 0.115, 0],
    ['DRAW', 'N. Ali', '#1d1d22', '#f2ede1', 0.024, 0.165, 0.12, 3],
    ['ZINE 04', '', '#ff8a3d', '#1d1d22', 0.012, 0.15, 0.11, 1],
    ['FOCUS', 'O. Berg', '#34383f', '#f2c14e', 0.022, 0.14, 0.105, 2],
  ] as const
).map(([title, by, bg, fg, t, h, d, style]) => ({ title, by, bg, fg, t, h, d, style }));

// a spine: the title running down it, the way it's printed, with a band, a block, stripes or a dot for a mark
function spineTexture(b: Book) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = b.bg;
  g.fillRect(0, 0, 64, 512);
  g.fillStyle = b.fg;
  if (b.style === 1) {
    g.fillRect(0, 34, 64, 10);
    g.fillRect(0, 468, 64, 10);
  } else if (b.style === 2) {
    g.fillRect(0, 0, 64, 70);
  } else if (b.style === 3) {
    for (let i = 0; i < 4; i++) g.fillRect(0, 440 + i * 16, 64, 6);
  }
  if (b.style !== 3) {
    g.beginPath();
    g.arc(32, 490, 7, 0, Math.PI * 2);
    g.fill();
  }
  // the title, down the spine
  g.save();
  g.translate(33, b.style === 2 ? 96 : 72);
  g.rotate(Math.PI / 2);
  g.font = `${b.style === 0 ? 800 : 600} ${b.title.length > 9 ? 24 : 30}px ${b.style === 1 ? 'Georgia, serif' : '"Helvetica Neue", Arial, sans-serif'}`;
  g.textBaseline = 'middle';
  g.fillText(b.title, 0, 0);
  if (b.by) {
    g.globalAlpha = 0.7;
    g.font = '400 15px "Helvetica Neue", Arial, sans-serif';
    g.fillText(b.by, 300, 1);
  }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// a candle in a glass jar, burning low: a flickering flame and a warm little light
function buildCandle() {
  const group = new THREE.Group();
  const jar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, 0.055, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: '#d8c9b0', roughness: 0.15, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  jar.position.y = 0.0275;
  jar.userData.noAO = true;
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 28), std('#f1e6d2', 0.6, 0, { emissive: new THREE.Color('#ff9a4a'), emissiveIntensity: 0.25 }));
  wax.position.y = 0.0175;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0243, 0.0243, 0.02, 28, 1, true), std('#2b2f3a', 0.8));
  label.position.y = 0.022;
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 0.008, 6), std('#1a1410', 0.9));
  wick.position.y = 0.039;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 10), new THREE.MeshBasicMaterial({ color: '#ffc27a' }));
  flame.scale.set(1, 2.2, 1);
  flame.position.y = 0.0475;
  flame.userData.noAO = true;
  const light = new THREE.PointLight('#ff9a4a', 0.12, 0.6, 2);
  light.position.y = 0.06;
  group.add(jar, wax, label, wick, flame, light);
  const tick = (t: number) => {
    const f = 0.85 + Math.sin(t * 11) * 0.06 + Math.sin(t * 23.7) * 0.05 + Math.sin(t * 5.3) * 0.04;
    flame.scale.set(1, 2.2 * f, 1);
    flame.position.x = Math.sin(t * 3.1) * 0.0006;
    light.intensity = 0.12 * f;
  };
  return { group, tick };
}

// a puzzle cube, half solved, left lying about
function buildCube() {
  const g = new THREE.Group();
  const s = 0.042;
  const body = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 3, 0.004), std('#141416', 0.5));
  body.position.y = s / 2;
  g.add(body);
  const cols = ['#f4f4f0', '#f2c14e', '#e8553d', '#ff8a3d', '#3d7bff', '#2a9a5e'];
  const tile = new RoundedBoxGeometry(s / 3 - 0.0022, s / 3 - 0.0022, 0.0012, 2, 0.0005);
  const mats = cols.map((c) => std(c, 0.35));
  const faces: [THREE.Vector3, THREE.Euler, number][] = [
    [new THREE.Vector3(0, 0, 1), new THREE.Euler(0, 0, 0), 4],
    [new THREE.Vector3(1, 0, 0), new THREE.Euler(0, Math.PI / 2, 0), 2],
    [new THREE.Vector3(-1, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0), 3],
    [new THREE.Vector3(0, 0, -1), new THREE.Euler(0, Math.PI, 0), 5],
    [new THREE.Vector3(0, 1, 0), new THREE.Euler(-Math.PI / 2, 0, 0), 0],
  ];
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (const [n, rot, main] of faces) {
    const u = new THREE.Vector3(1, 0, 0).applyEuler(rot);
    const v = new THREE.Vector3(0, 1, 0).applyEuler(rot);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const m = new THREE.Mesh(tile, mats[rand() < 0.55 ? main : Math.floor(rand() * 6)]);
        m.rotation.copy(rot);
        m.position.set(0, s / 2, 0).addScaledVector(n, s / 2 + 0.0004).addScaledVector(u, (i * s) / 3).addScaledVector(v, (j * s) / 3);
        g.add(m);
      }
  }
  return g;
}

// the picture in the frame on the desk: a sunset over hills, warm and soft
function sunsetPicture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, '#22324a');
  sky.addColorStop(0.55, '#e0745a');
  sky.addColorStop(1, '#ffc27a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#ffe3a8';
  g.beginPath();
  g.arc(128, 200, 46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a3a26';
  g.beginPath();
  g.moveTo(0, 230);
  g.quadraticCurveTo(70, 180, 140, 225);
  g.quadraticCurveTo(200, 190, 256, 220);
  g.lineTo(256, 320);
  g.lineTo(0, 320);
  g.fill();
  g.fillStyle = '#2a1c16';
  g.beginPath();
  g.moveTo(0, 270);
  g.quadraticCurveTo(110, 235, 256, 265);
  g.lineTo(256, 320);
  g.lineTo(0, 320);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // glTF uvs
  return tex;
}

// a scanned material from Poly Haven (CC0): colour, surface relief and roughness, repeated, tinted
function pbr(name: string, rx: number, ry: number, tint = '#ffffff') {
  const load = (kind: string, srgb: boolean) => {
    const t = new THREE.TextureLoader().load(`/images/room/tex/${name}_${kind}.webp`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: load('diff', true),
    normalMap: load('nor', false),
    roughnessMap: load('rough', false),
    roughness: 1,
  });
}

// the poster: black, an amber pixel grid fading in, a line to live by
function posterTexture() {
  const c = document.createElement('canvas');
  c.width = 680;
  c.height = 960;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0b08';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 21; x++) {
      const a = Math.max(0, 0.55 - Math.hypot(x - 15, y - 9) / 16);
      if (a <= 0.02) continue;
      g.fillStyle = `rgba(255,176,0,${a})`;
      g.fillRect(28 + x * 30, 28 + y * 30, 18, 18);
    }
  g.fillStyle = '#ffb000';
  g.font = '92px Silkscreen';
  ['MAKE IT', 'FEEL', 'ALIVE.'].forEach((t, i) => g.fillText(t, 46, 560 + i * 104));
  g.fillStyle = 'rgba(255,176,0,0.6)';
  g.font = '22px "IBM Plex Mono"';
  g.fillText('SAHIL/OS — BHOPAL', 48, 900);
  g.strokeStyle = 'rgba(255,176,0,0.35)';
  g.lineWidth = 3;
  g.strokeRect(16, 16, c.width - 32, c.height - 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- signs of work: notes, a printout, the phone, a cable ---------- */

const HAND = '"Bradley Hand", "Marker Felt", "Segoe Print", "Comic Sans MS", cursive';

// the notebook's page: today's list, in pen, two things ticked off
function handwritten() {
  const c = document.createElement('canvas');
  c.width = 280;
  c.height = 400;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece4d2';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(90,120,170,0.25)';
  g.lineWidth = 1;
  for (let y = 70; y < c.height; y += 26) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }
  g.fillStyle = '#1f2a44';
  g.font = `600 26px ${HAND}`;
  g.fillText('today', 20, 48);
  g.font = `20px ${HAND}`;
  const items = [['hero anim (GSAP)', true], ['CMS: case studies', true], ['fix CLS /pricing', false], ['QA on mobile', false], ['client call 11:00', false], ['ship v2 !!', false]] as const;
  items.forEach(([t, done], i) => {
    const y = 90 + i * 26;
    g.fillText(`— ${t}`, 18, y);
    if (done) {
      g.strokeStyle = '#1f2a44';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(30, y - 7);
      g.lineTo(30 + g.measureText(t).width + 18, y - 9);
      g.stroke();
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// sticky notes on the wall between the poster and the window, and one on the shelf's edge
function buildStickies() {
  const g = new THREE.Group();
  const note = (text: string, colour: string, x: number, y: number, z: number, ry: number, rz: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, 0, 512, 70); // the sticky strip
    ctx.fillStyle = '#26262c';
    ctx.font = `78px ${HAND}`;
    text.split('\n').forEach((line, i) => ctx.fillText(line, 44, 190 + i * 96));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), std('#ffffff', 0.85, 0, { map: tex, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(0, ry, rz);
    m.userData.interact = 'note';
    m.userData.note = { text: text.replace(/\n/g, ' '), colour };
    g.add(m);
  };
  // on the left wall, low, behind the picture frame
  note('call Ravi\nre: launch', '#ffe27a', -0.497, 0.19, -0.2, Math.PI / 2, 0.06);
  note('fix CLS\n/pricing', '#ff9fb2', -0.497, 0.17, -0.12, Math.PI / 2, -0.08);
  note('GSAP\nscroll hero', '#9fd3ff', -0.497, 0.11, -0.16, Math.PI / 2, 0.03);
  // one more in the cluster, and one on the shelf's edge
  note('ship v2 ✓', '#b8f0a0', -0.497, 0.13, -0.06, Math.PI / 2, -0.05);
  note('drink\nwater :)', '#ffe27a', 0.2, 0.425, WALL + 0.201, 0, 0.04);
  return g;
}

// a printed wireframe, half under the keyboard, with notes in red
function buildPrintout() {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 420;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f0ea';
  g.fillRect(0, 0, 300, 420);
  g.strokeStyle = '#8a8a90';
  g.lineWidth = 2;
  g.strokeRect(20, 20, 260, 40); // nav
  g.strokeRect(20, 75, 260, 120); // hero
  g.beginPath();
  g.moveTo(20, 75);
  g.lineTo(280, 195);
  g.moveTo(280, 75);
  g.lineTo(20, 195);
  g.stroke();
  for (let i = 0; i < 3; i++) g.strokeRect(20 + i * 88, 210, 80, 80); // cards
  for (let i = 0; i < 5; i++) g.fillRect(20, 310 + i * 16, 180 + (i % 2) * 60, 5);
  g.strokeStyle = '#d0342c';
  g.fillStyle = '#d0342c';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(150, 135, 110, 50, 0, 0, Math.PI * 2);
  g.stroke();
  g.font = `22px ${HAND}`;
  g.fillText('more space!', 160, 255);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.21), std('#ffffff', 0.9, 0, { map: tex }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = MAT + 0.0006;
  const grp = new THREE.Group();
  grp.add(sheet);
  return grp;
}

// the phone, face up on the charging pad: a dim always-on lock screen; when it buzzes, a message lights it up
function buildPhone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.0716, 0.0078, 0.1476, 4, 0.006), std('#2b2d33', 0.35, 0.6));
  body.position.y = MAT + 0.006 + 0.0039;
  g.add(body);
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 500;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const glass = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(0.35, 0.35, 0.35) });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.142), glass);
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = MAT + 0.006 + 0.0079;
  g.add(screen);
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' });
  const draw = (message: { from: string; text: string } | null) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 500);
    sky.addColorStop(0, '#0f2234');
    sky.addColorStop(1, '#b0552a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 240, 500);
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.beginPath();
    ctx.roundRect(88, 14, 64, 18, 9); // the island
    ctx.fill();
    ctx.fillStyle = '#f3f0ff';
    ctx.textAlign = 'center';
    ctx.font = '600 64px "Avenir Next", Helvetica, sans-serif';
    ctx.fillText(fmt.format(new Date()), 120, 130);
    ctx.font = '16px "Avenir Next", Helvetica, sans-serif';
    ctx.fillText('Bhopal', 120, 60);
    if (message) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.roundRect(14, 170, 212, 70, 16);
      ctx.fill();
      ctx.fillStyle = '#1b1b22';
      ctx.textAlign = 'left';
      ctx.font = '600 15px "Avenir Next", Helvetica, sans-serif';
      ctx.fillText(message.from, 30, 196);
      ctx.font = '15px "Avenir Next", Helvetica, sans-serif';
      ctx.fillText(message.text, 30, 222);
    }
    tex.needsUpdate = true;
  };
  draw(null);
  setInterval(() => draw(null), 60_000);
  return {
    group: g,
    // a message arrives: the screen lights up, then dims back down
    notify(from = 'Client', text = 'can we ship today? 🙏') {
      draw({ from, text });
      gsap.killTweensOf(glass.color);
      glass.color.setScalar(1);
      gsap.to(glass.color, { r: 0.35, g: 0.35, b: 0.35, duration: 1.2, delay: 4, onComplete: () => draw(null) });
    },
  };
}

// the laptop's charging cable: out of its left side, across the mat, off the back of the desk and down
function buildChargingCable() {
  const g = new THREE.Group();
  const white = std('#f1f1ee', 0.45);
  const pts = [
    [-0.166, 0.006, -0.06], [-0.19, 0.0035, -0.07], [-0.24, 0.0035, -0.13], [-0.36, 0.0035, -0.2], [-0.4, 0.0035, -0.28],
    [-0.42, 0.0, -0.33], [-0.43, -0.12, -0.335], [-0.44, -0.4, -0.335],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.0016, 8), white));
  const plug = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.005, 0.007, 2, 0.002), white);
  plug.position.set(-0.159, 0.006, -0.058);
  g.add(plug);
  return g;
}

/* ---------- surfaces: walnut, carbon weave ---------- */

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4b2e1c';
  g.fillRect(0, 0, c.width, c.height);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // long grain lines, wavering, lighter and darker
  for (let i = 0; i < 260; i++) {
    const y = rnd() * c.height;
    const dark = rnd() < 0.55;
    g.strokeStyle = dark ? `rgba(30, 16, 8, ${0.08 + rnd() * 0.22})` : `rgba(140, 90, 55, ${0.05 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd() * 2.4;
    g.beginPath();
    const amp = 2 + rnd() * 6;
    const f = 0.004 + rnd() * 0.008;
    const ph = rnd() * 10;
    for (let x = 0; x <= c.width; x += 16) {
      const yy = y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 1.6);
  tex.anisotropy = 8;
  return tex;
}

function carbonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#141417';
  g.fillRect(0, 0, 64, 64);
  // a twill: little diagonal blocks, lighter and darker
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const on = (x + y) % 4 < 2;
      const grd = g.createLinearGradient(x * 8, y * 8, x * 8 + 8, y * 8 + 8);
      grd.addColorStop(0, on ? '#26262b' : '#18181c');
      grd.addColorStop(1, on ? '#1b1b1f' : '#111114');
      g.fillStyle = grd;
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160); // the mat's uvs run in metres: blocks of about 0.8 mm
  tex.anisotropy = 8;
  return tex;
}

/* ---------- the visitor's typing, shown on the desk ---------- */

// key rows as KeyboardEvent.code with widths in key units; the desk keyboard is a 65% board
const K65: [string, number, string?][][] = [
  [['Escape', 1, 'a'], ...'1234567890'.split('').map((d) => [`Digit${d}`, 1] as [string, number]), ['Minus', 1], ['Equal', 1], ['Backspace', 2, 'm']],
  [['Tab', 1.5, 'm'], ...'QWERTYUIOP'.split('').map((c) => [`Key${c}`, 1] as [string, number]), ['BracketLeft', 1], ['BracketRight', 1], ['Backslash', 1.5, 'm']],
  [['CapsLock', 1.75, 'm'], ...'ASDFGHJKL'.split('').map((c) => [`Key${c}`, 1] as [string, number]), ['Semicolon', 1], ['Quote', 1], ['Enter', 2.25, 'a']],
  [['ShiftLeft', 2.25, 'm'], ...'ZXCVBNM'.split('').map((c) => [`Key${c}`, 1] as [string, number]), ['Comma', 1], ['Period', 1], ['Slash', 1], ['ShiftRight', 1.75, 'm'], ['ArrowUp', 1, 'm']],
  [['ControlLeft', 1.25, 'm'], ['AltLeft', 1.25, 'm'], ['MetaLeft', 1.25, 'm'], ['Space', 6.25, 'm'], ['MetaRight', 1, 'm'], ['AltRight', 1, 'm'], ['ArrowLeft', 1, 'm'], ['ArrowDown', 1, 'm'], ['ArrowRight', 1, 'm']],
];
// the MacBook's own keyboard, 14.5 units a row
const KMAC: [string, number][][] = [
  [['Backquote', 1], ...'1234567890'.split('').map((d) => [`Digit${d}`, 1] as [string, number]), ['Minus', 1], ['Equal', 1], ['Backspace', 1.5]],
  [['Tab', 1.5], ...'QWERTYUIOP'.split('').map((c) => [`Key${c}`, 1] as [string, number]), ['BracketLeft', 1], ['BracketRight', 1], ['Backslash', 1]],
  [['CapsLock', 1.75], ...'ASDFGHJKL'.split('').map((c) => [`Key${c}`, 1] as [string, number]), ['Semicolon', 1], ['Quote', 1], ['Enter', 1.75]],
  [['ShiftLeft', 2.25], ...'ZXCVBNM'.split('').map((c) => [`Key${c}`, 1] as [string, number]), ['Comma', 1], ['Period', 1], ['Slash', 1], ['ShiftRight', 2.25]],
  [['Fn', 1], ['ControlLeft', 1], ['AltLeft', 1], ['MetaLeft', 1.25], ['Space', 5], ['MetaRight', 1.25], ['AltRight', 1], ['ArrowLeft', 1], ['ArrowDown', 1], ['ArrowRight', 1]],
];

/* ---------- a mechanical keyboard: a walnut case, retro cream and brown keycaps; keys go down as you type ---------- */

function buildKeyboard() {
  const g = new THREE.Group();
  const u = 0.0185; // one key unit
  const W = 15 * u;
  const D = K65.length * u;
  const wood = std('#ffffff', 0.5, 0, { map: woodTexture() });
  const kase = new THREE.Mesh(new RoundedBoxGeometry(W + 0.016, 0.022, D + 0.016, 4, 0.005), wood);
  kase.position.y = MAT + 0.011;
  kase.rotation.x = 0.06; // a little typing angle
  g.add(kase);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, 0.002, D + 0.002), std('#1a1a1d', 0.7));
  plate.position.y = 0.0105;
  kase.add(plate);
  const colors: Record<string, THREE.Color> = { c: new THREE.Color('#d8cbb0'), m: new THREE.Color('#4b3427'), a: new THREE.Color('#c25f2c') };
  const keys = K65.flat();
  const cap = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.18), std('#ffffff', 0.55), keys.length);
  const base: THREE.Matrix4[] = [];
  const index = new Map<string, number>();
  const tint: THREE.Color[] = [];
  let i = 0;
  K65.forEach((row, ri) => {
    let x = -W / 2;
    row.forEach(([code, w, kind]) => {
      const wid = w * u;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x + wid / 2, 0.0145 + ri * 0.0004, -D / 2 + u / 2 + ri * u),
        new THREE.Quaternion(),
        new THREE.Vector3(wid - 0.0022, 0.0075, u - 0.0022),
      );
      base.push(m);
      cap.setMatrixAt(i, m);
      tint.push(colors[kind ?? 'c']);
      cap.setColorAt(i, tint[i]);
      index.set(code, i);
      x += wid;
      i++;
    });
  });
  cap.castShadow = true;
  cap.userData.interact = 'key';
  kase.add(cap);
  const codes = keys.map(([code]) => code);
  const down = new THREE.Matrix4().makeTranslation(0, -0.0032, 0);
  const lit = new THREE.Color();
  return {
    group: g,
    codeAt: (i: number) => codes[i],
    press(code: string, isDown: boolean) {
      const k = index.get(code);
      if (k === undefined) return;
      cap.setMatrixAt(k, isDown ? down.clone().multiply(base[k]) : base[k]);
      cap.setColorAt(k, isDown ? lit.copy(tint[k]).lerp(new THREE.Color('#ffd27a'), 0.25) : tint[k]);
      cap.instanceMatrix.needsUpdate = true;
      cap.instanceColor!.needsUpdate = true;
    },
  };
}

/* ---------- amber flashes on the MacBook's keys, under the visitor's typing ---------- */

function buildKeyGlow(mac: THREE.Object3D) {
  // the keys' extent, in world space: everything drawn with the keys' material
  const box = new THREE.Box3();
  let top: THREE.Object3D = mac;
  while (top.parent) top = top.parent;
  top.updateMatrixWorld(true);
  mac.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m && /^Keys/.test(m.name)) box.expandByObject(o);
  });
  const size = box.getSize(new THREE.Vector3());
  const unit = size.x / 14.5;
  const rowD = size.z / KMAC.length;
  const keys = KMAC.flat();
  const glow = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    keys.length,
  );
  const index = new Map<string, number>();
  const m4 = new THREE.Matrix4();
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  let i = 0;
  KMAC.forEach((row, ri) => {
    let x = box.min.x;
    row.forEach(([code, w]) => {
      m4.compose(new THREE.Vector3(x + (w * unit) / 2, box.max.y + 0.0004, box.min.z + rowD * (ri + 0.5)), flat, new THREE.Vector3(w * unit * 0.86, rowD * 0.82, 1));
      glow.setMatrixAt(i, m4);
      glow.setColorAt(i, new THREE.Color(0, 0, 0));
      index.set(code, i);
      x += w * unit;
      i++;
    });
  });
  const amber = new THREE.Color('#ffb000');
  const level = new Float32Array(keys.length);
  const held = new Set<number>();
  const c = new THREE.Color();
  return {
    mesh: glow,
    press(code: string, isDown: boolean) {
      const k = index.get(code);
      if (k === undefined) return;
      if (isDown) {
        held.add(k);
        level[k] = 1;
      } else held.delete(k);
    },
    // fades out once the key is let go; reports whether anything is still lit
    tick(dt: number) {
      let any = false;
      for (let k = 0; k < level.length; k++) {
        if (level[k] <= 0) continue;
        if (!held.has(k)) level[k] = Math.max(0, level[k] - dt * 3.5);
        glow.setColorAt(k, c.copy(amber).multiplyScalar(level[k] * 0.9));
        any = true;
      }
      if (any) glow.instanceColor!.needsUpdate = true;
      return any;
    },
  };
}

/* ---------- the mouse: "Mouse Logitech G203" by JorgeAlfredOwO (Sketchfab, CC BY 4.0) ---------- */

// The file is in its own units, 7 long, sitting off to one side; scaled to the real mouse's 116 mm and centred.
function buildMouse(model: THREE.Object3D) {
  const g = new THREE.Group();
  const S = 0.116 / 6.97;
  model.scale.setScalar(S);
  model.position.set(-4.564 * S, MAT, 0.012 * S);
  g.add(model);
  return g;
}

/* ---------- a wireless charging pad ---------- */

function buildCharger() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.006, 0.1, 4, 0.0028), std('#232326', 0.95));
  pad.position.y = MAT + 0.003;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.0175, 48), std('#4a4a50', 0.6));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = MAT + 0.0062;
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5fb3ff').multiplyScalar(1.2), toneMapped: false }));
  led.rotation.x = -Math.PI / 2;
  led.position.set(0, MAT + 0.0062, 0.042);
  g.add(pad, ring, led);
  return g;
}

/* ---------- the desk lamp: "Tomons Desk Lamp" by chris munoz (Sketchfab, CC BY 4.0) ---------- */

// The model is in its own units (its base is 2.5 across); scaled to a real lamp about 32 cm tall. Its cone points along
// +x+z in the file; place() turns the whole thing. The studio backdrop and light panels it came with are dropped.
function buildLamp(model: THREE.Object3D) {
  const group = new THREE.Group();
  const cones: THREE.MeshStandardMaterial[] = [];
  const S = 0.056;
  ['Backdrop_0', 'LightPanels_0'].forEach((n) => model.getObjectByName(n)?.removeFromParent());
  model.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m) return;
    // the inside of the cone glows with the bulb
    if (/ConeINSIDE/i.test(m.name)) Object.assign(m, { emissive: new THREE.Color('#ffd7a0'), emissiveIntensity: 0.45 }), cones.push(m);
  });
  model.scale.setScalar(S);
  group.add(model);
  // the cone's mouth, in the lamp's own (unscaled) frame
  const head = new THREE.Vector3(1.38 * S, 4.35 * S, 1.45 * S);
  const beam = new THREE.SpotLight('#ffcf98', 1.5, 0.9, 0.6, 0.85, 1.6);
  beam.position.copy(head);
  beam.target.position.set(head.x + 0.08, -0.3, head.z + 0.09);
  beam.castShadow = true;
  beam.shadow.mapSize.set(1024, 1024);
  beam.shadow.bias = -0.0005;
  beam.shadow.radius = 6;
  group.add(beam, beam.target);
  // the light that spills out round the shade, warming the wall and the books
  const spill = new THREE.PointLight('#ffa860', 0.65, 1.5, 1.4);
  spill.position.set(head.x - 0.02, head.y + 0.03, head.z - 0.05);
  group.add(spill);
  group.userData.interact = 'lamp';
  return { group, beam, spill, cones };
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
  let h12 = false;
  const makeFmt = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: h12 ? 'h12' : 'h23', timeZone: 'Asia/Kolkata' });
  let fmt = makeFmt();
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
    toggle12h() {
      h12 = !h12;
      fmt = makeFmt();
      shown = '';
      return h12;
    },
  };
}

/* ---------- a mug of hot coffee, steam curling off it ---------- */

function buildMug() {
  const g = new THREE.Group();
  // a speckled cream glaze stopping short of a raw clay foot
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9dfcc';
  ctx.fillRect(0, 0, c.width, c.height);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${60 + rnd() * 40}, ${45 + rnd() * 30}, ${35 + rnd() * 20}, ${0.25 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.arc(rnd() * c.width, rnd() * c.height * 0.9, 0.6 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#b39b7d';
  ctx.fillRect(0, c.height * 0.93, c.width, c.height * 0.07);
  const glaze = new THREE.CanvasTexture(c);
  glaze.colorSpace = THREE.SRGBColorSpace;
  const mat = std('#ffffff', 0.5, 0, { map: glaze });
  const R = 0.036;
  const H = 0.082;
  const prof = [[0, 0.002], [R - 0.004, 0], [R, 0.004], [R + 0.001, H * 0.5], [R, H], [R - 0.0035, H], [R - 0.0045, 0.008], [0, 0.008]];
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 64), mat);
  body.material.side = THREE.DoubleSide;
  g.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0055, 14, 32, Math.PI * 1.1), std('#e9dfcc', 0.5));
  handle.rotation.z = Math.PI * 0.45;
  handle.position.set(-R - 0.004, H * 0.52, 0);
  g.add(handle);
  // the coffee, a little below the rim, a ring of crema at its edge
  const cc = document.createElement('canvas');
  cc.width = cc.height = 128;
  const cx = cc.getContext('2d')!;
  const grd = cx.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, '#2a150a');
  grd.addColorStop(0.8, '#3a1f0f');
  grd.addColorStop(1, '#8a5a35');
  cx.fillStyle = grd;
  cx.fillRect(0, 0, 128, 128);
  const crema = new THREE.CanvasTexture(cc);
  crema.colorSpace = THREE.SRGBColorSpace;
  // lit by its own colour, so the room's blue overhead light doesn't tint it
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(R - 0.0042, 48), new THREE.MeshBasicMaterial({ map: crema, color: new THREE.Color(0.75, 0.72, 0.7) }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = H - 0.011;
  g.add(coffee);
  // steam: two soft wisps, always turned to the viewer, curling up and thinning out
  const steamU = { uTime: { value: 0 } };
  const wisps: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const w = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 0.12),
      new THREE.ShaderMaterial({
        uniforms: { uTime: steamU.uTime, uSeed: { value: i * 7.3 } },
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uSeed; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main(){
            float t = uTime * 0.35 + uSeed;
            float y = vUv.y;
            float x = vUv.x - 0.5 + sin(y * 6.0 - t * 2.2) * 0.1 * y + sin(y * 13.0 - t * 3.1) * 0.03;
            float wisp = n(vec2(x * 5.0, y * 3.2 - t * 1.6)) * 0.65 + n(vec2(x * 11.0, y * 7.0 - t * 2.6)) * 0.35;
            float col = smoothstep(0.26 * (0.5 + y), 0.0, abs(x));
            float fade = smoothstep(0.0, 0.18, y) * smoothstep(1.0, 0.4, y);
            float a = col * fade * smoothstep(0.42, 0.78, wisp) * 0.15;
            gl_FragColor = vec4(vec3(0.93, 0.91, 0.88), a);
          }`,
      }),
    );
    w.position.set(i ? 0.006 : -0.005, H + 0.058, i ? -0.004 : 0.003);
    w.userData.noAO = true;
    wisps.push(w);
    g.add(w);
  }
  return {
    group: g,
    coffee,
    wisps,
    tick(t: number, cam: THREE.Camera) {
      steamU.uTime.value = t;
      wisps.forEach((w) => {
        const p = w.getWorldPosition(new THREE.Vector3());
        w.rotation.y = Math.atan2(cam.position.x - p.x, cam.position.z - p.z) - g.rotation.y;
      });
    },
  };
}

/* ---------- a succulent rosette in a concrete pot ---------- */

function buildSucculent(opts: { leaf?: string; rings?: number[]; twist?: number } = {}) {
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
  const leafMat = std(opts.leaf ?? '#6f9b6a', 0.6, 0, { emissive: new THREE.Color('#0b1408') });
  const counts = opts.rings ?? [9, 7, 5];
  // rings of fleshy leaves, from wide and flat at the rim to small and upright in the middle
  counts.forEach((n, k) => {
    const t = counts.length > 1 ? k / (counts.length - 1) : 0;
    const ring = { r: 0.022 - 0.017 * t, len: 0.02 - 0.009 * t, tilt: 1.15 - 0.85 * t, y: 0.05 + 0.011 * t };
    for (let i = 0; i < n; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.scale.set(ring.len * 0.55, ring.len * 0.22, ring.len);
      leaf.position.set(0, ring.len * 0.35, ring.r);
      leaf.rotation.x = -(Math.PI / 2 - ring.tilt) * 0.6;
      const pivot = new THREE.Group();
      pivot.position.y = ring.y;
      pivot.rotation.y = (i / n) * Math.PI * 2 + k * (opts.twist ?? 0.4);
      pivot.add(leaf);
      g.add(pivot);
    }
  });
  return g;
}

/* ---------- an AirPods Pro case, standing on the mat; a click flips its lid open on the two buds ---------- */

function buildAirPods() {
  const group = new THREE.Group();
  // the case's real size (60.6 x 45.2 x 21.7 mm): a pebble, its edges rounded all the way to the faces
  const w = 0.0606;
  const h = 0.0452;
  const d = 0.0217;
  const bv = 0.0095; // the edge rounding
  const rr = 0.0075; // the front's corners, inside the rounding
  const seam = 0.0318; // where the lid meets the body, from the bottom
  const sw = w / 2 - bv;
  const sh = h / 2 - bv;
  const outline = new THREE.Shape();
  outline.moveTo(-sw + rr, -sh);
  outline.lineTo(sw - rr, -sh);
  outline.quadraticCurveTo(sw, -sh, sw, -sh + rr);
  outline.lineTo(sw, sh - rr);
  outline.quadraticCurveTo(sw, sh, sw - rr, sh);
  outline.lineTo(-sw + rr, sh);
  outline.quadraticCurveTo(-sw, sh, -sw, sh - rr);
  outline.lineTo(-sw, -sh + rr);
  outline.quadraticCurveTo(-sw, -sh, -sw + rr, -sh);
  const shell = new THREE.ExtrudeGeometry(outline, { depth: d - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 12, curveSegments: 20 });
  shell.center();
  shell.translate(0, h / 2, 0);
  // one smooth surface: the extrusion's rings share their vertices, so its rounding shades without steps
  shell.deleteAttribute('normal');
  shell.deleteAttribute('uv');
  const smooth = mergeVertices(shell, 1e-6);
  smooth.computeVertexNormals();

  const gloss = () =>
    new THREE.MeshPhysicalMaterial({ color: '#f7f7f4', roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2, clipShadows: true });
  // one shell, drawn twice and cut at the seam: below it the body, above it the lid, a hair apart so the seam
  // shows as a fine dark line (the shell's inside is drawn dark)
  const bodyPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), seam - 0.0002);
  const lidPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(seam + 0.0002));
  const bodyMat = gloss();
  const lidMat = gloss();
  const shade = () => new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9, side: THREE.BackSide, clipShadows: true });
  const bodyIn = shade();
  const lidIn = shade();
  bodyMat.clippingPlanes = bodyIn.clippingPlanes = [bodyPlane.clone()];
  lidMat.clippingPlanes = lidIn.clippingPlanes = [lidPlane.clone()];
  const body = new THREE.Mesh(smooth, bodyMat);
  body.add(new THREE.Mesh(smooth, bodyIn));
  group.add(body);

  // the inside, seen with the lid up: a pale floor with the two buds' heads sitting in their wells
  const inner = new THREE.Shape();
  const iw = w / 2 - 0.0012;
  const id = d / 2 - 0.0012;
  const ir = id - 0.0005;
  inner.moveTo(-iw + ir, -id);
  inner.lineTo(iw - ir, -id);
  inner.absarc(iw - ir, -id + ir, ir, -Math.PI / 2, 0, false);
  inner.lineTo(iw, id - ir);
  inner.absarc(iw - ir, id - ir, ir, 0, Math.PI / 2, false);
  inner.lineTo(-iw + ir, id);
  inner.absarc(-iw + ir, id - ir, ir, Math.PI / 2, Math.PI, false);
  inner.lineTo(-iw, -id + ir);
  inner.absarc(-iw + ir, -id + ir, ir, Math.PI, Math.PI * 1.5, false);
  const pale = std('#e4e4e0', 0.6);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(inner, 16), pale);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = seam - 0.0006;
  group.add(floor);
  const well = std('#26262a', 0.7);
  const bud = new THREE.MeshPhysicalMaterial({ color: '#fbfbf8', roughness: 0.3, clearcoat: 0.6 });
  for (const s of [-1, 1]) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0082, 28), well);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(s * 0.0128, seam - 0.0004, 0.0008);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 28, 20), bud);
    head.scale.set(1, 0.62, 1.05);
    head.position.set(s * 0.0128, seam - 0.0012, 0.0008);
    // the dark speaker mesh on each bud, facing up and in
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.0024, 20), well);
    mesh.position.set(s * 0.0122, seam + 0.0036, 0.0002);
    mesh.rotation.set(-Math.PI / 2 + 0.35, 0, s * 0.3);
    group.add(hole, head, mesh);
  }

  // the lid hinges at the back, along the seam
  const hinge = new THREE.Group();
  hinge.position.set(0, seam, -d / 2 + 0.0015);
  group.add(hinge);
  const lid = new THREE.Mesh(smooth, lidMat);
  lid.add(new THREE.Mesh(smooth, lidIn));
  lid.position.set(0, -seam, d / 2 - 0.0015);
  hinge.add(lid);
  const lidInner = new THREE.Mesh(new THREE.ShapeGeometry(inner, 16), pale);
  lidInner.rotation.x = Math.PI / 2;
  lidInner.position.set(0, 0.0004, d / 2 - 0.0015);
  hinge.add(lidInner);

  // the status light, on the front below the seam: dark, until the lid opens
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.00085, 16), new THREE.MeshBasicMaterial({ color: '#2b2b2b', toneMapped: false }));
  led.position.set(0, seam - 0.0115, d / 2 + 0.00015);
  group.add(led);
  const off = new THREE.Color('#2b2b2b');
  const on = new THREE.Color('#3dff86');

  group.userData.interact = 'airpods';
  group.traverse((o) => {
    // the cut shell isn't solid for the occlusion pass, which can't see the cut: keep it out, but clickable
    o.userData.noAO = true;
    o.userData.pickable = true;
  });

  const state = { open: 0 };
  // the planes are in world space: they follow the case where it's placed, the lid's one follows the lid
  const sync = () => {
    hinge.rotation.x = -1.85 * state.open;
    group.updateMatrixWorld(true);
    bodyMat.clippingPlanes![0].copy(bodyPlane).applyMatrix4(body.matrixWorld);
    lidMat.clippingPlanes![0].copy(lidPlane).applyMatrix4(lid.matrixWorld);
    (led.material as THREE.MeshBasicMaterial).color.lerpColors(off, on, Math.min(1, state.open * 1.6));
  };
  return { group, state, sync };
}
