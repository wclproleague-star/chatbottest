#!/usr/bin/env node
// Generates the brand assets from the picked mark.
//
//   pnpm build            next/font writes the Instrument Sans files this reads
//   node scripts/marks.mjs
//
// The mark is the K: the stem is the vard, the slit is cut into it, and the
// two diagonals stand clear. It is drawn twice. The master is the shape; the
// small version is the same shape corrected for its size, with the slit 1.6x
// wider and the stem a tenth heavier, because below about 48px a two-unit slit
// falls under one device pixel and the light goes out.
//
// Everything lands in assets/brand/, in two colourways: star white with an
// amber slit for night, ink with an amber slit for paper. The favicons and the
// Discord avatar are copied into apps/web/app where Next serves them.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'wawoff2';

// fontkit is CommonJS with no default export; require it.
const fontkit = createRequire(import.meta.url)('fontkit');

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = join(root, 'assets');
const brand = join(assets, 'brand');
const appDir = join(root, 'apps/web/app');
mkdirSync(brand, { recursive: true });

const STAR = '#F2EEE6';
const INK = '#111418';
const AMBER = '#D9A21B';
const NIGHT = '#070A10';
const CONSOLE = '#0E1116';

/** The two colourways, by the ground they stand on. */
const WAYS = {
  night: { body: STAR, slit: AMBER },
  paper: { body: INK, slit: AMBER },
};

// The mark ---------------------------------------------------------------
// A 32-unit grid, so every edge lands on a whole pixel at 16, 32, 64 and 256.

/**
 * @param {{body: string, slit: string}} way
 * @param {'master'|'small'} optical
 */
function markShapes(way, optical) {
  // Small: the stem is a tenth heavier and the slit 1.6 times wider, both
  // centred where they were, so the light survives at 16 and 32.
  const stemW = optical === 'small' ? 7.7 : 7;
  const slitW = optical === 'small' ? 3.2 : 2;
  const slitX = 4 + (stemW - slitW) / 2;
  return (
    `<rect x="4" y="3" width="${stemW}" height="26" fill="${way.body}"/>` +
    `<rect x="${round(slitX)}" y="9" width="${slitW}" height="12" fill="${way.slit}"/>` +
    `<path d="M13 16 L26 3 L30 3 L15.5 17.5 Z" fill="${way.body}"/>` +
    `<path d="M15.5 14.5 L30 29 L26 29 L13 16 Z" fill="${way.body}"/>`
  );
}

/** The mark on its own, transparent. */
function markSvg(way, optical) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" ' +
    'role="img" aria-label="Kalvard">' +
    markShapes(way, optical) +
    '</svg>'
  );
}

for (const [name, way] of Object.entries(WAYS)) {
  writeFileSync(join(brand, `mark-${name}.svg`), tidy(markSvg(way, 'master')));
  writeFileSync(join(brand, `mark-small-${name}.svg`), tidy(markSvg(way, 'small')));
}

// The wordmark -----------------------------------------------------------
// Instrument Sans, weight 500, width 86%, tracking -0.035em, as the Wordmark
// component sets it. Outlined so the file needs no font.

const mediaDir = join(root, 'apps/web/.next/static/media');
const fontFile = readdirSync(mediaDir)
  .filter((f) => f.endsWith('.woff2'))
  .map((f) => join(mediaDir, f))
  .find((p) => {
    const f = fontkit.openSync(p);
    return Boolean(f.variationAxes?.wdth) && f.hasGlyphForCodePoint('K'.codePointAt(0));
  });
if (!fontFile) {
  throw new Error(
    'No Instrument Sans variable file under apps/web/.next/static/media. Run pnpm build first.',
  );
}

// fontkit cannot instance a variable WOFF2 (the instance loses its tables), so
// decompress to a TTF buffer first.
const ttf = Buffer.from(await decompress(readFileSync(fontFile)));
const font = fontkit.create(ttf).getVariation({ wdth: 86, wght: 500 });

/** One word, outlined, with its own box. Returns paths in font units, y up. */
function outline(word) {
  const tracking = -0.035 * font.unitsPerEm;
  const run = font.layout(word);
  let x = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const paths = [];
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.toSVG();
    if (d) paths.push(`<path transform="translate(${round(x)} 0)" d="${d}"/>`);
    minX = Math.min(minX, x + glyph.bbox.minX);
    maxX = Math.max(maxX, x + glyph.bbox.maxX);
    minY = Math.min(minY, glyph.bbox.minY);
    maxY = Math.max(maxY, glyph.bbox.maxY);
    x += run.positions[i].xAdvance + (i < run.glyphs.length - 1 ? tracking : 0);
  });
  return { paths: paths.join(''), minX, maxX, minY, maxY };
}

const word = outline('KALVARD');
writeFileSync(
  join(assets, 'wordmark.svg'),
  tidy(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(word.minX)} ${round(-word.maxY)} ${round(word.maxX - word.minX)} ${round(word.maxY - word.minY)}" role="img" aria-label="Kalvard">` +
      `<g fill="currentColor" transform="scale(1 -1)">${word.paths}</g></svg>`,
  ),
);

// The lockup -------------------------------------------------------------
// The mark at cap height, then a gap of half its width, then the word. Both
// sit on the same baseline, which is what makes it read as one thing.

function lockupSvg(way) {
  const capH = word.maxY;
  const scale = capH / 26; // the mark's stem is 26 units tall
  const markW = 32 * scale;
  const gap = markW * 0.34;
  const wordW = word.maxX - word.minX;
  const height = capH;
  const width = markW + gap + wordW;
  // The mark's grid has y down and the word has y up, so each gets its own frame.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-label="Kalvard">` +
    `<g transform="translate(0 ${round(-1.5 * scale)}) scale(${round6(scale)})">${markShapes(way, 'master')}</g>` +
    `<g fill="${way.body}" transform="translate(${round(markW + gap - word.minX)} ${round(height)}) scale(1 -1)">${word.paths}</g>` +
    `</svg>`
  );
}

for (const [name, way] of Object.entries(WAYS)) {
  writeFileSync(join(brand, `lockup-${name}.svg`), tidy(lockupSvg(way)));
}

// Avatar, tile, favicons -------------------------------------------------

/** The mark centred on a ground, with room around it. */
function onGround({ way, optical, ground, shape, size = 512, inset = 0.26 }) {
  const scale = (1 - inset * 2) * (size / 32);
  const offset = size * inset;
  const field =
    shape === 'circle'
      ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${ground}"/>`
      : `<rect width="${size}" height="${size}" rx="${round(size * 0.22)}" fill="${ground}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Kalvard">` +
    field +
    `<g transform="translate(${round(offset)} ${round(offset)}) scale(${round6(scale)})">${markShapes(way, optical)}</g>` +
    `</svg>`
  );
}

// Discord crops to a circle, so the avatar is a circle: nothing is lost to a
// crop that was not drawn for it.
const avatar = onGround({ way: WAYS.night, optical: 'master', ground: NIGHT, shape: 'circle' });
writeFileSync(join(brand, 'avatar-512.svg'), tidy(avatar));
writeFileSync(join(brand, 'avatar-512.png'), png(avatar, 512));

const tile = onGround({
  way: WAYS.night,
  optical: 'master',
  ground: CONSOLE,
  shape: 'rounded',
  inset: 0.24,
});
writeFileSync(join(brand, 'app-tile-512.png'), png(tile, 512));

// The favicons take the small version, which is the whole point of drawing it.
const favicon = onGround({
  way: WAYS.night,
  optical: 'small',
  ground: NIGHT,
  shape: 'rounded',
  size: 64,
  // Less room than the avatar gets: at 16px every unit of inset is a unit the
  // slit does not have.
  inset: 0.1,
});
writeFileSync(join(brand, 'favicon.svg'), tidy(favicon));
for (const size of [16, 32, 48, 180]) {
  writeFileSync(join(brand, `favicon-${size}.png`), png(favicon, size));
}
writeFileSync(
  join(brand, 'favicon.ico'),
  ico([16, 32, 48].map((size) => ({ size, data: png(favicon, size) }))),
);

// The banner -------------------------------------------------------------
// The headland the product is named after, with the lockup standing on it.

const scene = readFileSync(join(assets, 'beacon/scene.jpg')).toString('base64');
const bannerLockup = lockupSvg(WAYS.night);
const lockupHeight = 96;
const lockupWidth =
  lockupHeight *
  (Number(bannerLockup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)[1]) /
    Number(bannerLockup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)[2]));
const banner =
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1500 500">` +
  `<rect width="1500" height="500" fill="${NIGHT}"/>` +
  // The still, covering the banner and anchored to its bottom, as the hero has it.
  `<image href="data:image/jpeg;base64,${scene}" x="0" y="-330" width="1500" height="844" preserveAspectRatio="xMidYMax slice" opacity="0.55"/>` +
  `<rect width="1500" height="500" fill="${NIGHT}" opacity="0.35"/>` +
  `<g transform="translate(96 ${round(250 - lockupHeight / 2)}) scale(${round6(lockupHeight / Number(bannerLockup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)[2]))})">` +
  bannerLockup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') +
  `</g>` +
  `</svg>`;
writeFileSync(join(brand, 'banner-1500x500.png'), png(banner, 1500));
void lockupWidth;

// What the app serves ----------------------------------------------------
writeFileSync(join(appDir, 'favicon.ico'), readFileSync(join(brand, 'favicon.ico')));
writeFileSync(join(appDir, 'icon.svg'), readFileSync(join(brand, 'favicon.svg')));
writeFileSync(join(appDir, 'apple-icon.png'), readFileSync(join(brand, 'favicon-180.png')));

for (const f of readdirSync(brand).sort()) {
  console.log(`${String(statSync(join(brand, f)).size).padStart(8)} B  assets/brand/${f}`);
}
console.log('copied favicon.ico, icon.svg, apple-icon.png into apps/web/app');

// Helpers ----------------------------------------------------------------

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/** Builds an .ico that embeds PNG images, one per size. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

function round(n) {
  return Number(n.toFixed(1));
}

function round6(n) {
  return Number(n.toFixed(6));
}

/** Trims path numbers to one decimal so the file stays small. */
function tidy(svg) {
  return svg.replace(/-?\d+\.\d{2,}/g, (m) => String(round(Number(m))));
}
