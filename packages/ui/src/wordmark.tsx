import type { CSSProperties } from 'react';
import { cx } from './cx';

/**
 * The wordmark: Instrument Sans, weight 500, width 86% on the width axis,
 * tracking -0.035em. assets/wordmark.svg is the same mark outlined to paths.
 */
export const WORDMARK_STYLE: CSSProperties = {
  fontStretch: '86%',
  letterSpacing: '-0.035em',
  fontWeight: 500,
};

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('leading-none', className)} style={WORDMARK_STYLE}>
      Kalvard
    </span>
  );
}
