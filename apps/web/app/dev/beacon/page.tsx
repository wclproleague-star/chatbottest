'use client';

import { Surface } from '@sentrybot/ui';
import { useState } from 'react';
import { Beacon } from '@/components/beacon/beacon';
import type { Light } from '@/components/sky/beacon';

// The beacon on its own, in every state it has, so each can be looked at.

export default function Page() {
  const [light, setLight] = useState<Light>('off');
  const [progress, setProgress] = useState(1);

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
      <div className="mt-10 flex items-end gap-16">
        <Beacon light={light} progress={progress} className="h-[420px] w-[220px]" />
        <Beacon light={light} progress={progress} className="h-[200px] w-[110px]" />
        <Beacon light={light} progress={progress} className="h-[96px] w-[54px]" />
      </div>
    </Surface>
  );
}
