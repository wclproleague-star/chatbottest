'use client';

// The beacon at the size of a favicon.
//
// Under about 64px the 3D object is almost entirely edge: the chamfers, the
// recess and the bloom all land inside one or two pixels, and what survives is
// a dark trapezoid with a bright line down it. That is exactly what this
// draws, in vector, so it is sharp at any density and costs no context.
//
// The proportions come from the same measurements the 3D object is built from
// (`PHOTO` in ../sky/beacon), so the two read as one shape at the sizes where
// they sit near each other. The colours and the four light states are the
// same, the pulse included, and reduced motion holds it steady.

import { cx } from '@kalvard/ui';
import type { Light } from '../sky/beacon';

const AMBER = '#D9A21B';
const GREEN = '#23A55A';

/** The drawing's own units: the beacon's height, and its width from PHOTO. */
const H = 100;
const W = 27;
/** The top is this much of the base, as in the prism. */
const TAPER = 0.94;
/** The slit, down the beacon and across it, as the photograph has it. */
const SLIT_TOP = 20;
const SLIT_BOTTOM = 61.7;
const SLIT_X = W * 0.38;
const SLIT_W = 1.7;
const SEGMENTS = 5;

export type BeaconSvgProps = {
  light: Light;
  /** How much of the slit is lit, from the bottom. */
  progress?: number;
  className?: string;
  label?: string;
};

export function BeaconSvg({ light, progress = 1, className, label }: BeaconSvgProps) {
  const colour = light === 'answered' ? GREEN : AMBER;
  const lit = light !== 'asleep';
  const base = (W - W * TAPER) / 2;
  const body = `M ${base} 0 L ${W - base} 0 L ${W} ${H} L 0 ${H} Z`;
  const height = (SLIT_BOTTOM - SLIT_TOP) / SEGMENTS;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={label ?? 'Kalvard'}
      className={cx('pointer-events-none block select-none', className)}
    >
      {lit && (
        <defs>
          <filter id="beacon-glow" x="-200%" y="-50%" width="500%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
      )}
      {/* The body: near-black, with the lit side a shade above the dark one, which
          is all the modelling that survives at this size. */}
      <path d={body} fill="#0B0D10" />
      <path d={`M ${base} 0 L ${W * 0.5} 0 L ${W * 0.5} ${H} L 0 ${H} Z`} fill="#14181F" />
      {lit && (
        <g className={light === 'working' ? 'beacon-svg-pulse' : undefined}>
          <rect
            x={SLIT_X - SLIT_W}
            y={SLIT_TOP}
            width={SLIT_W * 3}
            height={SLIT_BOTTOM - SLIT_TOP}
            fill={colour}
            opacity={0.35}
            filter="url(#beacon-glow)"
          />
          {Array.from({ length: SEGMENTS }, (_, i) => {
            // Lit from the bottom, a fifth at a time, as the recess is.
            const on = i >= SEGMENTS - Math.round(progress * SEGMENTS);
            return (
              <rect
                key={i}
                x={SLIT_X}
                y={SLIT_TOP + i * height}
                width={SLIT_W}
                height={height}
                fill={colour}
                opacity={on ? 1 : 0.12}
              />
            );
          })}
        </g>
      )}
      <style>{
        // One slow breath, the same 1.4s the 3D pulse runs at.
        `.beacon-svg-pulse { animation: beacon-svg-breathe 1400ms ease-in-out infinite; }
         @keyframes beacon-svg-breathe { 0%, 100% { opacity: 1 } 50% { opacity: 0.78 } }
         @media (prefers-reduced-motion: reduce) { .beacon-svg-pulse { animation: none } }`
      }</style>
    </svg>
  );
}
