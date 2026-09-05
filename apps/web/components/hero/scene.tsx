'use client';

// The scene: the generated still of the beacon on its headland, layered.
// Back to front: the frame, defocused with its sky cleaned to near night; the
// coded sky, lightening only the sky region; whatever the page puts behind
// the beacon (the wordmark); the beacon itself, cut out sharp; the 20%
// darkening for the thread screen; then the page's own content on top.
//
// Every layer shares one rect: the frame covers the container like
// object-fit: cover anchored to the bottom, keeping the beacon's centre at
// the same fraction of the width at every size. The light-state frames sit
// over the amber one masked to the slit and its glow, so a change of light
// never touches the body.

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import beaconAmber from '../../../../assets/beacon/beacon-amber.png';
import beaconGreen from '../../../../assets/beacon/beacon-green.png';
import beaconOff from '../../../../assets/beacon/beacon-off.png';
import meta from '../../../../assets/beacon/meta.json';
import sceneAmber from '../../../../assets/beacon/scene-amber.jpg';
import sceneGreen from '../../../../assets/beacon/scene-green.jpg';
import sceneOff from '../../../../assets/beacon/scene-off.jpg';
import { Sky } from '@/components/sky/sky';
import type { SkyRect } from '@/components/sky/sky';
import type { Light } from './script';

/** The nebula against a horizon reads thinner than alone; 0.12 here, 0.09 elsewhere. */
const CONTRAST = 0.12;
/** The light-state crossfade, ms. */
const LIGHT_MS = 240;
/** The coded sky fades out over this much of the frame's height above the horizon. */
const SKY_FEATHER = 0.12;
/** Dawn: the hero fades out over the first third of the band. */
const HERO_FADE_END = 1 / 3;

type Rect = { left: number; top: number; width: number; height: number };

/** The frame's rect over a container, covering it, anchored to the bottom, the beacon kept in frame. */
export function coverRect(width: number, height: number): Rect {
  const scale = Math.max(width / meta.width, height / meta.height);
  const w = meta.width * scale;
  const h = meta.height * scale;
  return { left: (width - w) * meta.focusX, top: height - h, width: w, height: h };
}

const FRAMES = { amber: sceneAmber, green: sceneGreen, off: sceneOff } as const;
const CUTOUTS = { amber: beaconAmber, green: beaconGreen, off: beaconOff } as const;

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

  // The sky owns the frame above the horizon, feathered in; as dawn begins the
  // edge drops below the frame so the whole viewport dissolves to paper.
  let skyMask: string | undefined;
  if (rect) {
    const feather = SKY_FEATHER * rect.height;
    const horizon = rect.top + meta.horizon * rect.height;
    const bottom = rect.top + rect.height + feather;
    const edge = horizon + (bottom - horizon) * Math.min(1, dawn / HERO_FADE_END);
    skyMask = `linear-gradient(to bottom, #000 ${edge - feather}px, transparent ${edge}px)`;
  }

  return (
    <div ref={ref} className="bg-night absolute inset-0 overflow-hidden">
      {rect && (
        <div className="absolute inset-0" style={{ opacity: fade }}>
          <Frame rect={rect} light="amber" />
          <Frame rect={rect} light="green" on={light === 'green'} />
          <Frame rect={rect} light="off" on={light === 'off'} />
        </div>
      )}

      <div
        className="absolute inset-0 mix-blend-lighten"
        style={{ maskImage: skyMask, WebkitMaskImage: skyMask }}
      >
        <Sky dawn={dawn} boost={boost} contrast={CONTRAST} onReady={onReady} />
      </div>

      <div className="absolute inset-0" style={{ opacity: fade }}>
        {behind}
        {rect && <Beacon rect={rect} light={light} />}
        <div aria-hidden className="bg-night absolute inset-0" style={{ opacity: dark }} />
        {children}
      </div>
    </div>
  );
}

function rectStyle(r: Rect): CSSProperties {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** One light-state frame. The green and off frames are masked to the light and its glow. */
function Frame({ rect, light, on = true }: { rect: Rect; light: Light; on?: boolean }) {
  let mask: string | undefined;
  if (light !== 'amber') {
    const cx = (meta.slit.x + meta.slit.w / 2) * rect.width;
    const cy = (meta.slit.y + meta.slit.h / 2 + 0.06) * rect.height;
    const rx = 0.08 * rect.width;
    const ry = 0.42 * rect.height;
    mask = `radial-gradient(${rx}px ${ry}px at ${cx}px ${cy}px, #000 45%, transparent 100%)`;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the layers share one computed rect
    <img
      src={FRAMES[light].src}
      alt=""
      aria-hidden
      draggable={false}
      className="absolute max-w-none select-none"
      style={{
        ...rectStyle(rect),
        opacity: on ? 1 : 0,
        transition: `opacity ${LIGHT_MS}ms ease-out`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

/** The beacon, sharp, in front of the type. Light states crossfade inside the slit only. */
function Beacon({ rect, light }: { rect: Rect; light: Light }) {
  const box: Rect = {
    left: rect.left + meta.cutout.x * rect.width,
    top: rect.top + meta.cutout.y * rect.height,
    width: meta.cutout.w * rect.width,
    height: meta.cutout.h * rect.height,
  };
  // The slit's centre within the cutout, and an ellipse around it wide enough for the glow on the face.
  const cx = (meta.slit.x + meta.slit.w / 2 - meta.cutout.x) * rect.width;
  const cy = (meta.slit.y + meta.slit.h / 2 - meta.cutout.y) * rect.height;
  const rx = 0.03 * rect.width;
  const ry = (meta.slit.h / 2 + 0.04) * rect.height;
  const mask = `radial-gradient(${rx}px ${ry}px at ${cx}px ${cy}px, #000 55%, transparent 100%)`;
  return (
    <div className="absolute" style={rectStyle(box)}>
      {(['amber', 'green', 'off'] as const).map((state) => (
        // eslint-disable-next-line @next/next/no-img-element -- the layers share one computed rect
        <img
          key={state}
          src={CUTOUTS[state].src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full max-w-none select-none"
          style={
            state === 'amber'
              ? undefined
              : {
                  opacity: light === state ? 1 : 0,
                  transition: `opacity ${LIGHT_MS}ms ease-out`,
                  maskImage: mask,
                  WebkitMaskImage: mask,
                }
          }
        />
      ))}
    </div>
  );
}
