// The beacon, built procedurally and rendered inside the sky's canvas.
//
// One piece: a tapered prism, 1:1 in plan, with a 0.4%-of-height chamfer on
// every edge so the edges catch light, and a recessed slit on the front face,
// 6% of the width deep with beveled inner faces, holding the emissive strip.
// The material is a physical one: albedo #0B0D10, roughness 0.78 under a
// brushed roughness map of faint vertical streaks, metalness 0.05, no
// clearcoat. It is lit to match the photograph: an environment built from
// the scene's own colours (cold sky above, near-black ground), a cold key from
// upper left, a faint blue fill from the sea side, and the slit itself as a
// rect area light in the state colour, warming the recess and the face around
// it. On the ground, a soft contact shadow and a warm spill on the grass
// beside it, both in the state colour.
//
// Post: the scene renders to a linear HDR target, the emissive alone blooms
// through a tight threshold, then one composite pass applies ACES tone
// mapping, encodes to sRGB, adds static film grain matched to the still, and
// lays the result over the canvas with premultiplied alpha.
//
// The camera matches the still: level, horizon at the principal point, a
// 60-degree lens, the beacon's height and footing read from the frame. World
// units: one frame height at the beacon's depth. The base stands where the
// photograph's monolith stood.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export type Light = 'amber' | 'green' | 'off';

/** Where the beacon stands: the photograph's rect over the canvas, and the beacon's centre across it. */
export type BeaconPlacement = {
  /** The frame's rect in canvas CSS px, as the scene lays the photograph out. */
  frame: { left: number; top: number; width: number; height: number };
  /** The beacon's centre as a fraction of the frame's width. */
  x: number;
  light: Light;
  /** Opacity, driven by dawn. */
  fade: number;
};

/** The photograph's geometry, as fractions of its frame, measured on the still. */
export const PHOTO = {
  horizon: 0.633,
  beaconTop: 0.199,
  beaconBase: 0.81,
  /** The monolith's projected width in the still, side face included. */
  beaconWidth: 0.116,
  /** The slit, within the beacon: across its front face, and down its height. */
  slitAcross: 0.35,
  slitTop: 0.2,
  slitBottom: 0.617,
  /** A wide-normal lens: about 60 degrees across the frame. */
  hfovDeg: 60,
} as const;

const FRAME_ASPECT = 16 / 9;
/** The object reads about 20% slimmer than the photograph's monolith. */
const SLIM = 0.8;
/** The top is this much of the base, in plan. */
const TAPER = 0.94;
const YAW_DEG = 14;
/** Chamfer, as a fraction of the height. */
const CHAMFER = 0.004;
/** The slit's width as a fraction of the prism's width; the recess depth as a fraction too. */
const SLIT_WIDTH = 0.1;
const RECESS = 0.06;

const MAX_PARALLAX_PX = 12;
const BEACON_PARALLAX_PX = 4;
/** The slit's colour change, ms. */
const LIGHT_MS = 240;

/** How bright the strip is in linear light; the bloom threshold sits well under it. */
const STRIP_INTENSITY = 4;
const BLOOM_THRESHOLD = 1;
const BLOOM_STRENGTH = 0.9;
/** Grain amplitude in sRGB, matched by eye to the still's grain. */
const GRAIN = 0.05;

const AMBER = '#d9a21b';
const GREEN = '#23a55a';
const ALBEDO = '#0b0d10';

/** sRGB hex to a linear colour, whatever ColorManagement is set to. */
function linear(hex: string): THREE.Color {
  return new THREE.Color(hex).convertSRGBToLinear();
}

export function createBeacon(renderer: THREE.WebGLRenderer) {
  RectAreaLightUniformsLib.init();

  // The camera's virtual frame is the photograph extended downward so its
  // centre sits on the horizon; the fov is the photograph's, rescaled to it.
  const fullHeight = 2 * PHOTO.horizon;
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(PHOTO.hfovDeg / 2)) / FRAME_ASPECT;
  const fovFull = 2 * THREE.MathUtils.radToDeg(Math.atan(tanHalfV * fullHeight));
  const depth = PHOTO.horizon / (tanHalfV * fullHeight);
  const eye = PHOTO.beaconBase - PHOTO.horizon;
  const height = PHOTO.beaconBase - PHOTO.beaconTop;
  const yaw = THREE.MathUtils.degToRad(YAW_DEG);
  // The projected width, side face included, is the photograph's times SLIM.
  const width = (PHOTO.beaconWidth * SLIM * FRAME_ASPECT) / (Math.cos(yaw) + Math.sin(yaw));
  const side = width;
  const chamfer = CHAMFER * height;

  const camera = new THREE.PerspectiveCamera(fovFull, FRAME_ASPECT / fullHeight, 0.1, 20);
  camera.position.set(0, eye, 0);
  camera.lookAt(0, eye, -1);

  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.rotation.y = yaw;
  scene.add(group);

  // Environment: the scene's own colours as a gradient sphere, prefiltered.
  const envScene = new THREE.Scene();
  const envMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uSky: { value: linear('#1a2030') },
      uHorizon: { value: linear('#2a3346') },
      uGround: { value: linear('#05070a') },
    },
    vertexShader: ENV_VERT,
    fragmentShader: ENV_FRAG,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMaterial));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envTarget.texture;
  pmrem.dispose();

  // The body.
  const roughnessMap = brushedTexture();
  roughnessMap.repeat.set(2 / width, 4 / height);
  const body = new THREE.MeshPhysicalMaterial({
    color: linear(ALBEDO),
    roughness: 0.78,
    roughnessMap,
    metalness: 0.05,
    clearcoat: 0,
    envMapIntensity: 1,
  });
  const slitW = SLIT_WIDTH * width;
  const slitH = (PHOTO.slitBottom - PHOTO.slitTop) * height;
  const slitY = height - ((PHOTO.slitTop + PHOTO.slitBottom) / 2) * height;
  const slitX = (PHOTO.slitAcross - 0.5) * width;
  const recess = RECESS * width;
  const prism = new THREE.Mesh(
    prismGeometry({ width, height, side, chamfer, slitW, slitH, slitX, slitY }),
    body,
  );
  group.add(prism);

  // The recess floor, and the strip in it.
  const front = side / 2;
  const floorDepth = side - recess - chamfer;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(slitW + 2 * chamfer, slitH + 2 * chamfer, floorDepth),
    body,
  );
  floor.position.set(slitX, slitY, front - recess - floorDepth / 2);
  group.add(floor);
  const stripMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(slitW - 2 * chamfer - 0.002, slitH - 2 * chamfer - 0.002),
    stripMaterial,
  );
  strip.position.set(slitX, slitY, front - recess + 0.0006);
  group.add(strip);

  // The slit as a light: a rect area light at the recess floor, facing out.
  const slitLight = new THREE.RectAreaLight(0xffffff, 0, slitW, slitH);
  slitLight.position.set(slitX, slitY, front - recess + 0.0004);
  slitLight.lookAt(slitX, slitY, front + 1);
  group.add(slitLight);
  // The recess hides the area light from the face around it; a short-range
  // point at the slit's mouth carries its warmth onto the nearby front face.
  const spillLight = new THREE.PointLight(0xffffff, 0, width * 4, 2);
  spillLight.position.set(slitX, slitY, front + width * 0.15);
  group.add(spillLight);

  // Ground: contact shadow, and the warm spill beside the base on the slit's side.
  const falloff = radialTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: falloff,
    color: 0x000000,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width * 3.4, side * 2.6), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.0008;
  group.add(shadow);
  const spillMaterial = new THREE.MeshBasicMaterial({
    map: falloff,
    color: 0x000000,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.4, width * 1.6), spillMaterial);
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(slitX - width * 0.2, 0.0012, front + width * 0.55);
  group.add(spill);

  // A cold key from upper left, and a faint blue fill from the sea, which is to the left.
  const key = new THREE.DirectionalLight(linear('#9fb4d8'), 3);
  key.position.set(-3, 4, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(linear('#5f7fb0'), 0.5);
  fill.position.set(-4, 0.6, 1);
  scene.add(fill);

  // The light state, eased over LIGHT_MS.
  const colors: Record<Light, THREE.Color> = {
    amber: linear(AMBER),
    green: linear(GREEN),
    off: new THREE.Color(0, 0, 0),
  };
  const amount: Record<Light, number> = { amber: 1, green: 1, off: 0 };
  let lightNow: Light = 'amber';
  const fromColor = colors.amber.clone();
  let fromAmount = 1;
  const current = colors.amber.clone();
  let currentAmount = 1;
  let changedAt = -1;
  let fade = 1;

  function setLight(next: Light, now: number) {
    if (next === lightNow) return;
    lightNow = next;
    fromColor.copy(current);
    fromAmount = currentAmount;
    changedAt = now;
  }

  /** Advance the colour change and push it into the strip, the light and the spill. */
  function tick(now: number) {
    const k = changedAt < 0 ? 1 : Math.min(1, (now - changedAt) / LIGHT_MS);
    current.lerpColors(fromColor, colors[lightNow], k);
    currentAmount = fromAmount + (amount[lightNow] - fromAmount) * k;
    if (k >= 1) changedAt = -1;
    stripMaterial.color.copy(current).multiplyScalar(STRIP_INTENSITY * currentAmount);
    slitLight.color.copy(current);
    slitLight.intensity = 6 * currentAmount;
    spillLight.color.copy(current);
    spillLight.intensity = 0.12 * currentAmount;
    spillMaterial.color.copy(current).multiplyScalar(0.22 * currentAmount);
  }

  /** Lay the camera's frustum over the photograph's rect and stand the beacon at x. */
  function place(p: BeaconPlacement, css: THREE.Vector2, parallax: THREE.Vector2) {
    const f = p.frame;
    camera.setViewOffset(f.width, f.height * fullHeight, -f.left, -f.top, css.x, css.y);
    camera.updateProjectionMatrix();
    // One frame height is one unit at the beacon's depth; parallax is 4px at most.
    const unit = 1 / f.height;
    const k = BEACON_PARALLAX_PX / MAX_PARALLAX_PX;
    group.position.set(
      (p.x - 0.5) * FRAME_ASPECT + parallax.x * k * unit,
      parallax.y * k * unit,
      -depth,
    );
    setLight(p.light, performance.now());
    fade = p.fade;
  }

  // Post: HDR target, threshold, two blurs, composite.
  const hdr = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const half = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false } as const;
  const bright = new THREE.WebGLRenderTarget(1, 1, half);
  const blurA = new THREE.WebGLRenderTarget(1, 1, half);
  const blurB = new THREE.WebGLRenderTarget(1, 1, half);
  const quad = new THREE.PlaneGeometry(2, 2);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const halfSize = new THREE.Vector2(1, 1);
  const brightMaterial = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: hdr.texture }, uThreshold: { value: BLOOM_THRESHOLD } },
    vertexShader: QUAD_VERT,
    fragmentShader: BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uResolution: { value: halfSize },
      uDirection: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uBeacon: { value: hdr.texture },
      uBloom: { value: blurB.texture },
      uStrength: { value: BLOOM_STRENGTH },
      uFade: { value: 1 },
      uGrain: { value: GRAIN },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // Premultiplied over.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const brightScene = new THREE.Scene().add(new THREE.Mesh(quad, brightMaterial));
  const blurScene = new THREE.Scene().add(new THREE.Mesh(quad, blurMaterial));
  const compositeScene = new THREE.Scene().add(new THREE.Mesh(quad, compositeMaterial));
  let targetW = 0;
  let targetH = 0;

  function resizeTargets(w: number, h: number) {
    if (w === targetW && h === targetH) return;
    targetW = w;
    targetH = h;
    hdr.setSize(w, h);
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    bright.setSize(hw, hh);
    blurA.setSize(hw, hh);
    blurB.setSize(hw, hh);
    halfSize.set(hw, hh);
  }

  function blur(
    from: THREE.WebGLRenderTarget,
    to: THREE.WebGLRenderTarget,
    dx: number,
    dy: number,
  ) {
    blurMaterial.uniforms.uMap!.value = from.texture;
    (blurMaterial.uniforms.uDirection!.value as THREE.Vector2).set(dx, dy);
    renderer.setRenderTarget(to);
    renderer.render(blurScene, quadCamera);
  }

  /** Draw the beacon over whatever is on the canvas. */
  function render(physicalW: number, physicalH: number) {
    resizeTargets(physicalW, physicalH);
    const tone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(hdr);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.toneMapping = tone;

    renderer.setRenderTarget(bright);
    renderer.render(brightScene, quadCamera);
    blur(bright, blurA, 1, 0);
    blur(blurA, blurB, 0, 1);
    blur(blurB, blurA, 2, 0);
    blur(blurA, blurB, 0, 2);

    compositeMaterial.uniforms.uFade!.value = fade;
    renderer.setRenderTarget(null);
    renderer.render(compositeScene, quadCamera);
  }

  return {
    group,
    place,
    tick,
    render,
    dispose() {
      prism.geometry.dispose();
      floor.geometry.dispose();
      strip.geometry.dispose();
      shadow.geometry.dispose();
      spill.geometry.dispose();
      body.dispose();
      roughnessMap.dispose();
      stripMaterial.dispose();
      shadowMaterial.dispose();
      spillMaterial.dispose();
      falloff.dispose();
      envTarget.dispose();
      envMaterial.dispose();
      hdr.dispose();
      bright.dispose();
      blurA.dispose();
      blurB.dispose();
      quad.dispose();
      brightMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
    },
  };
}

/**
 * The prism: the front face as a chamfered rectangle with the slit cut out,
 * extruded to the depth with a one-segment bevel, which chamfers all twelve
 * outer edges and bevels the slit's inner edges. Then tapered toward the top.
 * Base at y = 0, front face toward +z.
 */
function prismGeometry(d: {
  width: number;
  height: number;
  side: number;
  chamfer: number;
  slitW: number;
  slitH: number;
  slitX: number;
  slitY: number;
}): THREE.BufferGeometry {
  const c = d.chamfer;
  const hw = d.width / 2 - c;
  const hh = d.height / 2 - c;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + c, -hh);
  shape.lineTo(hw - c, -hh);
  shape.lineTo(hw, -hh + c);
  shape.lineTo(hw, hh - c);
  shape.lineTo(hw - c, hh);
  shape.lineTo(-hw + c, hh);
  shape.lineTo(-hw, hh - c);
  shape.lineTo(-hw, -hh + c);
  shape.closePath();

  const sy = d.slitY - d.height / 2;
  const sw = d.slitW / 2;
  const sh = d.slitH / 2;
  const hole = new THREE.Path();
  hole.moveTo(d.slitX - sw, sy - sh);
  hole.lineTo(d.slitX + sw, sy - sh);
  hole.lineTo(d.slitX + sw, sy + sh);
  hole.lineTo(d.slitX - sw, sy + sh);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d.side - 2 * c,
    bevelEnabled: true,
    bevelThickness: c,
    bevelSize: c,
    bevelSegments: 1,
    curveSegments: 1,
  });
  // Centre the depth, stand the base on y = 0.
  geometry.translate(0, d.height / 2, -(d.side - 2 * c) / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const f = 1 - (1 - TAPER) * (y / d.height);
    position.setX(i, position.getX(i) * f);
    position.setZ(i, position.getZ(i) * f);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Brushed metal: faint vertical streaks around white, so roughness stays near its base. */
function brushedTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const columns = new Float32Array(size);
  let v = 0;
  for (let x = 0; x < size; x++) {
    v = v * 0.6 + (Math.random() - 0.5) * 0.4;
    columns[x] = v;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const streak = columns[x]! + (Math.random() - 0.5) * 0.15;
      const g = Math.round(Math.min(255, Math.max(0, 244 + streak * 22)));
      const i = (y * size + x) * 4;
      image.data[i] = g;
      image.data[i + 1] = g;
      image.data[i + 2] = g;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** A radial falloff, white to transparent, for the shadow and the spill. */
function radialTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const ENV_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Cold sky above, a faint band at the horizon, near-black ground. */
const ENV_FRAG = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGround;
varying vec3 vDir;
void main() {
  float y = normalize(vDir).y;
  vec3 c = y > 0.0
    ? mix(uHorizon, uSky, smoothstep(0.0, 0.5, y))
    : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
  gl_FragColor = vec4(c, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.6, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uResolution;
uniform vec2 uDirection;
varying vec2 vUv;
void main() {
  vec2 step = uDirection / uResolution;
  vec3 c = texture2D(uMap, vUv).rgb * 0.2270270270;
  c += texture2D(uMap, vUv + step * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uMap, vUv - step * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uMap, vUv + step * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(uMap, vUv - step * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Tone mapping, encoding and grain, over the canvas. The beacon target is
 * premultiplied; the bloom is light that also reaches past the object.
 */
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uBeacon;
uniform sampler2D uBloom;
uniform float uStrength;
uniform float uFade;
uniform float uGrain;
varying vec2 vUv;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
void main() {
  vec4 b = texture2D(uBeacon, vUv);
  vec3 bloom = texture2D(uBloom, vUv).rgb * uStrength;
  vec3 object = b.a > 0.0005 ? b.rgb / b.a : vec3(0.0);
  vec3 objectOut = toSRGB(aces(object + bloom)) * b.a;
  vec3 glow = toSRGB(aces(bloom));
  float glowA = max(glow.r, max(glow.g, glow.b));
  vec3 rgb = objectOut + glow * (1.0 - b.a);
  float a = b.a + (1.0 - b.a) * glowA;
  // Static grain on the object, matched to the still's.
  rgb += (hash(gl_FragCoord.xy) - 0.5) * uGrain * b.a;
  gl_FragColor = vec4(rgb * uFade, a * uFade);
}
`;
