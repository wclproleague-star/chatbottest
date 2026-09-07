'use client';

// The sky, and the beacon standing in it. A starfield with real depth over a
// nebula of layered noise, near-monochrome: night and star white, with exactly
// two tinted stars. Cursor parallax on desktop, gyroscope on phones, 12px at
// most for the stars. Reduced motion renders one still frame. devicePixelRatio
// is capped at 1.5.
//
// The canvas is transparent and the sky is painted as added light, so it can
// sit over a scene photograph, and over type, without covering either. With
// `horizon` set it paints only above that line, feathered; dawn then drops the
// edge below the canvas while the sky dissolves to opaque paper with the
// nebula's own noise. `boost` names a viewport rect (the thread panel) behind
// which the cloud is a little denser.
//
// `beacon` puts the 3D beacon in the same canvas, drawn last over the sky
// with its own post pass; see beacon.ts. Being opaque in a canvas that sits
// over the type, it stands in front of it.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createBeacon } from './beacon';
import type { BeaconPlacement } from './beacon';

export type { BeaconPlacement, Light } from './beacon';

// The shaders write colours straight to the canvas, so colours must stay in
// sRGB as written: paper has to land on #EDEFF1 exactly, not its linear value.
THREE.ColorManagement.enabled = false;

/**
 * The pick from /dev/sky/1, 2, 3: the second sky's density with the third
 * sky's cloud. Contrast is how far the brightest cloud sits from night toward
 * star white; scale is how fine the cloud's structure is.
 */
const SKY = { stars: 15000, contrast: 0.09, scale: 2.0 } as const;

/** How much denser the cloud is behind the boost rect, in units of n (0 to 1). */
const BOOST_DENSITY = 0.5;
/** Padding around the boost rect, CSS px, so the edge is never seen. */
const BOOST_PAD = 48;
/** The sky fades out over this many CSS px above the horizon. */
const HORIZON_FEATHER = 96;
/** Dawn: the edge reaches the bottom of the canvas by this much of the band. */
const HERO_FADE_END = 1 / 3;

const NIGHT = '#070a10';
const DUSK = '#1a2030';
const PAPER = '#edeff1';
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

export type SkyRect = { x: number; y: number; width: number; height: number };

type Handle = {
  setDawn: (p: number) => void;
  setBoost: (rect: SkyRect | null) => void;
  setContrast: (c: number) => void;
  setHorizon: (px: number | null) => void;
  setBeacon: (b: BeaconPlacement | null) => void;
  /** Frames per second while the page is busy; 0 for as fast as it can. */
  setFrameCap: (fps: number) => void;
  dispose: () => void;
};

export function Sky({
  dawn = 0,
  boost = null,
  contrast = SKY.contrast,
  horizon = null,
  beacon = null,
  density = 1,
  parallax = true,
  fps = 0,
  onReady,
}: {
  dawn?: number;
  boost?: SkyRect | null;
  /** The cloud's contrast; 0.09 alone, 0.12 when it sits against a horizon. */
  contrast?: number;
  /** Where the sky ends, CSS px from the top of the canvas. Null paints the whole canvas. */
  horizon?: number | null;
  beacon?: BeaconPlacement | null;
  /**
   * How many stars, against the hero's. Half of them behind a screen with one
   * sentence on it, where the sky is the room rather than the subject.
   */
  density?: number;
  /** Whether the stars follow the cursor. Off where nothing else moves. */
  parallax?: boolean;
  /**
   * A ceiling on the frame rate, while the page is waiting on something that
   * matters more than the drift of the stars. 0 is as fast as the display.
   */
  fps?: number;
  onReady?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<Handle | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const initial = useRef({ dawn, boost, contrast, horizon, beacon });
  initial.current = { dawn, boost, contrast, horizon, beacon };

  useEffect(() => {
    handle.current?.setFrameCap(fps);
  }, [fps]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const h = mount(canvas, () => readyRef.current?.(), { density, parallax });
    const i = initial.current;
    h.setContrast(i.contrast);
    h.setHorizon(i.horizon);
    h.setBeacon(i.beacon);
    h.setBoost(i.boost);
    h.setDawn(i.dawn);
    handle.current = h;
    return () => {
      h.dispose();
      handle.current = null;
    };
    // density and parallax are read once: both are how the sky is built.
  }, []);

  useEffect(() => {
    handle.current?.setDawn(dawn);
  }, [dawn]);
  useEffect(() => {
    handle.current?.setBoost(boost);
  }, [boost]);
  useEffect(() => {
    handle.current?.setContrast(contrast);
  }, [contrast]);
  useEffect(() => {
    handle.current?.setHorizon(horizon);
  }, [horizon]);
  useEffect(() => {
    handle.current?.setBeacon(beacon);
  }, [beacon]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="block h-full w-full opacity-0 transition-opacity duration-[600ms] ease-out"
    />
  );
}

function mount(
  canvas: HTMLCanvasElement,
  onReady: () => void,
  options: { density: number; parallax: boolean } = { density: 1, parallax: true },
): Handle {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  const cssSize = new THREE.Vector2();
  const physicalSize = new THREE.Vector2();
  const nebulaSize = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  const parallaxTarget = new THREE.Vector2();
  const night = new THREE.Color(NIGHT);
  const dusk = new THREE.Color(DUSK);
  const paper = new THREE.Color(PAPER);
  const surface = new THREE.Color(NIGHT);
  const boost = new THREE.Vector4(0.5, 0.5, 0.001, 0.001);
  let boostRect: SkyRect | null = null;
  let horizonPx: number | null = null;
  let dawnNow = 0;

  // Nebula at half resolution, then copied up with a dither so the low
  // contrast does not band. Dawn dissolves it here, with its own noise. The
  // copy also cuts the sky off at the horizon.
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
      uNight: { value: night },
      uLight: { value: new THREE.Color(STAR) },
      uDawn: { value: 0 },
      uSurface: { value: surface },
      uBoost: { value: boost },
      uBoostK: { value: 0 },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: NEBULA_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const edge = { value: 1e6 };
  const feather = { value: HORIZON_FEATHER * dpr };
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: nebulaTarget.texture },
      uResolution: { value: physicalSize },
      uDawn: { value: 0 },
      uEdge: edge,
      uFeather: feather,
    },
    vertexShader: QUAD_VERT,
    fragmentShader: COPY_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  const quad = new THREE.PlaneGeometry(2, 2);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const nebulaScene = new THREE.Scene().add(new THREE.Mesh(quad, nebulaMaterial));
  const copyScene = new THREE.Scene().add(new THREE.Mesh(quad, copyMaterial));

  // Stars.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, FAR + 100);
  const stars = buildStars(Math.round(SKY.stars * options.density));
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uParallax: { value: parallax },
      uResolution: { value: cssSize },
      uPhysical: { value: physicalSize },
      uPixelRatio: { value: dpr },
      uDawn: { value: 0 },
      uEdge: edge,
      uFeather: feather,
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new THREE.Points(stars, starMaterial);
  points.frustumCulled = false;
  const starScene = new THREE.Scene().add(points);

  // The beacon.
  const beacon = createBeacon(renderer);
  let placement: BeaconPlacement | null = null;

  function applyBoost() {
    const w = cssSize.x || 1;
    const h = cssSize.y || 1;
    if (!boostRect) {
      nebulaMaterial.uniforms.uBoostK!.value = 0;
      return;
    }
    const r = boostRect;
    boost.set(
      (r.x + r.width / 2) / w,
      1 - (r.y + r.height / 2) / h,
      (r.width / 2 + BOOST_PAD) / w,
      (r.height / 2 + BOOST_PAD) / h,
    );
    nebulaMaterial.uniforms.uBoostK!.value = BOOST_DENSITY;
  }

  /** Where the sky stops, in physical px from the top: the horizon, dropping below the canvas with dawn. */
  function applyEdge() {
    if (horizonPx === null) {
      edge.value = 1e6;
      return;
    }
    const bottom = cssSize.y + HORIZON_FEATHER;
    const k = Math.min(1, dawnNow / HERO_FADE_END);
    edge.value = (horizonPx + (bottom - horizonPx) * k) * dpr;
  }

  function applyBeacon() {
    beacon.group.visible = placement !== null;
    if (placement) beacon.place(placement, cssSize, parallax);
  }

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
    applyBoost();
    applyEdge();
    applyBeacon();
  }

  function render() {
    renderer.setRenderTarget(nebulaTarget);
    renderer.render(nebulaScene, quadCamera);
    renderer.setRenderTarget(null);
    renderer.clear(true, true, false);
    renderer.render(copyScene, quadCamera);
    renderer.render(starScene, camera);
    if (placement) beacon.render(physicalSize.x, physicalSize.y);
  }

  /** Night to a short dusk band, then paper. */
  function setDawn(p: number) {
    const d = THREE.MathUtils.clamp(p, 0, 1);
    dawnNow = d;
    if (d < 0.35) surface.lerpColors(night, dusk, d / 0.35);
    else surface.lerpColors(dusk, paper, (d - 0.35) / 0.65);
    nebulaMaterial.uniforms.uDawn!.value = d;
    starMaterial.uniforms.uDawn!.value = d;
    copyMaterial.uniforms.uDawn!.value = d;
    applyEdge();
    if (reduced && ready) render();
  }

  function setBoost(rect: SkyRect | null) {
    boostRect = rect;
    applyBoost();
    if (reduced && ready) render();
  }

  function setContrast(c: number) {
    nebulaMaterial.uniforms.uContrast!.value = c;
    if (reduced && ready) render();
  }

  function setHorizon(px: number | null) {
    horizonPx = px;
    applyEdge();
    if (reduced && ready) render();
  }

  function setFrameCap(fps: number) {
    minFrameMs = fps > 0 ? 1000 / fps : 0;
  }

  function setBeacon(b: BeaconPlacement | null) {
    placement = b;
    applyBeacon();
    if (reduced && ready) {
      beacon.tick(Number.POSITIVE_INFINITY);
      render();
    }
  }

  const clock = new THREE.Clock();
  let raf = 0;
  let ready = false;

  function firstFrame() {
    if (ready) return;
    ready = true;
    canvas.style.opacity = '1';
    onReady();
  }

  /**
   * A frame budget, in ms. Set while the page is waiting on the network: the
   * sky drifting is not worth a millisecond of the main thread that a reply
   * could have had, so it drops to thirty frames a second until the answer is
   * in. Zero is as fast as the display.
   */
  let minFrameMs = 0;
  let lastFrame = 0;

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    if (minFrameMs > 0 && now - lastFrame < minFrameMs) return;
    lastFrame = now;
    const dt = Math.min(clock.getDelta(), 0.1);
    nebulaMaterial.uniforms.uTime!.value += dt;
    points.rotation.z += DRIFT * dt;
    parallax.lerp(parallaxTarget, 1 - Math.exp(-dt * 6));
    beacon.tick(performance.now());
    if (placement) applyBeacon();
    render();
    firstFrame();
  }

  function start() {
    if (reduced) {
      render();
      firstFrame();
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
  // The window is not the only thing that resizes the canvas: on the marketing
  // page the whole scene travels from full-bleed into a column beside the
  // text, and a canvas that only listens to the window keeps drawing at the
  // size it had when it started, stretched.
  const box = new ResizeObserver(resize);
  box.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  if (!reduced && options.parallax) {
    window.addEventListener('pointermove', onPointer, { passive: true });
    if (coarse) window.addEventListener('deviceorientation', onOrientation, { passive: true });
  }

  return {
    setDawn,
    setBoost,
    setContrast,
    setHorizon,
    setBeacon,
    setFrameCap,
    dispose() {
      stop();
      window.removeEventListener('resize', resize);
      box.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onOrientation);
      stars.dispose();
      starMaterial.dispose();
      nebulaMaterial.dispose();
      copyMaterial.dispose();
      quad.dispose();
      nebulaTarget.dispose();
      beacon.dispose();
      renderer.dispose();
    },
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

/** The sky's coverage at this pixel: full above the edge, gone below, feathered between. */
const EDGE = /* glsl */ `
uniform float uEdge;
uniform float uFeather;
float coverage(vec2 fragCoord, vec2 physical) {
  float y = physical.y - fragCoord.y;
  return 1.0 - smoothstep(uEdge - uFeather, uEdge, y);
}
`;

const NEBULA_FRAG = /* glsl */ `
uniform vec2 uResolution;
uniform float uTime;
uniform float uContrast;
uniform float uScale;
uniform vec3 uNight;
uniform vec3 uLight;
uniform float uDawn;
uniform vec3 uSurface;
uniform vec4 uBoost;
uniform float uBoostK;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * uScale;
  float t = uTime * 0.008;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float density = fbm(p + 1.6 * q);
  float n = smoothstep(0.32, 0.78, density);
  // A little more cloud behind the panel: density, not light.
  if (uBoostK > 0.0) {
    vec2 dd = (uv - uBoost.xy) / uBoost.zw;
    float k = 1.0 - smoothstep(0.7, 1.5, length(dd));
    n = min(1.0, n + uBoostK * k);
  }
  float breath = 0.85 + 0.15 * noise(p * 0.5 + t);
  // The cloud is light added over whatever lies beneath, which is night or
  // the photograph's near-night sky.
  vec3 glow = (uLight - uNight) * (n * uContrast * breath);
  // Dawn: the cloud's own density is the mask. Thin sky gives way first, the
  // densest cloud last, so the sky thins rather than recolours. Where dawn
  // has arrived the surface is opaque, premultiplied.
  float d = smoothstep(density - 0.12, density + 0.12, uDawn * 1.25 - 0.05);
  gl_FragColor = vec4(mix(glow, uSurface, d), d);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uResolution;
uniform float uDawn;
${EDGE}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
void main() {
  vec4 c = texture2D(uMap, gl_FragCoord.xy / uResolution);
  // The dither fades with dawn so flat paper is exactly paper.
  c.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * (1.0 - uDawn);
  // Premultiplied light and paper; nothing below the edge.
  float cov = coverage(gl_FragCoord.xy, uResolution);
  gl_FragColor = vec4(c.rgb * cov, c.a * cov);
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
uniform vec2 uParallax;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uDawn;
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
  // Dawn thins the field: the faintest stars go first.
  float size = aSize * uPixelRatio * (1.0 + 1.8 * layer);
  gl_PointSize = aBright < uDawn * 1.15 ? 0.0 : size;
  vBright = aBright * (0.4 + 0.6 * layer) * (1.0 - smoothstep(0.15, 0.8, uDawn));
  vColor = aColor;
}
`;

const STAR_FRAG = /* glsl */ `
uniform vec2 uPhysical;
varying float vBright;
varying vec3 vColor;
${EDGE}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.3, d) * coverage(gl_FragCoord.xy, uPhysical);
  gl_FragColor = vec4(vColor, a * vBright);
}
`;
