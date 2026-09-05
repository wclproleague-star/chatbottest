'use client';

// SENTRY across the hero, behind the beacon. Instrument Sans at the condensed
// end of its width axis, weight 700 for this single use, tracking -0.01em so
// the letters nearly touch, star white. The size is whatever makes the word
// span the container exactly. It reports where the R stands, so the beacon can
// be placed a third of the way across it.

import { useEffect, useRef } from 'react';

const LETTERS = ['S', 'E', 'N', 'T', 'R', 'Y'] as const;
const R_INDEX = 4;

/** A letter's horizontal extent in viewport px. */
export type LetterRect = { left: number; right: number };

export function Wordmark({ onLetterR }: { onLetterR?: (rect: LetterRect) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const letterR = useRef<HTMLSpanElement>(null);
  const report = useRef(onLetterR);
  report.current = onLetterR;

  useEffect(() => {
    const el = box.current;
    const span = text.current;
    if (!el || !span) return;
    const fit = () => {
      const width = el.clientWidth;
      span.style.fontSize = '100px';
      const natural = span.getBoundingClientRect().width;
      if (!natural) return;
      span.style.fontSize = `${(width / natural) * 100}px`;
      const r = letterR.current?.getBoundingClientRect();
      if (r) report.current?.({ left: r.left, right: r.right });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    if (document.fonts) document.fonts.ready.then(fit).catch(() => undefined);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} aria-hidden className="w-full overflow-hidden">
      <span
        ref={text}
        className="text-star inline-block whitespace-nowrap leading-none"
        style={{ fontStretch: '75%', fontWeight: 700, letterSpacing: '-0.01em' }}
      >
        {LETTERS.map((letter, i) => (
          <span key={letter} ref={i === R_INDEX ? letterR : undefined}>
            {letter}
          </span>
        ))}
      </span>
    </div>
  );
}
