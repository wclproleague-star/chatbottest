#!/usr/bin/env node
// The banner Kalvard wears on Discord.
//
//   node scripts/banner.mjs
//
// Everything here is the object the whole product is built on: night, the
// headland under it, the beacon standing in the right third with one slit of
// light, and the warm spill that slit throws on the stone beside it. The
// wordmark sits in the dark on the left where there is nothing else to look at.
//
// Drawn rather than photographed, so it can be redrawn: the scene photograph
// supplies the ground and the sea, and the beacon, the light and the type are
// vector over it. Amber, star white and night — no third colour, no glow
// beyond what one strip of light actually throws.

import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const scene = fileURLToPath(new URL('assets/beacon/scene.jpg', root));
// banner-discord.png is the one the bot wears, supplied by hand; this draws
// a stand-in beside it rather than over it.
const out = fileURLToPath(new URL('assets/brand/banner-drawn.png', root));

const W = 1500;
const H = 600;
/** Where the beacon stands, as a share of the width. */
const SLAB_X = 0.78;
const SLAB_W = 0.075;
const SLIT_W = 10;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070B"/>
      <stop offset="0.62" stop-color="#070A10"/>
      <stop offset="1" stop-color="#0A0D13"/>
    </linearGradient>
    <radialGradient id="spill" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#D9A21B" stop-opacity="0.30"/>
      <stop offset="0.45" stop-color="#D9A21B" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#D9A21B" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="slit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F6D68A"/>
      <stop offset="0.5" stop-color="#E8B334"/>
      <stop offset="1" stop-color="#C08D12"/>
    </linearGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0B0D10"/>
      <stop offset="0.7" stop-color="#090B0E"/>
      <stop offset="1" stop-color="#05070A"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="halo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#night)"/>

  <!-- What the one light actually throws: warm on the stone beside it, and
       nothing anywhere else. -->
  <ellipse cx="${W * (SLAB_X - 0.02)}" cy="${H * 0.52}" rx="${W * 0.22}" ry="${H * 0.42}" fill="url(#spill)"/>

  <!-- The beacon: one tapered slab, its slit cut into the face. -->
  <g>
    <rect x="${W * SLAB_X}" y="-20" width="${W * SLAB_W}" height="${H + 40}" fill="url(#stone)"/>
    <rect x="${W * (SLAB_X + SLAB_W)}" y="-20" width="${W * 0.012}" height="${H + 40}" fill="#04060A"/>
    <rect x="${W * SLAB_X + 18}" y="${H * 0.24}" width="${SLIT_W + 8}" height="${H * 0.5}" fill="#E8B334" opacity="0.5" filter="url(#halo)"/>
    <rect x="${W * SLAB_X + 22}" y="${H * 0.25}" width="${SLIT_W}" height="${H * 0.48}" rx="2" fill="url(#slit)"/>
  </g>

  <!-- The wordmark, in the dark where nothing else is. -->
  <g fill="#F2EEE6" font-family="Georgia, 'Times New Roman', 'DejaVu Serif', serif">
    <text x="96" y="${H * 0.34}" font-size="104" letter-spacing="26">KALVARD</text>
    <text x="${96 + 6}" y="${H * 0.34 + 84}" font-size="46" letter-spacing="14" fill="#F2EEE6" opacity="0.86" text-anchor="start" transform="translate(430, 0)">DREAM BIGGER</text>
  </g>

  <!-- The grain the photograph has, so the vector does not sit on top of it. -->
  <rect width="${W}" height="${H}" fill="#070A10" opacity="0.06"/>
</svg>`;

// The headland, darkened to night and kept to the bottom third.
const ground = await sharp(scene)
  .resize(W, Math.round(H * 0.62), { position: 'bottom' })
  .modulate({ brightness: 0.55 })
  .toBuffer();

const drawn = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();

await sharp({ create: { width: W, height: H, channels: 4, background: '#05070B' } })
  .composite([
    { input: ground, top: Math.round(H * 0.38), left: 0, blend: 'over' },
    { input: drawn, top: 0, left: 0, blend: 'over' },
  ])
  .png()
  .toBuffer()
  .then((buffer) => {
    writeFileSync(out, buffer);
    console.log(`${out} — ${W}x${H}, ${Math.round(buffer.length / 1024)}kB`);
  });
