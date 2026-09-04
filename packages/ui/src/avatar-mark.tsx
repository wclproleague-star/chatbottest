import { cx } from './cx';

/**
 * Three avatar marks, flat, one colour, no mascot. All draw in currentColor
 * on a 64-unit grid, so they flip between ink on paper and star white on night.
 */
export type AvatarVariant = 'beacon' | 'midnight' | 'initial';

export const AVATAR_VARIANTS: Record<AvatarVariant, { label: string; idea: string }> = {
  beacon: { label: 'Beacon', idea: 'A light on a tower. The one lit at night.' },
  midnight: { label: 'Midnight', idea: 'A hand at twelve. The hour the sentry is awake.' },
  initial: { label: 'Initial', idea: 'The S, set in the site type, slightly condensed.' },
};

export function AvatarMark({
  variant,
  size = 96,
  className,
}: {
  variant: AvatarVariant;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={`Sentry avatar, ${AVATAR_VARIANTS[variant].label}`}
      className={cx('shrink-0', className)}
    >
      {variant === 'beacon' && (
        // Light, gallery, tapering tower, base: a lighthouse, not an "i".
        <g fill="currentColor">
          <circle cx="32" cy="11" r="6" />
          <rect x="23" y="20" width="18" height="4" rx="2" />
          <polygon points="30,24 34,24 37,52 27,52" />
          <rect x="16" y="54" width="32" height="4" rx="2" />
        </g>
      )}
      {variant === 'midnight' && (
        // Ring, a hand stopped short of the rim, and its pivot: a clock, not a power symbol.
        <g>
          <circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="6" />
          <path
            d="M32 32V18"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="32" cy="32" r="4" fill="currentColor" />
        </g>
      )}
      {variant === 'initial' && (
        <text
          x="32"
          y="48"
          textAnchor="middle"
          fontSize="46"
          fill="currentColor"
          style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontStretch: '88%' }}
        >
          S
        </text>
      )}
    </svg>
  );
}
