// Builds the hero's beacon assets from the generated sources in assets/beacon/src:
// three 2752px light-state frames of the same scene (Cinema Studio Image 2.5,
// then Nano Banana edits for green and off) and the beacon mask (Photoshop
// select-by-prompt). Writes, into assets/beacon:
//   scene-{amber,green,off}.jpg  2560x1440, 6px-at-1440 defocus, sky cleaned to near night
//   beacon-{amber,green,off}.png the beacon cut out sharp, cropped to its box
//   meta.json                    geometry the hero needs, as fractions of the scene
// Run: node scripts/beacon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'assets/beacon/src';
const OUT = 'assets/beacon';
const STATES = ['amber', 'green', 'off'];

const W = 2560;
const H = 1440;
/** Where the sea meets the sky, as a fraction of the height. Measured on the frame. */
const HORIZON = 0.633;
/** A 6px blur at a 1440-wide viewport is 9.6px at this width (the frame shows 1600px there). */
const BLUR_SIGMA = 9.6;
/** How far the sky is pulled toward night so the coded sky owns it. */
const SKY_CLEAN = 0.85;
/** Padding around the beacon's box in the cutout, px. */
const PAD = 24;
const NIGHT = '#070a10';

const maskRaw = await sharp(`${SRC}/mask.png`)
  .resize(W, H)
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });
const box = extent(maskRaw.data, W, H, (v) => v > 127);
const cut = {
  left: Math.max(0, box.x0 - PAD),
  top: Math.max(0, box.y0 - PAD),
  width: Math.min(W, box.x1 + PAD) - Math.max(0, box.x0 - PAD),
  height: Math.min(H, box.y1 + PAD) - Math.max(0, box.y0 - PAD),
};
// The mask as one grey channel, joined to each frame as its alpha.
const maskAlpha = await sharp(`${SRC}/mask.png`).resize(W, H).greyscale().raw().toBuffer();

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
let slit = null;
for (const state of STATES) {
  const frame = sharp(`${SRC}/scene-${state}.jpg`).resize(W, H);

  await frame
    .clone()
    .blur(BLUR_SIGMA)
    .composite([{ input: skyClean }])
    .jpeg({ quality: 82, mozjpeg: true, progressive: true })
    .toFile(`${OUT}/scene-${state}.jpg`);

  // Two passes: sharp would extract before joining the channel in one.
  const rgb = await frame.clone().removeAlpha().raw().toBuffer();
  const joined = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(maskAlpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
  const cutout = await sharp(joined)
    .extract(cut)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  writeFileSync(`${OUT}/beacon-${state}.png`, cutout);

  if (state === 'amber') {
    // The slit: the warm pixels inside the cutout. The crossfade is masked to it.
    const raw = await sharp(cutout).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = raw.info;
    const s = extent(raw.data, width, height, (_, i) => {
      const r = raw.data[i * 4];
      const b = raw.data[i * 4 + 2];
      return r > 120 && r - b > 50;
    });
    slit = {
      x: (cut.left + s.x0) / W,
      y: (cut.top + s.y0) / H,
      w: (s.x1 - s.x0) / W,
      h: (s.y1 - s.y0) / H,
    };
  }
}

const meta = {
  width: W,
  height: H,
  horizon: HORIZON,
  /** The beacon's centre, as a fraction of the width; the hero keeps this point in frame. */
  focusX: (box.x0 + box.x1) / 2 / W,
  cutout: { x: cut.left / W, y: cut.top / H, w: cut.width / W, h: cut.height / H },
  slit,
};
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2) + '\n');
console.log(JSON.stringify(meta));

function extent(data, width, height, test) {
  let x0 = width,
    y0 = height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!test(data[i], i)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
