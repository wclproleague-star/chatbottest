import { cx } from './cx';

/**
 * The mark: the K, where the stem is the vard and the slit is cut into it.
 * On a 32-unit grid so every edge lands on a whole pixel at 16, 32, 64 and
 * 256. The body takes currentColor; the slit is always amber, because it is
 * the light and the light has one colour.
 *
 * Two optical sizes. The master is the shape. Under 48px the slit is 1.6
 * times wider and the stem a tenth heavier, or the light falls under a device
 * pixel and goes out. scripts/marks.mjs carries the same geometry and writes
 * assets/brand.
 */
export function AvatarMark({
  size = 96,
  optical,
  className,
}: {
  size?: number;
  /** Overrides the size-based pick. Only a preview needs it. */
  optical?: 'master' | 'small';
  className?: string;
}) {
  const small = (optical ?? (size < 48 ? 'small' : 'master')) === 'small';
  const stemW = small ? 7.7 : 7;
  const slitW = small ? 3.2 : 2;
  const slitX = 4 + (stemW - slitW) / 2;

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="Kalvard"
      className={cx('shrink-0', className)}
    >
      <g fill="currentColor">
        <rect x="4" y="3" width={stemW} height="26" />
        <path d="M13 16 L26 3 L30 3 L15.5 17.5 Z" />
        <path d="M15.5 14.5 L30 29 L26 29 L13 16 Z" />
      </g>
      <rect x={slitX} y="9" width={slitW} height="12" fill="#D9A21B" />
    </svg>
  );
}
