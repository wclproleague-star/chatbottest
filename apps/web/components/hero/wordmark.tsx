'use client';

// SENTRY across the hero, behind the beacon. Instrument Sans at the condensed
// end of its width axis, weight 600 for this single use, star white. The size
// fits the container up to 280px; past that the letters are spaced out to
// span it, since the word is short and the container wide. Below 220px the
// size keeps shrinking so it still spans a phone.

import { useEffect, useRef } from 'react';

const MAX_PX = 280;
const LETTERS = 'SENTRY';

export function Wordmark() {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    const span = text.current;
    if (!el || !span) return;
    const fit = () => {
      const width = el.clientWidth;
      span.style.letterSpacing = '0px';
      span.style.marginRight = '0px';
      span.style.fontSize = '100px';
      const natural = span.getBoundingClientRect().width;
      if (!natural) return;
      const size = Math.min(MAX_PX, (width / natural) * 100);
      span.style.fontSize = `${size}px`;
      const at = span.getBoundingClientRect().width;
      // Spacing goes after every letter, the last one too; pull that back.
      const gap = Math.max(0, (width - at) / (LETTERS.length - 1));
      span.style.letterSpacing = `${gap}px`;
      span.style.marginRight = `${-gap}px`;
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
        style={{ fontStretch: '75%', fontWeight: 600, letterSpacing: 0 }}
      >
        {LETTERS}
      </span>
    </div>
  );
}
