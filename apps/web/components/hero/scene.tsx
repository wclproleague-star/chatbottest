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
/** Dawn: the hero fades out over the first third of the band. */
const HERO_FADE_END = 1 / 3;

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
  dark = 0,
  dawn = 0,
  boost = null,
  onReady,
  behind,
  children,
}: {
  light: Light;
  /** Night over the scene, 0 to 1. The thread screen uses 0.2. */
  dark?: number;
  /** Dawn progress, 0 to 1. */
  dawn?: number;
  boost?: SkyRect | null;
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

  const fade = 1 - Math.min(1, dawn / HERO_FADE_END);

  const horizon = rect ? rect.top + meta.horizon * rect.height : null;

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
            opacity: fade,
          }}
        />
      )}

      <div className="absolute inset-0">{behind}</div>

      <div className="absolute inset-0">
        <Sky
          dawn={dawn}
          boost={boost}
          contrast={CONTRAST}
          horizon={horizon}
          beacon={rect ? { frame: rect, x: meta.focusX, light, fade } : null}
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
            opacity: fade,
          }}
        />
      )}

      <div className="absolute inset-0" style={{ opacity: fade }}>
        <div aria-hidden className="bg-night absolute inset-0" style={{ opacity: dark }} />
        {children}
      </div>
    </div>
  );
}
