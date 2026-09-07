#!/usr/bin/env node
// Every screen at 375, in one pass.
//
//   node scripts/mobile.mjs [--out shots/mobile]
//
// Build order line 14 is a mobile pass across the whole product, and the only
// way to do that honestly is to look at every screen at the width people
// actually hold. The dev routes render the dashboard and setup without a
// session, so this needs no login and no seeded account.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import process from 'node:process';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};

const out = arg('out', 'shots/mobile');
const base = arg('url', 'http://localhost:3000');
const PAGES = [
  { name: 'marketing', path: '/' },
  { name: 'setup', path: '/dev/setup' },
  { name: 'onboarding', path: '/dev/onboarding' },
  { name: 'dashboard', path: '/dev/dashboard' },
  { name: 'servers', path: '/dev/servers' },
  { name: 'automation', path: '/dev/automation' },
  { name: 'ui', path: '/dev/ui' },
  { name: 'about', path: '/about' },
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

for (const target of PAGES) {
  await page.goto(base + target.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  // Anything wider than the screen is the defect this pass is looking for.
  const overflow = await page.evaluate(() => {
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
      })
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
    return { scrollW: document.documentElement.scrollWidth, wide };
  });
  await page.screenshot({ path: `${out}/${target.name}.png`, fullPage: false });
  console.log(
    `${target.name}: scrollWidth ${overflow.scrollW}${overflow.wide.length ? ` | wide: ${overflow.wide.join(', ')}` : ''}`,
  );
}

await browser.close();
