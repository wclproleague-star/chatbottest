'use client';

// Nothing is shown until everything is.
//
// A scene made of a photograph, a font, a starfield and a compiled shader
// arrives in pieces if you let it: the text paints first, the stars a second
// later, the beacon after that, and whatever the page was for jumps into
// place last. So the page waits. The photograph is decoded, the fonts are
// loaded, the WebGL scene is compiled and has drawn its first frame, and
// whatever the screen itself had to fetch has come back; only then does the
// whole screen appear at once, in one 500ms fade. After that nothing else may
// appear: everything below the gate is laid out before the fade, so revealing
// it moves nothing.
//
// While it waits the beacon stands there with the slit breathing faintly, at
// a fifteenth of its light. That is the loading state, and it is the object
// itself rather than a spinner in front of it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import grass from '../../../../assets/beacon/grass.png';
import scene from '../../../../assets/beacon/scene.jpg';

/** How long the reveal takes. One transition, for the whole screen. */
export const REVEAL_MS = 500;

/** Waits for a picture to be decoded, not merely fetched. */
function decoded(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = src;
    const done = () => resolve();
    if (image.decode) {
      image.decode().then(done, done);
      return;
    }
    image.onload = done;
    image.onerror = done;
  });
}

/**
 * Whether the screen may be shown, and the hand the scene's canvas calls when
 * it has drawn. `waitFor` is whatever else this screen needs before it counts
 * as ready: a session, a config, a list of channels.
 */
export function useReady(waitFor?: Promise<unknown> | null): {
  ready: boolean;
  onSceneReady: () => void;
} {
  const [assets, setAssets] = useState(false);
  const [scene3d, setScene3d] = useState(false);
  const [extra, setExtra] = useState(!waitFor);

  useEffect(() => {
    let live = true;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    Promise.all([fonts, decoded(scene.src), decoded(grass.src)]).then(() => {
      if (live) setAssets(true);
    });
    // A scene that cannot start at all must not hold the page for ever.
    const giveUp = window.setTimeout(() => {
      if (live) setScene3d(true);
    }, 6000);
    return () => {
      live = false;
      window.clearTimeout(giveUp);
    };
  }, []);

  useEffect(() => {
    if (!waitFor) {
      setExtra(true);
      return;
    }
    let live = true;
    waitFor.then(
      () => live && setExtra(true),
      () => live && setExtra(true),
    );
    return () => {
      live = false;
    };
  }, [waitFor]);

  const onSceneReady = useCallback(() => setScene3d(true), []);
  return { ready: assets && scene3d && extra, onSceneReady };
}

/**
 * The style everything below the gate carries: laid out from the first paint,
 * so nothing moves when it appears, and invisible until the screen is ready.
 * One transition on one element, never a fade per component.
 */
export function useReveal(ready: boolean) {
  return useMemo(
    () => ({
      opacity: ready ? 1 : 0,
      transition: `opacity ${REVEAL_MS}ms var(--ease-standard)`,
      pointerEvents: ready ? ('auto' as const) : ('none' as const),
    }),
    [ready],
  );
}
