'use client';

// The beacon, on its own.
//
// The same object as the hero: the same geometry, the same materials, the same
// post pass. What changes is that nothing else is in the frame, so it can
// stand in the middle of a setup screen at any size, or sit beside a run
// summary at the size of a card.
//
// It draws only when it has to. A steady light is one frame; a working light
// breathes, so it runs while it is working and stops when it is not. Reduced
// motion never animates: it draws the end state once.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { PHOTO, createBeacon } from '../sky/beacon';
import type { Light } from '../sky/beacon';
import { cx } from '@kalvard/ui';
import { BeaconSvg } from './beacon-svg';

export type BeaconProps = {
  /** What the light is doing. */
  light: Light;
  /** How much of the slit is lit, from the bottom. 1 unless setup is filling it. */
  progress?: number;
  /** How much of the height the beacon takes, 0 to 1. */
  height?: number;
  className?: string;
  style?: CSSProperties;
  /** Read by anyone who cannot see it. */
  label?: string;
  /**
   * Hands the caller a way to draw one frame on demand. Used by the bench on
   * /dev/beacon to time the real thing, since a hidden tab never animates.
   */
  onReady?: (api: { draw: (now: number) => void }) => void;
  /**
   * Forces one of the two drawings. Only the comparison page sets it; every
   * other caller lets the size decide.
   */
  render?: 'auto' | '3d' | 'svg';
};

/**
 * How many device pixels a beacon is drawn with. Two on a desktop, where the
 * frame budget is not the problem and the near-vertical edges are; one and a
 * half on a phone, where it is the other way round.
 */
function pixelRatioCap(): number {
  const coarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
  return coarse ? 1.5 : 2;
}

/**
 * Below this, on screen, the object is mostly edge: it is drawn at twice its
 * size and let the browser downscale, which is cheap at that size and the
 * difference is the whole of it.
 */
const SMALL_PX = 200;
const SUPERSAMPLE = 2;
/**
 * Below this, the object is one or two pixels of edge and the whole of it is
 * the silhouette and the line of light. That is drawn in vector instead, which
 * is sharp at any density and costs nothing to run.
 */
const VECTOR_PX = 64;
/** How long a change is animated for before the beacon goes still again. */
const CHANGE_MS = 600;

export function Beacon({
  light,
  progress = 1,
  height = 0.8,
  className,
  style,
  label,
  onReady,
  render = 'auto',
}: BeaconProps) {
  const host = useRef<HTMLDivElement>(null);
  // Which of the two drawings this box is big enough for. Null until measured,
  // so nothing is built for a size that turns out to be wrong.
  const [vector, setVector] = useState<boolean | null>(render === 'auto' ? null : render === 'svg');
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const state = useRef({ light, progress, changedAt: 0 });
  if (state.current.light !== light || state.current.progress !== progress) {
    state.current = { light, progress, changedAt: Date.now() };
  }

  useLayoutEffect(() => {
    const node = host.current;
    if (!node || render !== 'auto') return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setVector(Math.max(rect.width, rect.height) < VECTOR_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const node = host.current;
    if (!node || vector !== false) return;

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    node.append(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      // No WebGL: the page keeps its words and loses one ornament.
      canvas.remove();
      return;
    }
    // Set per frame, because it depends on how big the box turns out to be.
    let pixelRatio = 0;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const beacon = createBeacon(renderer);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let size = { w: 0, h: 0 };

    function draw(now: number) {
      const rect = node!.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const wanted =
        Math.min(pixelRatioCap(), window.devicePixelRatio || 1) *
        (Math.max(w, h) < SMALL_PX ? SUPERSAMPLE : 1);
      if (wanted !== pixelRatio) {
        pixelRatio = wanted;
        renderer.setPixelRatio(pixelRatio);
        size = { w: 0, h: 0 };
      }
      if (w !== size.w || h !== size.h) {
        size = { w, h };
        renderer.setSize(w, h, false);
      }
      // The beacon stands in a frame the size of the photograph it was built
      // for, and the canvas is a window onto the middle of it. The frame is
      // sized so the object comes out at the height the caller asked for, and
      // the window is centred on the object rather than on the frame.
      const span = PHOTO.beaconBase - PHOTO.beaconTop;
      const frameHeight = (height * h) / span;
      const frameWidth = frameHeight * (16 / 9);
      const centre = (PHOTO.beaconTop + PHOTO.beaconBase) / 2;
      beacon.place(
        {
          frame: {
            left: -(frameWidth - w) / 2,
            top: -(centre * frameHeight - h / 2),
            width: frameWidth,
            height: frameHeight,
          },
          x: 0.5,
          light: state.current.light,
          progress: state.current.progress,
          fade: 1,
        },
        new THREE.Vector2(w, h),
        new THREE.Vector2(0, 0),
      );
      beacon.tick(still ? Number.POSITIVE_INFINITY : now);
      const ratio = renderer.getPixelRatio();
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      beacon.render(Math.round(w * ratio), Math.round(h * ratio));
    }

    function loop(now: number) {
      draw(now);
      // A working beacon breathes; a steady one still runs for the length of a
      // change, so amber to green is a crossfade rather than a jump.
      const changing = Date.now() - state.current.changedAt < CHANGE_MS;
      frame = state.current.light === 'working' || changing ? requestAnimationFrame(loop) : 0;
    }

    draw(performance.now());
    onReadyRef.current?.({ draw });
    if (!still) frame = requestAnimationFrame(loop);

    const observer = new ResizeObserver(() => draw(performance.now()));
    observer.observe(node);
    const restart = window.setInterval(() => {
      // Picks the loop back up when something changes, and lets it stop again
      // once the change has played, without a listener on every render.
      if (still) return;
      const changing = Date.now() - state.current.changedAt < CHANGE_MS;
      if (!frame && (state.current.light === 'working' || changing)) {
        frame = requestAnimationFrame(loop);
      }
    }, 120);

    return () => {
      window.clearInterval(restart);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      beacon.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [height, vector]);

  return (
    <div
      ref={host}
      style={style}
      role={vector ? undefined : 'img'}
      aria-label={vector ? undefined : (label ?? 'Kalvard')}
      className={cx('pointer-events-none select-none', className)}
    >
      {vector ? (
        <BeaconSvg light={light} progress={progress} label={label} className="h-full w-full" />
      ) : null}
    </div>
  );
}
