import type { CSSProperties } from 'react';
import { cx } from './cx';

/** Three options, all Instrument Sans in one colour. The picked one gets outlined into assets/wordmark.svg. */
export type WordmarkVariant = 'standard' | 'condensed' | 'lowercase';

export const WORDMARK_VARIANTS: Record<
  WordmarkVariant,
  { label: string; text: string; stretch: string; tracking: string; weight: number }
> = {
  standard: {
    label: 'Standard',
    text: 'Sentry',
    stretch: '100%',
    tracking: '-0.025em',
    weight: 500,
  },
  condensed: {
    label: 'Condensed',
    text: 'Sentry',
    stretch: '86%',
    tracking: '-0.035em',
    weight: 500,
  },
  lowercase: {
    label: 'Lowercase',
    text: 'sentry',
    stretch: '100%',
    tracking: '-0.02em',
    weight: 500,
  },
};

function styleFor(variant: WordmarkVariant): CSSProperties {
  const v = WORDMARK_VARIANTS[variant];
  return { fontStretch: v.stretch, letterSpacing: v.tracking, fontWeight: v.weight };
}

/** Inline text wordmark for the nav and footer. Inherits colour. */
export function Wordmark({
  variant = 'standard',
  className,
}: {
  variant?: WordmarkVariant;
  className?: string;
}) {
  return (
    <span className={cx('leading-none', className)} style={styleFor(variant)}>
      {WORDMARK_VARIANTS[variant].text}
    </span>
  );
}

/** The same mark as an SVG, one colour via currentColor. */
export function WordmarkSvg({
  variant = 'standard',
  height = 72,
  className,
}: {
  variant?: WordmarkVariant;
  height?: number;
  className?: string;
}) {
  const v = WORDMARK_VARIANTS[variant];
  return (
    <svg
      viewBox="0 0 320 80"
      height={height}
      width={height * 4}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={v.text}
      className={className}
    >
      <text
        x="0"
        y="66"
        fontSize="72"
        fill="currentColor"
        style={{ fontFamily: 'var(--font-sans)', ...styleFor(variant) }}
      >
        {v.text}
      </text>
    </svg>
  );
}
