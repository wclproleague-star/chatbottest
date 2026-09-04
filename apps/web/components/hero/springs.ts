// Three named springs for the mod reply's landing. Each crosses its target at
// 240ms; they differ in how much they overshoot and how long they take to rest.
// Expressed as CSS linear() easings sampled from a damped spring.

export type SpringName = 'glide' | 'settle' | 'snap';

export type Spring = {
  name: SpringName;
  label: string;
  note: string;
  durationMs: number;
  ease: string;
};

const CROSS_MS = 240;

/** linear() stops for an underdamped spring that first reaches 1 at CROSS_MS. */
function springEase(zeta: number, durationMs: number, samples = 28): string {
  const root = Math.sqrt(1 - zeta * zeta);
  const omega = (Math.PI - Math.atan(root / zeta)) / ((CROSS_MS / 1000) * root);
  const damped = omega * root;
  const stops: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    const t = (p * durationMs) / 1000;
    const x =
      i === samples
        ? 1
        : 1 -
          Math.exp(-zeta * omega * t) *
            (Math.cos(damped * t) + (zeta / root) * Math.sin(damped * t));
    stops.push(`${x.toFixed(4)} ${(p * 100).toFixed(1)}%`);
  }
  return `linear(${stops.join(', ')})`;
}

export const SPRINGS: Record<SpringName, Spring> = {
  glide: {
    name: 'glide',
    label: 'Glide',
    note: 'Arrives in 240ms and barely overshoots. You feel the landing more than you see it.',
    durationMs: 320,
    ease: springEase(0.78, 320),
  },
  settle: {
    name: 'settle',
    label: 'Settle',
    note: 'Arrives in 240ms, overshoots by about a pixel, and settles once.',
    durationMs: 400,
    ease: springEase(0.62, 400),
  },
  snap: {
    name: 'snap',
    label: 'Snap',
    note: 'Arrives in 240ms with a visible two-pixel bounce before it rests.',
    durationMs: 480,
    ease: springEase(0.5, 480),
  },
};

export const SPRING_NAMES = Object.keys(SPRINGS) as SpringName[];
