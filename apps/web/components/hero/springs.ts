// The spring for the mod reply's landing: Settle. Crosses its target at 240ms,
// overshoots by about a pixel, settles once, rests by 400ms. Expressed as a CSS
// linear() easing sampled from a damped spring.

export type Spring = { durationMs: number; ease: string };

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

export const SPRING: Spring = { durationMs: 400, ease: springEase(0.62, 400) };
