'use client';

// The one place setup happens: the hero's scene, held for the whole flow.
//
// The photograph of the headland, the coded sky over it, the beacon standing
// on the ground with its contact shadow, right of centre: the same object the
// site opens with, in the same place, at every step. Nothing here is a new
// asset and nothing moves between steps. What changes is the light. The slit
// is the progress: dark at the door, one fifth in amber per thing decided,
// full amber at the test, green when the bot is live.
//
// Everything a step puts on screen sits in front of the scene on smoked
// glass: night at 60%, a 6px blur, one 1px specular line on the top edge, the
// night shadow, radius 16. The view behind is a room and not the subject, so
// the photograph is darker and further defocused than on the hero, with half
// its stars and nothing following the cursor.

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cx } from '@kalvard/ui';
import { Scene } from '@/components/hero/scene';
import type { Light } from '@/components/hero/script';

const PHOTO = { brightness: 0.35, blur: 8 };
const DENSITY = 0.5;

/** The hero thread's glass, exactly. */
export const GLASS: CSSProperties = {
  backgroundColor: 'rgba(7, 10, 16, 0.6)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  boxShadow:
    'inset 0 1px 0 rgba(242, 238, 230, 0.22), inset 0 -1px 0 rgba(7, 10, 16, 0.4), 0 32px 80px rgba(0, 0, 0, 0.45)',
};

/** A lighter glass, for the member's own words inside the panel. */
export const GLASS_LIGHT: CSSProperties = {
  backgroundColor: 'rgba(242, 238, 230, 0.08)',
  boxShadow: 'inset 0 1px 0 rgba(242, 238, 230, 0.14)',
};

/**
 * The setup buttons: 52px tall, 24px sides, 16px text, radius 12, star white
 * with ink text, a 1px specular top edge; hover brightens 6%, active scales.
 */
export const SCENE_BUTTON =
  'inline-flex h-[52px] shrink-0 items-center justify-center rounded-xl px-6 text-[16px] font-medium bg-star text-night shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition-[filter,transform] duration-(--duration-hover) ease-standard hover:brightness-[1.06] active:scale-[0.98] active:duration-[80ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-star disabled:opacity-40';

/** The quiet second choice: text on glass, no fill. */
export const SCENE_LINK =
  'text-ui text-star/60 hover:text-star underline underline-offset-4 transition-colors';

export function SetupScene({
  light,
  progress,
  changeMs,
  children,
}: {
  light: Light;
  /** Fifths of the slit lit, from the bottom. */
  progress: number;
  changeMs?: number;
  children: ReactNode;
}) {
  return (
    <div className="bg-night relative h-[100dvh] min-h-[560px] overflow-hidden">
      <Scene
        light={light}
        progress={progress}
        photo={PHOTO}
        density={DENSITY}
        parallax={false}
        changeMs={changeMs}
      >
        <div className="relative h-full">{children}</div>
      </Scene>
    </div>
  );
}

/**
 * The glass panel a step lives in. Left half of the scene, max 620 wide,
 * vertically centred, 32px padding; on a phone, full width along the bottom
 * with the beacon behind it. Its inside scrolls when a step is long.
 */
export function Glass({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** Wider panels for the forms that need the room. */
  wide?: boolean;
}) {
  return (
    <div
      className={cx(
        'text-star absolute inset-x-0 bottom-0 flex max-h-[72dvh] flex-col rounded-t-2xl p-6',
        'md:inset-x-auto md:left-[5vw] md:top-1/2 md:max-h-[84dvh] md:w-[calc(50vw-5vw)] md:-translate-y-1/2 md:rounded-2xl md:p-8',
        wide ? 'md:max-w-[680px]' : 'md:max-w-[620px]',
        className,
      )}
      style={GLASS}
    >
      {children}
    </div>
  );
}

/** How long the line takes to type itself out, ms per character. */
const TYPE_MS = 34;
/** The slit's crossfade to green: the event this screen is about. */
export const TO_GREEN_MS = 600;
/** A beat with the beacon standing there before anything is said. */
const ARRIVE_MS = 700;

/**
 * The install succeeded, staged rather than stated. The line types itself
 * out, the slit turns green over six tenths of a second, and only then is
 * there something to click: green is the result of an answer, and this is
 * the first one it ever gives you. Reduced motion is the end state at once.
 * The caller owns the light, so the same beacon that filled up turns green.
 */
export function LiveLine({
  guildName,
  onGreen,
  children,
}: {
  guildName: string;
  onGreen: () => void;
  /** Shown once the light is green: the way into the dashboard. */
  children: ReactNode;
}) {
  const line = `Kalvard is live on ${guildName}.`;
  const [typed, setTyped] = useState(0);
  const [done, setDone] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true);
      setTyped(line.length);
      onGreen();
      setDone(true);
      return;
    }
    const timer = window.setTimeout(() => setTyped(1), ARRIVE_MS);
    return () => window.clearTimeout(timer);
  }, [line.length, onGreen]);

  useEffect(() => {
    if (still || typed === 0 || typed >= line.length) return;
    const timer = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [still, typed, line.length]);

  useEffect(() => {
    if (still || typed < line.length) return;
    const turn = window.setTimeout(onGreen, 200);
    const button = window.setTimeout(() => setDone(true), 200 + TO_GREEN_MS);
    return () => {
      window.clearTimeout(turn);
      window.clearTimeout(button);
    };
  }, [still, typed, line.length, onGreen]);

  return (
    <>
      <p className="text-star min-h-[1.6em] text-center text-[22px] leading-snug">
        {line.slice(0, typed)}
        {typed > 0 && typed < line.length && (
          <span aria-hidden className="bg-star ml-0.5 inline-block h-[1em] w-px align-[-0.1em]" />
        )}
      </p>
      <div className="mt-8 flex h-[52px] justify-center">{done && children}</div>
    </>
  );
}
