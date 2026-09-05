// Builds the hero's background from the generated sources in assets/beacon/src:
// scene-empty.jpg is the chosen still (Cinema Studio Image 2.5) with the
// beacon removed by a Nano Banana edit; the beacon itself is built and lit
// procedurally in apps/web/components/sky/beacon.ts.
// Also in src, for the record: the three light-state frames and the mask that
// cut the beacon out. Writes, into assets/beacon:
//   scene.jpg   2560x1440, 6px-at-1440 defocus, sky cleaned to near night
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
/** Where the beacon stood in the photograph: its centre as a fraction of the width. */
const BEACON_X = 0.69;
/** A 6px blur at a 1440-wide viewport is 9.6px at this width (the frame shows 1600px there). */
const BLUR_SIGMA = 9.6;
/** How far the sky is pulled toward night so the coded sky owns it. */
const SKY_CLEAN = 0.85;
const NIGHT = '#070a10';

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
await sharp(`${SRC}/scene-empty.jpg`)
  .resize(W, H)
  .blur(BLUR_SIGMA)
  .composite([{ input: skyClean }])
  .jpeg({ quality: 82, mozjpeg: true, progressive: true })
  .toFile(`${OUT}/scene.jpg`);

const meta = { width: W, height: H, horizon: HORIZON, focusX: BEACON_X };
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2) + '\n');
console.log(JSON.stringify(meta));
