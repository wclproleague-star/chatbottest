#!/usr/bin/env node
// Screenshots of the marketing page, section by section, at both widths.
//
//   pnpm dev:web                 (in another terminal)
//   node scripts/shots.mjs       [--width 1440,2560,375] [--out shots]
//
// Each section is scrolled to, given time for the scene to settle and any
// motion to run, and captured. The point is to be able to look at the whole
// page at once, in the morning, rather than scrolling a dev server.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import process from 'node:process';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};

const widths = arg('width', '1440,2560').split(',').map(Number);
const out = arg('out', 'shots');
const url = arg('url', 'http://localhost:3000/');
/**
 * Each section is found by name and scrolled to, rather than by a multiple of
 * the viewport: the moment a section's padding changes, fixed offsets are
 * screenshots of the wrong thing, which is exactly how a page gets reviewed
 * from a picture of somewhere else.
 */
const SECTIONS = [
  { name: 'hero', wait: 1500 },
  { name: 'thread', wait: 13000 },
  { name: 'dawn', wait: 1200 },
  { name: 'does', wait: 1500 },
  { name: 'week', wait: 5000 },
  { name: 'setup', wait: 1000 },
  { name: 'fits', wait: 1000 },
  { name: 'pricing', wait: 1000 },
  { name: 'close', wait: 1500 },
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

for (const width of widths) {
  const height = width >= 2000 ? 1440 : width < 500 ? 812 : 900;
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle' });
  // The page reveals in one fade when everything is ready; give it that.
  await page.waitForTimeout(3000);

  for (const section of SECTIONS) {
    const goTo = (name) =>
      page.evaluate((n) => {
        const el = document.querySelector(`[data-scene="${n}"]`);
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
      }, name);
    // Twice, with the wait between: a section that grows while the page
    // settles takes the previous scroll position somewhere else, and the
    // picture is then of the wrong part of the page.
    await goTo(section.name);
    await page.waitForTimeout(section.wait);
    await goTo(section.name);
    await page.waitForTimeout(600);
    const file = `${out}/${width}-${section.name}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
  await page.close();
}

await browser.close();
