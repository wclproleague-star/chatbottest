import { cx } from './cx';

/**
 * The avatar mark: a light, its gallery, a tapering tower, a base. Flat, one
 * colour via currentColor, on a 64-unit grid. assets/avatar.svg is the
 * exported copy; scripts/marks.mjs carries the same four shapes.
 */
export function AvatarMark({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Sentry"
      className={cx('shrink-0', className)}
    >
      <g fill="currentColor">
        <circle cx="32" cy="11" r="6" />
        <rect x="23" y="20" width="18" height="4" rx="2" />
        <polygon points="30,24 34,24 37,52 27,52" />
        <rect x="16" y="54" width="32" height="4" rx="2" />
      </g>
    </svg>
  );
}
