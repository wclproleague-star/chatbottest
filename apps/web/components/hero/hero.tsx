'use client';

// The hero: the thread over the sky, playing once. From 1024px: headline
// left, beacon centre, thread right, beacon and thread standing on the same
// baseline. Below: headline, beacon at 60%, panel, body, buttons, stacked.
// The thread does not start until the sky is up. Reduced motion shows the
// thread at its final state.

import { ButtonLink, Display, Surface, TextLink } from '@sentrybot/ui';
import { useEffect, useState } from 'react';
import { BeaconPlaceholder } from './beacon-placeholder';
import { HeroThread } from './hero-thread';
import { HOLD_AT, lightAt } from './script';

/** The sky's fade-in; the thread waits for it. */
const SKY_FADE_MS = 600;

export function Hero({
  skyReady = true,
  transparent = false,
  fade = 1,
}: {
  /** True once the sky has drawn its first frame. */
  skyReady?: boolean;
  /** Paint no night fill; the sky behind supplies it. */
  transparent?: boolean;
  /** Content opacity, driven by dawn. */
  fade?: number;
}) {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setT(HOLD_AT);
      return;
    }
    if (!skyReady) return;
    const t0 = performance.now() + SKY_FADE_MS;
    let raf = 0;
    const tick = () => {
      const now = performance.now() - t0;
      if (now >= HOLD_AT) {
        setT(HOLD_AT);
        return;
      }
      setT(Math.max(0, now));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [skyReady]);

  return (
    <Surface surface="night" transparent={transparent} className="relative min-h-svh">
      <div
        style={{ opacity: fade }}
        className={
          'max-w-page relative mx-auto flex min-h-svh flex-col justify-center gap-10 px-4 py-16 md:px-6 lg:grid lg:grid-cols-[520px_auto_minmax(0,1fr)] lg:grid-rows-[auto_auto] lg:content-center lg:items-end lg:gap-6 lg:py-24' +
          (fade <= 0 ? ' pointer-events-none' : '')
        }
      >
        <div className="order-1 lg:col-start-1 lg:row-start-1 lg:self-end">
          {/* Four lines below 1024px; from 1024px, 64px in exactly three. Never one word alone. */}
          <Display className="whitespace-nowrap lg:[--display-size:64px]">
            The server
            <br className="lg:hidden" /> assistant
            <br className="hidden lg:inline" /> that
            <br className="lg:hidden" /> asks before
            <br /> it answers.
          </Display>
        </div>

        <div className="order-2 flex items-end justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch">
          {/* 60% of the panel's height until 1280px, where the full height fits. */}
          <BeaconPlaceholder light={lightAt(t)} className="h-48 lg:h-[60%] xl:h-full" />
        </div>

        <div className="order-3 flex justify-center lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:justify-end lg:self-end">
          <HeroThread t={t} />
        </div>

        <div className="order-4 lg:col-start-1 lg:row-start-2 lg:self-start">
          <p className="max-w-[40ch]">
            It answers from what your server already knows, and asks a moderator when it
            doesn&apos;t.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <ButtonLink href="/servers">Set up your bot</ButtonLink>
            <TextLink href="#how-it-learns">See how it learns</TextLink>
          </div>
        </div>
      </div>
    </Surface>
  );
}
