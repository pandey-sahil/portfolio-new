import { gsap } from 'gsap';
import type { Stage } from './stage3d';

// SAHIL/OS: camera, CRT warm-up, power, window manager, clock, typing and sound.

const ROUTES: Record<string, string> = {
  work: '/work',
  about: '/about',
  experience: '/experience',
  stack: '/stack',
  notes: '/notes',
  contact: '/contact',
};

const TITLES: Record<string, string> = {
  work: 'Work',
  about: 'About',
  experience: 'Experience',
  stack: 'Stack',
  notes: 'Done',
  contact: 'Contact',
};

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPhone = () => window.matchMedia('(max-width: 820px)').matches;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

/* ---------- sound ---------- */

let audio: AudioContext | null = null;
let soundOn = false;
let rainGain: GainNode | null = null;

// The audio context, woken up: browsers start it paused unless a click or key press made it, so every use resumes it.
function ctx(): AudioContext {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  return audio;
}

function blip(freq = 880, dur = 0.05) {
  if (!soundOn) return;
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.06, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

// Slow rain outside the window while the sound is on: a soft, muffled hiss heard through the glass, single drops
// tapping the sill now and then, and the whole thing swelling and easing as the rain comes and goes.
function setRain(on: boolean) {
  const a = ctx();
  if (!rainGain) {
    if (!on) return;
    const rate = a.sampleRate;
    const len = rate * 12;
    const buf = a.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.06;
      }
      // drops: a few a second, each a tiny tap that dies away in a few milliseconds
      const drops = 12 * 4;
      for (let k = 0; k < drops; k++) {
        const at = Math.floor(Math.random() * (len - rate * 0.05));
        const amp = 0.08 + Math.random() * 0.18;
        const pitch = 900 + Math.random() * 1800;
        for (let j = 0; j < rate * 0.03; j++) {
          const env = Math.exp(-j / (rate * 0.004));
          d[at + j] += Math.sin((2 * Math.PI * pitch * j) / rate) * env * amp;
        }
      }
    }
    const src = a.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400; // muffled, through the window
    const swell = a.createGain();
    swell.gain.value = 0.85;
    const lfo = a.createOscillator();
    lfo.frequency.value = 0.06; // a slow swell, about every 16 seconds
    const lfoDepth = a.createGain();
    lfoDepth.gain.value = 0.15;
    lfo.connect(lfoDepth).connect(swell.gain);
    rainGain = a.createGain();
    rainGain.gain.value = 0;
    src.connect(hp).connect(lp).connect(swell).connect(rainGain).connect(a.destination);
    src.start();
    lfo.start();
  }
  rainGain.gain.cancelScheduledValues(a.currentTime);
  rainGain.gain.setTargetAtTime(on ? 0.16 : 0, a.currentTime, on ? 1.2 : 0.25);
}

let noticeTimer = 0;
function notice(text: string) {
  const el = $('dock-notice');
  if (!el) return;
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => el.classList.remove('is-on'), 2600);
}

function initSound() {
  const btn = $('sound');
  if (!btn) return;
  try {
    soundOn = localStorage.getItem('sahilos-sound') === 'on';
  } catch {}
  const sync = () => {
    btn.setAttribute('aria-pressed', String(soundOn));
    btn.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
  };
  sync();
  btn.addEventListener('click', () => {
    soundOn = !soundOn;
    try {
      localStorage.setItem('sahilos-sound', soundOn ? 'on' : 'off');
    } catch {}
    sync();
    setRain(soundOn);
    blip(1320, 0.06);
    notice(soundOn ? 'Sound on. Rain outside.' : 'Sound off.');
  });
  // sound left on from a visit before: start it with the first click or key press (browsers allow no sooner)
  const wake = (e: Event) => {
    if (e.target instanceof Node && btn.contains(e.target)) return;
    if (soundOn) setRain(true);
  };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
}

/* ---------- clock and typing ---------- */

function initClock() {
  const el = $('clock');
  if (!el) return;
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  // checked every second, so it turns over with the desk clock rather than up to 10 s late
  const tick = () => {
    const now = new Date();
    const text = fmt.format(now);
    if (el.textContent === text) return;
    el.textContent = text;
    el.setAttribute('datetime', now.toISOString());
  };
  tick();
  setInterval(tick, 1000);
}

let typeTimer = 0;
function typeTagline() {
  const el = $('typed');
  const text = el?.dataset.text;
  if (!el || !text || reduced()) return;
  clearTimeout(typeTimer);
  el.textContent = '';
  let i = 0;
  const step = () => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) typeTimer = window.setTimeout(step, 18 + Math.random() * 30);
  };
  typeTimer = window.setTimeout(step, 200);
}

/* ---------- camera ---------- */
// Three framings of the night-desk image: 0 the screen fills the view, 1 the desk around the laptop, 2 the whole image.

type Frame = { scale: number; x: number; y: number };
let level = 1;
let camScale = 1;
// the 3D night desk, when it runs (desktop with WebGL); otherwise the image rig below moves instead
let stage: Stage | null = null;
// when opening a window zoomed the camera in on its own, the framing to go back to once the last window closes
let autoFrom: number | null = null;

// The scene image in its own pixels (1084 x 1451; the file is 2x). U css px per image px: the laptop's display,
// 641.5 px wide in the image, is the 1100px screen (global.css places everything with the same unit).
const PHOTO = { w: 1084, h: 1451 };
const U = 1100 / 641.5;
const SCREEN = { l: 276, t: 420, r: 916, b: 844 };

function frames(): Frame[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // the camera offset that centres image point (px, py) in the viewport at scale s
  const at = (s: number, px: number, py: number): Frame => ({
    scale: s,
    x: -s * (px - PHOTO.w / 2) * U,
    y: -s * (py - PHOTO.h / 2) * U,
  });
  const screen = Math.min((vw - 128) / ((SCREEN.r - SCREEN.l) * U), (vh - 24) / ((SCREEN.b - SCREEN.t) * U));
  // the desk: the image's full width, unless that leaves too little height around the screen
  const desk = Math.min(vw / (PHOTO.w * U), vh / (560 * U));
  const half = vh / (2 * desk * U);
  const deskY = half * 2 >= PHOTO.h ? PHOTO.h / 2 : Math.min(Math.max(668, half), PHOTO.h - half);
  const whole = Math.min(vw / (PHOTO.w * U), vh / (PHOTO.h * U));
  return [
    at(screen, (SCREEN.l + SCREEN.r) / 2, (SCREEN.t + SCREEN.b) / 2),
    at(desk, PHOTO.w / 2, deskY),
    at(whole, PHOTO.w / 2, PHOTO.h / 2),
  ];
}

// the framing to rest on: the desk when the screen's text stays readable there, else the close-up
function restLevel() {
  if (stage) return 1;
  return frames()[1].scale >= 0.66 ? 1 : 0;
}

function setCamera(next: number, duration = 1.1, persist = true) {
  const cam = $('camera');
  if (!cam || isPhone()) return;
  level = Math.max(0, Math.min(2, next));
  $('scene')?.classList.toggle('is-far', level === 2);
  const zin = $<HTMLButtonElement>('zoom-in');
  const zout = $<HTMLButtonElement>('zoom-out');
  if (zin) zin.disabled = level === 0;
  if (zout) zout.disabled = level === 2;
  if (persist) {
    try {
      localStorage.setItem('sahilos-zoom', String(level));
    } catch {}
  }
  if (stage) {
    stage.setLevel(level, duration);
    return;
  }
  const f = frames()[level];
  camScale = f.scale;
  if (duration === 0 || reduced()) gsap.set(cam, { scale: f.scale, x: f.x, y: f.y });
  else gsap.to(cam, { scale: f.scale, x: f.x, y: f.y, duration, ease: 'power3.inOut', overwrite: true });
}

function initCamera() {
  $('zoom-in')?.addEventListener('click', () => {
    autoFrom = null;
    blip(990);
    setCamera(level - 1);
  });
  $('zoom-out')?.addEventListener('click', () => {
    autoFrom = null;
    blip(660);
    setCamera(level + 1);
  });
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      if (stage) return; // the 3D stage keeps its own framing on resize
      if (isPhone()) {
        camScale = 1;
        gsap.set('#camera', { clearProps: 'transform' });
      } else setCamera(level, 0, false);
    }, 120);
  });
}

/* ---------- CRT warm-up and power ---------- */

let powered = true;
let offTl: gsap.core.Timeline | null = null;

// The screen comes on as the power-off animation played backwards: a dot, a line, then the picture.
function warmUp(): gsap.core.Timeline {
  const inner = $('screen-inner');
  const tl = gsap.timeline();
  if (!inner || reduced()) return tl;
  tl.set(inner, { opacity: 0, scaleX: 0, scaleY: 0.006, filter: 'brightness(3)' })
    .to(inner, { opacity: 1, duration: 0.08 })
    .to(inner, { scaleX: 1, duration: 0.22, ease: 'power2.out' })
    .to(inner, { scaleY: 1, filter: 'brightness(1)', duration: 0.3, ease: 'power2.out' })
    .set(inner, { clearProps: 'transform,filter,opacity' });
  return tl;
}

function powerOff() {
  const scene = $('scene');
  const inner = $('screen-inner');
  if (!scene || !inner || !powered) return;
  powered = false;
  blip(220, 0.12);
  $('power')?.setAttribute('aria-pressed', 'false');
  stage?.setPower(false);
  const done = () => {
    offTl = null;
    if (powered) return;
    scene.classList.add('is-off');
    gsap.set(inner, { clearProps: 'all' });
    const off = $('screen-off');
    if (off) off.hidden = false;
    notice('Screen off.');
  };
  if (reduced()) return done();
  offTl = gsap
    .timeline({ onComplete: done })
    .to(inner, { scaleY: 0.006, filter: 'brightness(3)', duration: 0.18, ease: 'power2.in' })
    .to(inner, { scaleX: 0, duration: 0.14, ease: 'power2.in' })
    .to(inner, { opacity: 0, duration: 0.08 });
}

function powerOn() {
  const scene = $('scene');
  if (!scene || powered) return;
  powered = true;
  offTl?.kill();
  offTl = null;
  gsap.set('#screen-inner', { clearProps: 'all' });
  blip(520, 0.1);
  $('power')?.setAttribute('aria-pressed', 'true');
  stage?.setPower(true);
  const off = $('screen-off');
  if (off) off.hidden = true;
  scene.classList.remove('is-off');
  warmUp();
  typeTagline();
}

function initPower() {
  $('power')?.addEventListener('click', () => (powered ? powerOff() : powerOn()));
  window.addEventListener('keydown', (e) => {
    // the power button handles its own Enter/Space through click
    if ((e.target as HTMLElement).id === 'power' && (e.key === 'Enter' || e.key === ' ')) return;
    if (!powered && !e.metaKey && !e.ctrlKey && e.key !== 'Tab' && e.key !== 'Shift') powerOn();
  });
}

/* ---------- windows ---------- */

// windows stack from here up, above the menu bar and the dock (z-index 500), so their buttons are never under them
let z = 1000;
let cascade = 0;
const openOrder: string[] = [];

const win = (id: string) => document.getElementById(`win-${id}`) as HTMLElement | null;

function place(el: HTMLElement) {
  if (el.dataset.placed || isPhone()) return;
  const desk = $('desktop')!;
  const W = desk.clientWidth;
  const H = desk.clientHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = Math.max(12, Math.min(W - w - 12, W * 0.5 - w * 0.35 + cascade * 28));
  const top = Math.max(12, Math.min(H - h - 12, H * 0.07 + cascade * 28));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.dataset.placed = '1';
  cascade = (cascade + 1) % 5;
}

function focusWin(id: string) {
  const el = win(id);
  if (!el) return;
  el.style.zIndex = String(++z);
  document.querySelectorAll('.win').forEach((w) => w.classList.toggle('is-front', w === el));
  const i = openOrder.indexOf(id);
  if (i > -1) openOrder.splice(i, 1);
  openOrder.push(id);
  renderDock();
}

function syncTitle(id: string | null) {
  document.title = id ? `${TITLES[id]} — Sahil Pandey` : 'Sahil Pandey — Webflow Developer';
}

function pushRoute(id: string | null) {
  const path = id ? ROUTES[id] : '/';
  syncTitle(id);
  if (path && location.pathname !== path) history.pushState({ win: id }, '', path);
}

function openWin(id: string, opts: { push?: boolean; animate?: boolean } = {}) {
  const el = win(id);
  if (!el) return;
  if (!powered) powerOn();
  const wasHidden = el.hidden;
  el.hidden = false;
  place(el);
  focusWin(id);
  if (wasHidden) {
    blip(660);
    if (opts.animate !== false && !reduced()) {
      gsap.fromTo(
        el,
        { opacity: 0, scale: 0.94, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.22, ease: 'power2.out', clearProps: 'opacity,transform' },
      );
    }
  }
  if (opts.push !== false) pushRoute(id);
  el.querySelector<HTMLElement>('.win-title')?.focus({ preventScroll: true });
}

function closeWin(id: string, opts: { push?: boolean } = {}) {
  const el = win(id);
  if (!el || el.hidden) return;
  blip(330);
  const done = () => {
    el.hidden = true;
    el.classList.remove('is-max', 'is-front');
    el.querySelector('[data-max]')?.setAttribute('aria-pressed', 'false');
    gsap.set(el, { clearProps: 'opacity,transform' });
    const i = openOrder.indexOf(id);
    if (i > -1) openOrder.splice(i, 1);
    const next = openOrder[openOrder.length - 1];
    if (next) focusWin(next);
    else {
      renderDock();
      if (autoFrom !== null) setCamera(autoFrom, 1.1, false);
      autoFrom = null;
    }
    if (opts.push !== false) pushRoute(next ?? null);
    document.querySelector<HTMLElement>(`.icon[data-open="${id}"]`)?.focus({ preventScroll: true });
  };
  if (reduced()) done();
  else gsap.to(el, { opacity: 0, scale: 0.96, y: 6, duration: 0.14, ease: 'power2.in', onComplete: done });
}

function renderDock() {
  const tabs = $('dock-tabs');
  const hint = $('dock-hint');
  if (!tabs || !hint) return;
  hint.hidden = openOrder.length > 0;
  const front = openOrder[openOrder.length - 1];
  tabs.replaceChildren(
    ...[...openOrder].sort().map((id) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dock-tab' + (id === front ? ' is-front' : '');
      b.textContent = win(id)?.querySelector('.win-title')?.textContent ?? id;
      b.addEventListener('click', () => {
        focusWin(id);
        pushRoute(id);
      });
      li.append(b);
      return li;
    }),
  );
}

function initDrag(el: HTMLElement) {
  const bar = el.querySelector<HTMLElement>('[data-drag]');
  if (!bar) return;
  bar.addEventListener('pointerdown', (e) => {
    if (isPhone() || el.classList.contains('is-max') || (e.target as HTMLElement).closest('.win-btn')) return;
    const desk = $('desktop')!;
    const s = stage ? stage.screenScale() : camScale || 1;
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = el.offsetLeft;
    const oy = el.offsetTop;
    bar.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    const move = (ev: PointerEvent) => {
      const x = ox + (ev.clientX - startX) / s;
      const y = oy + (ev.clientY - startY) / s;
      el.style.left = `${Math.max(-el.offsetWidth + 80, Math.min(desk.clientWidth - 80, x))}px`;
      el.style.top = `${Math.max(0, Math.min(desk.clientHeight - 40, y))}px`;
    };
    const up = () => {
      el.classList.remove('is-dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
}

// a window opened from a click: bring the camera in close to the screen (not on phones, where there is no camera)
function zoomToScreen() {
  if (isPhone() || level === 0) return;
  autoFrom = level;
  setCamera(0, 1.1, false);
}

// From the whole-desk view the screen is too small to use: a click on it brings the camera in close instead.
function initScreenZoom() {
  const screen = $('screen');
  if (!screen) return;
  screen.addEventListener(
    'click',
    (e) => {
      if (isPhone() || level !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      blip(990);
      autoFrom = null;
      setCamera(0);
    },
    true,
  );
}

function initWindows() {
  document.querySelectorAll<HTMLElement>('.win').forEach((el) => {
    const id = el.dataset.win!;
    el.querySelector<HTMLElement>('.win-title')?.setAttribute('tabindex', '-1');
    el.addEventListener('pointerdown', () => focusWin(id));
    el.querySelector('[data-close]')?.addEventListener('click', (e) => {
      e.preventDefault();
      closeWin(id);
    });
    el.querySelector('[data-max]')?.addEventListener('click', (e) => {
      const on = el.classList.toggle('is-max');
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on));
      blip(990);
    });
    initDrag(el);
  });

  document.querySelectorAll<HTMLAnchorElement>('[data-open]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openWin(a.dataset.open!);
      zoomToScreen();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !powered) return;
    const front = openOrder[openOrder.length - 1];
    if (front) closeWin(front);
  });

  window.addEventListener('popstate', () => {
    const id = Object.keys(ROUTES).find((k) => ROUTES[k] === location.pathname) ?? null;
    syncTitle(id);
    openOrder.slice().forEach((o) => {
      if (o !== id) closeWin(o, { push: false });
    });
    if (id) openWin(id, { push: false });
  });

  // a window the server rendered open (deep link) joins the manager
  document.querySelectorAll<HTMLElement>('.win[data-start-open]').forEach((el) => {
    el.hidden = true;
    openWin(el.dataset.win!, { push: false, animate: false });
  });
}

/* ---------- about: setup stepper ---------- */

function initSetup() {
  document.querySelectorAll<HTMLElement>('[data-setup]').forEach((root) => {
    const steps = [...root.querySelectorAll<HTMLButtonElement>('.setup-step')];
    const panels = [...root.querySelectorAll<HTMLElement>('.setup-panel')];
    const back = root.querySelector<HTMLButtonElement>('[data-setup-back]')!;
    const next = root.querySelector<HTMLButtonElement>('[data-setup-next]')!;
    const n = root.querySelector<HTMLElement>('[data-setup-n]');
    const fill = root.querySelector<HTMLElement>('[data-setup-fill]');
    const last = steps.length - 1;
    let at = 0;

    const show = (i: number, animate = true) => {
      at = Math.max(0, Math.min(last, i));
      steps.forEach((b, k) => {
        if (k === at) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
        b.classList.toggle('is-done', k < at);
        const check = b.querySelector('.setup-check');
        if (check) check.textContent = k < at ? '[x]' : k === at ? '[>]' : '[ ]';
      });
      panels.forEach((p, k) => p.classList.toggle('is-active', k === at));
      if (n) n.textContent = String(at + 1);
      back.disabled = at === 0;
      next.textContent = at === last ? 'Start a project' : 'Next';
      const pct = `${((at + 1) / steps.length) * 100}%`;
      if (fill) {
        if (animate && !reduced()) gsap.to(fill, { width: pct, duration: 0.4, ease: 'steps(6)' });
        else gsap.set(fill, { width: pct });
      }
      if (animate && !reduced()) {
        gsap.fromTo(panels[at], { opacity: 0, x: 8 }, { opacity: 1, x: 0, duration: 0.2, ease: 'power2.out', clearProps: 'opacity,transform' });
      }
    };

    steps.forEach((b, k) =>
      b.addEventListener('click', () => {
        blip(760);
        show(k);
      }),
    );
    back.addEventListener('click', () => {
      blip(540);
      show(at - 1);
    });
    next.addEventListener('click', () => {
      if (at === last) {
        blip(1180, 0.09);
        steps.forEach((b) => {
          b.classList.add('is-done');
          const check = b.querySelector('.setup-check');
          if (check) check.textContent = '[x]';
        });
        openWin('contact');
        return;
      }
      blip(880);
      show(at + 1);
    });

    root.classList.add('is-ready');
    show(0, false);
  });
}

/* ---------- start ---------- */

export function initOS() {
  // keep animations on the wall clock: on a slow or throttled frame rate the intro still ends on time
  gsap.ticker.lagSmoothing(0);
  initClock();
  initSound();
  initPower();
  initCamera();
  initWindows();
  initScreenZoom();
  initSetup();

  let saved: number | null = null;
  let seen = false;
  try {
    const z = localStorage.getItem('sahilos-zoom');
    saved = z === null ? null : Number(z);
    seen = sessionStorage.getItem('sahilos-booted') === '1';
  } catch {}
  if (saved !== null && (!Number.isFinite(saved) || saved < 0 || saved > 2)) saved = null;
  // ?view=0|1|2 opens straight on a framing (handy for links and screenshots), skipping the intro
  const view = new URLSearchParams(location.search).get('view');
  if (view !== null && /^[012]$/.test(view)) {
    saved = Number(view);
    seen = true;
  }
  const markSeen = () => {
    try {
      sessionStorage.setItem('sahilos-booted', '1');
    } catch {}
  };

  if (isPhone()) {
    if (!seen) warmUp().call(markSeen);
    typeTagline();
    return;
  }

  void startDesk(saved, seen, markSeen);
}

// Desktop: the 3D night desk (three.js loads only here); without WebGL, the night-desk image with the screen on it.
async function startDesk(saved: number | null, seen: boolean, markSeen: () => void) {
  const scene = $('scene')!;
  scene.classList.add('is-loading-3d');
  try {
    const { createStage } = await import('./stage3d');
    stage = await createStage(scene);
  } catch {
    stage = null;
  }
  scene.classList.remove('is-loading-3d');
  if (stage) scene.classList.add('is-3d');
  else await showImage(scene);

  const rest = openOrder.length ? 0 : saved ?? restLevel();
  if (openOrder.length) autoFrom = saved ?? restLevel();
  if (seen || reduced()) {
    setCamera(rest, 0, saved !== null && !openOrder.length);
    typeTagline();
    markSeen();
    return;
  }

  // first visit: the whole desk, the lid shut; it opens all the way, the screen switches on, the camera moves in
  setCamera(2, 0, false);
  if (stage) {
    stage.prepareIntro();
    gsap.set('#screen-inner', { opacity: 0 });
    gsap.delayedCall(0.6, () => stage!.openLid(1.7));
    gsap.delayedCall(0.6 + 1.7 + 0.15, () => {
      stage!.setPower(true);
      warmUp().call(() => {
        typeTagline();
        setCamera(rest, 2.2, saved !== null && !openOrder.length);
        markSeen();
      });
    });
    return;
  }
  // the image: the screen dark at first; it warms up, its glow comes back to the keys, the camera moves in
  scene.classList.add('is-booting');
  gsap.delayedCall(0.9, () => {
    scene.classList.remove('is-booting');
    warmUp().call(() => {
      typeTagline();
      setCamera(rest, 2.2, saved !== null && !openOrder.length);
      markSeen();
    });
  });
}

// the fallback scene: wait for the image, then show it with its live clock
async function showImage(scene: HTMLElement) {
  scene.classList.add('is-loading');
  const img = new Image();
  img.src = '/images/room/night-desk.jpg';
  await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  scene.classList.remove('is-loading');
  scene.classList.add('is-photo');
  initRoomClock();
}

// The desk clock's hands (the image's own are painted out), on Bhopal time like the menu bar.
function initRoomClock() {
  const h = $('hand-h');
  const m = $('hand-m');
  const sec = $('hand-s');
  if (!h || !m || !sec) return;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  });
  let last = -1;
  const tick = () => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date())) p[part.type] = Number(part.value);
    const mins = p.minute + p.second / 60;
    h.style.rotate = `${((p.hour % 12) + mins / 60) * 30}deg`;
    m.style.rotate = `${mins * 6}deg`;
    // the second hand counts up through the hour so its tick never swings back, except on the hour itself
    const a = (p.minute * 60 + p.second) * 6;
    sec.style.transition = a < last ? 'none' : '';
    sec.style.rotate = `${a}deg`;
    last = a;
  };
  tick();
  setInterval(tick, 1000);
}
