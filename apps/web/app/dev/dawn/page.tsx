'use client';

// Dawn. The sky is fixed behind the page; scrolling drives it from night to
// paper over one band (60vh, 40vh on phones), linked directly to scroll with
// no smoothing. The hero's content fades out over the first third of the
// band; the nav becomes the ink pill at 60%; paper content starts only after
// the band ends. Reduced motion: the dawn is a 300ms fade once scrolling
// begins.

import { Nav, Surface } from '@sentrybot/ui';
import { useEffect, useRef, useState } from 'react';
import { Hero } from '@/components/hero/hero';
import { Sky } from '@/components/sky/sky';
import type { SkyRect } from '@/components/sky/sky';

const HERO_FADE_END = 1 / 3;
const PILL_AT = 0.6;
const REDUCED_FADE_MS = 300;

function bandPx() {
  return (window.innerWidth < 768 ? 0.4 : 0.6) * window.innerHeight;
}

export default function Page() {
  const [ready, setReady] = useState(false);
  const [dawn, setDawn] = useState(0);
  const [panel, setPanel] = useState<SkyRect | null>(null);
  const reduced = useRef(false);
  const tween = useRef(0);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let current = 0;

    // Reduced motion: no scroll link. Fade to the target over 300ms instead.
    const fadeTo = (target: number) => {
      cancelAnimationFrame(tween.current);
      const from = current;
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / REDUCED_FADE_MS);
        current = from + (target - from) * k;
        setDawn(current);
        if (k < 1) tween.current = requestAnimationFrame(step);
      };
      tween.current = requestAnimationFrame(step);
    };

    const read = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / bandPx()));
      if (reduced.current) {
        const target = window.scrollY > 4 ? 1 : 0;
        if (target !== current) fadeTo(target);
        return;
      }
      current = p;
      setDawn(p);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(tween.current);
    };
  }, []);

  const fade = 1 - Math.min(1, dawn / HERO_FADE_END);

  return (
    <main className="bg-night relative">
      <div className="fixed inset-0">
        <Sky dawn={dawn} boost={panel} onReady={() => setReady(true)} />
      </div>

      <div className="fixed left-1/2 top-4 z-30 w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2">
        <Nav pill={dawn >= PILL_AT} />
      </div>

      <div className="relative z-10">
        <Hero skyReady={ready} transparent fade={fade} onPanelRect={setPanel} />
        {/* The dawn band. Paper content starts after it, never inside it. */}
        <div aria-hidden className="h-[40vh] md:h-[60vh]" />
        <Surface surface="paper" className="min-h-screen" />
      </div>
    </main>
  );
}
