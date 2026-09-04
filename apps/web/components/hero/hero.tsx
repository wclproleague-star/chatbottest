'use client';

// The hero: the thread over the sky, playing once, with the beacon between
// the headline and the thread. Headline left, beacon centre, thread right on
// desktop; beacon, thread, then headline stacked on mobile. Reduced motion
// shows the thread at its final state.

import { ButtonLink, Display, Surface, TextLink } from '@sentrybot/ui';
import { useEffect, useState } from 'react';
import { Sky } from '@/components/sky/sky';
import { BeaconPlaceholder } from './beacon-placeholder';
import { HeroThread } from './hero-thread';
import { HOLD_AT, LANDING_AT, lightAt } from './script';
import type { Spring } from './springs';

export type ReplayFrom = 'start' | 'landing';

export function Hero({
  spring,
  replayToken = 0,
  replayFrom = 'start',
}: {
  spring: Spring;
  /** Change it to replay. */
  replayToken?: number;
  replayFrom?: ReplayFrom;
}) {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setT(HOLD_AT);
      return;
    }
    const offset = replayFrom === 'landing' ? LANDING_AT - 400 : 0;
    const t0 = performance.now() - offset;
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
    setT(offset);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replayToken, replayFrom]);

  return (
    <Surface surface="night" className="relative min-h-svh overflow-hidden">
      <div className="absolute inset-0">
        <Sky />
      </div>
      <div className="max-w-page relative mx-auto flex min-h-svh flex-col justify-center gap-10 px-6 py-16 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)] md:items-center md:gap-10 md:py-24">
        <div className="order-3 md:order-1">
          <Display className="max-w-[12ch]">
            The server assistant that asks before it answers.
          </Display>
          <p className="mt-6 max-w-[40ch]">
            It answers from what your server already knows, and asks a moderator when it
            doesn&apos;t.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <ButtonLink href="/servers">Set up your bot</ButtonLink>
            <TextLink href="#how-it-learns">See how it learns</TextLink>
          </div>
        </div>
        <div className="order-1 flex justify-center md:order-2">
          <BeaconPlaceholder light={lightAt(t)} className="h-28 md:h-[360px]" />
        </div>
        <div className="order-2 flex justify-center md:order-3 md:justify-end">
          <HeroThread t={t} spring={spring} landingKey={replayToken} />
        </div>
      </div>
    </Surface>
  );
}
