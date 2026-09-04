import { cx } from '@sentrybot/ui';
import type { Light } from './script';

/**
 * Stands in for the photographed beacon until assets/beacon/ exists, on the
 * same scale and baseline rules so nothing moves at swap: it fills the height
 * it is given and stands on a soft contact shadow at its bottom edge, the
 * floor it shares with the panel. A tall, narrow silhouette in ink with a
 * faint edge, and a light that follows the thread. The photo brings its own
 * shadow and a light-state crossfade masked to the slit.
 */
export function BeaconPlaceholder({ light, className }: { light: Light; className?: string }) {
  const color = light === 'amber' ? '#D9A21B' : '#23A55A';
  return (
    <div className={cx('relative flex flex-col items-center', className)}>
      <svg
        viewBox="0 0 24 64"
        aria-hidden
        className="h-full w-auto drop-shadow-[0_32px_80px_rgba(0,0,0,0.45)]"
      >
        <defs>
          <radialGradient id="beacon-halo">
            <stop
              offset="0"
              stopColor={color}
              stopOpacity="0.32"
              style={{ transition: 'stop-color 240ms' }}
            />
            <stop
              offset="1"
              stopColor={color}
              stopOpacity="0"
              style={{ transition: 'stop-color 240ms' }}
            />
          </radialGradient>
        </defs>
        <g fill="#111418" stroke="rgba(242, 238, 230, 0.22)" strokeWidth="0.5">
          <rect x="5" y="15" width="14" height="3" rx="1.5" />
          <polygon points="10,18 14,18 15.5,60 8.5,60" />
          <rect x="2" y="60" width="20" height="3" rx="1.5" />
        </g>
        <circle cx="12" cy="7" r="11" fill="url(#beacon-halo)" />
        <circle cx="12" cy="7" r="4.5" fill={color} style={{ transition: 'fill 240ms' }} />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 h-3 w-[120%] -translate-x-1/2 translate-y-1/2 rounded-full bg-black/45 blur-md"
      />
    </div>
  );
}
