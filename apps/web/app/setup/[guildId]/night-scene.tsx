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

import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '@kalvard/ui';
import { Scene } from '@/components/hero/scene';
import { useReveal } from '@/components/hero/ready';
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

/** The same, with the amber edge a panel takes while something is over it. */
const GLASS_DROP: CSSProperties = {
  ...GLASS,
  boxShadow:
    'inset 0 0 0 1px rgba(217, 162, 27, 0.7), inset 0 1px 0 rgba(242, 238, 230, 0.22), 0 32px 80px rgba(0, 0, 0, 0.45)',
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
  fps,
  onSceneReady,
  children,
}: {
  light: Light;
  /** Fifths of the slit lit, from the bottom. */
  progress: number;
  changeMs?: number;
  /** A ceiling on the frame rate while the page is waiting on something. */
  fps?: number;
  /** Called when the canvas has compiled and drawn: half of the ready gate. */
  onSceneReady?: () => void;
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
        fps={fps}
        onReady={onSceneReady}
      >
        <div className="relative h-full">{children}</div>
      </Scene>
    </div>
  );
}

/** The panel's own bounds: it is as tall as what is in it, within these. */
const MIN_H = 220;
const MAX_VH = 0.7;
/** The height moves in 300ms; what is new inside fades over 200ms after it. */
const GROW_MS = 300;
const CONTENT_MS = 200;

/**
 * The glass panel every step lives in. One element for the whole flow: its
 * height follows its content rather than the viewport, moving over 300ms, and
 * the contents of a new step fade in over 200ms once the height has settled.
 * Left half of the scene, max 620 wide, vertically centred; on a phone, full
 * width along the bottom with the beacon behind it.
 */
export function Glass({
  children,
  className,
  wide = false,
  left,
  fadeKey,
  dropping = false,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  children: ReactNode;
  className?: string;
  /** Wider panels for the forms that need the room. */
  wide?: boolean;
  /**
   * Where its left edge goes, in px, on a screen wide enough to have sides.
   * The caller works it out from where the beacon actually stands, so the
   * panel sits in the middle of the room the object leaves it rather than
   * against the window.
   */
  left?: number | null;
  /** Changes when the step does: the body fades rather than snapping. */
  fadeKey?: string;
  /** Something is being dragged over it. */
  dropping?: boolean;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [shown, setShown] = useState(true);
  const first = useRef(true);
  const wideScreen = useWideScreen();

  // The panel is exactly as tall as its content, between the two bounds. The
  // padding lives on the measured box, so the height is the whole of it.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const max = window.innerHeight * MAX_VH;
      setHeight(Math.max(MIN_H, Math.min(max, el.scrollHeight)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // A new step: its contents are laid out at once so the height can move to
  // them, and they show themselves only when the move is over.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShown(false);
    const timer = window.setTimeout(() => setShown(true), GROW_MS);
    return () => window.clearTimeout(timer);
  }, [fadeKey]);

  return (
    <div
      className={cx(
        'text-star absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl',
        'md:inset-x-auto md:left-[5vw] md:top-1/2 md:w-[calc(50vw-5vw)] md:-translate-y-1/2 md:rounded-2xl',
        wide ? 'md:max-w-[680px]' : 'md:max-w-[620px]',
        className,
      )}
      style={{
        ...(dropping ? GLASS_DROP : GLASS),
        height: height ?? undefined,
        // The caller's placement wins over the class, and only where there is
        // room for sides: on a phone the panel is the bottom of the screen.
        ...(wideScreen && left !== null && left !== undefined
          ? { left, width: wide ? 680 : 620, maxWidth: 'none' }
          : null),
        transition: `height ${GROW_MS}ms var(--ease-standard)`,
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={inner}
        className="flex max-h-[70dvh] flex-col overflow-y-auto p-6 md:p-8"
        style={{
          opacity: shown ? 1 : 0,
          transition: `opacity ${CONTENT_MS}ms var(--ease-standard)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Whether the screen has sides to place things in, or is a phone. */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const read = () => setWide(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return wide;
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
      <p className="text-star min-h-[1.6em] text-center text-[26px] leading-snug">
        {line.slice(0, typed)}
        {typed > 0 && typed < line.length && (
          <span aria-hidden className="bg-star ml-0.5 inline-block h-[1em] w-px align-[-0.1em]" />
        )}
      </p>
      <div className="mt-8 flex h-[52px] justify-center">{done && children}</div>
    </>
  );
}

/**
 * Everything that is not the scene itself, revealed in one fade when the
 * screen is ready. It is laid out from the first paint, so revealing it moves
 * nothing, and it is invisible and unclickable until then, so nothing appears
 * twice or arrives late.
 */
export function Reveal({ ready, children }: { ready: boolean; children: ReactNode }) {
  const style = useReveal(ready);
  return (
    <div className="absolute inset-0" style={style} aria-hidden={!ready}>
      {children}
    </div>
  );
}
