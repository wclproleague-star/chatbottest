'use client';

import { Surface } from '@kalvard/ui';
import { useEffect, useRef, useState } from 'react';
import { Beacon } from '@/components/beacon/beacon';
import type { Light } from '@/components/sky/beacon';

// The beacon on its own, in every state it has, so each can be looked at.

export default function Page() {
  const [light, setLight] = useState<Light>('off');
  const [progress, setProgress] = useState(1);
  // The state can also come from the address, so a screenshot taken by a
  // headless browser can be in any of them without a click.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get('light');
    if (asked) setLight(asked as Light);
    if (params.get('p')) setProgress(Number(params.get('p')));
  }, []);
  const draws = useRef<((now: number) => void)[]>([]);
  const [bench, setBench] = useState('');

  // A hidden tab never animates, so the bench draws frames itself and times
  // them: the same measurement before and after a change is what matters.
  function run() {
    const FRAMES = 60;
    const start = performance.now();
    for (let i = 0; i < FRAMES; i++) {
      for (const draw of draws.current) draw(start + i * 16.7);
    }
    const each = (performance.now() - start) / FRAMES;
    const canvases = [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`);
    setBench(
      `${draws.current.length} beacons, ${each.toFixed(2)} ms per frame · buffers ${canvases.join(', ')} · dpr ${window.devicePixelRatio}`,
    );
  }

  return (
    <Surface surface="night" className="min-h-screen p-10">
      <div className="flex flex-wrap gap-3">
        {(['off', 'amber', 'working', 'green'] as Light[]).map((state) => (
          <button
            key={state}
            onClick={() => setLight(state)}
            className="text-ui border-star/40 text-star h-9 rounded-full border px-4"
          >
            {state}
          </button>
        ))}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => (
          <button
            key={p}
            onClick={() => setProgress(p)}
            className="text-ui border-star/40 text-star h-9 rounded-full border px-4"
          >
            {Math.round(p * 5)} of 5
          </button>
        ))}
      </div>
      <div className="mt-6">
        <button
          onClick={run}
          className="text-ui border-star/40 text-star h-9 rounded-full border px-4"
        >
          Time 60 frames
        </button>
        {bench && <p className="text-ui-sm text-star/70 mt-3">{bench}</p>}
      </div>
      {/* The sidebar size, both ways round: vector left, WebGL right. Under
          64px the component picks the vector one on its own. */}
      <div className="mt-10 flex items-end gap-10">
        {(['svg', '3d'] as const).map((how) => (
          <div key={how} className="flex items-end gap-6">
            {[24, 32, 40].map((px) => (
              <Beacon
                key={px}
                light={light}
                progress={progress}
                render={how}
                className="shrink-0"
                style={{ height: px * 1.6, width: px }}
              />
            ))}
            <span className="text-ui-sm text-star/70">{how}</span>
          </div>
        ))}
      </div>

      <div className="mt-10 flex items-end gap-16">
        {['h-[420px] w-[220px]', 'h-[200px] w-[110px]', 'h-[96px] w-[54px]'].map((size, i) => (
          <Beacon
            key={size}
            light={light}
            progress={progress}
            className={size}
            onReady={({ draw }) => {
              draws.current[i] = draw;
            }}
          />
        ))}
      </div>
    </Surface>
  );
}
