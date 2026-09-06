#!/usr/bin/env node
// Generates the brand assets from the picked marks.
//
//   pnpm build            next/font writes the Instrument Sans files this reads
//   node scripts/marks.mjs
//
// Writes assets/wordmark.svg (outlined to paths), assets/avatar.svg,
// assets/avatar-512.png (star white on answered green, for Discord) and the
// favicon set, then copies the favicons into apps/web/app where Next serves them.
import { Resvg } from '@resvg/resvg-js';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'wawoff2';

// fontkit is CommonJS with no default export; require it.
const fontkit = createRequire(import.meta.url)('fontkit');

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = join(root, 'assets');
const appDir = join(root, 'apps/web/app');
mkdirSync(assets, { recursive: true });

const STAR = '#F2EEE6';
const GREEN = '#23A55A';

// Wordmark ---------------------------------------------------------------
// Instrument Sans, weight 500, width 86%, tracking -0.035em, as the Wordmark
// component sets it. Outlined so the file needs no font.

const mediaDir = join(root, 'apps/web/.next/static/media');
const fontFile = readdirSync(mediaDir)
  .filter((f) => f.endsWith('.woff2'))
  .map((f) => join(mediaDir, f))
  .find((p) => {
    const f = fontkit.openSync(p);
    return Boolean(f.variationAxes?.wdth) && f.hasGlyphForCodePoint('S'.codePointAt(0));
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
const tracking = -0.035 * font.unitsPerEm;
const run = font.layout('Kalvard');

// The box follows the glyph outlines, not the advances: the y overhangs its advance.
let x = 0;
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
const glyphPaths = [];
run.glyphs.forEach((glyph, i) => {
  const d = glyph.path.toSVG();
  if (d) glyphPaths.push(`<path transform="translate(${round(x)} 0)" d="${d}"/>`);
  minX = Math.min(minX, x + glyph.bbox.minX);
  maxX = Math.max(maxX, x + glyph.bbox.maxX);
  minY = Math.min(minY, glyph.bbox.minY);
  maxY = Math.max(maxY, glyph.bbox.maxY);
  x += run.positions[i].xAdvance + (i < run.glyphs.length - 1 ? tracking : 0);
});

const wordmark = tidy(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX)} ${round(-maxY)} ${round(maxX - minX)} ${round(maxY - minY)}" role="img" aria-label="Kalvard">` +
    `<g fill="currentColor" transform="scale(1 -1)">${glyphPaths.join('')}</g></svg>`,
);
writeFileSync(join(assets, 'wordmark.svg'), wordmark);

// Avatar mark ------------------------------------------------------------
// Same four shapes as packages/ui/src/avatar-mark.tsx. Keep them in sync.

const MARK =
  '<circle cx="32" cy="11" r="6"/>' +
  '<rect x="23" y="20" width="18" height="4" rx="2"/>' +
  '<polygon points="30,24 34,24 37,52 27,52"/>' +
  '<rect x="16" y="54" width="32" height="4" rx="2"/>';

/** The mark, optionally on a field and inset so it survives a circular crop. */
function avatarSvg({ fill, field, inset = 0 }) {
  const scale = 1 - inset * 2;
  const g = inset
    ? `<g fill="${fill}" transform="translate(${round(64 * inset)} ${round(64 * inset)}) scale(${scale})">${MARK}</g>`
    : `<g fill="${fill}">${MARK}</g>`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Kalvard">' +
    (field ? `<rect width="64" height="64" fill="${field}"/>` : '') +
    g +
    '</svg>'
  );
}

writeFileSync(join(assets, 'avatar.svg'), avatarSvg({ fill: 'currentColor' }));

const discord = avatarSvg({ fill: STAR, field: GREEN, inset: 0.16 });
writeFileSync(join(assets, 'avatar-512.png'), png(discord, 512));

// Favicons ---------------------------------------------------------------
// Star white on answered green, like the Discord avatar, with a little less
// inset so the mark stays legible at 16px.

const favicon = avatarSvg({ fill: STAR, field: GREEN, inset: 0.1 });
writeFileSync(join(assets, 'favicon.svg'), favicon);
writeFileSync(join(assets, 'apple-touch-icon.png'), png(favicon, 180));
writeFileSync(
  join(assets, 'favicon.ico'),
  ico([16, 32, 48].map((size) => ({ size, data: png(favicon, size) }))),
);

copyFileSync(join(assets, 'favicon.ico'), join(appDir, 'favicon.ico'));
copyFileSync(join(assets, 'favicon.svg'), join(appDir, 'icon.svg'));
copyFileSync(join(assets, 'apple-touch-icon.png'), join(appDir, 'apple-icon.png'));

for (const f of [
  'wordmark.svg',
  'avatar.svg',
  'avatar-512.png',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
]) {
  console.log(`${String(statSync(join(assets, f)).size).padStart(7)} B  assets/${f}`);
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

/** Trims path numbers to one decimal so the file stays small. */
function tidy(svg) {
  return svg.replace(/-?\d+\.\d{2,}/g, (m) => String(round(Number(m))));
}
