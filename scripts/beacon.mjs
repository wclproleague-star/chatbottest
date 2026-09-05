// Builds the hero's background from the generated sources in assets/beacon/src:
// scene-empty.jpg is the chosen still (Cinema Studio Image 2.5) with the
// beacon removed by a Nano Banana edit; the beacon itself is built and lit
// procedurally in apps/web/components/sky/beacon.ts.
// Also in src, for the record: the three light-state frames and the mask that
// cut the beacon out. Writes, into assets/beacon:
//   scene.jpg   2560x1440. Depth-graded defocus: sharp in a band at the
//               beacon's footing, up to 8px (at a 1440 viewport) toward the
//               sea and sky, 2px toward the near foreground. Sky cleaned to
//               near night.
//   grass.png   the foreground grass at the footing, cut out by greenness, to
//               sit in front of the beacon's base
//   ground.png  a rough luminance map of the ground around the footing, which
//               shapes the light spill on the grass
//   meta.json   the frame's geometry the hero needs, as fractions
// Run: node scripts/beacon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'assets/beacon/src';
const OUT = 'assets/beacon';

const W = 2560;
const H = 1440;
/** Where the sea meets the sky, as a fraction of the height. Measured on the frame. */
const HORIZON = 0.633;
/** Where the beacon stood in the photograph: its centre as a fraction of the width, its foot as one of the height. */
const BEACON_X = 0.69;
const BEACON_BASE = 0.81;
const BEACON_HEIGHT = 0.611;
/** A 1px blur at a 1440-wide viewport is 1.6px at this width (the frame shows 1600px there). */
const PX = 1.6;
/** The focal band around the footing, half-height as a fraction of the frame. */
const FOCUS_BAND = 0.035;
/** How far above the band the blur reaches its maximum. */
const FAR_RAMP = 0.25;
/** How far the sky is pulled toward night so the coded sky owns it. */
const SKY_CLEAN = 0.85;
const NIGHT = '#070a10';

const frame = sharp(`${SRC}/scene-empty.jpg`).resize(W, H);
const sharpRgb = await frame.clone().removeAlpha().raw().toBuffer();

/** A blurred copy of the frame with a per-row alpha, ready to composite. */
async function layer(sigma, alphaAt) {
  const rgb = await frame.clone().blur(sigma).removeAlpha().raw().toBuffer();
  const alpha = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    const a = Math.round(255 * Math.min(1, Math.max(0, alphaAt(y / H))));
    alpha.fill(a, y * W, (y + 1) * W);
  }
  return sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}

// Above the band the blur ramps to 8px over FAR_RAMP, in two steps; below it,
// to 2px at the bottom of the frame.
const top = BEACON_BASE - FOCUS_BAND;
const bottom = BEACON_BASE + FOCUS_BAND;
const far = (y) => Math.min(1, Math.max(0, (top - y) / FAR_RAMP));
const near = (y) => Math.min(1, Math.max(0, (y - bottom) / (1 - bottom)));
const layers = [
  await layer(4 * PX, (y) => Math.min(1, far(y) * 2)),
  await layer(8 * PX, (y) => Math.max(0, far(y) * 2 - 1)),
  await layer(2 * PX, near),
];

// Night over the sky: full strength to half height, gone at the horizon.
const skyClean = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}" stop-opacity="${SKY_CLEAN}"/>
      <stop offset="0.5" stop-color="${NIGHT}" stop-opacity="${SKY_CLEAN}"/>
      <stop offset="${HORIZON}" stop-color="${NIGHT}" stop-opacity="0"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  </svg>`,
);

mkdirSync(OUT, { recursive: true });
await sharp(sharpRgb, { raw: { width: W, height: H, channels: 3 } })
  .composite([...layers.map((input) => ({ input })), { input: skyClean }])
  .jpeg({ quality: 82, mozjpeg: true, progressive: true })
  .toFile(`${OUT}/scene.jpg`);

// The foreground grass at the footing: the sharp frame, alpha from greenness
// (the puddles read blue, the blades green-brown) weighted by luminance,
// windowed to start 3.5% of the beacon's height above its base.
const grass = {
  x: 0.5,
  y: BEACON_BASE - 0.032,
  w: 0.4,
  h: 0.12,
};
const gx = Math.round(grass.x * W);
const gy = Math.round(grass.y * H);
const gw = Math.round(grass.w * W);
const gh = Math.round(grass.h * H);
const windowTop = (BEACON_BASE - 0.035 * BEACON_HEIGHT) * H;
const lum = new Float32Array(gw * gh);
for (let y = 0; y < gh; y++) {
  for (let x = 0; x < gw; x++) {
    const i = ((gy + y) * W + gx + x) * 3;
    const l = (0.2126 * sharpRgb[i] + 0.7152 * sharpRgb[i + 1] + 0.0722 * sharpRgb[i + 2]) / 255;
    lum[y * gw + x] = ((sharpRgb[i + 1] - sharpRgb[i + 2]) / 255) * (0.5 + l);
  }
}
const sorted = Float32Array.from(lum).sort();
const lo = sorted[Math.floor(sorted.length * 0.55)];
const hi = sorted[Math.floor(sorted.length * 0.85)];
const grassRgb = Buffer.alloc(gw * gh * 3);
const grassAlpha = Buffer.alloc(gw * gh);
for (let y = 0; y < gh; y++) {
  const fy = gy + y;
  const win = Math.min(1, Math.max(0, (fy - windowTop) / (0.012 * H)));
  for (let x = 0; x < gw; x++) {
    const i = ((gy + y) * W + gx + x) * 3;
    const o = (y * gw + x) * 3;
    grassRgb[o] = sharpRgb[i];
    grassRgb[o + 1] = sharpRgb[i + 1];
    grassRgb[o + 2] = sharpRgb[i + 2];
    const t = Math.min(1, Math.max(0, (lum[y * gw + x] - lo) / (hi - lo)));
    grassAlpha[y * gw + x] = Math.round(255 * t * t * (3 - 2 * t) * win);
  }
}
await sharp(grassRgb, { raw: { width: gw, height: gh, channels: 3 } })
  .joinChannel(grassAlpha, { raw: { width: gw, height: gh, channels: 1 } })
  .png({ compressionLevel: 9 })
  .toFile(`${OUT}/grass.png`);

// The ground's luminance around the footing, stretched, for the spill's shape.
const ground = { x: 0.55, y: 0.76, w: 0.28, h: 0.1 };
await sharp(sharpRgb, { raw: { width: W, height: H, channels: 3 } })
  .extract({
    left: Math.round(ground.x * W),
    top: Math.round(ground.y * H),
    width: Math.round(ground.w * W),
    height: Math.round(ground.h * H),
  })
  .greyscale()
  .normalise()
  .blur(2)
  .resize(256, 96)
  .png()
  .toFile(`${OUT}/ground.png`);

const meta = {
  width: W,
  height: H,
  horizon: HORIZON,
  focusX: BEACON_X,
  base: BEACON_BASE,
  grass,
  ground,
};
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2) + '\n');
console.log(JSON.stringify(meta));
