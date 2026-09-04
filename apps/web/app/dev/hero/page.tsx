'use client';

// The thread over the sky, playing once. This becomes the top of / at line 13.
// The sky sits behind a solid night fill and fades in; the hero's thread waits
// for it. The panel reports where it sits so the cloud thickens behind it.

import { useState } from 'react';
import { Hero } from '@/components/hero/hero';
import { Sky } from '@/components/sky/sky';
import type { SkyRect } from '@/components/sky/sky';

export default function Page() {
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<SkyRect | null>(null);
  return (
    <main className="bg-night relative min-h-svh">
      <div className="absolute inset-0">
        <Sky boost={panel} onReady={() => setReady(true)} />
      </div>
      <Hero skyReady={ready} transparent onPanelRect={setPanel} />
    </main>
  );
}
