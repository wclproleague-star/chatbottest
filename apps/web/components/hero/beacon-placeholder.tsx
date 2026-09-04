import { cx } from '@sentrybot/ui';
import type { Light } from './script';

/**
 * Stands in for the photographed beacon until assets/beacon/ exists: the
 * avatar mark's silhouette in ink with a faint edge, and a light that follows
 * the thread. The real object brings its own shadow, three light-state images
 * crossfading over 240ms, and a rotation video that plays once on load.
 */
export function BeaconPlaceholder({ light, className }: { light: Light; className?: string }) {
  const color = light === 'amber' ? '#D9A21B' : '#23A55A';
  return (
    <svg
      viewBox="12 2 40 58"
      aria-hidden
      className={cx('drop-shadow-[0_32px_80px_rgba(0,0,0,0.45)]', className)}
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
      <g fill="#111418" stroke="rgba(242, 238, 230, 0.22)" strokeWidth="0.6">
        <rect x="23" y="20" width="18" height="4" rx="2" />
        <polygon points="30,24 34,24 37,52 27,52" />
        <rect x="16" y="54" width="32" height="4" rx="2" />
      </g>
      <circle cx="32" cy="11" r="15" fill="url(#beacon-halo)" />
      <circle cx="32" cy="11" r="6" fill={color} style={{ transition: 'fill 240ms' }} />
    </svg>
  );
}
