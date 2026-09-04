'use client';

import { cx } from '@sentrybot/ui';
import { useState } from 'react';
import { Hero } from '@/components/hero/hero';
import type { ReplayFrom } from '@/components/hero/hero';
import { SPRINGS, SPRING_NAMES } from '@/components/hero/springs';
import type { SpringName } from '@/components/hero/springs';

/** The hero with a picker for the mod reply's spring. Picking one replays the landing. */
export function HeroDemo() {
  const [spring, setSpring] = useState<SpringName>('settle');
  const [replay, setReplay] = useState<{ token: number; from: ReplayFrom }>({
    token: 0,
    from: 'start',
  });

  return (
    <>
      <Hero spring={SPRINGS[spring]} replayToken={replay.token} replayFrom={replay.from} />
      <div className="text-ui-sm text-star/70 bg-night z-20 flex flex-wrap items-baseline gap-x-5 gap-y-2 px-6 py-6 md:fixed md:bottom-6 md:left-6 md:max-w-[calc(100vw-48px)] md:bg-transparent md:p-0">
        {SPRING_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setSpring(name);
              setReplay((r) => ({ token: r.token + 1, from: 'landing' }));
            }}
            className={cx(
              'underline-offset-[3px]',
              name === spring ? 'text-star underline' : 'hover:underline',
            )}
          >
            {SPRINGS[name].label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setReplay((r) => ({ token: r.token + 1, from: 'start' }))}
          className="underline-offset-[3px] hover:underline"
        >
          Replay all
        </button>
        <span>{SPRINGS[spring].note}</span>
      </div>
    </>
  );
}
