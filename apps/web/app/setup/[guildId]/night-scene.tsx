'use client';

// The two night screens of setup, in the same place the hero stands.
//
// A beacon on flat black is an unlit asset on a page; a beacon on the headland
// is the same object the site opens with, and setup is where somebody meets it
// for the first time. So these screens borrow the hero's scene outright: the
// photograph, the coded sky over it, the object with its contact shadow on the
// same baseline. Nothing here is a new asset.
//
// What is different is the treatment. This screen carries one sentence, so the
// view behind it is a room and not the subject: the photograph at 35% with a
// heavier defocus, half the hero's stars, and nothing follows the cursor,
// since the only thing that moves on these screens is the light itself.

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@sentrybot/ui';
import { Scene } from '@/components/hero/scene';
import type { Light } from '@/components/hero/script';

const PHOTO = { brightness: 0.35, blur: 8 };
const DENSITY = 0.5;

export function NightScene({
  light,
  label,
  changeMs,
  children,
}: {
  light: Light;
  label: string;
  changeMs?: number;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-[calc(100vh-2px)]">
      <Scene light={light} photo={PHOTO} density={DENSITY} parallax={false} changeMs={changeMs}>
        <div
          role="img"
          aria-label={label}
          className="flex min-h-[calc(100vh-2px)] flex-col items-center justify-end px-6 pb-[12vh]"
        >
          {children}
        </div>
      </Scene>
    </div>
  );
}

/** How long the line takes to type itself out, ms per character. */
const TYPE_MS = 34;
/** The slit's crossfade to green: the event this screen is about. */
const TO_GREEN_MS = 600;
/** A beat with the beacon standing there before anything is said. */
const ARRIVE_MS = 700;

/**
 * The install succeeded, staged rather than stated. The beacon arrives amber,
 * the line types itself out, the slit turns green over six tenths of a second,
 * and only then is there something to click: green is the result of an answer,
 * and this is the first one it ever gives you.
 *
 * Reduced motion is the end state, immediately.
 */
export function Live({ guildId, guildName }: { guildId: string; guildName: string }) {
  const line = `Sentry is live on ${guildName}.`;
  const [typed, setTyped] = useState(0);
  const [green, setGreen] = useState(false);
  const [done, setDone] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true);
      setTyped(line.length);
      setGreen(true);
      setDone(true);
      return;
    }
    const timer = window.setTimeout(() => setTyped(1), ARRIVE_MS);
    return () => window.clearTimeout(timer);
  }, [line.length]);

  useEffect(() => {
    if (still || typed === 0 || typed >= line.length) return;
    const timer = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [still, typed, line.length]);

  useEffect(() => {
    if (still || typed < line.length) return;
    const turn = window.setTimeout(() => setGreen(true), 200);
    const button = window.setTimeout(() => setDone(true), 200 + TO_GREEN_MS);
    return () => {
      window.clearTimeout(turn);
      window.clearTimeout(button);
    };
  }, [still, typed, line.length]);

  return (
    <NightScene
      light={green ? 'green' : 'amber'}
      changeMs={TO_GREEN_MS}
      label={green ? 'Sentry, live' : 'Sentry, arriving'}
    >
      <p className="text-body text-star min-h-[1.6em] text-center">
        {line.slice(0, typed)}
        {typed > 0 && typed < line.length && (
          <span aria-hidden className="bg-star ml-0.5 inline-block h-[1em] w-px align-[-0.1em]" />
        )}
      </p>
      <div className="mt-8 h-11">
        {done && (
          <ButtonLink href={`/g/${guildId}/overview`} className="bg-star text-night fade-in">
            Open the dashboard
          </ButtonLink>
        )}
      </div>
    </NightScene>
  );
}
