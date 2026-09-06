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

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { PHOTO, createBeacon } from '../sky/beacon';
import type { Light } from '../sky/beacon';
import { cx } from '@sentrybot/ui';

export type BeaconProps = {
  /** What the light is doing. */
  light: Light;
  /** How much of the slit is lit, from the bottom. 1 unless setup is filling it. */
  progress?: number;
  /** How much of the height the beacon takes, 0 to 1. */
  height?: number;
  className?: string;
  /** Read by anyone who cannot see it. */
  label?: string;
};

const PIXEL_RATIO_CAP = 1.5;
/** How long a change is animated for before the beacon goes still again. */
const CHANGE_MS = 600;

export function Beacon({ light, progress = 1, height = 0.8, className, label }: BeaconProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ light, progress, changedAt: 0 });
  if (state.current.light !== light || state.current.progress !== progress) {
    state.current = { light, progress, changedAt: Date.now() };
  }

  useEffect(() => {
    const node = host.current;
    if (!node) return;

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
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
  }, [height]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label ?? 'Sentry'}
      className={cx('pointer-events-none select-none', className)}
    />
  );
}
