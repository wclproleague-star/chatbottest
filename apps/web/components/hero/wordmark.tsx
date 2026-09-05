'use client';

// SENTRY across the hero, behind the beacon. Instrument Sans at the condensed
// end of its width axis, weight 700 for this single use, tracking -0.01em so
// the letters nearly touch, star white. The size is whatever makes the word
// span the container exactly.

import { useEffect, useRef } from 'react';

export function Wordmark() {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    const span = text.current;
    if (!el || !span) return;
    const fit = () => {
      span.style.fontSize = '100px';
      const natural = span.getBoundingClientRect().width;
      if (natural) span.style.fontSize = `${(el.clientWidth / natural) * 100}px`;
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
        SENTRY
      </span>
    </div>
  );
}
