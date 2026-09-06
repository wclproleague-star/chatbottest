'use client';

// Scene to console, and back.
//
// The moment setup turns on is not night becoming day: the dashboard is dark
// too. It is the scene becoming the console — the headland dissolving, the
// ground rising from #070A10 to #0E1116, and the one object you have been
// looking at travelling to the slot it will occupy for the rest of setup,
// shrinking as it goes. Installing runs it backwards: the console goes, the
// headland returns, and the beacon grows back to the middle of it.
//
// The object that travels is the same component as everywhere else. It is
// animated by its box rather than by a transform, so it redraws at each size
// and arrives sharp instead of scaled.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import meta from '../../../../../assets/beacon/meta.json';
import { Beacon } from '@/components/beacon/beacon';
import { Scene, coverRect } from '@/components/hero/scene';
import { PHOTO } from '@/components/sky/beacon';
import type { Light } from '@/components/sky/beacon';

/** The length of the whole move. */
export const TRAVEL_MS = 600;

/** The photograph's treatment on these screens, as the night screens have it. */
const TREATMENT = { brightness: 0.35, blur: 8 };
const DENSITY = 0.5;

type Box = { left: number; top: number; width: number; height: number };

/**
 * Where the scene's own beacon stands on screen, from the same numbers the
 * scene lays it out with, so the travelling one starts exactly where the one
 * you were looking at was.
 */
function sceneBox(width: number, height: number): Box {
  const frame = coverRect(width, height);
  const top = frame.top + PHOTO.beaconTop * frame.height;
  const bottom = frame.top + PHOTO.beaconBase * frame.height;
  // The object reads about 20% slimmer than the photograph's monolith.
  const w = PHOTO.beaconWidth * 0.8 * frame.width;
  return {
    left: frame.left + meta.focusX * frame.width - w / 2,
    top,
    width: w,
    height: bottom - top,
  };
}

export function Travel({
  direction,
  light,
  slot,
  onDone,
}: {
  /** `in` is scene to console; `out` is console back to scene. */
  direction: 'in' | 'out';
  light: Light;
  /** Where the beacon sits on the console: the card's slot, measured. */
  slot: Box | null;
  onDone: () => void;
}) {
  const [moved, setMoved] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  const [scene, setScene] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const measure = () => setScene(sceneBox(window.innerWidth, window.innerHeight));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    // One frame at the start position, then the move.
    const start = requestAnimationFrame(() => setMoved(true));
    const end = window.setTimeout(() => done.current(), TRAVEL_MS);
    return () => {
      cancelAnimationFrame(start);
      window.clearTimeout(end);
    };
  }, []);

  const from = direction === 'in' ? scene : slot;
  const to = direction === 'in' ? slot : scene;
  const box = (moved ? to : from) ?? from ?? scene;
  const showScene = direction === 'in' ? !moved : moved;

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {/* The headland, dissolving or arriving. Its own beacon goes with it;
          the one that travels is drawn over the top. */}
      <div
        className="ease-standard absolute inset-0 transition-opacity"
        style={{ opacity: showScene ? 1 : 0, transitionDuration: `${TRAVEL_MS}ms` }}
      >
        <Scene light="off" photo={TREATMENT} density={DENSITY} parallax={false} />
      </div>

      {box && (
        <div
          className="ease-standard absolute transition-all"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            transitionDuration: `${TRAVEL_MS}ms`,
          }}
        >
          <Beacon light={light} progress={0} height={1} className="h-full w-full" render="3d" />
        </div>
      )}
    </div>
  );
}
