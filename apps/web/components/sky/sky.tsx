'use client';

// The sky. A starfield with real depth over a nebula of layered noise.
// Near-monochrome: night and star white, with exactly two tinted stars.
// Cursor parallax on desktop, gyroscope on phones, 12px at most. Reduced
// motion renders one still frame. devicePixelRatio is capped at 1.5.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The pick from /dev/sky/1, 2, 3: the second sky's density with the third
 * sky's cloud. Contrast is how far the brightest cloud sits from night toward
 * star white; scale is how fine the cloud's structure is.
 */
const SKY = { stars: 15000, contrast: 0.09, scale: 2.0 } as const;

const NIGHT = '#070a10';
const STAR = '#f2eee6';
const GREEN = '#23a55a';
const AMBER = '#d9a21b';

const MAX_PARALLAX_PX = 12;
const MAX_DPR = 1.5;
const FOV = 60;
const NEAR = 50;
const FAR = 1000;
/** Radians per second. One turn in about 26 minutes. */
const DRIFT = 0.004;

export function Sky() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return mount(canvas);
  }, []);

  return <canvas ref={ref} aria-hidden className="block h-full w-full" />;
}

function mount(canvas: HTMLCanvasElement): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(new THREE.Color(NIGHT), 1);
  renderer.autoClear = false;

  const cssSize = new THREE.Vector2();
  const physicalSize = new THREE.Vector2();
  const nebulaSize = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  const parallaxTarget = new THREE.Vector2();

  // Nebula at half resolution, then copied up with a dither so the low
  // contrast does not band.
  const nebulaTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  const nebulaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: nebulaSize },
      uTime: { value: 0 },
      uContrast: { value: SKY.contrast },
      uScale: { value: SKY.scale },
      uNight: { value: new THREE.Color(NIGHT) },
      uLight: { value: new THREE.Color(STAR) },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: NEBULA_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: nebulaTarget.texture }, uResolution: { value: physicalSize } },
    vertexShader: QUAD_VERT,
    fragmentShader: COPY_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.PlaneGeometry(2, 2);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const nebulaScene = new THREE.Scene().add(new THREE.Mesh(quad, nebulaMaterial));
  const copyScene = new THREE.Scene().add(new THREE.Mesh(quad, copyMaterial));

  // Stars.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, FAR + 100);
  const stars = buildStars(SKY.stars);
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uParallax: { value: parallax },
      uResolution: { value: cssSize },
      uPixelRatio: { value: dpr },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(stars, starMaterial);
  points.frustumCulled = false;
  const starScene = new THREE.Scene().add(points);

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    cssSize.set(w, h);
    physicalSize.set(Math.round(w * dpr), Math.round(h * dpr));
    nebulaTarget.setSize(Math.ceil((w * dpr) / 2), Math.ceil((h * dpr) / 2));
    nebulaSize.set(nebulaTarget.width, nebulaTarget.height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.setRenderTarget(nebulaTarget);
    renderer.render(nebulaScene, quadCamera);
    renderer.setRenderTarget(null);
    renderer.render(copyScene, quadCamera);
    renderer.render(starScene, camera);
  }

  const clock = new THREE.Clock();
  let raf = 0;

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    nebulaMaterial.uniforms.uTime!.value += dt;
    points.rotation.z += DRIFT * dt;
    parallax.lerp(parallaxTarget, 1 - Math.exp(-dt * 6));
    render();
  }

  function start() {
    if (reduced) {
      render();
      return;
    }
    if (!raf) {
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    parallaxTarget.set(
      (e.clientX / cssSize.x - 0.5) * 2 * MAX_PARALLAX_PX,
      (0.5 - e.clientY / cssSize.y) * 2 * MAX_PARALLAX_PX,
    );
  };
  const onOrientation = (e: DeviceOrientationEvent) => {
    const gamma = e.gamma ?? 0;
    const beta = e.beta ?? 0;
    parallaxTarget.set(
      THREE.MathUtils.clamp(gamma / 20, -1, 1) * MAX_PARALLAX_PX,
      THREE.MathUtils.clamp((beta - 40) / 20, -1, 1) * MAX_PARALLAX_PX,
    );
  };
  const onVisibility = () => (document.hidden ? stop() : start());
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  resize();
  start();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  if (!reduced) {
    window.addEventListener('pointermove', onPointer, { passive: true });
    if (coarse) window.addEventListener('deviceorientation', onOrientation, { passive: true });
  }

  return () => {
    stop();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
    stars.dispose();
    starMaterial.dispose();
    nebulaMaterial.dispose();
    copyMaterial.dispose();
    quad.dispose();
    nebulaTarget.dispose();
    renderer.dispose();
  };
}

/** Random stars through the depth range, most of them faint, plus two tinted ones far apart. */
function buildStars(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brights = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const star = new THREE.Color(STAR);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  // Past the frustum on both axes, so drift and parallax never reveal an edge.
  const spreadY = 1.25;
  const spreadX = 2.75;

  for (let i = 0; i < count; i++) {
    const depth = NEAR + Math.random() * (FAR - NEAR);
    const halfH = depth * tanHalf;
    positions[i * 3] = (Math.random() * 2 - 1) * halfH * spreadX;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * halfH * spreadY;
    positions[i * 3 + 2] = -depth;
    sizes[i] = 0.7 + Math.random() * 1.1;
    brights[i] = 0.25 + 0.75 * Math.pow(Math.random(), 2.2);
    colors[i * 3] = star.r;
    colors[i * 3 + 1] = star.g;
    colors[i * 3 + 2] = star.b;
  }

  const tint = (i: number, nx: number, ny: number, hex: string) => {
    const depth = 320;
    const halfH = depth * tanHalf;
    const c = new THREE.Color(hex);
    positions[i * 3] = nx * halfH * 1.6;
    positions[i * 3 + 1] = ny * halfH;
    positions[i * 3 + 2] = -depth;
    sizes[i] = 3.2;
    brights[i] = 1;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  };
  tint(0, -0.55, 0.38, GREEN);
  tint(1, 0.62, -0.42, AMBER);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const QUAD_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const NOISE = /* glsl */ `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
`;

const NEBULA_FRAG = /* glsl */ `
uniform vec2 uResolution;
uniform float uTime;
uniform float uContrast;
uniform float uScale;
uniform vec3 uNight;
uniform vec3 uLight;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * uScale;
  float t = uTime * 0.008;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 1.6 * q);
  n = smoothstep(0.32, 0.78, n);
  float breath = 0.85 + 0.15 * noise(p * 0.5 + t);
  gl_FragColor = vec4(mix(uNight, uLight, n * uContrast * breath), 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uResolution;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
void main() {
  vec3 c = texture2D(uMap, gl_FragCoord.xy / uResolution).rgb;
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
uniform vec2 uParallax;
uniform vec2 uResolution;
uniform float uPixelRatio;
varying float vBright;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  float depth01 = clamp((-mv.z - ${NEAR.toFixed(1)}) / ${(FAR - NEAR).toFixed(1)}, 0.0, 1.0);
  float layer = 1.0 - depth01;
  // Screen-space shift: near stars get the full 12px, far ones a little.
  clip.xy += (uParallax / (0.5 * uResolution)) * clip.w * (0.15 + 0.85 * layer);
  gl_Position = clip;
  gl_PointSize = aSize * uPixelRatio * (1.0 + 1.8 * layer);
  vBright = aBright * (0.4 + 0.6 * layer);
  vColor = aColor;
}
`;

const STAR_FRAG = /* glsl */ `
varying float vBright;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.3, d);
  gl_FragColor = vec4(vColor, a * vBright);
}
`;
