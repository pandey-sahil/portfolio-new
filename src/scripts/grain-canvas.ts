import { Renderer, Program, Mesh, Triangle } from 'ogl';

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Same hash-noise + uniform time-offset technique as Grainient's grain term:
//   grainUv = uv * scale (+ iTime * speed when animated)
//   grain   = fract(sin(dot(grainUv, vec2(12.9898, 78.233))) * 43758.5453)
// The offset is a constant added to every pixel's sampling coordinate, so the
// whole noise field pans smoothly rather than flickering per frame.
const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uGrainScale;
uniform float uSpeed;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  vec2 grainUv = uv * uGrainScale + vec2(iTime * uSpeed, iTime * uSpeed);
  float grain = fract(sin(dot(grainUv, vec2(12.9898, 78.233))) * 43758.5453);
  fragColor = vec4(vec3(grain), uOpacity);
}
`;

export interface GrainCanvasOptions {
  grainScale?: number;
  speed?: number;
  opacity?: number;
}

export function createGrainCanvas(container: HTMLElement, options: GrainCanvasOptions = {}): () => void {
  const { grainScale = 300, speed = 0.05, opacity = 0.05 } = options;

  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });

  const gl = renderer.gl;
  const canvas = gl.canvas as HTMLCanvasElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uGrainScale: { value: grainScale },
      uSpeed: { value: speed },
      uOpacity: { value: opacity },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });

  const setSize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h);
    const res = program.uniforms.iResolution.value as Float32Array;
    res[0] = gl.drawingBufferWidth;
    res[1] = gl.drawingBufferHeight;
    renderer.render({ scene: mesh });
  };

  const ro = new ResizeObserver(setSize);
  ro.observe(container);
  setSize();

  let raf = 0;
  let isPageVisible = !document.hidden;
  const t0 = performance.now();

  const loop = (t: number) => {
    program.uniforms.iTime.value = (t - t0) * 0.001;
    renderer.render({ scene: mesh });
    raf = requestAnimationFrame(loop);
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const tryStart = () => {
    if (reducedMotion.matches) return;
    if (isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
  };
  const tryStop = () => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const onVisibility = () => {
    isPageVisible = !document.hidden;
    isPageVisible ? tryStart() : tryStop();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onReducedMotionChange = () => {
    if (reducedMotion.matches) tryStop();
    else tryStart();
  };
  reducedMotion.addEventListener('change', onReducedMotionChange);

  if (reducedMotion.matches) {
    renderer.render({ scene: mesh });
  } else {
    tryStart();
  }

  return function destroy() {
    tryStop();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    reducedMotion.removeEventListener('change', onReducedMotionChange);
    try {
      container.removeChild(canvas);
    } catch {
      /* ignore */
    }
  };
}
