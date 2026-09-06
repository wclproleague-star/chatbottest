'use client';

// The opening: two pinned screens and the dawn, all over one scene.
//
// Screen 1, the hero: the scene full-bleed, KALVARD spanning the container
// behind the beacon, the headline and body bottom-left, the button bottom-right.
// Screen 2, the thread: as you scroll, the scene holds and darkens 20% while
// the hero's type slides away and the glass panel slides in and pins; the
// thread plays once when the panel is mostly in view, and the beacon's light
// follows it. Then the dawn band: everything fades over its first third while
// the sky dissolves to paper. Scroll-linked directly; reduced motion gets a
// still thread and a 300ms dawn.

import { ButtonLink, Display, Nav, Surface, TextLink } from '@kalvard/ui';
import { useEffect, useRef, useState } from 'react';
import type { SkyRect } from '@/components/sky/sky';
import { HeroThread } from './hero-thread';
import { Scene } from './scene';
import { HOLD_AT, lightAt } from './script';
import { Wordmark } from './wordmark';

/** The thread starts once this much of screen 2 is in view. */
const THREAD_AT = 0.5;
/** The scene darkens by this much over screen 2. */
const DARKEN = 0.2;
const REDUCED_FADE_MS = 300;

function bandPx() {
  return (window.innerWidth < 768 ? 0.4 : 0.6) * window.innerHeight;
}

export function Opening() {
  const [ready, setReady] = useState(false);
  const [t, setT] = useState(-1);
  const [screen2, setScreen2] = useState(0);
  const [dawn, setDawn] = useState(0);
  const [panel, setPanel] = useState<SkyRect | null>(null);
  const heroLayer = useRef<HTMLDivElement>(null);
  const markLayer = useRef<HTMLDivElement>(null);
  const threadLayer = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);
  const tween = useRef(0);
  // Whether the thread has begun. A ref, not state: the effect that starts it
  // must not re-run, and cancel itself, when the clock first moves.
  const started = useRef(false);

  // Scroll: the hero's type leaves with the page, the thread screen slides in
  // and pins, then the band drives dawn.
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let current = 0;

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
      const s = window.scrollY;
      const vh = window.innerHeight;
      const away = -Math.min(s, vh);
      const incoming = Math.max(0, vh - s);
      if (heroLayer.current) heroLayer.current.style.transform = `translate3d(0, ${away}px, 0)`;
      if (markLayer.current) markLayer.current.style.transform = `translate3d(0, ${away}px, 0)`;
      if (threadLayer.current) {
        threadLayer.current.style.transform = `translate3d(0, ${incoming}px, 0)`;
      }
      setScreen2(Math.min(1, Math.max(0, s / vh)));

      const p = Math.min(1, Math.max(0, (s - vh) / bandPx()));
      if (reduced.current) {
        const target = s > vh + 4 ? 1 : 0;
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

  // The panel's place, so the cloud thickens behind the glass.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      setPanel({ x: r.x, y: r.y, width: r.width, height: r.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [screen2]);

  // The thread plays once, from when the sky is up and the panel is mostly in view.
  const arrived = screen2 >= THREAD_AT;
  useEffect(() => {
    if (started.current || !ready || !arrived) return;
    started.current = true;
    if (reduced.current) {
      setT(HOLD_AT);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now() - t0;
      if (now >= HOLD_AT) {
        setT(HOLD_AT);
        return;
      }
      setT(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, arrived]);

  const light = t >= 0 ? lightAt(t) : 'amber';
  const bandVh = 60;

  return (
    <div className="bg-night relative" style={{ height: `calc(200svh + ${bandVh}svh)` }}>
      <Surface surface="night" transparent className="sticky top-0 h-svh overflow-hidden">
        <Scene
          light={light}
          dark={DARKEN * screen2}
          dawn={dawn}
          boost={panel}
          onReady={() => setReady(true)}
          behind={
            <div ref={markLayer} className="absolute inset-0 will-change-transform">
              <div className="max-w-page absolute inset-x-0 top-[14svh] mx-auto px-4 md:px-6">
                <Wordmark />
              </div>
            </div>
          }
        >
          {/* Screen 1: the headline and body bottom-left, the button bottom-right. */}
          <div ref={heroLayer} className="absolute inset-0 will-change-transform">
            <div className="max-w-page absolute inset-x-0 bottom-[7svh] mx-auto flex flex-col gap-8 px-4 md:bottom-[9svh] md:flex-row md:items-end md:justify-between md:px-6">
              <div className="max-w-[30ch]">
                <Display className="[--display-size:32px]">
                  The server assistant that asks before it answers.
                </Display>
                <p className="mt-4 max-w-[40ch]">
                  It answers from what your server already knows, and asks a moderator when it
                  doesn&apos;t.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-6">
                <ButtonLink href="/servers">Set up your bot</ButtonLink>
                <TextLink href="#how-it-learns">See how it learns</TextLink>
              </div>
            </div>
          </div>

          {/* Screen 2: the glass panel, pinned once it arrives. From 768px it
              stands at the container's left edge, clear of the beacon. */}
          <div
            ref={threadLayer}
            className="absolute inset-0 flex items-center will-change-transform"
          >
            <div className="max-w-page mx-auto flex w-full justify-center px-4 md:justify-start md:px-6">
              <div ref={panelRef} className="w-full max-w-[460px]">
                <HeroThread t={Math.max(0, t)} />
              </div>
            </div>
          </div>
        </Scene>

        <div className="absolute left-1/2 top-4 z-30 w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2">
          <Nav pill />
        </div>
      </Surface>
    </div>
  );
}
