'use client';

// The scene: the generated still of the headland, with the beacon standing in
// it as a 3D object. Back to front: the frame, defocused with its sky cleaned
// to near night and the beacon removed; whatever the page puts behind the
// beacon (the wordmark); one canvas that adds the coded sky as light over the
// sky region and draws the lit beacon opaque, so it stands in front of the
// type; the foreground grass at the footing, cut out, so blades stand in
// front of the base; the 20% darkening for the thread screen; then the
// page's own content.
//
// The frame covers the container like object-fit: cover anchored to the
// bottom, keeping the same point of the headland at the same fraction of the
// width at every size. The beacon stands where the photograph's stood.

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import grass from '../../../../assets/beacon/grass.png';
import meta from '../../../../assets/beacon/meta.json';
import scene from '../../../../assets/beacon/scene.jpg';
import { Sky } from '@/components/sky/sky';
import type { SkyRect } from '@/components/sky/sky';
import type { Light } from './script';

/** The nebula against a horizon reads thinner than alone; 0.12 here, 0.09 elsewhere. */
const CONTRAST = 0.12;
/** Dawn: the hero's own type fades over the first third of the band. */
const HERO_FADE_END = 1 / 3;

/**
 * Dawn is a grade, not a dissolve.
 *
 * The headland, the sea and the horizon stay exactly where they are for the
 * whole page. What changes is the sky and the light on the land: the stars go
 * out, the sky lifts from night through a cold dawn blue to the pale the page
 * itself is made of, and the grass and rock lighten as if the sun were behind
 * the camera. Crossfading to a flat background would say the opposite — that
 * the place was a backdrop we swapped out — when the point is that it is the
 * same place, hours later, and it did not need the dark to work.
 */
const NIGHT = [7, 10, 16];
const DAWN_BLUE = [36, 64, 95];
const PAPER = [237, 239, 241];

function mix(a: number[], b: number[], k: number): string {
  const at = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * k);
  return `rgb(${at(0)}, ${at(1)}, ${at(2)})`;
}

/** The sky's own curve: night to a cold blue by halfway, then to paper. */
function skyAt(dawn: number, high: boolean): string {
  const k = Math.min(1, Math.max(0, dawn));
  if (k <= 0.5) return mix(NIGHT, DAWN_BLUE, (k / 0.5) * (high ? 0.85 : 1));
  return mix(DAWN_BLUE, PAPER, ((k - 0.5) / 0.5) * (high ? 1 : 0.92));
}

/** The land's own curve: an exposure lift, and the colour of night draining out. */
function landAt(dawn: number): string {
  const k = Math.min(1, Math.max(0, dawn));
  return `brightness(${1 + 0.75 * k}) contrast(${1 - 0.2 * k}) saturate(${1 - 0.25 * k})`;
}

type Rect = { left: number; top: number; width: number; height: number };

/** The frame's rect over a container, covering it, anchored to the bottom. */
export function coverRect(width: number, height: number): Rect {
  const scale = Math.max(width / meta.width, height / meta.height);
  const w = meta.width * scale;
  const h = meta.height * scale;
  return { left: (width - w) * meta.focusX, top: height - h, width: w, height: h };
}

export function Scene({
  light,
  progress = 1,
  dark = 0,
  dawn = 0,
  changeMs,
  boost = null,
  photo = null,
  density = 1,
  parallax = true,
  fps = 0,
  onReady,
  behind,
  children,
}: {
  light: Light;
  /** How much of the slit is lit, from the bottom, in fifths. Setup fills it; everywhere else 1. */
  progress?: number;
  /** Night over the scene, 0 to 1. The thread screen uses 0.2. */
  dark?: number;
  /** Dawn progress, 0 to 1. */
  dawn?: number;
  /** How long the slit takes to change colour, ms. */
  changeMs?: number;
  boost?: SkyRect | null;
  /**
   * How the photograph is treated behind a screen that is about one sentence
   * rather than about the view: darker, and defocused further, so it is the
   * room the beacon stands in and never the thing being read.
   */
  photo?: { brightness: number; blur: number } | null;
  /** How many stars, against the hero's. */
  density?: number;
  /** Whether the stars follow the cursor. */
  parallax?: boolean;
  /** A ceiling on the frame rate while the page is busy. 0 is uncapped. */
  fps?: number;
  onReady?: () => void;
  /** Rendered between the sky and the beacon: the wordmark. */
  behind?: ReactNode;
  /** Rendered in front of everything. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRect(coverRect(el.clientWidth, el.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The hero's own type leaves early in the band; the photograph does not.
  const fade = 1 - Math.min(1, dawn / HERO_FADE_END);
  const graded = landAt(dawn);

  const horizon = rect ? rect.top + meta.horizon * rect.height : null;
  // The grass at the footing is part of the photograph, so it takes the same
  // treatment: a lit blade in front of a darkened cliff would give it away.
  const treatment = photo
    ? { filter: `brightness(${photo.brightness}) blur(${photo.blur}px)` }
    : undefined;

  return (
    <div ref={ref} className="bg-night absolute inset-0 overflow-hidden">
      {rect && (
        // eslint-disable-next-line @next/next/no-img-element -- laid out on a computed rect
        <img
          src={scene.src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute max-w-none select-none"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            filter: treatment ? `${treatment.filter} ${graded}` : graded,
          }}
        />
      )}

      {/* The sky, graded on its own curve and stopping at the horizon, so the
          land keeps its own. The page's paper is what the sky arrives at, so
          the sections below continue the surface the sky became. */}
      {rect && dawn > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: (horizon ?? rect.top) - rect.top + 1,
            background: `linear-gradient(180deg, ${skyAt(dawn, true)} 0%, ${skyAt(dawn, false)} 100%)`,
            opacity: Math.min(1, dawn * 1.15),
          }}
        />
      )}

      <div className="absolute inset-0">{behind}</div>

      <div className="absolute inset-0">
        <Sky
          dawn={dawn}
          boost={boost}
          contrast={CONTRAST}
          density={density}
          parallax={parallax}
          fps={fps}
          horizon={horizon}
          beacon={rect ? { frame: rect, x: meta.focusX, light, progress, fade, changeMs } : null}
          onReady={onReady}
        />
      </div>

      {rect && (
        // eslint-disable-next-line @next/next/no-img-element -- laid out on a computed rect
        <img
          src={grass.src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute max-w-none select-none"
          style={{
            left: rect.left + meta.grass.x * rect.width,
            top: rect.top + meta.grass.y * rect.height,
            width: meta.grass.w * rect.width,
            height: meta.grass.h * rect.height,
            filter: treatment ? `${treatment.filter} ${graded}` : graded,
          }}
        />
      )}

      <div className="absolute inset-0" style={{ opacity: fade }}>
        {/* Decoration, and positioned, so without this it would paint over the
            page's own content and swallow every click on it. */}
        <div
          aria-hidden
          className="bg-night pointer-events-none absolute inset-0"
          style={{ opacity: dark }}
        />
        <div className="relative h-full">{children}</div>
      </div>
    </div>
  );
}
