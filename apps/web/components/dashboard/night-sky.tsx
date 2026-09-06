'use client';

// The sky behind the servers screen: the same starfield as the hero, thinned
// out and still. It is the room this product lives in, so it is here at the
// door; it is not the subject, so there are a third as many stars, nothing
// follows the cursor, and there is no cloud worth speaking of.

import { Sky } from '@/components/sky/sky';

const DENSITY = 0.35;
const CONTRAST = 0.07;

export function NightSky() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <Sky density={DENSITY} parallax={false} contrast={CONTRAST} />
    </div>
  );
}
