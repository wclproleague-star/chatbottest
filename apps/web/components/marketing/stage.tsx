'use client';

// The object, and where it stands while you read.
//
// One canvas for the whole page, mounted when the page loads and never
// unmounted. The scene inside it is the same photograph the hero opens on, so
// nothing is ever redrawn or swapped: what changes is where the canvas is on
// screen, how big the beacon is in it, and what its light is doing.
//
// The hero has it full-bleed. From the thread onward it settles into a column
// on the right and stays there, vertically centred, while the left column
// scrolls past it — the content changes, the object reacts. At the close it
// grows back and the night returns behind it.

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Scene } from '@/components/hero/scene';
import type { Light } from '@/components/sky/beacon';

/** How long the object takes to leave the hero and settle in its column. */
export const SETTLE_MS = 600;
/** The column's share of the viewport width, from the right edge. */
const COLUMN = 0.42;
/** Below this, the object docks at the top instead of standing beside the page. */
export const NARROW = 900;
/** Docked height on a narrow screen. */
const DOCK_H = 120;

export type StageAt = {
  /** 0 in the hero, 1 once it has settled into its column. */
  settled: number;
  /** Dawn, 0 to 1: night, through the band, to morning. */
  dawn: number;
  light: Light;
  /** Night over the scene: the thread screen darkens it by a fifth. */
  dark?: number;
  /** How long this change of light should take. */
  changeMs?: number;
};

/**
 * Where the canvas sits, in viewport pixels.
 *
 * Full-bleed at the top, the right-hand column once settled, and it is one
 * eased interpolation between them so the object travels rather than jumps.
 */
function frame(settled: number, w: number, h: number, narrow: boolean) {
  if (narrow) {
    const top = 0;
    return {
      left: 0,
      top,
      width: w,
      height: h - (h - DOCK_H) * settled,
    };
  }
  const columnW = w * COLUMN;
  return {
    left: (w - columnW) * settled,
    top: 0,
    width: w - (w - columnW) * settled,
    height: h,
  };
}

export function Stage({
  at,
  onReady,
  behind,
  children,
}: {
  at: StageAt;
  onReady?: () => void;
  /** Behind the beacon, inside the canvas: the wordmark, in the hero only. */
  behind?: ReactNode;
  /** Over the scene: the hero's own copy, and the thread panel. */
  children?: ReactNode;
}) {
  // Measured before anything is drawn. A canvas that mounts into a box of no
  // size measures none, and a ResizeObserver arriving later does not undo a
  // one-by-one pixel backing store: the scene simply never appears.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const held = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (!size) return null;
  const narrow = size.w < NARROW;
  const box = frame(at.settled, size.w, size.h, narrow);
  return (
    <div
      ref={held}
      aria-hidden
      className="pointer-events-none fixed z-0"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <div className="pointer-events-auto absolute inset-0">
        <Scene
          light={at.light}
          dark={at.dark ?? 0}
          dawn={at.dawn}
          changeMs={at.changeMs}
          onReady={onReady}
          behind={behind}
        >
          {children}
        </Scene>
      </div>
    </div>
  );
}
